"use client";

import type { Block } from "@/app/_components/TimelineGrid";
import { formatPragueTime, formatPragueDateTimeWithWeekday } from "@/lib/dateUtils";
import { MonitorChips } from "@/components/monitor/MonitorChips";
import { SPEC_HIGHLIGHT } from "@/lib/blockStyles";

type Props = {
  overdue: Block[];
  today: Block[];
  tomorrow: Block[];
  heroId: number | null;
  onSelect: (block: Block) => void;
};

/**
 * Pravý sloupec Monitoru — zakázky na stroji pro dnešek a zítřek.
 * Každý řádek nese totéž, co velká karta: číslo, popis, čas, amber pás se
 * specifikací a výrobní i stavové chipy. Odklepnuté jsou ztlumené se zeleným
 * háčkem (včetně pásu), zakázka na velké kartě zvýrazněná.
 * Kliknutí ji vytáhne na velkou kartu (tiskař tím přebíjí pořadí od plánovače).
 */
export function MonitorQueue({ overdue, today, tomorrow, heroId, onSelect }: Props) {
  if (overdue.length === 0 && today.length === 0 && tomorrow.length === 0) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: 14, padding: "12px 4px" }}>
        Na tomhle stroji není dnes ani zítra nic naplánováno.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", minHeight: 0 }}>
      {/* NEDODĚLÁNO jde NAHORU: fronta se pak čte chronologicky shora dolů. */}
      <QueueSection title="Nedoděláno" blocks={overdue} heroId={heroId} onSelect={onSelect} tone="warning" showDate />
      <QueueSection title="Dnes" blocks={today} heroId={heroId} onSelect={onSelect} />
      <QueueSection title="Zítra" blocks={tomorrow} heroId={heroId} onSelect={onSelect} />
    </div>
  );
}

function QueueSection({
  title, blocks, heroId, onSelect, tone = "muted", showDate = false,
}: {
  title: string;
  blocks: Block[];
  heroId: number | null;
  onSelect: (block: Block) => void;
  /** `warning` odliší nedodělané od běžné fronty — jediný barevný rozdíl. */
  tone?: "muted" | "warning";
  /** Řádek ukáže i den, ne jen čas. Povinné u zakázek z minulých dnů. */
  showDate?: boolean;
}) {
  if (blocks.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
      <div style={{
        fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase",
        color: tone === "warning" ? "var(--warning)" : "var(--text-muted)", fontWeight: 700,
      }}>
        {title}
      </div>
      {blocks.map((b) => {
        const isDone = b.printCompletedAt != null;
        const isHero = b.id === heroId;
        return (
          <button
            key={b.id}
            onClick={(e) => { if (e.button !== 0) return; onSelect(b); }}
            style={{
              display: "flex", flexDirection: "column", alignItems: "stretch", gap: 7,
              padding: "10px 12px",
              borderRadius: 10,
              textAlign: "left",
              font: "inherit",
              cursor: "pointer",
              background: isHero ? "color-mix(in oklab, var(--success) 12%, var(--surface))" : "var(--surface)",
              border: `1px solid ${isHero ? "var(--success)" : "var(--border)"}`,
              color: "var(--text)",
              // Ztlumení se vztahuje i na amber pás. Hotová zakázka nemá u stroje
              // křičet — jinak by přebila tu, která se právě tiskne.
              opacity: isDone ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{
                fontFamily: "ui-monospace, monospace",
                fontWeight: 700, fontVariantNumeric: "tabular-nums",
                fontSize: 14, flexShrink: 0,
                color: isDone ? "var(--success)" : "var(--text)",
              }}>
                {isDone ? "✓ " : ""}{b.orderNumber}
              </span>
              <span style={{
                flex: 1, minWidth: 0,
                color: "var(--text-muted)", fontSize: 13,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {b.description ?? ""}
              </span>
              {/* U nedodělaných musí být vidět DEN, jinak řádek vypadá jako dnešní
                  zakázka. Den v týdnu tam patří — tiskař myslí ve směnách, ne
                  v datech. `formatPragueDateTimeWithWeekday` dá „pá 9. 8. 22:00". */}
              <span style={{
                flexShrink: 0,
                color: "var(--text-muted)", fontSize: 13,
                fontVariantNumeric: "tabular-nums",
              }}>
                {showDate
                  ? formatPragueDateTimeWithWeekday(new Date(b.startTime))
                  : formatPragueTime(new Date(b.startTime))}
              </span>
            </span>

            {b.specifikace?.trim() && (
              // Amber pás jako na kartě bloku v plánu i na velké kartě Monitoru.
              // Barvy jsou záměrně stejné literály (SPEC_HIGHLIGHT), aby stejná
              // informace vypadala všude stejně; pás si nese vlastní pozadí, takže
              // funguje ve světlém i tmavém motivu.
              <span
                title={b.specifikace}
                style={{
                  background: SPEC_HIGHLIGHT.bg,
                  color: SPEC_HIGHLIGHT.text,
                  borderRadius: 5,
                  padding: "4px 8px",
                  fontSize: 13, fontWeight: 700, lineHeight: 1.3,
                  letterSpacing: "0.01em",
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {b.specifikace}
              </span>
            )}

            <MonitorChips block={b} size="queue" />
          </button>
        );
      })}
    </div>
  );
}
