#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Denní záloha aplikace planovanivyroby: DB igvyroba + přílohy + konfigurace.
#
# Běží z ROOT crontabu na produkčním serveru (192.168.10.210) — MySQL root
# se autentizuje přes auth_socket, takže žádné heslo v cronu ani ve skriptu.
# Instalace a postup obnovy: docs/OPS_ZALOHY.md
#
# Cron (root):  45 1 * * * /usr/local/bin/planovani-backup.sh >> /var/log/planovani-backup.log 2>&1
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR=/var/www/planovanivyroby
BACKUP_ROOT=/var/backups/planovanivyroby
STAMP=$(date +%Y%m%d_%H%M%S)
STATUS_FILE=$BACKUP_ROOT/last_backup_status   # čte ho SSH banner (a health-check)
RETENTION_DB_DAYS=14
RETENTION_ATT_DAYS=14
RETENTION_CFG_DAYS=90
MIN_DUMP_BYTES=200000                         # dump pod ~200 kB = podezřelý

fail() {
  echo "FAIL $(date -Is) $*" > "$STATUS_FILE"
  echo "CHYBA ZÁLOHY: $*" >&2
  exit 1
}

mkdir -p "$BACKUP_ROOT"/db "$BACKUP_ROOT"/attachments "$BACKUP_ROOT"/config

# ── 1) DB dump — --single-transaction = konzistentní bez zámků, app běží dál ─
DUMP=$BACKUP_ROOT/db/igvyroba_$STAMP.sql.gz
mysqldump --single-transaction --triggers --routines --add-drop-table \
  igvyroba | gzip > "$DUMP" || fail "mysqldump selhal"

# ── 2) Verifikace dumpu (stejná logika jako DEPLOY_WORKFLOW.md krok 4b.1) ────
gzip -t "$DUMP"                                        || fail "gzip poškozen"
SIZE=$(stat -c%s "$DUMP")
[ "$SIZE" -ge "$MIN_DUMP_BYTES" ]                      || fail "dump podezřele malý: $SIZE B"
[ "$(zgrep -c 'CREATE TABLE `Block`' "$DUMP")" -eq 1 ] || fail "dump neobsahuje CREATE TABLE Block"
zgrep -q 'Dump completed' "$DUMP"                      || fail "dump nemá patičku (přerušen v půlce?)"

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

# ── 5) Retence ───────────────────────────────────────────────────────────────
find "$BACKUP_ROOT/db"     -name '*.sql.gz' -mtime +"$RETENTION_DB_DAYS" -delete
find "$BACKUP_ROOT/attachments" -maxdepth 1 -type d -name '20*' \
     -mtime +"$RETENTION_ATT_DAYS" -exec rm -rf {} +
find "$BACKUP_ROOT/config" -type f -mtime +"$RETENTION_CFG_DAYS" -delete

# ── 6) OFF-SITE kopie — BUDOUCÍ KROK (rozhodnutí 29. 7. 2026: zatím neřešit).
# Až bude cíl (NAS / pull z Macu), odkomentovat a doplnit:
# rsync -a --delete "$BACKUP_ROOT/" backup@CIL:/cesta/planovanivyroby/ \
#   || fail "off-site rsync selhal"

echo "OK $(date -Is) dump=${SIZE}B prilohy=${ATT_INFO}" > "$STATUS_FILE"
echo "Záloha OK: $DUMP (${SIZE} B), přílohy: ${ATT_INFO}"
