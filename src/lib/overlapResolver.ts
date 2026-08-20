import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import {
  expandPrintTime,
  snapStartToNextRunnableSlot,
  violatesMinPrintSegment,
  MIN_PRINT_SEGMENT_MINUTES,
  SLOT_MS,
  type CompanyDayInterval,
} from "@/lib/printTime";
import {
  snapToNextValidStartWithTemplates,
  blockOverlapsBlockedTimeWithTemplates,
} from "@/lib/workingTime";

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
  /**
   * Rigidní blok (REZERVACE / UDRZBA): posouvá se jako PEVNÝ interval — přesná délka
   * (žádné zaokrouhlení na 30 min, žádné roztažení přes pauzy směn), ale celý se musí
   * vejít do pracovní doby stroje. Odpovídá tomu, co dělá ruční přetažení na klientovi
   * (`snapToNextValidStartWithTemplates`), takže chain push dá stejný výsledek jako myš.
   */
  rigid?: boolean;
  /**
   * Strop dopředného posunu (ms) pro TISKOVOU geometrii — REZERVACE si i po
   * překlopení na tiskové hodiny drží 7denní horizont (rozhodnutí #1 specu
   * etapy 9, 20. 8. 2026): bezhorizontový chain push je otevřený dluh P31
   * a nekopíruje se na druhý typ. Měří se od kurzoru pushe (`fromMs`) na
   * snapnutý START — expanze smí končit i za horizontem. Neumístitelný blok
   * se degraduje na zeď (RIGID_UNPLACEABLE), stejně jako rigidní blok.
   * undefined = bez stropu (ZAKAZKA). U `rigid: true` se ignoruje —
   * placeRigidAfter má vlastní MAX_RIGID_PUSH_MS.
   */
  maxPushMs?: number;
};

/**
 * Maximální vzdálenost, o kterou chain push odsune RIGIDNÍ blok (rezervace/údržba).
 * Odpovídá `MAX_AUTO_SHIFT_MS` u zakázek — dál už to není „udělání místa",
 * ale teleport, který uživatel nečeká.
 */
export const MAX_RIGID_PUSH_MS = 7 * 24 * 60 * 60 * 1000;

/** Navržený posun jednoho bloku. */
export type ChainMove = { id: number; startTime: Date; endTime: Date };

export type ChainPushResult =
  | { ok: true; moves: ChainMove[] }
  | { ok: false; reason: "LOCKED_CONFLICT"; lockedId: number; unplaceable?: boolean }
  | { ok: false; reason: "PLACEMENT_FAILED"; blockId: number };

/** Interní výsledek jednoho průchodu — navíc rozlišuje neumístitelný rigidní blok. */
type ChainPushAttempt = ChainPushResult | { ok: false; reason: "RIGID_UNPLACEABLE"; blockId: number };

/**
 * Kolik rigidních bloků smí jeden chain push degradovat na zeď, než to vzdá.
 * Každé opakování zafixuje právě jeden blok, takže strop = max. počet rigidních
 * bloků v jedné kaskádě. V praxi jednotky, 20 je bezpečná rezerva proti smyčce.
 */
const MAX_IMMOVABLE_RETRIES = 20;

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
 * - Rigidní blok, pro který se v horizontu `MAX_RIGID_PUSH_MS` nenajde místo
 *   (typicky za víc než týden dlouhou celozávodní odstávkou), se NEshazuje celou
 *   operací — degraduje se na zeď a kaskáda pokračuje kolem něj. To je přesně
 *   chování, jaké měly rezervace a údržba před 31. 7. 2026; bez toho by drop,
 *   který dnes projde, po zavedení rigidní geometrie skončil na 422.
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
  // Rigidní bloky, které se v horizontu nikam nevejdou → zeď. Zjistí se až pokusem
  // o umístění, takže se průchod opakuje s postupně rostoucí množinou.
  const immovable = new Set<number>();
  let lastUnplaceable = -1;
  for (let attempt = 0; attempt <= MAX_IMMOVABLE_RETRIES; attempt++) {
    const result = computeChainPushAttempt(machine, anchor, others, weekShifts, companyDays, immovable);
    if (result.ok || result.reason !== "RIGID_UNPLACEABLE") return result;
    lastUnplaceable = result.blockId;
    immovable.add(result.blockId);
  }
  return { ok: false, reason: "PLACEMENT_FAILED", blockId: lastUnplaceable };
}

function computeChainPushAttempt(
  machine: string,
  anchor: { id: number; startTime: Date; endTime: Date },
  others: BlockInterval[],
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[],
  immovable: ReadonlySet<number>
): ChainPushAttempt {
  const sorted = others
    .filter((b) => b.id !== anchor.id)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  // Neposunutelný = zamčený NEBO rigidní blok, pro který se v horizontu nenašlo místo.
  const isImmovable = (b: BlockInterval) => b.locked || immovable.has(b.id);
  const locked = sorted.filter(isImmovable);
  const anchorStart = anchor.startTime.getTime();

  const anchorHit = locked.find(
    (l) => l.startTime.getTime() < anchor.endTime.getTime() && l.endTime.getTime() > anchorStart
  );
  if (anchorHit) {
    return {
      ok: false,
      reason: "LOCKED_CONFLICT",
      lockedId: anchorHit.id,
      // Zeď kvůli horizontu, ne kvůli zámku — volající to hlásí jinou hláškou.
      ...(!anchorHit.locked && immovable.has(anchorHit.id) ? { unplaceable: true } : {}),
    };
  }

  const moves: ChainMove[] = [];
  const placed = new Set<number>();
  let pEnd = anchor.endTime.getTime();

  for (let i = 0; i < 500; i++) {
    const next = sorted.find(
      (b) => !placed.has(b.id) && b.startTime.getTime() < pEnd && b.endTime.getTime() > anchorStart
    );
    if (!next) break;
    placed.add(next.id);

    if (isImmovable(next)) {
      // Zamčený (nebo v horizontu neumístitelný) blok nelze posunout — kurzor za jeho konec.
      pEnd = Math.max(pEnd, next.endTime.getTime());
      continue;
    }

    // Legacy fallback (printMinutes == null): odvození ze spanu MUSÍ být zarovnané na 30min grid
    // (vzor blockPrintMinutes), jinak by nezarovnaný pm dal expandPrintTime nezarovnaný start/end.
    const pm =
      next.printMinutes ??
      Math.max(30, Math.round((next.endTime.getTime() - next.startTime.getTime()) / 60000 / 30) * 30);
    if (!Number.isFinite(pm) || pm <= 0) {
      return { ok: false, reason: "PLACEMENT_FAILED", blockId: next.id };
    }

    // Rigidní blok (rezervace/údržba) má vlastní umístění — pevná délka do pracovní doby.
    // Pravidlo minimálního segmentu se ho netýká (nedělí se na tiskové úseky).
    const pos = next.rigid
      ? placeRigidAfter(machine, pEnd, pm, locked, weekShifts, companyDays)
      : placeAfter(machine, pEnd, pm, next.scheduleBypassed, locked, weekShifts, companyDays, MIN_PRINT_SEGMENT_MINUTES, next.maxPushMs) ??
        placeAfter(machine, pEnd, pm, next.scheduleBypassed, locked, weekShifts, companyDays, 0, next.maxPushMs);
    if (!pos) {
      // Rigidní blok NEBO tisková rezervace se stropem (maxPushMs), která se
      // v horizontu nikam nevejde → volající ji zafixuje jako zeď a spustí průchod
      // znovu. Zakázka horizont nemá, u ní je to skutečné selhání (dluh P31,
      // vědomě neřešeno v této vlně).
      if (next.rigid || next.maxPushMs != null) return { ok: false, reason: "RIGID_UNPLACEABLE", blockId: next.id };
      return { ok: false, reason: "PLACEMENT_FAILED", blockId: next.id };
    }

    moves.push({ id: next.id, startTime: pos.start, endTime: pos.end });
    pEnd = pos.end.getTime();
  }

  return { ok: true, moves };
}

/**
 * Umístění RIGIDNÍHO bloku (rezervace / údržba): pevná délka, celý se musí vejít
 * do pracovní doby stroje, nesmí zasáhnout firemní odstávku ani zamčený blok.
 *
 * Na rozdíl od tiskových bloků se NEre-expanduje přes pauzy (rezervace o 45 minutách
 * zůstane 45 minut) a nezaokrouhluje se na 30min mřížku délky. Používá stejný
 * `snapToNextValidStartWithTemplates` jako ruční přetažení na klientovi, takže
 * odsunutý blok skončí přesně tam, kam by ho uživatel položil myší.
 */
function placeRigidAfter(
  machine: string,
  fromMs: number,
  durationMinutes: number,
  locked: BlockInterval[],
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[]
): { start: Date; end: Date } | null {
  const durationMs = durationMinutes * 60000;
  // Horizont posunu: bez něj by se blok, který se do žádného okna nevejde,
  // posouval dál a dál, až by dorazil do týdne bez rozvrhu (tam hardcoded
  // fallback tvrdí nonstop provoz) a teleportoval se o týdny — a s ním celá
  // kaskáda. Volající si neumístitelný blok ošetří jako zeď.
  const horizonMs = fromMs + MAX_RIGID_PUSH_MS;
  let cursorMs = Math.ceil(fromMs / SLOT_MS) * SLOT_MS;

  for (let g = 0; g < 100; g++) {
    if (cursorMs > horizonMs) return null;
    const snapped = snapToNextValidStartWithTemplates(machine, new Date(cursorMs), durationMs, weekShifts);
    const startMs = snapped.getTime();
    const endMs = startMs + durationMs;

    // Helper má vlastní strop iterací a při neúspěchu vrací vstup beze změny —
    // ověřit, že navržené okno opravdu celé leží v pracovní době.
    if (blockOverlapsBlockedTimeWithTemplates(machine, snapped, new Date(endMs), weekShifts)) {
      cursorMs = startMs + SLOT_MS;
      continue;
    }
    const cdHit = companyDays.find((cd) => cd.start.getTime() < endMs && cd.end.getTime() > startMs);
    if (cdHit) {
      cursorMs = Math.ceil(cdHit.end.getTime() / SLOT_MS) * SLOT_MS;
      continue;
    }
    const lockHit = locked.find((l) => l.startTime.getTime() < endMs && l.endTime.getTime() > startMs);
    if (lockHit) {
      cursorMs = Math.ceil(lockHit.endTime.getTime() / SLOT_MS) * SLOT_MS;
      continue;
    }
    if (endMs > horizonMs) return null;
    return { start: snapped, end: new Date(endMs) };
  }
  return null;
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
  companyDays: CompanyDayInterval[],
  minSegmentMinutes: number,
  maxPushMs?: number
): { start: Date; end: Date } | null {
  // Horizont startu (rozhodnutí #1): tisková REZERVACE nesmí být teleportována
  // dál než maxPushMs od kurzoru. Kontroluje se START (kurzor i snap), ne end —
  // expanze přes pauzy smí přesáhnout.
  const horizonMs = maxPushMs != null ? fromMs + maxPushMs : Infinity;
  let cursorMs = Math.ceil(fromMs / SLOT_MS) * SLOT_MS;

  for (let g = 0; g < 100; g++) {
    if (cursorMs > horizonMs) return null;
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
    if (snapped.getTime() > horizonMs) return null;
    const exp = expandPrintTime(machine, snapped, printMinutes, weekShifts, companyDays, false);
    if (!exp.ok) return null;
    if (violatesMinPrintSegment(exp.segments, minSegmentMinutes)) {
      // Kus pod minimem → blok se nedělí, přeskoč na konec první pauzy (celý za odstávku).
      const firstPause = exp.segments.find((s) => s.kind === "pause")!;
      cursorMs = Math.ceil(firstPause.end.getTime() / SLOT_MS) * SLOT_MS;
      continue;
    }
    const lockHit = locked.find(
      (l) => l.startTime.getTime() < exp.end.getTime() && l.endTime.getTime() > snapped.getTime()
    );
    if (!lockHit) return { start: snapped, end: exp.end };
    cursorMs = Math.ceil(lockHit.endTime.getTime() / SLOT_MS) * SLOT_MS;
  }
  return null;
}
