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
      <span style={{ fontSize: 12, opacity: isDark ? 0.35 : 1, transition: "opacity 180ms ease-out" }}>☀️</span>
      <span style={{ fontSize: 12, opacity: isDark ? 1 : 0.35, transition: "opacity 180ms ease-out" }}>🌙</span>
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
        {isDark ? "🌙" : "☀️"}
      </span>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>
        {label}
      </span>
    </button>
  );
}
