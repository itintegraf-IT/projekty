#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Health-check aplikace planovanivyroby. Běží z ROOT crontabu.
# Závislosti: curl, jq (apt install jq), volitelně msmtp pro e-mail alerty.
# Instalace a POŘADÍ NASAZENÍ (nejdřív deploy aplikace!): docs/OPS_ZALOHY.md
#
# Cron (root) — report v 7:05, NE 7:00: čas dělitelný 15 by kolidoval
# s pravidelným během o flock a heartbeat by se nedeterministicky ztrácel:
#   */15 * * * * /usr/local/bin/planovani-healthcheck.sh >> /var/log/planovani-health.log 2>&1
#   5 7 * * *    /usr/local/bin/planovani-healthcheck.sh --report >> /var/log/planovani-health.log 2>&1
# ─────────────────────────────────────────────────────────────────────────────
# Záměrně BEZ set -e: chceme posbírat VŠECHNY problémy, ne skončit na prvním.
set -uo pipefail
umask 077

APP_URL="http://localhost:3020/api/health"
PM2_USER=administrator
BACKUP_ROOT=/var/backups/planovanivyroby
STATUS_FILE=$BACKUP_ROOT/health_status
BACKUP_STATUS=$BACKUP_ROOT/last_backup_status
# State soubory MUSÍ ležet v root-owned adresáři — /var/tmp je world-writable
# a root zápis přes podvržený symlink = lokální eskalace (nález review K1).
RESTARTS_STATE=$BACKUP_ROOT/health_restarts
ALERT_STATE=$BACKUP_ROOT/health_alert
DISK_LIMIT=85
PM2_LOGS_LIMIT_MB=500
BACKUP_MAX_AGE_H=26
MAIL_TO="vojta@integraf.cz"        # více adres oddělit mezerou
ALERT_COOLDOWN_S=3600              # stejný TYP problému max 1 e-mail za hodinu
PROBLEMS=()

mkdir -p "$BACKUP_ROOT"
chmod 711 "$BACKUP_ROOT" 2>/dev/null   # průchozí kvůli banneru

# Jen jedna instance (zaseknutý běh nesmí vrstvit další procesy na nemocném serveru)
exec 9>/var/lock/planovani-health.lock
flock -n 9 || exit 0

# ── 1) Aplikace odpovídá (neautentizovaný /api/health dělá i SELECT 1 do DB) ─
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$APP_URL" || true)
[ -n "$CODE" ] || CODE=000
[ "$CODE" = "200" ] || PROBLEMS+=("aplikace: HTTP $CODE z $APP_URL")

# ── 2) PM2: primárně systemd unit, sekundárně jlist (crash-loop detekce) ─────
# systemd unit je spolehlivý i z cronu; pm2 jlist přes login shell může selhat
# na PATH (nvm) nebo znečištěném stdout — proto timeout + ořez na JSON.
systemctl is-active --quiet "pm2-$PM2_USER" \
  || PROBLEMS+=("PM2: systemd unit pm2-$PM2_USER neběží")
PM2_JSON=$(timeout 30 sudo -u "$PM2_USER" -i pm2 jlist 2>/dev/null | sed -n '/^\[/,$p' || true)
[ -n "$PM2_JSON" ] || PM2_JSON='[]'
if echo "$PM2_JSON" | jq -e '.[] | select(.name=="planovanivyroby" and .pm2_env.status=="online")' >/dev/null 2>&1; then
  RESTARTS=$(echo "$PM2_JSON" | jq '[.[] | select(.name=="planovanivyroby")][0].pm2_env.restart_time // 0')
  LAST=$(cat "$RESTARTS_STATE" 2>/dev/null || echo "$RESTARTS")
  [[ "$LAST" =~ ^[0-9]+$ ]] || LAST=$RESTARTS
  if [ "$RESTARTS" -gt $((LAST + 3)) ] 2>/dev/null; then
    PROBLEMS+=("PM2: $((RESTARTS - LAST)) restartů od minulé kontroly (crash-loop?)")
  fi
  echo "$RESTARTS" > "$RESTARTS_STATE"
else
  PROBLEMS+=("PM2: proces planovanivyroby není online (nebo pm2 nedostupné z cronu — viz docs)")
  RESTARTS="?"
fi

# ── 3) MySQL běží a odpovídá ─────────────────────────────────────────────────
systemctl is-active --quiet mysql || PROBLEMS+=("MySQL: služba neběží")
mysql --connect-timeout=10 igvyroba -e 'SELECT 1' >/dev/null 2>&1 \
  || PROBLEMS+=("MySQL: SELECT 1 selhal")

# ── 4) Disk (dedup mountů — /var často není samostatný filesystem) ───────────
for MNT in $(df --output=target / /var 2>/dev/null | tail -n +2 | sort -u); do
  USE=$(df --output=pcent "$MNT" 2>/dev/null | tail -1 | tr -dc '0-9')
  if [ -n "$USE" ] && [ "$USE" -ge "$DISK_LIMIT" ]; then
    PROBLEMS+=("disk: $MNT je na ${USE} %")
  fi
done

# ── 5) Velikost PM2 logů (pojistka, kdyby pm2-logrotate vypadl) ──────────────
LOGMB=$(du -sm "/home/$PM2_USER/.pm2/logs" 2>/dev/null | cut -f1 || echo 0)
if [ "${LOGMB:-0}" -ge "$PM2_LOGS_LIMIT_MB" ]; then
  PROBLEMS+=("PM2 logy: ${LOGMB} MB — rotace nefunguje?")
fi

# ── 6) Čerstvost zálohy: status OK + timestamp < BACKUP_MAX_AGE_H hodin ──────
# (kontrola stáří je nutná — samotný prefix OK může být včerejší „stale OK")
BK=$(cat "$BACKUP_STATUS" 2>/dev/null || echo "")
case "$BK" in
  OK*)
    BK_TS=$(echo "$BK" | awk '{print $2}')
    if [ -z "$BK_TS" ]; then
      # GNU `date -d ""` vrací dnešní půlnoc s exit 0 — prázdný timestamp
      # se MUSÍ odchytit dřív, jinak je kontrola celý den slepá (nález S1).
      PROBLEMS+=("záloha: status má nečekaný formát: $BK")
    else
      BK_EPOCH=$(date -d "$BK_TS" +%s 2>/dev/null || echo 0)
      if [ "$BK_EPOCH" -eq 0 ]; then
        PROBLEMS+=("záloha: nečitelný timestamp ve statusu: $BK_TS")
      else
        AGE_H=$(( ($(date +%s) - BK_EPOCH) / 3600 ))
        [ "$AGE_H" -lt "$BACKUP_MAX_AGE_H" ] \
          || PROBLEMS+=("záloha: poslední OK je staré ${AGE_H} h (limit ${BACKUP_MAX_AGE_H} h)")
      fi
    fi
    ;;
  "") PROBLEMS+=("záloha: status soubor neexistuje — záloha nikdy neproběhla?") ;;
  *)  PROBLEMS+=("záloha: $BK") ;;
esac
find "$BACKUP_ROOT/db" -name '*.sql.gz' -mmin -$((BACKUP_MAX_AGE_H * 60)) 2>/dev/null | grep -q . \
  || PROBLEMS+=("záloha: žádný dump mladší ${BACKUP_MAX_AGE_H} h")

# ── 7) Čerstvost CSV exportu (bez rozpracovaných .part torz) ─────────────────
find "$BACKUP_ROOT/csv" -maxdepth 1 -type d -name '20*' ! -name '*.part' -mmin -$((BACKUP_MAX_AGE_H * 60)) 2>/dev/null | grep -q . \
  || PROBLEMS+=("CSV export: žádný export mladší ${BACKUP_MAX_AGE_H} h")

# ── Vyhodnocení + status soubor + alerting ───────────────────────────────────
send_mail() {  # $1 = subject, stdin = body
  command -v msmtp >/dev/null 2>&1 || return 0
  { printf 'Subject: %s\nTo: %s\n\n' "$1" "${MAIL_TO// /, }"; cat; } \
    | msmtp $MAIL_TO 2>/dev/null || true
}

if [ ${#PROBLEMS[@]} -eq 0 ]; then
  echo "OK $(date -Is)" > "$STATUS_FILE"
  chmod 644 "$STATUS_FILE"
  rm -f "$ALERT_STATE"
  if [ "${1:-}" = "--report" ]; then
    printf 'Vše OK: aplikace, PM2 (celkem restartů: %s), MySQL, disk, zálohy, CSV.\n%s\n' \
      "${RESTARTS:-?}" "$(date)" | send_mail "[PLANOVANI] denní report: OK"
  fi
  echo "OK $(date -Is)"
else
  { echo "PROBLEM $(date -Is)"; printf ' - %s\n' "${PROBLEMS[@]}"; } > "$STATUS_FILE"
  chmod 644 "$STATUS_FILE"
  # Anti-spam: hashují se jen TYPY problémů (prefix před dvojtečkou) — plné
  # texty obsahují proměnlivá čísla (%, MB, hodiny) a obcházely by cooldown.
  HASH=$(printf '%s\n' "${PROBLEMS[@]}" | cut -d: -f1 | sort -u | md5sum | cut -d' ' -f1)
  NOW=$(date +%s)
  LAST_HASH=""; LAST_TS=0
  read -r LAST_HASH LAST_TS 2>/dev/null < "$ALERT_STATE" || { LAST_HASH=""; LAST_TS=0; }
  [[ "$LAST_TS" =~ ^[0-9]+$ ]] || LAST_TS=0
  if [ "$HASH" != "$LAST_HASH" ] || [ $((NOW - LAST_TS)) -ge "$ALERT_COOLDOWN_S" ]; then
    printf '%s\n' "${PROBLEMS[@]}" | send_mail "[PLANOVANI] PROBLEM (${#PROBLEMS[@]})"
    echo "$HASH $NOW" > "$ALERT_STATE"
  fi
  printf 'PROBLEM %s\n' "$(date -Is)"; printf ' - %s\n' "${PROBLEMS[@]}"
  exit 1
fi
