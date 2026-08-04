# CLAUDE.md — Integraf Výrobní plán

Štíhlý soubor pravidel (živé konvence + gotchy). Historie featur a implementační detaily → `docs/vyvoj-historie.md`; plány → `docs/superpowers/plans/`. Změny konvencí commituj ve stejném PR, co je vyvolal.

**Stack:** Next.js 16 (App Router) · React · TypeScript · Tailwind CSS v4 · Prisma 5 · MySQL.

## Příkazy

```bash
npm run build        # build (spustit lokálně před pushem — chytí TS chyby dřív než server)
npm run lint         # vrací warningy, 0 chyb je OK
# celá test suite (560 testů, node:test + tsx) — glob NEJDE do podsložek,
# proto se každá složka s testy musí uvést zvlášť (jinak tiše nepoběží):
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/app/_components/*.test.ts
```

`--experimental-test-module-mocks` je nutný jen kvůli `scheduleSlotFinder.server.test.ts` (`mock.module`); ostatní ho nepotřebují.

## Role a přístup

| Role | Planner | Rezervace | Admin | Notifikace |
| --- | --- | --- | --- | --- |
| `ADMIN` | plný edit | ano | plný | audit + historie |
| `PLANOVAT` | plný edit | ano | omezený admin (číselníky/presety/prac. doba) | audit + historie |
| `DTP` | edit DATA | ne | ne | vlastní inbox |
| `MTZ` | edit MATERIÁL | ne | ne | vlastní inbox |
| `OBCHODNIK` | read-only | vlastní rezervace | ne | vlastní inbox |
| `TISKAR` | read-only + tisk (režim `isTiskar` na `/`) | ne | ne | ne |
| `VIEWER` | read-only | ne | ne | ne |

Modul `/tiskar` byl zrušen (mrtvý kód) — tiskař jede na `/`.

## Data & DB

- Zdroj pravdy schématu: `prisma/schema.prisma` (datasource `mysql`); migrace v `prisma/migrations/`.
- Modely: `Block`, `Reservation`, `ReservationAttachment`, `Notification`, `JobPreset`, `CodebookOption`, `CompanyDay`, `MachineWeekShifts`, `MachineWorkHours` (jen bootstrap/legacy), `User`, `AuditLog`, `SplitGroup`.
- Přílohy: metadata v `ReservationAttachment`, obsah na disku `data/reservation-attachments/<reservationId>/<storageKey>`.
- **Pracovní doba**: runtime jede na `MachineWeekShifts` (per-týden, flag-only: morningOn/afternoonOn/nightOn). Fixní časy směn MORNING 6–14, AFTERNOON 14–22, NIGHT 22–6 (`src/lib/shifts.ts`).
- **Datum na serveru**: vždy `new Date(datePart + "T00:00:00.000Z")`, nikdy `getFullYear/Month/Date`. Prague helpery v `src/lib/dateUtils.ts`.

## Bezpečné a nebezpečné příkazy

```bash
npx prisma migrate deploy     # bezpečné
npm run prisma:bootstrap      # bezpečné (idempotentní seed číselníků)
npm run prisma:seed           # DESTRUKTIVNÍ dev-only — maže data. NIKDY na produkci.
```

Produkce běží na firemním serveru (spravuje Michal); deploy postup a prod-DB gotchy (název DB `igvyroba` malými, `sudo mysql`, host) → `docs/DEPLOY_WORKFLOW.md`. **Před každým zásahem na produkci VŽDY nejdřív `mysqldump` záloha.**

## Prisma — konvence relací (KRITICKÉ)

`prisma db pull` a `prisma format` přejmenují relační pole podle názvu modelu a **rozbijí kód**. **Nikdy je nespouštět bez kontroly.** Kanonická relační pole (kód je na nich závislý):

| Model | Pole | Typ |
| --- | --- | --- |
| `Reservation` | `blocks` | `Block[]` |
| `Reservation` | `attachments` | `ReservationAttachment[]` |
| `ReservationAttachment` | `reservation` | `Reservation` |

Pokud je formátovač přepíše na `Block`/`ReservationAttachment`/`Reservation`, vrátit zpět. Po změně schématu spustit `npm run build`.

## Coding standards (POVINNÉ pro nový kód)

**Chyby v API routes → vždy `AppError`** (`src/lib/errors.ts`), nikdy string-prefix `Error`. V catch bloku:
```typescript
} catch (err) {
  if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
  logger.error("[route] neočekávaná chyba", err);
  return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
}
```
`errorStatus` je kanonická mapa kód→HTTP v `errors.ts` (žádné lokální kopie).

**Auth v nových API routes → `requireRole([...])`** (`src/lib/auth.ts`) UVNITŘ try (hází `UNAUTHORIZED`/`FORBIDDEN` → catch výše). Čisté jádro `assertRole` v `src/lib/authz.ts`. Jediné záměrně veřejné routes: `/api/auth/*` a `/api/health` (liveness probe pro monitoring, výjimka v middleware přesnou shodou) — žádné další nepřidávat.

**Logování → vždy `logger`** (`src/lib/logger.ts`), nikdy `console.*` v API routes.

**Validace harmonogramu → vždy `validateAndComputeEnd`** (`src/lib/scheduleValidationServer.ts`, jediný zdroj pravdy). Pro každý ZAKAZKA blok s `startTime` (POST/PUT/batch): ulož **end vrácený funkcí** (nikdy z klienta) a do `Block.scheduleBypassed` ulož **`sched.effectivelyBypassed`** (spočítaná pravda), nikdy echo request flagu. Klientské mutační cesty posílají `printMinutes` a snapují **jen start** (`snapStartToNextRunnableSlot`), end dopočítá server. Detaily „tiskových hodin" → `docs/vyvoj-historie.md`.

**Overlap guard platí pro VŠECHNY typy bloků** (ZAKAZKA, REZERVACE, UDRZBA — ne jen ZAKAZKA), na všech 5 zápisových cestách (POST/PUT/batch/split/reflow). `assertNoOverlapForBlocks`/`checkBlockOverlap` (`src/lib/overlapCheck.ts`) jsou type-agnostické odjakživa — nový kód, který mění `startTime`/`endTime`/`machine` bloku libovolného typu, musí na konci transakce zavolat `assertNoOverlapForBlocks` se seznamem ID dotčených bloků. Reflow endpointy (`src/lib/reflow.server.ts`) tuto pojistku dřív nevolaly vůbec (reálný bug, opraven 16. 7. 2026) — nepřidávat žádnou novou mutační cestu bez ní. Detaily → `docs/vyvoj-historie.md`.

**Chain push (odsouvání navazujících bloků) platí pro VŠECHNY typy** — od 31. 7. 2026 si rezervace i údržba udělají místo stejně jako zakázka (dřív byly pevná zeď a drop se odmítl 409). Geometrie posunu se ale liší a je v jediném zdroji pravdy `chainPushGeometry` (`src/lib/overlapResolver.server.ts`), který volá jak push, tak jeho nezávislá pojistka:
- **ZAKAZKA** → tiskové hodiny: délka z `printMinutes`, re-expanze přes pauzy směn.
- **REZERVACE/UDRZBA** → rigidní interval: PŘESNÁ délka (žádné zaokrouhlení na 30 min, žádné roztažení), start přes `snapToNextValidStartWithTemplates` (týž helper, jaký používá ruční drag na klientovi), horizont posunu `MAX_RIGID_PUSH_MS` = 7 dní.

**Zdí (neposouvá se, drop se odmítne) zůstává:** zamčený blok · blok s potvrzeným tiskem · **rigidní blok, který na své současné pozici nevyhovuje kalendáři** (leží mimo pracovní dobu nebo v odstávce — typicky víkendová údržba či servis naplánovaný na celozávodní odstávku; posun by ho vystěhoval do výroby) · sourozenci z téže dávky v batchi (`frozenIds` — načtou se jako překážka, ale neposouvají se).

**Audit → každá mutace v `$transaction`** společně se zápisem do `AuditLog` (jinak nekonzistentní stav).

**Mouse handlery na blocích** začínají `if (e.button !== 0) return;` (jen levé tlačítko).

**Bezpečnostní ENV bez fallbacku**: `JWT_SECRET` chybí → `throw`, nikdy `?? "dev-secret"`.

**Split-skupiny**: členství dotazuj VÝHRADNĚ `where: { splitGroupId: X }`, NIKDY `id === splitGroupId` — `Block.id` a `SplitGroup.id` jsou nezávislé id-prostory. Split vzniká atomicky přes `POST /api/blocks/[id]/split`.

## Design tokens a vizuální konvence

- Barvy/rozměry **vždy přes CSS tokeny** z `src/app/globals.css`, **nikdy hex/rgba literál** v komponentě (rozbíjí light mode): `--bg`/`--text`/`--text-muted`, `--surface`/`--surface-2`/`--surface-3`, `--border`, `--ring`, `--brand`/`--brand-contrast`, `--danger`/`--success`/`--warning`/`--info`.
- **Z-index** výhradně přes `src/lib/zLayers.ts` (`Z_TIMELINE`/`Z_LAYOUT`/`Z_OVERLAY`), nikdy magické číslo.
- **Sdílené UI kameny** (`src/components/`, ne `ui/` — shadcn plošně nerozšiřujeme): `NativeSelect`, `PrimaryCta`, `ConfirmDialog`, `ModuleHeader`; admin tlačítka/inputy z `src/lib/uiStyles.ts`. Kdy co viz `docs/vyvoj-historie.md`.
- **Nové standalone komponenty** jako named export do `src/components/` — **NEpsat inline do velkých souborů** (PlannerPage/TimelineGrid byly záměrně dekomponovány). Než přidáš do souboru u limitu, nejdřív navrhni extrakci a ohlas rozhodnutí (ESLint `max-lines` warn hlídá).
- **Focus**: neodstraňovat viditelný focus ring; globální `:focus-visible` používá `--ring`.
- **Tailwind v4**: `@import "tailwindcss"`; dynamické třídy nepodporuje → inline style.
- **Clipboard**: vždy `copyTextToClipboard` (`src/lib/clipboardCopy.ts`), nikdy přímo `navigator.clipboard.*` (prod běží přes HTTP → crash).

## Klíčové soubory (index — detail čti v kódu)

**Sdílené jádro:** `src/lib/errors.ts` (AppError/errorStatus) · `authz.ts`+`auth.ts` (requireRole) · `logger.ts` · `scheduleValidationServer.ts` (validateAndComputeEnd) · `printTime.ts`/`printTime.server.ts`/`printTimeClient.ts` (tiskové hodiny) · `blockPayload.ts` (Block→POST payload, jediný zdroj) · `blockStyles.ts` · `machines.ts` · `zLayers.ts` · `dateUtils.ts` · `plannerTypes.ts` · `uiStyles.ts` · `reflow.server.ts` · `calendarDrift.server.ts` · `findConflictingBlocks.ts`.

**Planner:** `src/app/_components/PlannerPage.tsx` (orchestrátor ~2647 ř.) · `TimelineGrid.tsx` (~2355 ř.) · `src/components/planner/BlockCard.tsx` (render bloku) · `src/hooks/useJobBuilder.ts` + `src/components/planner/JobBuilderPanel.tsx` (builder) · `src/components/planner/ProductionTagsRow.tsx` (sdílený řádek výrobních štítků OBÁLKA/VNITŘKY + archy/série — BlockEdit i builder) · `ShutdownManager.tsx` · `ResizeHandle.tsx` · `src/components/BlockEdit.tsx`/`BlockDetail.tsx`/`NativeSelect.tsx`/`PrimaryCta.tsx`/`ModuleHeader.tsx`/`ConfirmDialog.tsx`.

**Admin:** `src/app/admin/_components/` — `AdminDashboard.tsx` (shell) + `UsersSection.tsx`/`CodebookSection.tsx`/`PresetSection.tsx` + `adminShared.ts`.

**Entry:** `src/app/page.tsx` · `rezervace/page.tsx` · `admin/page.tsx` · `report/daily/page.tsx`. **Auth:** `src/lib/auth.ts` · `src/middleware.ts`.

## Produkční DB — známé odchylky od migrací

Prod DB `igvyroba` měla historicky ručně vytvořené sloupce (opraveno 12. 4. 2026): `AuditLog.action` `varchar(16)`→`varchar(191)`; `Block.doprava` a `Block.expediceNote` doplněny jako `varchar(191) NULL`. Při deploy chybě `P2022`/`P2000` nejdřív ověřit skutečný typ sloupce v DB (`SHOW COLUMNS FROM <Tabulka>`).

## Dokumenty v repu

- `docs/vyvoj-historie.md` — souhrn featur + implementační reference (tiskové hodiny, split-skupiny B2, copy/paste, reporty, dekompozice fáze E) a historie etap
- `docs/DEPLOY_WORKFLOW.md` — deploy postup + prod gotchy
- `docs/OPS_ZALOHY.md` — provozní skripty (denní záloha DB+příloh, health-check à 15 min, CSV export) + restore postup; **NIKDY `git clean -x` v produkční složce** (smaže přílohy v gitignored `data/`)
- `docs/KIOSK_TERMINAL.md` — kioskový launcher u strojů (přepínač plán ↔ Logica); **pozor na `COOKIE_SECURE`** — na HTTP nasazení musí být `false`, jinak se nikdo nepřihlásí
- `docs/superpowers/plans/` — detailní plány jednotlivých etap
- `README.md` · `DOKUMENTACE.md` · `DATABAZE_DOKUMENTACE.md`
