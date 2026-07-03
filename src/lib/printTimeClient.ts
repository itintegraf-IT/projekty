import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import {
  expandPrintTime,
  snapStartToNextRunnableSlot,
  SLOT_MS,
  type CompanyDayInterval,
  type ExpandResult,
  type PrintSegment,
} from "@/lib/printTime";

/**
 * Klient-safe helpery modelu tiskových hodin (žádná DB, žádný server import).
 * Mutační cesty klienta jimi připravují payload — end vždy autoritativně počítá server.
 */

export type CompanyDayClientRow = { machine?: string | null; startDate: string | Date; endDate: string | Date };
export type { PrintSegment };

/**
 * Délka bloku v minutách pro payload: ZAKAZKA = printMinutes (fallback elapsed), jinak elapsed.
 * Elapsed fallback u ZAKAZKA se zarovnává na 30min grid (min 30) — server vyžaduje pm % 30 === 0
 * a legacy blok s nezarovnaným spanem by jinak spadl na SCHEDULE_VIOLATION při uložení.
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
  if (b.type !== "ZAKAZKA") return elapsed;
  return b.printMinutes ?? Math.max(30, Math.round(elapsed / 30) * 30);
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

/**
 * Skupinový snap deltas pro lasso přesun v modelu tiskových hodin: snapují se jen STARTY
 * (délku rozloží server expanzí). Nahrazuje duration-based snapGroupDeltaWithTemplates.
 * Vrací null, když některý start nejde v horizontu umístit — volající mutaci neodešle.
 */
export function snapGroupDeltaStartOnly(
  blocks: { machine: string; originalStart: Date }[],
  proposedDeltaMs: number,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: Parameters<typeof companyDayIntervalsFor>[1]
): { deltaMs: number; wasSnapped: boolean } | null {
  let delta = proposedDeltaMs;
  let wasSnapped = false;
  const intervalsByMachine = new Map<string, CompanyDayInterval[]>();
  for (const b of blocks) {
    if (!intervalsByMachine.has(b.machine)) {
      intervalsByMachine.set(b.machine, companyDayIntervalsFor(b.machine, companyDays));
    }
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    let maxExtra = 0;
    for (const b of blocks) {
      const newStart = new Date(b.originalStart.getTime() + delta);
      const snapped = snapStartToNextRunnableSlot(
        b.machine, newStart, weekShifts, intervalsByMachine.get(b.machine)!
      );
      if (!snapped) return null;
      const extra = snapped.getTime() - newStart.getTime();
      if (extra > maxExtra) maxExtra = extra;
    }
    if (maxExtra === 0) break;
    delta += maxExtra;
    wasSnapped = true;
  }
  return { deltaMs: delta, wasSnapped };
}

/**
 * Sdílený guard + expanzní krok pro getBlockSegments/blockCalendarDrift: ověří
 * ZAKAZKA/ne-bypass/platné printMinutes/zarovnaný start a spustí expandPrintTime.
 * Vrací null, jen když NĚKTERÝ guard selže (ne-ZAKAZKA/bypass/pm neplatné/
 * nezarovnaný start) — to volající mapuje na "bez štítku" (getBlockSegments)
 * resp. "nelze posoudit" (blockCalendarDrift). Když guardy projdou, vrací vždy
 * `ExpandResult` (i `ok: false` s reasonem) — jeho klasifikaci (fail vs. end
 * mismatch vs. sedí) už řeší každá volající funkce podle vlastní sémantiky.
 */
function tryExpandForBlock(
  b: { type: string; machine: string; startTime: string | Date; printMinutes?: number | null; scheduleBypassed?: boolean | null },
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayClientRow[]
): ExpandResult | null {
  if (b.type !== "ZAKAZKA" || b.scheduleBypassed) return null;
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

export type CalendarDriftInfo = {
  reason: "END_MISMATCH" | "START_NOT_RUNNABLE" | "HORIZON_EXCEEDED";
  expectedEnd: Date | null;
};

/**
 * Klientský protějšek `detectCalendarDrift` (calendarDrift.server.ts) — posuzuje
 * JEDEN blok na zobrazovaném gridu, aby se dal vykreslit vizuální štítek driftu
 * hned, bez čekání na server notifikaci. Klasifikace MUSÍ sedět se serverovou
 * (server notifikuje, klient kreslí — rozchod by matl uživatele).
 *
 * Vrací null (bez štítku) pro: vytištěný blok (printCompletedAt), blok
 * v minulosti (endTime <= now), a guardy sdílené s getBlockSegments přes
 * tryExpandForBlock (ne-ZAKAZKA, bypass, printMinutes null/≤0, nezarovnaný
 * start) — v tomto pořadí. Jinak expandPrintTime: fail → drift s reasonem
 * z expanze (expectedEnd null — nelze spočítat), ok a end nesedí na uložený
 * → END_MISMATCH s expectedEnd, ok a sedí → null (žádný drift).
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

  const exp = tryExpandForBlock(b, weekShifts, companyDays);
  if (!exp) return null; // guard selhal (ne-ZAKAZKA/bypass/pm neplatné/nezarovnaný start) — nelze posoudit
  if (!exp.ok) return { reason: exp.reason, expectedEnd: null };
  if (exp.end.getTime() !== endTime.getTime()) return { reason: "END_MISMATCH", expectedEnd: exp.end };
  return null;
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
