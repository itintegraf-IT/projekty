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
 *
 * VÝJIMKA pro pár Z/Y (od 19. 8. 2026, oprava QWERTZ regrese): Na české a německé
 * QWERTZ klávesnici jsou klávesy Z a Y fyzicky PROHOZENÉ oproti americkému QWERTY
 * rozložení, ke kterému se `e.code` vždy vztahuje. Uživatel, který na QWERTZ napíše
 * "z", má `code: "KeyY"` — logika „code-first" by to vyhodnotila jako "y" a Ctrl+Z by
 * omylem provedl REDO místo UNDO. Proto rozhoduje `e.key` JAKO PRVNÍ (stále se řeší
 * Caps Lock přes `toLowerCase()`); `e.code` je záloha pro případ, že `e.key` nenese
 * z/y vůbec (cyrilice a jiná nelatinková rozložení). Pár C/X/V je mezi QWERTY a
 * QWERTZ pozičně shodný — tu výjimku nepotřebují.
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
 * VÝJIMKA pro pár Z/Y (od 19. 8. 2026, oprava QWERTZ regrese): `e.code` je
 * pro tenhle jediný pár zavádějící, protože fyzické klávesy Z a Y jsou na
 * české a německé QWERTZ klávesnici PROHOZENÉ oproti americkému
 * referenčnímu rozložení, ke kterému se `KeyboardEvent.code` vždy vztahuje
 * (je to POZICE, ne napsaný znak). Uživatel, který na QWERTZ napíše "z",
 * má `code: "KeyY"` — kód-first logika (viz níž) by to vyhodnotila jako
 * "y" a Ctrl+Z by omylem provedl REDO místo UNDO (a symetricky Ctrl+Y by
 * dělal UNDO). Pro Z/Y proto rozhoduje `e.key` JAKO PRVNÍ — `toLowerCase()`
 * pořád řeší Caps Lock stejně jako v kódu níž; `e.code` zůstává záložní
 * cestou pro případ, že `e.key` nenese latinské z/y vůbec (cyrilice a jiná
 * nelatinková rozložení — tam ukazuje jen na fyzickou polohu klávesy).
 * Pár C/X/V touhle výjimkou NEPROCHÁZÍ — jejich fyzická poloha je mezi
 * QWERTY a QWERTZ shodná, takže pořadí code→key jim nevadí (viz komentář
 * k CODE_TO_LETTER výš a audit `2026-08-19-audit-pripominky-planovace-druha-vlna.md` §2).
 */
export function shortcutLetter(e: KeyLike): ShortcutLetter | null {
  // VÝJIMKA pro pár Z/Y (od 19. 8. 2026, oprava QWERTZ regrese): `e.code` je
  // pro tenhle jediný pár zavádějící, protože fyzické klávesy Z a Y jsou na
  // české a německé QWERTZ klávesnici PROHOZENÉ oproti americkému
  // referenčnímu rozložení, ke kterému se `KeyboardEvent.code` vždy vztahuje
  // (je to POZICE, ne napsaný znak). Uživatel, který na QWERTZ napíše "z",
  // má `code: "KeyY"` — kód-first logika (viz níž) by to vyhodnotila jako
  // "y" a Ctrl+Z by omylem provedl REDO místo UNDO (a symetricky Ctrl+Y by
  // dělal UNDO). Pro Z/Y proto rozhoduje `e.key` JAKO PRVNÍ — `toLowerCase()`
  // pořád řeší Caps Lock stejně jako v kódu níž; `e.code` zůstává záložní
  // cestou pro případ, že `e.key` nenese latinské z/y vůbec (cyrilice a jiná
  // nelatinková rozložení — tam ukazuje jen na fyzickou polohu klávesy).
  // Pár C/X/V touhle výjimkou NEPROCHÁZÍ — jejich fyzická poloha je mezi
  // QWERTY a QWERTZ shodná, takže pořadí code→key jim nevadí (viz komentář
  // k CODE_TO_LETTER výš a audit `2026-08-19-audit-pripominky-planovace-druha-vlna.md` §2).
  const typed = e.key.toLowerCase();
  if (typed === "z" || typed === "y") return typed;

  const fromCode = e.code ? CODE_TO_LETTER[e.code] : undefined;
  if (fromCode) return fromCode;

  return (SHORTCUT_LETTERS as readonly string[]).includes(typed) ? (typed as ShortcutLetter) : null;
}

/**
 * Je to daná zkratka? Cukr nad `shortcutLetter`, ať volající čte stejně jako dřív
 * (`isShortcut(e, "c")` místo někdejšího `e.key === "c"`).
 */
export function isShortcut(e: KeyLike, letter: ShortcutLetter): boolean {
  return shortcutLetter(e) === letter;
}
