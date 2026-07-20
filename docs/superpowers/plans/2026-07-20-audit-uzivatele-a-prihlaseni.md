# Audit uživatelů + audit přihlášení — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opravit filtr audit logu, aby nabízel všechny uživatele (ne jen ty s aktivitou), a přidat audit přihlášení (tabulka `LoginLog` + přehled v Adminu + KPI v Reportech).

**Architecture:** Čistá agregační logika do `src/lib/` (unit-testovaná node:test + tsx), tenké API routy nad ní, React komponenty čistě prezentační. Filtr auditu vrací bohatší tvar `users[]`. Přihlášení se zapisuje z login endpointu do nové tabulky bez FK relace na `User`.

**Tech Stack:** Next.js 16 (App Router), React, TypeScript, Prisma 5, MySQL, node:test + tsx.

## Global Constraints

- Chyby v API routes → vždy `AppError` (`src/lib/errors.ts`) + `errorStatus`; nikdy string-prefix Error.
- Auth v nových API routes → `requireRole([...])` (`src/lib/auth.ts`) UVNITŘ try.
- Logování → vždy `logger` (`src/lib/logger.ts`), nikdy `console.*`.
- Barvy/rozměry → CSS tokeny z `globals.css`, nikdy hex/rgba literál v komponentě (light mode). Výjimka: existující soubory už mají lokální literály (IOS_BLUE v AuditLogPanel) — držet se jejich zavedeného vzoru.
- Datum na serveru → `pragueToUTC` / `addDaysToCivilDate` / `todayPragueDateStr` z `src/lib/dateUtils.ts`; nikdy `getFullYear/Month/Date`.
- Prisma relace NIKDY neformátovat `prisma db pull`/`format`.
- Po každé etapě: `npm run build` (0 TS chyb) + `node --test`. **Stop na OK uživatele po každé etapě.**
- Pracovat jen na větvi Vojta.
- Migrace pouze `npx prisma migrate dev` (dev). Produkce mimo rozsah této práce.

---

## ETAPA 1 — Filtr auditu (všichni uživatelé)

### Task 1.1: Čistá funkce `buildUserFacets`

**Files:**
- Create: `src/lib/auditFacets.ts`
- Test: `src/lib/auditFacets.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface UserFacet { username: string; role: string | null; hasActivity: boolean; }
  export function buildUserFacets(
    users: { username: string; role: string }[],
    activeUsernames: string[],
  ): UserFacet[]
  ```
  Řazení: `hasActivity === true` první, pak `false`; v rámci skupiny abecedně (`localeCompare` cs).

- [ ] **Step 1: Napiš failing test**

```ts
// src/lib/auditFacets.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUserFacets } from "./auditFacets";

test("buildUserFacets: aktivní uživatelé mají hasActivity=true", () => {
  const out = buildUserFacets(
    [{ username: "vojta", role: "ADMIN" }, { username: "nahled", role: "VIEWER" }],
    ["vojta"],
  );
  const vojta = out.find((u) => u.username === "vojta");
  const nahled = out.find((u) => u.username === "nahled");
  assert.equal(vojta?.hasActivity, true);
  assert.equal(nahled?.hasActivity, false);
  assert.equal(vojta?.role, "ADMIN");
});

test("buildUserFacets: smazaný účet z auditu je doplněn s role=null", () => {
  const out = buildUserFacets(
    [{ username: "vojta", role: "ADMIN" }],
    ["vojta", "byvaly_planovac"],
  );
  const deleted = out.find((u) => u.username === "byvaly_planovac");
  assert.ok(deleted, "smazaný účet musí být v seznamu");
  assert.equal(deleted?.role, null);
  assert.equal(deleted?.hasActivity, true);
});

test("buildUserFacets: aktivní řazeni před neaktivní, uvnitř abecedně", () => {
  const out = buildUserFacets(
    [
      { username: "zdenka", role: "DTP" },   // neaktivní
      { username: "bara", role: "MTZ" },     // aktivní
      { username: "adam", role: "VIEWER" },  // neaktivní
    ],
    ["bara"],
  );
  assert.deepEqual(out.map((u) => u.username), ["bara", "adam", "zdenka"]);
});

test("buildUserFacets: prázdný vstup vrací prázdné pole", () => {
  assert.deepEqual(buildUserFacets([], []), []);
});
```

- [ ] **Step 2: Spusť test — musí selhat**

Run: `node --test --import tsx src/lib/auditFacets.test.ts`
Expected: FAIL — `Cannot find module './auditFacets'`.

- [ ] **Step 3: Napiš implementaci**

```ts
// src/lib/auditFacets.ts
export interface UserFacet {
  username: string;
  role: string | null;
  hasActivity: boolean;
}

/**
 * Poskládá nabídku filtru „Uživatelé" pro audit log: všichni uživatelé
 * z tabulky User (s příznakem, zda mají auditní stopu) + jména z auditu,
 * která už v User nejsou (smazané účty, role=null).
 */
export function buildUserFacets(
  users: { username: string; role: string }[],
  activeUsernames: string[],
): UserFacet[] {
  const activeSet = new Set(activeUsernames);
  const known = new Set(users.map((u) => u.username));

  const facets: UserFacet[] = users.map((u) => ({
    username: u.username,
    role: u.role,
    hasActivity: activeSet.has(u.username),
  }));

  for (const name of activeUsernames) {
    if (!known.has(name)) {
      facets.push({ username: name, role: null, hasActivity: true });
    }
  }

  return facets.sort((a, b) => {
    if (a.hasActivity !== b.hasActivity) return a.hasActivity ? -1 : 1;
    return a.username.localeCompare(b.username, "cs");
  });
}
```

- [ ] **Step 4: Spusť test — musí projít**

Run: `node --test --import tsx src/lib/auditFacets.test.ts`
Expected: PASS (4 testy).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auditFacets.ts src/lib/auditFacets.test.ts
git commit -m "feat(audit): buildUserFacets — filtr auditu z celého seznamu uživatelů"
```

### Task 1.2: Napojení do filter API + AuditLogPanel

**Files:**
- Modify: `src/app/api/audit/filters/route.ts`
- Modify: `src/components/admin/AuditLogPanel.tsx`

**Interfaces:**
- Consumes: `buildUserFacets`, `UserFacet` z Tasku 1.1.
- Produces: `GET /api/audit/filters` vrací `{ users: UserFacet[]; actions: string[] }`.

- [ ] **Step 1: Uprav filter route — načti uživatele a poskládej facets**

V `src/app/api/audit/filters/route.ts` nahraď `FilterFacets`, `loadFacets` a použití:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { buildUserFacets, type UserFacet } from "@/lib/auditFacets";

interface FilterFacets {
  users: UserFacet[];
  actions: string[];
}

interface CacheEntry {
  expiresAt: number;
  data: FilterFacets;
}

const CACHE_TTL_MS = 60_000;
const FACET_HARD_CAP = 500;

let cache: CacheEntry | null = null;
let inflight: Promise<FilterFacets> | null = null;

async function loadFacets(): Promise<FilterFacets> {
  const [users, auditUsernameRows, actionRows] = await Promise.all([
    prisma.user.findMany({
      select: { username: true, role: true },
      take: FACET_HARD_CAP,
    }),
    prisma.auditLog.findMany({
      distinct: ["username"],
      select: { username: true },
      orderBy: { username: "asc" },
      take: FACET_HARD_CAP,
    }),
    prisma.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
      take: FACET_HARD_CAP,
    }),
  ]);

  const activeUsernames = auditUsernameRows
    .map((r) => r.username)
    .filter((s) => s.length > 0);

  return {
    users: buildUserFacets(users, activeUsernames),
    actions: actionRows.map((r) => r.action).filter((s) => s.length > 0),
  };
}
```

`GET` handler zůstává beze změny (jen vrací nový tvar přes cache).

- [ ] **Step 2: Uprav `AuditLogPanel.tsx` — typ facets + fetch + UserChips**

V `src/components/admin/AuditLogPanel.tsx`:

(a) Přidej import nahoře:
```ts
import { buildUserFacets, type UserFacet } from "@/lib/auditFacets";
```
(pozn.: `buildUserFacets` se v komponentě nepoužívá — importuj JEN typ:)
```ts
import type { UserFacet } from "@/lib/auditFacets";
```

(b) Změň `AuditFacets` (řádky 49–52):
```ts
interface AuditFacets {
  users: UserFacet[];
  actions: string[];
}
```

(c) Změň inicializaci stavu (řádek 135):
```ts
const [facets, setFacets] = useState<AuditFacets>({ users: [], actions: [] });
```

(d) Změň render sekce Uživatelé (řádky 356–364):
```tsx
{facets.users.length > 0 && (
  <FilterRow label="Uživatelé">
    <UserChips
      items={facets.users}
      selected={filters.usernames}
      onChange={setUsernames}
    />
  </FilterRow>
)}
```

(e) Přepiš komponentu `UserChips` (řádky 589–640):
```tsx
function UserChips({
  items,
  selected,
  onChange,
}: {
  items: UserFacet[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(name: string) {
    if (selected.includes(name)) onChange(selected.filter((u) => u !== name));
    else onChange([...selected, name]);
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {items.map((u) => {
        const isOn = selected.includes(u.username);
        const inactive = !u.hasActivity;
        return (
          <button
            key={u.username}
            type="button"
            onClick={() => toggle(u.username)}
            aria-pressed={isOn}
            title={inactive ? "Bez auditní stopy" : undefined}
            style={{
              minHeight: 32,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: isOn ? 700 : 500,
              fontFamily: FONT_STACK,
              background: isOn ? IOS_BLUE_BG : "var(--surface-2)",
              color: isOn ? IOS_BLUE : TEXT_SECONDARY,
              border: `1px solid ${isOn ? IOS_BLUE_BORDER : "var(--border)"}`,
              borderStyle: inactive && !isOn ? "dashed" : "solid",
              opacity: inactive && !isOn ? 0.6 : 1,
              cursor: "pointer",
              transition: "all 120ms ease-out",
              WebkitTapHighlightColor: "transparent",
              whiteSpace: "nowrap",
            }}
          >
            {u.username}
            {u.role && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: ".04em",
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: "var(--surface-3)",
                  color: "var(--text-muted)",
                }}
              >
                {u.role}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ Compiled successfully`, 0 errors.

- [ ] **Step 4: Ruční ověření**

Přihlas se jako ADMIN → Správa → Audit log. Ve filtru „Uživatelé" musí být i uživatelé bez aktivity (zašedlí, přerušovaný okraj, odznak role). Klik na zašedlého uživatele → výpis prázdný (bez chyby).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/audit/filters/route.ts src/components/admin/AuditLogPanel.tsx
git commit -m "feat(audit): filtr uživatelů z celého seznamu, neaktivní zašedlí + role"
```

**→ CHECKPOINT: stop, počkej na OK uživatele.**

---

## ETAPA 2 — LoginLog + logování přihlášení

### Task 2.1: Prisma model + migrace

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_login_log/migration.sql` (generuje `migrate dev`)

**Interfaces:**
- Produces: model `LoginLog` (viz níže) → `prisma.loginLog`.

- [ ] **Step 1: Přidej model do `prisma/schema.prisma`**

Za model `AuditLog` (nebo poblíž) vlož:
```prisma
model LoginLog {
  id            Int      @id @default(autoincrement())
  userId        Int?     // null pro neznámé uživatelské jméno
  username      String
  success       Boolean
  failureReason String?
  ipAddress     String?
  createdAt     DateTime @default(now())

  @@index([userId, createdAt])
  @@index([username, createdAt])
  @@index([createdAt])
}
```
Bez relace na `User` (záměr — viz spec).

- [ ] **Step 2: Vytvoř migraci (dev)**

Run: `npx prisma migrate dev --name add_login_log`
Expected: migrace vytvořena a aplikována, Prisma Client vygenerován. `LoginLog` existuje v dev DB.

- [ ] **Step 3: Ověř generovaného klienta buildem**

Run: `npm run build`
Expected: 0 TS chyb (`prisma.loginLog` je dostupné).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(login-audit): model LoginLog + migrace"
```

### Task 2.2: Logování v login endpointu

**Files:**
- Modify: `src/app/api/auth/login/route.ts`

**Interfaces:**
- Consumes: `prisma.loginLog`, `getClientIp`.

- [ ] **Step 1: Přidej pomocnou funkci a zápisy do login route**

V `src/app/api/auth/login/route.ts`, uvnitř `POST` (už má `const ip = getClientIp(req)`). Přidej lokální helper nad `POST` nebo do těla — zápis do LoginLogu s ochranou proti pádu:

```ts
async function recordLogin(entry: {
  userId: number | null;
  username: string;
  success: boolean;
  failureReason?: string;
  ipAddress: string;
}): Promise<void> {
  try {
    await prisma.loginLog.create({ data: entry });
  } catch (err) {
    logger.error("[login] zápis LoginLog selhal", err);
  }
}
```

Pak uprav větev špatných údajů (řádky 45–48):
```ts
    const user = await prisma.user.findUnique({ where: { username: u } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      await recordLogin({
        userId: user?.id ?? null,
        username: u,
        success: false,
        failureReason: "INVALID_CREDENTIALS",
        ipAddress: ip,
      });
      return NextResponse.json({ error: "Nesprávné přihlašovací údaje" }, { status: 401 });
    }
```

A úspěšnou větev (po `createSession`, řádky 50–56):
```ts
    await createSession({
      id: user.id,
      username: user.username,
      role: user.role,
      assignedMachine: user.assignedMachine ?? null,
    });
    await recordLogin({
      userId: user.id,
      username: user.username,
      success: true,
      ipAddress: ip,
    });
    return NextResponse.json({ ok: true, role: user.role });
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: 0 TS chyb.

- [ ] **Step 3: Ruční ověření**

Odhlas se, přihlas se správně → v dev DB `SELECT * FROM LoginLog ORDER BY id DESC LIMIT 5;` obsahuje řádek `success=1` s tvým `userId` a IP. Zkus jednou špatné heslo → přibude řádek `success=0`, `failureReason=INVALID_CREDENTIALS`. Přihlášení funguje beze změny UX.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/login/route.ts
git commit -m "feat(login-audit): logování úspěšných i neúspěšných přihlášení"
```

**→ CHECKPOINT: stop, počkej na OK uživatele.**

---

## ETAPA 3 — Admin záložka „Přihlášení"

### Task 3.1: Čistá funkce `buildLoginOverview`

**Files:**
- Create: `src/lib/loginLogStats.ts`
- Test: `src/lib/loginLogStats.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LoginLogRow { userId: number | null; username: string; success: boolean; createdAt: Date; }
  export interface UserRow { id: number; username: string; role: string; }
  export interface LoginUserStat {
    userId: number | null; username: string; role: string | null;
    count30d: number; lastLoginAt: string | null; failed30d: number;
  }
  export interface LoginOverview {
    summary: { loginsToday: number; loginsWeek: number; activeUsersWeek: number; failed7d: number; neverLoggedIn: number; };
    users: LoginUserStat[];
  }
  export function buildLoginOverview(
    logs: LoginLogRow[],           // předpokládá se okno posledních 30 dní
    users: UserRow[],
    bounds: { todayStart: Date; weekStart: Date; d7Start: Date },
  ): LoginOverview
  ```
  `count30d`/`failed30d` = přes všechny předané `logs` (caller fetchne 30denní okno). `users` řazeni podle `count30d` desc, pak `username` asc.

- [ ] **Step 1: Napiš failing test**

```ts
// src/lib/loginLogStats.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLoginOverview } from "./loginLogStats";

const bounds = {
  todayStart: new Date("2026-07-20T00:00:00.000Z"),
  weekStart: new Date("2026-07-14T00:00:00.000Z"),
  d7Start: new Date("2026-07-14T00:00:00.000Z"),
};

test("buildLoginOverview: souhrn počítá dnes/týden/aktivní/neúspěchy", () => {
  const logs = [
    { userId: 1, username: "vojta", success: true, createdAt: new Date("2026-07-20T08:00:00Z") },
    { userId: 1, username: "vojta", success: true, createdAt: new Date("2026-07-15T08:00:00Z") },
    { userId: 2, username: "pepa", success: true, createdAt: new Date("2026-07-16T08:00:00Z") },
    { userId: 2, username: "pepa", success: false, createdAt: new Date("2026-07-17T08:00:00Z") },
    { userId: null, username: "hacker", success: false, createdAt: new Date("2026-07-18T08:00:00Z") },
  ];
  const users = [
    { id: 1, username: "vojta", role: "ADMIN" },
    { id: 2, username: "pepa", role: "ADMIN" },
    { id: 3, username: "nahled", role: "VIEWER" },
  ];
  const o = buildLoginOverview(logs, users, bounds);
  assert.equal(o.summary.loginsToday, 1);       // jen vojta dnes
  assert.equal(o.summary.loginsWeek, 3);        // 3 úspěšná od 14.7.
  assert.equal(o.summary.activeUsersWeek, 2);   // vojta + pepa
  assert.equal(o.summary.failed7d, 2);          // pepa + hacker
  assert.equal(o.summary.neverLoggedIn, 1);     // nahled
});

test("buildLoginOverview: per-user statistiky, řazení podle počtu", () => {
  const logs = [
    { userId: 1, username: "vojta", success: true, createdAt: new Date("2026-07-20T08:00:00Z") },
    { userId: 1, username: "vojta", success: true, createdAt: new Date("2026-07-19T08:00:00Z") },
    { userId: 2, username: "pepa", success: true, createdAt: new Date("2026-07-18T08:00:00Z") },
    { userId: 2, username: "pepa", success: false, createdAt: new Date("2026-07-18T09:00:00Z") },
  ];
  const users = [
    { id: 2, username: "pepa", role: "ADMIN" },
    { id: 1, username: "vojta", role: "ADMIN" },
  ];
  const o = buildLoginOverview(logs, users, bounds);
  assert.deepEqual(o.users.map((u) => u.username), ["vojta", "pepa"]); // vojta 2 > pepa 1
  const vojta = o.users[0];
  assert.equal(vojta.count30d, 2);
  assert.equal(vojta.failed30d, 0);
  assert.equal(vojta.lastLoginAt, new Date("2026-07-20T08:00:00Z").toISOString());
  const pepa = o.users[1];
  assert.equal(pepa.count30d, 1);
  assert.equal(pepa.failed30d, 1);
});

test("buildLoginOverview: uživatel bez přihlášení má 0 a lastLoginAt=null", () => {
  const users = [{ id: 3, username: "nahled", role: "VIEWER" }];
  const o = buildLoginOverview([], users, bounds);
  assert.equal(o.users[0].count30d, 0);
  assert.equal(o.users[0].lastLoginAt, null);
  assert.equal(o.summary.neverLoggedIn, 1);
});
```

- [ ] **Step 2: Spusť test — musí selhat**

Run: `node --test --import tsx src/lib/loginLogStats.test.ts`
Expected: FAIL — modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

```ts
// src/lib/loginLogStats.ts
export interface LoginLogRow {
  userId: number | null;
  username: string;
  success: boolean;
  createdAt: Date;
}
export interface UserRow {
  id: number;
  username: string;
  role: string;
}
export interface LoginUserStat {
  userId: number | null;
  username: string;
  role: string | null;
  count30d: number;
  lastLoginAt: string | null;
  failed30d: number;
}
export interface LoginOverview {
  summary: {
    loginsToday: number;
    loginsWeek: number;
    activeUsersWeek: number;
    failed7d: number;
    neverLoggedIn: number;
  };
  users: LoginUserStat[];
}

/**
 * Agreguje 30denní okno LoginLog do souhrnu + statistik po uživatelích.
 * Čistá funkce — hranice období počítá caller (Prague TZ) a předá v `bounds`.
 */
export function buildLoginOverview(
  logs: LoginLogRow[],
  users: UserRow[],
  bounds: { todayStart: Date; weekStart: Date; d7Start: Date },
): LoginOverview {
  const successLogs = logs.filter((l) => l.success);
  const failedLogs = logs.filter((l) => !l.success);

  const loginsToday = successLogs.filter((l) => l.createdAt >= bounds.todayStart).length;
  const loginsWeek = successLogs.filter((l) => l.createdAt >= bounds.weekStart).length;
  const activeUsersWeek = new Set(
    successLogs
      .filter((l) => l.createdAt >= bounds.weekStart && l.userId != null)
      .map((l) => l.userId),
  ).size;
  const failed7d = failedLogs.filter((l) => l.createdAt >= bounds.d7Start).length;

  const usersLoggedIn = new Set(
    successLogs.filter((l) => l.userId != null).map((l) => l.userId),
  );
  const neverLoggedIn = users.filter((u) => !usersLoggedIn.has(u.id)).length;

  const stats: LoginUserStat[] = users.map((u) => {
    const mySuccess = successLogs.filter((l) => l.userId === u.id);
    const myFailed = failedLogs.filter((l) => l.userId === u.id);
    const last = mySuccess.reduce<Date | null>(
      (acc, l) => (acc === null || l.createdAt > acc ? l.createdAt : acc),
      null,
    );
    return {
      userId: u.id,
      username: u.username,
      role: u.role,
      count30d: mySuccess.length,
      failed30d: myFailed.length,
      lastLoginAt: last ? last.toISOString() : null,
    };
  });

  stats.sort((a, b) => {
    if (b.count30d !== a.count30d) return b.count30d - a.count30d;
    return a.username.localeCompare(b.username, "cs");
  });

  return {
    summary: { loginsToday, loginsWeek, activeUsersWeek, failed7d, neverLoggedIn },
    users: stats,
  };
}
```

- [ ] **Step 4: Spusť test — musí projít**

Run: `node --test --import tsx src/lib/loginLogStats.test.ts`
Expected: PASS (3 testy).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loginLogStats.ts src/lib/loginLogStats.test.ts
git commit -m "feat(login-audit): buildLoginOverview — agregace přihlášení"
```

### Task 3.2: API `GET /api/admin/login-log`

**Files:**
- Create: `src/app/api/admin/login-log/route.ts`

**Interfaces:**
- Consumes: `buildLoginOverview`, `requireRole`, `pragueToUTC`, `addDaysToCivilDate`, `todayPragueDateStr`.
- Produces: `GET /api/admin/login-log` → `LoginOverview` (JSON).

- [ ] **Step 1: Vytvoř route**

```ts
// src/app/api/admin/login-log/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { isAppError, errorStatus } from "@/lib/errors";
import { pragueToUTC, addDaysToCivilDate, todayPragueDateStr } from "@/lib/dateUtils";
import { buildLoginOverview } from "@/lib/loginLogStats";

export async function GET() {
  try {
    await requireRole(["ADMIN"]);

    const today = todayPragueDateStr();
    const todayStart = pragueToUTC(today, 0, 0);
    const weekStart = pragueToUTC(addDaysToCivilDate(today, -6), 0, 0);
    const d30Start = pragueToUTC(addDaysToCivilDate(today, -29), 0, 0);

    const [logs, users] = await Promise.all([
      prisma.loginLog.findMany({
        where: { createdAt: { gte: d30Start } },
        select: { userId: true, username: true, success: true, createdAt: true },
      }),
      prisma.user.findMany({ select: { id: true, username: true, role: true } }),
    ]);

    const overview = buildLoginOverview(logs, users, {
      todayStart,
      weekStart,
      d7Start: weekStart,
    });
    return NextResponse.json(overview);
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    }
    logger.error("[GET /api/admin/login-log] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: 0 TS chyb.

- [ ] **Step 3: Ruční ověření**

V prohlížeči přihlášený jako ADMIN otevři `/api/admin/login-log` → JSON se `summary` a `users`. Jako ne-ADMIN → 403.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/login-log/route.ts
git commit -m "feat(login-audit): GET /api/admin/login-log (ADMIN)"
```

### Task 3.3: Komponenta `LoginLogPanel` + tab v Adminu

**Files:**
- Create: `src/components/admin/LoginLogPanel.tsx`
- Modify: `src/app/admin/_components/AdminDashboard.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/login-log` (tvar `LoginOverview`).

- [ ] **Step 1: Vytvoř `LoginLogPanel.tsx`**

```tsx
// src/components/admin/LoginLogPanel.tsx
"use client";

import { useEffect, useState } from "react";
import type { LoginOverview } from "@/lib/loginLogStats";

function fmt(iso: string | null): string {
  if (!iso) return "nikdy";
  return new Date(iso).toLocaleString("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const TD: React.CSSProperties = { padding: "9px 12px", borderBottom: "1px solid var(--border)", fontSize: 13 };
const TH: React.CSSProperties = { textAlign: "left", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600, padding: "9px 12px", borderBottom: "1px solid var(--border)" };

function Kpi({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", flex: "1 1 0", minWidth: 130 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: danger && value > 0 ? "var(--danger)" : "var(--text)" }}>{value}</div>
    </div>
  );
}

export function LoginLogPanel() {
  const [data, setData] = useState<LoginOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch("/api/admin/login-log", { signal: ctrl.signal });
        if (!r.ok) throw new Error("Nepodařilo se načíst přehled přihlášení");
        setData((await r.json()) as LoginOverview);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Neznámá chyba");
      } finally {
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, []);

  if (loading) return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Načítám…</div>;
  if (error) return <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>;
  if (!data) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Kpi label="Přihlášení dnes" value={data.summary.loginsToday} />
        <Kpi label="Tento týden" value={data.summary.loginsWeek} />
        <Kpi label="Aktivní uživatelé (7 dní)" value={data.summary.activeUsersWeek} />
        <Kpi label="Neúspěšné (7 dní)" value={data.summary.failed7d} danger />
        <Kpi label="Nikdy nepřihlášen" value={data.summary.neverLoggedIn} />
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620 }}>
          <thead>
            <tr>
              <th style={TH}>Uživatel</th>
              <th style={TH}>Role</th>
              <th style={{ ...TH, textAlign: "right" }}>Přihlášení (30 dní)</th>
              <th style={TH}>Poslední přihlášení</th>
              <th style={{ ...TH, textAlign: "right" }}>Neúspěchy (30 dní)</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.username}>
                <td style={{ ...TD, fontWeight: 600 }}>{u.username}</td>
                <td style={TD}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: "var(--surface-3)", color: "var(--text-muted)" }}>{u.role ?? "—"}</span>
                </td>
                <td style={{ ...TD, textAlign: "right", fontVariantNumeric: "tabular-nums", color: u.count30d === 0 ? "var(--text-muted)" : "var(--text)" }}>{u.count30d}</td>
                <td style={{ ...TD, color: u.lastLoginAt ? "var(--text)" : "var(--text-muted)" }}>{fmt(u.lastLoginAt)}</td>
                <td style={{ ...TD, textAlign: "right", fontVariantNumeric: "tabular-nums", color: u.failed30d > 0 ? "var(--danger)" : "var(--text-muted)" }}>{u.failed30d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Zapoj tab do `AdminDashboard.tsx`**

(a) Import (poblíž řádku 8):
```ts
import { LoginLogPanel } from "@/components/admin/LoginLogPanel";
```

(b) `visibleTabs` (řádek 28) — přidej `"logins"` (jen ne-PLANOVAT vidí; PLANOVAT větev vrací bez něj, což už platí):
```ts
const visibleTabs = (["users", "codebook", "presets", "audit", "logins", "shifts", "rozpis"] as const).filter((tab) => {
  if (isPlanovat) return tab === "codebook" || tab === "presets" || tab === "shifts" || tab === "rozpis";
  return true;
});
```

(c) Typ `activeTab` stavu (řádky 32–34) — přidej `"logins"`:
```ts
const [activeTab, setActiveTab] = useState<"users" | "codebook" | "presets" | "audit" | "logins" | "shifts" | "rozpis">(
  isPlanovat ? "presets" : "users"
);
```

(d) Label tabu (řádek 112) — přidej větev před `shifts`:
```tsx
{tab === "users" ? "Uživatelé" : tab === "codebook" ? "Číselníky" : tab === "presets" ? "Presety" : tab === "audit" ? "Audit log" : tab === "logins" ? "Přihlášení" : tab === "shifts" ? "Pracovní doba" : "Rozpis směn"}
```

(e) Šířka obsahu (řádek 120) — přidej `logins` k širokým:
```ts
maxWidth: (activeTab === "rozpis" || activeTab === "shifts" || activeTab === "audit" || activeTab === "logins") ? 1280 : 680,
```

(f) Render obsahu (řádky 130–133) — přidej větev za `audit`:
```tsx
) : activeTab === "audit" && !isPlanovat ? (
  <Suspense fallback={null}>
    <AuditLogPanel />
  </Suspense>
) : activeTab === "logins" && !isPlanovat ? (
  <LoginLogPanel />
) : activeTab === "shifts" ? (
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: 0 TS chyb.

- [ ] **Step 4: Ruční ověření**

Admin → Správa → záložka „Přihlášení". Zobrazí KPI karty + tabulku uživatelů. PLANOVAT uživatel záložku nevidí.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/LoginLogPanel.tsx src/app/admin/_components/AdminDashboard.tsx
git commit -m "feat(login-audit): admin záložka Přihlášení (KPI + tabulka)"
```

**→ CHECKPOINT: stop, počkej na OK uživatele.**

---

## ETAPA 4 — KPI přihlášení v Reportech

### Task 4.1: `logins` v dashboard API + KpiCard v RetroView

**Files:**
- Modify: `src/app/api/report/dashboard/route.ts`
- Modify: `src/app/reporty/_components/ReportDashboard.tsx`

**Interfaces:**
- Consumes: `prisma.loginLog`.
- Produces: retro response má navíc `logins: { periodCount: number; activeUsers: number }`.

- [ ] **Step 1: Rozšiř `handleRetro` v dashboard route**

V `src/app/api/report/dashboard/route.ts`, uvnitř `handleRetro`, před `return NextResponse.json({...})` (poblíž řádku 184) přidej dotaz:

```ts
  // Přihlášení za období
  const loginRows = await prisma.loginLog.findMany({
    where: { success: true, createdAt: { gte: startUtc, lt: endUtc } },
    select: { userId: true },
  });
  const loginActiveUsers = new Set(
    loginRows.map((l) => l.userId).filter((x): x is number => x != null),
  ).size;
  const logins = { periodCount: loginRows.length, activeUsers: loginActiveUsers };
```

A do `return NextResponse.json({...})` přidej `logins`:
```ts
  return NextResponse.json({
    machines,
    dailyUtilization,
    throughput,
    avgLeadTimeDays,
    maintenanceRatio,
    planning: { rescheduleCount, stabilityPercent },
    plannerActivity,
    pipeline: { ...statusCounts, conversionPercent },
    logins,
  });
```

- [ ] **Step 2: Rozšiř `RetroData` a přidej KpiCard v `ReportDashboard.tsx`**

(a) Do `interface RetroData` (poblíž řádku 27, za `plannerActivity`) přidej:
```ts
  logins: { periodCount: number; activeUsers: number };
```

(b) V `RetroView`, v sekci PLÁNOVÁNÍ (poblíž řádků 256–258, kde jsou KpiCard „Přeplánování" a „Stabilita plánu") přidej třetí kartu:
```tsx
<KpiCard label="Stabilita plánu" value={`${data.planning.stabilityPercent}%`} subtitle="bloků beze změny" />
<KpiCard label="Přihlášení za období" value={data.logins.periodCount} subtitle={`${data.logins.activeUsers} aktivních uživatelů`} />
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: 0 TS chyb.

- [ ] **Step 4: Ruční ověření**

Reporty → Retrospektiva → sekce PLÁNOVÁNÍ obsahuje kartu „Přihlášení za období" s číslem vázaným na zvolené období (Dnes/Týden/Měsíc).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/report/dashboard/route.ts src/app/reporty/_components/ReportDashboard.tsx
git commit -m "feat(login-audit): KPI Přihlášení za období v Retrospektivě"
```

- [ ] **Step 6: Finální kontrola celé suite**

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`
Expected: všechny testy zelené (včetně nových `auditFacets` + `loginLogStats`).

**→ CHECKPOINT: hotovo, počkej na OK uživatele.**

---

## Poznámky k realizaci

- `pragueToUTC(dateStr, hour, minute)` a `addDaysToCivilDate(dateStr, delta)` existují a používá je i `dashboard/route.ts`. Pokud by `addDaysToCivilDate` se záporným deltou nebyl podporován, ověř v `src/lib/dateUtils.ts` a případně použij existující ekvivalent.
- `requireRole` hází `UNAUTHORIZED`/`FORBIDDEN` (chytá catch → `errorStatus`). Nová admin route drží kanonický catch vzor z CLAUDE.md.
- Migrace na produkci NENÍ součástí tohoto plánu — řeší Vojta samostatně (mysqldump záloha → `migrate deploy`).
