"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";
  const label = mounted ? (isDark ? "☀ Light" : "🌙 Dark") : "🌓 Theme";
  const actionLabel = mounted
    ? `Přepnout na ${isDark ? "světlý" : "tmavý"} režim`
    : "Přepínač vzhledu";

  return (
    <button
      type="button"
      disabled={!mounted}
      aria-label={actionLabel}
      title={actionLabel}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      style={{
        padding: "3px 10px",
        fontSize: 11,
        borderRadius: 6,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        color: "var(--text-muted)",
        cursor: mounted ? "pointer" : "default",
        opacity: mounted ? 1 : 0.7,
        transition: "all 120ms ease-out",
      }}
    >
      {label}
    </button>
  );
}
