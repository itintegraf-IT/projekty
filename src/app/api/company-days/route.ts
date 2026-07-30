import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { parseCompanyDayDateTimeInput, serializeCompanyDay } from "@/lib/companyDaySerialization";
import { detectCalendarDrift, notifyCalendarDrift } from "@/lib/calendarDrift.server";
import { emitSSE } from "@/lib/eventBus";
import { MACHINES } from "@/lib/machines";

export async function GET() {
  try {
    // Defense-in-depth: middleware neautentizované requesty redirectuje na /login,
    // ale API route má vracet čisté 401 (parita s ostatními /api routes).
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const days = await prisma.companyDay.findMany({ orderBy: { startDate: "asc" } });
    return NextResponse.json(days.map(serializeCompanyDay));
  } catch (err) {
    logger.error("[GET /api/company-days] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { startDate, endDate, label, machine } = body as {
      startDate?: unknown; endDate?: unknown; label?: unknown; machine?: unknown;
    };
    if (!startDate || !endDate || !label) {
      return NextResponse.json({ error: "Chybí povinná pole" }, { status: 400 });
    }
    if (machine != null && !(MACHINES as readonly string[]).includes(machine as string)) {
      return NextResponse.json({ error: "Neplatná hodnota stroje" }, { status: 400 });
    }

    const parsedStart = parseCompanyDayDateTimeInput(String(startDate));
    const parsedEnd = parseCompanyDayDateTimeInput(String(endDate));
    if (!parsedStart || !parsedEnd) {
      return NextResponse.json({ error: "Neplatný formát datumu a času" }, { status: 400 });
    }
    if (parsedEnd.getTime() <= parsedStart.getTime()) {
      return NextResponse.json({ error: "Konec odstávky musí být po jejím začátku." }, { status: 400 });
    }

    const labelStr = String(label);
    const day = await prisma.$transaction(async (tx) => {
      const created = await tx.companyDay.create({
        data: { startDate: parsedStart, endDate: parsedEnd, label: labelStr, machine: (machine as string | null) ?? null },
      });

      const machines = machine ? [machine as string] : [...MACHINES];
      const drifted = await detectCalendarDrift(tx, machines, parsedStart, parsedEnd, new Date());
      await notifyCalendarDrift(tx, drifted, session, `Odstávka „${labelStr}"`);

      return created;
    });

    emitSSE("schedule:changed", { sourceUserId: session.id });
    return NextResponse.json(serializeCompanyDay(day), { status: 201 });
  } catch (err) {
    logger.error("[POST /api/company-days] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
