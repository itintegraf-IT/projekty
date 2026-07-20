# Design: Audit uživatelů + audit přihlášení

Datum: 2026-07-20
Autor: Vojta (+ Claude)
Stav: schváleno k plánování

## Kontext a cíl

Ze zmapování vzešly dvě nezávislé věci k opravě/doplnění:

1. **Filtr audit logu nezobrazuje všechny uživatele.** Nabídka jmen ve filtru „Uživatelé" se skládá z `distinct username` nad tabulkou `AuditLog`, takže obsahuje jen lidi, kteří už někdy něco změnili. Kdo se jen dívá (VIEWER, TISKAR, OBCHODNIK) nebo je čerstvě založený, ve filtru chybí.
2. **Přihlášení se nikam nezaznamenává.** Login jen ověří heslo a nastaví JWT cookie — v DB nezůstane žádná stopa. Nejde zjistit „kdo se kolikrát přihlásil".

Tento dokument obojí řeší. Části jsou nezávislé; realizace probíhá ve 4 etapách s commit-checkpointy.

## Rozhodnutí (z brainstormingu)

- Filtr auditu: **celý seznam uživatelů**, neaktivní zašedlí + odznak role.
- Přihlášení: logovat **úspěšné i neúspěšné** pokusy.
- Rozsah záznamu přihlášení: **kdo, kdy, výsledek, IP** (+ důvod selhání).
- Reporty: **ano, jedno KPI** přihlášení v Retrospektivě; plný detail v Adminu.
- `LoginLog` **bez FK relace** na `User` (zachovat historii i po smazání účtu; obchází past `INT UNSIGNED` FK na produkci).

## Non-goals

- Neřešíme session store v DB ani „kdo je právě přihlášen" (session zůstává JWT cookie).
- Neukládáme `userAgent`.
- Nelogujeme rate-limited (429) pokusy — je to IP throttle bez známého jména.
- Neřešíme retenci/mazání `LoginLog` (tabulka roste; případný cleanup je budoucí práce).
- Žádný refaktor nesouvisejících částí.

---

## Část 1 — Oprava filtru audit logu

### Server: `GET /api/audit/filters`

Dnes vrací `{ usernames: string[]; actions: string[] }`. Nově:

```ts
{
  users: { username: string; role: string | null; hasActivity: boolean }[];
  actions: string[];
}
```

Skládání `users`:
- Načti všechny `User` (`select: { username, role }`).
- Načti `distinct username` z `AuditLog` → množina `activeSet`.
- Pro každého `User`: `hasActivity = activeSet.has(username)`.
- Doplň jména z `activeSet`, která nejsou v `User` (smazané účty) → `role: null`, `hasActivity: true`.
- Řazení: nejdřív `hasActivity === true`, pak `false`; v rámci skupiny abecedně podle `username`.

`actions` beze změny. Cache (60 s) i `FACET_HARD_CAP` zůstávají — seznam uživatelů je malý, cap se prakticky neuplatní.

### Frontend: `AuditLogPanel.tsx`

- `AuditFacets`: `usernames: string[]` → `users: { username: string; role: string | null; hasActivity: boolean }[]`.
- `UserChips` dostane bohatší položky. Render:
  - aktivní uživatel = plný chip (jako dnes),
  - neaktivní = zašedlý chip (nižší opacity, přerušovaný okraj) + malý odznak role.
- Výběr a odesílání filtru se **nemění** — pořád se posílá `username`. Zašedlý uživatel je vybratelný; výsledek prostě bude prázdný (informativní).
- `/api/audit` (výpis logů) se **nemění**.

---

## Část 2 — Audit přihlášení

### DB: nový model `LoginLog`

```prisma
model LoginLog {
  id            Int      @id @default(autoincrement())
  userId        Int?     // null pro neznámé uživatelské jméno
  username      String
  success       Boolean
  failureReason String?  // např. "INVALID_CREDENTIALS"
  ipAddress     String?
  createdAt     DateTime @default(now())

  @@index([userId, createdAt])
  @@index([username, createdAt])
  @@index([createdAt])
}
```

Bez relace na `User`. Migrace přes `npx prisma migrate dev` (dev). Na produkci `npx prisma migrate deploy` s předchozím `mysqldump` (řídí Vojta; produkci se v této práci nedotýkáme).

### Login endpoint: `POST /api/auth/login`

Po vyhodnocení přihlášení zapiš `LoginLog`:
- **Úspěch:** `{ userId: user.id, username, success: true, ipAddress: ip }`.
- **Špatné údaje** (uživatel nenalezen NEBO špatné heslo): `{ userId: user?.id ?? null, username: u, success: false, failureReason: "INVALID_CREDENTIALS", ipAddress: ip }`.

Zápis obal do `try/catch` — **selhání logu nesmí nikdy zablokovat ani rozbít přihlášení** (na chybu jen `logger.error`). IP se čte přes existující `getClientIp(req)`. Rate-limited větev (429, před parsováním těla) se neloguje.

### Admin: nová záložka „Přihlášení"

Endpoint `GET /api/admin/login-log` (`requireRole(["ADMIN"])`, `AppError`/`errorStatus` konvence, `logger`):

```ts
{
  summary: {
    loginsToday: number;
    loginsWeek: number;
    activeUsersWeek: number;   // distinct userId s úspěchem za 7 dní
    failed7d: number;
    neverLoggedIn: number;     // počet User bez úspěšného LoginLogu
  };
  users: {
    userId: number | null;
    username: string;
    role: string | null;
    count30d: number;          // úspěšná přihlášení za 30 dní
    lastLoginAt: string | null;
    failed30d: number;
  }[];
}
```

Výpočet: `prisma.loginLog.groupBy`/agregace + join na `User` (v paměti; uživatelů je málo). „Nikdy nepřihlášen" = `User` bez úspěšného `LoginLog`.

Komponenta `src/components/admin/LoginLogPanel.tsx`:
- KPI karty (přihlášení dnes / týden / neúspěšné 7 dní / nikdy nepřihlášen),
- tabulka po uživatelích (role, počet 30 dní, poslední přihlášení, neúspěchy) — dle vizuálního náhledu sekce 02.

Zapojení do `AdminDashboard.tsx`: nový tab `"logins"` s labelem „Přihlášení", viditelný jen pro ADMIN (ne PLANOVAT), po vzoru tabu `"audit"`.

### Reporty: jedno KPI

`GET /api/report/dashboard` (retro větev) rozšířit o:
```ts
logins: { periodCount: number; activeUsers: number }
```
vázané na zvolené období (`rangeStart`–`rangeEnd`, jen `success: true`). V `RetroView` přibude jedna `KpiCard` (např. „Přihlášení za období" + podtitulek s počtem aktivních uživatelů) do sekce PLÁNOVÁNÍ/Aktivita.

---

## Realizace ve 4 etapách (commit po každé, stop na OK)

1. **Filtr auditu** — `/api/audit/filters` + `AuditLogPanel`/`UserChips`.
2. **LoginLog + logování** — Prisma model + migrace + login route.
3. **Admin záložka Přihlášení** — `/api/admin/login-log` + `LoginLogPanel` + tab.
4. **KPI v Reportech** — rozšíření dashboard API + `RetroView`.

## Testy / ověření

- Po každé etapě: `npm run build` (0 TS chyb) + relevantní testy (`node --test`).
- Serverová health/schedule logika se nemění.
- Ruční ověření: filtr ukáže i neaktivní uživatele; přihlášení vytvoří řádek v `LoginLog`; admin přehled a KPI sedí.

## Dotčené soubory

**Část 1:** `src/app/api/audit/filters/route.ts`, `src/components/admin/AuditLogPanel.tsx`.
**Část 2:** `prisma/schema.prisma` (+ migrace), `src/app/api/auth/login/route.ts`, nový `src/app/api/admin/login-log/route.ts`, nový `src/components/admin/LoginLogPanel.tsx`, `src/app/admin/_components/AdminDashboard.tsx`, `src/app/api/report/dashboard/route.ts`, `src/app/reporty/_components/ReportDashboard.tsx` (RetroView KPI).
