"use client";

import React from "react";
import { reportTypeScale, reportRadius, reportSpace } from "@/lib/reportTokens";

/**
 * Jedna KPI dlaždice reportu. Vytaženo z `ReportDashboard.tsx`, aby ji mohly
 * sdílet i vydělené sekce (`PlanningSection`) bez kruhového importu.
 *
 * `value` je `string | number` schválně — některé karty ukazují „—", když pro
 * dané období data neexistují (viz pokrytí revizemi ve `PlanningSection`).
 */

/**
 * Mezera mezi řádky textu v kartě. ZÁMĚRNĚ mimo `reportSpace` (4/8/12/16/24):
 * tohle není odsazení panelu, ale optické rozestoupení řádků v jednom bloku
 * textu, pro které škála stupeň nemá. Pojmenovaná konstanta aspoň drží všechny
 * řádky karty na téže hodnotě — a detektor holých rozměrů (`reportTokens.test.ts`)
 * ji na rozdíl od čísla propustí.
 */
const CARD_LINE_GAP = 2;

export function KpiCard({
  label,
  value,
  subtitle,
  note,
  color,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  /**
   * Věta, která říká, CO se do čísla počítá. Vznikla v etapě 2 (září 2026):
   * „Vytížení výrobou" a „Obsazenost směn" jsou dvě různé definice a bez popisku
   * je z názvu nepozná nikdo, kdo u jejich pojmenování nebyl. Nesmí nahradit
   * `subtitle` — ten u Výhledu nese hodiny volna a je jejich jediným nositelem
   * od etapy R3.
   */
  note?: string;
  color?: string;
}) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: reportRadius.lg,
      padding: `${reportSpace.md}px ${reportSpace.lg}px`, flex: "1 1 0",
    }}>
      <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginBottom: reportSpace.xs }}>{label}</div>
      {/* `tabular-nums`: číslice mají stejnou šířku, takže hodnota při přepnutí období neposkakuje. */}
      <div style={{ fontSize: reportTypeScale.display, fontWeight: 700, color: color ?? "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {subtitle && <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", marginTop: CARD_LINE_GAP, fontVariantNumeric: "tabular-nums" }}>{subtitle}</div>}
      {/* Popisek je věta, ne číslo — `tabular-nums` by mu jen rozházel mezery. */}
      {note && <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", marginTop: CARD_LINE_GAP }}>{note}</div>}
    </div>
  );
}
