"use client";

import React from "react";

/**
 * PrimaryCta — hlavní akční tlačítko značky (audit #10/#65).
 *
 * Sjednocuje značkové CTA na `var(--brand)` / `var(--brand-contrast)` (dřív natvrdo `#FFE600`
 * + `rgba(255,255,255,…)`, což se rozbíjelo v light mode). Disabled/loading jde přes tokeny,
 * takže tlačítko sedí v obou theme.
 *
 * - `press` = stisk scale(0.97) mikro-interakce (builder vzor).
 * - `loading` = drží značkovou barvu s opacity 0.7 + wait kurzor (login vzor).
 * - `disabled` (a ne loading) = ztlumené pozadí + muted text.
 */
export type PrimaryCtaProps = {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  loading?: boolean;
  press?: boolean;
  fontSize?: number;
  /** Pevná výška (login vzor); jinak se použije vertikální padding. */
  height?: number;
  paddingY?: number;
  letterSpacing?: string;
  title?: string;
  style?: React.CSSProperties;
};

export function PrimaryCta({
  children,
  onClick,
  type = "button",
  disabled = false,
  loading = false,
  press = false,
  fontSize = 13,
  height,
  paddingY = 11,
  letterSpacing = "0.02em",
  title,
  style,
}: PrimaryCtaProps) {
  const off = disabled && !loading;
  const interactive = !disabled && !loading;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      style={{
        width: "100%",
        ...(height != null ? { height } : { paddingTop: paddingY, paddingBottom: paddingY }),
        borderRadius: 10,
        border: "none",
        background: off ? "var(--surface-2)" : "var(--brand)",
        color: off ? "var(--text-muted)" : "var(--brand-contrast)",
        fontSize,
        fontWeight: 700,
        letterSpacing,
        fontFamily: "inherit",
        cursor: loading ? "wait" : off ? "default" : "pointer",
        opacity: loading ? 0.7 : 1,
        transition: "background 120ms ease-out, transform 80ms ease-out",
        ...style,
      }}
      onMouseDown={press && interactive ? (e) => (e.currentTarget.style.transform = "scale(0.97)") : undefined}
      onMouseUp={press ? (e) => (e.currentTarget.style.transform = "scale(1)") : undefined}
      onMouseLeave={press ? (e) => (e.currentTarget.style.transform = "scale(1)") : undefined}
    >
      {children}
    </button>
  );
}
