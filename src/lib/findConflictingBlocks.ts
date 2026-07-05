import { prisma } from "@/lib/prisma";
import { civilDateToUTCMidnight } from "@/lib/dateUtils";
import { type MachineWeekShiftsRow, weekStartStrFromDateStr } from "@/lib/machineWeekShifts";
import { checkScheduleViolationWithTemplates, serializeWeekShifts } from "@/lib/scheduleValidation";
import { AppError } from "@/lib/errors";

export type ConflictingBlock = {
  id: number;
  orderNumber: string;
  description: string | null;
  startTime: string;
  endTime: string;
};

export type WeekRowInput = {
  dayOfWeek: number;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
  morningStartMin: number | null;
  morningEndMin: number | null;
  afternoonStartMin: number | null;
  afternoonEndMin: number | null;
  nightStartMin: number | null;
  nightEndMin: number | null;
  isActive: boolean;
};

/**
 * Okno bloků dotčených editací týdne `weekStartStr`: span-overlap s
 * `[weekStart, weekStart + 7d + 6h)`.
 *
 * +6h přesah: NIGHT je forward-semantic (viz `isDateTimeActive` v `shifts.ts`) — nedělní
 * NIGHT flag editovaného týdne pokrývá i pondělí 0:00–6:00 týdne NÁSLEDUJÍCÍHO. Bez přesahu
 * by blok začínající v tomto oknu unikl detekci, i když ho editace reálně ovlivňuje.
 * Span-overlap (ne jen start uvnitř okna) zase chytá bloky ZAČÍNAJÍCÍ v předchozím týdnu
 * a PŘESAHUJÍCÍ do editovaného — starý filtr `startTime: { gte, lt }` je propouštěl bez
 * kontroly (spec 3.9).
 */
export function computeConflictWindow(weekStartStr: string): { from: Date; to: Date } {
  const from = civilDateToUTCMidnight(weekStartStr);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 7);
  to.setUTCHours(to.getUTCHours() + 6);
  return { from, to };
}

/**
 * Prisma `where` fragment span-overlapu bloku s oknem dotčeným editací týdne
 * `weekStartStr` (viz `computeConflictWindow`). Jediný zdroj pravdy pro tvar
 * `{ startTime: { lt }, endTime: { gt } }` — použít v `findConflictingBlocks` i v TOCTOU
 * re-checku (`machine-week-shifts/route.ts`), aby žádné z míst nemohlo omylem prohodit
 * strany srovnání (`from`/`to` na špatné pole by prošlo beze změny výsledku testů, které
 * pracují jen s `computeConflictWindow` samotným).
 */
export function conflictWindowWhere(weekStartStr: string): { startTime: { lt: Date }; endTime: { gt: Date } } {
  const { from, to } = computeConflictWindow(weekStartStr);
  return { startTime: { lt: to }, endTime: { gt: from } };
}

/**
 * YYYY-MM-DD (pondělí) týdnů bezprostředně před a po `weekStartStr` — právě ty týdny mohou
 * obsahovat řádky, které rozhodují o slotech bloku ležících mimo editovaný týden (viz
 * `computeConflictWindow`). Validace bez těchto řádků padá na `isHardcodedBlocked` fallback,
 * který nemusí odpovídat skutečnému rozvrhu sousedního týdne.
 */
export function neighborWeekStarts(weekStartStr: string): [string, string] {
  const start = civilDateToUTCMidnight(weekStartStr);
  const prev = new Date(start);
  prev.setUTCDate(prev.getUTCDate() - 7);
  const next = new Date(start);
  next.setUTCDate(next.getUTCDate() + 7);
  const fmt = (d: Date) => weekStartStrFromDateStr(d.toISOString().slice(0, 10));
  return [fmt(prev), fmt(next)];
}

function buildSynthRows(machine: string, weekStartStr: string, newRows: WeekRowInput[]): MachineWeekShiftsRow[] {
  return newRows.map((r) => ({
    machine,
    weekStart: weekStartStr,
    dayOfWeek: r.dayOfWeek,
    isActive: r.isActive,
    morningOn: r.morningOn,
    afternoonOn: r.afternoonOn,
    nightOn: r.nightOn,
    morningStartMin: r.morningStartMin,
    morningEndMin: r.morningEndMin,
    afternoonStartMin: r.afternoonStartMin,
    afternoonEndMin: r.afternoonEndMin,
    nightStartMin: r.nightStartMin,
    nightEndMin: r.nightEndMin,
  }));
}

/** Strukturální podmnožina Prisma klienta potřebná pro fetch+detekci — funguje
 * s top-level `prisma` i s `tx` uvnitř `$transaction` (obě volající místa: pre-transakční
 * `findConflictingBlocks` a in-transaction TOCTOU re-check `assertNoConflictingBlocks`). */
export type ConflictCheckClient = {
  block: {
    findMany: (args: {
      where: { machine: string } & ReturnType<typeof conflictWindowWhere>;
      select: { id: true; orderNumber: true; description: true; startTime: true; endTime: true };
    }) => Promise<Array<{ id: number; orderNumber: string; description: string | null; startTime: Date; endTime: Date }>>;
  };
  machineWeekShifts: {
    findMany: (args: {
      where: { machine: string; weekStart: { in: Date[] } };
    }) => Promise<Parameters<typeof serializeWeekShifts>[0]>;
  };
};

/**
 * Fetch bloků dotčených editací týdne (span-overlap okno + sousední týdny pro slotovou
 * validaci) + čistá detekce (`detectConflictsPure`) — sdílené jádro pro `findConflictingBlocks`
 * (pre-transakční, volá s `prisma`) i `assertNoConflictingBlocks` (in-transaction TOCTOU
 * re-check, volá s `tx`). Viz `computeConflictWindow`/`neighborWeekStarts` pro odůvodnění
 * okna a sousedních řádků (spec 3.9).
 */
async function fetchConflictingBlocks(
  db: ConflictCheckClient,
  machine: string,
  weekStartStr: string,
  newRows: WeekRowInput[],
): Promise<ConflictingBlock[]> {
  const [prevWeek, nextWeek] = neighborWeekStarts(weekStartStr);

  const [blocks, neighborRawRows] = await Promise.all([
    db.block.findMany({
      where: { machine, ...conflictWindowWhere(weekStartStr) },
      select: { id: true, orderNumber: true, description: true, startTime: true, endTime: true },
    }),
    db.machineWeekShifts.findMany({
      where: { machine, weekStart: { in: [civilDateToUTCMidnight(prevWeek), civilDateToUTCMidnight(nextWeek)] } },
    }),
  ]);

  return detectConflictsPure(machine, weekStartStr, newRows, blocks, serializeWeekShifts(neighborRawRows));
}

/**
 * Najde bloky typu ZAKAZKA/DATA/MATERIAL, které po změně pracovní doby
 * spadnou mimo aktivní intervaly. Pre-transakční volání (top-level `prisma`) — použité
 * pro info toast s výčtem konfliktů PŘED tím, než uživatel potvrdí force save.
 */
export async function findConflictingBlocks(
  machine: string,
  weekStartStr: string,
  newRows: WeekRowInput[],
): Promise<ConflictingBlock[]> {
  return fetchConflictingBlocks(prisma, machine, weekStartStr, newRows);
}

/**
 * TOCTOU re-check uvnitř `$transaction` (`machine-week-shifts` PUT) — mezi pre-transakčním
 * `findConflictingBlocks` a commitem mohl jiný uživatel vytvořit konfliktní blok; toto
 * volání běží na `tx` (vidí i rozpracovaný stav transakce) a při jakémkoli konfliktu
 * hodí `AppError("CONFLICT", raceErrorMessage)` — volající ho nechává bublat (rollback
 * celé transakce), NECHYTÁ ho zde. Stejné dotazy/stejné okno jako `findConflictingBlocks`
 * (obě volají `fetchConflictingBlocks`) — žádné dvě místa v kódu nemohou nezávisle
 * rozjet tvar `where` nebo validačních řádků.
 */
export async function assertNoConflictingBlocks(
  db: ConflictCheckClient,
  machine: string,
  weekStartStr: string,
  newRows: WeekRowInput[],
  raceErrorMessage: string,
): Promise<void> {
  const conflicts = await fetchConflictingBlocks(db, machine, weekStartStr, newRows);
  if (conflicts.length > 0) {
    throw new AppError("CONFLICT", raceErrorMessage);
  }
}

/**
 * Pure variant (bez Prisma) — pro unit testy.
 * Dostane bloky jako input místo je načítat z DB.
 *
 * `neighborRows` = skutečné řádky sousedních týdnů (typicky `weekStart − 7d` a `weekStart + 7d`,
 * viz `neighborWeekStarts`) — bez nich sloty bloku ležící mimo editovaný týden padají na
 * `isHardcodedBlocked` fallback místo skutečného rozvrhu. Default `[]` = validace bez sousedních
 * týdnů (sloty mimo dodané řádky padají na hardcoded fallback) — pro zpětnou kompatibilitu volání,
 * která sousední řádky nemají k dispozici.
 */
export function detectConflictsPure(
  machine: string,
  weekStartStr: string,
  newRows: WeekRowInput[],
  blocks: Array<{ id: number; orderNumber: string; description: string | null; startTime: Date; endTime: Date }>,
  neighborRows: MachineWeekShiftsRow[] = [],
): ConflictingBlock[] {
  const synthRows = [...buildSynthRows(machine, weekStartStr, newRows), ...neighborRows];

  const conflicts: ConflictingBlock[] = [];
  for (const b of blocks) {
    const violation = checkScheduleViolationWithTemplates(machine, b.startTime, b.endTime, synthRows);
    if (violation) {
      conflicts.push({
        id: b.id,
        orderNumber: b.orderNumber,
        description: b.description,
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
      });
    }
  }
  return conflicts;
}
