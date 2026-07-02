/**
 * Multi-select metadata bloku (Tiskové archy, Série) se ukládají jako JSON pole
 * vybraných labelů, např. '["1. TA","5. TA"]'. Helper je jediný zdroj pravdy pro
 * parse/serialize/zobrazení. Vše defenzivní — nevalidní vstup nikdy nehodí výjimku.
 */

export function parseProductionTags(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function serializeProductionTags(tags: string[]): string | null {
  const clean = tags.filter((t) => typeof t === "string" && t.trim().length > 0);
  return clean.length > 0 ? JSON.stringify(clean) : null;
}

export function formatProductionTags(value: string | null | undefined): string {
  return parseProductionTags(value).join(", ");
}

/**
 * Kompaktní podoba pro chip na bloku: ["1. TA","5. TA","6. TA"] → "1, 5, 6 TA".
 * Vytáhne pořadové číslo a jednotku z labelu "N. <jednotka>"; pokud všechny sdílí
 * stejnou jednotku, sloučí čísla a jednotku uvede jednou. Když labely nemají tvar
 * "N. …" (admin je přejmenoval) nebo mají různé jednotky, fallback = prostý výpis.
 */
export function compactTagChip(value: string | null | undefined): string {
  const labels = parseProductionTags(value);
  if (labels.length === 0) return "";
  const parsed = labels.map((l) => {
    const m = l.match(/^\s*(\d+)\.\s*(.+?)\s*$/);
    return m ? { num: m[1], unit: m[2] } : null;
  });
  if (parsed.every((p): p is { num: string; unit: string } => p !== null)) {
    const units = new Set(parsed.map((p) => p.unit));
    if (units.size === 1) {
      return `${parsed.map((p) => p.num).join(", ")} ${parsed[0].unit}`;
    }
  }
  return labels.join(", ");
}

/**
 * Text „typového" chipu pro tiskové archy + sérii. Série se spojí za archy.
 * Např. ("1. TA","5. TA" | "3. série") → "1, 5 TA · 3 série". Prázdné → "".
 */
export function formatProductionTypeChip(
  tiskoveArchy: string | null | undefined,
  serie: string | null | undefined
): string {
  const ta = compactTagChip(tiskoveArchy);
  const se = compactTagChip(serie);
  if (ta && se) return `${ta} · ${se}`;
  return ta || se;
}
