"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const TEXT_PRIMARY = "var(--text)";
const TEXT_SECONDARY = "var(--text-muted)";
const SEPARATOR = "color-mix(in oklab, var(--border) 70%, transparent)";
const FONT_STACK = "-apple-system, BlinkMacSystemFont, sans-serif";
const ACCENT_TEXT = "var(--accent)";
const ACCENT_BG = "color-mix(in oklab, var(--accent) 18%, transparent)";
const ACCENT_BORDER = "color-mix(in oklab, var(--accent) 45%, transparent)";

const TOP_BAR_HEIGHT = 52;

// 16px je minimum pro iOS Safari, aby focus inputu nezpůsobil zoom.
const INPUT_FONT_SIZE = 16;

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

  // Debouncovaný `q` pro server query. Reset() musí debounce flushnout (jinak
  // server během 250ms drží předchozí hodnotu).
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

  // ─── Facets fetch (jednou) ─────────────────────────────────────────────────
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
        const data = (await r.json()) as AuditFacets;
        setFacets(data);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    })();
    return () => ctrl.abort();
  }, []);

  // ─── URL sync (replace, ne push) ───────────────────────────────────────────
  // Jen porovnáváme proti naposled zapsanému URL stringu, abychom se vyhnuli
  // smyčce při změně reference `searchParams` hooku po router.replace().
  const lastWrittenUrlRef = useRef<string>(searchParams.toString());
  useEffect(() => {
    const next = filtersToSearchParams(effectiveFilters).toString();
    if (next === lastWrittenUrlRef.current) return;
    lastWrittenUrlRef.current = next;
    const url = next ? `?${next}` : window.location.pathname;
    router.replace(url, { scroll: false });
  }, [effectiveFilters, router]);

  // ─── First page fetch (na změnu effective filtrů) ──────────────────────────
  useEffect(() => {
    const ctrl = new AbortController();
    // initialLoading je true jen při úplně prvním načtení; jakmile máme nějaká
    // data, další fetch je "refetching" — zachováme staré logy s opacity.
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

  // ─── Load more (cursor) ────────────────────────────────────────────────────
  // sequenceRef chrání před race condition: pokud uživatel mezi tím změní filtr,
  // odpověď na starý loadMore se zahodí.
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
      // Ignoruj odpověď, pokud mezi tím vznikl novější request (změna filtru).
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

  // ─── IntersectionObserver pro auto-load ────────────────────────────────────
  // Drží stabilní callback v refu, aby observer nemusel být znovu vytvořen
  // při každé změně `loadMore` identity.
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
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [nextCursor]);

  // ─── Filter setters ────────────────────────────────────────────────────────
  const setUsernames = useCallback(
    (next: string[]) => setFilters((f) => ({ ...f, usernames: next })),
    []
  );
  const setActions = useCallback(
    (next: string[]) => setFilters((f) => ({ ...f, actions: next })),
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

  const flushQ = useCallback(() => {
    if (qDebounceTimer.current) clearTimeout(qDebounceTimer.current);
    setDebouncedQ((prev) => (prev === filters.q ? prev : filters.q));
  }, [filters.q]);

  const reset = useCallback(() => {
    if (qDebounceTimer.current) clearTimeout(qDebounceTimer.current);
    setDebouncedQ("");
    setFilters(makeEmptyFilters());
  }, []);

  const active = hasActiveFilters(filters);
  const showSkeleton = initialLoading && logs.length === 0;

  if (unauthorized) {
    return (
      <div
        style={{
          marginTop: 24,
          padding: "16px 18px",
          borderRadius: 10,
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

  return (
    <div style={{ fontFamily: FONT_STACK }}>
      <AuditLogFilters
        filters={filters}
        facets={facets}
        setUsernames={setUsernames}
        setActions={setActions}
        setDateFrom={setDateFrom}
        setDateTo={setDateTo}
        setQ={setQ}
        flushQ={flushQ}
        reset={reset}
        active={active}
        totalCount={totalCount}
        loadedCount={logs.length}
        refetching={refetching}
      />

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: "10px 14px",
            background: "color-mix(in oklab, var(--danger) 10%, transparent)",
            color: "var(--danger)",
            border: "1px solid color-mix(in oklab, var(--danger) 25%, transparent)",
            borderRadius: 8,
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
        <div
          aria-busy={refetching}
          style={{
            marginTop: 12,
            borderRadius: 12,
            overflow: "hidden",
            border: `1px solid ${SEPARATOR}`,
            background: "var(--surface)",
            opacity: refetching ? 0.55 : 1,
            transition: "opacity 120ms ease-out",
          }}
        >
          {logs.map((log, i) => (
            <AuditLogRow key={log.id} log={log} stripe={i % 2 === 0} isFirst={i === 0} />
          ))}
        </div>
      )}

      {nextCursor !== null && (
        <div ref={sentinelRef} style={{ marginTop: 16, textAlign: "center" }} aria-hidden="true">
          <button
            onClick={() => loadMoreRef.current()}
            disabled={loadingMore}
            className="audit-input"
            style={{
              padding: "11px 22px",
              minHeight: 44,
              fontSize: 14,
              fontWeight: 600,
              color: ACCENT_TEXT,
              background: ACCENT_BG,
              border: `1px solid ${ACCENT_BORDER}`,
              borderRadius: 10,
              cursor: loadingMore ? "default" : "pointer",
              opacity: loadingMore ? 0.6 : 1,
              fontFamily: FONT_STACK,
              WebkitTapHighlightColor: "transparent",
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

// ─── Filter bar ──────────────────────────────────────────────────────────────

interface AuditLogFiltersProps {
  filters: Filters;
  facets: AuditFacets;
  setUsernames: (next: string[]) => void;
  setActions: (next: string[]) => void;
  setDateFrom: (v: string) => void;
  setDateTo: (v: string) => void;
  setQ: (v: string) => void;
  flushQ: () => void;
  reset: () => void;
  active: boolean;
  totalCount: number | null;
  loadedCount: number;
  refetching: boolean;
}

function AuditLogFilters({
  filters,
  facets,
  setUsernames,
  setActions,
  setDateFrom,
  setDateTo,
  setQ,
  flushQ,
  reset,
  active,
  totalCount,
  loadedCount,
  refetching,
}: AuditLogFiltersProps) {
  function toggleUsername(name: string) {
    if (filters.usernames.includes(name)) {
      setUsernames(filters.usernames.filter((u) => u !== name));
    } else {
      setUsernames([...filters.usernames, name]);
    }
  }

  function toggleAction(name: string) {
    if (filters.actions.includes(name)) {
      setActions(filters.actions.filter((a) => a !== name));
    } else {
      setActions([...filters.actions, name]);
    }
  }

  return (
    <div
      style={{
        position: "sticky",
        top: TOP_BAR_HEIGHT,
        zIndex: 30,
        margin: "0 -20px",
        padding: "12px 20px",
        background: "color-mix(in oklab, var(--surface) 92%, transparent)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: `1px solid ${SEPARATOR}`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "flex-end",
        }}
      >
        <FilterField label="Od">
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            max={filters.dateTo || undefined}
            className="audit-input"
            style={dateInputStyle}
            aria-label="Datum od"
          />
        </FilterField>

        <FilterField label="Do">
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            min={filters.dateFrom || undefined}
            className="audit-input"
            style={dateInputStyle}
            aria-label="Datum do"
          />
        </FilterField>

        <FilterField label="Hledat" grow>
          <input
            type="search"
            placeholder="Číslo zakázky nebo ID bloku (min. 2 znaky)"
            value={filters.q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") flushQ();
            }}
            className="audit-input"
            style={textInputStyle}
            inputMode="search"
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Hledání podle čísla zakázky nebo ID bloku"
          />
        </FilterField>

        <button
          onClick={reset}
          disabled={!active}
          className="audit-input"
          style={{
            padding: "10px 14px",
            minHeight: 44,
            fontSize: 14,
            fontWeight: 500,
            color: active ? TEXT_PRIMARY : TEXT_SECONDARY,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            cursor: active ? "pointer" : "default",
            opacity: active ? 1 : 0.5,
            fontFamily: FONT_STACK,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          Vyčistit
        </button>
      </div>

      {/* Action chips */}
      {facets.actions.length > 0 && (
        <ChipGroup
          label="Akce"
          items={facets.actions}
          selected={filters.actions}
          onToggle={toggleAction}
          renderLabel={(a) => ACTION_LABELS[a] ?? a}
        />
      )}

      {/* Username chips */}
      {facets.usernames.length > 0 && (
        <ChipGroup
          label="Uživatel"
          items={facets.usernames}
          selected={filters.usernames}
          onToggle={toggleUsername}
          renderLabel={(u) => u}
        />
      )}

      <div
        role="status"
        aria-live="polite"
        style={{ marginTop: 8, fontSize: 11, color: TEXT_SECONDARY }}
      >
        {refetching
          ? "Aktualizuji…"
          : totalCount === null
            ? `Načteno ${loadedCount} záznamů`
            : `Zobrazeno ${loadedCount} z ${totalCount} záznamů`}
      </div>
    </div>
  );
}

function ChipGroup<T extends string>({
  label,
  items,
  selected,
  onToggle,
  renderLabel,
}: {
  label: string;
  items: T[];
  selected: T[];
  onToggle: (item: T) => void;
  renderLabel: (item: T) => string;
}) {
  return (
    <div
      style={{
        marginTop: 10,
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: TEXT_SECONDARY,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginRight: 4,
        }}
      >
        {label}
      </span>
      {items.map((item) => {
        const isSelected = selected.includes(item);
        return (
          <button
            key={item}
            onClick={() => onToggle(item)}
            aria-pressed={isSelected}
            className="audit-chip"
            style={{
              padding: "10px 14px",
              minHeight: 44,
              fontSize: 13,
              fontWeight: isSelected ? 600 : 500,
              color: isSelected ? ACCENT_TEXT : TEXT_SECONDARY,
              background: isSelected ? ACCENT_BG : "var(--surface-2)",
              border: `1px solid ${isSelected ? ACCENT_BORDER : "var(--border)"}`,
              borderRadius: 999,
              cursor: "pointer",
              fontFamily: FONT_STACK,
              WebkitTapHighlightColor: "transparent",
              transition: "background 120ms ease-out, color 120ms ease-out",
            }}
          >
            {renderLabel(item)}
          </button>
        );
      })}
    </div>
  );
}

function FilterField({
  label,
  children,
  grow = false,
}: {
  label: string;
  children: React.ReactNode;
  grow?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        flex: grow ? "1 1 220px" : "0 0 auto",
        minWidth: 150,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: TEXT_SECONDARY,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

// ─── Single row ──────────────────────────────────────────────────────────────

interface AuditLogRowProps {
  log: AuditLogEntry;
  stripe: boolean;
  isFirst: boolean;
}

function AuditLogRow({ log, stripe, isFirst }: AuditLogRowProps) {
  return (
    <div
      className="audit-row"
      style={{
        padding: "11px 14px",
        borderTop: isFirst ? undefined : `1px solid ${SEPARATOR}`,
        background: stripe ? "var(--surface)" : "var(--surface-2)",
        alignItems: "center",
        fontSize: 12,
        minHeight: 44,
      }}
    >
      <span className="audit-cell-time" style={{ color: TEXT_SECONDARY, whiteSpace: "nowrap" }}>
        {fmtDatetime(log.createdAt)}
      </span>
      <span
        className="audit-cell-user"
        style={{
          fontWeight: 600,
          color: TEXT_PRIMARY,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {log.username}
      </span>
      <span
        className="audit-cell-order"
        style={{
          color: TEXT_PRIMARY,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 11,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {log.orderNumber ?? `#${log.blockId}`}
      </span>
      <span className="audit-cell-action" style={{ color: TEXT_PRIMARY, wordBreak: "break-word" }}>
        <ActionContent log={log} />
      </span>
    </div>
  );
}

function ActionContent({ log }: { log: AuditLogEntry }) {
  if (log.action === "UPDATE" && log.field) {
    return (
      <>
        {AUDIT_FIELD_LABELS[log.field] ?? log.field}:{" "}
        <span style={{ color: TEXT_SECONDARY }}>{fmtVal(log.oldValue, log.field)}</span>
        {" → "}
        <span style={{ color: TEXT_PRIMARY }}>{fmtVal(log.newValue, log.field)}</span>
      </>
    );
  }
  if (log.action === "CREATE") return <span style={{ color: "var(--success)" }}>Přidána</span>;
  if (log.action === "DELETE") return <span style={{ color: "var(--danger)" }}>Smazána</span>;
  if (log.action === "EXPEDITION_PUBLISH")
    return <span style={{ color: "var(--success)" }}>Zařazena do expedice</span>;
  if (log.action === "EXPEDITION_UNPUBLISH")
    return <span style={{ color: "var(--warning)" }}>Odebrána z expedice</span>;
  if (log.action === "NOTE_CREATE")
    return (
      <>
        <span style={{ color: "var(--warning)" }}>📝 Přidána poznámka:</span>{" "}
        <span style={{ color: TEXT_PRIMARY }}>{log.newValue ?? ""}</span>
      </>
    );
  if (log.action === "NOTE_UPDATE")
    return (
      <>
        <span style={{ color: "var(--warning)" }}>📝 Upravena poznámka:</span>{" "}
        <span style={{ color: TEXT_SECONDARY }}>{log.oldValue ?? ""}</span>
        {" → "}
        <span style={{ color: TEXT_PRIMARY }}>{log.newValue ?? ""}</span>
      </>
    );
  if (log.action === "NOTE_DELETE")
    return (
      <>
        <span style={{ color: "var(--danger)" }}>📝 Smazána poznámka:</span>{" "}
        <span style={{ color: TEXT_SECONDARY }}>{log.oldValue ?? ""}</span>
      </>
    );
  return <>{log.action}</>;
}

// ─── Skeleton & empty ────────────────────────────────────────────────────────

function AuditLogSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Načítám audit log"
      style={{
        marginTop: 12,
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${SEPARATOR}`,
      }}
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="audit-row"
          style={{
            padding: "12px 14px",
            borderTop: i > 0 ? `1px solid ${SEPARATOR}` : undefined,
            background: i % 2 === 0 ? "var(--surface)" : "var(--surface-2)",
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
        height: 12,
        width: w,
        borderRadius: 4,
        background:
          "linear-gradient(90deg, color-mix(in oklab, var(--border) 60%, transparent), color-mix(in oklab, var(--border) 30%, transparent), color-mix(in oklab, var(--border) 60%, transparent))",
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
        marginTop: 24,
        textAlign: "center",
        padding: "48px 20px",
        color: TEXT_SECONDARY,
        fontSize: 13,
      }}
    >
      <div style={{ fontSize: 32, opacity: 0.4, marginBottom: 8 }}>🗂️</div>
      <div style={{ fontWeight: 600, color: TEXT_PRIMARY, marginBottom: 4 }}>
        {active ? "Žádné záznamy odpovídající filtru" : "Žádné záznamy"}
      </div>
      {active && <div>Zkus uvolnit některý z filtrů.</div>}
    </div>
  );
}

// ─── Formátovače ─────────────────────────────────────────────────────────────

function fmtDatetime(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("cs-CZ", {
      timeZone: "Europe/Prague",
      day: "2-digit",
      month: "2-digit",
    }) +
    " " +
    d.toLocaleTimeString("cs-CZ", {
      timeZone: "Europe/Prague",
      hour: "2-digit",
      minute: "2-digit",
    })
  );
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

// ─── Styly ───────────────────────────────────────────────────────────────────

const dateInputStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "10px 11px",
  minHeight: 44,
  color: TEXT_PRIMARY,
  fontSize: INPUT_FONT_SIZE,
  fontFamily: FONT_STACK,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const textInputStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "10px 12px",
  minHeight: 44,
  color: TEXT_PRIMARY,
  fontSize: INPUT_FONT_SIZE,
  fontFamily: FONT_STACK,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};
