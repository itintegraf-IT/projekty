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
  show, size, ts,
}: {
  show: boolean;
  size: "hero" | "queue";
  ts: MonitorTypeScale;
}) {
  if (!show) return null;
  return (
    <div
      style={{
        fontSize: size === "hero" ? ts.heroDriftNote : ts.queueDriftNote,
        color: "var(--text-muted)",
      }}
    >
      {MONITOR_DRIFT_NOTE_TEXT}
    </div>
  );
}
