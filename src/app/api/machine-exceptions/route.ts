import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  getSlotRange,
  isValidSlotWindow,
  legacyHoursFromSlots,
  slotToHour,
} from "@/lib/timeSlots";

function serializeException(e: {
  id: number;
  machine: string;
  date: Date;
  startHour: number;
  endHour: number;
  startSlot: number | null;
  endSlot: number | null;
  isActive: boolean;
  label: string | null;
  createdAt: Date;
}) {
  const { startSlot, endSlot } = getSlotRange(e);
  return {
    ...e,
    startHour: slotToHour(startSlot),
    endHour: slotToHour(endSlot),
    startSlot,
    endSlot,
    date: e.date.toISOString(),
    createdAt: e.createdAt.toISOString(),
  };
}

// GET — any authenticated session
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const exceptions = await prisma.machineScheduleException.findMany({
    orderBy: [{ date: "asc" }, { machine: "asc" }],
  });

  const serialized = exceptions.map(serializeException);

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
  const { machine, date, isActive, label } = body;
  let startSlot: number;
  let endSlot: number;
  try {
    ({ startSlot, endSlot } = getSlotRange(body));
  } catch {
    return NextResponse.json({ error: "Chybí startSlot/endSlot nebo startHour/endHour" }, { status: 400 });
  }

  if (!machine || !date) {
    return NextResponse.json({ error: "machine a date jsou povinné" }, { status: 400 });
  }
  if (!isValidSlotWindow(startSlot, endSlot)) {
    return NextResponse.json({ error: "Neplatný rozsah startSlot/endSlot" }, { status: 400 });
  }

  // Datum jako YYYY-MM-DD string (klient posílá lokální datum) → UTC midnight.
  // Záměrně nepoužíváme getFullYear/getMonth/getDate — ty by na UTC serveru
  // převedly CZ půlnoc (= "předchozí UTC den T23:00Z") na špatný den.
  const datePart = String(date).slice(0, 10); // "YYYY-MM-DD"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return NextResponse.json({ error: "date musí být ve formátu YYYY-MM-DD" }, { status: 400 });
  }
  const utcMidnight = new Date(datePart + "T00:00:00.000Z");
  const legacyHours = legacyHoursFromSlots(startSlot, endSlot);

  const exception = await prisma.machineScheduleException.upsert({
    where: { machine_date: { machine, date: utcMidnight } },
    update: {
      startHour: legacyHours.startHour,
      endHour: legacyHours.endHour,
      startSlot,
      endSlot,
      isActive: isActive ?? true,
      label: label ?? null,
    },
    create: {
      machine,
      date: utcMidnight,
      startHour: legacyHours.startHour,
      endHour: legacyHours.endHour,
      startSlot,
      endSlot,
      isActive: isActive ?? true,
      label: label ?? null,
    },
  });

  return NextResponse.json(serializeException(exception));
}
