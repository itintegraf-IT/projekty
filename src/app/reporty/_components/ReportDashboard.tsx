"use client";

import { useState, useEffect, useCallback } from "react";
import { todayPragueDateStr } from "@/lib/dateUtils";

type Mode = "retro" | "outlook";
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
  padding: "0 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  fontSize: 12,
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

export default function ReportDashboard() {
  const today = todayPragueDateStr();

  const [mode, setMode] = useState<Mode>("retro");
  const [timeRange, setTimeRange] = useState<TimeRange>("week");
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { start, end } = computeRange(timeRange, today, customStart, customEnd);

  const fetchData = useCallback(async () => {
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
      <div
        style={{
          height: 48,
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: 12,
        }}
      >
        <a
          href="/"
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            textDecoration: "none",
            display: "flex",
            alignItems: "center",
            gap: 4,
            whiteSpace: "nowrap",
          }}
        >
          ← Zpět na planner
        </a>

        <div
          style={{
            width: 1,
            height: 20,
            background: "var(--border)",
            flexShrink: 0,
          }}
        />

        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text)",
            flexShrink: 0,
          }}
        >
          Reporty
        </span>

        <div style={{ flex: 1 }} />

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 4 }}>Režim:</span>
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
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 4 }}>Období:</span>
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
                padding: "0 6px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text)",
                fontSize: 12,
                cursor: "pointer",
              }}
            />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>–</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              style={{
                height: 28,
                padding: "0 6px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text)",
                fontSize: 12,
                cursor: "pointer",
              }}
            />
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: 24 }}>
        {/* Info bar */}
        <div
          style={{
            marginBottom: 16,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          {mode === "retro" ? "Retrospektiva" : "Výhled"} · {start === end ? start : `${start} – ${end}`}
        </div>

        {loading && (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Načítám data…</div>
        )}

        {error && (
          <div
            style={{
              padding: "12px 16px",
              borderRadius: 8,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.25)",
              color: "var(--danger)",
              fontSize: 13,
            }}
          >
            Chyba: {error}
          </div>
        )}

        {!loading && !error && data !== null && (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 16,
              overflow: "auto",
            }}
          >
            <pre
              style={{
                fontSize: 12,
                color: "var(--text)",
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
