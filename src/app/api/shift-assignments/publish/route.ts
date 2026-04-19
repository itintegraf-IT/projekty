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

    const body = (await req.json()) as { weekStart?: string };
    if (!body.weekStart) throw new AppError("VALIDATION_ERROR", "weekStart je povinný.");

    const start = weekStartFromDate(new Date(body.weekStart + "T00:00:00.000Z"));
    if (Number.isNaN(start.getTime())) throw new AppError("VALIDATION_ERROR", "Neplatný weekStart.");
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);

    const result = await prisma.shiftAssignment.updateMany({
      where: { date: { gte: start, lt: end }, publishedAt: null },
      data: { publishedAt: new Date() },
    });

    logger.info("[shift-assignments.publish]", {
      weekStart: body.weekStart,
      updated: result.count,
      by: user.username,
    });
    return NextResponse.json({ published: result.count });
  } catch (err) {
    if (isAppError(err)) {
      const status = err.code === "FORBIDDEN" ? 403 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    logger.error("[shift-assignments.publish] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
