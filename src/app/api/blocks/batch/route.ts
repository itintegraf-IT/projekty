import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type BatchUpdate = {
  id: number;
  startTime: string;
  endTime: string;
  machine: string;
};

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let updates: BatchUpdate[];
  try {
    const body = await request.json();
    if (!Array.isArray(body.updates) || body.updates.length === 0) {
      return NextResponse.json({ error: "updates musí být neprázdné pole" }, { status: 400 });
    }
    updates = body.updates;
  } catch {
    return NextResponse.json({ error: "Neplatný JSON" }, { status: 400 });
  }

  // Basic time sanity check before hitting DB
  for (const u of updates) {
    const start = new Date(u.startTime);
    const end = new Date(u.endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      return NextResponse.json({ error: `Neplatné časy pro blok ${u.id}` }, { status: 400 });
    }
  }

  // Fetch existing blocks — needed for type check (only ZAKAZKA validated), PRINT_RESET check,
  // and orderNumber for audit.
  const existingBlocks = await prisma.block.findMany({
    where: { id: { in: updates.map((u) => u.id) } },
    select: {
      id: true,
      type: true,
      machine: true,
      startTime: true,
      endTime: true,
      printCompletedAt: true,
      printCompletedByUserId: true,
      printCompletedByUsername: true,
      orderNumber: true,
    },
  });

  // Validate schedule — only for ZAKAZKA blocks (mirrors single-block PUT behaviour)
  const zakazkaUpdates = updates.filter((u) => {
    const existing = existingBlocks.find((b) => b.id === u.id);
    return existing?.type === "ZAKAZKA";
  });

  if (zakazkaUpdates.length > 0) {
    const [schedule, allExceptions] = await Promise.all([
      prisma.machineWorkHours.findMany(),
      prisma.machineScheduleException.findMany({
        where: {
          date: {
            gte: new Date(
              Math.min(...zakazkaUpdates.map((u) => new Date(u.startTime).getTime())) - 24 * 60 * 60 * 1000
            ),
            lte: new Date(
              Math.max(...zakazkaUpdates.map((u) => new Date(u.endTime).getTime())) + 24 * 60 * 60 * 1000
            ),
          },
        },
      }),
    ]);

    for (const u of zakazkaUpdates) {
      const start = new Date(u.startTime);
      const end = new Date(u.endTime);
      const machineSchedule = schedule.filter((r) => r.machine === u.machine);
      const machineExceptions = allExceptions.filter((e) => e.machine === u.machine);
      const violation = checkScheduleViolation(start, end, machineSchedule, machineExceptions);
      if (violation) {
        return NextResponse.json({ error: violation }, { status: 422 });
      }
    }
  }

  try {
    const results = await prisma.$transaction(async (tx) => {
      const updated = await Promise.all(
        updates.map((u) => {
          const old = existingBlocks.find((b) => b.id === u.id);
          const timingActuallyChanged =
            old != null &&
            (new Date(u.startTime).getTime() !== old.startTime.getTime() ||
              new Date(u.endTime).getTime() !== old.endTime.getTime() ||
              u.machine !== old.machine);
          const needsPrintReset = timingActuallyChanged && old?.printCompletedAt != null;

          return tx.block.update({
            where: { id: u.id },
            data: {
              startTime: new Date(u.startTime),
              endTime: new Date(u.endTime),
              machine: u.machine,
              ...(needsPrintReset && {
                printCompletedAt: null,
                printCompletedByUserId: null,
                printCompletedByUsername: null,
              }),
            },
          });
        })
      );

      const auditRows: {
        blockId: number;
        orderNumber: string | null;
        userId: number;
        username: string;
        action: string;
        field?: string;
        oldValue?: string;
        newValue?: string;
      }[] = [];

      for (const u of updates) {
        const old = existingBlocks.find((b) => b.id === u.id);
        const updatedBlock = updated.find((b) => b.id === u.id);
        const orderNumber = updatedBlock?.orderNumber ?? old?.orderNumber ?? null;

        auditRows.push({
          blockId: u.id,
          orderNumber,
          userId: session.id,
          username: session.username,
          action: "UPDATE",
          field: "startTime/endTime/machine",
          oldValue: undefined,
          newValue: `${u.machine} ${u.startTime}–${u.endTime}`,
        });

        const needsPrintReset =
          old != null &&
          old.printCompletedAt != null &&
          (new Date(u.startTime).getTime() !== old.startTime.getTime() ||
            new Date(u.endTime).getTime() !== old.endTime.getTime() ||
            u.machine !== old.machine);

        if (needsPrintReset) {
          auditRows.push({
            blockId: u.id,
            orderNumber,
            userId: session.id,
            username: session.username,
            action: "PRINT_RESET",
            field: "printCompletedAt",
            oldValue: String(old?.printCompletedByUsername ?? ""),
            newValue: "",
          });
        }
      }

      await tx.auditLog.createMany({ data: auditRows });

      return updated;
    });

    return NextResponse.json(results);
  } catch (error: unknown) {
    if (isPrismaNotFound(error)) {
      return NextResponse.json({ error: "Jeden nebo více bloků nenalezeno" }, { status: 404 });
    }
    console.error("[POST /api/blocks/batch]", error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}

// Business-time helper — hodiny a den týdne vždy v Europe/Prague
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

function checkScheduleViolation(
  startTime: Date,
  endTime: Date,
  schedule: { dayOfWeek: number; startHour: number; endHour: number; isActive: boolean }[],
  exceptions: { date: Date; startHour: number; endHour: number; isActive: boolean }[]
): string | null {
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

function isPrismaNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2025"
  );
}
