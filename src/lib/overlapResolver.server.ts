import type { PrismaTransactionClient } from "@/lib/prismaTx";
import { computeChainPush, type ChainMove, type BlockInterval } from "@/lib/overlapResolver";
import { serializeWeekShifts } from "@/lib/scheduleValidation";
import { weekStartStrFromDateStr } from "@/lib/machineWeekShifts";
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { pragueOf } from "@/lib/dateUtils";
import { expandPrintTime, MAX_SPAN_DAYS, type CompanyDayInterval } from "@/lib/printTime";
import { blockOverlapsBlockedTimeWithTemplates } from "@/lib/workingTime";
import { AppError } from "@/lib/errors";
import { measureCascade } from "@/lib/cascadeLimit";
import { assertCascadeConfirmed } from "@/lib/cascadeLimit.server";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Provedený posun bloku — `ChainMove` + původní časy a číslo zakázky (pro audit).
 *
 * `old*` pole nesou KOMPLETNÍ poziční snapshot před posunem, ne jen časy: krok
 * historie (Ctrl+Z) potřebuje `BlockSnapshot`, který má `machine`, `updatedAt`,
 * `printMinutes` i `scheduleBypassed` POVINNÉ. Stroj se sem nedává, protože chain
 * push je z definice per-stroj — doplní ho `moveToBefore` z parametru.
 */
export type AppliedMove = ChainMove & {
  orderNumber: string | null;
  oldStartTime: Date;
  oldEndTime: Date;
  oldUpdatedAt: Date;
  oldPrintMinutes: number | null;
  oldScheduleBypassed: boolean;
};

/** Řádek bloku, ze kterého se odvozuje geometrie posunu. */
type GeometryRow = {
  type: string;
  startTime: Date;
  endTime: Date;
  printMinutes: number | null;
  scheduleBypassed: boolean;
};

/**
 * JEDINÝ zdroj pravdy o tom, jak se blok při chain pushi posouvá. Volá ho jak
 * mapování vstupů pro `computeChainPush`, tak nezávislá pojistka po posunu —
 * kdyby se ta dvě místa rozešla, pojistka by hlásila falešný SCHEDULE_VIOLATION.
 *
 * - ZAKAZKA: tiskové hodiny (délka z `printMinutes`, re-expanze přes pauzy směn,
 *   legacy fallback zarovnaný na 30min mřížku).
 * - REZERVACE / UDRZBA: rigidní interval — PŘESNÁ délka bez zaokrouhlení, bez
 *   roztažení přes pauzy; celý se musí vejít do pracovní doby.
 */
export function chainPushGeometry(r: GeometryRow): {
  printMinutes: number;
  scheduleBypassed: boolean;
  rigid: boolean;
} {
  const spanMinutes = (r.endTime.getTime() - r.startTime.getTime()) / 60000;
  if (r.type !== "ZAKAZKA") {
    return { printMinutes: spanMinutes, scheduleBypassed: false, rigid: true };
  }
  return {
    printMinutes: r.printMinutes ?? Math.max(30, Math.round(spanMinutes / 30) * 30),
    scheduleBypassed: r.scheduleBypassed,
    rigid: false,
  };
}

/**
 * Serverový chain push proti živé DB. Anchor blok je už zapsán na své cílové pozici;
 * tato funkce načte ostatní bloky stroje v okolním okně (VŠECHNY typy — zakázky,
 * rezervace i údržbu), spočítá posuny přes `computeChainPush` a zapíše je v rámci
 * PŘEDANÉ transakce `tx`.
 *
 * Geometrie posunu se liší podle typu (viz `chainPushGeometry`): zakázka se
 * re-expanduje přes tiskové hodiny, rezervace a údržba se posouvají jako pevný
 * interval se zachovanou délkou. Nepohyblivé jsou jen zamčené a vytištěné bloky.
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
  excludeIds: ReadonlySet<number> = new Set(),
  /**
   * Sourozenci z téže dávky (lasso): načtou se jako PŘEKÁŽKA, ale neposouvají se.
   * Na rozdíl od `excludeIds` (úplně neviditelné) tím chain push umístí odsunuté
   * bloky až za ně — jinak by na sourozence dosedly a finální pojistka by
   * celou dávku odmítla 409.
   */
  frozenIds: ReadonlySet<number> = new Set(),
  /**
   * `cascadeConfirmed` — uživatel velkou kaskádu odklepl v dialogu; kontrola se
   * přeskočí. `path` jde jen do logu, aby se z týdne měření dalo poznat, KTERÁ
   * cesta se ptá nejčastěji.
   */
  opts: {
    cascadeConfirmed?: boolean;
    path?: string;
    /**
     * Volající si kontrolu prahu udělá SÁM nad součtem za celé gesto (batch, hromadný
     * přepočet stroje). Per-volání kontrola by u prvního volání vyhodila výjimku s číslem
     * jen z něj — uživatel by odklepl menší dopad, než jaký se skutečně provede.
     */
    skipCascadeCheck?: boolean;
  } = {}
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
        startTime: { lt: windowEnd },
        endTime: { gt: windowStart },
      },
      select: {
        id: true,
        orderNumber: true,
        startTime: true,
        endTime: true,
        updatedAt: true,
        locked: true,
        printCompletedAt: true,
        printMinutes: true,
        scheduleBypassed: true,
        type: true,
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

  // Rigidní blok (rezervace/údržba), který NA SVÉ SOUČASNÉ POZICI kalendáři
  // nevyhovuje, se posouvat nesmí: leží tam vědomě (víkendová údržba, servis
  // uvnitř celozávodní odstávky, noční rezervace) nebo je delší než jakékoli
  // provozní okno. Posun by ho vystěhoval do výroby, případně teleportoval
  // o týdny. Takový blok zůstává ZDÍ přesně jako před 31. 7. 2026.
  const nonConforming = new Set<number>();
  for (const r of rows) {
    if (r.type === "ZAKAZKA") continue;
    const mimoSmenu = blockOverlapsBlockedTimeWithTemplates(machine, r.startTime, r.endTime, weekShifts);
    const vOdstavce = companyDays.some((cd) => cd.start < r.endTime && cd.end > r.startTime);
    if (mimoSmenu || vOdstavce) nonConforming.add(r.id);
  }

  const others: BlockInterval[] = rows.map((r) => ({
    id: r.id,
    startTime: r.startTime,
    endTime: r.endTime,
    // Zeď = zámek, potvrzený tisk, sourozenec z téže dávky (frozenIds) nebo
    // rigidní blok mimo kalendář. Typ sám o sobě zdí není (rozhodnutí 31. 7. 2026).
    locked:
      r.locked || r.printCompletedAt != null || frozenIds.has(r.id) || nonConforming.has(r.id),
    ...chainPushGeometry(r),
  }));

  const rowById = new Map(rows.map((r) => [r.id, r]));

  const result = computeChainPush(machine, anchor, others, weekShifts, companyDays);
  if (!result.ok) {
    if (result.reason === "LOCKED_CONFLICT") {
      const l = rowById.get(result.lockedId);
      const num = `#${l?.orderNumber ?? result.lockedId}`;
      const noun = l?.type === "REZERVACE" ? "rezervací" : l?.type === "UDRZBA" ? "údržbou" : "zakázkou";
      const predlozka = noun === "zakázkou" ? "se" : "s";
      let duvod: string;
      if (l?.printCompletedAt != null) {
        duvod = `koliduje ${predlozka} ${noun} ${num}, která má potvrzený tisk`;
      } else if (result.unplaceable) {
        // Rigidní blok, pro který se v horizontu 7 dní nenašlo volné místo v kalendáři
        // (typicky za dlouhou celozávodní odstávkou) — chová se jako zeď, ale zamčený není.
        duvod = `koliduje ${predlozka} ${noun} ${num}, kterou není kam odsunout (v dosahu týdne není volné místo)`;
      } else if (l && !l.locked && nonConforming.has(l.id)) {
        // Blok leží mimo pracovní dobu nebo v odstávce — tam ho někdo umístil
        // vědomě, automaticky se neposouvá.
        duvod = `koliduje ${predlozka} ${noun} ${num} mimo pracovní dobu (posuň ji ručně)`;
      } else {
        duvod = `koliduje se zamčenou ${noun} ${num}`;
      }
      throw new AppError("OVERLAP", `Nelze uvolnit místo — ${duvod}. Vyber jiné místo.`);
    }
    const b = rowById.get(result.blockId);
    throw new AppError(
      "SCHEDULE_VIOLATION",
      `Auto-posun bloku #${b?.orderNumber ?? result.blockId} nenašel místo v kalendáři — uvolni místo ručně.`
    );
  }
  if (result.moves.length === 0) return [];

  // Strop kaskády — měří se na SPOČÍTANÝCH posunech, ještě než se cokoliv zapíše.
  // Výjimka odroluje celou transakci, takže se do DB nedostane ani jeden update.
  // skipCascadeCheck: volající (batch, hromadný přepočet stroje) kontroluje sám
  // nad součtem za celé gesto — per-volání kontrola tady by u prvního volání
  // vyhodila výjimku s číslem jen z něj, ne z celého dopadu gesta.
  if (opts.skipCascadeCheck !== true) {
    assertCascadeConfirmed(
      measureCascade(
        result.moves.map((m) => ({
          id: m.id,
          startTime: m.startTime,
          endTime: m.endTime,
          oldStartTime: rowById.get(m.id)!.startTime,
        })),
      ),
      { confirmed: opts.cascadeConfirmed === true, path: opts.path ?? "chain-push", machine, anchorId: anchor.id },
    );
  }

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
    // Geometrie MUSÍ být tatáž, jakou použil chain push (`chainPushGeometry`) —
    // jinak by pojistka hlásila drift na bloku, který sama umístila správně.
    const g = chainPushGeometry(r);
    if (g.rigid) {
      // Rigidní blok: kontroluje se zachovaná délka, pracovní doba a odstávka
      // (žádná re-expanze — rezervace se přes pauzy neroztahuje).
      const movedMinutes = (m.endTime.getTime() - m.startTime.getTime()) / 60000;
      const cdHit = companyDays.find((cd) => cd.start < m.endTime && cd.end > m.startTime);
      const outsideShift = blockOverlapsBlockedTimeWithTemplates(machine, m.startTime, m.endTime, weekShifts);
      if (movedMinutes !== g.printMinutes || cdHit || outsideShift) {
        throw new AppError(
          "SCHEDULE_VIOLATION",
          `Auto-posun bloku #${r.orderNumber ?? m.id} nesedí na kalendář — uvolni místo ručně.`
        );
      }
      continue;
    }
    const exp = expandPrintTime(machine, m.startTime, g.printMinutes, weekShifts, companyDays, g.scheduleBypassed);
    const cdHit = g.scheduleBypassed
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
      oldUpdatedAt: r.updatedAt,
      oldPrintMinutes: r.printMinutes,
      oldScheduleBypassed: r.scheduleBypassed,
    });
  }
  return applied;
}
