import { expandPrintTime, SLOT_MS, MAX_SPAN_DAYS } from "@/lib/printTime";
import { logger } from "@/lib/logger";
import { loadMachineCalendarRange, type PrismaClientLike as CalendarPrismaClientLike } from "@/lib/printTime.server";
import type { SessionUser } from "@/lib/auth";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Strukturální typ pro detekci driftu — rozšiřuje kalendářový typ o block.findMany (vlastní, ať printTime.server.ts nezávisí na Block). */
export type PrismaClientLike = CalendarPrismaClientLike & {
  block: {
    findMany: (args: {
      where: {
        machine: { in: string[] };
        type: string;
        scheduleBypassed: boolean;
        printMinutes: { gt: number };
        printCompletedAt: null;
        startTime: { lt: Date };
        endTime: { gt: Date };
      };
      select: {
        id: true;
        orderNumber: true;
        description: true;
        machine: true;
        startTime: true;
        endTime: true;
        printMinutes: true;
      };
    }) => Promise<
      {
        id: number;
        orderNumber: string;
        description: string | null;
        machine: string;
        startTime: Date;
        endTime: Date;
        printMinutes: number | null;
      }[]
    >;
  };
};

/**
 * Samostatný strukturální typ pro notifikaci o driftu — NEROZŠIŘUJE `PrismaClientLike`
 * (ten je pinovaný na `detectCalendarDrift` v `calendarDrift.server.test.ts` z Task 1
 * pomocí lehčího fake objektu bez `notification`; sdílení jednoho typu by test rozbilo).
 */
export type NotifyPrismaClientLike = {
  notification: {
    createMany: (args: {
      data: Array<{
        type: string;
        targetRole: string;
        message: string;
        createdByUserId: number;
        createdByUsername: string;
      }>;
    }) => Promise<unknown>;
  };
};

export type DriftedBlock = {
  id: number;
  orderNumber: string;
  description: string | null;
  machine: string;
  startTime: Date;
  endTime: Date;
  expectedEnd: Date | null; // null = expanze selhala
  reason: "END_MISMATCH" | "START_NOT_RUNNABLE" | "HORIZON_EXCEEDED";
};

/**
 * Detekuje ZAKAZKA bloky, jejichž uložený `endTime` už nesedí na aktuální
 * pracovní kalendář (weekShifts/companyDays se od uložení změnily). Jen ČTE —
 * neukládá, žádné migrace. Posuzuje jen bloky, které lze poctivě re-expandovat:
 * ne-bypass, printMinutes > 0, zarovnaný start, ještě nevytištěné a neskončené.
 *
 * ## Proč `scheduleBypassed: false` ve `where` ZŮSTÁVÁ (rozhodnuto 9. 8. 2026)
 *
 * Vypadá to jako slepé místo („odložené zakázky nikdo nekontroluje") a etapa
 * „zámek jako režim" ten filtr dočasně odstranila. Vrátil se, protože příznak
 * NENÍ přání uživatele, ale SPOČÍTANÁ PRAVDA: `validateAndComputeEnd` ho nastaví
 * právě tehdy, když geometrie kalendáři nevyhovuje (`effectivelyBypassed = !conforms`,
 * `scheduleValidationServer.ts`). Odložená zakázka je tedy z definice nekonformní —
 * bez filtru by KAŽDÁ vědomě odložená zakázka trvale svítila jako „nesedí na kalendář“:
 * notifikace při každé úpravě směn, nikdy nenulový provozní report, a hromadné
 * „Přepočítat" nad strojem by ji jedním kliknutím vrátilo do pracovní doby i s
 * autoposunem navazujících bloků — nevratně, protože reflow nemá undo.
 *
 * Odložení je rozhodnutí plánovače, ne porucha. Ukazuje se proto **na kartě samotné
 * zakázky** (klientský `blockCalendarDrift` v `printTimeClient.ts`, který odložené
 * bloky posuzuje) a opravuje se **adresným tlačítkem „Přepočítat" v jejím detailu**.
 * Tahle funkce slouží souhrnným a hromadným kanálům, kam vědomé odložení nepatří.
 * Rozdílný rozsah obou detektorů je tedy ZÁMĚR, ne rozejití — hlídá to test parity
 * v `calendarDrift.server.test.ts`.
 */
export async function detectCalendarDrift(
  db: PrismaClientLike,
  machines: string[],
  windowStart: Date,
  windowEnd: Date,
  now: Date
): Promise<DriftedBlock[]> {
  const activeAfter = Math.max(windowStart.getTime(), now.getTime());
  const rawBlocks = await db.block.findMany({
    where: {
      machine: { in: machines },
      type: "ZAKAZKA",
      scheduleBypassed: false,
      printMinutes: { gt: 0 },
      printCompletedAt: null,
      startTime: { lt: windowEnd },
      endTime: { gt: new Date(activeAfter) },
    },
    select: { id: true, orderNumber: true, description: true, machine: true, startTime: true, endTime: true, printMinutes: true },
  });

  // Nezarovnaný start = legacy blok předcházející modelu tiskových hodin — nelze posoudit.
  const blocks = rawBlocks.filter((b) => b.startTime.getTime() % SLOT_MS === 0);
  if (blocks.length === 0) return [];

  const byMachine = new Map<string, typeof blocks>();
  for (const b of blocks) {
    const list = byMachine.get(b.machine);
    if (list) list.push(b);
    else byMachine.set(b.machine, [b]);
  }

  const calendarEnd = new Date(windowEnd.getTime() + MAX_SPAN_DAYS * DAY_MS);
  const drifted: DriftedBlock[] = [];

  for (const [machine, machineBlocks] of byMachine) {
    const minStart = machineBlocks.reduce(
      (min, b) => (b.startTime.getTime() < min.getTime() ? b.startTime : min),
      machineBlocks[0].startTime
    );
    const cal = await loadMachineCalendarRange(db, machine, minStart, calendarEnd);

    for (const b of machineBlocks) {
      // printMinutes > 0 je vynuceno where filtrem — non-null assert bezpečný.
      const printMinutes = b.printMinutes as number;
      // Obrana proti výjimce z expanze (nezarovnaný start, nekladné pm). Guardy výš ji
      // dnes vylučují, ale tahle funkce běží UVNITŘ transakce mutace kalendáře: jediný
      // vadný legacy blok by shodil celou úpravu směn nebo odstávky chybou 500.
      // Klientský protějšek `blockCalendarDrift` tutéž pojistku má odjakživa.
      let expanded: ReturnType<typeof expandPrintTime>;
      try {
        expanded = expandPrintTime(machine, b.startTime, printMinutes, cal.weekShifts, cal.companyDays, false);
      } catch (err) {
        logger.warn(`[calendarDrift] blok ${b.id} (${b.orderNumber}) nelze expandovat, přeskakuji`, err);
        continue;
      }
      if (!expanded.ok) {
        drifted.push({
          id: b.id,
          orderNumber: b.orderNumber,
          description: b.description,
          machine: b.machine,
          startTime: b.startTime,
          endTime: b.endTime,
          expectedEnd: null,
          reason: expanded.reason,
        });
        continue;
      }
      if (expanded.end.getTime() !== b.endTime.getTime()) {
        drifted.push({
          id: b.id,
          orderNumber: b.orderNumber,
          description: b.description,
          machine: b.machine,
          startTime: b.startTime,
          endTime: b.endTime,
          expectedEnd: expanded.end,
          reason: "END_MISMATCH",
        });
      }
    }
  }

  drifted.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  return drifted;
}

/** Skloňování počtu bloků: 1 → „blok", 2–4 → „bloky", 5+ → „bloků". */
function pluralBlok(count: number): string {
  if (count === 1) return "blok";
  if (count >= 2 && count <= 4) return "bloky";
  return "bloků";
}

/**
 * Vytvoří notifikace pro PLANOVAT a ADMIN, když mutace kalendáře (směny/odstávky)
 * rozhodí uložený `endTime` bloků, které na ni spoléhaly. No-op při prázdném poli
 * (volající nemusí sám kontrolovat `drifted.length`).
 */
export async function notifyCalendarDrift(
  db: NotifyPrismaClientLike,
  drifted: DriftedBlock[],
  session: Pick<SessionUser, "id" | "username">,
  contextLabel: string
): Promise<void> {
  if (drifted.length === 0) return;

  const orderNumbers = drifted.map((d) => d.orderNumber);
  const shown = orderNumbers.slice(0, 3).join(", ");
  const suffix = orderNumbers.length > 3 ? "…" : "";
  const message = `${contextLabel}: ${drifted.length} ${pluralBlok(drifted.length)} nesedí na kalendář (${shown}${suffix})`;

  await db.notification.createMany({
    data: [
      {
        type: "CALENDAR_DRIFT",
        targetRole: "PLANOVAT",
        message,
        createdByUserId: session.id,
        createdByUsername: session.username,
      },
      {
        type: "CALENDAR_DRIFT",
        targetRole: "ADMIN",
        message,
        createdByUserId: session.id,
        createdByUsername: session.username,
      },
    ],
  });
}
