import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseCompanyDayDateTimeInput, serializeCompanyDay } from "@/lib/companyDaySerialization";

const VALID_MACHINES = ["XL_105", "XL_106"] as const;

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

  const { startDate, endDate, label, machine } = await req.json();
  if (!startDate || !endDate || !label) {
    return NextResponse.json({ error: "Chybí povinná pole" }, { status: 400 });
  }
  if (machine != null && !VALID_MACHINES.includes(machine)) {
    return NextResponse.json({ error: "Neplatná hodnota stroje" }, { status: 400 });
  }

  const parsedStart = parseCompanyDayDateTimeInput(startDate);
  const parsedEnd = parseCompanyDayDateTimeInput(endDate);
  if (!parsedStart || !parsedEnd) {
    return NextResponse.json({ error: "Neplatný formát datumu a času" }, { status: 400 });
  }

  try {
    const updated = await prisma.companyDay.update({
      where: { id: numId },
      data: { startDate: parsedStart, endDate: parsedEnd, label, machine: machine ?? null },
    });
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
    await prisma.companyDay.delete({ where: { id: numId } });
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
