# Série editace — ochrana per-occurrence polí — Implementation Plan

> **Stav:** DOKONČENO 2026-05-27. Plán slouží jako záznam o provedené opravě.

**Goal:** Při „Uložit změny → Celou sérii" zamezit, aby se hodnoty per-occurrence polí (termíny, ready flagy, sklad/vydání) z editované instance propagovaly do všech sourozenců rekurenční série, čímž se přepisovaly historicky správné hodnoty každé instance.

**Architecture:** Čistě klient-strana úprava. Helper `stripSeriesPropagatedFields` v `src/lib/seriesPropagation.ts` ořeže payload pro propagaci na ostatní sourozence; editovaný blok dostane plný payload. Žádná změna API, žádná změna DB schématu.

**Tech Stack:** TypeScript, React 19, Next.js 16, node:test (`--import tsx`).

---

## Root Cause Shrnutí

Bug ve dvou projevech (viz audit 2026-05-27):

1. **Bug #1:** User změnil jedno pole (např. materiál na ROLE) v editované instanci série a vybral „Celou sérii". `handleSaveAll` v PlannerPage iteroval IDs a PUT-oval **identický payload** každému bloku — propagoval i pole, která user nesahal (`dataRequiredDate`, `deadlineExpedice`, …), čímž přepsal per-instance termíny ostatních sourozenců daty z první instance.
2. **Bug #2:** User upravil per-instance termíny v sekci „Termíny série" a klikl hlavní „Uložit změny" → „Celou sérii". Hlavní formulářový state obsahoval staré hodnoty (z initial mount) — propagovaly se znovu do všech, čímž ztratil typované termíny v sekci „Termíny série". Stejný root cause.

Identifikováno **10 per-occurrence polí**, která se nesmí propagovat:
- Termíny: `dataRequiredDate`, `deadlineExpedice`, `materialRequiredDate`, `pantoneRequiredDate`
- Ready flagy: `dataOk`, `materialOk`, `pantoneOk`
- Sklad/vydání: `materialIssued`, `materialInStock`
- Pantone toggle: `pantoneRequired`

Posledních 6 polí přidáno po review iteraci, protože server-side side-effecty ([route.ts:327-336](../../src/app/api/blocks/[id]/route.ts#L327-L336)) by jinak vynulovaly i ta 4 datumová pole, která chráníme.

---

## Co bylo implementováno (commits)

### Commit 1: `feat(lib): seriesPropagation` — pure helper + testy

- `src/lib/seriesPropagation.ts` — `SERIES_EXCLUDED_FIELDS` (10 polí) + `stripSeriesPropagatedFields<T>` s generikou, vrací `Omit<T, ExcludedField>`.
- `src/lib/seriesPropagation.test.ts` — 6 unit testů: úplný strip, zachování sdílených, žádná mutace vstupu, falsy hodnoty, prázdný objekt.

### Commit 2: `fix(block-edit): per-instance pole jdou jen na editovaný blok série`

- `src/components/BlockEdit.tsx` (~l. 957-985):
  - Import helperu.
  - V „Celou sérii" onClick:
    - Editovaný `block.id` → `onSaveAll([block.id], pending)` s plným payloadem (per-instance fieldy reflektují intent uživatele pro tento blok).
    - Ostatní `otherIds` → `onSaveAll(otherIds, stripSeriesPropagatedFields(pending))` se sdíleným payloadem.
    - Partial-failure guard: pokud první save selže (`ok === false`), druhé volání skip.
    - Type narrowing: `const pending = pendingSavePayload.current` mimo if.
- `src/app/_components/PlannerPage.tsx` — `handleSaveAll` nyní vrací `Promise<boolean>` (`true` na success, `false` v catch + toast).
- „Jen tuto instanci" cesta NEDOTČENÁ.
- „Uložit termíny série" cesta (sekce per-instance v BlockEdit) NEDOTČENÁ.

---

## Co bylo iteračně objeveno (subagent reviews)

**Review 1 (Quality + Correctness):**
- Generika `<T>` + `Omit` místo `Record<string, unknown>` → přijato.
- ASCII uvozovky v komentářích → přijato.
- `deepEqual` v testech → přijato.
- Rozšíření seznamu ze 4 na 10 polí (ready flagy + sklad/vydání + pantoneRequired) → přijato, protože server-side side-effecty by vynulovaly chráněná datumová pole.
- Server-side defense in depth na PUT route → **odmítnuto**, scope creep.
- Race conditions → **odmítnuto**, YAGNI.

**Review 2 (Integrace):**
- Drobnost: strip aplikuje na editovaný blok → `materialIssued` toggle se ztratí → **přijato**, split payloadu na editovaný (plný) vs ostatní (stripped).

**Review 3 (Partial failure + TS narrowing):**
- `handleSaveAll` spolkne chybu → druhé volání běží i při selhání prvního → **přijato**, return boolean + guard v BlockEdit.
- TS narrowing přes mutable ref → **přijato**, extract do lokální const.

---

## Verification

- Build: ✅ 0 errors, 31 pre-existing warnings (CLAUDE.md známé).
- Lint: ✅ 0 errors.
- Test suite: ✅ 31/31 (12 scheduleValidationServer + 8 dateUtils + 5 errors + 6 seriesPropagation).
- TS strict: ✅ build passes.

---

## Manual smoke testy — TODO Vojta (až bude čas)

**Bug #1 scénář:**
1. Vytvořit sérii (3+ výskytů) s **různými** termíny per instance.
2. Editovat první instanci, změnit pouze materiál (např. ROLE).
3. „Uložit změny" → „Celou sérii".
4. Ověřit: ostatní instance mají **původní** termíny, jen materiál se propsal.

**Bug #2 scénář:**
1. V sekci „Termíny série" první instance přepsat termíny pro druhou instanci.
2. Kliknout „Uložit termíny série".
3. Ověřit toast „Uloženo X výskytů.", druhá instance má nové termíny.

**Regrese „Jen tuto instanci":**
1. Editovat instanci, změnit termín v hlavním formuláři.
2. „Uložit změny" → „Jen tuto instanci".
3. Ověřit: jen tato instance má nový termín.

**Regrese per-instance flag na editovaném bloku:**
1. Kliknout VYDÁNO toggle na editované instanci.
2. „Uložit změny" → „Celou sérii".
3. Ověřit: VYDÁNO platí jen na editované, ostatní instance bez změny.

---

## Co plán NEŘEŠÍ (vědomě)

- UX sjednocení save tlačítek — po fixu už není destruktivní.
- Recovery historicky přepsaných termínů z audit logu — samostatná diskuze.
- Server-side defense in depth — pure klient fix dostatečný, server zachovává jednoduchost.
- Optimistic locking (`expectedUpdatedAt`) v `buildPayload` — pre-existing gap, mimo scope.
- Race condition mezi PUT-y a SSE invalidací — známý trade-off „edit lock" patternu.
