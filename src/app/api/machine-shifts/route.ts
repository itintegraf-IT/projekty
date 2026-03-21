import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.machineWorkHours.findMany({
    orderBy: [{ machine: "asc" }, { dayOfWeek: "asc" }],
  });
  return NextResponse.json(rows);
}

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows: { id: number; startHour: number; endHour: number; isActive: boolean }[] =
    await req.json();

  // Validace
  for (const r of rows) {
    if (r.startHour < 0 || r.startHour > 23)
      return NextResponse.json({ error: "Neplatný startHour" }, { status: 400 });
    if (r.endHour < 1 || r.endHour > 24)
      return NextResponse.json({ error: "Neplatný endHour" }, { status: 400 });
    if (r.isActive && r.startHour >= r.endHour)
      return NextResponse.json({ error: "startHour musí být menší než endHour" }, { status: 400 });
  }

  const updated = await prisma.$transaction(
    rows.map((r) =>
      prisma.machineWorkHours.update({
        where: { id: r.id },
        data: { startHour: r.startHour, endHour: r.endHour, isActive: r.isActive },
      })
    )
  );

  return NextResponse.json(updated);
}
