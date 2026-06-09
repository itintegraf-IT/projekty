"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DatePickerField from "@/app/_components/DatePickerField";

const TEXT_PRIMARY = "var(--text)";
const TEXT_SECONDARY = "var(--text-muted)";
const FONT_STACK = "-apple-system, BlinkMacSystemFont, sans-serif";

const TOP_BAR_HEIGHT = 52;

// iOS-style brand accent (modrá), použito v DatePickerField a po celé app.
const IOS_BLUE = "#3b82f6";
const IOS_BLUE_BG = "rgba(59,130,246,0.15)";
const IOS_BLUE_BORDER = "rgba(59,130,246,0.5)";

const AUDIT_FIELD_LABELS: Record<string, string> = {
  jobPresetLabel: "Preset",
  dataStatusLabel: "DATA stav",
  dataRequiredDate: "DATA datum",
  dataOk: "DATA OK",
  materialStatusLabel: "Materiál stav",
  materialRequiredDate: "Materiál datum",
  materialOk: "Materiál OK",
  deadlineExpedice: "Expedice termín",
  expediceNote: "Poznámka expedice",
  doprava: "Doprava",
};

const ACTION_LABELS: Record<string, string> = {
  CREATE: "Vytvoření",
  UPDATE: "Změna",
  DELETE: "Smazání",
  EXPEDITION_PUBLISH: "Expedice +",
  EXPEDITION_UNPUBLISH: "Expedice −",
  NOTE_CREATE: "Poznámka +",
  NOTE_UPDATE: "Poznámka ✎",
  NOTE_DELETE: "Poznámka −",
};

// Skupiny akcí pro iOS segmented control (jen ty nejčastější + Vše).
const ACTION_GROUPS: { id: string; label: string; actions: string[] }[] = [
  { id: "all", label: "Vše", actions: [] },
  { id: "update", label: "Změny", actions: ["UPDATE"] },
  { id: "create", label: "Nové", actions: ["CREATE"] },
  { id: "delete", label: "Smazané", actions: ["DELETE"] },
  { id: "notes", label: "Poznámky", actions: ["NOTE_CREATE", "NOTE_UPDATE", "NOTE_DELETE"] },
  { id: "expedice", label: "Expedice", actions: ["EXPEDITION_PUBLISH", "EXPEDITION_UNPUBLISH"] },
];

export interface AuditLogEntry {
  id: number;
  blockId: number;
  orderNumber: string | null;
  userId: number;
  username: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

interface AuditResponse {
  logs: AuditLogEntry[];
  nextCursor: number | null;
  totalCount: number | null;
}

interface AuditFacets {
  usernames: string[];
  actions: string[];
}

interface Filters {
  usernames: string[];
  actions: string[];
  dateFrom: string;
  dateTo: string;
  q: string;
}

function makeEmptyFilters(): Filters {
  return { usernames: [], actions: [], dateFrom: "", dateTo: "", q: "" };
}

function filtersFromSearchParams(params: URLSearchParams): Filters {
  return {
    usernames: params.getAll("username"),
    actions: params.getAll("action"),
    dateFrom: params.get("dateFrom") ?? "",
    dateTo: params.get("dateTo") ?? "",
    q: params.get("q") ?? "",
  };
}

function filtersToSearchParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  for (const u of filters.usernames) params.append("username", u);
  for (const a of filters.actions) params.append("action", a);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.q.trim().length >= 2) params.set("q", filters.q.trim());
  return params;
}

function filtersForApi(filters: Filters, cursor: number | null, limit: number): string {
  const params = filtersToSearchParams(filters);
  if (cursor !== null) params.set("cursor", String(cursor));
  params.set("limit", String(limit));
  return params.toString();
}

function hasActiveFilters(f: Filters): boolean {
  return (
    f.usernames.length > 0 ||
    f.actions.length > 0 ||
    f.dateFrom !== "" ||
    f.dateTo !== "" ||
    f.q.trim().length >= 2
  );
}

function activeActionGroupId(actions: string[]): string {
  if (actions.length === 0) return "all";
  const set = new Set(actions);
  for (const g of ACTION_GROUPS) {
    if (g.actions.length === 0) continue;
    if (g.actions.length === set.size && g.actions.every((a) => set.has(a))) return g.id;
  }
  return ""; // vlastní kombinace (např. z URL) — žádný segment není active
}

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 250;

// ─── Hlavní panel ────────────────────────────────────────────────────────────

export function AuditLogPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<Filters>(() =>
    filtersFromSearchParams(searchParams)
  );

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const [facets, setFacets] = useState<AuditFacets>({ usernames: [], actions: [] });

  const [debouncedQ, setDebouncedQ] = useState(filters.q);
  const qDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (qDebounceTimer.current) clearTimeout(qDebounceTimer.current);
    qDebounceTimer.current = setTimeout(() => setDebouncedQ(filters.q), DEBOUNCE_MS);
    return () => {
      if (qDebounceTimer.current) clearTimeout(qDebounceTimer.current);
    };
  }, [filters.q]);

  const effectiveFilters: Filters = useMemo(
    () => ({ ...filters, q: debouncedQ }),
    [filters, debouncedQ]
  );

  // Facets fetch
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch("/api/audit/filters", { signal: ctrl.signal });
        if (r.status === 401 || r.status === 403) {
          setUnauthorized(true);
          return;
        }
        if (!r.ok) return;
        setFacets((await r.json()) as AuditFacets);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    })();
    return () => ctrl.abort();
  }, []);

  // URL sync
  const lastWrittenUrlRef = useRef<string>(searchParams.toString());
  useEffect(() => {
    const next = filtersToSearchParams(effectiveFilters).toString();
    if (next === lastWrittenUrlRef.current) return;
    lastWrittenUrlRef.current = next;
    const url = next ? `?${next}` : window.location.pathname;
    router.replace(url, { scroll: false });
  }, [effectiveFilters, router]);

  // First page fetch
  useEffect(() => {
    const ctrl = new AbortController();
    setRefetching(true);
    setError(null);
    (async () => {
      try {
        const qs = filtersForApi(effectiveFilters, null, PAGE_SIZE);
        const r = await fetch(`/api/audit?${qs}`, { signal: ctrl.signal });
        if (r.status === 401 || r.status === 403) {
          setUnauthorized(true);
          setLogs([]);
          setNextCursor(null);
          setTotalCount(null);
          return;
        }
        if (!r.ok) throw new Error("Nepodařilo se načíst audit log");
        const data = (await r.json()) as AuditResponse;
        setLogs(data.logs);
        setNextCursor(data.nextCursor);
        setTotalCount(data.totalCount);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Neznámá chyba");
        setLogs([]);
        setNextCursor(null);
        setTotalCount(null);
      } finally {
        setInitialLoading(false);
        setRefetching(false);
      }
    })();
    return () => ctrl.abort();
  }, [effectiveFilters]);

  // Load more
  const loadMoreSeqRef = useRef(0);
  const loadMore = useCallback(async () => {
    if (nextCursor === null || loadingMore) return;
    const mySeq = ++loadMoreSeqRef.current;
    setLoadingMore(true);
    try {
      const qs = filtersForApi(effectiveFilters, nextCursor, PAGE_SIZE);
      const r = await fetch(`/api/audit?${qs}`);
      if (r.status === 401 || r.status === 403) {
        if (mySeq === loadMoreSeqRef.current) setUnauthorized(true);
        return;
      }
      if (!r.ok) throw new Error("Nepodařilo se načíst další stránku");
      const data = (await r.json()) as AuditResponse;
      if (mySeq !== loadMoreSeqRef.current) return;
      setLogs((prev) => {
        const seen = new Set(prev.map((l) => l.id));
        const merged = [...prev];
        for (const l of data.logs) if (!seen.has(l.id)) merged.push(l);
        return merged;
      });
      setNextCursor(data.nextCursor);
    } catch (e) {
      if (mySeq === loadMoreSeqRef.current) {
        setError(e instanceof Error ? e.message : "Chyba načtení další stránky");
      }
    } finally {
      if (mySeq === loadMoreSeqRef.current) setLoadingMore(false);
    }
  }, [effectiveFilters, nextCursor, loadingMore]);

  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || nextCursor === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreRef.current();
      },
      { rootMargin: "240px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [nextCursor]);

  // Setters
  const setUsernames = useCallback(
    (next: string[]) => setFilters((f) => ({ ...f, usernames: next })),
    []
  );
  const setActionsBySegment = useCallback(
    (segmentId: string) => {
      const g = ACTION_GROUPS.find((x) => x.id === segmentId);
      setFilters((f) => ({ ...f, actions: g ? g.actions : [] }));
    },
    []
  );
  const setDateFrom = useCallback(
    (v: string) => setFilters((f) => ({ ...f, dateFrom: v })),
    []
  );
  const setDateTo = useCallback(
    (v: string) => setFilters((f) => ({ ...f, dateTo: v })),
    []
  );
  const setQ = useCallback((v: string) => setFilters((f) => ({ ...f, q: v })), []);

  const reset = useCallback(() => {
    if (qDebounceTimer.current) clearTimeout(qDebounceTimer.current);
    setDebouncedQ("");
    setFilters(makeEmptyFilters());
  }, []);

  const active = hasActiveFilters(filters);
  const showSkeleton = initialLoading && logs.length === 0;
  const activeSegmentId = activeActionGroupId(filters.actions);

  if (unauthorized) {
    return <UnauthorizedNotice />;
  }

  return (
    <div style={{ fontFamily: FONT_STACK }}>
      {/* Sticky filter card */}
      <div
        style={{
          position: "sticky",
          top: TOP_BAR_HEIGHT,
          zIndex: 30,
          margin: "0 -20px 16px",
          padding: "12px 20px 14px",
          background: "color-mix(in oklab, var(--surface) 92%, transparent)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <FilterCard>
          {/* Sekce: Období */}
          <FilterRow label="Období">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <DatePickerField
                value={filters.dateFrom}
                onChange={setDateFrom}
                placeholder="Od…"
              />
              <DatePickerField
                value={filters.dateTo}
                onChange={setDateTo}
                placeholder="Do…"
              />
            </div>
          </FilterRow>

          {/* Sekce: Typ akce — segmented control */}
          <FilterRow label="Typ akce">
            <SegmentedControl
              segments={ACTION_GROUPS.map((g) => ({ id: g.id, label: g.label }))}
              value={activeSegmentId}
              onChange={setActionsBySegment}
            />
          </FilterRow>

          {/* Sekce: Hledání */}
          <FilterRow label="Hledat">
            <SearchPill
              value={filters.q}
              onChange={setQ}
              placeholder="Číslo zakázky nebo ID bloku (min. 2 znaky)"
            />
          </FilterRow>

          {/* Sekce: Uživatelé — chips */}
          {facets.usernames.length > 0 && (
            <FilterRow label="Uživatelé">
              <UserChips
                items={facets.usernames}
                selected={filters.usernames}
                onChange={setUsernames}
              />
            </FilterRow>
          )}

          {/* Footer karty: stav + reset */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 4,
              paddingTop: 10,
              borderTop: "1px solid var(--border)",
            }}
          >
            <div
              role="status"
              aria-live="polite"
              style={{ fontSize: 11, color: TEXT_SECONDARY }}
            >
              {refetching
                ? "Aktualizuji…"
                : totalCount === null
                  ? `Načteno ${logs.length} záznamů`
                  : `Zobrazeno ${logs.length} z ${totalCount} záznamů`}
            </div>
            <button
              type="button"
              onClick={reset}
              disabled={!active}
              style={{
                height: 28,
                padding: "0 12px",
                borderRadius: 8,
                background: "transparent",
                border: "none",
                color: active ? IOS_BLUE : TEXT_SECONDARY,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: FONT_STACK,
                cursor: active ? "pointer" : "default",
                opacity: active ? 1 : 0.5,
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Vyčistit filtry
            </button>
          </div>
        </FilterCard>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: 12,
            padding: "10px 14px",
            background: "color-mix(in oklab, var(--danger) 10%, transparent)",
            color: "var(--danger)",
            border: "1px solid color-mix(in oklab, var(--danger) 25%, transparent)",
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {showSkeleton ? (
        <AuditLogSkeleton />
      ) : logs.length === 0 ? (
        <EmptyState active={active} />
      ) : (
        <ResultsList logs={logs} refetching={refetching} />
      )}

      {nextCursor !== null && (
        <div ref={sentinelRef} style={{ marginTop: 16, textAlign: "center" }}>
          <button
            type="button"
            onClick={() => loadMoreRef.current()}
            disabled={loadingMore}
            style={{
              padding: "11px 22px",
              minHeight: 44,
              fontSize: 14,
              fontWeight: 600,
              color: IOS_BLUE,
              background: IOS_BLUE_BG,
              border: `1px solid ${IOS_BLUE_BORDER}`,
              borderRadius: 12,
              cursor: loadingMore ? "default" : "pointer",
              opacity: loadingMore ? 0.6 : 1,
              fontFamily: FONT_STACK,
              WebkitTapHighlightColor: "transparent",
              transition: "background 120ms ease-out",
            }}
          >
            {loadingMore ? "Načítám…" : "Načíst dalších 50"}
          </button>
        </div>
      )}

      {nextCursor === null && logs.length > 0 && (
        <div
          style={{
            marginTop: 16,
            textAlign: "center",
            color: TEXT_SECONDARY,
            fontSize: 12,
            padding: "12px 0",
          }}
        >
          Konec záznamů
        </div>
      )}
    </div>
  );
}

// ─── Filter card a row ───────────────────────────────────────────────────────

function FilterCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        boxShadow: "0 1px 2px color-mix(in oklab, black 4%, transparent)",
      }}
    >
      {children}
    </div>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: TEXT_SECONDARY,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

// ─── iOS segmented control ───────────────────────────────────────────────────

function SegmentedControl({
  segments,
  value,
  onChange,
}: {
  segments: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: 3,
        background: "var(--surface-2)",
        borderRadius: 10,
        overflow: "auto hidden",
        scrollbarWidth: "none",
      }}
    >
      {segments.map((s) => {
        const isActive = value === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s.id)}
            style={{
              flex: "1 0 auto",
              minWidth: 70,
              minHeight: 32,
              padding: "6px 12px",
              borderRadius: 8,
              border: "none",
              fontSize: 12,
              fontWeight: isActive ? 700 : 500,
              fontFamily: FONT_STACK,
              background: isActive ? "var(--surface)" : "transparent",
              color: isActive ? TEXT_PRIMARY : TEXT_SECONDARY,
              boxShadow: isActive
                ? "0 1px 3px color-mix(in oklab, black 12%, transparent)"
                : "none",
              cursor: "pointer",
              transition: "background 120ms ease-out, color 120ms ease-out",
              WebkitTapHighlightColor: "transparent",
              whiteSpace: "nowrap",
            }}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── User chips ──────────────────────────────────────────────────────────────

function UserChips({
  items,
  selected,
  onChange,
}: {
  items: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(name: string) {
    if (selected.includes(name)) onChange(selected.filter((u) => u !== name));
    else onChange([...selected, name]);
  }
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
      }}
    >
      {items.map((u) => {
        const isOn = selected.includes(u);
        return (
          <button
            key={u}
            type="button"
            onClick={() => toggle(u)}
            aria-pressed={isOn}
            style={{
              minHeight: 32,
              padding: "6px 12px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: isOn ? 700 : 500,
              fontFamily: FONT_STACK,
              background: isOn ? IOS_BLUE_BG : "var(--surface-2)",
              color: isOn ? IOS_BLUE : TEXT_SECONDARY,
              border: `1px solid ${isOn ? IOS_BLUE_BORDER : "var(--border)"}`,
              cursor: "pointer",
              transition: "all 120ms ease-out",
              WebkitTapHighlightColor: "transparent",
              whiteSpace: "nowrap",
            }}
          >
            {u}
          </button>
        );
      })}
    </div>
  );
}

// ─── iOS search pill ─────────────────────────────────────────────────────────

function SearchPill({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--surface-2)",
        border: `1px solid ${focused ? IOS_BLUE_BORDER : "var(--border)"}`,
        boxShadow: focused
          ? "0 0 0 3px color-mix(in oklab, " + IOS_BLUE + " 18%, transparent)"
          : "none",
        borderRadius: 999,
        padding: "0 12px",
        minHeight: 36,
        transition: "border-color 120ms ease-out, box-shadow 120ms ease-out",
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke={focused ? IOS_BLUE : TEXT_SECONDARY}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="search"
        enterKeyHint="search"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Hledání podle čísla zakázky nebo ID bloku"
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: TEXT_PRIMARY,
          fontSize: 16, // iOS no-zoom threshold
          fontFamily: FONT_STACK,
          padding: "8px 0",
          minWidth: 0,
        }}
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Vyčistit hledání"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            borderRadius: 999,
            border: "none",
            background: "color-mix(in oklab, var(--text-muted) 40%, transparent)",
            color: "var(--surface)",
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ─── Results list ────────────────────────────────────────────────────────────

function ResultsList({
  logs,
  refetching,
}: {
  logs: AuditLogEntry[];
  refetching: boolean;
}) {
  // Seskup podle dne (Praha) pro iOS Settings-style grouped inset list.
  const groups = useMemo(() => groupByDay(logs), [logs]);

  return (
    <div
      aria-busy={refetching}
      style={{
        opacity: refetching ? 0.55 : 1,
        transition: "opacity 120ms ease-out",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      {groups.map((g) => (
        <section key={g.dayKey}>
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: TEXT_SECONDARY,
              padding: "0 4px 6px",
            }}
          >
            {g.label}
          </div>
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              overflow: "hidden",
              boxShadow: "0 1px 2px color-mix(in oklab, black 4%, transparent)",
            }}
          >
            {g.logs.map((log, i) => (
              <AuditLogRow key={log.id} log={log} isFirst={i === 0} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function groupByDay(logs: AuditLogEntry[]): { dayKey: string; label: string; logs: AuditLogEntry[] }[] {
  const map = new Map<string, AuditLogEntry[]>();
  for (const log of logs) {
    const key = dayKeyPrague(log.createdAt);
    const arr = map.get(key) ?? [];
    arr.push(log);
    map.set(key, arr);
  }
  const todayKey = dayKeyPrague(new Date().toISOString());
  const yesterdayKey = dayKeyPrague(new Date(Date.now() - 86400000).toISOString());
  return Array.from(map.entries()).map(([dayKey, items]) => ({
    dayKey,
    label:
      dayKey === todayKey
        ? "Dnes"
        : dayKey === yesterdayKey
          ? "Včera"
          : formatLongDayPrague(items[0].createdAt),
    logs: items,
  }));
}

const PRAGUE_DAY_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function dayKeyPrague(iso: string): string {
  return PRAGUE_DAY_KEY_FMT.format(new Date(iso));
}

const PRAGUE_LONG_DAY_FMT = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: "Europe/Prague",
  weekday: "long",
  day: "numeric",
  month: "long",
});
function formatLongDayPrague(iso: string): string {
  return PRAGUE_LONG_DAY_FMT.format(new Date(iso));
}

// ─── Single row ──────────────────────────────────────────────────────────────

function AuditLogRow({ log, isFirst }: { log: AuditLogEntry; isFirst: boolean }) {
  return (
    <div
      className="audit-row"
      style={{
        padding: "10px 14px",
        borderTop: isFirst ? undefined : "1px solid color-mix(in oklab, var(--border) 60%, transparent)",
        background: "transparent",
        alignItems: "center",
        fontSize: 13,
        minHeight: 44,
      }}
    >
      <span
        className="audit-cell-time"
        style={{ color: TEXT_SECONDARY, whiteSpace: "nowrap", fontSize: 11, fontVariantNumeric: "tabular-nums" }}
      >
        {fmtTime(log.createdAt)}
      </span>
      <span
        className="audit-cell-user"
        style={{
          fontWeight: 600,
          color: TEXT_PRIMARY,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 12,
        }}
      >
        {log.username}
      </span>
      <span
        className="audit-cell-order"
        style={{
          color: IOS_BLUE,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 11,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: 600,
        }}
      >
        {log.orderNumber ?? `#${log.blockId}`}
      </span>
      <span className="audit-cell-action" style={{ color: TEXT_PRIMARY, wordBreak: "break-word", fontSize: 12 }}>
        <ActionContent log={log} />
      </span>
    </div>
  );
}

function ActionContent({ log }: { log: AuditLogEntry }) {
  if (log.action === "UPDATE" && log.field) {
    return (
      <>
        <span style={{ color: TEXT_SECONDARY }}>{AUDIT_FIELD_LABELS[log.field] ?? log.field}:</span>{" "}
        <span style={{ color: TEXT_SECONDARY, textDecoration: "line-through", textDecorationColor: "color-mix(in oklab, var(--text-muted) 60%, transparent)" }}>
          {fmtVal(log.oldValue, log.field)}
        </span>
        {" → "}
        <span style={{ color: TEXT_PRIMARY, fontWeight: 600 }}>{fmtVal(log.newValue, log.field)}</span>
      </>
    );
  }
  if (log.action === "CREATE") return <ActionBadge color="var(--success)" text="Přidáno" />;
  if (log.action === "DELETE") return <ActionBadge color="var(--danger)" text="Smazáno" />;
  if (log.action === "EXPEDITION_PUBLISH")
    return <ActionBadge color="var(--success)" text="Zařazeno do expedice" />;
  if (log.action === "EXPEDITION_UNPUBLISH")
    return <ActionBadge color="var(--warning)" text="Odebráno z expedice" />;
  if (log.action === "NOTE_CREATE")
    return (
      <>
        <ActionBadge color="var(--warning)" text="📝 Přidána poznámka" />{" "}
        <span style={{ color: TEXT_PRIMARY }}>{log.newValue ?? ""}</span>
      </>
    );
  if (log.action === "NOTE_UPDATE")
    return (
      <>
        <ActionBadge color="var(--warning)" text="📝 Upravena poznámka" />{" "}
        <span style={{ color: TEXT_SECONDARY }}>{log.oldValue ?? ""}</span>
        {" → "}
        <span style={{ color: TEXT_PRIMARY }}>{log.newValue ?? ""}</span>
      </>
    );
  if (log.action === "NOTE_DELETE")
    return (
      <>
        <ActionBadge color="var(--danger)" text="📝 Smazána poznámka" />{" "}
        <span style={{ color: TEXT_SECONDARY }}>{log.oldValue ?? ""}</span>
      </>
    );
  return <span style={{ color: TEXT_SECONDARY }}>{log.action}</span>;
}

function ActionBadge({ color, text }: { color: string; text: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 6,
        background: `color-mix(in oklab, ${color} 14%, transparent)`,
        color,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

// ─── Skeleton + empty + unauthorized ────────────────────────────────────────

function AuditLogSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Načítám audit log"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="audit-row"
          style={{
            padding: "12px 14px",
            borderTop: i > 0 ? "1px solid color-mix(in oklab, var(--border) 60%, transparent)" : undefined,
            alignItems: "center",
            minHeight: 44,
          }}
        >
          <SkeletonBar w="80%" />
          <SkeletonBar w="70%" />
          <SkeletonBar w="60%" />
          <SkeletonBar w="90%" />
        </div>
      ))}
    </div>
  );
}

function SkeletonBar({ w }: { w: string }) {
  return (
    <div
      style={{
        height: 10,
        width: w,
        borderRadius: 4,
        background:
          "linear-gradient(90deg, color-mix(in oklab, var(--border) 60%, transparent), color-mix(in oklab, var(--border) 25%, transparent), color-mix(in oklab, var(--border) 60%, transparent))",
        backgroundSize: "200% 100%",
        animation: "auditShimmer 1.4s ease-in-out infinite",
      }}
    />
  );
}

function EmptyState({ active }: { active: boolean }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "56px 20px",
        color: TEXT_SECONDARY,
        fontSize: 13,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
      }}
    >
      <div style={{ fontSize: 36, opacity: 0.4, marginBottom: 10 }}>🗂️</div>
      <div style={{ fontWeight: 600, color: TEXT_PRIMARY, marginBottom: 4, fontSize: 14 }}>
        {active ? "Žádné záznamy odpovídající filtru" : "Žádné záznamy"}
      </div>
      {active && <div>Zkus uvolnit některý z filtrů.</div>}
    </div>
  );
}

function UnauthorizedNotice() {
  return (
    <div
      style={{
        marginTop: 24,
        padding: "16px 18px",
        borderRadius: 12,
        background: "color-mix(in oklab, var(--danger) 10%, transparent)",
        border: "1px solid color-mix(in oklab, var(--danger) 25%, transparent)",
        color: "var(--danger)",
        fontSize: 13,
        fontFamily: FONT_STACK,
      }}
    >
      Sezení vypršelo nebo nemáš oprávnění pro audit log. Přihlas se znovu.
    </div>
  );
}

// ─── Formátovače ─────────────────────────────────────────────────────────────

const PRAGUE_TIME_FMT = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: "Europe/Prague",
  hour: "2-digit",
  minute: "2-digit",
});
function fmtTime(iso: string) {
  return PRAGUE_TIME_FMT.format(new Date(iso));
}

function fmtVal(val: string | null, field: string | null) {
  if (!val || val === "null") return "—";
  if (field === "dataOk" || field === "materialOk") return val === "true" ? "✓ OK" : "✗ Ne";
  if (val.match(/^\d{4}-\d{2}-\d{2}/)) {
    try {
      return new Date(val).toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague" });
    } catch {
      return val;
    }
  }
  return val;
}
