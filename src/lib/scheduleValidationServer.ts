import { expandPrintTime, MAX_PRINT_MINUTES, SLOT_MS } from "@/lib/printTime";
import {
  expandPrintTimeFromDb,
  loadMachineCalendar,
  type PrismaClientLike,
} from "@/lib/printTime.server";

export type ScheduleValidationResult =
  | { ok: true; end: Date; effectivelyBypassed: boolean }
  | { ok: false; error: string; kind: "INVALID_INPUT" | "PLACEMENT" };

/**
 * Serverová validace harmonogramu — nový model „tiskových hodin".
 *
 * ZAKAZKA bez bypass: start musí ležet na aktivním slotu, end se POČÍTÁ
 * (expandPrintTime přes weekShifts + companyDays — odstávky se překlenou pauzou).
 * ZAKAZKA s bypass: end = start + printMinutes (bez pauz); CompanyDay zůstává
 * tvrdý zákaz (mimořádná směna nesmí kolidovat s celofiremní odstávkou).
 * Ne-ZAKAZKA: bez validace, end = fallbackEnd (dnešní chování).
 *
 * `effectivelyBypassed` = SPOČÍTANÁ pravda, ne echo request flagu: true jen když
 * výsledné umístění reálně NEkonformuje kalendáři (bypass požadavek na místě, které
 * kalendáři sedí, vrací false). Write cesty MUSÍ ukládat tuto hodnotu do
 * `scheduleBypassed`, nikdy surový bypass flag z requestu.
 *
 * `kind` u ok:false: INVALID_INPUT = vadný vstup (printMinutes null/≤0/%30/>limit,
 * nezarovnaný start) — auto-shift NESMÍ takovou chybu maskovat; PLACEMENT = validní
 * vstup na špatném místě (mimo provoz / odstávka / horizont) — auto-shift povolen.
 *
 * Jediný zdroj pravdy pro endTime — každá write cesta (POST/PUT/batch) MUSÍ
 * ukládat end vrácený touto funkcí, nikdy end z klienta.
 */
export async function validateAndComputeEnd(
  db: PrismaClientLike,
  machine: string,
  startTime: Date,
  printMinutes: number | null,
  fallbackEnd: Date,
  blockType: string,
  bypass: boolean
): Promise<ScheduleValidationResult> {
  if (blockType !== "ZAKAZKA") return { ok: true, end: fallbackEnd, effectivelyBypassed: false };

  if (printMinutes == null || !Number.isFinite(printMinutes) || printMinutes <= 0) {
    return { ok: false, error: "Chybí platná délka tisku (printMinutes).", kind: "INVALID_INPUT" };
  }
  if (printMinutes % 30 !== 0) {
    return { ok: false, error: "Délka tisku musí být násobek 30 minut.", kind: "INVALID_INPUT" };
  }
  if (printMinutes > MAX_PRINT_MINUTES) {
    return {
      ok: false,
      error: `Délka tisku přesahuje limit 40 hodin (${MAX_PRINT_MINUTES / 60} h).`,
      kind: "INVALID_INPUT",
    };
  }
  if (startTime.getTime() % SLOT_MS !== 0) {
    return { ok: false, error: "Začátek bloku musí ležet na 30minutové hranici.", kind: "INVALID_INPUT" };
  }

  if (bypass) {
    const end = new Date(startTime.getTime() + printMinutes * 60000);
    // CompanyDay tvrdý zákaz i při bypassu (dnešní sémantika zachována).
    const cal = await loadMachineCalendar(db, machine, startTime);
    const cd = cal.companyDays.find((c) => c.start < end && c.end > startTime);
    if (cd) return { ok: false, error: "Blok zasahuje do plánované odstávky.", kind: "PLACEMENT" };
    // Konformita s kalendářem (spočítaná pravda pro scheduleBypassed): pokud by
    // non-bypass expanze dala stejný end, blok kalendáři sedí → effectivelyBypassed false.
    // Kalendář už máme načtený (CD check) — žádný dotaz navíc.
    const conf = expandPrintTime(machine, startTime, printMinutes, cal.weekShifts, cal.companyDays, false);
    const conforms = conf.ok && conf.end.getTime() === end.getTime();
    return { ok: true, end, effectivelyBypassed: !conforms };
  }

  const r = await expandPrintTimeFromDb(db, machine, startTime, printMinutes, false);
  if (!r.ok) {
    return r.reason === "START_NOT_RUNNABLE"
      ? { ok: false, error: "Začátek bloku leží mimo provoz stroje.", kind: "PLACEMENT" }
      : { ok: false, error: "V horizontu 21 dní není dost pracovní doby pro tento blok.", kind: "PLACEMENT" };
  }
  return { ok: true, end: r.end, effectivelyBypassed: false };
}
