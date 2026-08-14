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
// 3. Průtok a lead time — nad DOKONČENÝMI zakázkami
// ---------------------------------------------------------------------------

/** Blok s potvrzeným tiskem. Načítá se dotazem na `printCompletedAt`, ne podle polohy v plánu. */
export type CompletedBlock = {
  id: number;
  splitGroupId: number | null;
  createdAt: Date;
  printCompletedAt: Date;
};

/** Jedna zakázka: rozdělené kusy jsou sloučené do jednoho záznamu. */
export type CompletedOrder = { key: string; createdAt: Date; completedAt: Date };

/**
 * Bloky → zakázky. Rozdělená zakázka je JEDNA zakázka (rozhodnutí Vojty 14. 8. 2026),
 * proto se kusy slučují přes `splitGroupId`.
 *
 * Klíč nese prefix `g`/`b`, protože `Block.id` a `SplitGroup.id` jsou NEZÁVISLÉ
 * id-prostory — numerická shoda by dvě různé zakázky sloučila v jednu (táž konvence
 * jako v `blockShades.ts`).
 *
 * Skupina si bere NEJSTARŠÍ založení a NEJPOZDĚJŠÍ dokončení: to je poctivá doba
 * od zadání po dotištění posledního kusu. Kus vzniklý splitem má `createdAt`
 * v okamžiku rozdělení, takže sám o sobě by dal uměle krátký lead time.
 */
export function groupCompletedToOrders(blocks: CompletedBlock[]): CompletedOrder[] {
  const byKey = new Map<string, CompletedOrder>();
  for (const b of blocks) {
    const key = b.splitGroupId != null ? `g${b.splitGroupId}` : `b${b.id}`;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { key, createdAt: b.createdAt, completedAt: b.printCompletedAt });
      continue;
    }
    if (b.createdAt.getTime() < cur.createdAt.getTime()) cur.createdAt = b.createdAt;
    if (b.printCompletedAt.getTime() > cur.completedAt.getTime()) cur.completedAt = b.printCompletedAt;
  }
  return [...byKey.values()];
}

/** Počet dokončených zakázek v období. */
export function computeThroughputFromOrders(orders: CompletedOrder[]): number {
  return orders.length;
}

/**
 * Průměrná doba od založení po dokončení, v dnech na jedno desetinné místo.
 *
 * `null` (ne 0) při prázdné množině: v tiskárně se hodně zakázek odbaví do 24 h,
 * takže „0 dní“ je legitimní hodnota a nesmí znamenat zároveň „nevím“.
 */
export function computeAvgLeadTimeDaysFromOrders(orders: CompletedOrder[]): number | null {
  if (orders.length === 0) return null;
  const totalMs = orders.reduce((sum, o) => sum + (o.completedAt.getTime() - o.createdAt.getTime()), 0);
  const days = totalMs / orders.length / 86_400_000;
  return Math.round(days * 10) / 10;
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

/**
 * Smí metrika o zvoleném období vůbec něco tvrdit?
 *
 * Data existují jen v průniku dvou hranic:
 *  - **odkdy se nahrává** — kdy na daném prostředí doběhla migrace, která
 *    `BlockRevision` založila (`REVISION_MIGRATION_NAME`). Dřív se poziční
 *    změny nikam nezapisovaly;
 *  - **kam sahá retence** — `now − retentionDays`. Starší řádky noční úklid
 *    smazal, takže by nad nimi vyšla nula změn místo poctivého „nevím".
 *
 * ## Proč NE `MIN(createdAt)` z revizí
 *
 * To je datum PRVNÍ ZMĚNY, ne začátek nahrávání. Když skříňka poctivě běží
 * a nikdo se celý den ničeho nedotkne, první revize přijde pozdě — a metrika
 * by ten klid přečetla jako chybějící data. Ruční test 10. 8. 2026 to trefil
 * napoprvé: bloky se přesouvaly, revize prokazatelně vznikaly, a karta pořád
 * ukazovala „—", protože první revize dne byla mladší než jeho půlnoc.
 * Klidné období je legitimní odpověď „nic se nepohnulo", ne prázdno.
 *
 * Neznámý začátek nahrávání (chybí řádek migrace) vrací `covered: false` —
 * raději pomlčku než číslo, za které nikdo neručí.
 */
export function resolvePlanCoverage(
  recordingStartedAt: Date | null,
  rangeStartUtc: Date,
  now: Date,
  retentionDays: number,
): { covered: boolean; coverageFrom: Date | null } {
  if (recordingStartedAt == null) return { covered: false, coverageFrom: null };

  const retentionFloor = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const coverageFrom = new Date(Math.max(recordingStartedAt.getTime(), retentionFloor));

  // `<=` schválně: období, které začíná PŘESNĚ v okamžiku spuštění nahrávání,
  // je pokryté celé.
  return { covered: coverageFrom.getTime() <= rangeStartUtc.getTime(), coverageFrom };
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
