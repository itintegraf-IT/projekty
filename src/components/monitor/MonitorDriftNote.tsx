"use client";

import type { MonitorTypeScale } from "@/lib/monitorTypography";
import { MONITOR_DRIFT_NOTE_TEXT } from "@/lib/monitorDriftMark";

/**
 * Značka „⚠ nesedí na kalendář" — velká karta i řádek fronty ji kreslí ze stejného
 * místa (obdoba `MonitorChips`), ať se text a velikosti časem nerozejdou mezi
 * dvěma nezávislými kopiemi. `size` mění jen rozměr, nikdy text.
 *
 * Nekreslí nic, pokud `show` je false — volající si drift počítá sám (`shouldMarkDrift`)
 * podle vlastního bloku, komponenta jen sjednocuje vykreslení.
 */
export function MonitorDriftNote({
  show, size, ts, compact = false,
}: {
  show: boolean;
  size: "hero" | "queue";
  ts: MonitorTypeScale;
  /** Řádek fronty NEDODĚLÁNO má nulovou mezeru mezi prvky (`gap: 0`) — bez
   *  vlastní odsazení by značka lepila přímo na hlavičku řádku. */
  compact?: boolean;
}) {
  if (!show) return null;
  return (
    <div
      style={{
        fontSize: size === "hero" ? ts.heroDriftNote : ts.queueDriftNote,
        color: "var(--text-muted)",
        marginTop: compact ? 3 : 0,
      }}
    >
      {MONITOR_DRIFT_NOTE_TEXT}
    </div>
  );
}
