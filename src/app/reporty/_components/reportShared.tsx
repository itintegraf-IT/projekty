"use client";

import React from "react";
import { machineLabel } from "@/lib/machines";
import { reportTypeScale, reportRadius, reportSpace } from "@/lib/reportTokens";
import type { PlanningMetrics, PlannerActivityEntry } from "./PlanningSection";
import type { CalendarCascade } from "@/lib/reportMetrics";

export type { CalendarCascade };

export interface RetroMachineData {
  utilization: number | null;
  productionHours: number;
  maintenanceHours: number;
  availableHours: number;
  /** Ratio údržby JEN tohoto stroje — souhrn přes oba ho ředí kapacitou druhého. */
  maintenanceRatio: number | null;
  /** Rezervovaná kapacita stroje v hodinách (ořez oknem jako produkce) — etapa 9, rozhodnutí #5. */
  reservedHours: number;
  /** % rezervované kapacity z dostupných hodin JEN tohoto stroje; null při nulové kapacitě. */
  reservedRatio: number | null;
  /**
   * Kaskáda kalendář → obsazeno směnami → naplánováno → potvrzeno tiskařem.
   *
   * POZOR: hodiny jsou NEZAOKROUHLENÉ, na rozdíl od polí výš. Route je nechává
   * přesné, aby rozpad `unused` seděl na součet; zaokrouhlení na jedno desetinné
   * místo si musí udělat komponenta, protože `cz()` samo NEZAOKROUHLUJE a
   * `cz(153.90000000000003)` vypíše všech patnáct míst.
   */
  cascade: CalendarCascade;
}

export interface RetroData {
  machines: Record<string, RetroMachineData>;
  dailyUtilization: Array<{ date: string; XL_105: number | null; XL_106: number | null }>;
  throughput: number;
  avgLeadTimeDays: number | null;
  maintenanceRatio: number | null;
  /** Rezervovaná kapacita přes oba stroje — VLASTNÍ ukazatel vedle vytížení, ne jeho součást. */
  reservedRatio: number | null;
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

/**
 * Geometrie sloupcového grafu. NEJSOU to kroky `reportSpace` a schválně se na
 * ni nepřevádějí: ta škála (4/8/12/16/24) je pro ODSAZENÍ mezi prvky, kdežto
 * tohle jsou rozměry samotné kresby. Mezera 4 px mezi sloupci by u třicetidenního
 * období sežrala víc místa než sloupce samotné a graf by přestal být čitelný.
 *
 * Pojmenované konstanty jsou tu proto, aby čísla měla význam a měnila se na
 * jednom místě; strážný test v `reportTokens.test.ts` holé rozměry v JSX hlásí.
 */
const CHART_HEIGHT_PX = 80;
/** Mezera mezi dny (skupinami sloupců). */
const DAY_GAP_PX = 2;
/** Mezera mezi dvěma stroji uvnitř jednoho dne. */
const BAR_GAP_PX = 1;
/** Podlaha výšky sloupce — bez ní by malá nenulová hodnota zmizela úplně. */
const MIN_BAR_PX = 2;
/** Strana čtverečku v legendě. */
const SWATCH_PX = 9;

export function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: reportTypeScale.base, color: "var(--brand-text)", fontWeight: 600,
      borderBottom: "1px solid var(--border)", paddingBottom: reportSpace.xs,
      marginBottom: reportSpace.md, marginTop: reportSpace.xl,
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
      <div style={{ display: "flex", alignItems: "flex-end", gap: DAY_GAP_PX, height: CHART_HEIGHT_PX }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", gap: BAR_GAP_PX, flex: 1 }}>
            {barKeys.map((k, ki) => {
              const v = d[k] as number | null;
              // Den bez směn se NEkreslí jako nulový sloupec — „stroj nejede“ není „nic se nedělá“.
              if (v == null) return <div key={k} style={{ flex: 1 }} title={`${d.date ?? ""}: stroj nejede`} />;
              return (
                <div key={k} style={{
                  // Zaobluje se jen horní hrana sloupce; poloměr je krok škály
                  // (`xs`), týž, jaký má čtvereček legendy o pár řádků níž.
                  // Do R3 tu stály holé 2 px — prošly detektoru jen proto, že
                  // byly v uvozovkách.
                  flex: 1, background: colors[ki], borderRadius: `${reportRadius.xs}px ${reportRadius.xs}px 0 0`,
                  height: `${Math.max(MIN_BAR_PX, v / maxVal * 100)}%`, minHeight: MIN_BAR_PX,
                }} title={`${d.date ?? ""}: ${v}%`} />
              );
            })}
          </div>
        ))}
      </div>
      {labels && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: reportSpace.xs }}>
          {labels.map((l, i) => <span key={i} style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)" }}>{l}</span>)}
        </div>
      )}
      <div style={{ display: "flex", gap: reportSpace.md, marginTop: reportSpace.xs }}>
        {barKeys.map((k, i) => (
          <span key={k} style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: reportSpace.xs }}>
            <span style={{ width: SWATCH_PX, height: SWATCH_PX, borderRadius: reportRadius.xs, background: colors[i], display: "inline-block", flexShrink: 0 }} />
            {machineLabel(k)}
          </span>
        ))}
      </div>
    </div>
  );
}
