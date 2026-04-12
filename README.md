# Integraf – Výrobní plán

Interní aplikace pro plánování výroby na strojích XL 105 a XL 106. Repo dnes pokrývá nejen samotný planner, ale i rezervační workflow, správu uživatelů a číselníků, systém presetů, notifikace a denní tiskový report.

## Aktuálně ověřený stav

Snapshot k 4. 4. 2026:

- `npm run build` prošel úspěšně
- `npm run lint` vrací 0 chyb a 9 warningů
- `node --test --import tsx src/lib/dateUtils.test.ts` prošel 6/6 testů
- `prisma/schema.prisma` používá pouze MySQL datasource

## Hlavní moduly

- Planner na `/` s timeline gridem, drag & drop, resize, split skupinami, batch posuny, audit logem a provozními šablonami směn
- Rezervace na `/rezervace` pro role `ADMIN`, `PLANOVAT`, `OBCHODNIK`
- Admin dashboard na `/admin` pro uživatele, číselníky, job presety, audit a pracovní dobu
- Notifikace pro `DTP`, `MTZ` a přímé notifikace pro `OBCHODNIK`
- Denní report na `/report/daily?date=YYYY-MM-DD`

## Stack

- Next.js 16.1.6 (App Router)
- React + TypeScript
- Tailwind CSS v4
- Prisma 5
- MySQL
- Radix UI / shadcn primitiva
- `jose` pro JWT session
- `bcryptjs` pro hesla

## Role

| Role | Přístup |
| --- | --- |
| `ADMIN` | Kompletní správa planneru, rezervací, adminu a auditů |
| `PLANOVAT` | Práce s plannerem, rezervacemi, presety a provozní dobou |
| `DTP` | Úpravy DATA sloupce + vlastní inbox notifikací |
| `MTZ` | Úpravy MATERIÁL sloupce + vlastní inbox notifikací |
| `OBCHODNIK` | Vlastní rezervace, přímé notifikace, read-only planner |
| `TISKAR` | Read-only planner s potvrzením tisku na přiřazeném stroji |
| `VIEWER` | Pouze čtení |

## Lokální spuštění

1. Připrav prostředí:

```bash
cp .env.example .env
npm install
npx prisma generate
```

2. Připrav databázi:

```bash
npx prisma migrate deploy
npm run prisma:bootstrap
```

`npm run prisma:bootstrap` je bezpečný bootstrap pro prázdnou DB. Nic nemaže.

3. Spusť aplikaci:

```bash
npm run dev
```

Aplikace poběží na `http://localhost:3000`.

## Vývojové a provozní příkazy

| Příkaz | Popis |
| --- | --- |
| `npm run dev` | Vývojový server |
| `npm run build` | Produkční build |
| `npm run start` | Spuštění produkčního buildu |
| `npm run lint` | ESLint kontrola |
| `npm run prisma:generate` | Generování Prisma klienta |
| `npm run prisma:seed` | Destruktivní dev seed, maže a znovu plní vývojová data |
| `npm run prisma:bootstrap` | Bezpečný bootstrap prázdné databáze |
| `node --test --import tsx src/lib/dateUtils.test.ts` | Aktuální test suite |

## Důležité poznámky

- Uploady příloh rezervací se ukládají na disk do `data/reservation-attachments/<reservationId>/`.
- Zdroj pravdy pro DB je `prisma/schema.prisma` a migrace v `prisma/migrations/`.
- Build na Next.js 16 hlásí deprekační warning k `src/middleware.ts`; budoucí cleanup je přejmenování na `proxy`.
- V repu existuje stránka `/tiskar`, ale současný auth flow vede roli `TISKAR` primárně přes read-only planner na `/`.

## Dokumentace v repu

- `DOKUMENTACE.md` – lidský přehled funkcí, rolí a workflow
- `CLAUDE.md` – stručný repo-truth a provozní poznámky pro AI asistenty
- `DATABAZE_DOKUMENTACE.md` – MySQL a databázový model
- `docs/DEPLOY_WORKFLOW.md` – postup nasazení `Vojta -> michal -> server`
- `HINTY.md` – otevřený technický backlog a zlepšení
- `PLAN.md` – aktuální plánovací snapshot, ne historická implementační specifikace
- `SPECIFIKACE_DALSI_VLNY_ZMEN.md` – historická specifikace vlny rezervací a obchodníka
- `SPECIFIKACE_PRESETY_JOB_BUILDER.md` – historická specifikace presetů
