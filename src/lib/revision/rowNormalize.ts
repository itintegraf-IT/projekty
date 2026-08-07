import { BLOCK_BOOLEAN_COLUMNS, BLOCK_DATE_COLUMNS } from "./blockColumns";

const BOOL = new Set<string>(BLOCK_BOOLEAN_COLUMNS);
const DATE = new Set<string>(BLOCK_DATE_COLUMNS);

/**
 * Raw řádek z `SELECT * FROM Block … FOR UPDATE` na tvar, jaký vrací Prisma klient.
 * `null` zůstává `null` u obou skupin — rozlišení „není vyplněno" vs. „false"
 * je u nullable sloupců (např. deadlineExpedice) nosné.
 */
export function normalizeBlockRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) {
      out[key] = null;
    } else if (BOOL.has(key)) {
      out[key] = value === 1 || value === true || value === "1";
    } else if (DATE.has(key)) {
      out[key] = value instanceof Date ? value : new Date(String(value).replace(" ", "T") + "Z");
    } else {
      out[key] = value;
    }
  }
  return out;
}
