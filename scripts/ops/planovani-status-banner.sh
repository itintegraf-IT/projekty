#!/bin/sh
# SSH banner: stav poslední zálohy planovanivyroby.
# Instaluje se jako /etc/profile.d/planovani-status.sh (viz docs/OPS_ZALOHY.md).
# Vypisuje se JEN v interaktivním shellu — neinteraktivní login shelly
# (ssh host 'bash -lc …', su - user -c …) nesmí dostat banner do stdout.
case $- in
  *i*)
    B=/var/backups/planovanivyroby
    if [ -e "$B/last_backup_status" ] && [ ! -r "$B/last_backup_status" ]; then
      STATUS="STATUS NECITELNY (zkontroluj prava na $B/last_backup_status)"
    else
      STATUS=$(cat "$B/last_backup_status" 2>/dev/null || echo "ZATIM ZADNA ZALOHA NEPROBEHLA")
    fi
    echo "── planovanivyroby ─────────────────────────────────"
    case "$STATUS" in
      OK*) echo "Záloha:  $STATUS" ;;
      *)   printf '\033[1;31mZáloha:  %s\033[0m\n' "$STATUS" ;;
    esac
    echo "────────────────────────────────────────────────────"
    unset B STATUS
    ;;
esac
