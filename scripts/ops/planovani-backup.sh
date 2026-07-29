#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Denní záloha aplikace planovanivyroby: DB igvyroba + přílohy + konfigurace.
#
# Běží z ROOT crontabu na produkčním serveru (192.168.10.210) — MySQL root
# se autentizuje přes auth_socket, takže žádné heslo v cronu ani ve skriptu.
# Instalace a postup obnovy: docs/OPS_ZALOHY.md
# Skript je server-only (GNU coreutils/findutils — na macOS nefunguje).
#
# Cron (root):  45 1 * * * /usr/local/bin/planovani-backup.sh >> /var/log/planovani-backup.log 2>&1
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
umask 077   # dumpy obsahují hashe hesel a business data — nikdy world-readable

APP_DIR=/var/www/planovanivyroby
BACKUP_ROOT=/var/backups/planovanivyroby
STAMP=$(date +%Y%m%d_%H%M%S)
STATUS_FILE=$BACKUP_ROOT/last_backup_status   # čte ho SSH banner (a health-check)
KEEP_DB=14                                    # kolik POSLEDNÍCH denních dumpů držet
KEEP_ATT=14                                   # kolik POSLEDNÍCH snapshotů příloh držet
KEEP_CFG=90                                   # kolik POSLEDNÍCH kopií configu držet
MIN_DUMP_BYTES=200000                         # dump pod ~200 kB = podezřelý
DUMP=""

fail() {
  trap - ERR
  set +e
  if [ -n "$DUMP" ]; then rm -f "$DUMP.part"; fi   # neponechávat torzo tvářící se jako záloha
  echo "FAIL $(date -Is) $*" > "$STATUS_FILE" || true
  chmod 644 "$STATUS_FILE" 2>/dev/null || true
  echo "CHYBA ZÁLOHY: $*" >&2
  exit 1
}
# Každé neošetřené selhání (set -e) musí zapsat FAIL — jinak by ve statusu
# zůstalo včerejší OK a monitoring by lhal.
trap 'fail "neočekávaná chyba na řádku $LINENO"' ERR

mkdir -p "$BACKUP_ROOT"/db "$BACKUP_ROOT"/attachments "$BACKUP_ROOT"/config
chmod 711 "$BACKUP_ROOT"   # průchozí kvůli banneru (status file), bez listingu
chmod 700 "$BACKUP_ROOT"/db "$BACKUP_ROOT"/attachments "$BACKUP_ROOT"/config

# Jen jedna instance najednou (cron vs. ruční spuštění)
exec 9>/var/lock/planovani-backup.lock
flock -n 9 || fail "jiná instance zálohy právě běží"

# ── 1) DB dump — --single-transaction = konzistentní bez zámků, app běží dál ─
# Dump jde nejdřív do .part a na finální jméno se přejmenuje až PO verifikaci,
# aby v db/ nikdy neležel neověřený soubor vypadající jako platná záloha.
DUMP=$BACKUP_ROOT/db/igvyroba_$STAMP.sql.gz
mysqldump --single-transaction --triggers --routines --add-drop-table \
  igvyroba | gzip > "$DUMP.part" || fail "mysqldump selhal"

# ── 2) Verifikace dumpu (stejná logika jako DEPLOY_WORKFLOW.md krok 4b.1) ────
gzip -t "$DUMP.part"                                        || fail "gzip poškozen"
SIZE=$(stat -c%s "$DUMP.part")
[ "$SIZE" -ge "$MIN_DUMP_BYTES" ]                           || fail "dump podezřele malý: $SIZE B"
[ "$(zgrep -c 'CREATE TABLE `Block`' "$DUMP.part")" -eq 1 ] || fail "dump neobsahuje CREATE TABLE Block"
zgrep -q 'Dump completed' "$DUMP.part"                      || fail "dump nemá patičku (přerušen v půlce?)"
mv "$DUMP.part" "$DUMP"

# ── 3) Přílohy — denní snapshot, nezměněné soubory jen hardlink (šetří místo)
ATT_SRC=$APP_DIR/data/reservation-attachments
ATT_NEW=$BACKUP_ROOT/attachments/$STAMP
ATT_LATEST=$BACKUP_ROOT/attachments/latest
if [ -d "$ATT_SRC" ]; then
  if [ -d "$ATT_LATEST" ] || [ -L "$ATT_LATEST" ]; then
    rsync -a --link-dest="$ATT_LATEST" "$ATT_SRC/" "$ATT_NEW/" || fail "rsync příloh selhal"
  else
    rsync -a "$ATT_SRC/" "$ATT_NEW/" || fail "rsync příloh selhal (první běh)"
  fi
  ln -sfn "$ATT_NEW" "$ATT_LATEST"
  ATT_INFO=$(du -sh "$ATT_NEW" | cut -f1)
else
  # Adresář vzniká až s první nahranou přílohou — není to chyba zálohy.
  ATT_INFO="zadne-prilohy"
fi

# ── 4) Konfigurace — .env existuje v jediné kopii jen na serveru ─────────────
install -m 600 "$APP_DIR/.env"                 "$BACKUP_ROOT/config/env_$STAMP" \
                                                            || fail "kopie .env selhala"
cp             "$APP_DIR/ecosystem.config.cjs" "$BACKUP_ROOT/config/ecosystem_$STAMP.cjs" \
                                                            || fail "kopie ecosystem configu selhala"

# ── 5) Retence — podle POČTU (názvy nesou STAMP), nikdy podle mtime! ─────────
# rsync -a přenáší mtime zdrojového adresáře na snapshot → mtime-retence by
# v klidovém období mazala i čerstvé snapshoty (nález review 29. 7. 2026).
# Počet posledních navíc nikdy nesmaže poslední zálohy, ani když nové
# přestanou vznikat. head -n -N = GNU (server-only).
prune_keep_last() {  # $1 = glob prefix, $2 = kolik posledních nechat
  ls -1d "$1"* 2>/dev/null | sort | head -n -"$2" | xargs -r rm -rf
}
prune_keep_last "$BACKUP_ROOT/db/igvyroba_"          "$KEEP_DB"
prune_keep_last "$BACKUP_ROOT/attachments/20"        "$KEEP_ATT"
prune_keep_last "$BACKUP_ROOT/config/env_"           "$KEEP_CFG"
prune_keep_last "$BACKUP_ROOT/config/ecosystem_"     "$KEEP_CFG"

# ── 6) OFF-SITE kopie — BUDOUCÍ KROK (rozhodnutí 29. 7. 2026: zatím neřešit).
# Až bude cíl (NAS / pull z Macu), odkomentovat a doplnit:
# rsync -a --delete "$BACKUP_ROOT/" backup@CIL:/cesta/planovanivyroby/ \
#   || fail "off-site rsync selhal"

trap - ERR
echo "OK $(date -Is) dump=${SIZE}B prilohy=${ATT_INFO}" > "$STATUS_FILE"
chmod 644 "$STATUS_FILE"   # banner ho čte i pod ne-root uživatelem
echo "Záloha OK: $DUMP (${SIZE} B), přílohy: ${ATT_INFO}"
