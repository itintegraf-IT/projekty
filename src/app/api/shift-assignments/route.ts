import { NextResponse } from "next/server";
import { AppError, isAppError, errorStatus } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { SHIFTS, type ShiftType } from "@/lib/shifts";
import { weekStartFromDate } from "@/lib/shiftRoster";

export async function GET(req: Request) {
  try {
    await requireRole(["ADMIN", "PLANOVAT"]);

    const url = new URL(req.url);
    const weekStartStr = url.searchParams.get("weekStart");
    const machine = url.searchParams.get("machine");

    if (!weekStartStr) throw new AppError("VALIDATION_ERROR", "weekStart je povinný.");
    const weekStart = weekStartFromDate(new Date(weekStartStr + "T00:00:00.000Z"));
    if (Number.isNaN(weekStart.getTime())) throw new AppError("VALIDATION_ERROR", "Neplatný weekStart.");
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

    const where: { date: { gte: Date; lt: Date }; machine?: string } = {
      date: { gte: weekStart, lt: weekEnd },
    };
    if (machine) where.machine = machine;

    const assignments = await prisma.shiftAssignment.findMany({
      where,
      include: { printer: true },
      orderBy: [{ date: "asc" }, { shift: "asc" }, { sortOrder: "asc" }],
    });

    return NextResponse.json(assignments);
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    }
    logger.error("[shift-assignments.GET] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireRole(["ADMIN", "PLANOVAT"]);

    const body = (await req.json()) as {
      machine?: string;
      date?: string;
      shift?: string;
      printerId?: number;
      note?: string | null;
      sortOrder?: number;
    };

    if (!body.machine || !body.date || !body.shift || !body.printerId) {
      throw new AppError("VALIDATION_ERROR", "machine, date, shift, printerId jsou povinné.");
    }
    if (!SHIFTS.includes(body.shift as ShiftType)) {
      throw new AppError("VALIDATION_ERROR", "Neplatný shift (MORNING/AFTERNOON/NIGHT).");
    }
    const date = new Date(body.date + "T00:00:00.000Z");
    if (Number.isNaN(date.getTime())) throw new AppError("VALIDATION_ERROR", "Neplatné datum.");

    const assignment = await prisma.shiftAssignment.upsert({
      where: {
        machine_date_shift_printerId: {
          machine: body.machine,
          date,
          shift: body.shift,
          printerId: body.printerId,
        },
      },
      create: {
        machine: body.machine,
        date,
        shift: body.shift,
        printerId: body.printerId,
        note: body.note ?? null,
        sortOrder: body.sortOrder ?? 0,
      },
      update: {
        note: body.note ?? null,
        sortOrder: body.sortOrder ?? 0,
      },
      include: { printer: true },
    });

    logger.info("[shift-assignments.POST] upsert", { id: assignment.id, by: user.username });
    return NextResponse.json(assignment);
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    }
    logger.error("[shift-assignments.POST] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
