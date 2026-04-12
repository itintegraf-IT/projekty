"use client";
import React from "react";
import type { ExpediceItem } from "@/lib/expediceTypes";

const BADGE_CONFIG = {
  PLANNED_JOB:       { label: "TISK",    bg: "rgba(59,130,246,0.15)",  color: "#3b82f6" },
  MANUAL_JOB:        { label: "RUČNÍ",   bg: "rgba(34,197,94,0.15)",   color: "#22c55e" },
  INTERNAL_TRANSFER: { label: "INTERNÍ", bg: "rgba(249,115,22,0.15)",  color: "#f97316" },
} as const;

interface ExpediceCardProps {
  item: ExpediceItem;
  selected?: boolean;
  onClick?: () => void;
  density?: "detail" | "standard" | "compact";
}

export function ExpediceCard({ item, selected, onClick, density = "standard" }: ExpediceCardProps) {
  const badge  = BADGE_CONFIG[item.itemKind];
  const vPad   = density === "detail" ? 10 : density === "compact" ? 4 : 7;
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", flexDirection: "column", gap: 3,
        padding: `${vPad}px 10px`,
        borderRadius: 8,
        background: selected
          ? "rgba(59,130,246,0.1)"
          : hovered ? "rgba(255,255,255,0.04)" : "var(--surface-2)",
        border: `1px solid ${selected ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.07)"}`,
        cursor: "pointer",
        minWidth: 0,
        transition: "all 120ms ease-out",
      }}
    >
      {/* Řádek 1: badge + číslo zakázky + stroj (jen pro block items) */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
          padding: "1px 5px", borderRadius: 4, flexShrink: 0,
          background: badge.bg, color: badge.color,
        }}>
          {badge.label}
        </span>
        {item.orderNumber && (
          <span style={{
            fontSize: 11, fontWeight: 600, color: "var(--text)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {item.orderNumber}
          </span>
        )}
        {"machine" in item && item.machine && (
          <span style={{
            marginLeft: "auto", fontSize: 9, color: "var(--text-muted)",
            flexShrink: 0,
          }}>
            {item.machine.replace("_", " ")}
          </span>
        )}
      </div>

      {/* Řádek 2: popis */}
      {item.description && (
        <div style={{
          fontSize: 11, color: "var(--text-muted)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {item.description}
        </div>
      )}

      {/* Řádek 3: expediceNote + doprava (jen v detail a standard hustotě) */}
      {density !== "compact" && (item.expediceNote || item.doprava) && (
        <div style={{
          fontSize: 10, color: "rgba(255,255,255,0.38)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {[item.expediceNote, item.doprava].filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  );
}
