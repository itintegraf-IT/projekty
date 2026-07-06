import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseCompanyDayDateTimeInput, serializeCompanyDay } from "@/lib/companyDaySerialization";
import { detectCalendarDrift, notifyCalendarDrift } from "@/lib/calendarDrift.server";
import { emitSSE } from "@/lib/eventBus";
import { MACHINES } from "@/lib/machines";

export async function GET() {
  // Defense-in-depth: middleware neautentizované requesty redirectuje na /login,
  // ale API route má vracet čisté 401 (parita s ostatními /api routes).
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const days = await prisma.companyDay.findMany({ orderBy: { startDate: "asc" } });
  return NextResponse.json(days.map(serializeCompanyDay));
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { startDate, endDate, label, machine } = await req.json();
  if (!startDate || !endDate || !label) {
    return NextResponse.json({ error: "Chybí povinná pole" }, { status: 400 });
  }
  if (machine != null && !MACHINES.includes(machine)) {
    return NextResponse.json({ error: "Neplatná hodnota stroje" }, { status: 400 });
  }

  const parsedStart = parseCompanyDayDateTimeInput(startDate);
  const parsedEnd = parseCompanyDayDateTimeInput(endDate);
  if (!parsedStart || !parsedEnd) {
    return NextResponse.json({ error: "Neplatný formát datumu a času" }, { status: 400 });
  }
  if (parsedEnd.getTime() <= parsedStart.getTime()) {
    return NextResponse.json({ error: "Konec odstávky musí být po jejím začátku." }, { status: 400 });
  }

  const day = await prisma.$transaction(async (tx) => {
    const created = await tx.companyDay.create({
      data: { startDate: parsedStart, endDate: parsedEnd, label, machine: machine ?? null },
    });

    const machines = machine ? [machine] : [...MACHINES];
    const drifted = await detectCalendarDrift(tx, machines, parsedStart, parsedEnd, new Date());
    await notifyCalendarDrift(tx, drifted, session, `Odstávka „${label}"`);

    return created;
  });

  emitSSE("schedule:changed", { sourceUserId: session.id });
  return NextResponse.json(serializeCompanyDay(day), { status: 201 });
}
