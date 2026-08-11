"use client";

import { PLANNER_FONT_SCALE_KEYS, type PlannerFontScale } from "@/lib/plannerTypography";

const LABELS: Record<PlannerFontScale, string> = {
  M: "Střední písmo — dnešní rozhled po plánu",
  L: "Velké písmo",
  XL: "Největší písmo — pro projekci na tabuli",
};

/**
 * Přepínač velikosti písma v plánu. Sedí v hlavičce hned za ZoomSlider:
 * zoom říká, kolik toho vidím, tenhle jak je to velké.
 *
 * Nastavení je vázané na ZAŘÍZENÍ (localStorage), ne na uživatele — velikost
 * písma je vlastnost obrazovky. Počítač u tabule se nastaví jednou na XL
 * a zůstane tak bez ohledu na to, kdo se přihlásí.
 */
export function FontScaleSwitch({
  value,
  onChange,
}: {
  value: PlannerFontScale;
  onChange: (next: PlannerFontScale) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Velikost písma v plánu"
      style={{
        display: "flex",
        gap: 2,
        padding: 2,
        borderRadius: 999,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        boxShadow: "inset 0 1px 0 color-mix(in oklab, var(--text) 8%, transparent)",
      }}
    >
      {PLANNER_FONT_SCALE_KEYS.map((key) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            title={LABELS[key]}
            onClick={() => onChange(key)}
            style={{
              minWidth: 32,
              height: 24,
              padding: "0 8px",
              fontSize: 11,
              fontWeight: active ? 700 : 600,
              borderRadius: 999,
              background: active ? "var(--brand)" : "transparent",
              border: active
                ? "1px solid color-mix(in oklab, var(--brand) 75%, var(--text))"
                : "1px solid transparent",
              color: active ? "var(--brand-contrast)" : "var(--text-muted)",
              cursor: "pointer",
              lineHeight: 1,
              transition: "all 140ms ease-out",
              boxShadow: active ? "0 2px 8px color-mix(in oklab, var(--text) 20%, transparent)" : "none",
            }}
          >
            {key}
          </button>
        );
      })}
    </div>
  );
}
