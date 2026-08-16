"use client";

import React from "react";
import { machineLabel } from "@/lib/machines";
import { OPEN_STATUSES, CLOSED_STATUSES } from "@/lib/reservationStatus";
import { KpiCard } from "./KpiCard";
import { PlanningSection } from "./PlanningSection";
import { pipelineToneFor, reportTypeScale, reportRadius } from "@/lib/reportTokens";
import { SectionHeader, BarChart, type RetroData } from "./reportShared";

/**
 * Barva hodnoty na KPI kartě vytížení — TŘI pásma, shodně s `capacityColor`
 * v záložce Výhled. Etapa R2 měla měnit barvy, ne meze.
 *
 * Navázat kartu na `heatToneFor` je svůdné a je to chyba: heatmapa má pásem
 * pět, protože rozlišuje „stroj nejede" od nuly a nevytížení od varování.
 * Karta by tím dostala dvě nová pásma, která na ní nikdy nebyla — stroj na
 * 42 % by z oranžové („pozor") přeskočil na modrošedou („nic se neděje") a
 * hlavně: karta „Kapacita" v sousední záložce by týž stroj na týchž 42 %
 * barvila dál oranžově. Dvě karty téže veličiny, dvě barvy podle záložky.
 * Přesně ten rozpor, který etapa odstraňovala u chipů typu bloku.
 */
const utilizationColor = (pct: number | null): string | undefined => {
  if (pct == null) return undefined;
  if (pct > 100) return "var(--status-bad)";
  return pct >= 80 ? "var(--status-ok)" : "var(--status-warn)";
};

export function RetroView({ data }: { data: RetroData }) {
  if (!data.machines || !data.dailyUtilization) return null;
  const xl105 = data.machines["XL_105"];
  const xl106 = data.machines["XL_106"];
  // Rozdělení otevřené/uzavřené se bere ze slovníku, ne z vlastní kopie — jinak by devátý
  // stav shodil jen strážný test slovníku a klient by ho tiše nezobrazil.
  const pipelineOpen = OPEN_STATUSES;
  const pipelineClosed = CLOSED_STATUSES;
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
          color={utilizationColor(xl105?.utilization ?? null)}
        />
        <KpiCard
          label="Vytížení XL 106"
          value={xl106?.utilization == null ? "—" : `${xl106.utilization}%`}
          subtitle={`${String(xl106?.productionHours ?? 0).replace(".", ",")} hod. produkce`}
          color={utilizationColor(xl106?.utilization ?? null)}
        />
        <KpiCard label="Průtok zakázek" value={data.throughput} subtitle="dokončeno v období" />
        <KpiCard label="Průměrná lead time" value={data.avgLeadTimeDays == null ? "—" : `${String(data.avgLeadTimeDays).replace(".", ",")} d`} subtitle="od založení po dokončení" />
      </div>

      {/* VYROBA */}
      <SectionHeader label="VÝROBA" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: reportRadius.lg, padding: 14 }}>
          <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginBottom: 8 }}>Denní vytížení</div>
          <BarChart
            data={data.dailyUtilization}
            barKeys={["XL_105", "XL_106"]}
            colors={["var(--series-a)", "var(--series-b)"]}
            labels={chartLabels}
          />
        </div>
        <div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: reportRadius.lg, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginBottom: 4 }}>Údržba ratio</div>
            <div style={{ fontSize: reportTypeScale.display, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
              {data.maintenanceRatio == null ? "—" : `${data.maintenanceRatio}%`}
            </div>
            <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", marginTop: 2 }}>čas údržby / celkový čas</div>
            {/* Souhrn přes oba stroje ředí odstávku jednoho kapacitou druhého — proto i per stroj. */}
            <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
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
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: reportRadius.lg, padding: 14 }}>
        <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginBottom: 8 }}>Pipeline rezervací</div>
        <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginBottom: 8 }}>
          Otevřené rezervace — stav k dnešku, nezávisle na období
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
          {pipelineOpen.map((k) => (
            <span key={k} style={{ fontSize: reportTypeScale.sm, color: "var(--text)", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: pipelineToneFor(k), display: "inline-block" }} />
              {pipelineLabels[k]}: {data.pipeline.open?.[k] ?? 0}
            </span>
          ))}
          {openTotal === 0 && <span style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>žádné</span>}
        </div>

        {/* Ne „uzavřené v období“ — filtr je na datu ZALOŽENÍ, okamžik uzamčení DB neuchová
            (chybí `rejectedAt`). Popisek to musí říct, jinak si CFO čte jiné číslo, než vidí. */}
        <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginBottom: 8 }}>
          Rezervace založené v období, které jsou dnes už uzavřené
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 8 }}>
          {pipelineClosed.map((k) => (
            <span key={k} style={{ fontSize: reportTypeScale.sm, color: "var(--text)", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: pipelineToneFor(k), display: "inline-block" }} />
              {pipelineLabels[k]}: {data.pipeline.closed?.[k] ?? 0}
            </span>
          ))}
          {closedTotal === 0 && <span style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>žádné</span>}
        </div>
        <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>
          Konverze: <strong style={{ color: "var(--text)" }}>
            {data.pipeline.conversionPercent == null ? "—" : `${data.pipeline.conversionPercent} %`}
          </strong> (úspěšně vyřízené z rezervací založených v období a dnes uzavřených)
        </div>
      </div>
    </>
  );
}
