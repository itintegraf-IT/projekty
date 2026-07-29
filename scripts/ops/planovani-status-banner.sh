#!/bin/sh
# SSH banner: stav poslední zálohy planovanivyroby.
# Instaluje se jako /etc/profile.d/planovani-status.sh (viz docs/OPS_ZALOHY.md).
B=/var/backups/planovanivyroby
STATUS=$(cat "$B/last_backup_status" 2>/dev/null || echo "ZATIM ZADNA ZALOHA NEPROBEHLA")
echo "── planovanivyroby ─────────────────────────────────"
case "$STATUS" in
  OK*) echo "Záloha:  $STATUS" ;;
  *)   printf '\033[1;31mZáloha:  %s\033[0m\n' "$STATUS" ;;
esac
echo "────────────────────────────────────────────────────"
