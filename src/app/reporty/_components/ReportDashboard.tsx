"use client";

import React, { useState, useEffect, useCallback } from "react";
import { todayPragueDateStr } from "@/lib/dateUtils";
import { machineLabel } from "@/lib/machines";
import { ModuleHeader } from "@/components/ModuleHeader";
import HealthPanel from "./HealthPanel";
import { useHealthData } from "./useHealthData";
import { OPEN_STATUSES, CLOSED_STATUSES } from "@/lib/reservationStatus";
import { KpiCard } from "./KpiCard";
import { PlanningSection, type PlanningMetrics, type PlannerActivityEntry } from "./PlanningSection";

type Mode = "retro" | "outlook" | "health";
type TimeRange = "today" | "week" | "month" | "custom";

interface RetroMachineData {
  utilization: number | null;
  productionHours: number;
  maintenanceHours: number;
  availableHours: number;
  /** Ratio údržby JEN tohoto stroje — souhrn přes oba ho ředí kapacitou druhého. */
  maintenanceRatio: number | null;
}

interface RetroData {
  machines: Record<string, RetroMachineData>;
  dailyUtilization: Array<{ date: string; XL_105: number | null; XL_106: number | null }>;
  throughput: number;
  avgLeadTimeDays: number | null;
  maintenanceRatio: number | null;
  planning: PlanningMetrics;
  plannerActivity: PlannerActivityEntry[];
  pipeline: { open: Record<string, number>; closed: Record<string, number>; conversionPercent: number | null };
  logins: { periodCount: number; activeUsers: number };
}

interface OutlookMachineData {
  plannedCapacity: number | null;
  freeHours: number;
  /** Kladné číslo — o kolik hodin je stroj nad kapacitou; 0 když se plán vejde. */
  overbookedHours: number;
  availableHours: number;
}

interface OutlookData {
  machines: Record<string, OutlookMachineData>;
  dailyCapacity: Array<{ date: string; XL_105: number | null; XL_106: number | null }>;
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

const DOW_LABELS = ["Ne","Po","Út","St","Čt","Pá","So"];

/** Číslo v české podobě — desetinná čárka. Jedno místo, ať se zápis nerozejde. */
const cz = (n: number | null | undefined) => String(n ?? 0).replace(".", ",");

/** Odznak s počtem nálezů na záložce Kontrolní panel. Vidět i bez otevření. */
function HealthBadge({ loading, error, total, uncomputed, active }: { loading: boolean; error: string | null; total: number; uncomputed: number; active: boolean }) {
  const base: React.CSSProperties = {
    fontSize: 11, fontWeight: 800, lineHeight: 1, padding: "3px 7px", borderRadius: 999,
    fontVariantNumeric: "tabular-nums", minWidth: 18, textAlign: "center",
  };
  if (loading) return <span style={{ ...base, color: active ? "var(--brand-contrast)" : "var(--text-muted)", opacity: 0.7 }}>…</span>;
  if (error) return <span style={{ ...base, background: "color-mix(in oklab, var(--warning) 25%, transparent)", color: "var(--warning-text)" }} title={`Kontrolu nešlo načíst: ${error}`}>!</span>;
  if (total > 0) return <span style={{ ...base, background: "var(--danger)", color: "#fff" }}>{total}</span>;
  // Nespočtená kontrola NESMÍ propadnout na zelené ✓. Bez téhle větve platilo:
  // kontrola selže, ostatní jsou čisté → total === 0 → odznak hlásí „v pořádku",
  // uživatel do panelu vůbec neklikne a o selhání se nedozví. `error` výš chytá
  // jen pád celého fetche, ne dílčí kontrolu.
  if (uncomputed > 0) return <span style={{ ...base, background: "color-mix(in oklab, var(--warning) 25%, transparent)", color: "var(--warning-text)" }} title={`${uncomputed === 1 ? "1 kontrola se nespočetla" : `${uncomputed} kontroly se nespočetly`} — otevři Kontrolní panel`}>⚠</span>;
  return <span style={{ ...base, background: "color-mix(in oklab, var(--success) 22%, transparent)", color: "var(--success)" }}>✓</span>;
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
  data: Array<Record<string, number | string | null>>;
  barKeys: string[];
  colors: string[];
  labels?: string[];
}) {
  const maxVal = Math.max(...data.flatMap((d) => barKeys.map((k) => (d[k] as number | null) ?? 0)), 1);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", gap: 1, flex: 1 }}>
            {barKeys.map((k, ki) => {
              const v = d[k] as number | null;
              // Den bez směn se NEkreslí jako nulový sloupec — „stroj nejede“ není „nic se nedělá“.
              if (v == null) return <div key={k} style={{ flex: 1 }} title={`${d.date ?? ""}: stroj nejede`} />;
              return (
                <div key={k} style={{
                  flex: 1, background: colors[ki], borderRadius: "2px 2px 0 0",
                  height: `${Math.max(2, v / maxVal * 100)}%`, minHeight: 2,
                }} title={`${d.date ?? ""}: ${v}%`} />
              );
            })}
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
          <span key={k} style={{ fontSize: 9, color: colors[i] }}>&#9632; {machineLabel(k)}</span>
        ))}
      </div>
    </div>
  );
}

function RetroView({ data }: { data: RetroData }) {
  if (!data.machines || !data.dailyUtilization) return null;
  const xl105 = data.machines["XL_105"];
  const xl106 = data.machines["XL_106"];
  // Rozdělení otevřené/uzavřené se bere ze slovníku, ne z vlastní kopie — jinak by devátý
  // stav shodil jen strážný test slovníku a klient by ho tiše nezobrazil.
  const pipelineOpen = OPEN_STATUSES;
  const pipelineClosed = CLOSED_STATUSES;
  const pipelineColors: Record<string, string> = {
    SUBMITTED: "#f0883e", ACCEPTED: "#3b82f6", QUEUE_READY: "#a371f7", COUNTER_PROPOSED: "#d29922",
    SCHEDULED: "#3fb950", CONFIRMED: "#1f6feb", REJECTED: "#f85149", WITHDRAWN: "#8b949e",
  };
  const pipelineLabels: Record<string, string> = {
    SUBMITTED: "Nové", ACCEPTED: "Přijaté", QUEUE_READY: "Ve frontě", COUNTER_PROPOSED: "Protinávrh",
    SCHEDULED: "Naplánované", CONFIRMED: "Potvrzené", REJECTED: "Zamítnuté", WITHDRAWN: "Stažené",
  };
  const openTotal = pipelineOpen.reduce((s, k) => s + (data.pipeline.open?.[k] ?? 0), 0);
  const closedTotal = pipelineClosed.reduce((s, k) => s + (data.pipeline.closed?.[k] ?? 0), 0);

  const chartLabels = data.dailyUtilization.length > 0
    ? [data.dailyUtilization[0].date.slice(5), data.dailyUtilization[data.dailyUtilization.length - 1].date.slice(5)]
    : undefined;

  return (
    <>
      {/* KPI row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
        <KpiCard
          label="Vytížení XL 105"
          value={xl105?.utilization == null ? "—" : `${xl105.utilization}%`}
          subtitle={`${String(xl105?.productionHours ?? 0).replace(".", ",")} hod. produkce`}
          color={xl105?.utilization == null ? undefined : xl105.utilization > 100 ? "#f85149" : xl105.utilization >= 80 ? "#3fb950" : "#f0883e"}
        />
        <KpiCard
          label="Vytížení XL 106"
          value={xl106?.utilization == null ? "—" : `${xl106.utilization}%`}
          subtitle={`${String(xl106?.productionHours ?? 0).replace(".", ",")} hod. produkce`}
          color={xl106?.utilization == null ? undefined : xl106.utilization > 100 ? "#f85149" : xl106.utilization >= 80 ? "#3fb950" : "#f0883e"}
        />
        <KpiCard label="Průtok zakázek" value={data.throughput} subtitle="dokončeno v období" />
        <KpiCard label="Průměrná lead time" value={data.avgLeadTimeDays == null ? "—" : `${String(data.avgLeadTimeDays).replace(".", ",")} d`} subtitle="od založení po dokončení" />
      </div>

      {/* VYROBA */}
      <SectionHeader label="VÝROBA" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Denní vytížení</div>
          <BarChart
            data={data.dailyUtilization}
            barKeys={["XL_105", "XL_106"]}
            colors={["#3b82f6", "#f0883e"]}
            labels={chartLabels}
          />
        </div>
        <div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Údržba ratio</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
              {data.maintenanceRatio == null ? "—" : `${data.maintenanceRatio}%`}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>čas údržby / celkový čas</div>
            {/* Souhrn přes oba stroje ředí odstávku jednoho kapacitou druhého — proto i per stroj. */}
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
              {machineLabel("XL_105")}: {xl105?.maintenanceRatio == null ? "—" : `${xl105.maintenanceRatio}%`}
              {" · "}
              {machineLabel("XL_106")}: {xl106?.maintenanceRatio == null ? "—" : `${xl106.maintenanceRatio}%`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <KpiCard label="Produkce XL 105" value={`${String(xl105?.productionHours ?? 0).replace(".", ",")} h`} subtitle={`z ${String(xl105?.availableHours ?? 0).replace(".", ",")} h dostupných`} />
            <KpiCard label="Produkce XL 106" value={`${String(xl106?.productionHours ?? 0).replace(".", ",")} h`} subtitle={`z ${String(xl106?.availableHours ?? 0).replace(".", ",")} h dostupných`} />
          </div>
        </div>
      </div>

      {/* PLANOVANI */}
      <SectionHeader label="PLÁNOVÁNÍ" />
      <PlanningSection
        planning={data.planning}
        plannerActivity={data.plannerActivity}
        logins={data.logins}
      />

      {/* OBCHOD */}
      <SectionHeader label="OBCHOD" />
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Pipeline rezervací</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
          Otevřené rezervace — stav k dnešku, nezávisle na období
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
          {pipelineOpen.map((k) => (
            <span key={k} style={{ fontSize: 11, color: "var(--text)", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: pipelineColors[k], display: "inline-block" }} />
              {pipelineLabels[k]}: {data.pipeline.open?.[k] ?? 0}
            </span>
          ))}
          {openTotal === 0 && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>žádné</span>}
        </div>

        {/* Ne „uzavřené v období“ — filtr je na datu ZALOŽENÍ, okamžik uzamčení DB neuchová
            (chybí `rejectedAt`). Popisek to musí říct, jinak si CFO čte jiné číslo, než vidí. */}
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
          Rezervace založené v období, které jsou dnes už uzavřené
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 8 }}>
          {pipelineClosed.map((k) => (
            <span key={k} style={{ fontSize: 11, color: "var(--text)", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: pipelineColors[k], display: "inline-block" }} />
              {pipelineLabels[k]}: {data.pipeline.closed?.[k] ?? 0}
            </span>
          ))}
          {closedTotal === 0 && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>žádné</span>}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Konverze: <strong style={{ color: "var(--text)" }}>
            {data.pipeline.conversionPercent == null ? "—" : `${data.pipeline.conversionPercent} %`}
          </strong> (úspěšně vyřízené z rezervací založených v období a dnes uzavřených)
        </div>
      </div>
    </>
  );
}

/**
 * Hodnota karty „Volné hod." — u přeplánovaného stroje ZÁPORNÁ, ne useknutá nula.
 *
 * Nula by na kartě stála přímo vedle karty kapacity, která u téhož stroje hlásí
 * „přeplánováno o 26 h" — dvě čísla, jeden stroj, protimluv. Schodek se znaménkem
 * říká totéž jako sousední karta, jen v hodinách volna. Karta je duplicitní a etapa
 * R3 ji ruší, tohle je jen srovnání do doby, než zmizí.
 */
function freeHoursValue(m: OutlookMachineData | undefined): string {
  // Stroj bez směn nemá „0 h volných" — nemá kapacitu vůbec.
  if (m == null || m.plannedCapacity == null) return "—";
  if (m.overbookedHours > 0) return `−${cz(m.overbookedHours)} h`;
  return `${cz(m.freeHours)} h`;
}

/**
 * Podtitulek karty kapacity musí přiznat totéž co hodnota nad ním. Dokud se řídil jen
 * `freeHours ?? 0`, hlásila karta u stroje bez směn „—" a hned pod tím „0 h volných“ —
 * což se čte jako „stroj je plný". Táž ztráta rozdílu mezi „nevím" a „nula", jakou
 * etapa opravovala u procent, jen přenesená do hodin.
 */
function capacitySubtitle(m: OutlookMachineData | undefined): string {
  if (m == null || m.plannedCapacity == null) return "stroj nejede";
  if (m.overbookedHours > 0) return `přeplánováno o ${cz(m.overbookedHours)} h`;
  return `${cz(m.freeHours)} h volných`;
}

/**
 * Barva se řídí TÝMŽ signálem jako podtitulek (`overbookedHours`), ne zaokrouhleným
 * procentem. Jinak by při 100,4 % vyšel `Math.round` na 100, karta by svítila zeleně
 * a pod ní stálo „přeplánováno o 0,1 h".
 */
function capacityColor(m: OutlookMachineData | undefined): string | undefined {
  if (m == null || m.plannedCapacity == null) return undefined;
  if (m.overbookedHours > 0) return "#f85149";
  return m.plannedCapacity >= 80 ? "#3fb950" : "#f0883e";
}

function OutlookView({ data }: { data: OutlookData }) {
  if (!data.dailyCapacity || !data.machines) return null;
  const xl105 = data.machines["XL_105"];
  const xl106 = data.machines["XL_106"];
  const machines = ["XL_105", "XL_106"] as const;
  const days = data.dailyCapacity.slice(0, 14);

  function heatColor(pct: number | null): string {
    if (pct == null) return "var(--surface-3)";   // stroj nejede
    if (pct > 100) return "#f85149";              // přeplánováno
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
          value={xl105?.plannedCapacity == null ? "—" : `${xl105.plannedCapacity}%`}
          subtitle={capacitySubtitle(xl105)}
          color={capacityColor(xl105)}
        />
        <KpiCard
          label="Kapacita XL 106"
          value={xl106?.plannedCapacity == null ? "—" : `${xl106.plannedCapacity}%`}
          subtitle={capacitySubtitle(xl106)}
          color={capacityColor(xl106)}
        />
        {/* Přeplánovaný stroj nemá „0 h volných", ale schodek. Bez znaménka by tahle karta
            tvrdila „0 h" hned vedle karty kapacity, která hlásí „přeplánováno o 26 h". */}
        <KpiCard
          label="Volné hod. XL 105"
          value={freeHoursValue(xl105)}
          subtitle={`z ${cz(xl105?.availableHours)} h`}
          color={capacityColor(xl105)}
        />
        <KpiCard
          label="Volné hod. XL 106"
          value={freeHoursValue(xl106)}
          subtitle={`z ${cz(xl106?.availableHours)} h`}
          color={capacityColor(xl106)}
        />
      </div>

      {/* KAPACITA */}
      <SectionHeader label="KAPACITA" />
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Heatmapa vytížení</div>
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
              <div style={{ fontSize: 10, color: "var(--text)", display: "flex", alignItems: "center" }}>{machineLabel(m)}</div>
              {days.map((d) => {
                const val = (d[m] as number | null) ?? null;
                return (
                  <div key={d.date} style={{
                    height: 24, borderRadius: 3, background: heatColor(val),
                    // Přeplánování a nevytížení sdílejí červenou. Rámeček je odliší tvarem,
                    // aniž by se do R1 tahala nová barva — legenda níž popisuje obojí.
                    boxShadow: val != null && val > 100 ? "inset 0 0 0 2px var(--text)" : undefined,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 8, color: val != null && val > 0 ? "#fff" : "var(--text-muted)", fontWeight: 600,
                  }} title={`${d.date}: ${val == null ? "stroj nejede" : val > 100 ? val + " % — přeplánováno" : val + " %"}`}>
                    {val == null ? "" : val > 0 ? `${val}` : ""}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
        {/* Legenda MUSÍ vyjmenovat všech pět stavů, které `heatColor` umí. Etapa přidala
            větev nad 100 % a stav „stroj nejede“, ale legenda o nich nevěděla — červená
            tak měla dva významy a přeplánovaný den se četl jako nejhorší nevytížení. */}
        <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
          {[
            { c: "#f85149", label: "nad 100 % — přeplánováno", ring: true },
            { c: "#3fb950", label: "80–100 %", ring: false },
            { c: "#f0883e", label: "50–79 %", ring: false },
            { c: "#f85149", label: "pod 50 %", ring: false },
            { c: "var(--surface-3)", label: "stroj nejede", ring: false },
          ].map((it) => (
            <span key={it.label} style={{ fontSize: 9, display: "flex", alignItems: "center", gap: 3, color: "var(--text-muted)" }}>
              <span style={{
                width: 10, height: 10, borderRadius: 2, background: it.c, display: "inline-block",
                border: "1px solid var(--border)",
                boxShadow: it.ring ? "inset 0 0 0 2px var(--text)" : undefined,
              }} /> {it.label}
            </span>
          ))}
        </div>
      </div>

      {/* RIZIKA */}
      <SectionHeader label="RIZIKA" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Planned maintenance */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Plánované údržby</div>
          {data.upcomingMaintenance.slice(0, 5).map((m, i) => {
            const startDt = new Date(m.startTime);
            const endDt = new Date(m.endTime);
            const hours = Math.round((endDt.getTime() - startDt.getTime()) / 3600000 * 10) / 10;
            return (
              <div key={i} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: i < 4 ? "1px solid var(--border)" : "none" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{machineLabel(m.machine)}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{m.description}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  {startDt.toISOString().slice(0, 10)} · {cz(hours)} h
                </div>
              </div>
            );
          })}
          {data.upcomingMaintenance.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Žádné plánované údržby</div>
          )}
        </div>
        {/* Pending reservations */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Čekající na zpracování</div>
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <KpiCard label="Nové rezervace" value={data.pendingReservations.newCount} subtitle="čeká na přijetí" />
            <KpiCard label="Ve frontě" value={data.pendingReservations.queueCount} subtitle="připraveno k plánování" />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Nejstarší čekající: <strong style={{ color: data.pendingReservations.oldestWaitingDays > 3 ? "#f85149" : "var(--text)" }}>
              {data.pendingReservations.newCount === 0 ? "—" : `${data.pendingReservations.oldestWaitingDays} dní`}
            </strong>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>stav k dnešku, nezávisle na období</div>
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

  // Data Kontrolního panelu — fetch jednou při vstupu, krmí odznak i panel.
  const health = useHealthData();

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
      </ModuleHeader>

      {/* Body */}
      <div style={{ padding: 24 }}>
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
          </>
        )}
      </div>
    </div>
  );
}
