// ── Test-only pomocník pro strážné testy nad zdrojovým textem (sdílené mezi *.test.ts) ──

/**
 * Zdroják bez komentářů, řetězce zachované.
 *
 * Musí se to udělat DŘÍV než cokoli jiného, jinak test lže v obou směrech:
 * český komentář typu „EXPEDITION" nese nepárovou uvozovku a posunul by hledání
 * řetězcových literálů o jednu (hodnota `action` by z meta „zmizela"), a naopak
 * komentář, který o `$transaction(` jen mluví, by vypadal jako obcházení obalu.
 *
 * Bez tohohle je regexový strážný test slepý na nejběžnější falešné negativum:
 * volání dočasně zakomentované při refaktoru nebo řešení merge konfliktu
 * („na chvíli vypnu, ať mi to nespadá") a zapomenuté vrátit — text zůstává ve
 * zdroji, takže `includes(...)` pořád vrací true, i když se nic nevolá.
 */
export function stripComments(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      const open = i;
      i++;
      while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
      i++;
      out.push(src.slice(open, i));
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join("");
}
