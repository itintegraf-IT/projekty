import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { isBlockedSlotDynamic } from "@/lib/workingTime";
import { SLOT_MS } from "@/lib/timeSlots";

export { SLOT_MS };
/** Max tiskové minuty jednoho bloku (40 h) — vynucuje se od etapy 3 serverově. */
export const MAX_PRINT_MINUTES = 2400;
/** Tvrdý strop kalendářního rozsahu expanze — ochrana před nekonečnou smyčkou. */
export const MAX_SPAN_DAYS = 21;

export type CompanyDayInterval = { start: Date; end: Date };
export type PrintSegment = { start: Date; end: Date; kind: "print" | "pause" };
export type ExpandResult =
  | { ok: true; end: Date; segments: PrintSegment[] }
  | { ok: false; reason: "START_NOT_RUNNABLE" | "HORIZON_EXCEEDED" };

/**
 * Jednotný predikát pracovního času: stroj v daném 30min slotu reálně jede
 * = aktivní směna (MachineWeekShifts / hardcoded fallback) a žádná firemní odstávka.
 * Jediné místo, které smí kombinovat weekShifts + companyDays.
 *
 * Precondition: weekShifts musí pokrývat všechny týdny [start, start + MAX_SPAN_DAYS];
 * týden bez řádků tiše spadne na hardcoded fallback rozvrh (isHardcodedBlocked) —
 * volající odpovídá za kompletní fetch.
 */
export function isMachineRunnableAt(
  machine: string,
  slotStart: Date,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[]
): boolean {
  const t = slotStart.getTime();
  for (const cd of companyDays) {
    if (cd.start.getTime() <= t && t < cd.end.getTime()) return false;
  }
  return !isBlockedSlotDynamic(machine, slotStart, weekShifts);
}

/**
 * Rozloží tiskové minuty od `start` přes pracovní kalendář stroje.
 * Vrací kalendářní konec + segmenty (print/pause) pro vykreslení.
 *
 * Invarianty: první i poslední segment je "print" (start musí ležet na runnable
 * slotu — jinak START_NOT_RUNNABLE; end je konec posledního tiskového slotu).
 * `bypass=true` = blok vědomě mimo kalendář → žádné pauzy, end = start + printMinutes.
 * printMinutes = reálné (elapsed) minuty — DST-safe díky 30min UTC krokům.
 *
 * Precondition: weekShifts musí pokrývat všechny týdny [start, start + MAX_SPAN_DAYS];
 * týden bez řádků tiše spadne na hardcoded fallback rozvrh (isHardcodedBlocked) —
 * volající odpovídá za kompletní fetch.
 */
export function expandPrintTime(
  machine: string,
  start: Date,
  printMinutes: number,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[],
  bypass = false
): ExpandResult {
  if (!Number.isFinite(printMinutes) || printMinutes <= 0) {
    throw new Error("[printTime] printMinutes musí být kladné číslo");
  }
  if (start.getTime() % SLOT_MS !== 0) {
    throw new Error("[printTime] start musí ležet na 30min hranici (slot grid)");
  }
  if (bypass) {
    const end = new Date(start.getTime() + printMinutes * 60000);
    return { ok: true, end, segments: [{ start, end, kind: "print" }] };
  }
  if (!isMachineRunnableAt(machine, start, weekShifts, companyDays)) {
    return { ok: false, reason: "START_NOT_RUNNABLE" };
  }

  const limitMs = start.getTime() + MAX_SPAN_DAYS * 24 * 60 * 60 * 1000;
  const segments: PrintSegment[] = [];
  let remainingMin = printMinutes;
  let cur = start;
  let segStart = start;
  let segKind: "print" | "pause" = "print";
  let end: Date | null = null;

  while (remainingMin > 0) {
    if (cur.getTime() >= limitMs) return { ok: false, reason: "HORIZON_EXCEEDED" };
    const runnable = isMachineRunnableAt(machine, cur, weekShifts, companyDays);
    const kind: "print" | "pause" = runnable ? "print" : "pause";
    if (kind !== segKind) {
      segments.push({ start: segStart, end: cur, kind: segKind });
      segStart = cur;
      segKind = kind;
    }
    if (runnable) {
      const consumed = Math.min(30, remainingMin);
      remainingMin -= consumed;
      if (remainingMin === 0) {
        end = new Date(cur.getTime() + consumed * 60000);
        break;
      }
    }
    cur = new Date(cur.getTime() + SLOT_MS);
  }

  // break nastal na runnable slotu → poslední segment je vždy "print"
  segments.push({ start: segStart, end: end as Date, kind: "print" });
  return { ok: true, end: end as Date, segments };
}

/**
 * Inverze expandPrintTime: kolik tiskových minut leží v [start, end).
 * End uvnitř pauzy je nejednoznačný (celá pauza mapuje na stejnou hodnotu) —
 * normalizaci endu na hranu segmentu řeší volající (resize snap).
 *
 * Není bypass-aware — pro bloky se scheduleBypassed=true použij prostý elapsed
 * (end−start), jinak vrátí méně minut. Pro end < start vrací 0 (prázdný interval [start,end)).
 * Walk je zastropovaný MAX_SPAN_DAYS — minuty za horizontem se nezapočítají
 * (defenzivní ochrana proti absurdnímu end z klienta).
 */
export function computePrintMinutes(
  machine: string,
  start: Date,
  end: Date,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[]
): number {
  if (start.getTime() % SLOT_MS !== 0) {
    throw new Error("[printTime] start musí ležet na 30min hranici (slot grid)");
  }
  if (end.getTime() % SLOT_MS !== 0) {
    throw new Error("[printTime] end musí ležet na 30min hranici (slot grid)");
  }
  const limitMs = start.getTime() + MAX_SPAN_DAYS * 24 * 60 * 60 * 1000;
  let minutes = 0;
  let cur = start;
  while (cur.getTime() < Math.min(end.getTime(), limitMs)) {
    if (isMachineRunnableAt(machine, cur, weekShifts, companyDays)) {
      const slotEndMs = Math.min(cur.getTime() + SLOT_MS, end.getTime());
      minutes += Math.round((slotEndMs - cur.getTime()) / 60000);
    }
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return minutes;
}

/** Minimální délka jednoho tiskového kusu při rozdělení bloku pauzou (rozhodnutí 2. 7. 2026). */
export const MIN_PRINT_SEGMENT_MINUTES = 60;

/**
 * Používá blok model tiskových hodin (printMinutes + expanze přes pauzy směn)?
 * JEDINÝ zdroj pravdy pro server (validace, chain push geometrie, drift, reflow)
 * i klienta (snapy, payloady, kreslení) — etapa 9, „Rezervace dostanou plné
 * tiskové hodiny".
 *
 * - ZAKAZKA: vždy. pm = null (legacy) řeší fallbacky volajících — beze změny
 *   proti stavu před etapou 9.
 * - REZERVACE: jen s platnými printMinutes. Legacy rezervace, kterou backfill
 *   přeskočil (nezarovnaný start/end), zůstává RIGIDNÍ — „funguje jako dnes,
 *   dokud se ručně neopraví" (spec §3 krok 2).
 * - UDRZBA: nikdy — zůstává rigidní beze změny (rozhodnutí Vojty 19. 8. 2026).
 *
 * Poučení P17: volající NESMÍ tuhle trojcestnou klasifikaci opisovat inline
 * dichotomií `type === "ZAKAZKA"` — projet celý obor hodnot umí jen jedno místo.
 */
export function usesTiskoveHodiny(b: { type: string; printMinutes?: number | null }): boolean {
  if (b.type === "ZAKAZKA") return true;
  if (b.type === "REZERVACE") return b.printMinutes != null && Number.isFinite(b.printMinutes) && b.printMinutes > 0;
  return false;
}

/**
 * Varianta pro NOVÉ payloady (builder, fronta, série), kde žádný uložený záznam
 * neexistuje: nový blok tiskového typu dostává printMinutes VŽDY, rozhoduje jen
 * typ. Pro EXISTUJÍCÍ bloky vždy `usesTiskoveHodiny` — legacy rezervace bez
 * printMinutes musí zůstat rigidní.
 */
export function typeUsesTiskoveHodiny(type: string): boolean {
  return type === "ZAKAZKA" || type === "REZERVACE";
}

/**
 * True, když expanze obsahuje pauzu A některý tiskový segment je kratší než minimum.
 * Souvislá expanze (bez pauzy) neporušuje nikdy — pravidlo krotí jen dělení bloku.
 * Vynucuje se VÝHRADNĚ v automatice (chain push, auto-shift); ruční umístění
 * plánovačem pravidlu nepodléhá (validateAndComputeEnd helper nevolá).
 */
export function violatesMinPrintSegment(
  segments: PrintSegment[],
  minMinutes: number = MIN_PRINT_SEGMENT_MINUTES
): boolean {
  if (!segments.some((s) => s.kind === "pause")) return false;
  return segments.some(
    (s) => s.kind === "print" && s.end.getTime() - s.start.getTime() < minMinutes * 60000
  );
}

/**
 * Posune start na nejbližší runnable 30min slot (weekShifts + companyDays přes
 * isMachineRunnableAt). Start-only náhrada duration-based snapu
 * (snapToNextValidStartWithTemplates): blok se položí na první aktivní slot
 * a délka se rozloží expanzí — blok delší než související okno se už neteleportuje.
 *
 * Nezarovnaný `proposed` se zarovná NAHORU na slot grid. Vrací null, když
 * v [proposed, limitMs] žádný runnable slot není (default limit = MAX_SPAN_DAYS).
 *
 * Precondition (jako expandPrintTime): weekShifts musí pokrývat všechny týdny
 * prohledávaného okna — volající odpovídá za kompletní fetch.
 */
export function snapStartToNextRunnableSlot(
  machine: string,
  proposed: Date,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[],
  limitMs: number = proposed.getTime() + MAX_SPAN_DAYS * 24 * 60 * 60 * 1000
): Date | null {
  let t = Math.ceil(proposed.getTime() / SLOT_MS) * SLOT_MS;
  while (t <= limitMs) {
    const slot = new Date(t);
    if (isMachineRunnableAt(machine, slot, weekShifts, companyDays)) return slot;
    t += SLOT_MS;
  }
  return null;
}
