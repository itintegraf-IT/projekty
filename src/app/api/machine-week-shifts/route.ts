import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { civilDateToUTCMidnight, parseCivilDateWriteInput, normalizeCivilDateInput } from "@/lib/dateUtils";
import { emitSSE } from "@/lib/eventBus";
import { weekStartStrFromDateStr, type MachineWeekShiftsRow } from "@/lib/machineWeekShifts";

function errorStatus(code: string): number {
  if (code === "FORBIDDEN") return 403;
  if (code === "NOT_FOUND") return 404;
  if (code === "VALIDATION_ERROR") return 400;
  if (code === "CONFLICT" || code === "OVERLAP") return 409;
  return 500;
}

const MACHINES = ["XL_105", "XL_106"] as const;

type DayInput = {
  dayOfWeek: number;
  isActive?: boolean;
  morningOn?: boolean;
  afternoonOn?: boolean;
  nightOn?: boolean;
};

type DbRow = {
  id: number;
  machine: string;
  weekStart: Date;
  dayOfWeek: number;
  isActive: boolean;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
};

function serializeRow(r: DbRow): MachineWeekShiftsRow {
  return {
    id: r.id,
    machine: r.machine,
    weekStart: normalizeCivilDateInput(r.weekStart)!,
    dayOfWeek: r.dayOfWeek,
    isActive: r.isActive,
    morningOn: r.morningOn,
    afternoonOn: r.afternoonOn,
    nightOn: r.nightOn,
  };
}

function addDaysStr(dateStr: string, days: number): string {
  const utc = civilDateToUTCMidnight(dateStr);
  utc.setUTCDate(utc.getUTCDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

/**
 * Pro stroje, které nemají žádný záznam pro `weekStart`,
 * auto-seedni 7 řádků z předchozího týdne (nebo prázdné, pokud ani ten není).
 * Používá $transaction + createMany (skipDuplicates pro idempotenci).
 */
async function ensureWeekSeeded(weekStartStr: string): Promise<void> {
  const weekStartDate = civilDateToUTCMidnight(weekStartStr);
  const existing = await prisma.machineWeekShifts.findMany({
    where: { weekStart: weekStartDate },
    select: { machine: true },
  });
  const existingMachines = new Set(existing.map((r) => r.machine));
  const missingMachines = MACHINES.filter((m) => !existingMachines.has(m));
  if (missingMachines.length === 0) return;

  const prevWeekStr = addDaysStr(weekStartStr, -7);
  const prevWeekDate = civilDateToUTCMidnight(prevWeekStr);
  const prevRows = await prisma.machineWeekShifts.findMany({
    where: { machine: { in: [...missingMachines] }, weekStart: prevWeekDate },
    orderBy: { dayOfWeek: "asc" },
  });

  const seeds: Array<{
    machine: string;
    weekStart: Date;
    dayOfWeek: number;
    isActive: boolean;
    morningOn: boolean;
    afternoonOn: boolean;
    nightOn: boolean;
  }> = [];

  for (const machine of missingMachines) {
    for (let dow = 0; dow < 7; dow++) {
      const prev = prevRows.find((r) => r.machine === machine && r.dayOfWeek === dow);
      const morningOn = prev?.morningOn ?? false;
      const afternoonOn = prev?.afternoonOn ?? false;
      const nightOn = prev?.nightOn ?? false;
      seeds.push({
        machine,
        weekStart: weekStartDate,
        dayOfWeek: dow,
        isActive: morningOn || afternoonOn || nightOn,
        morningOn,
        afternoonOn,
        nightOn,
      });
    }
  }

  if (seeds.length === 0) return;
  await prisma.machineWeekShifts.createMany({ data: seeds, skipDuplicates: true });
  logger.info("[machine-week-shifts] auto-seeded week", { weekStart: weekStartStr, count: seeds.length });
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(req.url);
    const weekStartParam = url.searchParams.get("weekStart");
    if (!weekStartParam) throw new AppError("VALIDATION_ERROR", "Chybí parametr weekStart (YYYY-MM-DD)");
    const parsed = parseCivilDateWriteInput(weekStartParam);
    if (!parsed) throw new AppError("VALIDATION_ERROR", "Neplatný weekStart");
    if (parsed !== weekStartStrFromDateStr(parsed))
      throw new AppError("VALIDATION_ERROR", "weekStart musí být pondělí");

    await ensureWeekSeeded(parsed);

    const rows = await prisma.machineWeekShifts.findMany({
      where: { weekStart: civilDateToUTCMidnight(parsed) },
      orderBy: [{ machine: "asc" }, { dayOfWeek: "asc" }],
    });
    return NextResponse.json(rows.map(serializeRow));
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    logger.error("[machine-week-shifts GET] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = (await req.json()) as {
      machine?: string;
      weekStart?: string;
      days?: DayInput[];
    };

    if (!body.machine || typeof body.machine !== "string")
      throw new AppError("VALIDATION_ERROR", "Chybí machine");
    if (!MACHINES.includes(body.machine as (typeof MACHINES)[number]))
      throw new AppError("VALIDATION_ERROR", `Neznámý stroj: ${body.machine}`);

    const parsedWeek = body.weekStart ? parseCivilDateWriteInput(body.weekStart) : null;
    if (!parsedWeek) throw new AppError("VALIDATION_ERROR", "Neplatný weekStart");
    if (parsedWeek !== weekStartStrFromDateStr(parsedWeek))
      throw new AppError("VALIDATION_ERROR", "weekStart musí být pondělí");

    if (!Array.isArray(body.days) || body.days.length !== 7)
      throw new AppError("VALIDATION_ERROR", "days musí obsahovat právě 7 položek");

    const seenDow = new Set<number>();
    const normalized = body.days.map((d) => {
      if (!Number.isInteger(d.dayOfWeek) || d.dayOfWeek < 0 || d.dayOfWeek > 6)
        throw new AppError("VALIDATION_ERROR", "dayOfWeek musí být 0–6");
      if (seenDow.has(d.dayOfWeek)) throw new AppError("VALIDATION_ERROR", "Duplicitní dayOfWeek");
      seenDow.add(d.dayOfWeek);
      const morningOn = Boolean(d.morningOn);
      const afternoonOn = Boolean(d.afternoonOn);
      const nightOn = Boolean(d.nightOn);
      return {
        dayOfWeek: d.dayOfWeek,
        isActive: morningOn || afternoonOn || nightOn,
        morningOn,
        afternoonOn,
        nightOn,
      };
    });
    if (seenDow.size !== 7) throw new AppError("VALIDATION_ERROR", "Musí být všech 7 dayOfWeek (0–6)");

    const machine = body.machine;
    const weekStartDate = civilDateToUTCMidnight(parsedWeek);

    const existing = await prisma.machineWeekShifts.findMany({
      where: { machine, weekStart: weekStartDate },
    });

    // Kompaktní kódování: jeden znak na směnu (M/A/N pokud zapnutá, - jinak),
    // prefix "x" pokud day !isActive. Formát: "po:mAN|út:---|...".
    const DAY_CODES = ["ne", "po", "út", "st", "čt", "pá", "so"];
    const encodeDay = (r: { dayOfWeek: number; isActive: boolean; morningOn: boolean; afternoonOn: boolean; nightOn: boolean }) => {
      const flags = (r.morningOn ? "M" : "-") + (r.afternoonOn ? "A" : "-") + (r.nightOn ? "N" : "-");
      return `${DAY_CODES[r.dayOfWeek]}:${r.isActive ? flags : "xxx"}`;
    };
    const emptyDays = Array.from({ length: 7 }, (_, dow) => ({
      dayOfWeek: dow, isActive: false, morningOn: false, afternoonOn: false, nightOn: false,
    }));
    const beforeSorted = (existing.length > 0 ? existing : emptyDays)
      .slice()
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    const afterSorted = normalized.slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    const beforePayload = beforeSorted.map(encodeDay).join("|");
    const afterPayload = `${machine} ${parsedWeek} ${afterSorted.map(encodeDay).join("|")}`;

    await prisma.$transaction([
      ...normalized.map((d) =>
        prisma.machineWeekShifts.upsert({
          where: {
            machine_weekStart_dayOfWeek: {
              machine,
              weekStart: weekStartDate,
              dayOfWeek: d.dayOfWeek,
            },
          },
          create: {
            machine,
            weekStart: weekStartDate,
            dayOfWeek: d.dayOfWeek,
            isActive: d.isActive,
            morningOn: d.morningOn,
            afternoonOn: d.afternoonOn,
            nightOn: d.nightOn,
          },
          update: {
            isActive: d.isActive,
            morningOn: d.morningOn,
            afternoonOn: d.afternoonOn,
            nightOn: d.nightOn,
          },
        })
      ),
      prisma.auditLog.create({
        data: {
          blockId: 0,
          userId: session.id,
          username: session.username,
          action: "UPDATE",
          field: "MachineWeekShifts",
          oldValue: beforePayload,
          newValue: afterPayload,
        },
      }),
    ]);

    const updated = await prisma.machineWeekShifts.findMany({
      where: { machine, weekStart: weekStartDate },
      orderBy: { dayOfWeek: "asc" },
    });

    emitSSE("schedule:changed", { sourceUserId: session.id });
    logger.info("[machine-week-shifts PUT] updated", { machine, weekStart: parsedWeek });
    return NextResponse.json(updated.map(serializeRow));
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    logger.error("[machine-week-shifts PUT] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
