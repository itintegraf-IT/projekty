import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { isAppError, errorStatus } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { MACHINES } from "@/lib/machines";
import { todayPragueDateStr, addDaysToCivilDate, pragueToUTC } from "@/lib/dateUtils";
import { serializeWeekShifts } from "@/lib/scheduleValidation";
import { computeAvailableHours, computeUtilization } from "@/lib/reportMetrics";
import { blockReportSegments, printOverlapMinutes, type PrintSegment } from "@/lib/printTimeClient";
import {
  ATTENTION_THRESHOLDS,
  type OverbookedMachine,
  type WaitingReservation,
} from "@/lib/attentionItems";

/**
 * Zdroj stavového pásu — „co vyžaduje pozornost".
 *
 * ZÁMĚRNĚ nezávislé na období zvoleném v Reportech: přeplánovaný stroj příští
 * týden je problém i při pohledu na loňský leden. Horizont je pevný
 * (`ATTENTION_THRESHOLDS.overbookedHorizonDays`) a route proto NEBERE žádný
 * query parametr — kdyby ho brala, „vyžaduje pozornost" by znamenalo pokaždé
 * něco jiného podle toho, co má člověk zrovna vybrané.
 *
 * Kontrolní panel tenhle endpoint NEPOČÍTÁ — klient ho má z `useHealthData`
 * a jeho kontroly skenují disk kvůli přílohám. Viz `src/lib/attentionItems.ts`.
 *
 * Aritmetika přeplánování je ZÁMĚRNĚ táž jako v `handleOutlook`
 * (`/api/report/dashboard`): dostupné hodiny minus tiskové minuty VŠECH typů
 * bloků ořezané oknem, přes `blockReportSegments` + `printOverlapMinutes`.
 * Kdyby si pás počítal hodiny po svém, tvrdil by nad kartou Kapacity ve
 * Výhledu jiné číslo než ta karta sama.
 */

/** Hodiny na obrazovku — jedno desetinné místo, shodně s reportovými kartami. */
const round1 = (hours: number) => Math.round(hours * 10) / 10;

export async function GET() {
  try {
    // Reporty jsou ADMIN-only, shodně s /api/report/dashboard.
    await requireRole(["ADMIN"]);

    // `rangeEnd` je u `computeAvailableHours` INCLUSIVE (funkce si sama přidává
    // jeden den), takže poslední den horizontu je `today + (N - 1)`. Bez toho
    // odečtení by se do jmenovatele připočetl 31. den, jehož bloky se do
    // čitatele nezapočítají — a přeplánování by se o tu kapacitu podhodnotilo.
    const today = todayPragueDateStr();
    const horizonLastDay = addDaysToCivilDate(today, ATTENTION_THRESHOLDS.overbookedHorizonDays - 1);
    const startUtc = pragueToUTC(today, 0, 0);
    const endUtc = pragueToUTC(addDaysToCivilDate(horizonLastDay, 1), 0, 0);

    const [blocks, rawWeekShifts, companyDays, submitted] = await Promise.all([
      prisma.block.findMany({
        where: { startTime: { lt: endUtc }, endTime: { gt: startUtc } },
        select: {
          machine: true,
          type: true,
          startTime: true,
          endTime: true,
          printMinutes: true,
          scheduleBypassed: true,
        },
      }),
      prisma.machineWeekShifts.findMany({
        // ±28 d: blok protínající horizont může začínat až MAX_SPAN_DAYS (21 d)
        // před ním i přesahovat stejně daleko za něj, a expanze potřebuje i týden
        // před startem bloku (noční prev-tail). Bez okolních týdnů by expanze
        // hraničního bloku selhala a spadla na hrubý span fallback.
        where: {
          weekStart: {
            gte: new Date(startUtc.getTime() - 28 * 86_400_000),
            lt: new Date(endUtc.getTime() + 28 * 86_400_000),
          },
        },
      }),
      prisma.companyDay.findMany({
        where: { startDate: { lt: endUtc }, endDate: { gt: startUtc } },
      }),
      prisma.reservation.findMany({
        where: { status: "SUBMITTED" },
        select: { id: true, code: true, createdAt: true },
      }),
    ]);

    const weekShifts = serializeWeekShifts(rawWeekShifts);

    // Segmenty 1× per blok — denní smyčka níž by expanzi opakovala až 30×.
    // Ne-ZAKAZKA nemá tiskové hodiny, takže jde rovnou na span fallback (null).
    const segMap = new Map<(typeof blocks)[number], PrintSegment[] | null>();
    for (const b of blocks) {
      segMap.set(b, b.type === "ZAKAZKA" ? blockReportSegments(b, weekShifts, companyDays) : null);
    }

    const overbooked: OverbookedMachine[] = [];
    for (const machine of MACHINES) {
      const machineBlocks = blocks.filter((b) => b.machine === machine);
      const plannedMinutes = (winStart: Date, winEnd: Date) =>
        machineBlocks.reduce((s, b) => s + printOverlapMinutes(segMap.get(b) ?? null, b, winStart, winEnd), 0);

      const available = computeAvailableHours(machine, today, horizonLastDay, weekShifts, companyDays);
      const planned = plannedMinutes(startUtc, endUtc) / 60;
      const overHours = planned - available;
      // Nulová kapacita není „nekonečné přeplánování" — je to „není z čeho počítat“,
      // stejné rozlišení, jaké dělá `computeUtilization`.
      if (available <= 0 || overHours <= 0) continue;

      // Kolik jednotlivých dní horizontu je nad kapacitou. NEMUSÍ jít o souvislý
      // úsek — proto se hlásí počet dní, ne rozsah „od–do", který by souvislost
      // sliboval.
      let overDays = 0;
      let cur = today;
      while (cur <= horizonLastDay) {
        const dayStart = pragueToUTC(cur, 0, 0);
        const dayEnd = pragueToUTC(addDaysToCivilDate(cur, 1), 0, 0);
        const dayAvail = computeAvailableHours(machine, cur, cur, weekShifts, companyDays);
        const pct = computeUtilization(plannedMinutes(dayStart, dayEnd) / 60, dayAvail);
        if (pct != null && pct > 100) overDays++;
        cur = addDaysToCivilDate(cur, 1);
      }

      overbooked.push({
        machine,
        overbookedHours: round1(overHours),
        overbookedDays: overDays,
      });
    }

    // `Reservation` nemá `orderNumber`; číslo rezervace, které vidí uživatel v
    // seznamu (`ReservationList.tsx`), je sloupec `code`. Je NOT NULL s defaultem
    // prázdného řetězce, takže se ošetřuje prázdnota, ne null.
    const nowMs = Date.now();
    const waiting: WaitingReservation[] = submitted.map((r) => ({
      id: r.id,
      orderNumber: r.code || `#${r.id}`,
      // `Math.round`, ne `floor` — SHODNĚ s `oldestWaitingDays` v dashboard route.
      // Obě čísla jsou vidět na téže stránce a při `floor` by se u čekání 3,6 dne
      // rozešla (pás „3 dny", karta „4 dny"), a protože práh je ostrý `> 3`,
      // rozešel by se i verdikt. Zarovnává se NOVÝ kód na existující chování,
      // ne naopak — měnit dnešní číslo není téma R3.
      waitingDays: Math.round((nowMs - r.createdAt.getTime()) / 86_400_000),
    }));

    return NextResponse.json({ checkedAt: new Date().toISOString(), overbooked, waiting });
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    logger.error("[report/attention] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
