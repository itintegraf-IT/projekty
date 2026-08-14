/**
 * Slovník stavů rezervace — JEDINÝ zdroj pravdy.
 *
 * Vznikl proto, že report znal jen 5 z 8 stavů: mimo trychtýř zůstávaly `CONFIRMED`,
 * `COUNTER_PROPOSED` a `WITHDRAWN`. `CONFIRMED` je přitom koncový ÚSPĚCH, takže vypadl
 * z čitatele konverze, kdežto zamítnutá rezervace ve jmenovateli zůstala napořád —
 * konverze tím klesala rychleji, čím lépe proces fungoval.
 *
 * Nový stav → doplnit sem, jinak shodí strážný test. Bez toho se dnešní vada
 * přidáním devátého stavu tiše zopakuje.
 */
export const RESERVATION_STATUSES = [
  "SUBMITTED", "ACCEPTED", "QUEUE_READY", "COUNTER_PROPOSED",
  "SCHEDULED", "CONFIRMED", "REJECTED", "WITHDRAWN",
] as const;

/** Rezervace, které se ještě řeší — stav k dnešku, nezávislý na období. */
export const OPEN_STATUSES = ["SUBMITTED", "ACCEPTED", "QUEUE_READY", "COUNTER_PROPOSED"] as const;

/** Rezervace, které už dopadly nějak — počítají se za období. */
export const CLOSED_STATUSES = ["SCHEDULED", "CONFIRMED", "REJECTED", "WITHDRAWN"] as const;

/** Uzavřené, které skončily prací. */
export const SUCCESS_STATUSES = ["SCHEDULED", "CONFIRMED"] as const;

/**
 * Úspěšně vyřízené ze všech uzavřených (rozhodnutí Vojty 14. 8. 2026).
 * `null` při prázdném jmenovateli — „0 %“ u prázdné fronty vypadá jako katastrofa
 * místo „není co měřit“.
 */
export function computeConversionPercent(closed: Record<string, number>): number | null {
  const total = CLOSED_STATUSES.reduce((s, k) => s + (closed[k] ?? 0), 0);
  if (total <= 0) return null;
  const success = SUCCESS_STATUSES.reduce((s, k) => s + (closed[k] ?? 0), 0);
  return Math.round((success / total) * 100);
}
