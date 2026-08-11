"use client";

import type React from "react";

export type DateChipState =
  | "ok" | "danger" | "warning" | "earlyStart" | "issued" | "empty" | "neutral";

/** Deadline barvy. Přesunuto z BlockCard — sdílí je všechny režimy karty. */
export const DEADLINE_BG: Record<DateChipState, string> = {
  ok:         "color-mix(in oklab, var(--success) 85%, black 15%)",
  danger:     "color-mix(in oklab, var(--danger) 85%, black 15%)",
  warning:    "color-mix(in oklab, var(--warning) 75%, black 25%)",
  earlyStart: "color-mix(in oklab, #f97316 85%, black 15%)",
  issued:     "color-mix(in oklab, #3b82f6 85%, black 15%)",
  empty:      "rgba(0,0,0,0.45)",
  neutral:    "rgba(255,255,255,0.18)",
};

export const DEADLINE_BORDER: Record<DateChipState, string> = {
  ok:         "color-mix(in oklab, var(--success) 70%, black 30%)",
  danger:     "color-mix(in oklab, var(--danger) 70%, black 30%)",
  warning:    "color-mix(in oklab, var(--warning) 60%, black 40%)",
  earlyStart: "color-mix(in oklab, #f97316 70%, black 30%)",
  issued:     "color-mix(in oklab, #3b82f6 70%, black 30%)",
  empty:      "rgba(255,255,255,0.55)",
  neutral:    "rgba(255,255,255,0.30)",
};

/**
 * Jednořádkový datumový chip na kartě bloku — „D 12.8 ✓".
 *
 * Nahradil dvouřádkový DateBadge (popisek „DATA" 8 px nad datem 11 px, ~22 px
 * výšky). Písmeno v textu a barevný proužek vlevo nesou stejnou informaci jako
 * to slovo, ale vejdou se do ~16 px — z uspořené výšky se platí větší písmo.
 *
 * Rozměry se odvozují od `fontSize`, aby chip rostl se stupněm písma jako celek.
 * Svislý padding je `fontSize * 0.2` schválně, ne „hezčích" 0.26 — skutečná výška
 * řádku (2× padding + fontSize + 2px hran) musí odpovídat vzorci `chip * 1.6`
 * v `plannerTypography.ts`, který z ní odvozuje práh plného layoutu; 0.26 by ho
 * u stupně XL podhodnotil o 1,6 px přesně tam, kde má hodinový blok rezervu jen 1 px.
 */
export function BlockDateChip({
  text, state, accent, fontSize,
  title, customBg, customBorder, customTextColor,
  onClick, onDoubleClick,
}: {
  text: string;
  state: DateChipState;
  /** Barva svislého proužku vlevo — identita pole (DATA / MAT / EXP / PANTONE). */
  accent: string;
  fontSize: number;
  title?: string;
  customBg?: string;
  customBorder?: string;
  customTextColor?: string;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
}) {
  const bg     = customBg ?? DEADLINE_BG[state];
  const border = customBorder ?? DEADLINE_BORDER[state];
  const color  = customTextColor ?? (state === "empty" ? "#fff" : "rgba(255,255,255,0.92)");
  return (
    <span
      title={title}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{
        fontSize,
        fontWeight: 600,
        color,
        background: bg,
        borderTop: `1px solid ${border}`,
        borderRight: `1px solid ${border}`,
        borderBottom: `1px solid ${border}`,
        borderLeft: `2px solid ${accent}`,
        borderRadius: 4,
        padding: `${Math.round(fontSize * 0.2)}px ${Math.round(fontSize * 0.55)}px`,
        whiteSpace: "nowrap",
        flexShrink: 0,
        lineHeight: 1,
        cursor: onClick ? "pointer" : "default",
        userSelect: "none",
      }}
    >
      {text}
    </span>
  );
}
