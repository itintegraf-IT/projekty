import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isCivilDateString, addDaysToCivilDate, pragueToUTC } from "@/lib/dateUtils";
import { serializeWeekShifts } from "@/lib/scheduleValidation";
import {
  computeAvailableHours,
  computeBlockHours,
  computeUtilization,
  groupCompletedToOrders,
  computeThroughputFromOrders,
  computeAvgLeadTimeDaysFromOrders,
  computeMaintenanceRatio,
  computePlanStability,
  resolvePlanCoverage,
  blockDurationHours,
} from "@/lib/reportMetrics";
import { REVISION_RETENTION_DAYS, REVISION_MIGRATION_NAME } from "@/lib/revision/retention";
import { blockReportSegments, printOverlapMinutes, type PrintSegment } from "@/lib/printTimeClient";
import { MACHINES } from "@/lib/machines";

const ALLOWED_ROLES = new Set(["ADMIN"]);

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.has(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode");
  const rangeStart = searchParams.get("rangeStart");
  const rangeEnd = searchParams.get("rangeEnd");

  if (!mode || (mode !== "retro" && mode !== "outlook")) {
    return NextResponse.json({ error: "Chybí nebo neplatný parametr mode (retro | outlook)" }, { status: 400 });
  }
  if (!rangeStart || !isCivilDateString(rangeStart)) {
    return NextResponse.json({ error: "Chybí nebo neplatný parametr rangeStart (YYYY-MM-DD)" }, { status: 400 });
  }
  if (!rangeEnd || !isCivilDateString(rangeEnd)) {
    return NextResponse.json({ error: "Chybí nebo neplatný parametr rangeEnd (YYYY-MM-DD)" }, { status: 400 });
  }
  if (rangeStart > rangeEnd) {
    return NextResponse.json({ error: "rangeStart musí být <= rangeEnd" }, { status: 400 });
  }

  try {
    const startUtc = pragueToUTC(rangeStart, 0, 0);
    const endUtc = pragueToUTC(addDaysToCivilDate(rangeEnd, 1), 0, 0);

    if (mode === "retro") {
      return await handleRetro(rangeStart, rangeEnd, startUtc, endUtc);
    } else {
      return await handleOutlook(rangeStart, rangeEnd, startUtc, endUtc);
    }
  } catch (error) {
    logger.error("[GET /api/report/dashboard]", error);
    return NextResponse.json({ error: "Interni chyba serveru." }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Retro mode
// ---------------------------------------------------------------------------

/**
 * Revize v období — podklad pro „Stabilita plánu" i „Aktivita plánovačů".
 *
 * `JSON_CONTAINS_PATH` se počítá v SQL, aby se přes síť netahal celý sloupec
 * `after` (u širokých editací z BlockEditu jsou to kilobajty na řádek). Filtrovat
 * `kind`/`action` se ZÁMĚRNĚ nechává až na JS: aktivita plánovačů potřebuje
 * všechny revize, stabilita jen podmnožinu, a dva dotazy by nad touž tabulkou
 * byly dražší než jeden.
 *
 * POZOR na návratový typ `positional`: MySQL funkci vrací přes `$queryRaw` jako
 * **BigInt** (ověřeno na dev MySQL 8.0.45 — `1n`, ne `1`), takže striktní `=== 1`
 * by tiše platilo nikdy. Vždycky přes `Number()` — ten sjednotí i případný rozdíl
 * mezi oběma motory.
 *
 * ## Dev a produkce mají POD SLOUPCEM `after` jiný typ, a je to v pořádku
 *
 * Dev je MySQL 8.0.45 (sloupec `json`), produkce **MariaDB 10.11** (sloupec
 * `longtext` — MariaDB nativní typ JSON nemá a Prisma tam vyrobí text s kontrolou
 * `json_valid()`). `JSON_CONTAINS_PATH` funguje nad obojím; ověřeno 10. 8. 2026
 * přímo nad ostrou tabulkou, ne odvozeno z čísla verze. Kdyby se motor někdy měnil,
 * je to první věc ke kontrole — funkce existuje od MySQL 5.7 a MariaDB 10.2.3.
 */
type RevisionRow = {
  groupId: string;
  blockId: number;
  username: string;
  kind: string;
  action: string;
  /** 1 = změnil se startTime/endTime/machine. NULL u kind=DELETE (`after` je prázdné). */
  positional: bigint | number | null;
};

/** Revizní akce, které NEJSOU rozhodnutím o plánu — undo vrací blok tam, kde byl. */
const NON_DECISION_ACTIONS = new Set(["UNDO", "REDO"]);

async function handleRetro(rangeStart: string, rangeEnd: string, startUtc: Date, endUtc: Date) {
  const [blocks, revisions, migrationRows, rawWeekShifts, reservations, companyDays] = await Promise.all([
    prisma.block.findMany({
      where: { startTime: { lt: endUtc }, endTime: { gt: startUtc } },
      select: { id: true, machine: true, type: true, startTime: true, endTime: true, createdAt: true, printCompletedAt: true, printMinutes: true, scheduleBypassed: true },
    }),
    prisma.$queryRaw<RevisionRow[]>`
      SELECT groupId, blockId, username, kind, action,
             JSON_CONTAINS_PATH(after, 'one', '$.startTime', '$.endTime', '$.machine') AS positional
      FROM BlockRevision
      WHERE createdAt >= ${startUtc} AND createdAt < ${endUtc}
    `,
    // Odkdy se vůbec nahrává = kdy na TOMHLE prostředí doběhla migrace, která
    // `BlockRevision` založila. ZÁMĚRNĚ ne `MIN(createdAt)` z revizí — to je
    // datum první změny, takže klidné období by se tvářilo jako chybějící data
    // (viz `resolvePlanCoverage` a nález z ručního testu 10. 8. 2026).
    prisma.$queryRaw<{ finished_at: Date | null }[]>`
      SELECT finished_at FROM _prisma_migrations
      WHERE migration_name = ${REVISION_MIGRATION_NAME} AND finished_at IS NOT NULL
      LIMIT 1
    `,
    prisma.machineWeekShifts.findMany({
      // ±28 d: blok protínající rozsah může začínat až MAX_SPAN_DAYS (21 d) před
      // rangeStart (expanze potřebuje i týden před startem bloku — noční prev-tail)
      // a stejně tak přesahovat až 21 d ZA rangeEnd (bez budoucích týdnů by expanze
      // hraničního bloku selhala → span fallback; nález M-A finálního review E7).
      // Starší legacy bloky degradují bezpečně na elapsed fallback (segments=null).
      where: { weekStart: { gte: new Date(startUtc.getTime() - 28 * 86_400_000), lt: new Date(endUtc.getTime() + 28 * 86_400_000) } },
    }),
    prisma.reservation.findMany({
      where: {
        OR: [
          { createdAt: { gte: startUtc, lt: endUtc } },
          { status: { in: ["SUBMITTED", "ACCEPTED", "QUEUE_READY"] } },
        ],
      },
      select: { status: true },
    }),
    prisma.companyDay.findMany({
      where: { startDate: { lt: endUtc }, endDate: { gt: startUtc } },
    }),
  ]);

  const weekShifts = serializeWeekShifts(rawWeekShifts);

  const blockInputs = blocks.map((b) => ({
    type: b.type,
    machine: b.machine,
    startTime: b.startTime,
    endTime: b.endTime,
    printCompletedAt: b.printCompletedAt,
    createdAt: b.createdAt,
    printMinutes: b.printMinutes,
    scheduleBypassed: b.scheduleBypassed,
  }));

  // Segmenty 1× per blok — denní smyčka by expanzi opakovala až 30×.
  const segMap = new Map<(typeof blockInputs)[number], PrintSegment[] | null>();
  for (const b of blockInputs) {
    segMap.set(b, b.type === "ZAKAZKA" ? blockReportSegments(b, weekShifts, companyDays) : null);
  }

  // Per-machine metrics
  const machines: Record<string, { utilization: number; productionHours: number; maintenanceHours: number; availableHours: number }> = {};
  let totalAvailable = 0;
  let totalMaintenance = 0;

  for (const machine of MACHINES) {
    const availableHours = computeAvailableHours(machine, rangeStart, rangeEnd, weekShifts, companyDays);
    const productionHours = Math.round(computeBlockHours(blockInputs, machine, "ZAKAZKA") * 100) / 100;
    const maintenanceHours = Math.round(computeBlockHours(blockInputs, machine, "UDRZBA") * 100) / 100;
    const utilization = computeUtilization(productionHours, availableHours);
    machines[machine] = { utilization, productionHours, maintenanceHours, availableHours };
    totalAvailable += availableHours;
    totalMaintenance += maintenanceHours;
  }

  // Daily utilization
  const dailyUtilization: Array<{ date: string; XL_105: number; XL_106: number }> = [];
  let cur = rangeStart;
  while (cur <= rangeEnd) {
    const dayStart = pragueToUTC(cur, 0, 0);
    const dayEnd = pragueToUTC(addDaysToCivilDate(cur, 1), 0, 0);
    const dayBlocks = blockInputs.filter((b) => b.startTime < dayEnd && b.endTime > dayStart);

    const entry: { date: string; XL_105: number; XL_106: number } = { date: cur, XL_105: 0, XL_106: 0 };
    for (const machine of MACHINES) {
      const avail = computeAvailableHours(machine, cur, cur, weekShifts, companyDays);
      const prodMin = dayBlocks
        .filter((b) => b.machine === machine && b.type === "ZAKAZKA")
        .reduce((sum, b) => sum + printOverlapMinutes(segMap.get(b) ?? null, b, dayStart, dayEnd), 0);
      entry[machine] = computeUtilization(prodMin / 60, avail);
    }
    dailyUtilization.push(entry);
    cur = addDaysToCivilDate(cur, 1);
  }

  // Průtok a lead time se počítají nad DOKONČENÝMI zakázkami, ne nad bloky, které
  // období protínají. Zakázka odklepnutá v období, ale naplánovaná mimo něj, se dřív
  // nezapočítala nikde (na produkci 3 ze 43 v srpnu 2026). Hranice `startUtc`/`endUtc`
  // jsou pražské — tím mizí i starý posun 2 h proti zbytku routy.
  const completedRows = await prisma.block.findMany({
    where: { type: "ZAKAZKA", printCompletedAt: { gte: startUtc, lt: endUtc } },
    select: { id: true, splitGroupId: true, createdAt: true, printCompletedAt: true },
  });
  const completedOrders = groupCompletedToOrders(
    completedRows.flatMap((r) =>
      r.printCompletedAt == null ? [] : [{ id: r.id, splitGroupId: r.splitGroupId, createdAt: r.createdAt, printCompletedAt: r.printCompletedAt }],
    ),
  );
  const throughput = computeThroughputFromOrders(completedOrders);
  const avgLeadTimeDays = computeAvgLeadTimeDaysFromOrders(completedOrders);

  // Maintenance ratio
  const maintenanceRatio = computeMaintenanceRatio(totalMaintenance, totalAvailable);

  // Stabilita plánu — jen poziční revize, které vzešly z rozhodnutí uživatele.
  const positionalMoves = revisions
    .filter(
      (r) =>
        r.kind === "UPDATE" &&
        !NON_DECISION_ACTIONS.has(r.action) &&
        Number(r.positional) === 1,
    )
    .map((r) => ({ groupId: r.groupId, blockId: r.blockId }));

  const blockIdsInRange = new Set(blocks.map((b) => b.id));
  const { interventionCount, movedBlockCount, stabilityPercent } = computePlanStability(
    positionalMoves,
    blockIdsInRange,
  );

  // Celé období musí být pokryté, ne jen jeho konec — částečné pokrytí by číslo
  // podhodnotilo a vypadalo by to jako klidný měsíc, ne jako chybějící data.
  const { covered: planningCovered, coverageFrom } = resolvePlanCoverage(
    migrationRows[0]?.finished_at ?? null,
    startUtc,
    new Date(),
    REVISION_RETENTION_DAYS,
  );

  // Aktivita plánovačů = počet ULOŽENÍ (transakcí) na uživatele, ne počet změněných
  // polí. Dřív se počítaly auditní řádky `UPDATE`, tedy jeden za KAŽDÉ pole: jedno
  // uložení z BlockEditu s pěti změnami dělalo „5 akcí", kdežto přetažení bloku
  // nula (poziční sloupce v `AUDITED_FIELDS` nejsou). Revize berou všechny cesty.
  const groupsByUser = new Map<string, Set<string>>();
  for (const r of revisions) {
    const set = groupsByUser.get(r.username) ?? new Set<string>();
    set.add(r.groupId);
    groupsByUser.set(r.username, set);
  }
  const plannerActivity = Array.from(groupsByUser.entries())
    .map(([username, groups]) => ({ username, actionCount: groups.size }))
    .sort((a, b) => b.actionCount - a.actionCount);

  // Pipeline
  const statusCounts: Record<string, number> = { SUBMITTED: 0, ACCEPTED: 0, QUEUE_READY: 0, SCHEDULED: 0, REJECTED: 0 };
  for (const r of reservations) {
    if (r.status in statusCounts) {
      statusCounts[r.status]++;
    }
  }
  const convDenom = statusCounts.SCHEDULED + statusCounts.REJECTED;
  const conversionPercent = convDenom > 0 ? Math.round((statusCounts.SCHEDULED / convDenom) * 100) : 0;

  // Přihlášení za období
  const loginRows = await prisma.loginLog.findMany({
    where: { success: true, createdAt: { gte: startUtc, lt: endUtc } },
    select: { userId: true },
  });
  const loginActiveUsers = new Set(
    loginRows.map((l) => l.userId).filter((x): x is number => x != null),
  ).size;
  const logins = { periodCount: loginRows.length, activeUsers: loginActiveUsers };

  return NextResponse.json({
    machines,
    dailyUtilization,
    throughput,
    avgLeadTimeDays,
    maintenanceRatio,
    planning: {
      covered: planningCovered,
      coverageFrom: coverageFrom?.toISOString() ?? null,
      interventionCount,
      movedBlockCount,
      stabilityPercent,
    },
    plannerActivity,
    pipeline: { ...statusCounts, conversionPercent },
    logins,
  });
}

// ---------------------------------------------------------------------------
// Outlook mode
// ---------------------------------------------------------------------------

async function handleOutlook(rangeStart: string, rangeEnd: string, startUtc: Date, endUtc: Date) {
  const [blocks, rawWeekShifts, reservations, companyDays] = await Promise.all([
    prisma.block.findMany({
      where: { startTime: { lt: endUtc }, endTime: { gt: startUtc } },
      select: { id: true, machine: true, type: true, description: true, startTime: true, endTime: true, createdAt: true, printCompletedAt: true, printMinutes: true, scheduleBypassed: true },
    }),
    prisma.machineWeekShifts.findMany({
      // ±28 d: blok protínající rozsah může začínat až MAX_SPAN_DAYS (21 d) před
      // rangeStart (expanze potřebuje i týden před startem bloku — noční prev-tail)
      // a stejně tak přesahovat až 21 d ZA rangeEnd (bez budoucích týdnů by expanze
      // hraničního bloku selhala → span fallback; nález M-A finálního review E7).
      // Starší legacy bloky degradují bezpečně na elapsed fallback (segments=null).
      where: { weekStart: { gte: new Date(startUtc.getTime() - 28 * 86_400_000), lt: new Date(endUtc.getTime() + 28 * 86_400_000) } },
    }),
    prisma.reservation.findMany({
      where: { status: { in: ["SUBMITTED", "QUEUE_READY"] } },
      select: { status: true, createdAt: true },
    }),
    prisma.companyDay.findMany({
      where: { startDate: { lt: endUtc }, endDate: { gt: startUtc } },
    }),
  ]);

  const weekShifts = serializeWeekShifts(rawWeekShifts);

  const blockInputs = blocks.map((b) => ({
    type: b.type,
    machine: b.machine,
    startTime: b.startTime,
    endTime: b.endTime,
    printCompletedAt: b.printCompletedAt,
    createdAt: b.createdAt,
    printMinutes: b.printMinutes,
    scheduleBypassed: b.scheduleBypassed,
  }));

  // Segmenty 1× per blok — denní smyčka by expanzi opakovala až 30×.
  const segMap = new Map<(typeof blockInputs)[number], PrintSegment[] | null>();
  for (const b of blockInputs) {
    segMap.set(b, b.type === "ZAKAZKA" ? blockReportSegments(b, weekShifts, companyDays) : null);
  }

  // Per-machine metrics
  const machines: Record<string, { plannedCapacity: number; freeHours: number; availableHours: number }> = {};

  for (const machine of MACHINES) {
    const availableHours = computeAvailableHours(machine, rangeStart, rangeEnd, weekShifts, companyDays);
    // All block types count as planned
    const plannedHours = blockInputs
      .filter((b) => b.machine === machine)
      .reduce((sum, b) => sum + blockDurationHours(b), 0);
    const freeHours = Math.max(0, Math.round((availableHours - plannedHours) * 100) / 100);
    const plannedCapacity = computeUtilization(plannedHours, availableHours);
    machines[machine] = { plannedCapacity, freeHours, availableHours };
  }

  // Daily capacity (all block types)
  const dailyCapacity: Array<{ date: string; XL_105: number; XL_106: number }> = [];
  let cur = rangeStart;
  while (cur <= rangeEnd) {
    const dayStart = pragueToUTC(cur, 0, 0);
    const dayEnd = pragueToUTC(addDaysToCivilDate(cur, 1), 0, 0);
    const dayBlocks = blockInputs.filter((b) => b.startTime < dayEnd && b.endTime > dayStart);

    const entry: { date: string; XL_105: number; XL_106: number } = { date: cur, XL_105: 0, XL_106: 0 };
    for (const machine of MACHINES) {
      const avail = computeAvailableHours(machine, cur, cur, weekShifts, companyDays);
      const planned = dayBlocks
        .filter((b) => b.machine === machine)
        .reduce((sum, b) => sum + printOverlapMinutes(segMap.get(b) ?? null, b, dayStart, dayEnd), 0) / 60;
      entry[machine] = computeUtilization(planned, avail);
    }
    dailyCapacity.push(entry);
    cur = addDaysToCivilDate(cur, 1);
  }

  // Upcoming maintenance
  const upcomingMaintenance = blocks
    .filter((b) => b.type === "UDRZBA")
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    .map((b) => ({
      machine: b.machine,
      description: b.description ?? "",
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
    }));

  // Pending reservations
  const submitted = reservations.filter((r) => r.status === "SUBMITTED");
  const queueReady = reservations.filter((r) => r.status === "QUEUE_READY");
  let oldestWaitingDays = 0;
  if (submitted.length > 0) {
    const oldest = submitted.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), submitted[0].createdAt);
    oldestWaitingDays = Math.round((Date.now() - oldest.getTime()) / (1000 * 60 * 60 * 24));
  }

  return NextResponse.json({
    machines,
    dailyCapacity,
    upcomingMaintenance,
    pendingReservations: {
      newCount: submitted.length,
      queueCount: queueReady.length,
      oldestWaitingDays,
    },
  });
}
