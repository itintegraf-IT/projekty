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
