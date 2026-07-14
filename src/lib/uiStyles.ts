import type { CSSProperties } from "react";

/**
 * Sdílené admin UI styly (audit #43) — jeden zdroj pravdy pro tlačítka a inputy admin sekce.
 * Dřív zkopírované v AdminDashboard, PrinterCodebook, MachineWorkHoursWeek, ShiftRoster
 * (btnPrimary/btnSecondary lišené jen 2px paddingem). Padding sjednocen na 16px.
 *
 * Barvy jdou přes tokeny; `btnAddAccent` drží dosavadní modrou 1:1 (tokenizace = follow-up).
 */
export const FONT_STACK = "-apple-system, BlinkMacSystemFont, sans-serif";

export const inputStyle: CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "7px 11px",
  color: "var(--text)",
  fontSize: 13,
  fontFamily: FONT_STACK,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

export const btnPrimary: CSSProperties = {
  background: "var(--brand)",
  color: "var(--brand-contrast)",
  border: "none",
  borderRadius: 8,
  padding: "7px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: FONT_STACK,
  whiteSpace: "nowrap",
};

export const btnSecondary: CSSProperties = {
  background: "var(--surface-2)",
  color: "var(--text-muted)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "7px 16px",
  fontSize: 13,
  cursor: "pointer",
  fontFamily: FONT_STACK,
  whiteSpace: "nowrap",
};

export const btnDanger: CSSProperties = {
  background: "color-mix(in oklab, var(--danger) 15%, transparent)",
  color: "var(--danger)",
  border: "1px solid color-mix(in oklab, var(--danger) 25%, transparent)",
  borderRadius: 8,
  padding: "5px 12px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: FONT_STACK,
  whiteSpace: "nowrap",
};

export const btnAddAccent: CSSProperties = {
  ...btnSecondary,
  display: "flex",
  alignItems: "center",
  gap: 7,
  background: "rgba(59,130,246,0.12)",
  color: "#3b82f6",
  border: "1px solid rgba(59,130,246,0.3)",
  fontWeight: 600,
};
