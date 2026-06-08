import { computeChainPush, type ChainMove, type BlockInterval } from "@/lib/overlapResolver";
import { serializeWeekShifts } from "@/lib/scheduleValidation";
import { weekStartStrFromDateStr } from "@/lib/machineWeekShifts";
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { pragueOf } from "@/lib/dateUtils";
import { AppError } from "@/lib/errors";

type PrismaTransactionClient = Parameters<Parameters<typeof import("@/lib/prisma").prisma.$transaction>[0]>[0];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Provedený posun bloku — `ChainMove` + původní časy a číslo zakázky (pro audit). */
export type AppliedMove = ChainMove & {
  orderNumber: string | null;
  oldStartTime: Date;
  oldEndTime: Date;
};

/**
 * Serverový chain push proti živé DB. Anchor blok je už zapsán na své cílové pozici;
 * tato funkce načte ostatní ZAKAZKA bloky stroje v okolním okně, spočítá posuny přes
 * `computeChainPush` a zapíše je v rámci PŘEDANÉ transakce `tx`.
 *
 * Po výpočtu posunů ověří, že žádný posunutý blok nespadl do firemní odstávky
 * (companyDays) — snap (`snapToNextValidStartWithTemplates`) řeší jen pracovní dobu,
 * NE odstávky. Při kolizi s odstávkou hodí SCHEDULE_VIOLATION → rollback transakce.
 *
 * Volat UVNITŘ `$transaction`, po `tx.block.update` anchoru a PŘED finální pojistkou
 * `assertNoOverlapForBlocks`. Vrací provedené posuny (pro audit + odpověď klientovi).
 */
export async function resolveChainPushFromDb(
  tx: PrismaTransactionClient,
  machine: string,
  anchor: { id: number; startTime: Date; endTime: Date },
  respectWorkingHours: boolean,
  excludeIds: ReadonlySet<number> = new Set()
): Promise<AppliedMove[]> {
  // Okno: den před anchorem až 30 dní za jeho koncem (chain push posouvá jen dopředu).
  const windowStart = new Date(anchor.startTime.getTime() - DAY_MS);
  const windowEnd = new Date(anchor.endTime.getTime() + 30 * DAY_MS);

  const rows = await tx.block.findMany({
    where: {
      machine,
      // anchor + sourozenci ve stejné dávce (lasso) se neposouvají
      id: { notIn: [anchor.id, ...excludeIds] },
      type: "ZAKAZKA",
      startTime: { lt: windowEnd },
      endTime: { gt: windowStart },
    },
    select: { id: true, orderNumber: true, startTime: true, endTime: true, locked: true },
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
  if (moves.length === 0) return [];

  // Firemní odstávky (companyDays) — snap je neřeší, takže ověř, že posunutý blok
  // nepřistál na odstávce. Platí vždy (i bez respectWorkingHours).
  const minStart = new Date(Math.min(...moves.map((m) => m.startTime.getTime())));
  const maxEnd = new Date(Math.max(...moves.map((m) => m.endTime.getTime())));
  const companyDays = await tx.companyDay.findMany({
    where: {
      startDate: { lt: maxEnd },
      endDate: { gt: minStart },
      OR: [{ machine: null }, { machine }],
    },
    select: { startDate: true, endDate: true },
  });
  for (const m of moves) {
    const hit = companyDays.find((cd) => cd.startDate < m.endTime && cd.endDate > m.startTime);
    if (hit) {
      throw new AppError(
        "SCHEDULE_VIOLATION",
        "Auto-posun navazujícího bloku by zasáhl do plánované odstávky — uvolni místo ručně."
      );
    }
  }

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const applied: AppliedMove[] = [];
  for (const m of moves) {
    await tx.block.update({
      where: { id: m.id },
      data: { startTime: m.startTime, endTime: m.endTime },
    });
    const r = rowById.get(m.id)!;
    applied.push({
      ...m,
      orderNumber: r.orderNumber,
      oldStartTime: r.startTime,
      oldEndTime: r.endTime,
    });
  }
  return applied;
}
