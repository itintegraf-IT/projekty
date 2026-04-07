# PLAN.md — Aktuální plánovací snapshot

Aktualizováno k 4. 4. 2026.

Tento soubor už není historická implementační specifikace z března. Slouží jako stručný přehled toho, co je hotové a co dává smysl řešit dál.

## Stav

Většina velkých vln z března 2026 je dokončená:

- audit log
- notifikace
- split skupiny
- pracovní šablony a výjimky
- role `OBCHODNIK`
- modul rezervací
- job presety
- half-hour schedule sloty

Aktuálně není rozepsaná nová velká produktová vlna. Nejbližší práce jsou spíš cleanup, stabilizace a test coverage.

## Nejbližší rozumné kroky

### 1. Framework cleanup

- přejmenovat `src/middleware.ts` na `proxy` podle doporučení Next.js 16
- projít případné dopady na auth guardy a route matcher

### 2. Tiskařský režim

- rozhodnout, jestli má být zdroj pravdy read-only planner na `/`, nebo dedikovaná route `/tiskar`
- po rozhodnutí sladit middleware, odkazy i dokumentaci

### 3. Lint a menší technický dluh

- odstranit zbývající warningy
- sjednotit navigační odkazy na `next/link`
- projít zbývající `<img>` usage

### 4. Testy

- rozšířit `node:test` mimo `src/lib/dateUtils.test.ts`
- prioritně pokrýt:
  - rezervace a jejich stavové přechody
  - notifikace
  - validaci presetů
  - role-based přístup

### 5. Report a provozní logika

- ověřit, zda denní report nemá přestat používat částečně hardcoded směny a místo toho brát data ze šablon pracovní doby

## Zdroj pravdy

- aktuální funkce a workflow: `DOKUMENTACE.md`
- stručný repo-truth: `CLAUDE.md`
- databáze a provoz: `DATABAZE_DOKUMENTACE.md`
