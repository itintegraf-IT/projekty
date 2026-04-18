"use client";

import React, { useState, useEffect, useCallback } from "react";
import { todayPragueDateStr } from "@/lib/dateUtils";

type Mode = "retro" | "outlook";
type TimeRange = "today" | "week" | "month" | "custom";

interface RetroMachineData {
  utilization: number;
  productionHours: number;
  maintenanceHours: number;
  availableHours: number;
}

interface RetroData {
  machines: Record<string, RetroMachineData>;
  dailyUtilization: Array<{ date: string; XL_105: number; XL_106: number }>;
  throughput: number;
  avgLeadTimeDays: number;
  maintenanceRatio: number;
  planning: { rescheduleCount: number; stabilityPercent: number };
  plannerActivity: Array<{ username: string; actionCount: number }>;
  pipeline: { SUBMITTED: number; ACCEPTED: number; QUEUE_READY: number; SCHEDULED: number; REJECTED: number; conversionPercent: number };
}

interface OutlookMachineData {
  plannedCapacity: number;
  freeHours: number;
  availableHours: number;
}

interface OutlookData {
  machines: Record<string, OutlookMachineData>;
  dailyCapacity: Array<{ date: string; XL_105: number; XL_106: number }>;
  upcomingMaintenance: Array<{ machine: string; description: string; startTime: string; endTime: string }>;
  pendingReservations: { newCount: number; queueCount: number; oldestWaitingDays: number };
}

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

const DOW_LABELS = ["Ne","Po","Ut","St","Ct","Pa","So"];

function KpiCard({ label, value, subtitle, color }: { label: string; value: string | number; subtitle?: string; color?: string }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
      padding: "14px 16px", flex: "1 1 0",
    }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color ?? "var(--text)" }}>{value}</div>
      {subtitle && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 12, color: "var(--brand)", fontWeight: 600,
      borderBottom: "1px solid var(--border)", paddingBottom: 4, marginBottom: 12, marginTop: 24,
    }}>
      {label}
    </div>
  );
}

function BarChart({ data, barKeys, colors, labels }: {
  data: Array<Record<string, number | string>>;
  barKeys: string[];
  colors: string[];
  labels?: string[];
}) {
  const maxVal = Math.max(...data.flatMap((d) => barKeys.map((k) => (d[k] as number) ?? 0)), 1);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", gap: 1, flex: 1 }}>
            {barKeys.map((k, ki) => (
              <div key={k} style={{
                flex: 1, background: colors[ki],
                borderRadius: "2px 2px 0 0",
                height: `${Math.max(2, ((d[k] as number) ?? 0) / maxVal * 100)}%`,
                minHeight: 2,
              }} title={`${d.date ?? ""}: ${d[k]}%`} />
            ))}
          </div>
        ))}
      </div>
      {labels && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          {labels.map((l, i) => <span key={i} style={{ fontSize: 8, color: "var(--text-muted)" }}>{l}</span>)}
        </div>
      )}
      <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
        {barKeys.map((k, i) => (
          <span key={k} style={{ fontSize: 9, color: colors[i] }}>&#9632; {k.replace("_", " ")}</span>
        ))}
      </div>
    </div>
  );
}

function RetroView({ data }: { data: RetroData }) {
  const xl105 = data.machines["XL_105"];
  const xl106 = data.machines["XL_106"];
  const pipelineKeys = ["SUBMITTED", "ACCEPTED", "QUEUE_READY", "SCHEDULED", "REJECTED"] as const;
  const pipelineColors: Record<string, string> = {
    SUBMITTED: "#f0883e", ACCEPTED: "#3b82f6", QUEUE_READY: "#a371f7",
    SCHEDULED: "#3fb950", REJECTED: "#f85149",
  };
  const pipelineLabels: Record<string, string> = {
    SUBMITTED: "Nove", ACCEPTED: "Prijate", QUEUE_READY: "Ve fronte",
    SCHEDULED: "Naplanovane", REJECTED: "Zamitnute",
  };
  const pipelineTotal = pipelineKeys.reduce((sum, k) => sum + (data.pipeline[k] ?? 0), 0);
  const maxActivity = Math.max(...data.plannerActivity.map((a) => a.actionCount), 1);

  const chartLabels = data.dailyUtilization.length > 0
    ? [data.dailyUtilization[0].date.slice(5), data.dailyUtilization[data.dailyUtilization.length - 1].date.slice(5)]
    : undefined;

  return (
    <>
      {/* KPI row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
        <KpiCard
          label="Vytizeni XL 105"
          value={`${xl105?.utilization ?? 0}%`}
          subtitle={`${xl105?.productionHours ?? 0} hod. produkce`}
          color={(xl105?.utilization ?? 0) >= 80 ? "#3fb950" : "#f0883e"}
        />
        <KpiCard
          label="Vytizeni XL 106"
          value={`${xl106?.utilization ?? 0}%`}
          subtitle={`${xl106?.productionHours ?? 0} hod. produkce`}
          color={(xl106?.utilization ?? 0) >= 80 ? "#3fb950" : "#f0883e"}
        />
        <KpiCard label="Prutok zakazek" value={data.throughput} subtitle="dokonceno v obdobi" />
        <KpiCard label="Prumerna lead time" value={`${data.avgLeadTimeDays} d`} subtitle="od vytvoreni po dokonceni" />
      </div>

      {/* VYROBA */}
      <SectionHeader label="VYROBA" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Denni vytizeni</div>
          <BarChart
            data={data.dailyUtilization}
            barKeys={["XL_105", "XL_106"]}
            colors={["#3b82f6", "#f0883e"]}
            labels={chartLabels}
          />
        </div>
        <div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Udrzba ratio</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text)" }}>{data.maintenanceRatio}%</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>cas udrzby / celkovy cas</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <KpiCard label="Produkce XL 105" value={`${xl105?.productionHours ?? 0} h`} subtitle={`z ${xl105?.availableHours ?? 0} h dostupnych`} />
            <KpiCard label="Produkce XL 106" value={`${xl106?.productionHours ?? 0} h`} subtitle={`z ${xl106?.availableHours ?? 0} h dostupnych`} />
          </div>
        </div>
      </div>

      {/* PLANOVANI */}
      <SectionHeader label="PLANOVANI" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <KpiCard label="Preplanovani" value={data.planning.rescheduleCount} subtitle="bloky presunuty" />
          <KpiCard label="Stabilita planu" value={`${data.planning.stabilityPercent}%`} subtitle="bloku beze zmeny" />
        </div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Aktivita planovacu</div>
          {data.plannerActivity.map((a) => (
            <div key={a.username} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, width: 80, flexShrink: 0, color: "var(--text)" }}>{a.username}</span>
              <div style={{ flex: 1, height: 8, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${(a.actionCount / maxActivity) * 100}%`, height: "100%", background: "var(--brand)", borderRadius: 4 }} />
              </div>
              <span style={{ fontSize: 10, color: "var(--text-muted)", width: 32, textAlign: "right" }}>{a.actionCount}</span>
            </div>
          ))}
          {data.plannerActivity.length === 0 && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Zadna aktivita</div>}
        </div>
      </div>

      {/* OBCHOD */}
      <SectionHeader label="OBCHOD" />
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Pipeline rezervaci</div>
        {/* Stacked bar */}
        {pipelineTotal > 0 && (
          <div style={{ display: "flex", height: 20, borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
            {pipelineKeys.map((k) => {
              const pct = (data.pipeline[k] ?? 0) / pipelineTotal * 100;
              if (pct === 0) return null;
              return <div key={k} style={{ width: `${pct}%`, background: pipelineColors[k], minWidth: 2 }} />;
            })}
          </div>
        )}
        {/* Legend */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 8 }}>
          {pipelineKeys.map((k) => (
            <span key={k} style={{ fontSize: 11, color: "var(--text)", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: pipelineColors[k], display: "inline-block" }} />
              {pipelineLabels[k]}: {data.pipeline[k] ?? 0}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Konverze: <strong style={{ color: "var(--text)" }}>{data.pipeline.conversionPercent}%</strong> (prijate → naplanovane)
        </div>
      </div>
    </>
  );
}

function OutlookView({ data }: { data: OutlookData }) {
  const xl105 = data.machines["XL_105"];
  const xl106 = data.machines["XL_106"];
  const machines = ["XL_105", "XL_106"] as const;
  const days = data.dailyCapacity.slice(0, 14);

  function heatColor(pct: number): string {
    if (pct === 0) return "var(--surface-2)";
    if (pct >= 80) return "#3fb950";
    if (pct >= 50) return "#f0883e";
    return "#f85149";
  }

  return (
    <>
      {/* KPI row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
        <KpiCard
          label="Kapacita XL 105"
          value={`${xl105?.plannedCapacity ?? 0}%`}
          subtitle={`${xl105?.freeHours ?? 0} h volnych`}
          color={(xl105?.plannedCapacity ?? 0) >= 80 ? "#3fb950" : "#f0883e"}
        />
        <KpiCard
          label="Kapacita XL 106"
          value={`${xl106?.plannedCapacity ?? 0}%`}
          subtitle={`${xl106?.freeHours ?? 0} h volnych`}
          color={(xl106?.plannedCapacity ?? 0) >= 80 ? "#3fb950" : "#f0883e"}
        />
        <KpiCard label="Volne hod. XL 105" value={`${xl105?.freeHours ?? 0} h`} subtitle={`z ${xl105?.availableHours ?? 0} h`} />
        <KpiCard label="Volne hod. XL 106" value={`${xl106?.freeHours ?? 0} h`} subtitle={`z ${xl106?.availableHours ?? 0} h`} />
      </div>

      {/* KAPACITA */}
      <SectionHeader label="KAPACITA" />
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Heatmapa vytizeni</div>
        <div style={{ display: "grid", gridTemplateColumns: `80px repeat(${days.length}, 1fr)`, gap: 2 }}>
          {/* Header row */}
          <div />
          {days.map((d) => {
            const dt = new Date(d.date + "T12:00:00Z");
            const dow = DOW_LABELS[dt.getUTCDay()];
            const dayNum = dt.getUTCDate();
            return (
              <div key={d.date} style={{ textAlign: "center", fontSize: 8, color: "var(--text-muted)", lineHeight: 1.2 }}>
                {dow}<br/>{dayNum}
              </div>
            );
          })}
          {/* Machine rows */}
          {machines.map((m) => (
            <React.Fragment key={m}>
              <div style={{ fontSize: 10, color: "var(--text)", display: "flex", alignItems: "center" }}>{m.replace("_", " ")}</div>
              {days.map((d) => {
                const val = (d[m] as number) ?? 0;
                return (
                  <div key={d.date} style={{
                    height: 24, borderRadius: 3, background: heatColor(val),
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 8, color: val > 0 ? "#fff" : "var(--text-muted)", fontWeight: 600,
                  }} title={`${d.date}: ${val}%`}>
                    {val > 0 ? `${val}` : ""}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
        {/* Legend */}
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <span style={{ fontSize: 9, display: "flex", alignItems: "center", gap: 3, color: "var(--text-muted)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#3fb950", display: "inline-block" }} /> 80%+
          </span>
          <span style={{ fontSize: 9, display: "flex", alignItems: "center", gap: 3, color: "var(--text-muted)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#f0883e", display: "inline-block" }} /> 50-79%
          </span>
          <span style={{ fontSize: 9, display: "flex", alignItems: "center", gap: 3, color: "var(--text-muted)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#f85149", display: "inline-block" }} /> &lt;50%
          </span>
        </div>
      </div>

      {/* RIZIKA */}
      <SectionHeader label="RIZIKA" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Planned maintenance */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Planovane udrzby</div>
          {data.upcomingMaintenance.slice(0, 5).map((m, i) => {
            const startDt = new Date(m.startTime);
            const endDt = new Date(m.endTime);
            const hours = Math.round((endDt.getTime() - startDt.getTime()) / 3600000 * 10) / 10;
            return (
              <div key={i} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: i < 4 ? "1px solid var(--border)" : "none" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{m.machine.replace("_", " ")}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{m.description}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  {startDt.toISOString().slice(0, 10)} · {hours} h
                </div>
              </div>
            );
          })}
          {data.upcomingMaintenance.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Zadne planovane udrzby</div>
          )}
        </div>
        {/* Pending reservations */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Cekajici na zpracovani</div>
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <KpiCard label="Nove rezervace" value={data.pendingReservations.newCount} subtitle="ceka na prijeti" />
            <KpiCard label="Ve fronte" value={data.pendingReservations.queueCount} subtitle="pripraveno k planovani" />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Nejstarsi cekajici: <strong style={{ color: data.pendingReservations.oldestWaitingDays > 3 ? "#f85149" : "var(--text)" }}>
              {data.pendingReservations.oldestWaitingDays} dni
            </strong>
          </div>
        </div>
      </div>
    </>
  );
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

  const { start, end } = computeRange(timeRange, today, customStart, customEnd);

  // Vyčistit data při změně parametrů — zabrání renderování starých dat s novým režimem
  useEffect(() => {
    setData(null);
  }, [mode, start, end]);

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

        {!loading && !error && data !== null && mode === "retro" && (
          <RetroView data={data as RetroData} />
        )}

        {!loading && !error && data !== null && mode === "outlook" && (
          <OutlookView data={data as OutlookData} />
        )}
      </div>
    </div>
  );
}
