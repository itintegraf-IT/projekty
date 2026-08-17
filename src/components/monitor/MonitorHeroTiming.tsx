"use client";

import type { Block } from "@/app/_components/TimelineGrid";
import { runProgress, startDayLabel } from "@/lib/monitorView";
import { formatPragueTime } from "@/lib/dateUtils";
import type { MonitorTypeScale } from "@/lib/monitorTypography";

/**
 * Časová osa běhu zakázky na velké kartě Monitoru, nebo odpočet do startu
 * u zakázky, která teprve začne.
 *
 * Vytaženo z `MonitorView.tsx` (17. 8. 2026), když soubor napojením na stupně
 * písma přerostl `max-lines`. Je to uzavřený kus: dostane blok, důvod, čas
 * a škálu, nic si nedrží a nic nemutuje.
 */
export function MonitorHeroTiming({ block, reason, now, ts }: {
  block: Block;
  reason: "running" | "overdue" | "upcoming";
  now: Date;
  ts: MonitorTypeScale;
}) {
  const { percent, remainingMinutes } = runProgress(block, now);

  if (reason === "upcoming") {
    const minutesToStart = Math.ceil((new Date(block.startTime).getTime() - now.getTime()) / 60000);
    const day = startDayLabel(block.startTime, now);
    return (
      <div style={{ fontSize: ts.heroTiming, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        Začíná {day ? `${day} v` : "v"} {formatPragueTime(new Date(block.startTime))}
        <span style={{ color: "var(--text-muted)" }}> · za {formatMinutes(minutesToStart)}</span>
      </div>
    );
  }

  // Datum se ukáže jen tehdy, když zakázka nezačala dnes (`startDayLabel`
  // vrací pro dnešek `null`). U běžné směny tedy nepřibude nic; u zakázky
  // vytažené ze sekce NEDODĚLÁNO nebo z hledání je to jediné místo, kde se
  // tiskař dozví, že kouká na jiný den.
  const dayLabel = startDayLabel(block.startTime, now);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {dayLabel && (
        // `--warning` v Monitoru všude jinde znamená „PŘETAHUJE" — u prostě
        // běžícího bloku (typicky noční směna po půlnoci, startDayLabel vrátí
        // včerejšek) by žlutý datum-štítek nad ZELENÝM pruhem lhal o stavu.
        <div style={{ fontSize: ts.heroTimingLabel, fontWeight: 700, color: reason === "overdue" ? "var(--warning)" : "var(--text-muted)" }}>
          {dayLabel}
        </div>
      )}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        fontSize: ts.heroTimingRow, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums",
      }}>
        <span>{formatPragueTime(new Date(block.startTime))}</span>
        <span style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--surface-3)", overflow: "hidden" }}>
          <span style={{
            display: "block", height: "100%", width: `${percent}%`,
            background: reason === "overdue" ? "var(--warning)" : "var(--success)",
          }} />
        </span>
        <span>{formatPragueTime(new Date(block.endTime))}</span>
      </div>
      <div style={{ fontSize: ts.heroTimingLabel, fontWeight: 600, color: "var(--text)" }}>
        {remainingMinutes >= 0
          ? `Zbývá ${formatMinutes(remainingMinutes)}`
          : `Přetahuje o ${formatMinutes(-remainingMinutes)}`}
      </div>
    </div>
  );
}

/** 95 → „1 h 35 min", 40 → „40 min". */
function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
