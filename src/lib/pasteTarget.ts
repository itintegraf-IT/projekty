import type { Block } from "@/app/_components/TimelineGrid";
import { SLOT_MS } from "@/lib/timeSlots";

/**
 * Vypočte výchozí pasteTarget z bloku: stejný stroj, čas zarovnaný na slot
 * za koncem zdrojového bloku. Používá se pro auto-set po Ctrl+C/X, aby
 * Ctrl+V mohlo fungovat bez nutnosti klikat do prázdného gridu.
 *
 * Zarovnání na 30-min slot zajišťuje konzistenci se `snapToSlot` v gridu.
 */
export function computePasteTargetFromBlock(block: Block): { machine: string; time: Date } {
  const endMs = new Date(block.endTime).getTime();
  const snapped = Math.ceil(endMs / SLOT_MS) * SLOT_MS;
  return { machine: block.machine, time: new Date(snapped) };
}

/**
 * Vypočte výchozí pasteTarget z group bloků: stroj = stroj prvního (anchor) bloku,
 * čas = konec posledního (nejlatěji končícího) bloku.
 */
export function computePasteTargetFromGroup(blocks: Block[]): { machine: string; time: Date } | null {
  if (blocks.length === 0) return null;
  const anchorBlock = blocks.reduce((earliest, b) =>
    new Date(b.startTime).getTime() < new Date(earliest.startTime).getTime() ? b : earliest
  );
  const lastEndMs = Math.max(...blocks.map((b) => new Date(b.endTime).getTime()));
  const snapped = Math.ceil(lastEndMs / SLOT_MS) * SLOT_MS;
  return { machine: anchorBlock.machine, time: new Date(snapped) };
}
