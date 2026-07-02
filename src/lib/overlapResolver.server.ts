import { computeChainPush, type ChainMove, type BlockInterval } from "@/lib/overlapResolver";
import { serializeWeekShifts } from "@/lib/scheduleValidation";
import { weekStartStrFromDateStr } from "@/lib/machineWeekShifts";
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { pragueOf } from "@/lib/dateUtils";
import { expandPrintTime, MAX_SPAN_DAYS, type CompanyDayInterval } from "@/lib/printTime";
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
 * `computeChainPush` (re-expanze per blok podle printMinutes + scheduleBypassed)
 * a zapíše je v rámci PŘEDANÉ transakce `tx`.
 *
 * Kalendář (weekShifts + companyDays) se načítá VŽDY — expanze odsunutých bloků na něm
 * stojí bez ohledu na bypass flag requestu (ten se týká jen anchoru a je vyřešen
 * ve validateAndComputeEnd před chain pushem).
 *
 * Chybové stavy (rollback transakce):
 * - anchor přes zamčený/vytištěný blok → AppError("OVERLAP") se jménem viníka,
 * - odsouvaný blok nejde umístit (horizont / korupce printMinutes) → AppError("SCHEDULE_VIOLATION").
 *
 * Volat UVNITŘ `$transaction`, po zápisu anchoru a PŘED finální pojistkou
 * `assertNoOverlapForBlocks`. Vrací provedené posuny (pro audit + odpověď klientovi).
 */
export async function resolveChainPushFromDb(
  tx: PrismaTransactionClient,
  machine: string,
  anchor: { id: number; startTime: Date; endTime: Date },
  excludeIds: ReadonlySet<number> = new Set()
): Promise<AppliedMove[]> {
  // Okno bloků: den před anchorem až 90 dní za jeho koncem (chain push posouvá jen dopředu).
  const windowStart = new Date(anchor.startTime.getTime() - DAY_MS);
  const windowEnd = new Date(anchor.endTime.getTime() + 90 * DAY_MS);
  // Okno kalendáře: + MAX_SPAN_DAYS rezerva — blok umístěný u konce okna bloků může
  // expandovat až 21 dní za něj (precondition expandPrintTime: kompletní weekShifts fetch).
  const calendarEnd = new Date(windowEnd.getTime() + MAX_SPAN_DAYS * DAY_MS);

  const weekStarts = new Set<string>();
  for (let t = windowStart.getTime(); t <= calendarEnd.getTime(); t += DAY_MS) {
    weekStarts.add(weekStartStrFromDateStr(pragueOf(new Date(t)).dateStr));
  }
  weekStarts.add(weekStartStrFromDateStr(pragueOf(calendarEnd).dateStr));

  const [rows, rawWeekShifts, cdRows] = await Promise.all([
    tx.block.findMany({
      where: {
        machine,
        // anchor + sourozenci ve stejné dávce (lasso) se neposouvají
        id: { notIn: [anchor.id, ...excludeIds] },
        type: "ZAKAZKA",
        startTime: { lt: windowEnd },
        endTime: { gt: windowStart },
      },
      select: {
        id: true,
        orderNumber: true,
        startTime: true,
        endTime: true,
        locked: true,
        printCompletedAt: true,
        printMinutes: true,
        scheduleBypassed: true,
      },
    }),
    tx.machineWeekShifts.findMany({
      where: {
        machine,
        weekStart: { in: Array.from(weekStarts).map((s) => new Date(`${s}T00:00:00.000Z`)) },
      },
    }),
    tx.companyDay.findMany({
      where: {
        startDate: { lt: calendarEnd },
        endDate: { gt: windowStart },
        OR: [{ machine: null }, { machine }],
      },
      select: { startDate: true, endDate: true },
    }),
  ]);

  const weekShifts: MachineWeekShiftsRow[] = serializeWeekShifts(rawWeekShifts);
  const companyDays: CompanyDayInterval[] = cdRows.map((c) => ({ start: c.startDate, end: c.endDate }));

  const others: BlockInterval[] = rows.map((r) => ({
    id: r.id,
    startTime: r.startTime,
    endTime: r.endTime,
    // Vytištěné bloky (printCompletedAt) se chovají jako zamčené — tisk fyzicky proběhl,
    // nesmí se přeplánovat chain pushem (locked se při potvrzení tisku nenastavuje).
    locked: r.locked || r.printCompletedAt != null,
    printMinutes: r.printMinutes,
    scheduleBypassed: r.scheduleBypassed,
  }));

  const rowById = new Map(rows.map((r) => [r.id, r]));

  const result = computeChainPush(machine, anchor, others, weekShifts, companyDays);
  if (!result.ok) {
    if (result.reason === "LOCKED_CONFLICT") {
      const l = rowById.get(result.lockedId);
      throw new AppError(
        "OVERLAP",
        `Nelze uvolnit místo — koliduje se zamčeným blokem #${l?.orderNumber ?? result.lockedId}. Vyber jiné místo.`
      );
    }
    const b = rowById.get(result.blockId);
    throw new AppError(
      "SCHEDULE_VIOLATION",
      `Auto-posun bloku #${b?.orderNumber ?? result.blockId} nenašel místo v kalendáři — uvolni místo ručně.`
    );
  }
  if (result.moves.length === 0) return [];

  // Nezávislá pojistka (spec 3.6): každý posunutý blok musí mít end == expandPrintTime(...).
  // computeChainPush to garantuje konstrukcí; tohle chytá případný drift obou implementací.
  for (const m of result.moves) {
    const r = rowById.get(m.id)!;
    // Umístění za oknem bloků by expandovalo nad kalendářem načteným jen do calendarEnd
    // (tichý fallback na hardcoded rozvrh) — extrémní kaskáda se radši odmítne.
    if (m.startTime.getTime() > windowEnd.getTime()) {
      throw new AppError(
        "SCHEDULE_VIOLATION",
        `Auto-posun bloku #${r.orderNumber ?? m.id} přesáhl horizont plánování — uvolni místo ručně.`
      );
    }
    const pm = r.printMinutes ?? Math.round((r.endTime.getTime() - r.startTime.getTime()) / 60000);
    const exp = expandPrintTime(machine, m.startTime, pm, weekShifts, companyDays, r.scheduleBypassed);
    const cdHit = r.scheduleBypassed
      ? companyDays.find((cd) => cd.start < m.endTime && cd.end > m.startTime)
      : undefined;
    if (!exp.ok || exp.end.getTime() !== m.endTime.getTime() || cdHit) {
      throw new AppError(
        "SCHEDULE_VIOLATION",
        `Auto-posun bloku #${r.orderNumber ?? m.id} nesedí na kalendář — uvolni místo ručně.`
      );
    }
  }

  const applied: AppliedMove[] = [];
  for (const m of result.moves) {
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
