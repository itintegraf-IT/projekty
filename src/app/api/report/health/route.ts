import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { isAppError, errorStatus } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { runHealthChecks } from "@/lib/healthChecks.server";

export async function GET() {
  try {
    await requireRole(["ADMIN"]);
    const result = await runHealthChecks(prisma, new Date());
    return NextResponse.json(result);
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    logger.error("[GET /api/report/health] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
