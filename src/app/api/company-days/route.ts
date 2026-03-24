import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const VALID_MACHINES = ["XL_105", "XL_106"] as const;

export async function GET() {
  const days = await prisma.companyDay.findMany({ orderBy: { startDate: "asc" } });
  return NextResponse.json(days);
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

  const parsedStart = new Date(startDate);
  const parsedEnd   = new Date(endDate);
  if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
    return NextResponse.json({ error: "Neplatný formát datumu" }, { status: 400 });
  }

  const day = await prisma.companyDay.create({
    data: { startDate: parsedStart, endDate: parsedEnd, label, machine: machine ?? null },
  });
  return NextResponse.json(day, { status: 201 });
}
