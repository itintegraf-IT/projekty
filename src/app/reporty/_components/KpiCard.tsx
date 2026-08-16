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
export function KpiCard({
  label,
  value,
  subtitle,
  color,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  color?: string;
}) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: reportRadius.lg,
      padding: `${reportSpace.md}px ${reportSpace.lg}px`, flex: "1 1 0",
    }}>
      <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      {/* `tabular-nums`: číslice mají stejnou šířku, takže hodnota při přepnutí období neposkakuje. */}
      <div style={{ fontSize: reportTypeScale.display, fontWeight: 700, color: color ?? "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {subtitle && <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{subtitle}</div>}
    </div>
  );
}
