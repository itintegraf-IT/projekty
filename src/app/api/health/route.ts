import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// Neautentizovaný liveness probe pro monitoring (curl z health-check cronu).
// ZÁMĚRNĚ neprozrazuje žádné detaily — endpoint je veřejný (výjimka
// v src/middleware.ts). Datově-integritní kontroly pro adminy jsou
// v /api/report/health.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    logger.error("[GET /api/health] DB probe selhal", err);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
