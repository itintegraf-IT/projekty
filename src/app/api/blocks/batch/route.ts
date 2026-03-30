import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { checkScheduleViolationWithTemplates, serializeTemplates } from "@/lib/scheduleValidation";

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

  // Fetch existing blocks — needed for type check (only ZAKAZKA validated) and orderNumber for audit.
  const existingBlocks = await prisma.block.findMany({
    where: { id: { in: updates.map((u) => u.id) } },
    select: {
      id: true,
      type: true,
      machine: true,
      startTime: true,
      endTime: true,
      orderNumber: true,
    },
  });

  // Validate schedule — only for ZAKAZKA blocks (mirrors single-block PUT behaviour)
  const zakazkaUpdates = updates.filter((u) => {
    const existing = existingBlocks.find((b) => b.id === u.id);
    return existing?.type === "ZAKAZKA";
  });

  if (zakazkaUpdates.length > 0) {
    const machines = [...new Set(zakazkaUpdates.map((u) => u.machine))];
    const allStartMs = zakazkaUpdates.map((u) => new Date(u.startTime).getTime());
    const allEndMs   = zakazkaUpdates.map((u) => new Date(u.endTime).getTime());
    const rangeStart = new Date(Math.min(...allStartMs) - 24 * 60 * 60 * 1000);
    const rangeEnd   = new Date(Math.max(...allEndMs)   + 24 * 60 * 60 * 1000);

    const [rawTemplates, allExceptions, companyDays] = await Promise.all([
      prisma.machineWorkHoursTemplate.findMany({
        where: { machine: { in: machines } },
        include: { days: true },
      }),
      prisma.machineScheduleException.findMany({
        where: { date: { gte: rangeStart, lte: rangeEnd } },
      }),
      prisma.companyDay.findMany({
        where: { startDate: { lt: new Date(Math.max(...allEndMs)) }, endDate: { gt: new Date(Math.min(...allStartMs)) } },
      }),
    ]);
    const templates = serializeTemplates(rawTemplates);

    for (const u of zakazkaUpdates) {
      const start = new Date(u.startTime);
      const end = new Date(u.endTime);
      const machineExceptions = allExceptions.filter((e) => e.machine === u.machine);
      const violation = checkScheduleViolationWithTemplates(u.machine, start, end, templates, machineExceptions);
      if (violation) {
        return NextResponse.json({ error: violation }, { status: 422 });
      }
      const cdConflict = companyDays.find(
        (cd) => (cd.machine === null || cd.machine === u.machine) && cd.startDate < end && cd.endDate > start
      );
      if (cdConflict) {
        return NextResponse.json({ error: "Blok zasahuje do plánované odstávky." }, { status: 422 });
      }
    }
  }

  try {
    const results = await prisma.$transaction(async (tx) => {
      const updated = await Promise.all(
        updates.map((u) =>
          tx.block.update({
            where: { id: u.id },
            data: {
              startTime: new Date(u.startTime),
              endTime: new Date(u.endTime),
              machine: u.machine,
            },
          })
        )
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

function isPrismaNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2025"
  );
}
