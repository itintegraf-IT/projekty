"use client";

import React from "react";

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
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
      padding: "14px 16px", flex: "1 1 0",
    }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color ?? "var(--text)" }}>{value}</div>
      {subtitle && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}
