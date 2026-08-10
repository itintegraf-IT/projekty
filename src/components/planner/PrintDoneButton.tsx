"use client";

import { useState } from "react";
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
 * Tlačítko „Hotovo" v tiskařském režimu.
 *
 * Jediný zdroj vzhledu pro tři místa v BlockCard (FULL / COMPACT / TINY,
 * varianty `bar` a `square`) i pro velké tlačítko na Monitoru u stroje
 * (varianta `hero`). Rozměr přichází zvenčí — komponenta nezná layout
 * režimy karty ani rozvržení Monitoru.
 * Barvy jdou výhradně přes tokeny, aby fungoval světlý i tmavý režim.
 */
export function PrintDoneButton({ size, isDone, completedAt, pending, onToggle }: Props) {
  // `hero` (Monitor) i `bar` (karta bloku) jsou širokými variantami s popiskem;
  // `square` je jen háček. Jednotné jméno usnadňuje sdílenou logiku.
  const isWide = size.variant === "bar" || size.variant === "hero";
  const [hovered, setHovered] = useState(false);

  const wideLabel = isDone
    ? completedAt
      ? `✓ Hotovo ${formatPragueTime(new Date(completedAt))}`
      : "✓ Hotovo"
    : "✓ HOTOVO";

  const isHoverActive = hovered && !pending && !isDone;

  return (
    <button
      onClick={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onToggle();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={pending}
      title={isDone ? "Vrátit hotovo" : "Označit jako hotovo"}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: isWide ? 6 : 0,
        width: isWide ? "100%" : size.height,
        height: size.height,
        flexShrink: 0,
        border: "none", borderRadius: size.variant === "hero" ? 12 : 5,
        cursor: pending ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        // Popisek po odklepnutí je delší ("✓ Hotovo 14:32") — v úzkém sloupci
        // karty bloku (varianta `bar`) ho stropujeme na 13 px, aby nepřetekl.
        // Varianta `hero` na Monitoru má místa dost a zmenšovat se nesmí.
        fontSize: isDone && size.variant === "bar" ? Math.min(size.fontSize, 13) : size.fontSize,
        fontWeight: isDone ? 620 : 750,
        letterSpacing: isDone ? 0 : "0.05em",
        background: isDone ? "var(--surface-3)" : isHoverActive ? "color-mix(in oklab, var(--success) 82%, white)" : "var(--success)",
        boxShadow: isHoverActive ? "0 0 0 3px color-mix(in oklab, var(--success) 34%, transparent)" : undefined,
        color: isDone ? "var(--text-muted)" : "var(--success-contrast)",
        opacity: pending ? 0.5 : 1,
        transition: "all 0.12s ease-out",
        whiteSpace: "nowrap", overflow: "hidden",
      }}
    >
      {pending ? "·" : isWide ? wideLabel : isDone ? "↩" : "✓"}
    </button>
  );
}
