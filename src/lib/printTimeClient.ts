import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import {
  expandPrintTime,
  snapStartToNextRunnableSlot,
  SLOT_MS,
  usesTiskoveHodiny,
  type CompanyDayInterval,
  type ExpandResult,
  type PrintSegment,
} from "@/lib/printTime";
import { snapToNextValidStartWithTemplates } from "@/lib/workingTime";

/**
 * Klient-safe helpery modelu tiskových hodin (žádná DB, žádný server import).
 * Mutační cesty klienta jimi připravují payload — end vždy autoritativně počítá server.
 */

export type CompanyDayClientRow = { machine?: string | null; startDate: string | Date; endDate: string | Date };
export type { PrintSegment };

/**
 * Délka bloku v minutách pro payload: ZAKAZKA a REZERVACE s printMinutes = printMinutes
 * (fallback elapsed zarovnaný na 30min grid jen u legacy ZAKAZKA), UDRZBA a legacy REZERVACE = elapsed.
 */
export function blockPrintMinutes(b: {
  type: string;
  printMinutes?: number | null;
  startTime: string | Date;
  endTime: string | Date;
}): number {
  const elapsed = Math.round(
    (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 60000
  );
  // UDRZBA a legacy REZERVACE (bez pm) = elapsed; ZAKAZKA a tisková REZERVACE = printMinutes.
  // Zaokrouhlený fallback se týká jen legacy ZAKAZKA (usesTiskoveHodiny pro ni vrací true i s pm=null).
  if (!usesTiskoveHodiny(b)) return elapsed;
  return b.printMinutes ?? Math.max(30, Math.round(elapsed / 30) * 30);
}

/**
 * Součet tiskových minut všech členů split skupiny (bod 18 auditu plánovače).
 * siblings = všechny bloky skupiny včetně bloku samotného. Deleguje na
 * blockPrintMinutes — ZAKAZKA bere printMinutes (fallback elapsed), jinak elapsed.
 */
export function splitGroupTotalPrintMinutes(
  siblings: { type: string; printMinutes?: number | null; startTime: string | Date; endTime: string | Date }[]
): number {
  return siblings.reduce((sum, b) => sum + blockPrintMinutes(b), 0);
}

/** „27h" / „27,5h" — krátký formát hodin pro chip a detail split skupiny.
 *  NaN/nekonečno/nekladné hodnoty (rozbitá data, legacy bloky) → „0h" místo „NaNh". */
export function formatPrintHoursShort(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0h";
  const h = minutes / 60;
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1).replace(".", ",")}h`;
}

/** Převod klientských CompanyDay záznamů na intervaly pro daný stroj (global + machine-specific). */
export function companyDayIntervalsFor(
  machine: string,
  companyDays: { machine?: string | null; startDate: string | Date; endDate: string | Date }[]
): CompanyDayInterval[] {
  return companyDays
    .filter((cd) => !cd.machine || cd.machine === machine)
    .map((cd) => ({ start: new Date(cd.startDate), end: new Date(cd.endDate) }));
}

export type GroupSnapBlock = {
  id: number;
  machine: string;
  type: string;
  originalStart: Date;
  originalEnd: Date;
  printMinutes?: number | null;
  scheduleBypassed?: boolean | null;
};

export type GroupSnapResult = { id: number; start: Date; end: Date };

/**
 * Per-blok snap skupinového (lasso) přesunu se zachováním pořadí — nahrazuje
 * sdílenou deltu (`snapGroupDeltaStartOnly`), která byla "rohatka" umějící
 * korigovat jen dopředu (audit 12. 8. bod 1, plán etapy 3).
 *
 * Bloky se zpracují SEŘAZENÉ dle originalStart, v JEDNOM průchodu (žádná
 * vnější iterace jako stará 5pokusová konvergence — ta u nekonvergujícího
 * vstupu vracela nediagnostické 422). První blok se snapne z `start + delta`;
 * každý další nesmí začít dřív, než tiskově končí předchůdce (`prevEnd`) —
 * proto se v tom případě znovu snapne, tentokrát OD `prevEnd`.
 *
 * Per-blok dispatch podle GEOMETRIE (usesTiskoveHodiny): ZAKAZKA a REZERVACE
 * s printMinutes = start-only snap + expandPrintTime; UDRZBA a legacy
 * REZERVACE bez printMinutes = rigidní snap se ZACHOVANOU přesnou délkou.
 * `scheduleBypassed` členy se posouvají DOSLOVNĚ o `proposedDeltaMs` — nesmí se re-expandovat (server
 * má na bypass sticky-OR, viz batch/route.ts) ani navazovat na řetěz.
 *
 * Vrací `null`, když některý ne-bypass ZAKAZKA blok nejde v horizontu umístit —
 * volající mutaci neodešle (analogie dnešního "V okolí není žádný pracovní
 * slot"). Rigidní snap (REZERVACE/UDRZBA) po 20 iteracích vrátí i nevalidní
 * start a nezná companyDays — `null` z něj tedy nevzejde (pre-existing
 * sémantika sdílená s ručním dragem, `snapToNextValidStartWithTemplates`,
 * i serverovým `chainPushGeometry`). `wasSnapped` signalizuje UI, že se
 * něco reálně přeplánovalo.
 */
export function snapGroupPerBlock(
  blocks: GroupSnapBlock[],
  proposedDeltaMs: number,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: Parameters<typeof companyDayIntervalsFor>[1]
): { results: GroupSnapResult[]; wasSnapped: boolean } | null {
  const sorted = [...blocks].sort((a, b) => a.originalStart.getTime() - b.originalStart.getTime());
  const intervalsByMachine = new Map<string, ReturnType<typeof companyDayIntervalsFor>>();
  const intervalsFor = (m: string) => {
    if (!intervalsByMachine.has(m)) intervalsByMachine.set(m, companyDayIntervalsFor(m, companyDays));
    return intervalsByMachine.get(m)!;
  };

  const results: GroupSnapResult[] = [];
  let wasSnapped = false;
  let prevEnd: Date | null = null;

  for (const b of sorted) {
    const naiveStart = new Date(b.originalStart.getTime() + proposedDeltaMs);
    const durationMs = b.originalEnd.getTime() - b.originalStart.getTime();

    if (b.scheduleBypassed) {
      const start = naiveStart;
      const end = new Date(start.getTime() + durationMs);
      results.push({ id: b.id, start, end });
      // Bypass konec nesmí řetěz vrátit zpět v čase — expandovaný ocas
      // ne-bypass předchůdce zůstává závazný pro další bloky (nález I1
      // finálního review etapy 3).
      if (!prevEnd || end.getTime() > prevEnd.getTime()) prevEnd = end;
      continue;
    }

    // Etapa 9: tisková geometrie = ZAKAZKA + REZERVACE s printMinutes (usesTiskoveHodiny);
    // legacy REZERVACE bez pm a UDRZBA zůstávají rigidní.
    const tiskove = usesTiskoveHodiny({ type: b.type, printMinutes: b.printMinutes });
    const snapOwn = (from: Date): Date | null =>
      tiskove
        ? snapStartToNextRunnableSlot(b.machine, from, weekShifts, intervalsFor(b.machine))
        : snapToNextValidStartWithTemplates(b.machine, from, durationMs, weekShifts);

    let start = snapOwn(naiveStart);
    if (!start) return null;
    if (start.getTime() !== naiveStart.getTime()) wasSnapped = true;

    if (prevEnd && prevEnd.getTime() > start.getTime()) {
      const bumped = snapOwn(prevEnd);
      if (!bumped) return null;
      if (bumped.getTime() !== start.getTime()) wasSnapped = true;
      start = bumped;
    }

    let end: Date;
    if (tiskove) {
      const pm = blockPrintMinutes({ type: b.type, printMinutes: b.printMinutes, startTime: b.originalStart, endTime: b.originalEnd });
      const exp = expandPrintTime(b.machine, start, pm, weekShifts, intervalsFor(b.machine), false);
      if (!exp.ok) return null;
      end = exp.end;
    } else {
      end = new Date(start.getTime() + durationMs);
    }

    results.push({ id: b.id, start, end });
    prevEnd = end;
  }

  return { results, wasSnapped };
}

/**
 * Sdílený guard + expanzní krok pro getBlockSegments/blockCalendarDrift: ověří
 * ZAKAZKA/platné printMinutes/zarovnaný start (a ve výchozím stavu i ne-bypass)
 * a spustí expandPrintTime. Vrací null, jen když NĚKTERÝ guard selže — to volající
 * mapuje na "bez štítku" (getBlockSegments) resp. "nelze posoudit"
 * (blockCalendarDrift). Když guardy projdou, vrací vždy `ExpandResult` (i `ok: false`
 * s reasonem) — jeho klasifikaci (fail vs. end mismatch vs. sedí) už řeší každá
 * volající funkce podle vlastní sémantiky.
 *
 * `includeBypassed` je VÝSLOVNÝ opt-in jediného volajícího — `blockCalendarDrift`,
 * který od 8/2026 odložené zakázky posuzuje (dřív byly neviditelné, viz 18447).
 * Výchozí stav je a musí zůstat PŘÍSNÝ: kreslení segmentů (`getBlockSegments`,
 * `blockReportSegments`) odloženou zakázku expandovat NESMÍ — nakreslilo by jí
 * dovnitř pás „⏸ PAUZA — mimo provoz", přestože tiskne slitě. Proto je to
 * parametr a ne uvolnění podmínky; hlídá to test „getBlockSegments: bypass blok
 * → null" (poučení P6 v docs/POUCENI.md), jehož fixtura je schválně taková, že
 * BEZ guardu segmenty s pauzou vzniknou.
 */
function tryExpandForBlock(
  b: { type: string; machine: string; startTime: string | Date; printMinutes?: number | null; scheduleBypassed?: boolean | null },
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayClientRow[],
  opts: { includeBypassed?: boolean } = {}
): ExpandResult | null {
  if (b.type !== "ZAKAZKA") return null;
  if (b.scheduleBypassed && !opts.includeBypassed) return null;
  const pm = b.printMinutes;
  if (pm == null || !Number.isFinite(pm) || pm <= 0) return null;
  const start = new Date(b.startTime);
  if (start.getTime() % SLOT_MS !== 0) return null;
  try {
    return expandPrintTime(b.machine, start, pm, weekShifts, companyDayIntervalsFor(b.machine, companyDays), false);
  } catch {
    return null;
  }
}

/**
 * Segmenty bloku pro vykreslení pauz. Vrací null, když overlay nedává smysl:
 * ne-ZAKAZKA, chybějící/neplatné printMinutes, bypass blok (kreslí se slitě záměrně),
 * expanze selže, expanze nesedí na uložený end (drift kalendáře — segmenty by lhaly;
 * detekci driftu řeší `blockCalendarDrift`), nebo expanze nemá žádnou pauzu (overlay netřeba).
 */
export function getBlockSegments(
  b: { type: string; machine: string; startTime: string | Date; endTime: string | Date; printMinutes?: number | null; scheduleBypassed?: boolean },
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayClientRow[]
): PrintSegment[] | null {
  const exp = tryExpandForBlock(b, weekShifts, companyDays);
  if (!exp || !exp.ok) return null;
  if (exp.end.getTime() !== new Date(b.endTime).getTime()) return null;
  return exp.segments.some((s) => s.kind === "pause") ? exp.segments : null;
}

/**
 * Segmenty bloku pro reportové metriky. Na rozdíl od getBlockSegments vrací
 * segmenty i pro souvislý blok bez pauzy (reporty potřebují průnik tiskového
 * času s oknem dne/směny vždy, ne jen kvůli overlay) a nevyžaduje přítomnost
 * pauzy. Null = nelze spolehlivě expandovat (guardy tryExpandForBlock, expanze
 * selže, nebo drift endu) — volající počítá konzervativní fallback z celého
 * spanu přes printOverlapMinutes(null, …).
 */
export function blockReportSegments(
  b: { type: string; machine: string; startTime: string | Date; endTime: string | Date; printMinutes?: number | null; scheduleBypassed?: boolean | null },
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayClientRow[]
): PrintSegment[] | null {
  const exp = tryExpandForBlock(b, weekShifts, companyDays);
  if (!exp || !exp.ok) return null;
  if (exp.end.getTime() !== new Date(b.endTime).getTime()) return null;
  return exp.segments;
}

/**
 * Tiskové minuty bloku uvnitř okna [winStart, winEnd). Se segmenty sčítá průnik
 * print segmentů s oknem; bez nich (null) konzervativně průnik celého spanu
 * start–end (ne-ZAKAZKA, bypass, legacy pm=null, drift). Čistá intervalová
 * matematika — okno nemusí být zarovnané na sloty.
 */
export function printOverlapMinutes(
  segments: PrintSegment[] | null,
  b: { startTime: string | Date; endTime: string | Date },
  winStart: Date,
  winEnd: Date
): number {
  if (winEnd.getTime() <= winStart.getTime()) return 0;
  const clip = (s: number, e: number) =>
    Math.max(0, Math.min(e, winEnd.getTime()) - Math.max(s, winStart.getTime()));
  if (!segments) {
    return clip(new Date(b.startTime).getTime(), new Date(b.endTime).getTime()) / 60000;
  }
  let ms = 0;
  for (const seg of segments) {
    if (seg.kind !== "print") continue;
    ms += clip(seg.start.getTime(), seg.end.getTime());
  }
  return ms / 60000;
}

export type CalendarDriftInfo = {
  /**
   * Tři důvody popisují PORUCHU u běžné zakázky (`END_MISMATCH`, `START_NOT_RUNNABLE`,
   * `HORIZON_EXCEEDED` — geometrie se rozešla s kalendářem, viz `DriftedBlock`).
   * Zbylé dva popisují STAV zakázky odložené mimo pracovní dobu, což porucha není:
   * - `PARKED` — leží mimo kalendář, protože ji tam plánovač vědomě dal; `expectedEnd`
   *   nese konec, který by vyšel po přepočtu (null, když start vůbec není spustitelný).
   * - `STALE_BYPASS` — nese značku odložení, ale kalendáři odpovídá; značka je zbytková.
   */
  reason: "END_MISMATCH" | "START_NOT_RUNNABLE" | "HORIZON_EXCEEDED" | "PARKED" | "STALE_BYPASS";
  expectedEnd: Date | null;
};

/**
 * Klientský protějšek `detectCalendarDrift` (calendarDrift.server.ts) — posuzuje
 * JEDEN blok na zobrazovaném gridu, aby se dal vykreslit vizuální štítek hned,
 * bez čekání na server notifikaci.
 *
 * Vrací null (bez štítku) pro: vytištěný blok (printCompletedAt), blok
 * v minulosti (endTime <= now), a guardy sdílené s getBlockSegments přes
 * tryExpandForBlock (ne-ZAKAZKA, printMinutes null/≤0, nezarovnaný start) —
 * v tomto pořadí. Jinak expandPrintTime: fail → drift s reasonem
 * z expanze (expectedEnd null — nelze spočítat), ok a end nesedí na uložený
 * → END_MISMATCH s expectedEnd, ok a sedí → null (žádný drift).
 *
 * ## Rozsah je ZÁMĚRNĚ širší než serverový (rozhodnuto 9. 8. 2026)
 *
 * Odložené zakázky (`scheduleBypassed`) posuzuje JEN tenhle klientský detektor —
 * server je vyřazuje už ve `where` a je to správně (důvod je rozepsaný v docblocku
 * `detectCalendarDrift`): vědomé odložení není porucha, takže nepatří do notifikací,
 * do provozního reportu ani pod hromadné „Přepočítat". Patří na kartu té jedné
 * zakázky, které se týká, a proto ho klasifikuje ta strana, která kartu kreslí.
 * Rozdílné důvody to drží oddělené: `PARKED`/`STALE_BYPASS` popisují STAV odložení
 * a na serveru nikdy nevzniknou, zbylé tři popisují PORUCHU a musí na obou stranách
 * vyjít stejně. Hlídá to test parity v `calendarDrift.server.test.ts`.
 *
 * Klient nemá pojem „okna" (server filtruje endTime > max(windowStart, now),
 * protože posuzuje jen dávku dotčenou mutací kalendáře) — okno je serverová
 * optimalizace dotazu, ne klasifikační pravidlo; pro jeden blok je endTime > now
 * ekvivalentní. Při změně guard sady na serveru promítnout ZDE i do WHERE
 * v detectCalendarDrift (parita ověřena review 3. 7. 2026 podmínka po podmínce).
 */
export function blockCalendarDrift(
  b: {
    type: string;
    machine: string;
    scheduleBypassed?: boolean | null;
    printMinutes?: number | null;
    startTime: string | Date;
    endTime: string | Date;
    printCompletedAt?: string | Date | null;
  },
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayClientRow[],
  now: Date
): CalendarDriftInfo | null {
  if (b.printCompletedAt) return null;
  const endTime = new Date(b.endTime);
  if (endTime.getTime() <= now.getTime()) return null;

  const exp = tryExpandForBlock(b, weekShifts, companyDays, { includeBypassed: true });
  if (!exp) return null; // guard selhal (ne-ZAKAZKA/pm neplatné/nezarovnaný start) — nelze posoudit

  const conforms = exp.ok && exp.end.getTime() === endTime.getTime();

  // Odložená zakázka: nekonformita s kalendářem je DEFINICE odložení (příznak nastavuje
  // server právě tehdy, když geometrie kalendáři nevyhovuje), ne porucha. Proto vlastní
  // dvojice důvodů místo poplachu — text štítku pak plánovači řekne stav, ne chybu.
  if (b.scheduleBypassed) {
    if (conforms) return { reason: "STALE_BYPASS", expectedEnd: null };
    return { reason: "PARKED", expectedEnd: exp.ok ? exp.end : null };
  }

  if (!exp.ok) return { reason: exp.reason, expectedEnd: null };
  return conforms ? null : { reason: "END_MISMATCH", expectedEnd: exp.end };
}

/**
 * Bod, kde je odpracována polovina tiskových minut (default bod splitu).
 * Fallback bez segmentů: start + printMinutes/2 (souvislý blok). Null jen když pm chybí.
 */
export function printMidpoint(
  b: Parameters<typeof getBlockSegments>[0],
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayClientRow[]
): Date | null {
  const pm = b.type === "ZAKAZKA" ? b.printMinutes : null;
  if (pm == null || !Number.isFinite(pm) || pm <= 0) return null;
  const half = Math.round(pm / 2 / 30) * 30; // zarovnat na slot
  const segs = getBlockSegments(b, weekShifts, companyDays);
  if (!segs) return new Date(new Date(b.startTime).getTime() + half * 60000);
  let remaining = half;
  for (const s of segs) {
    if (s.kind !== "print") continue;
    const segMin = Math.round((s.end.getTime() - s.start.getTime()) / 60000);
    if (remaining <= segMin) return new Date(s.start.getTime() + remaining * 60000);
    remaining -= segMin;
  }
  return new Date(new Date(b.endTime).getTime());
}
