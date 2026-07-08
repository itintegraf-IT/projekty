# LESSONS — průběžný log zjištění o codebase (audit)

> Jedno zjištění = jeden řádek. Slouží ke konzistenci auditu napříč subagenty.
> Píše se pro AI (Opus 4.8), která bude podle findings opravovat. Zjištění zde NEJSOU findings — jsou to fakta o codebase.

## Stack & runtime
- Next.js 16.1.6 (App Router), React 18.3.1, TypeScript 5.9.3, Prisma 5.22.0 + `@prisma/client` 5.22.0, MySQL, Node 24.13.1.
- Auth = `jose` 6.2.1 (JWT HS256) + `bcryptjs` 3.0.3. UI = Tailwind v4 + shadcn/Radix.
- Rozsah: ~41 600 ř. TS/TSX, 43 API route.ts, 49 lib modulů, 38 komponent, 28 test souborů, 36 migrací.
- `package.json`: `next`/`react`/`typescript`/`eslint`/`tailwindcss`/`@types/node`/`@types/react` jsou pinnuté na `"latest"` → nereprodukovatelný build.

## Konfigurace & prostředí
- `.env` NENÍ a nikdy nebyl v gitu (ověřeno `git log --all -- .env` = prázdné). `.gitignore` ho pokrývá.
- Dev DB: MySQL běží na `localhost:3306`, databáze v `.env` je `IGvyroba` (velké I,G,V) — pozor, produkce je `igvyroba` (lowercase, viz paměť).
- `mysql` CLI NENÍ na dev stroji nainstalováno (ani v AMPPS) — DB sonda jen přes Prisma `$queryRaw`.
- Prod běží přes PM2 (`ecosystem.config.cjs`), port 3020, `NODE_ENV=production`.
- `next.config.mjs`: `serverActions.bodySizeLimit = 11mb`, žádné security headers (CSP/HSTS/X-Frame-Options).

## Auth & autorizace (kritická oblast)
- `src/middleware.ts` gate-uje jen PODMNOŽINU cest: `/reporty`+`/api/report/dashboard` (ADMIN), `/rezervace`+`/api/reservations` (ADMIN/PLANOVAT/OBCHODNIK), TISKAR/OBCHODNIK page redirecty.
- Middleware NEGATUJE `/admin` pro DTP/MTZ/VIEWER (blokuje jen OBCHODNIK, TISKAR) a NEGATUJE většinu mutačních API (`/api/blocks*`, `/api/admin/users*`, `/api/codebook*`, `/api/job-presets*`, `/api/machine-week-shifts`, `/api/printers*`, `/api/company-days*`, `/api/shift-assignments*`, `/api/notifications*`, `/api/blocks/*/notes`) → autorizaci MUSÍ vynucovat každý handler sám. Ověřit route po route.
- `src/middleware.ts:27` volá `jwtVerify` bez `{ algorithms: ["HS256"] }` (stejně `src/lib/auth.ts:78`) — algorithm-confusion hardening chybí.
- `src/lib/auth.ts:81` používá `console.error` místo `logger` (proti vlastnímu standardu z CLAUDE.md).
- `src/app/api/auth/login/route.ts:46` — `!user || !(await bcrypt.compare(...))` short-circuit → user-enumeration timing oracle (bcrypt jen když user existuje).
- Cookie secure = `NODE_ENV === production`; prod ale běží po HTTP (LAN) → buď je před tím TLS proxy, nebo login cookie po HTTP neprojde. Ověřit reálný deployment.

## Závislosti (npm audit)
- 15 zranitelností (0 critical / 7 high / 6 moderate / 2 low).
- Produkčně relevantní: `next@16.1.6` → fix 16.2.10 (high: middleware/proxy bypass CVSS 8.1 & 7.5, SSRF 8.6). Middleware bypass je relevantní, protože část authz stojí na middleware.
- Zbytek (hono, @hono/node-server, express-rate-limit, ip-address, fast-uri, flatted, path-to-regexp, picomatch, js-yaml, qs, esbuild, @babel/core, brace-expansion) je DEV-only: táhne `shadcn` (devDep) → `@modelcontextprotocol/sdk`, resp. eslint/ts-morph. Nejde do produkčního bundle.

## Dead code / relikty
- `src/App.jsx` — Vite/CRA relikt, nepatří do Next App Routeru.
- SQLite pozůstatky: `prisma/dev.db`, `better-sqlite3` (devDep), `@types/better-sqlite3`, `prisma/vojta-export.sql`, `prisma/export-to-mysql.*`.
- `scripts/` obsahuje řadu one-off diagnostických SQL/TS skriptů (check-overlaps, diagnose-*, fix-existing-overlaps).

## Datový model
- 18 modelů. `Block` = jádro (~50 polí). `Block.orderNumber` NEMÁ index (EXPLAIN `type: ALL`), ALE **žádný dotaz podle `Block.orderNumber` nefiltruje** (ověřeno gremem — full scan je hypotetický). Skutečné hledání dle orderNumber běží nad `AuditLog.orderNumber` přes `contains` = leading-wildcard LIKE, kterému by index stejně nepomohl. → index na Block.orderNumber NEPŘIDÁVAT.
- Transakční disciplína VÝBORNÁ: každá mutace bloku + AuditLog běží v `$transaction`. Prisma singleton (src/lib/prisma.ts) správně. Hot dotazy (report/dashboard, expedice) batchované přes Promise.all + select.
- Objem dat malý: Block 204, AuditLog 965, MachineWeekShifts 1470, Notification 54, User 8, Reservation 16 → perf nálezy mají dnes nízký dopad, řádí při 10-100× růstu.
- Prod odchylky z CLAUDE.md potvrzené v živé DB: AuditLog.action=varchar(191) ✓, Block.doprava/expediceNote=varchar(191) NULL ✓. Žádná další schema drift.
- Build PROŠEL (exit 0). Lint: 0 errors, 31 warnings (img, anchor-vs-Link, 1 exhaustive-deps, anon default export). Testy: 366/366 zelené (1,25 s).
- Middleware VYŽADUJE platnou session cookie pro VŠECHNY matchnuté cesty (redirect /login bez cookie) → neautentizovaný přístup k API je blokován; "GET /api/codebook bez getSession" = čte jen libovolná PŘIHLÁŠENÁ role, ne anonym.
- Legacy: `MachineWorkHours` (nahrazeno `MachineWeekShifts`, drženo kvůli bootstrapu). `ExpeditionZavoz` — možná nepoužité.

## Testy
- 28 test souborů, hlavně čisté lib funkce (printTime, reflow, overlap, schedule validation…). Auth/authz route handlery jsou POTVRZENĚ netestované (auth.ts, middleware.ts, rateLimiter.ts, route handlery). Jediná authz v čisté funkci = blockNotePermissions.ts (a JE testovaná — vzor hodný následování).

## Korekce a zjištění z nezávislého ověření (3 verifikátoři, čistý kontext)
- **NEJDŮLEŽITĚJŠÍ:** dvě obranné vrstvy jsou naprogramované, ale OBĚ neaktivní — optimistic locking (server umí `expectedUpdatedAt`, klient neposílá) + SSE `session-expired` (klient poslouchá, server neemituje). Falešný pocit bezpečí.
- codebook GET spor ROZŘEŠEN: middleware neautentizovaný přístup BLOKUJE (redirect /login) → GET /api/codebook čte jen libovolná PŘIHLÁŠENÁ role, NENÍ anonymní leak. QUAL agent to nadhodnotil. Severita P3 (defense-in-depth).
- serializeReservation leak je ŠIRŠÍ, než první agent tvrdil: netýká se jen GET [id], ale i list-GET a VŠECH PATCH odpovědí (reservations/[id]/route.ts:119,159,186,229,283,325,365). Oprava musí být v serializační vrstvě (role-aware).
- Typ Block (TimelineGrid.tsx:79) importuje i LIB kód: src/lib/pasteTarget.ts:1 a src/lib/splitHelpers.ts:1 → obrácená závislost lib→komponenta (horší inverze). ReportView.tsx:11 má navíc VLASTNÍ duplicitní `interface Block`.
- Korekce čísel: TimelineGrid má 13 fetch (ne 9); expedition route 11× throw new Error (ne 12); package.json má 12× "latest" pin (ne 11 — chyběl eslint-config-next). PlannerPage 4359 ř./84 useState/48 fetch potvrzeno.
- assertNoOverlapForBlocks (overlapCheck.ts:92-100) používá raw SELECT ... FOR UPDATE (gap-lock) → souběh blok×blok je tvrdě serializován. ALE shift-edit×block-insert (assertNoConflictingBlocks) je jen findMany bez zámku → měkký, self-heal přes drift. Asymetrie záruk.
- Nový nález: validateMagicBytes (attachments/route.ts) očekává u application/msword a application/vnd.ms-excel prefix "PK" (ZIP), ale staré binární .doc/.xls mají OLE2 signaturu D0 CF 11 E0 → false-negative na legitimních + ZIP přejmenovaný na .doc projde.
- Audit bezpečnostních událostí: KOREKCE — "nikam se nelogují" je příliš silné; admin/users mají logger.error v CATCH větvích (error-path). Přesná kritika: chybí SUCCESS-PATH audit (login success/fail, logout, kdo změnil roli/heslo).
- .env NENÍ v gitu (verifikátorova obava vyvrácena — git log --all -- .env prázdné, potvrzeno již v mapování).
- Transakční pozitivum POTVRZENO: POST /api/blocks obaluje create+auditLog v $transaction + finální assertNoOverlapForBlocks.

## Finální dokumenty auditu
- 00-SUMMARY.md (rozhodnutí), 01-FINDINGS.md (79 dedup nálezů, 0 potvrzených P0/15 P1/30 P2/31 P3), 02-FIX-PLAN.md (5 waves), LESSONS.md (tento).
- 4 OTEVŘENÉ OTÁZKY pro Vojtu (deployment TLS proxy? prod účty admin/admin? GDPR proces? connection_limit?) — blokují finální severitu 3 nálezů. Bez přístupu na prod DB nelze ověřit z tohoto stroje.
