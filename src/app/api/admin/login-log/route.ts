import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { isAppError, errorStatus } from "@/lib/errors";
import { pragueToUTC, addDaysToCivilDate, todayPragueDateStr } from "@/lib/dateUtils";
import { buildLoginOverview } from "@/lib/loginLogStats";

export async function GET() {
  try {
    await requireRole(["ADMIN"]);

    const today = todayPragueDateStr();
    const todayStart = pragueToUTC(today, 0, 0);
    const weekStart = pragueToUTC(addDaysToCivilDate(today, -6), 0, 0);
    const d30Start = pragueToUTC(addDaysToCivilDate(today, -29), 0, 0);

    const [logs, users] = await Promise.all([
      prisma.loginLog.findMany({
        where: { createdAt: { gte: d30Start } },
        select: { userId: true, username: true, success: true, createdAt: true },
      }),
      prisma.user.findMany({ select: { id: true, username: true, role: true } }),
    ]);

    const overview = buildLoginOverview(logs, users, {
      todayStart,
      weekStart,
      d7Start: weekStart,
    });
    return NextResponse.json(overview);
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    }
    logger.error("[GET /api/admin/login-log] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
