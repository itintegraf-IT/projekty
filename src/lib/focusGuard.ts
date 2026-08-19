/**
 * Fokusová past (audit druhé vlny 19. 8. 2026, bod 2): `handleBlockMouseDown`
 * volá `e.preventDefault()`, aby klik na blok nezpůsobil textovou selekci při
 * tažení — jenže `preventDefault()` na `mousedown` zároveň potlačí VÝCHOZÍ
 * přesun fokusu prohlížeče na kliknutý element. Zůstane-li fokus v hledacím
 * poli (INPUT), klik na blok ho odtud nevytáhne — a klávesový guard v
 * `PlannerPage.tsx` (`tag === "INPUT" | "TEXTAREA" | "SELECT"`) pak zahodí
 * VŠECHNY zkratky (Ctrl+X, Delete, …), aniž by o tom uživatel dostal
 * jakoukoli zpětnou vazbu — myš dál funguje, aplikace vypadá zdravě.
 *
 * Řešení: při mousedownu na blok/resize handle explicitně blurnout aktivní
 * editovatelný element. Čistá funkce — bere element jako parametr, ne
 * `document.activeElement` přímo, ať jde testovat fake objektem bez jsdom
 * (v projektu není k dispozici).
 */

/** Jen ta část elementu, kterou blur potřebuje — kvůli testovatelnosti bez DOM. */
export type BlurableElement = { tagName: string; blur: () => void };

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Blurne `activeElement`, pokud je to INPUT/TEXTAREA/SELECT. No-op pro
 * cokoliv jiné (tlačítko, div, `null`) — mousedown na blok nesmí rušit fokus,
 * který uživatel nemá v editovatelném poli.
 */
export function blurEditableFocus(activeElement: BlurableElement | null): void {
  if (!activeElement) return;
  if (EDITABLE_TAGS.has(activeElement.tagName)) activeElement.blur();
}
