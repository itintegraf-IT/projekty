import { computeChainPush, type ChainMove, type BlockInterval } from "@/lib/overlapResolver";
import { serializeWeekShifts } from "@/lib/scheduleValidation";
import { weekStartStrFromDateStr } from "@/lib/machineWeekShifts";
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { pragueOf } from "@/lib/dateUtils";

type PrismaTransactionClient = Parameters<Parameters<typeof import("@/lib/prisma").prisma.$transaction>[0]>[0];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Serverový chain push proti živé DB. Anchor blok je už zapsán na své cílové pozici;
 * tato funkce načte ostatní ZAKAZKA bloky stroje v okolním okně, spočítá posuny přes
 * `computeChainPush` a zapíše je v rámci PŘEDANÉ transakce `tx`.
 *
 * Volat UVNITŘ `$transaction`, po `tx.block.update` anchoru a PŘED finální pojistkou
 * `assertNoOverlapForBlocks`. Vrací seznam provedených posunů (pro audit + odpověď klientovi).
 */
export async function resolveChainPushFromDb(
  tx: PrismaTransactionClient,
  machine: string,
  anchor: { id: number; startTime: Date; endTime: Date },
  respectWorkingHours: boolean
): Promise<ChainMove[]> {
  // Okno: den před anchorem až 30 dní za jeho koncem (chain push posouvá jen dopředu).
  const windowStart = new Date(anchor.startTime.getTime() - DAY_MS);
  const windowEnd = new Date(anchor.endTime.getTime() + 30 * DAY_MS);

  const rows = await tx.block.findMany({
    where: {
      machine,
      id: { not: anchor.id },
      type: "ZAKAZKA",
      startTime: { lt: windowEnd },
      endTime: { gt: windowStart },
    },
    select: { id: true, startTime: true, endTime: true, locked: true },
  });

  let weekShifts: MachineWeekShiftsRow[] = [];
  if (respectWorkingHours) {
    const weekStarts = new Set<string>();
    for (let t = windowStart.getTime(); t <= windowEnd.getTime(); t += DAY_MS) {
      weekStarts.add(weekStartStrFromDateStr(pragueOf(new Date(t)).dateStr));
    }
    weekStarts.add(weekStartStrFromDateStr(pragueOf(windowEnd).dateStr));
    const rawWeekShifts = await tx.machineWeekShifts.findMany({
      where: {
        machine,
        weekStart: { in: Array.from(weekStarts).map((s) => new Date(`${s}T00:00:00.000Z`)) },
      },
    });
    weekShifts = serializeWeekShifts(rawWeekShifts);
  }

  const others: BlockInterval[] = rows.map((r) => ({
    id: r.id,
    startTime: r.startTime,
    endTime: r.endTime,
    locked: r.locked,
  }));

  const moves = computeChainPush(machine, anchor, others, weekShifts, respectWorkingHours);

  for (const m of moves) {
    await tx.block.update({
      where: { id: m.id },
      data: { startTime: m.startTime, endTime: m.endTime },
    });
  }

  return moves;
}
