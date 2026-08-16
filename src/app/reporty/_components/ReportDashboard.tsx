"use client";

import React, { useState, useEffect, useCallback } from "react";
import { todayPragueDateStr } from "@/lib/dateUtils";
import { ModuleHeader } from "@/components/ModuleHeader";
import HealthPanel from "./HealthPanel";
import { useHealthData } from "./useHealthData";
import { useAttentionData } from "./useAttentionData";
import { AttentionBand } from "@/components/report/AttentionBand";
import { RetroView } from "./RetroView";
import { OutlookView } from "./OutlookView";
import type { RetroData, OutlookData } from "./reportShared";
import { reportTypeScale, reportRadius, reportSpace } from "@/lib/reportTokens";

type Mode = "retro" | "outlook" | "health";
type TimeRange = "today" | "week" | "month" | "custom";

function getWeekStart(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const day = dt.getUTCDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1;
  dt.setUTCDate(dt.getUTCDate() - diff);
  return dt.toISOString().slice(0, 10);
}

function getMonthStart(dateStr: string): string {
  return dateStr.slice(0, 7) + "-01";
}

function getMonthEnd(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0, 12, 0, 0)); // day 0 of next month = last day of current
  return last.toISOString().slice(0, 10);
}

function getWeekEnd(dateStr: string): string {
  const weekStart = getWeekStart(dateStr);
  const [y, m, d] = weekStart.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 6, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

function computeRange(
  timeRange: TimeRange,
  today: string,
  customStart?: string,
  customEnd?: string,
): { start: string; end: string } {
  switch (timeRange) {
    case "today":
      return { start: today, end: today };
    case "week":
      return { start: getWeekStart(today), end: getWeekEnd(today) };
    case "month":
      return { start: getMonthStart(today), end: getMonthEnd(today) };
    case "custom":
      return {
        start: customStart ?? today,
        end: customEnd ?? today,
      };
  }
}

const BTN_BASE: React.CSSProperties = {
  height: 30,
  padding: `0 ${reportSpace.sm}px`,
  borderRadius: reportRadius.sm,
  border: "1px solid var(--border)",
  fontSize: reportTypeScale.base,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  whiteSpace: "nowrap",
  transition: "all 120ms ease-out",
  background: "var(--surface-2)",
  color: "var(--text)",
};

const BTN_ACTIVE: React.CSSProperties = {
  ...BTN_BASE,
  background: "var(--brand)",
  color: "var(--brand-contrast)",
  border: "1px solid var(--brand)",
};

/**
 * Odznak s počtem nálezů na záložce Kontrolní panel. Vidět i bez otevření.
 *
 * Výplň je SYTÁ, ne `color-mix(… , transparent)`, a to schválně: odznak sedí na
 * tlačítku záložky, které je v aktivním stavu žluté (`--brand`). Průsvitná
 * pilulka tu žlutou pouští skrz, takže zelené ✓ dávalo v tmavém režimu 1,30 : 1
 * a ⚠ dokonce 1,23 : 1 — nečitelné přesně na záložce, kterou má člověk
 * otevřenou. Sytá výplň je na podkladu nezávislá a dvojici výplň/`--status-on`
 * navíc měří strážný test (5,97–10,38 : 1).
 */
function HealthBadge({ loading, error, total, uncomputed, active }: { loading: boolean; error: string | null; total: number; uncomputed: number; active: boolean }) {
  const base: React.CSSProperties = {
    fontSize: reportTypeScale.sm, fontWeight: 800, lineHeight: 1, padding: `${reportSpace.xs}px ${reportSpace.sm}px`, borderRadius: reportRadius.pill,
    fontVariantNumeric: "tabular-nums", minWidth: 18, textAlign: "center",
  };
  if (loading) return <span style={{ ...base, color: active ? "var(--brand-contrast)" : "var(--text-muted)", opacity: 0.7 }}>…</span>;
  if (error) return <span style={{ ...base, background: "var(--status-warn)", color: "var(--status-on)" }} title={`Kontrolu nešlo načíst: ${error}`}>!</span>;
  if (total > 0) return <span style={{ ...base, background: "var(--status-bad)", color: "var(--status-on)" }}>{total}</span>;
  // Nespočtená kontrola NESMÍ propadnout na zelené ✓. Bez téhle větve platilo:
  // kontrola selže, ostatní jsou čisté → total === 0 → odznak hlásí „v pořádku",
  // uživatel do panelu vůbec neklikne a o selhání se nedozví. `error` výš chytá
  // jen pád celého fetche, ne dílčí kontrolu.
  if (uncomputed > 0) return <span style={{ ...base, background: "var(--status-warn)", color: "var(--status-on)" }} title={`${uncomputed === 1 ? "1 kontrola se nespočetla" : `${uncomputed} kontroly se nespočetly`} — otevři Kontrolní panel`}>⚠</span>;
  return <span style={{ ...base, background: "var(--status-ok)", color: "var(--status-on)" }}>✓</span>;
}

export default function ReportDashboard() {
  const today = todayPragueDateStr();

  const [mode, setMode] = useState<Mode>("retro");
  const [timeRange, setTimeRange] = useState<TimeRange>("week");
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data Kontrolního panelu — fetch jednou při vstupu, krmí odznak i panel.
  const health = useHealthData();

  // Stavový pás — serverová část z /api/report/attention, Kontrolní panel z dat,
  // která už klient má. `loaded: health.data != null` znamená „nevíme" i při
  // chybě fetche, takže pás o kontrolách raději mlčí, než aby tvrdil, že je čisto.
  const attention = useAttentionData({ loaded: health.data != null, total: health.total, uncomputed: health.uncomputed });

  const { start, end } = computeRange(timeRange, today, customStart, customEnd);

  const fetchData = useCallback(async () => {
    if (mode === "health") return; // health data teče z useHealthData, ne z dashboard API
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        mode,
        rangeStart: start,
        rangeEnd: end,
      });
      const res = await fetch(`/api/report/dashboard?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Neznámá chyba");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [mode, start, end]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "sans-serif",
      }}
    >
      {/* Header */}
      <ModuleHeader title="Reporty">
        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginRight: 4 }}>Režim:</span>
          <button
            style={mode === "retro" ? BTN_ACTIVE : BTN_BASE}
            onClick={() => setMode("retro")}
          >
            Retrospektiva
          </button>
          <button
            style={mode === "outlook" ? BTN_ACTIVE : BTN_BASE}
            onClick={() => setMode("outlook")}
          >
            Výhled
          </button>
          <button
            style={{ ...(mode === "health" ? BTN_ACTIVE : BTN_BASE), gap: 7 }}
            onClick={() => setMode("health")}
            title="Kontrolní panel — integrita dat"
          >
            🩺 Kontrolní panel
            <HealthBadge loading={health.loading} error={health.error} total={health.total} uncomputed={health.uncomputed} active={mode === "health"} />
          </button>
        </div>

        <div
          style={{
            width: 1,
            height: 20,
            background: "var(--border)",
            flexShrink: 0,
          }}
        />

        {/* Time range toggle */}
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginRight: 4 }}>Období:</span>
          {(["today", "week", "month", "custom"] as TimeRange[]).map((r) => (
            <button
              key={r}
              style={timeRange === r ? BTN_ACTIVE : BTN_BASE}
              onClick={() => setTimeRange(r)}
            >
              {r === "today" ? "Dnes" : r === "week" ? "Týden" : r === "month" ? "Měsíc" : "Vlastní"}
            </button>
          ))}
        </div>

        {/* Custom date pickers */}
        {timeRange === "custom" && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              style={{
                height: 28,
                padding: `0 ${reportSpace.xs}px`,
                borderRadius: reportRadius.sm,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text)",
                fontSize: reportTypeScale.base,
                cursor: "pointer",
              }}
            />
            <span style={{ fontSize: reportTypeScale.base, color: "var(--text-muted)" }}>–</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              style={{
                height: 28,
                padding: `0 ${reportSpace.xs}px`,
                borderRadius: reportRadius.sm,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text)",
                fontSize: reportTypeScale.base,
                cursor: "pointer",
              }}
            />
          </div>
        )}
      </ModuleHeader>

      {/* Body */}
      <div style={{ padding: reportSpace.xl }}>
        {/* V Kontrolním panelu se pás nekreslí — ukazoval by sám na sebe. */}
        {mode !== "health" && attention.ready && (
          <AttentionBand
            items={attention.items}
            calm={attention.calm}
            checkedAt={attention.checkedAt}
            onSwitchTab={setMode}
          />
        )}
        {mode === "health" ? (
          <HealthPanel
            data={health.data}
            loading={health.loading}
            error={health.error}
            total={health.total}
            badChecks={health.badChecks}
            uncomputed={health.uncomputed}
            onRefresh={health.refetch}
          />
        ) : (
          <>
            {/* Info bar */}
            <div
              style={{
                marginBottom: 16,
                fontSize: reportTypeScale.base,
                color: "var(--text-muted)",
              }}
            >
              {mode === "retro" ? "Retrospektiva" : "Výhled"} · {start === end ? start : `${start} – ${end}`}
            </div>

            {loading && (
              <div style={{ color: "var(--text-muted)", fontSize: reportTypeScale.md }}>Načítám data…</div>
            )}

            {error && (
              <div
                style={{
                  padding: `${reportSpace.md}px ${reportSpace.lg}px`,
                  borderRadius: reportRadius.md,
                  background: "color-mix(in oklab, var(--danger) 8%, transparent)",
                  border: "1px solid color-mix(in oklab, var(--danger) 25%, transparent)",
                  color: "var(--status-bad)",
                  fontSize: reportTypeScale.md,
                }}
              >
                Chyba: {error}
              </div>
            )}

            {!loading && !error && data !== null && mode === "retro" && (
              <RetroView data={data as RetroData} />
            )}

            {!loading && !error && data !== null && mode === "outlook" && (
              <OutlookView data={data as OutlookData} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
