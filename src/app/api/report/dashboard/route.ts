import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isCivilDateString, addDaysToCivilDate, pragueToUTC, utcToPragueDateStr } from "@/lib/dateUtils";
import { serializeTemplates } from "@/lib/scheduleValidation";
import {
  computeAvailableHours,
  computeBlockHours,
  computeUtilization,
  computeThroughput,
  computeAvgLeadTimeDays,
  computeMaintenanceRatio,
  computePlanStability,
} from "@/lib/reportMetrics";

const MACHINES = ["XL_105", "XL_106"] as const;
const ALLOWED_ROLES = new Set(["ADMIN", "PLANOVAT"]);

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

async function handleRetro(rangeStart: string, rangeEnd: string, startUtc: Date, endUtc: Date) {
  const [blocks, auditLogs, rawTemplates, rawExceptions, reservations, _companyDays] = await Promise.all([
    prisma.block.findMany({
      where: { startTime: { lt: endUtc }, endTime: { gt: startUtc } },
      select: { id: true, machine: true, type: true, startTime: true, endTime: true, createdAt: true, printCompletedAt: true },
    }),
    prisma.auditLog.findMany({
      where: { createdAt: { gte: startUtc, lt: endUtc }, action: "UPDATE" },
      select: { blockId: true, field: true, username: true },
    }),
    prisma.machineWorkHoursTemplate.findMany({ include: { days: true } }),
    prisma.machineScheduleException.findMany({
      where: { date: { gte: startUtc, lt: endUtc } },
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

  const templates = serializeTemplates(rawTemplates);
  const exceptions = rawExceptions.map((e) => ({
    machine: e.machine,
    date: utcToPragueDateStr(e.date),
    startHour: e.startHour,
    endHour: e.endHour,
    isActive: e.isActive,
    startSlot: e.startSlot ?? e.startHour * 2,
    endSlot: e.endSlot ?? e.endHour * 2,
  }));

  const blockInputs = blocks.map((b) => ({
    type: b.type,
    machine: b.machine,
    startTime: b.startTime,
    endTime: b.endTime,
    printCompletedAt: b.printCompletedAt,
    createdAt: b.createdAt,
  }));

  // Per-machine metrics
  const machines: Record<string, { utilization: number; productionHours: number; maintenanceHours: number; availableHours: number }> = {};
  let totalAvailable = 0;
  let totalMaintenance = 0;

  for (const machine of MACHINES) {
    const availableHours = computeAvailableHours(machine, rangeStart, rangeEnd, templates, exceptions);
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
      const avail = computeAvailableHours(machine, cur, cur, templates, exceptions);
      const prod = computeBlockHours(dayBlocks, machine, "ZAKAZKA");
      entry[machine] = computeUtilization(prod, avail);
    }
    dailyUtilization.push(entry);
    cur = addDaysToCivilDate(cur, 1);
  }

  // Throughput & lead time
  const throughput = computeThroughput(blockInputs, rangeStart, rangeEnd);
  const avgLeadTimeDays = computeAvgLeadTimeDays(blockInputs, rangeStart, rangeEnd);

  // Maintenance ratio
  const maintenanceRatio = computeMaintenanceRatio(totalMaintenance, totalAvailable);

  // Plan stability
  const auditLogInputs = auditLogs.map((l) => ({ blockId: l.blockId, field: l.field }));
  const { rescheduleCount, stabilityPercent } = computePlanStability(auditLogInputs, blocks.length);

  // Planner activity
  const activityMap = new Map<string, number>();
  for (const log of auditLogs) {
    activityMap.set(log.username, (activityMap.get(log.username) ?? 0) + 1);
  }
  const plannerActivity = Array.from(activityMap.entries())
    .map(([username, actionCount]) => ({ username, actionCount }))
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

  return NextResponse.json({
    machines,
    dailyUtilization,
    throughput,
    avgLeadTimeDays,
    maintenanceRatio,
    planning: { rescheduleCount, stabilityPercent },
    plannerActivity,
    pipeline: { ...statusCounts, conversionPercent },
  });
}

// ---------------------------------------------------------------------------
// Outlook mode
// ---------------------------------------------------------------------------

async function handleOutlook(rangeStart: string, rangeEnd: string, startUtc: Date, endUtc: Date) {
  const [blocks, rawTemplates, rawExceptions, reservations] = await Promise.all([
    prisma.block.findMany({
      where: { startTime: { lt: endUtc }, endTime: { gt: startUtc } },
      select: { id: true, machine: true, type: true, description: true, startTime: true, endTime: true, createdAt: true, printCompletedAt: true },
    }),
    prisma.machineWorkHoursTemplate.findMany({ include: { days: true } }),
    prisma.machineScheduleException.findMany({
      where: { date: { gte: startUtc, lt: endUtc } },
    }),
    prisma.reservation.findMany({
      where: { status: { in: ["SUBMITTED", "QUEUE_READY"] } },
      select: { status: true, createdAt: true },
    }),
  ]);

  const templates = serializeTemplates(rawTemplates);
  const exceptions = rawExceptions.map((e) => ({
    machine: e.machine,
    date: utcToPragueDateStr(e.date),
    startHour: e.startHour,
    endHour: e.endHour,
    isActive: e.isActive,
    startSlot: e.startSlot ?? e.startHour * 2,
    endSlot: e.endSlot ?? e.endHour * 2,
  }));

  const blockInputs = blocks.map((b) => ({
    type: b.type,
    machine: b.machine,
    startTime: b.startTime,
    endTime: b.endTime,
    printCompletedAt: b.printCompletedAt,
    createdAt: b.createdAt,
  }));

  // Per-machine metrics
  const machines: Record<string, { plannedCapacity: number; freeHours: number; availableHours: number }> = {};

  for (const machine of MACHINES) {
    const availableHours = computeAvailableHours(machine, rangeStart, rangeEnd, templates, exceptions);
    // All block types count as planned
    const plannedHours = blocks
      .filter((b) => b.machine === machine)
      .reduce((sum, b) => sum + (b.endTime.getTime() - b.startTime.getTime()) / (1000 * 60 * 60), 0);
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
      const avail = computeAvailableHours(machine, cur, cur, templates, exceptions);
      const planned = dayBlocks
        .filter((b) => b.machine === machine)
        .reduce((sum, b) => sum + (b.endTime.getTime() - b.startTime.getTime()) / (1000 * 60 * 60), 0);
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
