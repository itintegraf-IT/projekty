import type { Prisma } from "@prisma/client";
import { addDaysToCivilDate, pragueToUTC } from "@/lib/dateUtils";

export const AUDIT_LIMIT_DEFAULT = 50;
export const AUDIT_LIMIT_MAX = 200;
export const AUDIT_Q_MIN_LENGTH = 2;
export const AUDIT_Q_MAX_LENGTH = 100;

// MySQL varchar(191) je limit pro indexované VARCHAR sloupce v utf8mb4.
const STRING_FILTER_MAX = 191;

export interface AuditQueryFilters {
  cursor?: number;
  limit: number;
  usernames: string[];
  actions: string[];
  dateFrom?: string;
  dateTo?: string;
  q?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INT_RE = /^\d+$/;

export function parseAuditFilters(searchParams: URLSearchParams): AuditQueryFilters {
  const rawLimit = searchParams.get("limit");
  const limit =
    rawLimit && INT_RE.test(rawLimit)
      ? Math.min(Math.max(parseInt(rawLimit, 10), 1), AUDIT_LIMIT_MAX)
      : AUDIT_LIMIT_DEFAULT;

  const rawCursor = searchParams.get("cursor");
  const cursor = rawCursor && INT_RE.test(rawCursor) ? parseInt(rawCursor, 10) : undefined;

  const usernames = uniqueNonEmpty(searchParams.getAll("username"));
  const actions = uniqueNonEmpty(searchParams.getAll("action"));

  const dateFrom = normalizeDateParam(searchParams.get("dateFrom"));
  const dateTo = normalizeDateParam(searchParams.get("dateTo"));

  const qRaw = (searchParams.get("q") ?? "").trim();
  const q =
    qRaw.length >= AUDIT_Q_MIN_LENGTH ? qRaw.slice(0, AUDIT_Q_MAX_LENGTH) : undefined;

  return { cursor, limit, usernames, actions, dateFrom, dateTo, q };
}

function uniqueNonEmpty(values: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const trimmed = v.trim();
    if (trimmed.length > 0 && trimmed.length <= STRING_FILTER_MAX) out.add(trimmed);
  }
  return Array.from(out);
}

function normalizeDateParam(v: string | null): string | undefined {
  if (!v) return undefined;
  const trimmed = v.trim();
  if (!DATE_RE.test(trimmed)) return undefined;
  // Ověř, že datum reálně existuje (např. odmítne 2026-13-45 → rollover).
  const [y, m, d] = trimmed.split("-").map((s) => parseInt(s, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return undefined;
  }
  return trimmed;
}

// Escape LIKE wildcards (`%`, `_`) i Prisma `\` escape char, aby uživatelské `50%`
// nebylo interpretováno jako wildcard. Prisma předává `contains` jako parametrizovaný
// LIKE, takže SQLi sem nepatří — řešíme jen sémantiku hledání.
function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function buildAuditWhere(filters: AuditQueryFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  if (filters.usernames.length === 1) {
    where.username = filters.usernames[0];
  } else if (filters.usernames.length > 1) {
    where.username = { in: filters.usernames };
  }

  if (filters.actions.length === 1) {
    where.action = filters.actions[0];
  } else if (filters.actions.length > 1) {
    where.action = { in: filters.actions };
  }

  if (filters.dateFrom || filters.dateTo) {
    const range: { gte?: Date; lt?: Date } = {};
    if (filters.dateFrom) {
      range.gte = pragueToUTC(filters.dateFrom, 0, 0);
    }
    if (filters.dateTo) {
      range.lt = pragueToUTC(addDaysToCivilDate(filters.dateTo, 1), 0, 0);
    }
    where.createdAt = range;
  }

  if (filters.q) {
    const safe = escapeLikePattern(filters.q);
    const orFilters: Prisma.AuditLogWhereInput[] = [{ orderNumber: { contains: safe } }];
    if (INT_RE.test(filters.q)) {
      const asInt = parseInt(filters.q, 10);
      if (Number.isSafeInteger(asInt)) {
        orFilters.push({ blockId: asInt });
      }
    }
    where.OR = orFilters;
  }

  return where;
}
