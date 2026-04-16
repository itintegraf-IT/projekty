# User Preferences Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ukládat nastavení zobrazení planneru (zoom, šířka sidebaru) na server per-user, aby se nastavení zachovalo při přihlášení z jiného zařízení.

**Architecture:** Nová Prisma tabulka `UserPreference` (userId + key + value, unique constraint na userId+key) ukládá preference na server. Frontend při mountu načte z localStorage okamžitě (žádný flash), pak asynchronně přepíše hodnotami ze serveru. Při změně uloží do localStorage ihned a na server s debounce 500 ms. Klíče: `"zoom"`, `"aside-width"`, `"dtp-panel-width"`.

**Tech Stack:** Prisma 5 + MySQL, Next.js App Router API routes, React useState lazy initializer, fetch + setTimeout debounce

---

## Dotčené soubory

| Soubor | Akce | Co se mění |
|---|---|---|
| `prisma/schema.prisma` | Modify | Přidat model `UserPreference` + relaci na `User` |
| `prisma/migrations/...` | Create | Automaticky přes `prisma migrate dev` |
| `src/app/api/me/preferences/route.ts` | Create | GET + PUT endpoint pro user preferences |
| `src/app/_components/PlannerPage.tsx` | Modify | Load z API na mountu, debounced save, lazy initializer pro slotHeight a asideWidth |

---

## Task 1: Prisma schema — model UserPreference

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Přidat model UserPreference a relaci na User**

Otevři `prisma/schema.prisma`. Na konci souboru za modelem `User` přidej nový model a uprav `User`:

```prisma
// Stávající User model — přidej jeden řádek (preferences):
model User {
  id              Int              @id @default(autoincrement())
  username        String           @unique
  passwordHash    String
  role            String           @default("VIEWER")
  createdAt       DateTime         @default(now())
  assignedMachine String?
  preferences     UserPreference[]
}

// Nový model — přidej za User:
model UserPreference {
  id     Int    @id @default(autoincrement())
  userId Int
  key    String
  value  String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, key])
  @@index([userId])
}
```

- [ ] **Step 2: Spustit migraci**

```bash
npx prisma migrate dev --name add_user_preferences
```

Očekávaný výstup: `Your database is now in sync with your schema.`

- [ ] **Step 3: Ověřit build (TypeScript typy se musí vygenerovat)**

```bash
npm run build 2>&1 | tail -20
```

Očekávaný výstup: build projde (0 errors).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add UserPreference model for persisting planner display settings"
```

---

## Task 2: API endpoint GET + PUT /api/me/preferences

**Files:**
- Create: `src/app/api/me/preferences/route.ts`

- [ ] **Step 1: Vytvořit soubor route.ts**

Vytvoř soubor `src/app/api/me/preferences/route.ts` s tímto obsahem:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { AppError, isAppError } from "@/lib/errors";

function errorStatus(code: string): number {
  if (code === "FORBIDDEN" || code === "NOT_FOUND") return code === "FORBIDDEN" ? 403 : 404;
  if (code === "VALIDATION_ERROR") return 400;
  return 500;
}

// GET /api/me/preferences
// Vrátí všechny uložené preference přihlášeného uživatele jako { key: value }
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Nepřihlášen." }, { status: 401 });

    const prefs = await prisma.userPreference.findMany({
      where: { userId: session.id },
    });

    const result: Record<string, string> = {};
    for (const p of prefs) result[p.key] = p.value;

    return NextResponse.json(result);
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    logger.error("[preferences GET] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}

// PUT /api/me/preferences
// Body: { key: string, value: string }
// Uloží nebo aktualizuje jednu preferenci přihlášeného uživatele (upsert)
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Nepřihlášen." }, { status: 401 });

    const body = await request.json();
    const { key, value } = body ?? {};

    if (typeof key !== "string" || key.trim() === "") {
      throw new AppError("VALIDATION_ERROR", "Parametr key musí být neprázdný string.");
    }
    if (typeof value !== "string") {
      throw new AppError("VALIDATION_ERROR", "Parametr value musí být string.");
    }
    if (key.length > 64 || value.length > 256) {
      throw new AppError("VALIDATION_ERROR", "Parametry key nebo value jsou příliš dlouhé.");
    }

    await prisma.userPreference.upsert({
      where: { userId_key: { userId: session.id, key } },
      create: { userId: session.id, key, value },
      update: { value },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    logger.error("[preferences PUT] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Ověřit TypeScript typy buildem**

```bash
npm run build 2>&1 | tail -20
```

Očekávaný výstup: 0 errors.

- [ ] **Step 3: Manuální test endpointu (pokud běží dev server)**

```bash
# GET — musí vrátit {} (prázdné preference) pro nového uživatele
# Použij cookies z přihlášeného browseru nebo přeskočit na ruční test v prohlížeči

# PUT — test validace (neplatný key)
curl -X PUT http://localhost:3000/api/me/preferences \
  -H "Content-Type: application/json" \
  -d '{"key": "", "value": "26"}' \
  -b "integraf-session=<session-cookie>"
# Očekávaný výsledek: 400 {"error":"Parametr key musí být neprázdný string."}
```

Pokud dev server neběží, tento krok přeskoč — build test stačí.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/me/preferences/route.ts
git commit -m "feat: add GET/PUT /api/me/preferences endpoint for user display preferences"
```

---

## Task 3: PlannerPage — load z API + debounced save

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx`

Hlavní změny:
1. `slotHeight` — změnit `useState(26)` na lazy initializer z localStorage (eliminuje race condition save efektu)
2. `asideWidth` — stejně (lazy initializer místo `useState(320)`)
3. Existující load `useEffect([])` — přidat fetch na server, výsledek aplikovat po odpovědi
4. Existující save efekty — přidat debounced PUT na server

- [ ] **Step 1: Přidat `savePreference` helper a `prefsLoadedRef` do PlannerPage**

Najdi v `src/app/_components/PlannerPage.tsx` sekci kolem řádku 642 (začátek zoom state). Uprav tak, aby:

**a) `slotHeight` používal lazy initializer:**

Stará verze (řádek ~643):
```typescript
const [slotHeight, setSlotHeight] = useState(26);
```

Nová verze:
```typescript
const [slotHeight, setSlotHeight] = useState<number>(() => {
  if (typeof window === "undefined") return 26;
  const z = localStorage.getItem("ig-planner-zoom");
  return z ? Math.max(3, Math.min(26, Number(z))) : 26;
});
```

**b) Přidat `prefsSavedRef` a `savePreference` hned za `slotHeight` state (před `zoomAnchorMs`):**

```typescript
// Ref pro debounced ukladani preferenci na server
const prefsSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

function savePreference(key: string, value: string) {
  // Okamžitě do localStorage (optimistický cache)
  localStorage.setItem(`ig-planner-${key}`, value);
  // Debounced uložení na server
  clearTimeout(prefsSaveTimers.current[key]);
  prefsSaveTimers.current[key] = setTimeout(() => {
    fetch("/api/me/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    }).catch(() => {}); // tiché selhání — localStorage fallback zůstane
  }, 500);
}
```

- [ ] **Step 2: Přidat lazy initializer pro `asideWidth`**

Najdi `useState(320)` u `asideWidth` (řádek ~679):

Stará verze:
```typescript
const [asideWidth, setAsideWidth] = useState(320);
```

Nová verze:
```typescript
const [asideWidth, setAsideWidth] = useState<number>(() => {
  if (typeof window === "undefined") return 320;
  const w = localStorage.getItem("ig-planner-aside-width");
  return w ? Math.max(200, Math.min(600, Number(w))) : 320;
});
```

- [ ] **Step 3: Upravit mount useEffect — přidat server fetch**

Najdi stávající mount useEffect (řádek ~667):

```typescript
useEffect(() => {
  const q = new URLSearchParams(window.location.search).get("q");
  if (q) setFilterText(q);
  const z = localStorage.getItem("ig-planner-zoom");
  if (z) setSlotHeight(Math.max(3, Math.min(26, Number(z))));
  const w = localStorage.getItem("ig-planner-aside-width");
  if (w) setAsideWidth(Math.max(200, Math.min(600, Number(w))));
}, []);
```

Nahraď celý useEffect tímto:

```typescript
useEffect(() => {
  const q = new URLSearchParams(window.location.search).get("q");
  if (q) setFilterText(q);

  // Načtení preferencí ze serveru — přepíše localStorage pokud server má novější data
  fetch("/api/me/preferences")
    .then((r) => r.json())
    .then((prefs: Record<string, string>) => {
      if (prefs["zoom"]) {
        const v = Math.max(3, Math.min(26, Number(prefs["zoom"])));
        setSlotHeight(v);
        localStorage.setItem("ig-planner-zoom", String(v));
      }
      if (prefs["aside-width"]) {
        const v = Math.max(200, Math.min(600, Number(prefs["aside-width"])));
        setAsideWidth(v);
        localStorage.setItem("ig-planner-aside-width", String(v));
      }
      if (prefs["dtp-panel-width"]) {
        const v = parseInt(prefs["dtp-panel-width"], 10);
        if (!isNaN(v)) {
          setDtpPanelWidth(v);
          localStorage.setItem("ig-planner-dtp-panel-width", String(v));
        }
      }
    })
    .catch(() => {}); // tiché selhání — localStorage hodnoty z lazy initializerů zůstanou
}, []);
```

Poznámka: `localStorage.getItem` pro `slotHeight` a `asideWidth` v mountu už NENÍ potřeba — lazy initializer to obstarává synchronně při prvním renderu. URL query parametr `?q=` zůstává.

- [ ] **Step 4: Upravit save efekty — přidat server save**

Najdi stávající save efekty (řádky ~676 a ~701):

```typescript
useEffect(() => { localStorage.setItem("ig-planner-zoom", String(slotHeight)); }, [slotHeight]);
// ...
useEffect(() => { localStorage.setItem("ig-planner-aside-width", String(asideWidth)); }, [asideWidth]);
// ...
useEffect(() => {
  localStorage.setItem("ig-planner-dtp-panel-width", String(dtpPanelWidth));
}, [dtpPanelWidth]);
```

Nahraď je takto:

```typescript
useEffect(() => { savePreference("zoom", String(slotHeight)); }, [slotHeight]);
// ...
useEffect(() => { savePreference("aside-width", String(asideWidth)); }, [asideWidth]);
// ...
useEffect(() => { savePreference("dtp-panel-width", String(dtpPanelWidth)); }, [dtpPanelWidth]);
```

Poznámka: `savePreference` volá `localStorage.setItem` a zároveň debounced PUT na server. Funkce `savePreference` nemusí být v `useCallback` — je definovaná uvnitř komponenty a efekty ji uzavřou přes closure. React ESLint může upozornit na missing dependency — přidej `// eslint-disable-line react-hooks/exhaustive-deps` na každý z těchto efektů pokud lint selže.

- [ ] **Step 5: Ověřit TypeScript build**

```bash
npm run build 2>&1 | tail -30
```

Očekávaný výstup: 0 errors. Pokud lint hlásí `react-hooks/exhaustive-deps` pro save efekty, přidej komentář `// eslint-disable-line react-hooks/exhaustive-deps`.

- [ ] **Step 6: Manuální test v prohlížeči**

1. Spusť dev server: `npm run dev`
2. Přihlaš se do planneru
3. Změň zoom sliderem na jinou hodnotu
4. Počkej 1 sekundu (debounce)
5. V DevTools → Network zkontroluj, že proběhl `PUT /api/me/preferences` s `{"key":"zoom","value":"X"}`
6. V DevTools → Application → Local Storage zkontroluj, že `ig-planner-zoom` má správnou hodnotu
7. Odhlás se a znovu přihlaš — zoom musí zůstat stejný
8. Otevři jinou instanci prohlížeče (nebo incognito) se stejnými přihlašovacími údaji — zoom musí být stejný jako nastavený

- [ ] **Step 7: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat: persist planner display preferences per-user via server API"
```

---

## Self-Review

**Spec coverage:**
- ✅ Nastavení se pamatuje per-user (server-side) → Task 1 + Task 2
- ✅ Persistence cross-device → server DB, nezávislé na localStorage
- ✅ Žádný flash / race condition → lazy initializer pro okamžité localStorage hodnoty
- ✅ Fallback na localStorage pokud server nedostupný → catch(() => {}) v fetch
- ✅ DTP panel width také persistuje → zahrnut v Task 3

**Placeholder scan:** Žádné TBD. Všechny kroky obsahují konkrétní kód.

**Type consistency:**
- `savePreference(key: string, value: string)` definována v Task 3 Step 1, volána v Task 3 Step 4 — konzistentní
- `userId_key` v Prisma upsert odpovídá `@@unique([userId, key])` definované v Task 1 — konzistentní
- Klíče `"zoom"`, `"aside-width"`, `"dtp-panel-width"` konzistentní přes GET, PUT i frontend
