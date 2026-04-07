# Hinty pro zlepšení – Integraf

Tento soubor je záměrně jen backlog zlepšení. Není to zdroj pravdy o aktuálních funkcích aplikace.

Aktualizováno k 4. 4. 2026.

## Co je už hotové

- audit log bloků
- rezervační modul a role `OBCHODNIK`
- role-based i user-targeted notifikace
- job presety v builderu i adminu
- pracovní šablony strojů a výjimky
- split skupiny bloků
- denní tiskový report

## Aktuální backlog

### Vysoká priorita

- Převést `src/middleware.ts` na `proxy` konvenci doporučenou v Next.js 16.
- Rozhodnout tiskařský vstupní bod: buď finálně používat `/`, nebo vrátit do hry `/tiskar` a sladit middleware.
- Vyčistit současné ESLint warningy a vrátit lint do úplně čistého stavu.

### Střední priorita

- Rozšířit automatické testy mimo datumové utility:
  - rezervace
  - notifikace
  - job presety
  - auth/role guardy
- Napojit denní report na skutečné šablony pracovní doby místo částečně hardcoded směn v UI.
- Sjednotit navigaci v headeru na `next/link` tam, kde stále zůstaly obyčejné anchor odkazy.

### Nižší priorita

- Nahradit zbývající `<img>` komponenty za `next/image`, pokud to nebude komplikovat tiskové výstupy.
- Zvážit přidání pohodlného `npm run test` skriptu nad stávající `node:test` suite.
- Postupně doplnit jemnější integrační testy pro planner drag/drop a batch update workflow.
