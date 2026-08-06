export type BatchAuditPosition = {
  machine: string;
  startTime: Date;
  endTime: Date;
};

export type BatchAuditInput = {
  blockId: number;
  orderNumber: string | null;
  old: BatchAuditPosition;
  next: BatchAuditPosition;
};

export type BatchAuditRow = {
  blockId: number;
  orderNumber: string | null;
  field: string;
  oldValue: string;
  newValue: string;
};

/** Rozsah `start–end` v ISO. En-dash U+2013 — `fmtAuditVal` podle něj pozná span. */
function span(p: BatchAuditPosition): string {
  return `${p.startTime.toISOString()}–${p.endTime.toISOString()}`;
}

/**
 * Audit řádky pro jeden blok z dávkového přesunu (POST /api/blocks/batch).
 *
 * Dřív se psal jediný řádek `startTime/endTime/machine` s prázdným `oldValue`, a to
 * pro KAŽDÝ blok v dávce — i nepohnutý. Důsledky se ukázaly při havárii 5. 8. 2026:
 * ruční přesun nešlo vrátit z auditu (chyběla stará hodnota) a počet řádků neodpovídal
 * počtu skutečných přesunů. Navíc se hodnota s prefixem stroje nevešla do ISO guardu
 * v `fmtAuditVal`, takže se v historii bloku zobrazovala syrová.
 *
 * Proto: poziční změna a změna stroje jako dva samostatné řádky (parita s PUT route),
 * časy jako čistý ISO rozsah, a beze změny žádný řádek.
 */
export function buildBatchAuditRows({ blockId, orderNumber, old, next }: BatchAuditInput): BatchAuditRow[] {
  const rows: BatchAuditRow[] = [];
  const base = { blockId, orderNumber };

  if (old.startTime.getTime() !== next.startTime.getTime() || old.endTime.getTime() !== next.endTime.getTime()) {
    rows.push({ ...base, field: "startTime/endTime", oldValue: span(old), newValue: span(next) });
  }
  if (old.machine !== next.machine) {
    rows.push({ ...base, field: "machine", oldValue: old.machine, newValue: next.machine });
  }
  return rows;
}
