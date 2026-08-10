"use client";

import type { Block } from "@/app/_components/TimelineGrid";
import { formatPragueTime } from "@/lib/dateUtils";

type Props = {
  blocks: Block[];
  heroId: number | null;
  onSelect: (block: Block) => void;
};

/**
 * Pravý sloupec Monitoru — dnešní zakázky na stroji.
 * Odklepnuté jsou ztlumené se zeleným háčkem, hlavní zakázka je zvýrazněná.
 * Kliknutí otevře detail bloku; odklepnout jde jen z velké karty vlevo.
 */
export function MonitorQueue({ blocks, heroId, onSelect }: Props) {
  if (blocks.length === 0) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: 14, padding: "12px 4px" }}>
        Dnes na tomhle stroji nic naplánováno.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", minHeight: 0 }}>
      {blocks.map((b) => {
        const isDone = b.printCompletedAt != null;
        const isHero = b.id === heroId;
        return (
          <button
            key={b.id}
            onClick={(e) => { if (e.button !== 0) return; onSelect(b); }}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "11px 12px",
              borderRadius: 10,
              textAlign: "left",
              font: "inherit",
              cursor: "pointer",
              background: isHero ? "color-mix(in oklab, var(--success) 12%, var(--surface))" : "var(--surface)",
              border: `1px solid ${isHero ? "var(--success)" : "var(--border)"}`,
              color: "var(--text)",
              opacity: isDone ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            <span style={{
              fontFamily: "ui-monospace, monospace",
              fontWeight: 700, fontVariantNumeric: "tabular-nums",
              fontSize: 14, flexShrink: 0,
              color: isDone ? "var(--success)" : "var(--text)",
            }}>
              {isDone ? "✓ " : ""}{b.orderNumber}
            </span>
            <span style={{
              color: "var(--text-muted)", fontSize: 13,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {b.description ?? ""}
            </span>
            <span style={{
              marginLeft: "auto", flexShrink: 0,
              color: "var(--text-muted)", fontSize: 13,
              fontVariantNumeric: "tabular-nums",
            }}>
              {formatPragueTime(new Date(b.startTime))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
