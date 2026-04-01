import { isCivilDateString, pragueToUTC } from "@/lib/dateUtils";

const ISO_WITH_TZ_RE = /[zZ]|[+-]\d{2}:\d{2}$/;

export function parseCompanyDayDateTimeInput(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isCivilDateString(trimmed)) {
    return pragueToUTC(trimmed, 0, 0);
  }
  if (!ISO_WITH_TZ_RE.test(trimmed)) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function serializeCompanyDay<T extends { startDate: Date; endDate: Date; createdAt: Date }>(day: T) {
  return {
    ...day,
    startDate: day.startDate.toISOString(),
    endDate: day.endDate.toISOString(),
    createdAt: day.createdAt.toISOString(),
  };
}
