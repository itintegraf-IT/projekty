# 02 — FIX PLAN (plán oprav)

> Sekvenční plán oprav nálezů z [01-FINDINGS.md](01-FINDINGS.md), seřazený dle priority a závislostí.
> **Určeno pro AI (Opus 4.8), která bude opravovat.** Detail každé opravy (umístění, důkaz, konkrétní postup) je v [01-FINDINGS.md] pod odpovídajícím ID — tento dokument říká **v jakém pořadí, co s čím dělat a na co si dát pozor**.

## Guardrails (dodržet při každé opravě — z paměti projektu)
- **Pracuj JEN na větvi `Vojta`.** Nepřepínej na `michal` (merge + deploy řeší Vojta sám).
- **Commit per etapa/nález až po schválení Vojtou.** Ne dávkovat víc nálezů do jednoho commitu bez souhlasu.
- **Před každým zásahem na PRODUKCI vždy `mysqldump` záloha jako PRVNÍ krok** (týká se migrací [PERF-006], [REDU-010] drop, oprav prod účtů). Žádné výjimky.
- **NIKDY nespouštět `prisma:seed` na produkci** (maže data). NIKDY `prisma db pull` / `prisma format` (přejmenuje relace, rozbije kód).
- Po každé změně `npm run build` + relevantní testy lokálně PŘED pushem. Cílem je držet **366/366 zelených** a build čistý.
- Standardy nového kódu: `AppError`/`isAppError`, `logger` místo `console`, `validateAndComputeEnd` pro ZAKAZKA bloky, audit v `$transaction`, `e.button !== 0` guard, žádné fallbacky pro bezpečnostní ENV. (viz CLAUDE.md „Coding standards")

---

## WAVE 0 — Nejdřív zodpovědět (blokuje severitu, nulová pracnost kódu)

Tohle nejsou opravy, ale **rozhodovací vstupy od Vojty/Michala** — bez nich nelze správně prioritizovat. Udělat PRVNÍ.

| # | Otázka | Ověření | Odemyká |
|---|---|---|---|
| 0a | Běží před `192.168.10.210:3020` TLS reverse proxy? | `curl -sI http://192.168.10.210:3020/` + `ls /etc/nginx/sites-enabled/` | [SEC-001], [STAB-001] severita (P0 vs P2) |
| 0b | Má prod DB účty `admin/admin` / bootstrap `ChangeMe123!`? | `SELECT username FROM User` na prod + test loginu | [SEC-008], [SEC-009] (P0 vs P2) |
| 0c | Má prod `DATABASE_URL` `connection_limit`? | `grep connection_limit .env` na serveru | [PERF-005] |
| 0d | Existuje GDPR retenční/výmazový proces? | organizační | [SEC-016], [PERF-007] scope |

**Pokud 0a = žádná proxy** → [SEC-001] je P0, řešit jako první věc ve Wave 1 (změnit derivaci `secure`). **Pokud 0b = ano** → okamžitě změnit hesla na produkci (s PRE zálohou), pak řešit [SEC-008]/[SEC-009] v kódu.

---

## WAVE 1 — Quick wins (S pracnost · nízké riziko · vysoká hodnota)

Malé, izolované opravy s velkým poměrem hodnota/riziko. Lze dávkovat po logických skupinách. **Doporučené pořadí:**

1. **[DEP-001] Bump `next` → 16.2.10** + **[DEP-002] přišpendlit 12 `"latest"` pinů** (jeden commit). Po bumpu `npm install` + `npm run build` + **manuální smoke test loginu a role-gated cest** (middleware bypass CVE). Zavírá i postcss XSS. *Riziko: střední (minor bump) — proto smoke test.*
2. **[SEC-010] Přidat `{ algorithms: ["HS256"] }`** do `jwtVerify` v `middleware.ts:27` + `auth.ts:78`. *Triviální.*
3. **[QUAL-002] `console.error` → `logger.warn`** v `auth.ts:81`. *Triviální.*
4. **[SEC-004] Statické security headers** (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`) přes `async headers()` v `next.config.mjs`. (HSTS jen pokud 0a = proxy.) Řeší i [SEC-011] nosniff pro přílohy. *CSP odložit do Wave 3 — report-only.*
5. **[OBS-001] Health endpointy** `GET /api/health` + `/api/health/ready` (`SELECT 1`).
6. **[SEC-005] Rate-limit** na `POST /api/reservations`, upload příloh, `admin/users` mutace (per `session.id`).
7. **[SEC-006] Rate-limit IP zdroj** — v single-instance použít socket IP místo `X-Forwarded-For` (závisí na 0a). Zvážit per-username limit.
8. **[STAB-005] `prisma.jobPreset` → `tx.jobPreset`** v `blocks/[id]/route.ts:324`. *Triviální.*
9. **[STAB-006] Log do `.catch`** rollbacku přílohy (`attachments/route.ts:177`).
10. **[OBS-006] Log SSE `enqueue` chyby** (`events/route.ts:157,180`).
11. **[SEC-017] OLE2 signatura** pro staré `.doc/.xls` v `validateMagicBytes`.
12. **Dead code úklid** (jeden commit): [REDU-009] `App.jsx`, [REDU-012] `events-test/`, [DEP-005] `better-sqlite3` + SQLite relikty, [QUAL-003] TODO komentář. *(Pozor: [REDU-010] `ExpeditionZavoz` NE — vyžaduje migraci + prod ověření, viz Wave 4.)*
13. **[SEC-012] `getSession()` guard** do `GET /api/codebook`. **[SEC-014]** validace `targetUserId`. **[SEC-015]** whitelist `/admin` v middleware.
14. **[DEP-003]/[DEP-004] Odebrat** `date-fns` (po peer-checku `npm ls date-fns`) a `tailwindcss-animate`.

---

## WAVE 2 — P1 substantivní (S–M pracnost · vyžaduje pozornost)

Řešit po Wave 1. Každý svůj commit (schválení Vojty).

1. **[STAB-001] Oživit nebo odstranit `session-expired`** — buď periodická re-verifikace session v heartbeatu + emit, nebo odstranit mrtvý listener. *Rozhodnout s Vojtou který směr.*
2. **[STAB-002] Optimistic locking** — klient posílat `expectedUpdatedAt` + UI handling 409 (toast „obnov"). *Pozor: bez ošetření 409 by drag „náhodně" selhával. Alternativa: odstranit dormantní serverový kód, pokud se vědomě volí last-write-wins.*
3. **[OBS-002] Audit bezpečnostních událostí** — login success/fail, logout, `admin/users` mutace do `AuditLog` (v `$transaction`). *Souvisí s [ARCH-005] — udělat konzistentně.*
4. **[QUAL-001] Expedition route → `AppError`** — nahradit 11× `throw new Error("PREFIX")` + přepsat catch na `isAppError`. *Riziko střední: projít všechny stavy publish/unpublish/reorder, je to produkční `/expedice`.*
5. **[SEC-002] CSRF** — origin/referer check v middleware pro mutační metody (levnější než token). *Pozor na klienty za proxy.*
6. **[SEC-003] JWT revokace** — buď kratší expirace + refresh, nebo `tokenVersion` v DB. *Riziko střední: mění auth cestu — nutné testy (koordinovat s [TEST-001]).*
7. **[OBS-004] Global error boundary** `global-error.tsx` + `instrumentation.ts` (`unhandledRejection`).

---

## WAVE 3 — Testy auth vrstvy + P2 kvalita/konzistence

Doplnit paralelně s Wave 2 (testy sníží riziko oprav výše). **[TEST-009] je klíč — dělat před [TEST-002]/[TEST-003].**

1. **[TEST-009] → [TEST-002]** Vytáhnout role field-filter z `blocks/[id]/route.ts:83-123` do čisté funkce `src/lib/filterEditableFields(role, body)` (vzor `blockNotePermissions.ts`) + test. *Odemyká testovatelnost; koordinovat s [ARCH-007].*
2. **[TEST-001]** `auth.test.ts` (JWT round-trip, `parseJwtPayload`, `getCookieOptions`). *Udělat spolu se [SEC-003].*
3. **[TEST-005]** `rateLimiter.test.ts`. **[TEST-004]** login flow integrační test. **[TEST-003]** route authz/IDOR integrační testy (per role × cesta). **[TEST-006]** middleware. **[TEST-007]** serializace (timezone).
4. **[SEC-007] Role-aware serializace rezervací** — `serializeReservation(reservation, viewerRole)` s whitelistem; pro OBCHODNIK vypustit `plannerDecisionReason`/`planningPayload`/…. *Jedno místo pokryje list-GET i všechny PATCH. Ověřit, že `RezervacePage.tsx` na pole nespoléhá.*
5. **[SEC-009] Password policy** — min. délka ≥ 10–12 v POST i PUT admin/users; bootstrap náhodné heslo; bcrypt cost 12.
6. **[ARCH-004] `withApiHandler` wrapper** + postupná migrace 27 rout bez `AppError`.
7. **[ARCH-005] Dorovnat audit** u reservations/users/codebook/presets/company-days (v `$transaction`).
8. **[ARCH-006] Reservation stavový automat** → `src/lib/reservationStateMachine.ts` (čistá funkce + test).
9. **[SEC-013] Omezit seedující GET** week-shifts na ADMIN/PLANOVAT (nebo seed mimo GET).
10. **CSP** ([SEC-004] pokračování) — nasadit `Content-Security-Policy-Report-Only`, doladit kvůli Next inline scriptům, pak enforce.

---

## WAVE 4 — P2 výkon (pro růst) + P3 dekompozice a úklid

Neblokuje go-live. Řešit průběžně po nasazení.

**Výkon (než data narostou 10–100×):**
- [PERF-001] Omezit `GET /api/blocks` časovým oknem + `select`. *(nejdůležitější — nejfrekventovanější read)*
- [PERF-003] Preload kalendáře v batch (vzor `preloadedCalendar`).
- [PERF-002] Index `(endTime, startTime)` pro dashboard range.
- [PERF-007] Retence AuditLog/Notification (+ [SEC-016] GDPR). [PERF-004] závisí na tomto.
- [PERF-005] Fail-fast na chybějící `connection_limit` v produkci.
- [PERF-006] Runbook: obnova ze starého dumpu vyžaduje `migrate-to-week-shifts.ts`.

**Dekompozice god-components (velké, riziková — samostatné commity, screenshot check UI):**
- [ARCH-003]/[REDU-004] `TimelineGrid`: vyjmout typ `Block` do lib + czechHolidays/InlineDatePicker/chipy.
- [ARCH-001] Vyzvednout mutace z `TimelineGrid` do `blockMutations.ts` / callback-props.
- [ARCH-002]/[REDU-003] `PlannerPage`: extrahovat do hooků (`usePasteBlocks`, `usePlannerSSE`, `useBlockNotes`, …).
- [ARCH-007] `blocks/[id]` PUT jádro → `blockUpdate.server.ts` sdílené s POST/batch.

**Redundance a úklid:**
- [REDU-001]+[ARCH-008] `src/lib/roles.ts` (Edge-safe) + `requireRole` helper → nahradit 38× inline role-list.
- [REDU-002] Import `MACHINES` do 3 komponent.
- [REDU-005] Sjednotit Prague date formatery do `dateUtils.ts`.
- [REDU-006] `BLOCK_SSE_INCLUDE` + `refetchAndBroadcastShifted` helper.
- [REDU-007] `AdminDashboard` sekce do souborů. [REDU-008] sdílený `MonthGrid`. [REDU-011] `BlockEdit` sub-formuláře.
- [REDU-010] `ExpeditionZavoz` — **až po ověření prod dat** (drop migrace + PRE záloha).
- [ARCH-009] Centralizovat kontrakt SSE eventů u `eventBus.ts`.
- Zbývající P3 observabilita: [OBS-003] PM2 restart/rotace, [OBS-005] username retence, [OBS-007] logger redaction.
- Zbývající P3: [SEC-011] (řeší [SEC-004]), [PERF-008/009/010], [STAB-003] atomický split endpoint, [STAB-004] (ponechat, self-heal), [STAB-007], [TEST-008].

---

## Graf klíčových závislostí (co dělat před čím)

```
0a (proxy?) ─────► SEC-001 (secure cookie derivace)
0b (prod účty?) ─► SEC-008/009 (změna hesel na prod PRVNÍ)

DEP-001 (next bump) ─── dělat s ──► DEP-002 (piny)

TEST-009 (authz do lib) ─► TEST-002 (field-filter test) ─► TEST-003 (route testy)
        │
        └──────────────────────► ARCH-008 (requireRole) ◄── REDU-001 (roles.ts)

SEC-003 (JWT revokace) ─── dělat s ──► TEST-001 (auth testy)

ARCH-005 (audit konzistence) ═══ stejná práce ═══ OBS-002 (audit bezpečnostních událostí)

ARCH-007 (blockUpdate.server) ─── uvolní ──► TEST-002 (čistší field-filter)

SEC-004 (headers) ─── zahrnuje ──► SEC-011 (nosniff přílohy)

PERF-007 (retence) ─── zmírní ──► PERF-004 (orderNumber LIKE)
```

## Doporučené pořadí realizace (shrnutí)

1. **Wave 0** — zodpovědět 4 otázky (Vojta/Michal). Pokud 0a/0b odhalí P0, řešit okamžitě.
2. **Wave 1** — quick wins (bump next, headers, health, rate-limit, dormant-fix triviality, dead code). ~1 pracovní blok, většina S.
3. **Wave 2** — P1 substantivní (dormantní obrany, expedition AppError, audit událostí, CSRF, JWT).
4. **Wave 3** — testy auth vrstvy (kritické pro bezpečné budoucí opravy) + P2 konzistence + role-aware serializace.
5. **Wave 4** — výkon pro růst + dekompozice god-components + redundance (průběžně po nasazení).

## Odhad pracnosti (hrubý)

| Wave | Nálezy | Převažující pracnost |
|---|---|---|
| 1 (quick wins) | ~14 | S (pár M) |
| 2 (P1 substantivní) | ~7 | S–M |
| 3 (testy + P2) | ~15 | S–M (M testy) |
| 4 (perf + dekompozice + P3) | ~40 | M–L (dekompozice L) |

**Kritická cesta k „bezpečnému go-live":** Wave 0 + Wave 1 + body 1–4 z Wave 2 + [TEST-001/009] z Wave 3. Zbytek je udržitelnost a lze řešit iterativně po nasazení.
