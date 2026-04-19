import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { weekStartFromDate } from "@/lib/shiftRoster";

export async function POST(req: Request) {
  try {
    const user = await getSession();
    if (!user) throw new AppError("FORBIDDEN", "Nepřihlášený uživatel.");
    if (!["ADMIN", "PLANOVAT"].includes(user.role)) throw new AppError("FORBIDDEN", "Nedostatečné oprávnění.");

    const body = (await req.json()) as {
      fromWeekStart?: string;
      toWeekStart?: string;
      overwrite?: boolean;
    };

    if (!body.fromWeekStart || !body.toWeekStart) {
      throw new AppError("VALIDATION_ERROR", "fromWeekStart a toWeekStart jsou povinné.");
    }

    const from = weekStartFromDate(new Date(body.fromWeekStart + "T00:00:00.000Z"));
    const to = weekStartFromDate(new Date(body.toWeekStart + "T00:00:00.000Z"));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new AppError("VALIDATION_ERROR", "Neplatný weekStart.");
    }
    const fromEnd = new Date(from);
    fromEnd.setUTCDate(fromEnd.getUTCDate() + 7);
    const toEnd = new Date(to);
    toEnd.setUTCDate(toEnd.getUTCDate() + 7);
    const dayDiffMs = to.getTime() - from.getTime();

    const source = await prisma.shiftAssignment.findMany({
      where: { date: { gte: from, lt: fromEnd } },
    });

    const existingInTarget = await prisma.shiftAssignment.findMany({
      where: { date: { gte: to, lt: toEnd } },
      select: { id: true },
    });

    if (existingInTarget.length > 0 && !body.overwrite) {
      return NextResponse.json(
        {
          error: "Cílový týden obsahuje existující přiřazení.",
          existingCount: existingInTarget.length,
          needsOverwrite: true,
        },
        { status: 409 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      if (body.overwrite && existingInTarget.length > 0) {
        await tx.shiftAssignment.deleteMany({
          where: { date: { gte: to, lt: toEnd } },
        });
      }
      const created = await tx.shiftAssignment.createMany({
        data: source.map((a) => ({
          machine: a.machine,
          date: new Date(a.date.getTime() + dayDiffMs),
          shift: a.shift,
          printerId: a.printerId,
          note: a.note,
          sortOrder: a.sortOrder,
          publishedAt: null,
        })),
        skipDuplicates: true,
      });
      return created.count;
    });

    logger.info("[shift-assignments.copy-week]", {
      from: body.fromWeekStart,
      to: body.toWeekStart,
      copied: result,
      by: user.username,
    });
    return NextResponse.json({ copied: result });
  } catch (err) {
    if (isAppError(err)) {
      const status = err.code === "FORBIDDEN" ? 403 : err.code === "VALIDATION_ERROR" ? 400 : 409;
      return NextResponse.json({ error: err.message }, { status });
    }
    logger.error("[shift-assignments.copy-week] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
