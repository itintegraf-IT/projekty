import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import {
  expandPrintTime,
  snapStartToNextRunnableSlot,
  SLOT_MS,
  type CompanyDayInterval,
} from "@/lib/printTime";

/** Interval existujícího bloku na JEDNOM stroji (volající filtruje podle stroje). */
export type BlockInterval = {
  id: number;
  startTime: Date;
  endTime: Date;
  locked: boolean;
  /** Tiskové minuty; null → fallback elapsed end−start (defenzivní — backfill je vyplnil). */
  printMinutes: number | null;
  /** Blok vědomě mimo kalendář → při posunu se NEre-expanduje (end = start + pm souvisle). */
  scheduleBypassed: boolean;
};

/** Navržený posun jednoho bloku. */
export type ChainMove = { id: number; startTime: Date; endTime: Date };

export type ChainPushResult =
  | { ok: true; moves: ChainMove[] }
  | { ok: false; reason: "LOCKED_CONFLICT"; lockedId: number }
  | { ok: false; reason: "PLACEMENT_FAILED"; blockId: number };

/**
 * Chain push: anchor blok je fixní na své pozici, navazující kolidující bloky se
 * odsunou dopředu. Odsunutý blok se umísťuje přes start-only snap + expandPrintTime
 * podle VLASTNÍHO printMinutes a scheduleBypassed — blok smí pauznout přes odstávku
 * a jeho nový end vždy sedí na kalendář (žádný teleport za souvislým oknem).
 *
 * - `others` jsou ZAKAZKA bloky TÉHOŽ stroje (volající zajistí filtr).
 * - Zamčené bloky se NIKDY neposouvají; kandidátní pozice je přeskakují.
 * - Anchor kolidující se zamčeným blokem nelze vyřešit → LOCKED_CONFLICT
 *   (spec: „zamčený blok → drop se odmítne s hláškou, žádné tiché přeskládání").
 * - printMinutes <= 0 (korupce dat) → PLACEMENT_FAILED, nikdy raw throw.
 *
 * Pure funkce — žádné DB volání. Posuny jsou monotónně dopředné → konverguje.
 */
export function computeChainPush(
  machine: string,
  anchor: { id: number; startTime: Date; endTime: Date },
  others: BlockInterval[],
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[]
): ChainPushResult {
  const sorted = others
    .filter((b) => b.id !== anchor.id)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const locked = sorted.filter((b) => b.locked);
  const anchorStart = anchor.startTime.getTime();

  const anchorHit = locked.find(
    (l) => l.startTime.getTime() < anchor.endTime.getTime() && l.endTime.getTime() > anchorStart
  );
  if (anchorHit) return { ok: false, reason: "LOCKED_CONFLICT", lockedId: anchorHit.id };

  const moves: ChainMove[] = [];
  const placed = new Set<number>();
  let pEnd = anchor.endTime.getTime();

  for (let i = 0; i < 500; i++) {
    const next = sorted.find(
      (b) => !placed.has(b.id) && b.startTime.getTime() < pEnd && b.endTime.getTime() > anchorStart
    );
    if (!next) break;
    placed.add(next.id);

    if (next.locked) {
      // Zamčený blok nelze posunout — posuň kurzor za jeho konec.
      pEnd = Math.max(pEnd, next.endTime.getTime());
      continue;
    }

    const pm =
      next.printMinutes ?? Math.round((next.endTime.getTime() - next.startTime.getTime()) / 60000);
    if (!Number.isFinite(pm) || pm <= 0) {
      return { ok: false, reason: "PLACEMENT_FAILED", blockId: next.id };
    }

    const pos = placeAfter(machine, pEnd, pm, next.scheduleBypassed, locked, weekShifts, companyDays);
    if (!pos) return { ok: false, reason: "PLACEMENT_FAILED", blockId: next.id };

    moves.push({ id: next.id, startTime: pos.start, endTime: pos.end });
    pEnd = pos.end.getTime();
  }

  return { ok: true, moves };
}

/**
 * Najde první pozici od `fromMs`, kde re-expandovaný blok nekoliduje se zamčenými
 * bloky (a u bypass bloků ani s firemní odstávkou — tvrdý zákaz z validace).
 */
function placeAfter(
  machine: string,
  fromMs: number,
  printMinutes: number,
  bypassed: boolean,
  locked: BlockInterval[],
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[]
): { start: Date; end: Date } | null {
  let cursorMs = Math.ceil(fromMs / SLOT_MS) * SLOT_MS;

  for (let g = 0; g < 100; g++) {
    if (bypassed) {
      const start = new Date(cursorMs);
      const endMs = cursorMs + printMinutes * 60000;
      const cdHit = companyDays.find((cd) => cd.start.getTime() < endMs && cd.end.getTime() > cursorMs);
      if (cdHit) {
        cursorMs = Math.ceil(cdHit.end.getTime() / SLOT_MS) * SLOT_MS;
        continue;
      }
      const lockHit = locked.find((l) => l.startTime.getTime() < endMs && l.endTime.getTime() > cursorMs);
      if (lockHit) {
        cursorMs = Math.ceil(lockHit.endTime.getTime() / SLOT_MS) * SLOT_MS;
        continue;
      }
      return { start, end: new Date(endMs) };
    }

    const snapped = snapStartToNextRunnableSlot(machine, new Date(cursorMs), weekShifts, companyDays);
    if (!snapped) return null;
    const exp = expandPrintTime(machine, snapped, printMinutes, weekShifts, companyDays, false);
    if (!exp.ok) return null;
    const lockHit = locked.find(
      (l) => l.startTime.getTime() < exp.end.getTime() && l.endTime.getTime() > snapped.getTime()
    );
    if (!lockHit) return { start: snapped, end: exp.end };
    cursorMs = Math.ceil(lockHit.endTime.getTime() / SLOT_MS) * SLOT_MS;
  }
  return null;
}
