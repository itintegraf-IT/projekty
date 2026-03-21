import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// GET — any authenticated session
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const exceptions = await prisma.machineScheduleException.findMany({
    orderBy: [{ date: "asc" }, { machine: "asc" }],
  });

  const serialized = exceptions.map((e) => ({
    ...e,
    date: e.date.toISOString(),
    createdAt: e.createdAt.toISOString(),
  }));

  return NextResponse.json(serialized);
}

// POST — ADMIN nebo PLANOVAT — upsert výjimky pro konkrétní datum + stroj
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { machine, date, startHour, endHour, isActive, label } = body;

  if (!machine || !date) {
    return NextResponse.json({ error: "machine a date jsou povinné" }, { status: 400 });
  }
  if (typeof startHour !== "number" || startHour < 0 || startHour > 23) {
    return NextResponse.json({ error: "startHour musí být 0–23" }, { status: 400 });
  }
  if (typeof endHour !== "number" || endHour < 1 || endHour > 24) {
    return NextResponse.json({ error: "endHour musí být 1–24" }, { status: 400 });
  }
  if (isActive !== false && startHour >= endHour) {
    return NextResponse.json({ error: "startHour musí být menší než endHour" }, { status: 400 });
  }

  // Datum jako YYYY-MM-DD string (klient posílá lokální datum) → UTC midnight.
  // Záměrně nepoužíváme getFullYear/getMonth/getDate — ty by na UTC serveru
  // převedly CZ půlnoc (= "předchozí UTC den T23:00Z") na špatný den.
  const datePart = String(date).slice(0, 10); // "YYYY-MM-DD"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return NextResponse.json({ error: "date musí být ve formátu YYYY-MM-DD" }, { status: 400 });
  }
  const utcMidnight = new Date(datePart + "T00:00:00.000Z");

  const exception = await prisma.machineScheduleException.upsert({
    where: { machine_date: { machine, date: utcMidnight } },
    update: { startHour, endHour, isActive: isActive ?? true, label: label ?? null },
    create: { machine, date: utcMidnight, startHour, endHour, isActive: isActive ?? true, label: label ?? null },
  });

  return NextResponse.json({
    ...exception,
    date: exception.date.toISOString(),
    createdAt: exception.createdAt.toISOString(),
  });
}
