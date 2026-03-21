import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(req.url);
    const machineParam = url.searchParams.get("machine");

    // TISKAR: vždy jen svůj stroj, ignorovat query param
    let machineFilter: string | undefined;
    if (session.role === "TISKAR") {
      if (!session.assignedMachine) {
        return NextResponse.json({ error: "Tiskař nemá přiřazený stroj" }, { status: 400 });
      }
      // Pokud TISKAR zkusil zadat jiný stroj, vrátit 403
      if (machineParam && machineParam !== session.assignedMachine) {
        return NextResponse.json({ error: "Forbidden — cizí stroj" }, { status: 403 });
      }
      machineFilter = session.assignedMachine;
    } else if (machineParam) {
      machineFilter = machineParam;
    }

    const blocks = await prisma.block.findMany({
      where: machineFilter ? { machine: machineFilter } : undefined,
      orderBy: { startTime: "asc" },
    });
    return NextResponse.json(blocks);
  } catch (error) {
    console.error("[GET /api/blocks]", error);
    return NextResponse.json({ error: "Chyba při načítání bloků" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();

    if (!body.orderNumber || !body.machine || !body.startTime || !body.endTime) {
      return NextResponse.json(
        { error: "Chybí povinné pole: orderNumber, machine, startTime, endTime" },
        { status: 400 }
      );
    }

    // Server-side validace pracovní doby (jen pro ZAKAZKA)
    const blockType = body.type ?? "ZAKAZKA";
    if (blockType === "ZAKAZKA") {
      const violation = await checkScheduleViolation(body.machine, new Date(body.startTime), new Date(body.endTime));
      if (violation) return NextResponse.json({ error: violation }, { status: 422 });
    }

    // Atomická transakce: block.create + auditLog.create buď oba projdou, nebo oba selžou
    const block = await prisma.$transaction(async (tx) => {
      const newBlock = await tx.block.create({
        data: {
          orderNumber: String(body.orderNumber),
          machine: body.machine,
          startTime: new Date(body.startTime),
          endTime: new Date(body.endTime),
          type: body.type ?? "ZAKAZKA",
          description: body.description ?? null,
          locked: body.locked ?? false,
          deadlineExpedice: body.deadlineExpedice ? new Date(body.deadlineExpedice) : null,
          // DATA
          dataStatusId: body.dataStatusId ?? null,
          dataStatusLabel: body.dataStatusLabel ?? null,
          dataRequiredDate: body.dataRequiredDate ? new Date(body.dataRequiredDate) : null,
          dataOk: body.dataOk ?? false,
          // MATERIÁL
          materialStatusId: body.materialStatusId ?? null,
          materialStatusLabel: body.materialStatusLabel ?? null,
          materialRequiredDate: body.materialRequiredDate ? new Date(body.materialRequiredDate) : null,
          materialOk: body.materialOk ?? false,
          // BARVY
          barvyStatusId: body.barvyStatusId ?? null,
          barvyStatusLabel: body.barvyStatusLabel ?? null,
          // LAK
          lakStatusId: body.lakStatusId ?? null,
          lakStatusLabel: body.lakStatusLabel ?? null,
          // SPECIFIKACE
          specifikace: body.specifikace ?? null,
          // OPAKOVÁNÍ
          recurrenceType: body.recurrenceType ?? "NONE",
          recurrenceParentId: body.recurrenceParentId ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          blockId: newBlock.id,
          orderNumber: newBlock.orderNumber,
          userId: session.id,
          username: session.username,
          action: "CREATE",
        },
      });

      return newBlock;
    });

    return NextResponse.json(block, { status: 201 });
  } catch (error) {
    console.error("[POST /api/blocks]", error);
    return NextResponse.json({ error: "Chyba při vytváření bloku" }, { status: 500 });
  }
}

// Business-time helper — hodiny a den týdne vždy v Europe/Prague, bez ohledu na
// timezone procesu. Výjimky jsou uloženy jako UTC midnight daného pražského kalendářního
// dne, takže porovnání excDate.toISOString().slice(0,10) === pragueDate funguje správně.
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const PRAGUE_FORMATTER = new Intl.DateTimeFormat("en", {
  timeZone: "Europe/Prague",
  year: "numeric", month: "2-digit", day: "2-digit",
  weekday: "short", hour: "2-digit", hour12: false,
});
function pragueOf(d: Date): { hour: number; dayOfWeek: number; dateStr: string } {
  const parts = PRAGUE_FORMATTER.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    hour: parseInt(get("hour"), 10),
    dayOfWeek: DOW_SHORT.indexOf(get("weekday") as typeof DOW_SHORT[number]),
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

// Ohraničení pro DB dotaz: vrací UTC midnight dne (exc jsou uloženy jako UTC midnight pražského dne)
function startOfDayUTC(d: Date): Date {
  return new Date(d.toISOString().slice(0, 10) + "T00:00:00.000Z");
}

async function checkScheduleViolation(machine: string, startTime: Date, endTime: Date): Promise<string | null> {
  const [schedule, exceptions] = await Promise.all([
    prisma.machineWorkHours.findMany({ where: { machine } }),
    // Lehce rozšířený rozsah (o den na každou stranu) kvůli UTC vs Prague posunu kolem půlnoci
    prisma.machineScheduleException.findMany({
      where: {
        machine,
        date: {
          gte: new Date(new Date(startTime).getTime() - 24 * 60 * 60 * 1000),
          lte: new Date(new Date(endTime).getTime()   + 24 * 60 * 60 * 1000),
        },
      },
    }),
  ]);
  if (schedule.length === 0 && exceptions.length === 0) return null;
  const SLOT_MS = 30 * 60 * 1000;
  let cur = new Date(startTime);
  while (cur < endTime) {
    const { hour, dayOfWeek, dateStr } = pragueOf(cur);
    const exc = exceptions.find((e) => new Date(e.date).toISOString().slice(0, 10) === dateStr);
    const row = exc ?? schedule.find((r) => r.dayOfWeek === dayOfWeek);
    if (row && (!row.isActive || hour < row.startHour || hour >= row.endHour)) {
      return "Blok zasahuje do doby mimo provoz stroje.";
    }
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return null;
}
