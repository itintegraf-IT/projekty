#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Úklid tabulky BlockRevision ("černá skříňka" změn plánu, etapa B1).
# Retence 90 dní je v samotném skriptu scripts/prune-revisions.ts; tenhle wrapper
# jen zajistí, že se vůbec spustí z cronu.
#
# PROČ WRAPPER: Node je na serveru z nvm pod uživatelem administrator, kdežto
# cron startuje s holým PATH=/usr/bin:/bin. Původní přímý řádek v crontabu
# (`/usr/bin/env npx tsx …`) proto tiše nikdy neproběhl — ověřeno 9. 8. 2026,
# `/usr/bin/env: 'npx': No such file or directory`. Absolutní cesta k `npx`
# sama NESTAČÍ: je to skript se `#!/usr/bin/env node`, takže v PATH musí být
# i `node`. Verze Node se hledá dynamicky — pevná cesta by se po upgradu nvm
# zase tiše rozbila.
#
# Běží z ROOT crontabu. Instalace: docs/OPS_ZALOHY.md
# Cron (root): 50 3 * * * /usr/local/bin/planovani-prune-revisions.sh >> /var/log/planovani-backup.log 2>&1
# Čas 3:50 je ZÁMĚRNĚ po noční záloze (1:45) i CSV exportu (2:20) — smazané
# revize tak jsou vždycky ještě obsažené v čerstvé záloze.
# ─────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail

APP_DIR=/var/www/planovanivyroby
NVM_ROOT=/home/administrator/.nvm/versions/node

fail() { echo "CHYBA ÚKLIDU REVIZÍ: $*" >&2; exit 1; }
trap 'fail "neočekávaná chyba na řádku $LINENO"' ERR

NVM_BIN=$(ls -d "$NVM_ROOT"/*/bin 2>/dev/null | sort -V | tail -1) \
  || fail "nenalezen žádný Node v $NVM_ROOT"
[ -n "$NVM_BIN" ] || fail "nenalezen žádný Node v $NVM_ROOT"
[ -x "$NVM_BIN/npx" ] || fail "$NVM_BIN/npx neexistuje nebo není spustitelný"

PATH="$NVM_BIN:$PATH"
export PATH

cd "$APP_DIR" || fail "adresář $APP_DIR neexistuje"
npx tsx scripts/prune-revisions.ts || fail "prune-revisions.ts selhal"
