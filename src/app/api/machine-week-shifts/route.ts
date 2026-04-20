import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { civilDateToUTCMidnight, parseCivilDateWriteInput, normalizeCivilDateInput } from "@/lib/dateUtils";
import { emitSSE } from "@/lib/eventBus";
import { weekStartStrFromDateStr, type MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { SHIFT_EDIT_RANGES, fmtHHMM } from "@/lib/shifts";
import { findConflictingBlocks } from "@/lib/findConflictingBlocks";
import { checkScheduleViolationWithTemplates } from "@/lib/scheduleValidation";
import { checkRateLimit } from "@/lib/rateLimiter";

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
  morningStartMin?: number | null;
  morningEndMin?: number | null;
  afternoonStartMin?: number | null;
  afternoonEndMin?: number | null;
  nightStartMin?: number | null;
  nightEndMin?: number | null;
};

function validateOverrideMin(value: number | null | undefined, range: readonly [number, number], label: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value)) throw new AppError("VALIDATION_ERROR", `${label} musí být celé číslo minut`);
  if (value % 30 !== 0) throw new AppError("VALIDATION_ERROR", `${label} musí být zarovnán na 30 min`);
  if (value < range[0] || value > range[1]) {
    throw new AppError("VALIDATION_ERROR", `${label} musí být v rozsahu ${fmtHHMM(range[0])}–${fmtHHMM(range[1])}`);
  }
  return value;
}

type DbRow = {
  id: number;
  machine: string;
  weekStart: Date;
  dayOfWeek: number;
  isActive: boolean;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
  morningStartMin: number | null;
  morningEndMin: number | null;
  afternoonStartMin: number | null;
  afternoonEndMin: number | null;
  nightStartMin: number | null;
  nightEndMin: number | null;
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
    morningStartMin: r.morningStartMin,
    morningEndMin: r.morningEndMin,
    afternoonStartMin: r.afternoonStartMin,
    afternoonEndMin: r.afternoonEndMin,
    nightStartMin: r.nightStartMin,
    nightEndMin: r.nightEndMin,
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
    if (weekStartParam) {
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
    }

    // Bez parametru — vrátí všechny existující řádky (pro client-side refresh).
    const rows = await prisma.machineWeekShifts.findMany({
      orderBy: [{ machine: "asc" }, { weekStart: "asc" }, { dayOfWeek: "asc" }],
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

  const { allowed, retryAfterSeconds } = checkRateLimit("put-shifts", String(session.id), 60, 60 * 1000);
  if (!allowed) {
    return NextResponse.json(
      { error: `Příliš mnoho requestů. Zkuste znovu za ${retryAfterSeconds}s.` },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }

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

      const morningStartMin   = validateOverrideMin(d.morningStartMin, SHIFT_EDIT_RANGES.MORNING.start, "Ranní start");
      const morningEndMin     = validateOverrideMin(d.morningEndMin, SHIFT_EDIT_RANGES.MORNING.end, "Ranní konec");
      const afternoonStartMin = validateOverrideMin(d.afternoonStartMin, SHIFT_EDIT_RANGES.AFTERNOON.start, "Odpolední start");
      const afternoonEndMin   = validateOverrideMin(d.afternoonEndMin, SHIFT_EDIT_RANGES.AFTERNOON.end, "Odpolední konec");
      const nightStartMin     = validateOverrideMin(d.nightStartMin, SHIFT_EDIT_RANGES.NIGHT.start, "Noční start");
      const nightEndMin       = validateOverrideMin(d.nightEndMin, SHIFT_EDIT_RANGES.NIGHT.end, "Noční konec");

      // Sanity: MORNING/AFTERNOON start < end
      if (morningStartMin !== null && morningEndMin !== null && morningStartMin >= morningEndMin)
        throw new AppError("VALIDATION_ERROR", `Ranní start (${morningStartMin}) musí být před koncem (${morningEndMin})`);
      if (afternoonStartMin !== null && afternoonEndMin !== null && afternoonStartMin >= afternoonEndMin)
        throw new AppError("VALIDATION_ERROR", `Odpolední start musí být před koncem`);
      // NIGHT: startMin > endMin (cross midnight) — rozsahy hlídá validateOverrideMin.
      // NIGHT: cross-midnight. Start > end. Trvání = (1440 - start) + end.
      // Rozsah 360 min (6h) až 600 min (10h) — typická noční směna.
      if (nightStartMin !== null && nightEndMin !== null) {
        const duration = (1440 - nightStartMin) + nightEndMin;
        if (duration < 360 || duration > 600) {
          throw new AppError(
            "VALIDATION_ERROR",
            `Noční směna musí trvat 6–10 hodin (zadáno ${Math.floor(duration / 60)}h ${duration % 60}m)`,
          );
        }
      }

      return {
        dayOfWeek: d.dayOfWeek,
        isActive: morningOn || afternoonOn || nightOn,
        morningOn,
        afternoonOn,
        nightOn,
        morningStartMin,
        morningEndMin,
        afternoonStartMin,
        afternoonEndMin,
        nightStartMin,
        nightEndMin,
      };
    });
    if (seenDow.size !== 7) throw new AppError("VALIDATION_ERROR", "Musí být všech 7 dayOfWeek (0–6)");

    const machine = body.machine;
    const weekStartDate = civilDateToUTCMidnight(parsedWeek);

    const force = new URL(req.url).searchParams.get("force") === "1";
    if (!force) {
      const conflicts = await findConflictingBlocks(machine, parsedWeek, normalized);
      if (conflicts.length > 0) {
        return NextResponse.json(
          { error: "SHIFT_SHRINK_CASCADE", conflictingBlocks: conflicts },
          { status: 409 }
        );
      }
    }

    const existing = await prisma.machineWeekShifts.findMany({
      where: { machine, weekStart: weekStartDate },
    });

    // Kompaktní kódování: jeden znak na směnu (M/A/N pokud zapnutá, - jinak),
    // prefix "x" pokud day !isActive. Override hodnoty v závorce, např. "po:M--(Ms7:00,Me13:00)".
    const DAY_CODES = ["ne", "po", "út", "st", "čt", "pá", "so"];
    const encodeDay = (r: {
      dayOfWeek: number; isActive: boolean; morningOn: boolean; afternoonOn: boolean; nightOn: boolean;
      morningStartMin?: number | null; morningEndMin?: number | null;
      afternoonStartMin?: number | null; afternoonEndMin?: number | null;
      nightStartMin?: number | null; nightEndMin?: number | null;
    }) => {
      const shifts = (r.morningOn ? "M" : "-") + (r.afternoonOn ? "A" : "-") + (r.nightOn ? "N" : "-");
      const overrides = [
        r.morningStartMin !== null && r.morningStartMin !== undefined ? `Ms${fmtHHMM(r.morningStartMin)}` : "",
        r.morningEndMin !== null && r.morningEndMin !== undefined ? `Me${fmtHHMM(r.morningEndMin)}` : "",
        r.afternoonStartMin !== null && r.afternoonStartMin !== undefined ? `As${fmtHHMM(r.afternoonStartMin)}` : "",
        r.afternoonEndMin !== null && r.afternoonEndMin !== undefined ? `Ae${fmtHHMM(r.afternoonEndMin)}` : "",
        r.nightStartMin !== null && r.nightStartMin !== undefined ? `Ns${fmtHHMM(r.nightStartMin)}` : "",
        r.nightEndMin !== null && r.nightEndMin !== undefined ? `Ne${fmtHHMM(r.nightEndMin)}` : "",
      ].filter(Boolean).join(",");
      const base = r.isActive ? shifts : "xxx";
      return `${DAY_CODES[r.dayOfWeek]}:${base}${overrides ? `(${overrides})` : ""}`;
    };
    const emptyDays = Array.from({ length: 7 }, (_, dow) => ({
      dayOfWeek: dow, isActive: false, morningOn: false, afternoonOn: false, nightOn: false,
      morningStartMin: null, morningEndMin: null,
      afternoonStartMin: null, afternoonEndMin: null,
      nightStartMin: null, nightEndMin: null,
    }));
    const beforeSorted = (existing.length > 0 ? existing : emptyDays)
      .slice()
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    const afterSorted = normalized.slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    const beforePayload = beforeSorted.map(encodeDay).join("|");
    const afterPayload = `${machine} ${parsedWeek}${force ? " [FORCE]" : ""} ${afterSorted.map(encodeDay).join("|")}`;

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
            morningStartMin: d.morningStartMin,
            morningEndMin: d.morningEndMin,
            afternoonStartMin: d.afternoonStartMin,
            afternoonEndMin: d.afternoonEndMin,
            nightStartMin: d.nightStartMin,
            nightEndMin: d.nightEndMin,
          },
          update: {
            isActive: d.isActive,
            morningOn: d.morningOn,
            afternoonOn: d.afternoonOn,
            nightOn: d.nightOn,
            morningStartMin: d.morningStartMin,
            morningEndMin: d.morningEndMin,
            afternoonStartMin: d.afternoonStartMin,
            afternoonEndMin: d.afternoonEndMin,
            nightStartMin: d.nightStartMin,
            nightEndMin: d.nightEndMin,
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
    logger.info("[machine-week-shifts PUT] updated", { machine, weekStart: parsedWeek, force });
    return NextResponse.json(updated.map(serializeRow));
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    logger.error("[machine-week-shifts PUT] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
