/**
 * Utility funkce pro reportovací dashboard.
 * Čisté funkce bez DB závislostí — snadno testovatelné.
 */

import { addDaysToCivilDate, pragueToUTC } from "./dateUtils";
import {
  type Interval,
  intersectIntervals,
  mergeIntervals,
  subtractIntervals,
  totalHours,
} from "./intervals";
import { companyDayIntervalsFor } from "./printTimeClient";
import { resolveShiftBounds } from "./shifts";
import { type MachineWeekShiftsRow, weekStartStrFromDateStr } from "./machineWeekShifts";

// ---------------------------------------------------------------------------
// 1. computeAvailableHours
// ---------------------------------------------------------------------------

export type CompanyDayRow = { machine?: string | null; startDate: string | Date; endDate: string | Date };

/**
 * Pražská minuta dne → absolutní UTC čas.
 *
 * Minuta smí být i 1440 a víc: `SHIFT_EDIT_RANGES` dovoluje konec odpolední (a začátek
 * noční) nastavit přesně na 1440 = půlnoc, což je 00:00 NÁSLEDUJÍCÍHO dne.
 * `pragueToUTC` bere hodinu jen 0–23, takže se přebytek převede na posun dne — jinak
 * by report na takové směně spadl.
 */
function pragueMinuteToUtcMs(dayStr: string, min: number): number {
  const dayOffset = Math.floor(min / 1440);
  const rest = min - dayOffset * 1440;
  const day = dayOffset === 0 ? dayStr : addDaysToCivilDate(dayStr, dayOffset);
  return pragueToUTC(day, Math.floor(rest / 60), rest % 60).getTime();
}

/** Absolutní UTC intervaly směn jednoho dne. Noční se dělí na dnešek a ocas po půlnoci. */
function shiftIntervalsForDay(row: MachineWeekShiftsRow, dateStr: string): Interval[] {
  const at = (dayStr: string, min: number) => pragueMinuteToUtcMs(dayStr, min);
  const nextDay = addDaysToCivilDate(dateStr, 1);
  const out: Interval[] = [];
  for (const shift of ["MORNING", "AFTERNOON", "NIGHT"] as const) {
    const b = resolveShiftBounds(row, shift);
    if (!b) continue;
    if (b.endMin > b.startMin) {
      out.push({ start: at(dateStr, b.startMin), end: at(dateStr, b.endMin) });
    } else {
      // Noční přes půlnoc patří ke dni SVÉHO STARTU (týž model jako `isDateTimeActive`).
      const midnight = pragueToUTC(nextDay, 0, 0).getTime();
      out.push({ start: at(dateStr, b.startMin), end: midnight });
      out.push({ start: midnight, end: at(nextDay, b.endMin) });
    }
  }
  return out;
}

/**
 * Dostupné pracovní hodiny stroje v rozsahu civil date (inclusive), **po odečtení odstávek**.
 *
 * Bez odečtení tvrdil report o týdnu celozávodní dovolené „0 % ze 152 dostupných hodin“
 * místo poctivého „0 z 0“ — čitatel odstávku respektuje (expanze tisku v ní vrátí
 * START_NOT_RUNNABLE), jmenovatel ji dřív ignoroval. Na produkci 153,9 h v prosinci 2026.
 *
 * Směny se staví i pro den PŘED rozsahem: noční směna patří ke dni svého startu a do
 * okna zasahuje ocasem po půlnoci. Ořez oknem pak zajistí, že se počítají jen hodiny
 * uvnitř zvoleného období.
 */
export function computeAvailableHours(
  machine: string,
  rangeStart: string,
  rangeEnd: string,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayRow[],
): number {
  const winStart = pragueToUTC(rangeStart, 0, 0).getTime();
  const winEnd = pragueToUTC(addDaysToCivilDate(rangeEnd, 1), 0, 0).getTime();
  if (winEnd <= winStart) return 0;

  const rawShifts: Interval[] = [];
  let cur = addDaysToCivilDate(rangeStart, -1);
  while (cur <= rangeEnd) {
    const weekStart = weekStartStrFromDateStr(cur);
    const dayOfWeek = new Date(cur + "T12:00:00Z").getUTCDay();
    const row = weekShifts.find(
      (w) => w.machine === machine && w.weekStart === weekStart && w.dayOfWeek === dayOfWeek,
    );
    if (row && row.isActive) rawShifts.push(...shiftIntervalsForDay(row, cur));
    cur = addDaysToCivilDate(cur, 1);
  }

  // Směny se slučují ze stejného důvodu jako odstávky: `PUT /api/machine-week-shifts` validuje
  // každou směnu IZOLOVANĚ, takže noční do 08:00 vedle výchozí ranní od 06:00 projde — a průnik
  // by se do jmenovatele započetl dvakrát. Nafouknutá kapacita podhodnocuje vytížení, takže by
  // se přeplánování schovalo právě tam, kde má být nejlíp vidět.
  const shifts = mergeIntervals(rawShifts);

  const shutdowns = mergeIntervals(
    companyDayIntervalsFor(machine, companyDays).map((i) => ({
      start: i.start.getTime(),
      end: i.end.getTime(),
    })),
  );

  let ms = 0;
  for (const iv of shifts) {
    const s = Math.max(iv.start, winStart);
    const e = Math.min(iv.end, winEnd);
    if (e <= s) continue;
    let free = e - s;
    for (const sd of shutdowns) {
      free -= Math.max(0, Math.min(e, sd.end) - Math.max(s, sd.start));
    }
    ms += Math.max(0, free);
  }
  return ms / 3_600_000;
}

// ---------------------------------------------------------------------------
// 1b. computeCalendarCascade
// ---------------------------------------------------------------------------

export type CalendarCascade = {
  calendarHours: number;
  staffedHours: number;
  plannedHours: number;
  confirmedHours: number;
  /** Podíl potvrzených na naplánovaných. `null` když se nic neplánovalo. */
  confirmedShareOfPlanned: number | null;
  unused: { total: number; weekend: number; shutdown: number; unstaffedShift: number };
};

/**
 * Absolutní UTC intervaly OBSAZENÝCH směn v okně `[winStart, winEnd)`, po odečtení odstávek.
 *
 * Záměrně TÝŽ postup jako v `computeAvailableHours` — jen vrací, KDE ty hodiny leží,
 * místo pouhého součtu. Rozpad nevyužitého kalendáře potřebuje polohu; kdyby se
 * rekonstrukce s originálem rozešla, přestalo by platit `kalendář − obsazeno = nevyužito`
 * a rozpad by tiše lhal (hlídá test parity s `computeAvailableHours`).
 *
 * Proto se stejně jako tam začíná DEN PŘED rozsahem: noční směna patří ke dni svého
 * startu a do okna zasahuje ocasem po půlnoci.
 */
function staffedIntervals(
  machine: string,
  rangeStart: string,
  rangeEnd: string,
  weekShifts: MachineWeekShiftsRow[],
  shutdowns: Interval[],
  window: Interval[],
): Interval[] {
  const rawShifts: Interval[] = [];
  let cur = addDaysToCivilDate(rangeStart, -1);
  while (cur <= rangeEnd) {
    const weekStart = weekStartStrFromDateStr(cur);
    const dayOfWeek = new Date(cur + "T12:00:00Z").getUTCDay();
    const row = weekShifts.find(
      (w) => w.machine === machine && w.weekStart === weekStart && w.dayOfWeek === dayOfWeek,
    );
    if (row && row.isActive) rawShifts.push(...shiftIntervalsForDay(row, cur));
    cur = addDaysToCivilDate(cur, 1);
  }
  return subtractIntervals(intersectIntervals(rawShifts, window), shutdowns);
}

/**
 * Kaskáda kalendář → obsazeno směnami → naplánováno → potvrzeno tiskařem.
 *
 * Odpovídá na otázku, kterou dnešní „vytížení" položit neumí: **jakou část
 * kalendáře vůbec obsazujeme lidmi.** Vytížení je poměr třetího kroku ke
 * druhému, takže o prvním nic neříká — stroj na jednu směnu může mít vytížení
 * 95 % a přitom stát tři čtvrtiny roku.
 *
 * `plannedHours` a `confirmedHours` se PŘEDÁVAJÍ, nepočítají. Route je má
 * spočítané přes `segMap` a `printOverlapMinutes`; druhá cesta k témuž číslu
 * by se dřív nebo později rozešla.
 */
export function computeCalendarCascade(args: {
  machine: string;
  rangeStart: string;
  rangeEnd: string;
  weekShifts: MachineWeekShiftsRow[];
  companyDays: CompanyDayRow[];
  plannedHours: number;
  confirmedHours: number;
}): CalendarCascade {
  const { machine, rangeStart, rangeEnd, weekShifts, companyDays } = args;

  // Kalendář jako SKUTEČNÝ uplynulý čas, ne dny × 24 — jinak by den přechodu
  // na zimní čas (25 h) vyšel o hodinu kratší a součet rozpadu by nesouhlasil.
  const periodStart = pragueMinuteToUtcMs(rangeStart, 0);
  const periodEnd = pragueMinuteToUtcMs(addDaysToCivilDate(rangeEnd, 1), 0);
  const period: Interval[] = periodEnd > periodStart ? [{ start: periodStart, end: periodEnd }] : [];
  const calendarHours = totalHours(period);

  // Kapacita se NEPOČÍTÁ znovu — bere se z téže funkce, jakou používá karta
  // „Vytížení". Dvě cesty k témuž číslu se dřív nebo později rozejdou.
  const staffedHours = computeAvailableHours(machine, rangeStart, rangeEnd, weekShifts, companyDays);

  const shutdowns = mergeIntervals(
    companyDayIntervalsFor(machine, companyDays).map((i) => ({
      start: i.start.getTime(),
      end: i.end.getTime(),
    })),
  );
  const staffed = staffedIntervals(machine, rangeStart, rangeEnd, weekShifts, shutdowns, period);
  const unusedIntervals = subtractIntervals(period, staffed);

  // Víkendy jako intervaly — soboty a neděle podle PRAŽSKÉHO data, celý den
  // od půlnoci do půlnoci (tedy 25 h na dni přechodu času).
  const weekends: Interval[] = [];
  for (let d = rangeStart; d <= rangeEnd; d = addDaysToCivilDate(d, 1)) {
    const dow = new Date(`${d}T12:00:00.000Z`).getUTCDay();
    if (dow === 0 || dow === 6) {
      weekends.push({
        start: pragueMinuteToUtcMs(d, 0),
        end: pragueMinuteToUtcMs(addDaysToCivilDate(d, 1), 0),
      });
    }
  }

  /*
   * Každá nevyužitá hodina patří PRÁVĚ JEDNÉ příčině, v pořadí od nejméně
   * získatelné po nejvíc. Sobotní odstávka je obojí naráz — a musí se počítat
   * jako víkend, protože zavřením závodu v sobotu, kdy stroj stejně nejede,
   * se neztratí nic. Kdyby vyhrála odstávka, číslo „kolik nás stály odstávky"
   * by se nafouklo o hodiny, které nikdy nešly využít.
   *
   * Třetí kbelík je REZIDUUM. Právě proto je to to číslo, které jde zvednout
   * bez otevírání víkendů a bez rušení odstávek.
   */
  const weekendPart = intersectIntervals(unusedIntervals, weekends);
  const afterWeekend = subtractIntervals(unusedIntervals, weekends);
  const shutdownPart = intersectIntervals(afterWeekend, shutdowns);
  const unstaffedPart = subtractIntervals(afterWeekend, shutdowns);

  return {
    calendarHours,
    staffedHours,
    plannedHours: args.plannedHours,
    confirmedHours: args.confirmedHours,
    confirmedShareOfPlanned:
      args.plannedHours > 0 ? Math.round((args.confirmedHours / args.plannedHours) * 100) : null,
    unused: {
      total: totalHours(unusedIntervals),
      weekend: totalHours(weekendPart),
      shutdown: totalHours(shutdownPart),
      unstaffedShift: totalHours(unstaffedPart),
    },
  };
}

// ---------------------------------------------------------------------------
// 2. computeUtilization
// ---------------------------------------------------------------------------

/**
 * Procento využití. `null` při nulové kapacitě — víkend, odstávka nebo chybějící
 * šablony směn NEJSOU „nula procent“, ale „není z čeho počítat“. Bez toho rozlišení
 * vypadá den, kdy stroj nejede, stejně jako den, na který nikdo nic nenaplánoval.
 *
 * Nad 100 % se ZÁMĚRNĚ nezastropuje — přeplánování musí být vidět. Odlišit ho barevně
 * je úkol UI, ne téhle funkce.
 */
export function computeUtilization(productionHours: number, availableHours: number): number | null {
  if (availableHours <= 0) return null;
  return Math.round((productionHours / availableHours) * 100);
}

// ---------------------------------------------------------------------------
// 3. Průtok a lead time — nad DOKONČENÝMI zakázkami
// ---------------------------------------------------------------------------

/**
 * Kus zakázky. Načítá se dotazem na `printCompletedAt`, ne podle polohy v plánu.
 *
 * `printCompletedAt` smí být `null`: volající posílá VŠECHNY sourozence dotčených
 * split-skupin, tedy i ty, které ještě nikdo neodklepl (viz `groupCompletedToOrders`).
 */
export type CompletedBlock = {
  id: number;
  splitGroupId: number | null;
  createdAt: Date;
  printCompletedAt: Date | null;
};

/** Jedna zakázka: rozdělené kusy jsou sloučené do jednoho záznamu. */
export type CompletedOrder = { key: string; createdAt: Date; completedAt: Date };

/**
 * Bloky → zakázky dokončené V OKNĚ `[windowStart, windowEnd)`.
 *
 * Rozdělená zakázka je JEDNA zakázka (rozhodnutí Vojty 14. 8. 2026), proto se kusy
 * slučují přes `splitGroupId`. Klíč nese prefix `g`/`b`, protože `Block.id`
 * a `SplitGroup.id` jsou NEZÁVISLÉ id-prostory — numerická shoda by dvě různé
 * zakázky sloučila v jednu (táž konvence jako v `blockShades.ts`).
 *
 * Skupina si bere NEJSTARŠÍ založení a NEJPOZDĚJŠÍ dokončení: to je poctivá doba
 * od zadání po dotištění posledního kusu. Kus vzniklý splitem má `createdAt`
 * v okamžiku rozdělení, takže sám o sobě by dal uměle krátký lead time.
 *
 * ## Proč okno patří SEM, a ne jen do dotazu
 *
 * Klíč `g<splitGroupId>` je stabilní napříč obdobími, kdežto dotaz na
 * `printCompletedAt` uvnitř období vrací jen některé kusy. Zakázka rozdělená přes
 * hranici (jeden kus 31. 7., druhý 3. 8.) se tak započítala v ČERVENCI I V SRPNU —
 * součet měsíců nedal rok, přesně ta nemoc, kterou etapa odstranila u hodin. Navíc
 * se jí v tom druhém období umělo zkrátil lead time, protože do skupiny spadl jen
 * kus se `createdAt` z okamžiku rozdělení.
 *
 * Volající proto posílá ÚPLNÉ skupiny (i kusy dokončené mimo okno i nedokončené)
 * a rozhodnutí padá tady: zakázka se počítá tomu období, ve kterém byl odklepnut
 * její POSLEDNÍ kus. Nedokončený sourozenec znamená, že zakázka ještě neskončila —
 * nezapočítá se nikam.
 */
export function groupCompletedToOrders(
  blocks: CompletedBlock[],
  windowStart: Date,
  windowEnd: Date,
): CompletedOrder[] {
  type Acc = { key: string; createdAt: Date; completedAt: Date | null; unfinished: boolean };
  const byKey = new Map<string, Acc>();
  for (const b of blocks) {
    const key = b.splitGroupId != null ? `g${b.splitGroupId}` : `b${b.id}`;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, {
        key,
        createdAt: b.createdAt,
        completedAt: b.printCompletedAt,
        unfinished: b.printCompletedAt == null,
      });
      continue;
    }
    if (b.createdAt.getTime() < cur.createdAt.getTime()) cur.createdAt = b.createdAt;
    if (b.printCompletedAt == null) cur.unfinished = true;
    else if (cur.completedAt == null || b.printCompletedAt.getTime() > cur.completedAt.getTime()) {
      cur.completedAt = b.printCompletedAt;
    }
  }

  const from = windowStart.getTime();
  const to = windowEnd.getTime();
  const out: CompletedOrder[] = [];
  for (const acc of byKey.values()) {
    if (acc.unfinished || acc.completedAt == null) continue;
    const done = acc.completedAt.getTime();
    if (done < from || done >= to) continue;
    out.push({ key: acc.key, createdAt: acc.createdAt, completedAt: acc.completedAt });
  }
  return out;
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

/** Procento údržby z dostupných hodin. `null` při nulové kapacitě — viz `computeUtilization`. */
export function computeMaintenanceRatio(maintenanceHours: number, availableHours: number): number | null {
  if (availableHours <= 0) return null;
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
