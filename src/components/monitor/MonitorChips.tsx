"use client";

import type { Block } from "@/app/_components/TimelineGrid";
import { buildMonitorChips, type MonitorChipTone } from "@/lib/monitorChips";

/**
 * Výrobní a stavové štítky zakázky na Monitoru. Velká karta i řádek fronty kreslí
 * tutéž sadu ze stejné funkce — `size` mění POUZE rozměry, nikdy obsah ani pořadí.
 */
export function MonitorChips({ block, size }: { block: Block; size: "hero" | "queue" }) {
  const chips = buildMonitorChips(block);
  if (chips.length === 0) return null;

  const hero = size === "hero";

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: hero ? 6 : 5 }}>
      {chips.map((c, i) => (
        <span
          key={`${c.label}-${i}`}
          style={{
            fontSize: hero ? 12 : 11,
            fontWeight: 600,
            letterSpacing: "0.02em",
            borderRadius: hero ? 6 : 5,
            padding: hero ? "5px 10px" : "3px 7px",
            whiteSpace: "nowrap",
            background: toneBackground(c.tone),
            color: toneColor(c.tone),
          }}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

function toneBackground(tone: MonitorChipTone): string {
  switch (tone) {
    case "ok":     return "color-mix(in oklab, var(--success) 22%, transparent)";
    case "wait":   return "color-mix(in oklab, var(--warning) 22%, transparent)";
    case "brand":  return "var(--brand)";
    case "danger": return "var(--danger)";
    default:       return "var(--surface-3)";
  }
}

function toneColor(tone: MonitorChipTone): string {
  switch (tone) {
    case "ok":     return "var(--success)";
    case "wait":   return "var(--warning)";
    case "brand":  return "var(--brand-contrast)";
    // Bílá je tu záměrný literál, ne token: --danger je sytá červená stejná v obou
    // motivech, takže --text by na ní ve světlém režimu zmizel.
    case "danger": return "white";
    default:       return "var(--text)";
  }
}
