import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { isAppError, errorStatus } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { runHealthChecks } from "@/lib/healthChecks.server";

export async function GET() {
  try {
    // Reporty vidí ADMIN i PLANOVAT, shodně s dashboardem a stavovým pásem.
    // Middleware tuhle cestu nejmenuje — je to JEDINÁ ochrana.
    await requireRole(["ADMIN", "PLANOVAT"]);
    const result = await runHealthChecks(prisma, new Date());
    return NextResponse.json(result);
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    logger.error("[GET /api/report/health] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
