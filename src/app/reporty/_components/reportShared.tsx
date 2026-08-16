"use client";

import React from "react";
import { machineLabel } from "@/lib/machines";
import { reportTypeScale, reportRadius } from "@/lib/reportTokens";
import type { PlanningMetrics, PlannerActivityEntry } from "./PlanningSection";

export interface RetroMachineData {
  utilization: number | null;
  productionHours: number;
  maintenanceHours: number;
  availableHours: number;
  /** Ratio údržby JEN tohoto stroje — souhrn přes oba ho ředí kapacitou druhého. */
  maintenanceRatio: number | null;
}

export interface RetroData {
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

export interface OutlookMachineData {
  plannedCapacity: number | null;
  freeHours: number;
  /** Kladné číslo — o kolik hodin je stroj nad kapacitou; 0 když se plán vejde. */
  overbookedHours: number;
  availableHours: number;
}

/** Jedna čekající rezervace v seznamu RIZIK. Tvar vrací `/api/report/dashboard`. */
export interface PendingReservationItem {
  /** Id REZERVACE, ne bloku — nedá se předat do `/?highlight=`. */
  id: number;
  /** Číslo rezervace, jak ho vidí uživatel; API dosazuje `#id`, když je prázdné. */
  code: string;
  /** Volný text požadavku. Může být dlouhý i prázdný, ořez patří do komponenty. */
  requestText: string;
  waitingDays: number;
  status: string;
}

export interface OutlookData {
  machines: Record<string, OutlookMachineData>;
  dailyCapacity: Array<{ date: string; XL_105: number | null; XL_106: number | null }>;
  upcomingMaintenance: Array<{ machine: string; description: string; startTime: string; endTime: string }>;
  pendingReservations: {
    newCount: number;
    queueCount: number;
    /**
     * Počítá se JEN ze stavu SUBMITTED, kdežto `items` nese i QUEUE_READY.
     * Obě čísla se proto můžou rozejít („nejstarší 4 dny" nad seznamem s
     * položkou čekající 9 dní) a od R3 se `oldestWaitingDays` ZÁMĚRNĚ
     * nevykresluje — doba čekání je u každé položky seznamu zvlášť.
     */
    oldestWaitingDays: number;
    /** Nejdéle čekající, oříznuté na pět; strop je v UI přiznaný. */
    items: PendingReservationItem[];
    /** Kolik jich čeká celkem — bez ohledu na strop seznamu. */
    totalCount: number;
  };
}

export const DOW_LABELS = ["Ne","Po","Út","St","Čt","Pá","So"];

/** Číslo v české podobě — desetinná čárka. Jedno místo, ať se zápis nerozejde. */
export const cz = (n: number | null | undefined) => String(n ?? 0).replace(".", ",");

export function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: reportTypeScale.base, color: "var(--brand-text)", fontWeight: 600,
      borderBottom: "1px solid var(--border)", paddingBottom: 4, marginBottom: 12, marginTop: 24,
    }}>
      {label}
    </div>
  );
}

export function BarChart({ data, barKeys, colors, labels }: {
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
          {labels.map((l, i) => <span key={i} style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)" }}>{l}</span>)}
        </div>
      )}
      <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
        {barKeys.map((k, i) => (
          <span key={k} style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 9, height: 9, borderRadius: reportRadius.xs, background: colors[i], display: "inline-block", flexShrink: 0 }} />
            {machineLabel(k)}
          </span>
        ))}
      </div>
    </div>
  );
}
