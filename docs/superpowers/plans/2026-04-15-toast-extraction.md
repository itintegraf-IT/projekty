# ToastContainer Extraction — Implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extrahovat komponentu `ToastContainer` a typ `Toast` z `PlannerPage.tsx` do samostatného souboru `src/components/ToastContainer.tsx` — čistě přesunutí kódu, nulový redesign.

**Architecture:** Přesuneme typ `Toast`, komponentu `ToastContainer` a logiku `showToast` (hook) do nového souboru. `PlannerPage.tsx` bude importovat místo lokální definice. Animace `toast-in` je již v `globals.css` — nesdílíme nic extra. Žádná nová API, žádné nové propsy — zachováme přesné chování.

**Tech Stack:** Next.js 15, TypeScript, React (useState, useRef), Tailwind CSS v4 (globals.css)

---

## Soubory

| Akce | Soubor | Co se mění |
|------|--------|------------|
| **Vytvořit** | `src/components/ToastContainer.tsx` | Přesun: typ `Toast`, komponenta `ToastContainer`, hook `useToast` |
| **Upravit** | `src/app/_components/PlannerPage.tsx` | Import z nového souboru, smazat lokální definice |

---

## Task 1: Přečíst a ověřit současný stav

**Soubory:**
- Číst: `src/app/_components/PlannerPage.tsx` (řádky 121, 2038–2077, 2144–2150, 5154)
- Číst: `src/app/globals.css` (řádky 5–8 — `@keyframes toast-in`)

- [ ] **Krok 1:** Ověř, že `Toast` typ je na řádku 121 v `PlannerPage.tsx`:
  ```typescript
  type Toast = { id: number; message: string; type: "success" | "error" | "info" };
  ```

- [ ] **Krok 2:** Ověř, že `ToastContainer` funkce je na řádcích 2038–2077 v `PlannerPage.tsx` a má přesně tyto propsy:
  ```typescript
  function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void })
  ```

- [ ] **Krok 3:** Ověř toast systém v PlannerPage (řádky 2144–2150):
  ```typescript
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  function showToast(message: string, type: Toast["type"] = "info") {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }
  ```

- [ ] **Krok 4:** Ověř použití na řádku 5154:
  ```typescript
  <ToastContainer toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
  ```

- [ ] **Krok 5:** Ověř, že `@keyframes toast-in` je v `src/app/globals.css` (řádky 5–8) — tuto animaci **nepřesouváme**, je sdílená globálně.

---

## Task 2: Vytvořit `src/components/ToastContainer.tsx`

**Soubory:**
- Vytvořit: `src/components/ToastContainer.tsx`

- [ ] **Krok 1:** Vytvoř soubor `src/components/ToastContainer.tsx` s přesně tímto obsahem (kopírujeme z PlannerPage, nepřepisujeme):

  ```typescript
  "use client";

  import { useState, useRef } from "react";

  export type Toast = { id: number; message: string; type: "success" | "error" | "info" };

  export function ToastContainer({
    toasts,
    onDismiss,
  }: {
    toasts: Toast[];
    onDismiss: (id: number) => void;
  }) {
    if (toasts.length === 0) return null;
    const borderColor = { success: "var(--success)", error: "var(--danger)", info: "var(--info)" };
    return (
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "color-mix(in oklab, var(--surface) 92%, transparent)",
              backdropFilter: "blur(12px)",
              borderTop: "1px solid var(--border)",
              borderRight: "1px solid var(--border)",
              borderBottom: "1px solid var(--border)",
              borderLeft: `3px solid ${borderColor[t.type]}`,
              borderRadius: 10,
              padding: "10px 14px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              minWidth: 220,
              maxWidth: 340,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
              fontSize: 13,
              color: "var(--text)",
              pointerEvents: "auto",
              animation: "toast-in 0.15s ease-out",
            }}
          >
            <span style={{ flex: 1, lineHeight: 1.4 }}>{t.message}</span>
            <button
              type="button"
              aria-label="Zavřít oznámení"
              onClick={() => onDismiss(t.id)}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    );
  }

  export function useToast() {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastIdRef = useRef(0);

    function showToast(message: string, type: Toast["type"] = "info") {
      const id = ++toastIdRef.current;
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
    }

    function dismissToast(id: number) {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }

    return { toasts, showToast, dismissToast };
  }
  ```

  > **Poznámka k `useToast` hooku:** `showToast` logika a state jsou v PlannerPage lokální — přesouváme je do hooku, aby PlannerPage nemusela znát implementaci. Chování je identické (4000ms timeout, auto-remove).

- [ ] **Krok 2:** Ověř, že soubor existuje:
  ```bash
  ls src/components/ToastContainer.tsx
  ```
  Očekávaný výsledek: soubor nalezen.

---

## Task 3: Upravit `PlannerPage.tsx` — import a smazání lokálního kódu

**Soubory:**
- Upravit: `src/app/_components/PlannerPage.tsx`

- [ ] **Krok 1:** Na začátek importů v `PlannerPage.tsx` přidej import nových exportů. Najdi sekci importů (první řádky souboru) a přidej:
  ```typescript
  import { Toast, ToastContainer, useToast } from "@/components/ToastContainer";
  ```

- [ ] **Krok 2:** Smaž lokální definici typu `Toast` z řádku 121:
  ```typescript
  // SMAZAT tento řádek:
  type Toast = { id: number; message: string; type: "success" | "error" | "info" };
  ```

- [ ] **Krok 3:** Smaž celou lokální `ToastContainer` funkci (řádky 2038–2077 včetně komentáře):
  ```typescript
  // SMAZAT od tohoto komentáře:
  // ─── ToastContainer ──────────────────────────────────────────────────────────
  function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
    // ... celé tělo ...
  }
  ```

- [ ] **Krok 4:** Najdi v těle `PlannerPage` (uvnitř funkce, přibližně řádky 2144–2150) lokální toast state a `showToast` funkci:
  ```typescript
  // ── Toast systém ──
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  function showToast(message: string, type: Toast["type"] = "info") {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }
  ```
  Nahraď za:
  ```typescript
  // ── Toast systém ──
  const { toasts, showToast, dismissToast } = useToast();
  ```

- [ ] **Krok 5:** Najdi použití `ToastContainer` na řádku 5154 (poslední řádek JSX v `main`):
  ```typescript
  <ToastContainer toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
  ```
  Nahraď za:
  ```typescript
  <ToastContainer toasts={toasts} onDismiss={dismissToast} />
  ```

---

## Task 4: TypeScript build check

**Soubory:**
- Číst výstup příkazu

- [ ] **Krok 1:** Spusť TypeScript build:
  ```bash
  npm run build
  ```
  Očekávaný výsledek: `✓ Compiled successfully` bez TypeScript chyb.

  Pokud selže:
  - Chyba `Toast is not defined` → ověř, že lokální `type Toast` byl smazán a import funguje
  - Chyba `useToast is not defined` → ověř import na začátku PlannerPage.tsx
  - Chyba `dismissToast is not a function` → ověř, že `useToast()` vrací `dismissToast`
  - Chyba na `useState`/`useRef` v ToastContainer.tsx → ověř, že soubor začíná `"use client";` a má import z `"react"`

---

## Task 5: Manuální test v prohlížeči

**Soubory:**
- Spustit dev server

- [ ] **Krok 1:** Spusť dev server:
  ```bash
  npm run dev
  ```

- [ ] **Krok 2:** Přihlas se jako `admin` / `admin` na `http://localhost:3000`.

- [ ] **Krok 3:** Vyvolej toast — nejsnazší způsob:
  - Klikni na blok na timeline → v BlockDetail klikni **Smazat** → potvrzovací dialog → potvrď.
  - Mělo by se objevit: červený toast dole vpravo se zprávou, zmizí po 4 sekundách.

- [ ] **Krok 4:** Vyvolej úspěšný toast:
  - Přesuň blok drag&drop na jinou pozici → ulož.
  - Nebo v `/rezervace` odešli upozornění obchodníkovi → zelený toast.

- [ ] **Krok 5:** Klikni na `×` tlačítko na toastu — toast musí okamžitě zmizet (dismiss).

- [ ] **Krok 6:** Zkontroluj, že toast má správnou animaci (slide-up, 0.15s ease-out) a Apple-style styl (blur, border-left barevný dle typu).

---

## Checklist před dokončením

- [ ] `npm run build` projde bez chyb
- [ ] Toast se zobrazí po akci v planneru
- [ ] Toast zmizí automaticky po 4 sekundách
- [ ] Klik na × toast okamžitě odstraní
- [ ] Červený toast pro error, zelený pro success, neutrální pro info
- [ ] PlannerPage.tsx neobsahuje lokální `type Toast` ani lokální `function ToastContainer`
- [ ] `src/components/ToastContainer.tsx` existuje a exportuje `Toast`, `ToastContainer`, `useToast`
