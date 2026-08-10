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
  /**
   * Potvrzovací podoba — žluté pozadí a tenhle popisek místo „✓ HOTOVO".
   * Používá jen Monitor u zakázky, která ještě nezačala; karta bloku v plánu
   * tuhle prop nepředává, takže se pro plánovače nic nemění.
   */
  confirmLabel?: string;
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
export function PrintDoneButton({ size, isDone, completedAt, pending, onToggle, confirmLabel }: Props) {
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

  // Potvrzovací stav má přednost před hoverem i běžnou zelenou, ale ne nad
  // `isDone`/`pending` — ty popisují, co se s tlačítkem právě děje.
  const isConfirm = !!confirmLabel && !isDone && !pending;

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
        // Potvrzovací popisek je delší než „✓ HOTOVO" — na hero tlačítku by se
        // ve 30 px nevešel, proto strop 20 px.
        fontSize: isDone && size.variant === "bar" ? Math.min(size.fontSize, 13)
          : isConfirm ? Math.min(size.fontSize, 20)
          : size.fontSize,
        fontWeight: isDone ? 620 : 750,
        letterSpacing: isDone ? 0 : "0.05em",
        background: isDone ? "var(--surface-3)"
          : isConfirm ? "var(--warning)"
          : isHoverActive ? "color-mix(in oklab, var(--success) 82%, white)"
          : "var(--success)",
        boxShadow: isHoverActive ? "0 0 0 3px color-mix(in oklab, var(--success) 34%, transparent)" : undefined,
        // --brand-contrast je projektová tmavá barva pro text na světlém akcentu
        // (--warning i --brand jsou v obou tématech světlé), proto ji sdílíme.
        color: isDone ? "var(--text-muted)"
          : isConfirm ? "var(--brand-contrast)"
          : "var(--success-contrast)",
        opacity: pending ? 0.5 : 1,
        transition: "all 0.12s ease-out",
        whiteSpace: "nowrap", overflow: "hidden",
      }}
    >
      {pending ? "·" : isConfirm ? confirmLabel : isWide ? wideLabel : isDone ? "↩" : "✓"}
    </button>
  );
}
