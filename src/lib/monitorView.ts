import type { Block } from "@/app/_components/TimelineGrid";
import { utcToPragueDateStr } from "@/lib/dateUtils";

/**
 * Pravidla pro tiskařský Monitor — která zakázka patří na velkou kartu,
 * co je ve frontě dneška a jak daleko je běh.
 *
 * Záměrně čistá logika bez Reactu, aby šla pokrýt unit testy; MonitorView
 * na ní jen staví a sám nic nepočítá.
 */

export type HeroReason = "running" | "overdue" | "upcoming";
export type HeroPick = { block: Block; reason: HeroReason } | null;

/** Otevřená zakázka na daném stroji = ZAKAZKA + správný stroj + neodklepnutá. */
function isOpenOrder(b: Block, machine: string): boolean {
  return b.type === "ZAKAZKA" && b.machine === machine && b.printCompletedAt == null;
}

function byStartAsc(a: Block, b: Block): number {
  return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
}

/**
 * Zakázka na velkou kartu Monitoru, s důvodem výběru. Priorita:
 *  1. `running`  — je uvnitř svého času,
 *  2. `overdue`  — nic neběží, ale dnešní zakázce už vypršel čas a nikdo ji
 *                  neodklepl (bez tohohle by z Monitoru zmizela a tiskař by ji
 *                  musel hledat v plánu),
 *  3. `upcoming` — jinak nejbližší budoucí.
 */
export function pickHeroBlock(blocks: Block[], machine: string, now: Date): HeroPick {
  const t = now.getTime();
  const open = blocks.filter((b) => isOpenOrder(b, machine));

  const running = open
    .filter((b) => new Date(b.startTime).getTime() <= t && t < new Date(b.endTime).getTime())
    .sort(byStartAsc);
  if (running.length > 0) return { block: running[0], reason: "running" };

  const today = utcToPragueDateStr(now);
  const overdue = open
    .filter(
      (b) =>
        new Date(b.endTime).getTime() <= t &&
        utcToPragueDateStr(new Date(b.startTime)) === today
    )
    .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());
  if (overdue.length > 0) return { block: overdue[0], reason: "overdue" };

  const next = pickNextBlock(blocks, machine, now);
  return next ? { block: next, reason: "upcoming" } : null;
}

/** Nejbližší budoucí neodklepnutá zakázka na stroji (klidně i zítřejší). */
export function pickNextBlock(blocks: Block[], machine: string, now: Date): Block | null {
  const t = now.getTime();
  const upcoming = blocks
    .filter((b) => isOpenOrder(b, machine) && new Date(b.startTime).getTime() > t)
    .sort(byStartAsc);
  return upcoming[0] ?? null;
}

/**
 * Zakázky na stroji, jejichž start padá do civilního pražského dne `now`.
 * Odklepnuté zůstávají — fronta je ukazuje ztlumené, aby byl vidět postup směny.
 */
export function todayQueue(blocks: Block[], machine: string, now: Date): Block[] {
  const today = utcToPragueDateStr(now);
  return blocks
    .filter(
      (b) =>
        b.type === "ZAKAZKA" &&
        b.machine === machine &&
        utcToPragueDateStr(new Date(b.startTime)) === today
    )
    .sort(byStartAsc);
}

/**
 * Postup běhu. `percent` je ořezaný na 0–100; `remainingMinutes` může být
 * záporné, pokud blok přetahuje — UI to zobrazí jako „přetahuje o X min".
 */
export function runProgress(block: Block, now: Date): { percent: number; remainingMinutes: number } {
  const start = new Date(block.startTime).getTime();
  const end = new Date(block.endTime).getTime();
  const t = now.getTime();
  const span = end - start;
  const percent = span <= 0 ? 100 : Math.max(0, Math.min(100, ((t - start) / span) * 100));
  return { percent, remainingMinutes: Math.ceil((end - t) / 60000) };
}
