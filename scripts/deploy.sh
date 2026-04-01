#!/usr/bin/env bash
#
# Integraf Výrobní plán — nasazení na server (Linux)
#
# Spuštění z kořene repozitáře:
#   chmod +x scripts/deploy.sh
#   ./scripts/deploy.sh
#
# Nebo s proměnnými:
#   GIT_BRANCH=main DEPLOY_DIR=/var/www/planovanivyroby ./scripts/deploy.sh
#
# Vyžaduje: git, node (npm), .env s DATABASE_URL a JWT_SECRET na serveru.
# Doporučeno: PM2 (npm i -g pm2), jinak po skriptu spusť aplikaci ručně.
#
# Co skript dělá:
#   1) git fetch + pull (fast-forward)
#   2) npm ci — závislosti podle package-lock.json
#   3) ověření schématu Prisma
#   4) prisma generate + migrate deploy (databáze)
#   5) prisma:bootstrap — jen doplní chybějící číselník/šablony (bez mazání dat)
#   6) next build
#   7) pm2 reload nebo pm2 start (aplikace)
#
# NIKDY nespouští prisma:seed (mazání dat).
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${DEPLOY_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$ROOT"

GIT_REMOTE="${GIT_REMOTE:-origin}"
# Bez GIT_BRANCH použije aktuálně checkoutnutou větev (vhodné pro server sledující např. Michal/main).
if [[ -z "${GIT_BRANCH:-}" ]] && [[ -d .git ]]; then
  GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
fi
GIT_BRANCH="${GIT_BRANCH:-main}"
DRY_RUN="${DRY_RUN:-0}"
FORCE_DEPLOY="${FORCE_DEPLOY:-0}"
SKIP_BOOTSTRAP="${SKIP_BOOTSTRAP:-0}"

log() { printf '%s\n' "$*"; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }

if [[ ! -f package.json ]]; then
  die "Spusť skript z kořene projektu (očekávám package.json v $ROOT)."
fi

if [[ "$DRY_RUN" == "1" ]]; then
  log "DRY_RUN=1 — pouze výpis příkazů, nic se neprovede."
fi

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '+ '; printf '%q ' "$@"; printf '\n'
  else
    log "▶ $*"
    "$@"
  fi
}

# Lokální necommitnuté změny = riziko — pokud ne FORCE_DEPLOY
# Výjimka: jen scripts/deploy.sh (typicky oprava CRLF přes sed) — bez obnovení by git pull selhal
if [[ -d .git ]]; then
  if [[ "$FORCE_DEPLOY" != "1" ]]; then
    stat_out="$(git status --porcelain 2>/dev/null || true)"
    if [[ -n "$stat_out" ]]; then
      unique_paths="$(printf '%s\n' "$stat_out" | awk 'NF { print $NF }' | sort -u)"
      if [[ "$unique_paths" == "scripts/deploy.sh" ]]; then
        log "ℹ️  Lokální změna jen v scripts/deploy.sh (často CRLF→LF) — obnovuji před pull, z remote přijde aktuální verze."
        git restore --staged --worktree scripts/deploy.sh 2>/dev/null || git checkout HEAD -- scripts/deploy.sh
      else
        die "Pracovní strom není čistý. Ulož změny, git stash, nebo FORCE_DEPLOY=1 (nebezpečné). Po „sed“ na deploy.sh použij: git restore scripts/deploy.sh && ./scripts/deploy.sh"
      fi
    fi
  fi
fi

if [[ ! -f .env ]]; then
  die "Chybí soubor .env v $ROOT (DATABASE_URL, JWT_SECRET, …)."
fi

log "📂 Adresář: $ROOT"
log "🌿 Větev: $GIT_REMOTE/$GIT_BRANCH"

if [[ -d .git ]]; then
  run git fetch "$GIT_REMOTE" "$GIT_BRANCH"
  run git checkout "$GIT_BRANCH"
  run git pull --ff-only "$GIT_REMOTE" "$GIT_BRANCH"
else
  log "⚠️  Adresář není git clone — přeskočeno stahování z Gitu."
fi

run npm ci

run npx prisma validate
run npx prisma generate
run npx prisma migrate deploy

if [[ "$SKIP_BOOTSTRAP" != "1" ]]; then
  run npm run prisma:bootstrap
else
  log "⏭️  SKIP_BOOTSTRAP=1 — prisma:bootstrap přeskočen."
fi

run npm run build

if command -v pm2 >/dev/null 2>&1; then
  if [[ "$DRY_RUN" == "1" ]]; then
    log "+ pm2 reload ecosystem.config.cjs --update-env || pm2 start ecosystem.config.cjs"
  else
    if pm2 describe planovanivyroby >/dev/null 2>&1; then
      log "🔄 PM2 reload (planovanivyroby)…"
      pm2 reload ecosystem.config.cjs --update-env
    else
      log "🚀 PM2 start (první spuštění)…"
      pm2 start ecosystem.config.cjs
    fi
    pm2 save 2>/dev/null || true
  fi
else
  log "⚠️  PM2 není v PATH — aplikaci spusť ručně: NODE_ENV=production npm run start"
  log "    (nebo: npm i -g pm2 && pm2 start ecosystem.config.cjs)"
fi

log "✅ Deploy dokončen."
