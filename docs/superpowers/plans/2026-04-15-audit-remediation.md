# Audit Remediation — Implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Systematicky opravit bezpečnostní, UX a code quality problémy nalezené v auditu ze dne 15. 4. 2026.

**Architecture:** Čtyři nezávislé sprinty (Bezpečnost → Stabilita kódu → UX → Maintainability). Každá etapa je samostatná jednotka — po dokončení dostaneš přehled změněných souborů a testing checklist. Git (commit, push, branch) řídíš výhradně ty sám.

**Tech Stack:** Next.js 15, TypeScript, Prisma 5, MySQL, Tailwind CSS v4, jose JWT

---

## SPRINT 1 — Bezpečnost

Tyto opravy jsou prioritní — jsou to skutečná bezpečnostní rizika, ne estetika.

---

### Etapa 1.1: JWT Secret — odstranit fallback

**Proč:** Pokud se `.env` zapomene nastavit v produkci, aplikace tiše poběží s veřejně
známým dev secretem. Každý, kdo ho zná, si může vyrobit platný JWT.

**Soubory:**
- Upravit: `src/lib/auth.ts` (řádky 4–5)
- Upravit: `src/middleware.ts` (řádky 4–5)

- [ ] **Krok 1:** Otevři `src/lib/auth.ts`. Najdi:
  ```typescript
  const SECRET_VALUE = process.env.JWT_SECRET ?? "integraf-dev-secret-please-change-in-production";
  const SECRET = new TextEncoder().encode(SECRET_VALUE);
  ```
  Nahraď za:
  ```typescript
  const jwtSecretRaw = process.env.JWT_SECRET;
  if (!jwtSecretRaw) {
    throw new Error(
      "[auth] JWT_SECRET env variable is not set. " +
      "Add it to .env (development) or production environment."
    );
  }
  const SECRET = new TextEncoder().encode(jwtSecretRaw);
  ```

- [ ] **Krok 2:** Otevři `src/middleware.ts`. Najdi analogickou SECRET inicializaci (obvykle stejný pattern na začátku souboru). Aplikuj stejnou změnu — throw místo fallback.

- [ ] **Krok 3:** Ověř, že `.env` soubor obsahuje `JWT_SECRET=` s nějakou hodnotou (nemusí být produkční, ale musí existovat). Pokud ne, přidej:
  ```
  JWT_SECRET=integraf-dev-secret-local-only-minimum-32-chars
  ```

- [ ] **Krok 4:** Spusť dev server a ověř, že běží bez chyby:
  ```bash
  npm run dev
  ```
  Očekávaný výsledek: server startuje normálně na `localhost:3000`.

- [ ] **Krok 5:** Dočasně smaž `JWT_SECRET` z `.env` (nebo přejmenuj klíč) a znovu spusť:
  ```bash
  npm run dev
  ```
  Očekávaný výsledek: server okamžitě hodí `Error: [auth] JWT_SECRET env variable is not set.` a NEspustí se.

- [ ] **Krok 6:** Obnov `.env` — server musí zase nastartovat normálně.

**Jak otestovat (manuálně):**
- Přihlásit se přes `/login` → mělo by fungovat normálně
- Bez `JWT_SECRET` v `.env` musí server odmítnout start

---

### Etapa 1.2: ALLOW_HTTP_SESSION — uzamknout v produkci

**Proč:** Tento env var může omylem nebo záměrně vypnout `Secure` flag na session cookie v produkci, což umožní MitM útok.

**Soubory:**
- Upravit: `src/lib/auth.ts` (~řádky 24–30 v `createSession`)

- [ ] **Krok 1:** Najdi v `src/lib/auth.ts` tuto logiku (nebo podobnou):
  ```typescript
  const secure = process.env.NODE_ENV === "production" && process.env.ALLOW_HTTP_SESSION !== "true";
  ```
  Nahraď za:
  ```typescript
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_HTTP_SESSION === "true") {
    throw new Error(
      "[auth] ALLOW_HTTP_SESSION=true is not permitted in production. " +
      "Remove this env var from the production environment."
    );
  }
  const secure = process.env.NODE_ENV === "production";
  ```

- [ ] **Krok 2:** Spusť dev server s `NODE_ENV` výchozím (development) → mělo by fungovat normálně i s `ALLOW_HTTP_SESSION=true` v `.env`.

**Jak otestovat:**
- Normální přihlášení funguje beze změny
- Cookie v DevTools → Application → Cookies: v dev má `HttpOnly` ✓, `SameSite: Lax` ✓, `Secure` může chybět (dev je HTTP)

---

### Etapa 1.3: Rate limiting na login

**Proč:** Endpoint `/api/auth/login` nemá žádné omezení pokusů. Brute-force útok na slabá hesla není blokován.

**Soubory:**
- Upravit: `src/app/api/auth/login/route.ts`

**Přístup:** Jednoduchý in-memory rate limiter (mapa IP → pokusy + timestamp). Pro interní nástroj bez Redis je to dostačující; pokud by aplikace běžela v clusteru, bylo by třeba Redis, ale pro Michalův single-server deployment stačí paměť.

- [ ] **Krok 1:** Na začátek `src/app/api/auth/login/route.ts` přidej in-memory store **před** definicí `POST` handleru:
  ```typescript
  // In-memory rate limiter: max 10 attempts per IP per 15 minutes
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();
  const RATE_LIMIT_MAX = 10;
  const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minut

  function getClientIp(req: NextRequest): string {
    return (
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown"
    );
  }

  function checkRateLimit(ip: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const entry = loginAttempts.get(ip);

    if (!entry || now > entry.resetAt) {
      loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (entry.count >= RATE_LIMIT_MAX) {
      return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
    }

    entry.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
  ```

- [ ] **Krok 2:** Na začátek `POST` handleru (před čtením `body`) přidej:
  ```typescript
  const ip = getClientIp(request);
  const { allowed, retryAfterSeconds } = checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: `Příliš mnoho pokusů. Zkuste znovu za ${Math.ceil(retryAfterSeconds / 60)} minut.` },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      }
    );
  }
  ```

- [ ] **Krok 3:** Spusť dev server a otestuj ručně — 10 neúspěšných přihlášení za sebou:
  - 1.–10. pokus: vrátí `401 Unauthorized` (špatné heslo) nebo `200` (správné)
  - 11. pokus: vrátí `429 Too Many Requests` s textem o minutách

**Edge cases pro testování:**
- Správné heslo na 9. pokusu → přihlásí normálně, ale counter se neobnoví
- Po 15 minutách od prvního pokusu → counter se resetuje, znovu 10 pokusů
- Různé IP adresy → každá má vlastní counter

---

### Etapa 1.4: Audit log pro "notify" akci

**Proč:** Akce `notify` (manuální notifikace obchodníkovi) se neloguje do `AuditLog`. Správce nemůže zjistit, kdo poslal jakou zprávu.

**Soubory:**
- Upravit: `src/app/api/reservations/[id]/route.ts` (sekce `action === "notify"`)

- [ ] **Krok 1:** Najdi v `src/app/api/reservations/[id]/route.ts` blok pro `action === "notify"`:
  ```typescript
  if (action === "notify") {
    const notifMessage = body.message ? String(body.message) : `...`;
    await prisma.notification.create({
      data: { ... },
    });
    return NextResponse.json({ ok: true });
  }
  ```

- [ ] **Krok 2:** Přepiš na `$transaction` s audit logem:
  ```typescript
  if (action === "notify") {
    const notifMessage = body.message
      ? String(body.message).slice(0, 500)
      : `Rezervace ${reservation.erpOfferNumber ?? id} — upozornění`;

    await prisma.$transaction([
      prisma.notification.create({
        data: {
          type: "RESERVATION_MANUAL",
          message: notifMessage,
          reservationId: id,
          targetUserId: reservation.requestedByUserId,
          createdByUserId: session.id,
          createdByUsername: session.username,
        },
      }),
      prisma.auditLog.create({
        data: {
          blockId: null,
          orderNumber: reservation.erpOfferNumber ?? `rezervace-${id}`,
          userId: session.id,
          username: session.username,
          action: "RESERVATION_NOTIFY",
          field: "message",
          newValue: notifMessage,
        },
      }),
    ]);

    return NextResponse.json({ ok: true });
  }
  ```

- [ ] **Krok 3:** Ověř, že `AuditLog.action` varchar(191) to pojme (je to krátký string `"RESERVATION_NOTIFY"` — OK).

- [ ] **Krok 4:** Otestuj: přihlásit jako ADMIN nebo PLANOVAT, přejít na rezervaci, odeslat notifikaci, pak v `/admin` záložka Audit zkontrolovat, že se záznam objevil.

**Edge cases:**
- Prázdná zpráva (`message: ""`) → použije se fallback text, audit log se zapíše
- Velmi dlouhá zpráva → `.slice(0, 500)` ji ořízne

---

### Etapa 1.5: Magic bytes validace pro Office soubory

**Proč:** Upload souborů s MIME typem `.docx`/`.xlsx` aktuálně vždy vrátí `true` bez ověření — útočník může nahrát libovolný binární obsah.

**Soubory:**
- Upravit: `src/app/api/reservations/[id]/attachments/route.ts` (funkce `validateMagicBytes`)

- [ ] **Krok 1:** Najdi funkci `validateMagicBytes`. Nahraď nebo rozšiř sekci pro Office dokumenty:
  ```typescript
  function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
    if (mimeType === "application/pdf") {
      return buffer.slice(0, 4).toString("ascii") === "%PDF";
    }

    // Office Open XML (docx, xlsx, pptx) jsou ZIP archivy — začínají PK
    if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      mimeType === "application/zip"
    ) {
      return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
    }

    // Obrázky
    if (mimeType === "image/jpeg") {
      return buffer[0] === 0xff && buffer[1] === 0xd8;
    }
    if (mimeType === "image/png") {
      return (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
      );
    }

    // Pro ostatní povolené typy — přijmout (Content-Type kontrola je v ALLOWED_MIME_TYPES)
    return true;
  }
  ```

- [ ] **Krok 2:** Zkontroluj, jaké MIME typy jsou v `ALLOWED_MIME_TYPES` konstantě v tom samém souboru — ověř, že pokrývají všechny větve výše.

- [ ] **Krok 3:** Otestuj upload:
  - Nahrát platný `.docx` → mělo by projít
  - Nahrát soubor přejmenovaný na `.docx` (např. `.exe` přejmenovaný) → měl by být zamítnut s `400`
  - Nahrát platný `.pdf` → mělo by projít
  - Nahrát `.txt` přejmenovaný na `.pdf` → měl by být zamítnut

---

### Etapa 1.6: Error leakage — skrýt detail v produkci

**Proč:** Login endpoint vrací `detail: msg` v JSON odpovědi — interní chybová zpráva je viditelná v produkci.

**Soubory:**
- Upravit: `src/app/api/auth/login/route.ts` (catch blok)

- [ ] **Krok 1:** Najdi v catch bloku:
  ```typescript
  return NextResponse.json({ error: "Chyba serveru", detail: msg }, { status: 500 });
  ```
  Nahraď za:
  ```typescript
  console.error("[POST /api/auth/login] Internal error:", error);
  const detail = process.env.NODE_ENV !== "production" ? msg : undefined;
  return NextResponse.json(
    { error: "Chyba serveru", ...(detail ? { detail } : {}) },
    { status: 500 }
  );
  ```

---

### Sprint 1 — Checklist před dokončením

- [ ] Otestuj celý přihlašovací flow end-to-end (login, session, logout)
- [ ] Zkontroluj DevTools cookies (HttpOnly, SameSite)
- [ ] Ověř audit log záznamy v `/admin`
- [ ] Zkus upload `.docx` a přejmenovaný `.exe`

---

## SPRINT 2 — Stabilita kódu

---

### Etapa 2.1: JWT payload — runtime validace

**Proč:** JWT payload se v `getSession()` přetypuje přes `as unknown as SessionUser` bez jakékoli runtime validace. Pokud JWT obsahuje neočekávaná data, kód to tiše spolkne.

**Soubory:**
- Upravit: `src/lib/auth.ts` (funkce `getSession`)

- [ ] **Krok 1:** Přidej inline validační funkci nad `getSession`:
  ```typescript
  const VALID_ROLES = ["ADMIN", "PLANOVAT", "DTP", "MTZ", "OBCHODNIK", "TISKAR", "VIEWER"] as const;
  type ValidRole = typeof VALID_ROLES[number];

  function parseJwtPayload(payload: unknown): SessionUser {
    if (typeof payload !== "object" || payload === null) {
      throw new Error("JWT payload is not an object");
    }
    const p = payload as Record<string, unknown>;
    if (typeof p.id !== "number") throw new Error("JWT payload: id must be number");
    if (typeof p.username !== "string") throw new Error("JWT payload: username must be string");
    if (!VALID_ROLES.includes(p.role as ValidRole)) {
      throw new Error(`JWT payload: invalid role "${String(p.role)}"`);
    }
    return {
      id: p.id,
      username: p.username,
      role: p.role as ValidRole,
      assignedMachine: typeof p.assignedMachine === "string" ? p.assignedMachine : null,
    };
  }
  ```

- [ ] **Krok 2:** V `getSession()` nahraď:
  ```typescript
  return payload as unknown as SessionUser;
  ```
  za:
  ```typescript
  return parseJwtPayload(payload);
  ```

- [ ] **Krok 3:** Zkontroluj, že `SessionUser` typ v `auth.ts` odpovídá polím, která `parseJwtPayload` vrací. Pokud má `SessionUser` další pole, přidej je do parseru.

- [ ] **Krok 4:** Spusť dev server, přihlas se, ověř, že session funguje normálně.

**Edge cases:**
- Starý JWT bez `assignedMachine` pole → parser vrátí `null` (backward compatible)
- JWT s neznámou rolí → vyhodí error, uživatel bude odhlášen (správné chování)

---

### Etapa 2.2: Custom error třídy — nahradit string parsing

**Proč:** Chyby z `$transaction` v `PUT /api/blocks/[id]` se vyhazují jako `Error` s string prefixem (`"PRESET:"`, `"NOT_FOUND"`) a pak parsují přes `.startsWith()`. Brittle — překlep = tiché selhání.

**Soubory:**
- Vytvořit: `src/lib/errors.ts`
- Upravit: `src/app/api/blocks/[id]/route.ts` (PUT handler)

- [ ] **Krok 1:** Vytvoř `src/lib/errors.ts`:
  ```typescript
  export type AppErrorCode =
    | "NOT_FOUND"
    | "FORBIDDEN"
    | "PRESET_INVALID"
    | "SCHEDULE_VIOLATION"
    | "CONFLICT";

  export class AppError extends Error {
    constructor(
      public readonly code: AppErrorCode,
      message: string,
      public readonly details?: unknown
    ) {
      super(message);
      this.name = "AppError";
    }
  }

  export function isAppError(err: unknown): err is AppError {
    return err instanceof AppError;
  }
  ```

- [ ] **Krok 2:** V `src/app/api/blocks/[id]/route.ts` nahraď všechna místa, kde se vyhazuje `throw new Error("PRESET:...")` za `throw new AppError("PRESET_INVALID", "...")`. Nahraď `throw new Error("NOT_FOUND")` za `throw new AppError("NOT_FOUND", "Blok nenalezen")`. Atd.

- [ ] **Krok 3:** V catch bloku PUT handleru nahraď string `.startsWith()` za:
  ```typescript
  } catch (error) {
    if (isAppError(error)) {
      const statusMap: Record<AppErrorCode, number> = {
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        PRESET_INVALID: 400,
        SCHEDULE_VIOLATION: 409,
        CONFLICT: 409,
      };
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: statusMap[error.code] ?? 400 }
      );
    }
    console.error("[PUT /api/blocks/[id]]", error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
  ```

- [ ] **Krok 4:** Zkontroluj, že žádný jiný catch blok v tomto souboru stále nepoužívá `.startsWith()` na error message.

- [ ] **Krok 5:** Spusť `npm run build` — ověř, že TypeScript nekompiluje žádné chyby.

**Edge cases pro testování:**
- Pokus o uložení bloku s neexistujícím preset ID → 400 s `code: "PRESET_INVALID"`
- Pokus o přesunutí bloku na čas mimo pracovní hodiny → 409 s `code: "SCHEDULE_VIOLATION"`
- Pokus o editaci neexistujícího bloku → 404 s `code: "NOT_FOUND"`

---

### Etapa 2.3: Extrahovat duplicitní schedule validaci

**Proč:** Logika pro validaci pracovní doby (fetch šablon + exceptions → `checkScheduleViolationWithTemplates`) se opakuje téměř identicky ve třech API routách. Bugfix v jedné se nezapíše do zbývajících.

**Soubory:**
- Vytvořit: `src/lib/scheduleValidationServer.ts`
- Upravit: `src/app/api/blocks/route.ts` (POST)
- Upravit: `src/app/api/blocks/[id]/route.ts` (PUT)
- Upravit: `src/app/api/blocks/batch/route.ts` (POST)

- [ ] **Krok 1:** Přečti všechna tři místa, kde se provádí validace. Zjisti, co mají společného a v čem se liší (zejména zda validace přeskakuje REZERVACE/UDRZBA bloky).

- [ ] **Krok 2:** Vytvoř `src/lib/scheduleValidationServer.ts`:
  ```typescript
  import prisma from "@/lib/prisma";
  import { checkScheduleViolationWithTemplates, serializeTemplates } from "@/lib/scheduleValidation";

  export interface ScheduleCheckInput {
    machine: string;
    startTime: Date;
    endTime: Date;
    blockType: string;
  }

  export interface ScheduleViolation {
    message: string;
    slots: unknown[];
  }

  /**
   * Načte pracovní šablony, výjimky a firemní dny z DB a zkontroluje,
   * zda blok nespadá do zakázaného časového pásma.
   * Vrátí null pokud je vše OK, nebo objekt s popisem porušení.
   * Poznámka: REZERVACE a UDRZBA bloky se NEvalidují (jen ZAKAZKA).
   */
  export async function validateBlockScheduleFromDb(
    input: ScheduleCheckInput
  ): Promise<ScheduleViolation | null> {
    if (input.blockType !== "ZAKAZKA") return null;

    const [templates, exceptions, companyDays] = await Promise.all([
      prisma.machineWorkHoursTemplate.findMany({
        where: { machine: input.machine },
        include: { days: true },
        orderBy: { validFrom: "asc" },
      }),
      prisma.machineScheduleException.findMany({
        where: { machine: input.machine },
      }),
      prisma.companyDay.findMany(),
    ]);

    const serializedTemplates = serializeTemplates(templates);
    const violation = checkScheduleViolationWithTemplates(
      input.machine,
      input.startTime,
      input.endTime,
      serializedTemplates,
      exceptions,
      companyDays
    );

    return violation ?? null;
  }
  ```

- [ ] **Krok 3:** V `src/app/api/blocks/route.ts` (POST) nahraď duplicitní fetch + validaci voláním `validateBlockScheduleFromDb()`. Importuj z `@/lib/scheduleValidationServer`.

- [ ] **Krok 4:** Totéž v `src/app/api/blocks/[id]/route.ts` (PUT).

- [ ] **Krok 5:** Totéž v `src/app/api/blocks/batch/route.ts` (POST) — pozor, batch validuje více bloků najednou; přizpůsob volání v cyklu nebo `Promise.all`.

- [ ] **Krok 6:** `npm run build` — ověř TypeScript.

- [ ] **Krok 7:** Otestuj: přesuň blok na sobotu (nebo den mimo šablonu) → měl by přijít chybový response o porušení plánu.

---

### Etapa 2.4: .env.example a dokumentace ENV vars

**Proč:** Nový developer ani Michal při dalším deployi neví, jaké ENV proměnné jsou povinné, co do nich dát a proč.

**Soubory:**
- Vytvořit: `.env.example`

- [ ] **Krok 1:** Zkontroluj, které ENV vars jsou v kódu referencovány (`process.env.`):
  ```bash
  grep -r "process\.env\." src/ --include="*.ts" | grep -o 'process\.env\.[A-Z_]*' | sort -u
  ```

- [ ] **Krok 2:** Vytvoř `.env.example`:
  ```dotenv
  # Databáze — MySQL connection string
  # Format: mysql://USER:PASSWORD@HOST:PORT/DATABASE?charset=utf8mb4
  DATABASE_URL="mysql://root:heslo@localhost:3306/IGvyroba?charset=utf8mb4"

  # JWT Secret — minimálně 32 znaků, náhodný string
  # Vygenerovat: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  # NIKDY nenastavovat na dev hodnotu v produkci!
  JWT_SECRET="generate-a-random-32-char-string-here"

  # NODE_ENV — development | production
  # V produkci nastavit na "production" (ovlivňuje Secure cookie, error detail atd.)
  NODE_ENV="development"

  # Pouze pro lokální HTTP development (NIKDY v produkci):
  # ALLOW_HTTP_SESSION="true"
  ```

- [ ] **Krok 3:** Ověř, že `.env` je v `.gitignore`:
  ```bash
  grep "^\.env$" .gitignore
  ```
  Pokud není, přidej řádek `.env` do `.gitignore`.

---

### Sprint 2 — Checklist před dokončením

- [ ] `npm run build` — musí projít bez chyb
- [ ] Přihlásit se, vytvořit blok, editovat, smazat — vše funguje
- [ ] Zkusit uložit blok mimo pracovní dobu → správný error

---

## SPRINT 3 — UX a navigace

---

### Etapa 3.1: Globální navigace — header s menu

**Proč:** Aplikace nemá žádnou navigaci. Uživatel neví, co existuje a jak se dostat na jiné části aplikace.

**Soubory:**
- Vytvořit: `src/components/AppNav.tsx`
- Upravit: `src/app/layout.tsx`

- [ ] **Krok 1:** Přečti `src/app/layout.tsx` a zjisti aktuální strukturu (body, providers atd.).

- [ ] **Krok 2:** Vytvoř `src/components/AppNav.tsx`:
  ```typescript
  "use client";

  import Link from "next/link";
  import { usePathname } from "next/navigation";
  import { SessionUser } from "@/lib/auth";

  interface AppNavProps {
    user: SessionUser | null;
  }

  const NAV_ITEMS = [
    { href: "/", label: "Plánovač", roles: ["ADMIN", "PLANOVAT", "DTP", "MTZ", "OBCHODNIK", "TISKAR", "VIEWER"] },
    { href: "/rezervace", label: "Rezervace", roles: ["ADMIN", "PLANOVAT", "OBCHODNIK"] },
    { href: "/expedice", label: "Expedice", roles: ["ADMIN", "PLANOVAT"] },
    { href: "/admin", label: "Admin", roles: ["ADMIN", "PLANOVAT"] },
    { href: "/report/daily", label: "Report", roles: ["ADMIN", "PLANOVAT"] },
    { href: "/tiskar", label: "Tiskárna", roles: ["TISKAR"] },
  ] as const;

  export function AppNav({ user }: AppNavProps) {
    const pathname = usePathname();

    if (!user || pathname === "/login") return null;

    const visibleItems = NAV_ITEMS.filter((item) =>
      item.roles.includes(user.role as never)
    );

    return (
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "0 16px",
          height: 44,
          background: "var(--surface)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)", marginRight: 12 }}>
          Integraf
        </span>
        {visibleItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                color: active ? "var(--text-primary)" : "var(--text-muted)",
                padding: "4px 10px",
                borderRadius: 6,
                background: active ? "rgba(255,255,255,0.08)" : "transparent",
                textDecoration: "none",
                transition: "background 120ms ease-out, color 120ms ease-out",
              }}
            >
              {item.label}
            </Link>
          );
        })}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {user.username} ({user.role.toLowerCase()})
        </span>
      </nav>
    );
  }
  ```

- [ ] **Krok 3:** Uprav `src/app/layout.tsx` — přidej `<AppNav>` nad hlavní content. Protože `layout.tsx` je Server Component, je potřeba session načíst tam:
  ```typescript
  import { getSession } from "@/lib/auth";
  import { AppNav } from "@/components/AppNav";

  // v render:
  const session = await getSession();
  return (
    <html>
      <body>
        <Providers>
          <AppNav user={session} />
          {children}
        </Providers>
      </body>
    </html>
  );
  ```

- [ ] **Krok 4:** Přihlásit se jako různé role (ADMIN, OBCHODNIK, TISKAR) a ověřit, že vidí jen své položky v navigaci.

**Edge cases:**
- Na `/login` stránce se navigace NEZOBRAZÍ (podmínka `pathname === "/login"`)
- TISKAR vidí jen "Plánovač" a "Tiskárna"
- OBCHODNIK vidí "Plánovač" a "Rezervace"
- Aktivní položka je vizuálně odlišena

---

### Etapa 3.2: Centralizované LoadingSpinner a ErrorMessage komponenty

**Proč:** Tři různé loading vzory a čtyři různé error vzory napříč aplikací. Uživatel neví, kam se dívat.

**Soubory:**
- Vytvořit: `src/components/LoadingSpinner.tsx`
- Vytvořit: `src/components/ErrorMessage.tsx`

- [ ] **Krok 1:** Vytvoř `src/components/LoadingSpinner.tsx`:
  ```typescript
  interface LoadingSpinnerProps {
    label?: string;
    size?: "sm" | "md";
  }

  export function LoadingSpinner({ label = "Načítám…", size = "md" }: LoadingSpinnerProps) {
    const dim = size === "sm" ? 16 : 24;
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: size === "sm" ? 8 : 24,
          color: "var(--text-muted)",
          fontSize: size === "sm" ? 12 : 14,
        }}
      >
        <svg
          width={dim}
          height={dim}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}
        >
          <circle cx={12} cy={12} r={10} strokeOpacity={0.25} />
          <path d="M12 2a10 10 0 0 1 10 10" />
        </svg>
        {label}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  ```

- [ ] **Krok 2:** Vytvoř `src/components/ErrorMessage.tsx`:
  ```typescript
  interface ErrorMessageProps {
    message: string;
    onRetry?: () => void;
  }

  export function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
    return (
      <div
        role="alert"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderRadius: 8,
          background: "color-mix(in oklab, var(--danger) 12%, transparent)",
          border: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)",
          color: "var(--text-primary)",
          fontSize: 13,
        }}
      >
        <span style={{ flex: 1 }}>{message}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            Zkusit znovu
          </button>
        )}
      </div>
    );
  }
  ```

- [ ] **Krok 3:** Nahraď `if (loading) return <div>Načítám…</div>` v `AdminDashboard.tsx` a `ReportView.tsx` za `<LoadingSpinner />`. (Nemusíš procházet všechny soubory — stačí ty dva nejviditelnější.)


---

### Etapa 3.3: Opravit hardcoded barvy — CSS proměnné

**Proč:** `ReportView.tsx` a `TiskarMonitor.tsx` mají hardcoded hex barvy, které nefungují v dark mode.

**Soubory:**
- Upravit: `src/app/report/daily/ReportView.tsx`
- Upravit: `src/app/tiskar/_components/TiskarMonitor.tsx`

- [ ] **Krok 1:** V `ReportView.tsx` najdi `TYPE_COLORS` nebo inline `backgroundColor: "#eff6ff"` / `color: "#1d4ed8"`. Nahraď za CSS proměnné — nebo pokud report je záměrně tiskový (A4 light mode), přidej komentář `/* print: intentionally light */` a ponech (tiskový report nesmí být dark).

  Pro nativní reportní barvy doporučuji ponechat jako konstanty ale izolovat je:
  ```typescript
  // ReportView.tsx — tiskový layout, intentionally uses light colors
  // Dark mode se na tisk neaplikuje
  const PRINT_COLORS = {
    ZAKAZKA: { bg: "#eff6ff", text: "#1d4ed8" },
    REZERVACE: { bg: "#f0fdf4", text: "#15803d" },
    UDRZBA: { bg: "#fafafa", text: "#525252" },
  } as const;
  ```

- [ ] **Krok 2:** V `TiskarMonitor.tsx` najdi `BLOCK_STYLES` s hardcoded barvami. Zkontroluj, zda odpovídají barvám v `src/lib/blockVariants.ts` nebo `src/lib/badgeColors.ts`. Pokud ano, importuj z tam. Pokud ne, nahraď CSS proměnnými.

- [ ] **Krok 3:** Přepni aplikaci do dark mode (ThemeToggle) a vizuálně zkontroluj:
  - Plánovač — bloky OK
  - Tiskar monitor — bloky čitelné
  - Report page — tiskový layout (světlý záměrně) OK

---

### Sprint 3 — Checklist před dokončením

- [ ] Přihlásit jako všechny role → ověřit navigaci
- [ ] Navigace nezobrazena na `/login`
- [ ] Dark mode toggle → ověřit, že žádná sekce nemá bílý text na bílém pozadí
- [ ] Admin → loading spinner viditelný při načítání

---

## SPRINT 4 — Long-term maintainability

Tento sprint je největší a nejriskantnější (refaktoring velkých komponent). Každá etapa musí být důkladněji otestována.

---

### Etapa 4.1: Strukturované logování

**Proč:** V produkci není žádný způsob, jak sledovat události nebo diagnostikovat problémy bez přístupu k serveru.

**Soubory:**
- Vytvořit: `src/lib/logger.ts`
- Upravit: vybrané API routes (postupně)

- [ ] **Krok 1:** Vytvoř `src/lib/logger.ts`:
  ```typescript
  type LogLevel = "info" | "warn" | "error";

  interface LogEntry {
    level: LogLevel;
    event: string;
    [key: string]: unknown;
  }

  function log(level: LogLevel, event: string, context?: Record<string, unknown>) {
    const entry: LogEntry = {
      level,
      event,
      ts: new Date().toISOString(),
      ...context,
    };
    // V produkci: JSON per line (přátelské pro log agregátory)
    // V dev: čitelný format
    if (process.env.NODE_ENV === "production") {
      console[level](JSON.stringify(entry));
    } else {
      console[level](`[${entry.ts}] ${event}`, context ?? "");
    }
  }

  export const logger = {
    info: (event: string, ctx?: Record<string, unknown>) => log("info", event, ctx),
    warn: (event: string, ctx?: Record<string, unknown>) => log("warn", event, ctx),
    error: (event: string, ctx?: Record<string, unknown>) => log("error", event, ctx),
  };
  ```

- [ ] **Krok 2:** Přidej logger do `src/app/api/auth/login/route.ts`:
  ```typescript
  import { logger } from "@/lib/logger";

  // Po úspěšném přihlášení:
  logger.info("auth.login.success", { username, ip: getClientIp(request) });

  // Po neúspěšném přihlášení:
  logger.warn("auth.login.failed", { username, ip: getClientIp(request) });

  // Po rate limit:
  logger.warn("auth.login.rate_limited", { ip });
  ```

- [ ] **Krok 3:** Přidej logger do `src/app/api/auth/logout/route.ts`:
  ```typescript
  logger.info("auth.logout", { userId: session?.id });
  ```

---

### Etapa 4.2: Test suite — základní pokrytí

**Proč:** Aplikace má 1 test soubor. Pro produkční aplikaci s komplexní business logikou je to nedostatečné.

**Soubory:**
- Vytvořit: `src/lib/errors.test.ts`
- Vytvořit: `src/lib/scheduleValidationServer.test.ts` (mocky)
- Upravit: `src/lib/dateUtils.test.ts` (doplnit edge cases)

- [ ] **Krok 1:** Vytvoř `src/lib/errors.test.ts`:
  ```typescript
  import { AppError, isAppError } from "./errors";
  import assert from "node:assert/strict";
  import { describe, it } from "node:test";

  describe("AppError", () => {
    it("preserves code and message", () => {
      const err = new AppError("NOT_FOUND", "Blok nenalezen");
      assert.equal(err.code, "NOT_FOUND");
      assert.equal(err.message, "Blok nenalezen");
      assert.equal(err.name, "AppError");
    });

    it("isAppError returns true for AppError", () => {
      assert.ok(isAppError(new AppError("CONFLICT", "test")));
    });

    it("isAppError returns false for plain Error", () => {
      assert.ok(!isAppError(new Error("not an AppError")));
    });

    it("isAppError returns false for non-Error values", () => {
      assert.ok(!isAppError("string"));
      assert.ok(!isAppError(null));
      assert.ok(!isAppError(undefined));
    });
  });
  ```

- [ ] **Krok 2:** Spusť test:
  ```bash
  node --test --import tsx src/lib/errors.test.ts
  ```
  Očekávaný výsledek: 4 testy pass.

- [ ] **Krok 3:** Doplň do `src/lib/dateUtils.test.ts` test pro přestupný rok:
  ```typescript
  it("daysInCivilMonth: February in leap year", () => {
    assert.equal(daysInCivilMonth(2024, 2), 29);
  });

  it("daysInCivilMonth: February in non-leap year", () => {
    assert.equal(daysInCivilMonth(2025, 2), 28);
  });
  ```

- [ ] **Krok 4:** Spusť celou test suite:
  ```bash
  node --test --import tsx src/lib/dateUtils.test.ts
  node --test --import tsx src/lib/errors.test.ts
  ```

---

### Etapa 4.3: Rozdělit PlannerPage — extrahovat ToastContainer

**Proč:** PlannerPage.tsx má 5 158 řádků. Nelze ji rozdělit na jeden pokus — riziko regrese je vysoké. Začínáme nejbezpečnější extrakcí (ToastContainer).

**Soubory:**
- Vytvořit: `src/components/ToastContainer.tsx`
- Upravit: `src/app/_components/PlannerPage.tsx`

- [ ] **Krok 1:** V `PlannerPage.tsx` najdi sekci, která renderuje toast notifikace (hledej `showToast` state nebo `toast` array a JSX který je iteruje). Identifikuj:
  - Datový typ jednoho toastu (id, message, type, variant?)
  - JSX který toast renderuje
  - Jak se toast přidává a odebírá (setTimeout?)

- [ ] **Krok 2:** Extrahuj do `src/components/ToastContainer.tsx`. Zachovej přesně stejné typy a CSS jako v originálu — jde jen o přesunutí kódu, ne redesign.

- [ ] **Krok 3:** V `PlannerPage.tsx` importuj `ToastContainer` a nahraď původní sekci importovanou komponentou. Ujisti se, že propsy odpovídají (předáváš správná data).

- [ ] **Krok 4:** Spusť dev server a v planneru vyzkoušej akci, která vyvolá toast (např. uložení bloku nebo chybová akce). Toast musí fungovat stejně jako před refaktoringem.

> **Poznámka:** Další extrakce (ZoomSlider, InboxPanel, BlockEditDialog) budou jako navazující etapy v budoucím sprintu — není nutné dělat vše najednou. Každá extrakce = vlastní commit + testování.

---

### Sprint 4 — Checklist před dokončením

- [ ] `npm run build` — musí projít bez chyb
- [ ] Spusť celou test suite: `node --test --import tsx src/lib/dateUtils.test.ts && node --test --import tsx src/lib/errors.test.ts`
- [ ] Ruční test celého planneru — drag, resize, split, undo
- [ ] Toast notifikace fungují
- [ ] Přihlašování loguje do konzole (info/warn)

---

## Celkový progress

- [x] Sprint 1 (Bezpečnost) — etapy 1.1–1.6 hotové a otestované *(commit: sprint 1)*
- [x] Sprint 2 (Stabilita kódu) — etapy 2.1–2.4 hotové a otestované *(commit: sprint 2)*
- [x] Sprint 3 (UX) — etapy 3.1–3.3 hotové a otestované *(commit: sprint 3)*
- [x] Sprint 4 (Maintainability) — etapy 4.1–4.3 hotové a otestované *(2026-04-15)*
  - [x] 4.1 — `src/lib/logger.ts` ✅
  - [x] 4.2 — `src/lib/errors.test.ts` ✅
  - [x] 4.3 — `src/components/ToastContainer.tsx` extrakce z PlannerPage ✅
- [x] Sprint 5 (PlannerPage decomposition) — hotové a otestované *(2026-04-15)*
  - [x] 5.1 — `src/components/ZoomSlider.tsx` extrakce z PlannerPage ✅
  - [x] 5.2 — `src/components/InfoPanel.tsx` + `src/components/InboxPanel.tsx` extrakce + `src/lib/auditFormatters.ts` ✅
  - [x] 5.3 — `src/lib/plannerTypes.ts` + `src/components/BlockDetail.tsx` + `src/components/BlockEdit.tsx` extrakce ✅
  - [x] 5.4 — `src/lib/scheduleValidationServer.test.ts` — 11 testů pro `validateBlockScheduleFromDb` ✅
  - [x] 5.5 — `npm run build` ✅ + 24/24 testů prochází (8 dateUtils + 5 errors + 11 scheduleValidation) ✅
  - PlannerPage.tsx: 5110 → ~3525 řádků (−1585, −31 %)
- [x] `npm run build` projde bez chyb
- [x] Kompletní test suite prochází — 24/24 testů *(dateUtils + errors + scheduleValidationServer)*

---

## Záměrně odloženo (budoucí vlny)

Tyto položky byly identifikovány v auditu, ale nejsou v aktuálním plánu — jsou buď nízká priorita, nebo vyžadují větší produktové rozhodnutí:

- **Responzivní design** — vyžaduje redesign timeline grid; závisí na tom, zda je tablet cílová platforma
- **Migrace inline styles → Tailwind** — velký rozsah, nízký risk impact, vhodné pro postupný refaktoring při jiných změnách
- **Virtualizace TimelineGrid** (react-window) — jen pokud bude >200 bloků viditelně pomalé
- **Shadcn Calendar jako základ DatePickerField** — custom komponenta funguje, migrace = risk regrese
- **Rate limiting přes Redis** — in-memory stačí pro single-server deployment u Michala
- **Breadcrumby** — nízká priorita, navigace header řeší orientaci
- **Zod pro celý codebase** — postupně při dotyku souborů, ne jednorázový sweep

---

## Reference

- Audit report: viz výstup konverzace ze dne 15. 4. 2026
- Auditované soubory: všechny `src/app/api/**`, `src/lib/**`, `src/app/_components/**`
- Bezpečnostní agent výsledky: 15 nálezů (1 kritický, 4 vysoké)
- UI/UX agent výsledky: 36 nálezů (5 vysokých)
- Code quality agent výsledky: 15 nálezů (4 vysoké)
