import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const days = await prisma.companyDay.findMany({ orderBy: { startDate: "asc" } });
  return NextResponse.json(days);
}

export async function POST(req: Request) {
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
