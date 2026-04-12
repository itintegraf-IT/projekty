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
  onDoubleClick?: () => void;
  density?: "detail" | "standard" | "compact";
  // Drag & drop
  draggable?: boolean;
  isDragging?: boolean;
  insertIndicator?: boolean;
  onDragStartCard?: () => void;
  onDragEndCard?: () => void;
  onDragEnterCard?: () => void;
}

export function ExpediceCard({
  item, selected, onClick, onDoubleClick, density = "standard",
  draggable: isDraggable, isDragging, insertIndicator,
  onDragStartCard, onDragEndCard, onDragEnterCard,
}: ExpediceCardProps) {
  const badge  = BADGE_CONFIG[item.itemKind];
  const vPad   = density === "detail" ? 10 : density === "compact" ? 4 : 7;
  const [hovered, setHovered] = React.useState(false);

  const titleParts = [
    item.orderNumber,
    item.description,
    item.expediceNote,
    item.doprava,
  ].filter(Boolean);
  const titleText = titleParts.join(" · ");

  return (
    <div style={{ position: "relative" }}>
      {/* Indikátor vložení před tuto kartu */}
      {insertIndicator && (
        <div style={{
          position: "absolute", top: -3, left: 0, right: 0,
          height: 2, borderRadius: 1,
          background: "#3b82f6",
          zIndex: 5,
          pointerEvents: "none",
        }} />
      )}

      <div
        title={titleText || undefined}
        draggable={isDraggable}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDragStart={onDragStartCard ? (e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", `${item.sourceType}-${item.id}`);
          onDragStartCard();
        } : undefined}
        onDragEnd={onDragEndCard}
        onDragEnter={onDragEnterCard ? (e) => {
          e.preventDefault();
          onDragEnterCard();
        } : undefined}
        onDragOver={onDragEnterCard ? (e) => { e.preventDefault(); e.stopPropagation(); } : undefined}
        style={{
          display: "flex", flexDirection: "column", gap: 3,
          padding: `${vPad}px 10px`,
          borderRadius: 8,
          background: selected
            ? "rgba(59,130,246,0.1)"
            : hovered ? "rgba(255,255,255,0.04)" : "var(--surface-2)",
          border: `1px solid ${selected ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.07)"}`,
          cursor: isDraggable
            ? (isDragging ? "grabbing" : "grab")
            : onClick ? "pointer" : "default",
          minWidth: 0,
          opacity: isDragging ? 0.45 : 1,
          transition: "all 120ms ease-out",
          userSelect: "none",
        }}
      >
        {/* Řádek 1: badge + číslo zakázky + doprava chip */}
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
              flex: 1, minWidth: 0,
            }}>
              {item.orderNumber}
            </span>
          )}
          {item.doprava && (
            <span style={{
              marginLeft: "auto", flexShrink: 0,
              fontSize: 11, fontWeight: 600,
              color: "#f59e0b",
              background: "rgba(245,158,11,0.12)",
              border: "1px solid rgba(245,158,11,0.25)",
              borderRadius: 6,
              padding: "2px 8px",
              maxWidth: 180,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {item.doprava}
            </span>
          )}
        </div>

        {/* Řádek 2: popis + expediceNote */}
        {(item.description || item.expediceNote) && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6, minWidth: 0,
          }}>
            {item.description && (
              <span style={{
                fontSize: 11, color: "var(--text-muted)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                flex: 1, minWidth: 0,
              }}>
                {item.description}
              </span>
            )}
            {item.expediceNote && (
              <span style={{
                fontSize: 10, fontWeight: 600,
                color: "#a78bfa",
                background: "rgba(167,139,250,0.1)",
                border: "1px solid rgba(167,139,250,0.2)",
                borderRadius: 5,
                padding: "1px 6px",
                flexShrink: 0,
                maxWidth: 140,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {item.expediceNote}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
