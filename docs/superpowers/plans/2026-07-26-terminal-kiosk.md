# Terminálový kiosk launcher — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route `/kiosk` v existující Next.js appce, která dá operátorům u strojů přepínač mezi výrobním plánem a Logicou (obě fullscreen, živé na pozadí), s hands-off kioskovým přihlášením.

**Architecture:** `/kiosk` je lehká server-route → renderuje client komponentu `KioskShell` se dvěma trvale mountovanými iframy (plán same-origin, Logica přes HTTPS proxy), přepínání = jen změna viditelnosti. Terminál se přihlašuje přes bootstrap endpoint `/api/auth/kiosk?device=…&key=…`, který založí dlouhou (365 dní) session pro tiskařský účet daného stroje.

**Tech Stack:** Next.js 16 (App Router) · React client komponenta · JWT session (jose) · Prisma 5 (User lookup) · node:test + tsx pro unit testy.

**Návaznost na spec:** `docs/superpowers/specs/2026-07-26-terminal-kiosk-design.md`.

## Global Constraints

- **Chyby v API routes → `AppError`** (`src/lib/errors.ts`) + catch mapuje přes `errorStatus(err.code)`. Nikdy string-prefix Error.
- **Logování → `logger`** (`src/lib/logger.ts`), nikdy `console.*` v API routes.
- **Bezpečnostní ENV bez fallbacku** — `JWT_SECRET` chybí → throw (už existuje).
- **Design → CSS tokeny** z `src/app/globals.css` (`--bg`/`--surface`/`--brand`/`--text`/`--border`…), nikdy hex/rgba literál. Tailwind v4 nepodporuje dynamické třídy → inline style.
- **Nové standalone komponenty** jako export do `src/components/` (ne inline do velkých souborů).
- **Mouse handlery** začínají `if (e.button !== 0) return;`.
- Testy: `node --test --import tsx src/lib/<soubor>.test.ts`. Build před pushem: `npm run build`.

---

## Prerekvizity (server / Michal — NEblokující, běží paralelně)

Tyto kroky nejsou kód v tomto repu; plán je předpokládá, ale nečeká na ně. Bez nich se `/kiosk` postaví a otestuje (plán iframe funguje lokálně; Logica iframe se ověří na místě).

1. **Per-machine tiskařské účty** — pro každý stroj účet role `TISKAR` s `assignedMachine`.
2. **Reverzní proxy Logiky** — subdoména `https://logica.integraf.cz` → `http://192.168.10.214:81` (Apache vhost + DNS + TLS). Alternativa: Task 5 (Next rewrite).
3. **Mapa stroj → `pntid`** Logiky (test měl `pntid=25`).
4. **Chrome `--kiosk` + autostart** na terminálech, perzistentní profil.

---

## ENV proměnné (doplnit do `.env` / produkčního prostředí)

```bash
# JSON pole kioskových zařízení. key = sdílené tajemství per terminál.
KIOSK_DEVICES='[{"device":"KBA106","key":"REPLACE_ME_LONG_RANDOM","username":"tiskar.kba106","pntid":25}]'
# Základ URL Logiky (přes proxy). Fallback default níže.
KIOSK_LOGICA_BASE='https://logica.integraf.cz'
```

---

## File Structure

- **Create** `src/lib/sessionToken.ts` — čistý podpis JWT (bez `next/headers`), testovatelný.
- **Modify** `src/lib/auth.ts` — `createSessionToken`/`createSession` delegují na `sessionToken.ts` + volitelný TTL.
- **Create** `src/lib/sessionToken.test.ts` — TTL testy.
- **Create** `src/lib/kioskDevices.ts` — parse + čisté resolvery kioskové konfigurace.
- **Create** `src/lib/kioskDevices.test.ts` — testy resolverů.
- **Create** `src/app/api/auth/kiosk/route.ts` — bootstrap endpoint (GET).
- **Create** `src/app/kiosk/page.tsx` — server route.
- **Create** `src/components/kiosk/KioskShell.tsx` — client shell (lišta + 2 iframy).
- **(Optional)** **Modify** `next.config.*` — Task 5 fallback proxy.

---

### Task 1: Testovatelný podpis session tokenu + volitelný TTL

**Files:**
- Create: `src/lib/sessionToken.ts`
- Create: `src/lib/sessionToken.test.ts`
- Modify: `src/lib/auth.ts:43-73`

**Interfaces:**
- Produces: `signSessionToken(user: SessionUser, expiresIn?: string): Promise<string>` (default `"7d"`).
- Produces (změna): `createSession(user: SessionUser, opts?: { days?: number }): Promise<void>` (default 7 dní — zpětně kompatibilní).
- Consumes: `SessionUser` (type) z `src/lib/auth.ts`.

- [ ] **Step 1: Napiš failing test** — `src/lib/sessionToken.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

// JWT_SECRET musí být před importem modulu (auth vyžaduje env).
process.env.JWT_SECRET = "test-secret-aspon-32-znaku-1234567890";

test("signSessionToken: default ~7 dní", async () => {
  const { signSessionToken } = await import("./sessionToken.ts");
  const { decodeJwt } = await import("jose");
  const token = await signSessionToken({ id: 1, username: "a", role: "TISKAR", assignedMachine: null });
  const { iat, exp } = decodeJwt(token);
  assert.ok(iat && exp, "token má iat i exp");
  const days = (exp! - iat!) / 86400;
  assert.ok(Math.abs(days - 7) < 0.1, `čekáno ~7 dní, dostal ${days}`);
});

test("signSessionToken: 365d ~365 dní", async () => {
  const { signSessionToken } = await import("./sessionToken.ts");
  const { decodeJwt } = await import("jose");
  const token = await signSessionToken(
    { id: 1, username: "a", role: "TISKAR", assignedMachine: null },
    "365d"
  );
  const { iat, exp } = decodeJwt(token);
  const days = (exp! - iat!) / 86400;
  assert.ok(Math.abs(days - 365) < 0.5, `čekáno ~365 dní, dostal ${days}`);
});
```

- [ ] **Step 2: Spusť test — musí selhat**

Run: `node --test --import tsx src/lib/sessionToken.test.ts`
Expected: FAIL — `Cannot find module './sessionToken.ts'`.

- [ ] **Step 3: Vytvoř `src/lib/sessionToken.ts`**

```ts
import { SignJWT } from "jose";
import type { SessionUser } from "./auth";

const jwtSecretRaw = process.env.JWT_SECRET;
if (!jwtSecretRaw) {
  throw new Error(
    "[sessionToken] JWT_SECRET env variable is not set. " +
    "Add it to .env (development) or to the production environment."
  );
}
const SECRET = new TextEncoder().encode(jwtSecretRaw);

/** Podepíše JWT session token. `expiresIn` ve formátu jose (např. "7d", "365d"). */
export async function signSessionToken(
  user: SessionUser,
  expiresIn: string = "7d"
): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(SECRET);
}
```

> Pozn.: `import type { SessionUser }` je čistě typový → tsx ho smaže, takže test netahá `next/headers` z `auth.ts`.

- [ ] **Step 4: Spusť test — musí projít**

Run: `node --test --import tsx src/lib/sessionToken.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Přepoj `auth.ts` na `sessionToken.ts` + volitelný TTL**

V `src/lib/auth.ts` nahraď tělo `createSessionToken` a `createSession` (řádky ~43–73):

```ts
import { signSessionToken } from "./sessionToken";

// ... (SECRET, COOKIE, SessionUser, parseJwtPayload zůstávají) ...

/** Vrátí JWT token pro session — pro ruční nastavení cookie v Route Handleru */
export async function createSessionToken(
  user: SessionUser,
  expiresIn: string = "7d"
): Promise<string> {
  return signSessionToken(user, expiresIn);
}

export async function createSession(
  user: SessionUser,
  opts: { days?: number } = {}
) {
  const days = opts.days ?? 7;
  const token = await createSessionToken(user, `${days}d`);
  const { secure } = getCookieOptions();
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * days,
    path: "/",
  });
}
```

> `SECRET` v `auth.ts` zůstává (používá ho `getSession`/`jwtVerify`). Duplikace čtení `JWT_SECRET` ve dvou souborech je záměrná a neškodná.

- [ ] **Step 6: Ověř, že login route stále funguje (beze změny volání)**

Run: `npm run build`
Expected: build projde; `src/app/api/auth/login/route.ts:71` (`createSession({...})` bez druhého argumentu) kompiluje díky defaultu.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sessionToken.ts src/lib/sessionToken.test.ts src/lib/auth.ts
git commit -m "feat(auth): volitelný TTL session + testovatelný sessionToken pro kiosk"
```

---

### Task 2: Kioskové zařízení — konfigurace a resolvery

**Files:**
- Create: `src/lib/kioskDevices.ts`
- Create: `src/lib/kioskDevices.test.ts`

**Interfaces:**
- Produces: `type KioskDevice = { device: string; key: string; username: string; pntid: number }`
- Produces: `parseKioskDevices(raw: string | undefined): KioskDevice[]`
- Produces: `resolveKioskDeviceByKey(devices: KioskDevice[], device: string, key: string): KioskDevice | null`
- Produces: `pntidForUsername(devices: KioskDevice[], username: string): number | null`
- Produces: `getKioskDevices(): KioskDevice[]` (čte `process.env.KIOSK_DEVICES`, cachuje)

- [ ] **Step 1: Napiš failing test** — `src/lib/kioskDevices.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseKioskDevices,
  resolveKioskDeviceByKey,
  pntidForUsername,
} from "./kioskDevices.ts";

const SAMPLE = '[{"device":"KBA106","key":"secret1","username":"tiskar.kba106","pntid":25}]';

test("parseKioskDevices: prázdný/undefined → []", () => {
  assert.deepEqual(parseKioskDevices(undefined), []);
  assert.deepEqual(parseKioskDevices(""), []);
});

test("parseKioskDevices: validní JSON", () => {
  const d = parseKioskDevices(SAMPLE);
  assert.equal(d.length, 1);
  assert.equal(d[0].pntid, 25);
  assert.equal(d[0].username, "tiskar.kba106");
});

test("parseKioskDevices: nevalidní JSON → throw", () => {
  assert.throws(() => parseKioskDevices("{není json"));
});

test("parseKioskDevices: chybějící pole → throw", () => {
  assert.throws(() => parseKioskDevices('[{"device":"X"}]'));
});

test("resolveKioskDeviceByKey: správný klíč → entry", () => {
  const d = parseKioskDevices(SAMPLE);
  const m = resolveKioskDeviceByKey(d, "KBA106", "secret1");
  assert.equal(m?.username, "tiskar.kba106");
});

test("resolveKioskDeviceByKey: špatný klíč → null", () => {
  const d = parseKioskDevices(SAMPLE);
  assert.equal(resolveKioskDeviceByKey(d, "KBA106", "špatně"), null);
});

test("resolveKioskDeviceByKey: neznámé zařízení → null", () => {
  const d = parseKioskDevices(SAMPLE);
  assert.equal(resolveKioskDeviceByKey(d, "NEEXISTUJE", "secret1"), null);
});

test("pntidForUsername: najde pntid", () => {
  const d = parseKioskDevices(SAMPLE);
  assert.equal(pntidForUsername(d, "tiskar.kba106"), 25);
  assert.equal(pntidForUsername(d, "nikdo"), null);
});
```

- [ ] **Step 2: Spusť test — musí selhat**

Run: `node --test --import tsx src/lib/kioskDevices.test.ts`
Expected: FAIL — `Cannot find module './kioskDevices.ts'`.

- [ ] **Step 3: Vytvoř `src/lib/kioskDevices.ts`**

```ts
export type KioskDevice = {
  device: string;
  key: string;
  username: string;
  pntid: number;
};

/** Naparsuje a zvaliduje ENV `KIOSK_DEVICES` (JSON pole). Prázdné → []. */
export function parseKioskDevices(raw: string | undefined): KioskDevice[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("[kioskDevices] KIOSK_DEVICES není validní JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("[kioskDevices] KIOSK_DEVICES musí být JSON pole.");
  }
  return parsed.map((e, i) => {
    const o = e as Record<string, unknown>;
    if (
      typeof o.device !== "string" ||
      typeof o.key !== "string" ||
      typeof o.username !== "string" ||
      typeof o.pntid !== "number"
    ) {
      throw new Error(`[kioskDevices] neplatná položka na indexu ${i}.`);
    }
    return { device: o.device, key: o.key, username: o.username, pntid: o.pntid };
  });
}

/** Vrátí zařízení jen když sedí device i key. Jinak null. */
export function resolveKioskDeviceByKey(
  devices: KioskDevice[],
  device: string,
  key: string
): KioskDevice | null {
  const d = devices.find((x) => x.device === device);
  if (!d) return null;
  if (d.key !== key) return null;
  return d;
}

/** pntid Logiky pro daný tiskařský účet, nebo null. */
export function pntidForUsername(
  devices: KioskDevice[],
  username: string
): number | null {
  const d = devices.find((x) => x.username === username);
  return d ? d.pntid : null;
}

let cached: KioskDevice[] | null = null;
/** Runtime přístup k naparsované konfiguraci (cachováno). */
export function getKioskDevices(): KioskDevice[] {
  if (cached) return cached;
  cached = parseKioskDevices(process.env.KIOSK_DEVICES);
  return cached;
}
```

- [ ] **Step 4: Spusť test — musí projít**

Run: `node --test --import tsx src/lib/kioskDevices.test.ts`
Expected: PASS (8/8).

- [ ] **Step 5: Commit**

```bash
git add src/lib/kioskDevices.ts src/lib/kioskDevices.test.ts
git commit -m "feat(kiosk): konfigurace kioskových zařízení + resolvery"
```

---

### Task 3: Bootstrap endpoint `/api/auth/kiosk`

**Files:**
- Create: `src/app/api/auth/kiosk/route.ts`

**Interfaces:**
- Consumes: `getKioskDevices`, `resolveKioskDeviceByKey` (Task 2); `createSession` (Task 1); `prisma`; `AppError`/`isAppError`/`errorStatus`; `logger`.
- Produces: `GET` handler — na `?device=…&key=…` založí 365denní session a redirectne na `/kiosk`.

- [ ] **Step 1: Vytvoř `src/app/api/auth/kiosk/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { getKioskDevices, resolveKioskDeviceByKey } from "@/lib/kioskDevices";
import { AppError, isAppError, errorStatus } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Kioskové hands-off přihlášení. Terminál se poprvé (nebo po ztrátě session)
 * spustí na /api/auth/kiosk?device=<stroj>&key=<klíč>; endpoint ověří klíč,
 * najde tiskařský účet a založí dlouhou (365 dní) session, pak redirect na /kiosk.
 * Leží pod /api/auth/* → middleware ho pouští bez cookie.
 */
export async function GET(req: NextRequest) {
  try {
    const device = req.nextUrl.searchParams.get("device") ?? "";
    const key = req.nextUrl.searchParams.get("key") ?? "";

    const match = resolveKioskDeviceByKey(getKioskDevices(), device, key);
    if (!match) {
      throw new AppError("UNAUTHORIZED", "Neplatné kioskové zařízení nebo klíč.");
    }

    const user = await prisma.user.findUnique({ where: { username: match.username } });
    if (!user) {
      throw new AppError("NOT_FOUND", `Kioskový účet '${match.username}' neexistuje.`);
    }

    await createSession(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        assignedMachine: user.assignedMachine ?? null,
      },
      { days: 365 }
    );

    return NextResponse.redirect(new URL("/kiosk", req.url));
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    }
    logger.error("[api/auth/kiosk] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build projde, endpoint se zaregistruje jako `/api/auth/kiosk`.

- [ ] **Step 3: Manuální smoke test (dev)**

Nastav v `.env` `KIOSK_DEVICES='[{"device":"KBA106","key":"secret1","username":"<existující_tiskar>","pntid":25}]'` (použij reálný TISKAR username z dev DB), restart dev serveru.

```bash
# špatný klíč → 401 JSON
curl -si "http://localhost:3000/api/auth/kiosk?device=KBA106&key=WRONG" | head -5
# správný klíč → 307/302 redirect na /kiosk + Set-Cookie: integraf-session
curl -si "http://localhost:3000/api/auth/kiosk?device=KBA106&key=secret1" | head -12
```
Expected: první `HTTP/1.1 401`; druhý redirect (`location: /kiosk`) a `set-cookie: integraf-session=…`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/kiosk/route.ts
git commit -m "feat(kiosk): bootstrap endpoint /api/auth/kiosk (hands-off login)"
```

---

### Task 4: Route `/kiosk` + komponenta `KioskShell`

**Files:**
- Create: `src/app/kiosk/page.tsx`
- Create: `src/components/kiosk/KioskShell.tsx`

**Interfaces:**
- Consumes: `getSession` (auth); `getKioskDevices`/`pntidForUsername` (Task 2).
- Produces: `KioskShell` (named export) s props `{ machine: string | null; planUrl: string; logicaUrl: string | null; defaultView?: "plan" | "data" }`.

- [ ] **Step 1: Vytvoř `src/components/kiosk/KioskShell.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

type View = "plan" | "data";

type Props = {
  machine: string | null;
  planUrl: string;
  logicaUrl: string | null;
  defaultView?: View;
};

export function KioskShell({ machine, planUrl, logicaUrl, defaultView = "data" }: Props) {
  const [view, setView] = useState<View>(logicaUrl ? defaultView : "plan");
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
      );
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  const tabBtn = (v: View, label: string) => {
    const active = view === v;
    return (
      <button
        role="tab"
        aria-selected={active}
        onClick={(e) => {
          if (e.button !== 0) return;
          setView(v);
        }}
        style={{
          appearance: "none",
          border: 0,
          font: "inherit",
          fontSize: 18,
          fontWeight: 600,
          padding: "14px 32px",
          borderRadius: 10,
          cursor: "pointer",
          color: active ? "var(--brand-contrast)" : "var(--text)",
          background: active ? "var(--brand)" : "transparent",
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <header
        style={{
          flex: "0 0 auto",
          height: 68,
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "0 18px",
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <strong style={{ color: "var(--text)", fontSize: 15 }}>Integraf terminál</strong>
        <div
          role="tablist"
          aria-label="Přepínání aplikací"
          style={{ display: "inline-flex", gap: 6, background: "var(--surface-2)", padding: 4, borderRadius: 12 }}
        >
          {tabBtn("data", "Sběr dat")}
          {tabBtn("plan", "Plánování")}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16, color: "var(--text-muted)" }}>
          {machine && <span>Stroj <strong style={{ color: "var(--text)" }}>{machine}</strong></span>}
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{clock}</span>
        </div>
      </header>

      <div style={{ flex: "1 1 auto", position: "relative", minHeight: 0 }}>
        <iframe
          title="Plánování"
          src={planUrl}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            border: 0,
            visibility: view === "plan" ? "visible" : "hidden",
          }}
        />
        {logicaUrl ? (
          <iframe
            title="Sběr dat"
            src={logicaUrl}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              border: 0,
              visibility: view === "data" ? "visible" : "hidden",
            }}
          />
        ) : (
          view === "data" && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                color: "var(--text-muted)",
                textAlign: "center",
                padding: 24,
              }}
            >
              Tento terminál nemá přiřazený panel Logiky (chybí v KIOSK_DEVICES).
            </div>
          )
        )}
      </div>
    </div>
  );
}
```

> Oba iframy jsou **trvale v DOM**; přepíná se jen `visibility` → obě appky zůstanou živé. `useRef` import ponech pouze pokud ho použiješ; jinak ho z importu odeber, ať lint nehlásí unused.

- [ ] **Step 2: Vytvoř `src/app/kiosk/page.tsx`**

```tsx
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getKioskDevices, pntidForUsername } from "@/lib/kioskDevices";
import { KioskShell } from "@/components/kiosk/KioskShell";

export default async function KioskPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const pntid = pntidForUsername(getKioskDevices(), session.username);
  const logicaBase = process.env.KIOSK_LOGICA_BASE ?? "https://logica.integraf.cz";
  const logicaUrl = pntid != null ? `${logicaBase}/machinepanelhand.aspx?pntid=${pntid}` : null;

  return (
    <KioskShell
      machine={session.assignedMachine}
      planUrl="/"
      logicaUrl={logicaUrl}
      defaultView="data"
    />
  );
}
```

- [ ] **Step 3: Build + lint**

Run: `npm run build && npm run lint`
Expected: build projde; lint 0 chyb (unused import `useRef` odeber, pokud ho nepoužíváš).

- [ ] **Step 4: Manuální ověření lokálně**

1. Přihlas se lokálně (`http://localhost:3000/login`) jako jakýkoli uživatel, nebo přes bootstrap endpoint z Tasku 3.
2. Otevři `http://localhost:3000/kiosk`.
3. Ověř: lišta se dvěma tlačítky, default aktivní **Sběr dat**; klik na **Plánování** → uvidíš plán (`/`) v iframu; klik zpět → Logica (lokálně nedostupná = prázdno/chyba prohlížeče, to je OK — testuje se na místě). Přepínání nereloaduje (obě už mountnuté).
4. Jmenovka stroje a hodiny v liště sedí.

- [ ] **Step 5: Commit**

```bash
git add src/app/kiosk/page.tsx src/components/kiosk/KioskShell.tsx
git commit -m "feat(kiosk): route /kiosk + KioskShell (přepínač plán/Logica, default Sběr dat)"
```

---

### Task 5 (OPTIONAL — jen fallback místo subdomény): Next.js proxy na Logicu

Použij **jen** pokud se nepůjde cestou subdomény `logica.integraf.cz` (prerekvizita 2). Riziko: Logica (ASP.NET) může mít root-absolutní cesty ke zdrojům, které se pod subpath rozbijí — proto je subdoména preferovaná.

**Files:**
- Modify: `next.config.*` (kořen repo)

- [ ] **Step 1: Přidej rewrite do `next.config`**

```ts
async rewrites() {
  return [
    { source: "/logica/:path*", destination: "http://192.168.10.214:81/:path*" },
  ];
}
```

- [ ] **Step 2: Přepni ENV base na proxy path**

```bash
KIOSK_LOGICA_BASE='/logica'
```

- [ ] **Step 3: Build + manuální ověření na firemní síti** — `https://planovani.integraf.cz/kiosk`, Sběr dat vykreslí Logicu bez mixed-content chyby a bez rozbitých zdrojů.

- [ ] **Step 4: Commit**

```bash
git add next.config.*
git commit -m "feat(kiosk): fallback Next rewrite proxy na Logicu (/logica)"
```

---

## Ověření na místě (firemní síť / terminál — po nasazení)

Nelze z dev prostředí; checklist pro nasazení (viz `docs/DEPLOY_WORKFLOW.md`, před zásahem na produkci `mysqldump` záloha):

- [ ] Proxy `https://logica.integraf.cz` vrací Logicu přes HTTPS (žádné mixed content).
- [ ] `/api/auth/kiosk?device=…&key=…` na produkci založí session a redirectne na `/kiosk`.
- [ ] Na `/kiosk` se **Sběr dat** i **Plánování** vykreslí; přepínání zachová stav Logiky (počítadlo běží dál).
- [ ] Chrome `--kiosk` autostart naběhne rovnou na kiosk; po rebootu session drží.
- [ ] Session ~365 dní (kontrola `exp` v tokenu).

---

## Self-Review (proti specu)

- **§4.1 route /kiosk** → Task 4 ✓
- **§4.2 KioskShell (2 iframy, default data, tokeny, a11y)** → Task 4 ✓
- **§4.3 proxy Logica** → prerekvizita 2 (subdoména) + Task 5 (fallback) ✓
- **§4.4 kioskové přihlášení (dlouhá session + bootstrap)** → Task 1 (TTL) + Task 3 (endpoint) ✓
- **§4.5 Chrome kiosk** → prerekvizita 4 (server ops, ne kód) ✓
- **§7 chyby** → endpoint AppError mapování ✓; iframe fallback (logicaUrl null) v KioskShell ✓
- **§8 bezpečnost** → key ověření (Task 2 test špatný klíč → null), httpOnly/secure cookie beze změny ✓
- **§2 ne-cíle** → párování zakázek NEimplementováno ✓ (mimo rozsah)
- **`?embed=1`** (spec §4.2, „zpřesnění, ne blocker") → **záměrně vynecháno z MVP** (YAGNI); plán iframe jede s vlastní hlavičkou. Doplní se samostatně, pokud dvě lišty budou vadit.
