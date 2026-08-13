"use client";

import React, { useState } from "react";
import type { IntegrityIssue } from "./useHealthData";
import CheckExplainer from "./CheckExplainer";

const TH: React.CSSProperties = {
  textAlign: "left", fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase",
  color: "var(--text-muted)", fontWeight: 600, padding: "8px 11px",
  background: "var(--surface-2)", borderBottom: "1px solid var(--border)",
};
const TD: React.CSSProperties = {
  padding: "9px 11px", borderBottom: "1px solid var(--border)", verticalAlign: "middle", fontSize: 13,
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("cs-CZ", {
    timeZone: "Europe/Prague", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Jeden řádek rozpadu Integrity. Řádek s nálezem je klikací a rozbalí se do
 * vysvětlivky a tabulky VŠECH nálezů — dřív se z padesáti posílaných položek
 * zobrazila jedna. Nulový a nespočtený řádek se nerozbalují (není co ukázat).
 */
export default function IntegrityRow({ issue }: { issue: IntegrityIssue }) {
  const [open, setOpen] = useState(false);
  const uncomputed = issue.count === null;
  const bad = (issue.count ?? 0) > 0;
  const expandable = bad && issue.items.length > 0;

  const dotColor = uncomputed
    ? "var(--warning)"
    : bad
      ? "var(--danger)"
      : "color-mix(in oklab, var(--success) 70%, transparent)";

  return (
    <div style={{ background: "var(--surface)" }}>
      <div
        onClick={() => expandable && setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 9, padding: "9px 13px", fontSize: 13,
          cursor: expandable ? "pointer" : "default", userSelect: "none",
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: dotColor }} />
        <span>{issue.label}</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            fontVariantNumeric: "tabular-nums", fontWeight: 700,
            color: uncomputed ? "var(--warning)" : bad ? "var(--danger)" : "var(--text-muted)",
          }}>
            {uncomputed ? "nespočteno" : issue.count}
          </span>
          {expandable && (
            <span style={{ color: "var(--text-muted)", fontSize: 11, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
          )}
        </span>
      </div>

      {uncomputed && issue.error && (
        <div style={{ padding: "0 13px 10px 29px", fontSize: 12, color: "var(--warning)" }}>
          Kontrola se nespočetla: {issue.error}
        </div>
      )}

      {open && expandable && (
        <div style={{ padding: "0 13px 13px" }}>
          <CheckExplainer copyKey={issue.key} />
          <div style={{ overflowX: "auto", marginTop: 8, border: "1px solid var(--border)", borderRadius: 9 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={TH}>Zakázka</th>
                  <th style={TH}>Stroj</th>
                  <th style={TH}>Detail</th>
                  <th style={TH}></th>
                </tr>
              </thead>
              <tbody>
                {issue.items.map((item) => (
                  <tr key={item.id}>
                    <td style={TD}>
                      <span style={{ fontWeight: 600 }}>{item.orderNumber || `#${item.id}`}</span>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtDateTime(item.startTime)}</div>
                    </td>
                    <td style={{ ...TD, fontWeight: 700, fontSize: 12 }}>{item.machine}</td>
                    <td style={{ ...TD, color: "var(--text-muted)" }}>{item.detail}</td>
                    <td style={TD}>
                      <a href={`/?highlight=${item.id}`} style={{ color: "var(--brand)", textDecoration: "none", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                        Otevřít v plánu →
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {issue.count !== null && issue.count > issue.items.length && (
            <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
              Zobrazeno {issue.items.length} z {issue.count} nálezů.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
