import { snapToNextValidStartWithTemplates } from "@/lib/workingTime";
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";

/** Interval existujícího bloku na JEDNOM stroji (volající filtruje podle stroje). */
export type BlockInterval = { id: number; startTime: Date; endTime: Date; locked: boolean };

/** Navržený posun jednoho bloku. */
export type ChainMove = { id: number; startTime: Date; endTime: Date };

/**
 * Chain push: anchor blok je fixní na své pozici, navazující kolidující bloky se
 * odsunou dopředu tak, aby nikdo nekolidoval s anchorem ani mezi sebou.
 *
 * - `others` jsou bloky TÉHOŽ stroje jako anchor (volající zajistí filtr).
 * - Zamčené bloky (`locked`) se NIKDY neposouvají — kurzor je přeskočí a navazující
 *   nezamčené bloky se umístí až za ně.
 * - `respectWorkingHours` zapne snap na pracovní dobu přes `snapToNextValidStartWithTemplates`.
 *
 * Pure funkce — žádné DB volání. Server (přes `resolveChainPushFromDb`) i případně
 * klient volají stejnou logiku. Pokud anchor sám koliduje se zamčeným blokem, který
 * nelze posunout, zůstane překryv nevyřešený — finální serverová pojistka
 * (`assertNoOverlapForBlocks`) ho zachytí a transakci odmítne.
 */
export function computeChainPush(
  machine: string,
  anchor: { id: number; startTime: Date; endTime: Date },
  others: BlockInterval[],
  weekShifts: MachineWeekShiftsRow[],
  respectWorkingHours: boolean,
): ChainMove[] {
  const moves: ChainMove[] = [];
  const sorted = others
    .filter((b) => b.id !== anchor.id)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const locked = sorted.filter((b) => b.locked);
  const placed = new Set<number>();
  const anchorStart = anchor.startTime.getTime();
  let pEnd = anchor.endTime.getTime();

  for (let i = 0; i < 500; i++) {
    const next = sorted.find(
      (b) =>
        !placed.has(b.id) &&
        b.startTime.getTime() < pEnd &&
        b.endTime.getTime() > anchorStart,
    );
    if (!next) break;
    placed.add(next.id);

    if (next.locked) {
      // Zamčený blok nelze posunout — posuň kurzor za jeho konec.
      pEnd = Math.max(pEnd, next.endTime.getTime());
      continue;
    }

    const dur = next.endTime.getTime() - next.startTime.getTime();
    let ns = new Date(pEnd);
    if (respectWorkingHours) ns = snapToNextValidStartWithTemplates(machine, ns, dur, weekShifts);
    let nsMs = ns.getTime();

    // Cílové okno nesmí kolidovat se zamčeným blokem — pokud ano, přeskoč za něj.
    for (let g = 0; g < 100; g++) {
      const hit = locked.find(
        (l) => l.startTime.getTime() < nsMs + dur && l.endTime.getTime() > nsMs,
      );
      if (!hit) break;
      let after = new Date(hit.endTime.getTime());
      if (respectWorkingHours) after = snapToNextValidStartWithTemplates(machine, after, dur, weekShifts);
      nsMs = after.getTime();
    }

    moves.push({ id: next.id, startTime: new Date(nsMs), endTime: new Date(nsMs + dur) });
    pEnd = nsMs + dur;
  }

  return moves;
}
