import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseCompanyDayDateTimeInput, serializeCompanyDay } from "@/lib/companyDaySerialization";

const VALID_MACHINES = ["XL_105", "XL_106"] as const;

export async function GET() {
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
  if (machine != null && !VALID_MACHINES.includes(machine)) {
    return NextResponse.json({ error: "Neplatná hodnota stroje" }, { status: 400 });
  }

  const parsedStart = parseCompanyDayDateTimeInput(startDate);
  const parsedEnd = parseCompanyDayDateTimeInput(endDate);
  if (!parsedStart || !parsedEnd) {
    return NextResponse.json({ error: "Neplatný formát datumu a času" }, { status: 400 });
  }

  const day = await prisma.companyDay.create({
    data: { startDate: parsedStart, endDate: parsedEnd, label, machine: machine ?? null },
  });
  return NextResponse.json(serializeCompanyDay(day), { status: 201 });
}
