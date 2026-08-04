/**
 * Ořízne text tak, aby se vešel do `maxBytes` bajtů v UTF-8. Řez může padnout
 * doprostřed vícebajtového znaku — `TextDecoder` s `fatal: false` ho nahradí
 * U+FFFD, takže výsledek je vždy platný string. Slouží pro sloupce `@db.Text`,
 * jejichž limit je v bajtech, ne ve znacích (česká diakritika = 2 B/znak).
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= maxBytes) return text;
  return new TextDecoder("utf-8").decode(bytes.subarray(0, maxBytes));
}
