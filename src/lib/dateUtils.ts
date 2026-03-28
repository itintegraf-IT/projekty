// Timezone helpers — appka je vždy v Europe/Prague
// Všechno se zobrazuje v Praha čase bez ohledu na timezone prohlížeče/serveru.

// Cached formatters — Intl.DateTimeFormat je drahý na vytvoření, cache na module level
const PRAGUE_PARTS_FMT = new Intl.DateTimeFormat("en", {
  timeZone: "Europe/Prague",
  year: "numeric", month: "2-digit", day: "2-digit",
  weekday: "short", hour: "2-digit", hour12: false,
});
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * UTC Date → { hour, dayOfWeek, dateStr } v Europe/Prague timezone.
 * Sdílená utility pro server (route soubory) i klient (workingTime.ts).
 */
export function pragueOf(d: Date): { hour: number; dayOfWeek: number; dateStr: string } {
  const parts = PRAGUE_PARTS_FMT.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    hour: parseInt(get("hour"), 10),
    dayOfWeek: DOW_SHORT.indexOf(get("weekday") as typeof DOW_SHORT[number]),
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

const PRAGUE_HOUR_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Prague",
  hour: "2-digit",
  hour12: false,
});

const PRAGUE_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** UTC Date → Praha hodina (0–23), pro předvyplnění editačních formulářů */
export function utcToPragueHour(date: Date): number {
  return parseInt(PRAGUE_HOUR_FMT.format(date), 10);
}

/** UTC Date → Praha datum ve formátu YYYY-MM-DD, pro předvyplnění DatePickerField */
export function utcToPragueDateStr(date: Date): string {
  return PRAGUE_DATE_FMT.format(date);
}

/**
 * Praha datetime → UTC Date objekt (pro odesílání do API / uložení do DB).
 * Princip: vytvoří approx UTC timestamp z uživatelského vstupu (jako by byl UTC),
 * pak opraví rozdíl Praha↔UTC. Druhý průchod zajistí korektnost na hranici DST
 * (např. 2026-03-29 01:00 CET — hodina bezprostředně před přechodem).
 */
export function pragueToUTC(dateStr: string, hour: number, minute = 0): Date {
  const approx = new Date(
    `${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`
  );
  const result = new Date(approx.getTime() + (hour - utcToPragueHour(approx)) * 3600 * 1000);
  // Druhý průchod: na hranici DST se offset změní o 1 h, první průchod může minout o hodinu
  const finalHour = utcToPragueHour(result);
  if (finalHour !== hour) {
    return new Date(result.getTime() + (hour - finalHour) * 3600 * 1000);
  }
  return result;
}
