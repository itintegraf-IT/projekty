import { computePrintMinutes, isMachineRunnableAt, type CompanyDayInterval } from "./printTime";
import { SLOT_MS } from "./timeSlots";
import type { MachineWeekShiftsRow } from "./machineWeekShifts";

export type SplitPmResult =
  | { ok: true; headPm: number | null; tailPm: number | null }
  | { ok: false; reason: "IN_PAUSE" | "DEGENERATE" | "NOT_ALIGNED" };

/**
 * Spočítá head/tail tiskové minuty pro split ZAKAZKA bloku v čase `splitAt`.
 *
 * Čistá funkce (žádná DB) — testovatelná; serverový endpoint `/api/blocks/[id]/split`
 * ji volá s kalendářem z `loadMachineCalendar`. Extrahováno z původního klientského
 * `handleSplitBlockAt` (TimelineGrid), aby t/ logika žila na jednom místě a měla testy.
 *
 * Ne-ZAKAZKA → `{ ok:true, headPm:null, tailPm:null }` (blok se dělí kalendářním časem,
 * ne tiskovými minutami — pm se pro něj neukládá).
 *
 * `reason` při `ok:false`:
 *  - `IN_PAUSE`    — non-bypass `splitAt` nepadá na runnable slot (leží v pauze/odstávce).
 *  - `DEGENERATE`  — jedna část by neměla žádný tiskový čas (`headPm`/`tailPm` ≤ 0).
 *  - `NOT_ALIGNED` — `startTime`/`splitAt` nebo výsledné pm nejsou na 30min gridu
 *                    (legacy/bypass drift). Vrací se PŘED voláním `computePrintMinutes`,
 *                    které by jinak na nezarovnaném vstupu hodilo, i po výpočtu (pm % 30),
 *                    protože `validateAndComputeEnd` takové pm odmítá jako INVALID_INPUT.
 */
export function computeSplitPrintMinutes(args: {
  type: string;
  scheduleBypassed: boolean;
  machine: string;
  startTime: Date;
  splitAt: Date;
  totalPrintMinutes: number | null;
  weekShifts: MachineWeekShiftsRow[];
  companyDayIntervals: CompanyDayInterval[];
}): SplitPmResult {
  if (args.type !== "ZAKAZKA") return { ok: true, headPm: null, tailPm: null };

  const total = args.totalPrintMinutes ?? 0;
  let headPm: number;

  if (args.scheduleBypassed) {
    // Bypass blok byl umístěn vědomě MIMO kalendář → elapsed-based dělení
    // (computePrintMinutes není bypass-aware a runnable guard by na jeho vlastním
    // rozsahu skoro vždy padal). Head/tail se serverově validují bypass větví.
    headPm = Math.round((args.splitAt.getTime() - args.startTime.getTime()) / 60000);
  } else {
    // computePrintMinutes HÁŽE na nezarovnaném start/end → zkontrolovat 30min grid předem
    // a vrátit doménovou hlášku místo výjimky (legacy/drift blok s nezarovnaným startem).
    if (args.startTime.getTime() % SLOT_MS !== 0 || args.splitAt.getTime() % SLOT_MS !== 0) {
      return { ok: false, reason: "NOT_ALIGNED" };
    }
    // splitAt musí padnout na tiskovou (runnable) část kalendáře — jinak by tail startoval
    // v pauze a server by ho odmítl (START_NOT_RUNNABLE) až po zkrácení hlavy.
    if (!isMachineRunnableAt(args.machine, args.splitAt, args.weekShifts, args.companyDayIntervals)) {
      return { ok: false, reason: "IN_PAUSE" };
    }
    headPm = computePrintMinutes(
      args.machine,
      args.startTime,
      args.splitAt,
      args.weekShifts,
      args.companyDayIntervals
    );
  }

  const tailPm = total - headPm;
  if (headPm <= 0 || tailPm <= 0) return { ok: false, reason: "DEGENERATE" };
  // validateAndComputeEnd odmítá printMinutes % 30 !== 0 (INVALID_INPUT 422); u bypass
  // bloku s nezarovnaným startem by headPm mohl vyjít jako nenásobek 30 → doménová hláška.
  if (headPm % 30 !== 0 || tailPm % 30 !== 0) return { ok: false, reason: "NOT_ALIGNED" };
  return { ok: true, headPm, tailPm };
}
