"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTheme = mounted ? (resolvedTheme ?? "dark") : "dark";
  const isDark = currentTheme === "dark";
  const nextTheme = isDark ? "light" : "dark";
  const label = mounted ? (isDark ? "Přepnout na Light" : "Přepnout na Dark") : "Přepnout téma";
  const actionLabel = mounted
    ? `Aktuálně ${currentTheme}. Klik pro přepnutí na ${nextTheme}.`
    : "Přepínač vzhledu";

  return (
    <button
      type="button"
      aria-label={actionLabel}
      title={actionLabel}
      onClick={() => mounted && setTheme(nextTheme)}
      style={{
        width: 64,
        height: 30,
        borderRadius: 999,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        cursor: mounted ? "pointer" : "default",
        opacity: mounted ? 1 : 0.7,
        transition: "all 180ms ease-out",
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 8px",
      }}
    >
      <span style={{ opacity: isDark ? 0.35 : 1, transition: "opacity 180ms ease-out", display: "flex" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4"/>
          <line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
          <line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
          <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
          <line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/>
        </svg>
      </span>
      <span style={{ opacity: isDark ? 1 : 0.35, transition: "opacity 180ms ease-out", display: "flex" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      </span>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 2,
          left: isDark ? 34 : 2,
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "var(--background)",
          border: "1px solid var(--border)",
          boxShadow: "0 2px 8px color-mix(in oklab, var(--text) 18%, transparent)",
          transition: "left 180ms ease-out",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
        }}
      >
        {isDark ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4"/>
            <line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
            <line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
            <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
            <line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/>
          </svg>
        )}
      </span>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>
        {label}
      </span>
    </button>
  );
}
