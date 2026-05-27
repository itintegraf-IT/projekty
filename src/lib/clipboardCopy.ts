/**
 * Zkopíruje text do systémové schránky s fallbackem pro non-secure contexty.
 *
 * `navigator.clipboard.writeText` je dostupné jen v secure contextu (HTTPS nebo
 * localhost). V plain HTTP prostředí (např. interní firemní server bez TLS) je
 * `navigator.clipboard === undefined` a přímé volání by způsobilo runtime crash.
 *
 * Tento helper se nejdřív pokusí použít moderní API, při selhání spadne na
 * deprecated `document.execCommand("copy")` přes dočasné textarea — funguje
 * univerzálně i v HTTP kontextu.
 *
 * @returns Promise<true> při úspěchu, Promise<false> pokud obě metody selžou
 *          (nebo při běhu mimo browser).
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  // SSR / Node guard — žádné browser API
  if (typeof navigator === "undefined" || typeof document === "undefined") {
    return false;
  }

  // Moderní Clipboard API — dostupné v HTTPS / localhost
  if (typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied / non-secure context — pokračujeme na legacy fallback
    }
  }

  // Legacy fallback — funguje i v plain HTTP. document.execCommand je deprecated,
  // ale stále podporovaný ve všech browserech a nemá vhodnou alternativu pro
  // non-secure contexty.
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    // Mimo viewport — nezpůsobí scroll-jump ani vizuální blink
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    textarea.setAttribute("readonly", "");
    textarea.setAttribute("aria-hidden", "true");
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
