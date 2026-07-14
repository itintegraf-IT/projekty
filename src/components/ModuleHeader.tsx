import React from "react";

/**
 * ModuleHeader — sdílená horní lišta modulů Expedice a Reporty (audit #60/#102).
 *
 * Sjednocuje dřív zkopírovaný „chrome": lišta (výška, `--surface`, spodní border) → zpětný
 * odkaz na planner → oddělovač → název modulu → pružná mezera → modulové nástroje (`children`).
 *
 * Záměrně NEmodeluje user-menu vzor z RezervacePage (badge + ThemeToggle + Odhlásit) — Expedice
 * i Reporty mají místo toho funkční toolbar a žádné user ovládání. RezervacePage zůstává na svém
 * odlišném vzoru.
 */
export type ModuleHeaderProps = {
  title: string;
  backHref?: string;
  backLabel?: string;
  titleSize?: number;
  height?: number;
  gap?: number;
  children?: React.ReactNode;
};

export function ModuleHeader({
  title,
  backHref = "/",
  backLabel = "← Zpět na planner",
  titleSize = 14,
  height = 48,
  gap = 12,
  children,
}: ModuleHeaderProps) {
  return (
    <div
      style={{
        height,
        flexShrink: 0,
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap,
        padding: "0 16px",
      }}
    >
      <a
        href={backHref}
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: 4,
          whiteSpace: "nowrap",
          transition: "color 120ms ease-out",
        }}
      >
        {backLabel}
      </a>
      <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0 }} />
      <span style={{ fontSize: titleSize, fontWeight: 600, color: "var(--text)", flexShrink: 0 }}>
        {title}
      </span>
      <div style={{ flex: 1 }} />
      {children}
    </div>
  );
}
