// Timezone helpers — appka je vždy v Europe/Prague
// Všechno se zobrazuje v Praha čase bez ohledu na timezone prohlížeče/serveru.

export const BUSINESS_TIME_ZONE = "Europe/Prague";
const DAY_MS = 24 * 60 * 60 * 1000;
const CIVIL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_WITH_TZ_RE = /[zZ]|[+-]\d{2}:\d{2}$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function parseCivilDateParts(dateStr: string): { year: number; month: number; day: number } | null {
  if (!CIVIL_DATE_RE.test(dateStr)) return null;
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  if (
    Number.isNaN(probe.getTime()) ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function isCivilDateString(value: string): boolean {
  return parseCivilDateParts(value) !== null;
}

// Cached formatters — Intl.DateTimeFormat je drahý na vytvoření, cache na module level
const PRAGUE_PARTS_FMT = new Intl.DateTimeFormat("en", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric", month: "2-digit", day: "2-digit",
  weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function parsePragueHour(value: string): number {
  const hour = parseInt(value, 10);
  return hour === 24 ? 0 : hour;
}

/**
 * UTC Date → { hour, minute, slot, dayOfWeek, dateStr } v Europe/Prague timezone.
 * Sdílená utility pro server (route soubory) i klient (workingTime.ts).
 */
export function pragueOf(d: Date): { hour: number; minute: number; slot: number; dayOfWeek: number; dateStr: string } {
  const parts = PRAGUE_PARTS_FMT.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = parsePragueHour(get("hour"));
  const minute = parseInt(get("minute"), 10);
  return {
    hour,
    minute,
    slot: hour * 2 + (minute >= 30 ? 1 : 0),
    dayOfWeek: DOW_SHORT.indexOf(get("weekday") as typeof DOW_SHORT[number]),
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

const PRAGUE_HOUR_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

const PRAGUE_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const PRAGUE_DATE_DISPLAY_FMT = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: BUSINESS_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const PRAGUE_DATE_SHORT_FMT = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: BUSINESS_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
});

const PRAGUE_TIME_FMT = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: BUSINESS_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

const PRAGUE_DATETIME_FMT = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: BUSINESS_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** UTC Date → Praha hodina (0–23), pro předvyplnění editačních formulářů */
export function utcToPragueHour(date: Date): number {
  return parsePragueHour(PRAGUE_HOUR_FMT.format(date));
}

/** UTC Date → Praha datum ve formátu YYYY-MM-DD, pro předvyplnění DatePickerField */
export function utcToPragueDateStr(date: Date): string {
  return PRAGUE_DATE_FMT.format(date);
}

export function todayPragueDateStr(): string {
  return utcToPragueDateStr(new Date());
}

export function normalizeCivilDateInput(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return utcToPragueDateStr(value);
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (isCivilDateString(raw)) return raw;
  if (!ISO_WITH_TZ_RE.test(raw)) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return utcToPragueDateStr(parsed);
}

export function parseCivilDateForDb(value: unknown): Date | null {
  const normalized = normalizeCivilDateInput(value as Date | string | null | undefined);
  return normalized ? civilDateToUTCMidnight(normalized) : null;
}

export function parseCivilDateWriteInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isCivilDateString(trimmed)) return trimmed;
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return utcToPragueDateStr(parsed);
}

export function civilDateToUTCMidnight(dateStr: string): Date {
  const normalized = normalizeCivilDateInput(dateStr);
  if (!normalized) throw new Error(`Invalid civil date: ${dateStr}`);
  return new Date(`${normalized}T00:00:00.000Z`);
}

export function civilDateToUTCNoon(dateStr: string): Date {
  const normalized = normalizeCivilDateInput(dateStr);
  if (!normalized) throw new Error(`Invalid civil date: ${dateStr}`);
  return new Date(`${normalized}T12:00:00.000Z`);
}

export function addDaysToCivilDate(dateStr: string, days: number): string {
  const base = civilDateToUTCNoon(dateStr);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function addMonthsToCivilDate(dateStr: string, months: number): string {
  const { year, monthIndex, day } = civilDateParts(dateStr);
  const firstOfTargetMonth = new Date(Date.UTC(year, monthIndex + months, 1, 12, 0, 0, 0));
  const targetYear = firstOfTargetMonth.getUTCFullYear();
  const targetMonthIndex = firstOfTargetMonth.getUTCMonth();
  const clampedDay = Math.min(day, daysInCivilMonth(targetYear, targetMonthIndex));
  return civilDateFromParts(targetYear, targetMonthIndex + 1, clampedDay);
}

export function diffCivilDateDays(fromDateStr: string, toDateStr: string): number {
  const from = civilDateToUTCNoon(fromDateStr);
  const to = civilDateToUTCNoon(toDateStr);
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

export function civilDateDayOfWeek(dateStr: string): number {
  return civilDateToUTCNoon(dateStr).getUTCDay();
}

export function civilDateParts(dateStr: string): { year: number; month: number; monthIndex: number; day: number } {
  const parsed = parseCivilDateParts(dateStr);
  if (!parsed) throw new Error(`Invalid civil date: ${dateStr}`);
  return { ...parsed, monthIndex: parsed.month - 1 };
}

export function civilDateFromParts(year: number, month: number, day: number): string {
  const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
  if (!isCivilDateString(dateStr)) throw new Error(`Invalid civil date parts: ${dateStr}`);
  return dateStr;
}

export function daysInCivilMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0, 12, 0, 0, 0)).getUTCDate();
}

export function startOfPragueDay(date: Date): Date {
  return pragueToUTC(utcToPragueDateStr(date), 0, 0);
}

export function startOfPragueToday(): Date {
  return pragueToUTC(todayPragueDateStr(), 0, 0);
}

export function formatPragueDate(date: Date): string {
  return PRAGUE_DATE_DISPLAY_FMT.format(date);
}

export function formatPragueDateShort(date: Date): string {
  return PRAGUE_DATE_SHORT_FMT.format(date);
}

export function formatPragueTime(date: Date): string {
  return PRAGUE_TIME_FMT.format(date);
}

export function formatPragueDateTime(date: Date): string {
  return PRAGUE_DATETIME_FMT.format(date);
}

export function formatCivilDate(dateStr: string | null | undefined): string {
  const normalized = normalizeCivilDateInput(dateStr);
  if (!normalized) return "—";
  return formatPragueDate(civilDateToUTCMidnight(normalized));
}

function resolvePragueGapTime(dateStr: string, targetMinutes: number, seed: Date): Date {
  let exactLater: Date | null = null;
  let nextValid: { date: Date; diff: number } | null = null;
  let nearestEarlier: { date: Date; diff: number } | null = null;

  // Spring-forward gap a fall-back overlap nastávají jen v úzkém okně kolem seed.
  // Minutový sweep drží běžný path rychlý a edge-case path přesný i pro :59.
  for (let delta = -180; delta <= 180; delta += 1) {
    const candidate = new Date(seed.getTime() + delta * 60 * 1000);
    const actual = pragueOf(candidate);
    if (actual.dateStr !== dateStr) continue;
    const actualMinutes = actual.hour * 60 + actual.minute;
    const diff = actualMinutes - targetMinutes;

    if (diff === 0) {
      if (!exactLater || candidate.getTime() > exactLater.getTime()) {
        exactLater = candidate;
      }
      continue;
    }

    if (diff > 0) {
      if (!nextValid || diff < nextValid.diff || (diff === nextValid.diff && candidate.getTime() < nextValid.date.getTime())) {
        nextValid = { date: candidate, diff };
      }
      continue;
    }

    const absDiff = Math.abs(diff);
    if (!nearestEarlier || absDiff < nearestEarlier.diff || (absDiff === nearestEarlier.diff && candidate.getTime() > nearestEarlier.date.getTime())) {
      nearestEarlier = { date: candidate, diff: absDiff };
    }
  }

  return exactLater ?? nextValid?.date ?? nearestEarlier?.date ?? seed;
}

/**
 * Praha datetime → UTC Date objekt (pro odesílání do API / uložení do DB).
 * Princip: vytvoří approx UTC timestamp z uživatelského vstupu (jako by byl UTC),
 * pak opraví rozdíl Praha↔UTC. Druhý průchod zajistí korektnost na hranici DST
 * (např. 2026-03-29 01:00 CET — hodina bezprostředně před přechodem).
 */
export function pragueToUTC(dateStr: string, hour: number, minute = 0): Date {
  const parsed = parseCivilDateParts(dateStr);
  if (!parsed) throw new Error(`Invalid civil date: ${dateStr}`);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`Invalid Prague hour: ${hour}`);
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error(`Invalid Prague minute: ${minute}`);
  }
  let result = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, hour, minute, 0, 0));
  const targetMinutes = hour * 60 + minute;

  // Iterativní korekce přes celé Prague datum+čas, ne jen přes hodinu.
  // Tím se správně zpracuje i přechod přes půlnoc (22:00–00:00) a DST hranice.
  for (let i = 0; i < 3; i++) {
    const actual = pragueOf(result);
    const dayDelta = diffCivilDateDays(actual.dateStr, dateStr);
    const actualMinutes = actual.hour * 60 + actual.minute;
    const deltaMinutes = dayDelta * 24 * 60 + (targetMinutes - actualMinutes);
    if (deltaMinutes === 0) {
      return result;
    }
    result = new Date(result.getTime() + deltaMinutes * 60 * 1000);
  }

  // Když přesný civil time neexistuje (spring-forward gap), posuneme se
  // na nejbližší následující platný Prague čas. Při duplicitní hodině
  // (fall-back overlap) preferujeme pozdější výskyt pro deterministický mapping.
  return resolvePragueGapTime(dateStr, targetMinutes, result);
}
