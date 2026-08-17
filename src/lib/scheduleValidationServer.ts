import { expandPrintTime, MAX_PRINT_MINUTES, SLOT_MS } from "@/lib/printTime";
import {
  expandPrintTimeFromDb,
  loadMachineCalendar,
  type PrismaClientLike,
} from "@/lib/printTime.server";

/** Uložený stav bloku v rozsahu, který rozhoduje o přepočtu harmonogramu. */
export type ScheduleRelevantBlock = {
  type: string;
  machine: string;
  startTime: Date;
  endTime: Date;
  printMinutes: number | null;
};

/**
 * Liší se čas poslaný v requestu od uloženého? Porovnává se přes `getTime()`,
 * ne přes shodu řetězců — klient posílá ISO string, v DB je `Date`.
 *
 * Nečitelná hodnota (`NaN`) vrací `true` ZÁMĚRNĚ: hodnota je přítomná, jen vadná,
 * takže má dotéct do validační cesty, která na ni vyrobí srozumitelnou chybu.
 * Tiché `false` by vadný vstup spolklo.
 */
function scheduleTimeChanged(requested: unknown, current: Date): boolean {
  const parsed = requested instanceof Date ? requested : new Date(requested as string);
  const t = parsed.getTime();
  if (Number.isNaN(t)) return true;
  return t !== current.getTime();
}

/**
 * Má se harmonogram bloku vůbec přepočítávat?
 *
 * Čistá funkce — žádné DB volání. Vrací `true`, právě když se v požadavku mění
 * aspoň jedna z veličin, ze kterých se harmonogram počítá: typ, stroj, začátek,
 * konec, tisková délka. Klíč, který v requestu NENÍ, znamená „neměň" (`BlockEdit`
 * od etapy 2 u textové editace zakázky `printMinutes` neposílá vůbec).
 *
 * PROČ: `PUT /api/blocks/[id]` dřív přepočítával harmonogram při KAŽDÉM uložení
 * z editačního panelu (`buildPayload()` posílá `type` vždycky). U bloku, který se
 * mezitím rozešel s kalendářem (úprava směn, nová odstávka), se tak konec bloku
 * tiše přepsal spočítanou hodnotou a `resolveChain` za ním odsunul navazující
 * zakázky — automatika bez vědomí plánovače, kterou `CLAUDE.md` zakazuje.
 *
 * DŮSLEDEK (záměrný): blok rozejitý s kalendářem se při editaci textu sám
 * NEspraví — od toho je adresné tlačítko „Přepočítat" v detailu bloku. Stejně tak
 * legacy blok bez `printMinutes` už uložením popisu tiše nezíská tiskovou délku
 * odvozenou ze spanu.
 */
export function shouldRecomputeSchedule(
  old: ScheduleRelevantBlock,
  request: Record<string, unknown>
): boolean {
  if (request.type !== undefined && request.type !== old.type) return true;
  if (request.machine !== undefined && request.machine !== old.machine) return true;
  if (request.startTime !== undefined && scheduleTimeChanged(request.startTime, old.startTime)) return true;
  if (request.endTime !== undefined && scheduleTimeChanged(request.endTime, old.endTime)) return true;
  // `old.printMinutes === null` (legacy blok před modelem tiskových hodin) + číslo
  // v requestu je změna. Jiný než číselný typ se ignoruje — stejně jako ho ignoruje
  // samotná write cesta (`typeof allowedPrintMinutes === "number"`).
  if (typeof request.printMinutes === "number" && request.printMinutes !== old.printMinutes) return true;
  return false;
}

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
