import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

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

  const { startDate, endDate, label } = await req.json();
  if (!startDate || !endDate || !label) {
    return NextResponse.json({ error: "Chybí povinná pole" }, { status: 400 });
  }
  const day = await prisma.companyDay.create({
    data: {
      startDate: new Date(startDate),
      endDate:   new Date(endDate),
      label,
    },
  });
  return NextResponse.json(day, { status: 201 });
}
