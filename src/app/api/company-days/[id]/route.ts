import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseCompanyDayDateTimeInput, serializeCompanyDay } from "@/lib/companyDaySerialization";
import { detectCalendarDrift, notifyCalendarDrift } from "@/lib/calendarDrift.server";
import { emitSSE } from "@/lib/eventBus";
import { MACHINES } from "@/lib/machines";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  const putBody = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { startDate, endDate, label, machine } = putBody as {
    startDate?: string; endDate?: string; label?: string; machine?: string | null;
  };
  if (!startDate || !endDate || !label) {
    return NextResponse.json({ error: "Chybí povinná pole" }, { status: 400 });
  }
  if (machine != null && !(MACHINES as readonly string[]).includes(machine)) {
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

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.companyDay.findUnique({ where: { id: numId } });
      if (!existing) {
        throw Object.assign(new Error("Company day not found"), { code: "P2025" });
      }

      const result = await tx.companyDay.update({
        where: { id: numId },
        data: { startDate: parsedStart, endDate: parsedEnd, label, machine: machine ?? null },
      });

      // Union starého a nového intervalu/stroje — zrušení/zkrácení odstávky mění kalendář
      // stejně jako přidání, takže drift může vzniknout na obou koncích úpravy.
      const windowStart = existing.startDate.getTime() < parsedStart.getTime() ? existing.startDate : parsedStart;
      const windowEnd = existing.endDate.getTime() > parsedEnd.getTime() ? existing.endDate : parsedEnd;
      const machines =
        existing.machine === null || machine == null
          ? [...MACHINES]
          : Array.from(new Set([existing.machine, machine]));

      const drifted = await detectCalendarDrift(tx, machines, windowStart, windowEnd, new Date());
      await notifyCalendarDrift(tx, drifted, session, `Odstávka „${label}"`);

      return result;
    });

    emitSSE("schedule:changed", { sourceUserId: session.id });
    return NextResponse.json(serializeCompanyDay(updated));
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "P2025") {
      return NextResponse.json({ error: "Záznam nenalezen" }, { status: 404 });
    }
    logger.error("Company day update failed", err);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.companyDay.findUnique({ where: { id: numId } });
      if (!existing) {
        throw Object.assign(new Error("Company day not found"), { code: "P2025" });
      }

      await tx.companyDay.delete({ where: { id: numId } });

      const machines = existing.machine === null ? [...MACHINES] : [existing.machine];
      const drifted = await detectCalendarDrift(tx, machines, existing.startDate, existing.endDate, new Date());
      await notifyCalendarDrift(tx, drifted, session, `Zrušení odstávky „${existing.label}"`);
    });

    emitSSE("schedule:changed", { sourceUserId: session.id });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "P2025") {
      return NextResponse.json({ error: "Záznam nenalezen" }, { status: 404 });
    }
    logger.error("Company day delete failed", err);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
