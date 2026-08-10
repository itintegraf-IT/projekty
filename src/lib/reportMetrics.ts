/**
 * Utility funkce pro reportovací dashboard.
 * Čisté funkce bez DB závislostí — snadno testovatelné.
 */

import { addDaysToCivilDate } from "./dateUtils";
import { resolveShiftBounds } from "./shifts";
import { type MachineWeekShiftsRow, weekStartStrFromDateStr } from "./machineWeekShifts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BlockInput = {
  type: string;
  machine: string;
  startTime: Date;
  endTime: Date;
  printMinutes: number | null;
  printCompletedAt: Date | null;
  createdAt: Date;
};

// ---------------------------------------------------------------------------
// 1. computeAvailableHours
// ---------------------------------------------------------------------------

/**
 * Spočítá dostupné pracovní hodiny stroje v rozsahu civil date (inclusive).
 * Zdroj: MachineWeekShifts (flags + fixní časy směn 6/14/22).
 */
export function computeAvailableHours(
  machine: string,
  rangeStart: string,
  rangeEnd: string,
  weekShifts: MachineWeekShiftsRow[],
): number {
  let totalMin = 0;
  let cur = rangeStart;

  while (cur <= rangeEnd) {
    const weekStart = weekStartStrFromDateStr(cur);
    const dayOfWeek = new Date(cur + "T12:00:00Z").getUTCDay();
    const row = weekShifts.find(
      (w) => w.machine === machine && w.weekStart === weekStart && w.dayOfWeek === dayOfWeek,
    );
    if (row && row.isActive) {
      // MORNING + AFTERNOON celé (neprekračují půlnoc).
      for (const shift of ["MORNING", "AFTERNOON"] as const) {
        const b = resolveShiftBounds(row, shift);
        if (b) totalMin += b.endMin - b.startMin;
      }
      // NIGHT: jen [startMin, 1440) dnes.
      const night = resolveShiftBounds(row, "NIGHT");
      if (night && night.endMin < night.startMin) {
        totalMin += 1440 - night.startMin;
      }
    }
    // Tail z PŘEDCHOZÍHO dne: NIGHT(X-1) přispívá [0, prevEnd) dni X.
    const prevDate = (() => {
      const d = new Date(cur + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    const prevWeekStart = weekStartStrFromDateStr(prevDate);
    const prevDow = new Date(prevDate + "T12:00:00Z").getUTCDay();
    const prev = weekShifts.find(
      (w) => w.machine === machine && w.weekStart === prevWeekStart && w.dayOfWeek === prevDow,
    );
    if (prev && prev.isActive && prev.nightOn) {
      const b = resolveShiftBounds(prev, "NIGHT");
      if (b && b.endMin < b.startMin) totalMin += b.endMin;
    }
    cur = addDaysToCivilDate(cur, 1);
  }

  return totalMin / 60;
}

// ---------------------------------------------------------------------------
// 2. computeUtilization
// ---------------------------------------------------------------------------

/** Procento využití: Math.round((production / available) * 100). Vrací 0 pokud available <= 0. */
export function computeUtilization(productionHours: number, availableHours: number): number {
  if (availableHours <= 0) return 0;
  return Math.round((productionHours / availableHours) * 100);
}

// ---------------------------------------------------------------------------
// 3. computeThroughput
// ---------------------------------------------------------------------------

/** Počet bloků type=ZAKAZKA s printCompletedAt v daném rozsahu (inclusive civil dates). */
export function computeThroughput(blocks: BlockInput[], rangeStart: string, rangeEnd: string): number {
  const start = new Date(rangeStart + "T00:00:00Z");
  const end = new Date(rangeEnd + "T23:59:59.999Z");

  return blocks.filter(
    (b) =>
      b.type === "ZAKAZKA" &&
      b.printCompletedAt !== null &&
      b.printCompletedAt >= start &&
      b.printCompletedAt <= end,
  ).length;
}

// ---------------------------------------------------------------------------
// 4. computeAvgLeadTimeDays
// ---------------------------------------------------------------------------

/** Průměrný lead time v dnech pro dokončené ZAKAZKA bloky v rozsahu. Vrací 0 pokud žádné. */
export function computeAvgLeadTimeDays(blocks: BlockInput[], rangeStart: string, rangeEnd: string): number {
  const start = new Date(rangeStart + "T00:00:00Z");
  const end = new Date(rangeEnd + "T23:59:59.999Z");

  const completed = blocks.filter(
    (b) =>
      b.type === "ZAKAZKA" &&
      b.printCompletedAt !== null &&
      b.printCompletedAt >= start &&
      b.printCompletedAt <= end,
  );

  if (completed.length === 0) return 0;

  const totalDays = completed.reduce((sum, b) => {
    const diffMs = b.printCompletedAt!.getTime() - b.createdAt.getTime();
    return sum + diffMs / (1000 * 60 * 60 * 24);
  }, 0);

  return Math.round(totalDays / completed.length);
}

// ---------------------------------------------------------------------------
// 5. computeMaintenanceRatio
// ---------------------------------------------------------------------------

/** Procento údržby z dostupných hodin. Vrací 0 pokud available <= 0. */
export function computeMaintenanceRatio(maintenanceHours: number, availableHours: number): number {
  if (availableHours <= 0) return 0;
  return Math.round((maintenanceHours / availableHours) * 100);
}

// ---------------------------------------------------------------------------
// 6. computePlanStability
// ---------------------------------------------------------------------------

/**
 * Jedna poziční změna bloku, jak ji zaznamenala „černá skříňka" `BlockRevision`.
 *
 * Volající předává JEN řádky, u kterých se skutečně změnil `startTime`, `endTime`
 * nebo `machine` — filtr patří do dotazu, ne sem (viz `handleRetro`).
 */
export type PlanMoveInput = {
  /**
   * `BlockRevision.groupId` — jedna serverová transakce. Schéma to má v komentáři
   * doslova: „Jedna serverová transakce = jeden groupId napříč všemi dotčenými
   * bloky." Právě proto se dá počítat jako JEDNO rozhodnutí uživatele: přetažení
   * i lasso přes deset bloků i vložení, které odsune pět navazujících, mají
   * všechny jeden groupId.
   */
  groupId: string;
  blockId: number;
};

/**
 * Stabilita plánu — dvě čísla a podíl mezi nimi.
 *
 * `interventionCount` odpovídá na „jak často musel plánovač sáhnout do hotového
 * plánu", `movedBlockCount` na „kolik zakázek se tím reálně pohnulo". Jejich
 * poměr říká, jak drahý je jeden zásah (typicky vložení spěchající zakázky).
 *
 * ## Proč se OBĚ čísla počítají nad TOUŽE množinou bloků
 *
 * Průnik s `blockIdsInRange` je jádro opravy, ne detail. Předchozí verze brala
 * čitatel z bloků EDITOVANÝCH v období a jmenovatel z bloků NAPLÁNOVANÝCH
 * v období — dvě sotva se překrývající množiny (kdo v srpnu plánuje září,
 * vyrábí srpnové záznamy o zářijových blocích). Podíl proto mohl vyjít i záporný.
 * Průnikem je `movedBlockCount ≤ blockIdsInRange.size`, takže výsledek je
 * z principu v rozsahu 0–100 a poměr obou čísel dává smysl.
 *
 * Zásah nad blokem mimo období se nezapočítá ani do `interventionCount` —
 * jinak by report za srpen tvrdil „12 zásahů", z nichž se v srpnu neprojevil
 * ani jeden.
 */
export function computePlanStability(
  moves: PlanMoveInput[],
  blockIdsInRange: ReadonlySet<number>,
): { interventionCount: number; movedBlockCount: number; stabilityPercent: number } {
  const relevant = moves.filter((m) => blockIdsInRange.has(m.blockId));

  const movedBlockCount = new Set(relevant.map((m) => m.blockId)).size;
  const interventionCount = new Set(relevant.map((m) => m.groupId)).size;

  const total = blockIdsInRange.size;
  const stabilityPercent =
    total <= 0 ? 100 : Math.round(((total - movedBlockCount) / total) * 100);

  return { interventionCount, movedBlockCount, stabilityPercent };
}

// ---------------------------------------------------------------------------
// 7. computeBlockHours
// ---------------------------------------------------------------------------

/**
 * Hodiny jednoho bloku pro metriky: ZAKAZKA = printMinutes (tiskový čas — elapsed
 * by u bloku pauznutého přes odstávku nadhodnocoval), fallback elapsed pro legacy
 * bloky s printMinutes=null. Ostatní typy = elapsed. Bypass ZAKAZKA má pm == elapsed.
 */
export function blockDurationHours(b: BlockInput): number {
  const elapsedH = (b.endTime.getTime() - b.startTime.getTime()) / 3_600_000;
  if (b.type !== "ZAKAZKA") return elapsedH;
  return b.printMinutes != null && Number.isFinite(b.printMinutes) && b.printMinutes > 0
    ? b.printMinutes / 60
    : elapsedH;
}

/** Součet hodin bloků pro daný stroj a typ (ZAKAZKA přes tiskové minuty). */
export function computeBlockHours(blocks: BlockInput[], machine: string, type: string): number {
  return blocks
    .filter((b) => b.machine === machine && b.type === type)
    .reduce((sum, b) => sum + blockDurationHours(b), 0);
}
