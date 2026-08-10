#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Denní CSV export klíčových tabulek — lidsky čitelná pojistka nezávislá na
# Prismě, aplikaci i formátu dumpu. Otevře Excel CZ dvojklikem (BOM + středník).
# Běží z ROOT crontabu. Instalace: docs/OPS_ZALOHY.md
#
# Cron (root) — 2:20, NE 2:15: čas dělitelný 15 by běžel ve stejnou minutu
# jako healthcheck a ten by mohl freshness odsouhlasit nad rozpracovaným během:
#   20 2 * * * /usr/local/bin/planovani-csv-export.sh >> /var/log/planovani-backup.log 2>&1
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
umask 077   # exporty obsahují business data — jen pro root

BACKUP_ROOT=/var/backups/planovanivyroby
OUT=$BACKUP_ROOT/csv/$(date +%Y%m%d)
KEEP_DAYS=30
# Kontrakt všech tvůrců BACKUP_ROOT: adresář musí být 711 (průchozí pro banner).
mkdir -p "$BACKUP_ROOT"
chmod 711 "$BACKUP_ROOT"
# Export jde do .part a přejmenuje se až po úspěchu celého běhu — v csv/
# nikdy neleží částečné torzo tvářící se jako kompletní export (nález S4).
# Healthcheck hlídá čerstvost finálního adresáře (kontrola č. 7).
TMP=$OUT.part
trap 'rm -rf "$TMP"' EXIT
rm -rf "$TMP" "$OUT"
mkdir -p "$TMP"

# mysql --batch = tab-oddělený výstup; sed ho převede na quotovaný ;-CSV.
#
# Prázdný soubor NENÍ sám o sobě chyba: `mysql --batch` u prázdného výsledku
# nevypíše ani hlavičku, takže legitimně prázdná tabulka dá jen BOM (3 B).
# Selhání dotazu tahle funkce hlídat nemusí — `set -euo pipefail` výš ukončí
# celý skript s chybou přímo z `mysql`. Fatální je proto prázdnota jen u tabulek,
# které prázdné být NESMÍ (třetí parametr `required`); u ostatních se jen zaloguje.
# Původní bezvýjimečná kontrola shodila první ostrý běh (10. 8. 2026) na tom,
# že v produkci zatím není ani jedna příloha rezervace.
export_query() {  # $1 = název souboru (bez přípony), $2 = SQL, $3 = "required" (volitelné)
  { printf '\xEF\xBB\xBF'                      # BOM → česká diakritika v Excelu
    mysql igvyroba --batch -e "$2" \
      | sed 's/"/""/g; s/\t/";"/g; s/^/"/; s/$/"/'
  } > "$TMP/$1.csv"
  if [ "$(stat -c%s "$TMP/$1.csv")" -le 3 ]; then
    if [ "${3:-}" = "required" ]; then
      echo "FAIL: $1.csv je prázdný, a prázdný být nesmí" >&2
      exit 1
    fi
    echo "INFO: $1.csv je prázdný (tabulka nemá žádné řádky)" >&2
  fi
}

# `required` = prázdný export téhle tabulky znamená katastrofu, ne provozní stav.
# Block a User prázdné být nemůžou, dokud aplikace vůbec funguje. Rezervace,
# přílohy ani měsíční výřez auditu naopak legitimně prázdné být můžou.
export_query Block                 'SELECT * FROM `Block`'                required
export_query Reservation           'SELECT * FROM `Reservation`'
export_query ReservationAttachment 'SELECT * FROM `ReservationAttachment`'
# User ZÁMĚRNĚ bez passwordHash — bcrypt hashe do CSV nepatří.
export_query User                  'SELECT id, username, role, assignedMachine, createdAt FROM `User`' required
# AuditLog jen poslední měsíc, ať soubor neroste donekonečna.
export_query AuditLog              'SELECT * FROM `AuditLog` WHERE createdAt > NOW() - INTERVAL 31 DAY'

mv "$TMP" "$OUT"
trap - EXIT

# Retence podle POČTU adresářů (poučení z review: žádné mtime).
ls -1d "$BACKUP_ROOT"/csv/20* 2>/dev/null | grep -v '\.part$' | sort \
  | head -n -"$KEEP_DAYS" | xargs -r rm -rf

echo "CSV export OK: $OUT ($(ls "$OUT" | wc -l) souborů)"
