"use client";

import type { PrintDoneSize } from "@/lib/tiskarBlockView";
import { formatPragueTime } from "@/lib/dateUtils";

type Props = {
  size: PrintDoneSize;
  isDone: boolean;
  /** ISO string z Block.printCompletedAt, nebo null. */
  completedAt: string | null;
  pending: boolean;
  onToggle: () => void;
};

/**
 * Tlačítko „Hotovo" na kartě bloku v tiskařském režimu.
 *
 * Jediný zdroj vzhledu pro všechna tři místa v BlockCard (FULL / COMPACT / TINY).
 * Rozměr přichází zvenčí z printDoneSize() — komponenta nezná layout režimy karty.
 * Barvy jdou výhradně přes tokeny, aby fungoval světlý i tmavý režim.
 */
export function PrintDoneButton({ size, isDone, completedAt, pending, onToggle }: Props) {
  const isBar = size.variant === "bar";

  const barLabel = isDone
    ? completedAt
      ? `✓ Hotovo ${formatPragueTime(new Date(completedAt))}`
      : "✓ Hotovo"
    : "✓ HOTOVO";

  return (
    <button
      onClick={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onToggle();
      }}
      disabled={pending}
      title={isDone ? "Vrátit hotovo" : "Označit jako hotovo"}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: isBar ? 6 : 0,
        width: isBar ? "100%" : size.height,
        height: size.height,
        flexShrink: 0,
        border: "none", borderRadius: 5,
        cursor: pending ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        // Popisek po odklepnutí je delší ("✓ Hotovo 14:32") — strop 13 px,
        // aby se na užším sloupci nepřetekl.
        fontSize: isDone && isBar ? Math.min(size.fontSize, 13) : size.fontSize,
        fontWeight: isDone ? 620 : 750,
        letterSpacing: isDone ? 0 : "0.05em",
        background: isDone ? "var(--surface-3)" : "var(--success)",
        color: isDone ? "var(--text-muted)" : "var(--success-contrast)",
        opacity: pending ? 0.5 : 1,
        transition: "all 0.12s ease-out",
        whiteSpace: "nowrap", overflow: "hidden",
      }}
    >
      {pending ? "·" : isBar ? barLabel : isDone ? "↩" : "✓"}
    </button>
  );
}
