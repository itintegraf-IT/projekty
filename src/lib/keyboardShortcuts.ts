/**
 * Normalizace kláves pro zkratky planneru.
 *
 * Vzniklo 13. 8. 2026 po incidentu: plánovači přestaly z ničeho nic fungovat
 * VŠECHNY zkratky (Ctrl+C/X/V/Z/Y) a nespravil to reload ani restart prohlížeče.
 * Příčinou byl zapnutý Caps Lock — handler porovnával `e.key === "c"` doslova
 * s malým písmenem, jenže `KeyboardEvent.key` nese znak tak, jak by se NAPSAL.
 * S Caps Lockem je to `"C"`, takže každá písmenná zkratka tiše propadla.
 *
 * Táž past sklapne při přepnutém rozložení klávesnice (Alt+Shift na cyrilici),
 * kde `key` vrátí úplně jiný znak. Obojí přežije reload i restart prohlížeče,
 * protože to není stav stránky — je to stav klávesnice. Uživatel přitom nedostane
 * žádnou zpětnou vazbu: myš funguje dál, aplikace vypadá zdravě.
 *
 * Řešení bere klávesu ze DVOU zdrojů a stačí, když se trefí jeden:
 *  - `e.code` = FYZICKÁ klávesa (`KeyC`), nezávislá na Caps Locku i na rozložení;
 *  - `e.key.toLowerCase()` = napsaný znak, pojistka pro Dvorak a jiná fyzická
 *    rozložení, kde uživatel čeká zkratku pod písmenem, ne pod pozicí klávesy.
 */

/** Písmenné zkratky planneru. Nepísmenné klávesy (Delete/Escape) normalizaci nepotřebují. */
export type ShortcutLetter = "c" | "x" | "v" | "y" | "z";

const SHORTCUT_LETTERS: readonly ShortcutLetter[] = ["c", "x", "v", "y", "z"] as const;

/** `KeyboardEvent.code` fyzické klávesy → písmeno zkratky. */
const CODE_TO_LETTER: Readonly<Record<string, ShortcutLetter>> = {
  KeyC: "c",
  KeyX: "x",
  KeyV: "v",
  KeyY: "y",
  KeyZ: "z",
};

/** Jen ta část `KeyboardEvent`, kterou normalizace potřebuje — kvůli testovatelnosti bez DOM. */
export type KeyLike = { key: string; code?: string };

/**
 * Vrátí písmeno zkratky, na které klávesa ukazuje, nebo `null`, když o zkratku nejde.
 *
 * Přednost má `e.code`, protože je odolný vůči Caps Locku i vůči rozložení.
 * `e.key` slouží jako záloha pro prostředí, kde `code` chybí (starší WebView,
 * syntetické eventy v testech) nebo kde má uživatel přerovnané fyzické klávesy.
 */
export function shortcutLetter(e: KeyLike): ShortcutLetter | null {
  const fromCode = e.code ? CODE_TO_LETTER[e.code] : undefined;
  if (fromCode) return fromCode;

  const typed = e.key.toLowerCase();
  return (SHORTCUT_LETTERS as readonly string[]).includes(typed) ? (typed as ShortcutLetter) : null;
}

/**
 * Je to daná zkratka? Cukr nad `shortcutLetter`, ať volající čte stejně jako dřív
 * (`isShortcut(e, "c")` místo někdejšího `e.key === "c"`).
 */
export function isShortcut(e: KeyLike, letter: ShortcutLetter): boolean {
  return shortcutLetter(e) === letter;
}
