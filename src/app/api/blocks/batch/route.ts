import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { serializeBlock } from "@/lib/blockSerialization";
import { validateBlockScheduleFromDb } from "@/lib/scheduleValidationServer";
import { checkBlockOverlap } from "@/lib/overlapCheck";
import { AppError, isAppError } from "@/lib/errors";
import { emitSSE } from "@/lib/eventBus";

type BatchUpdate = {
  id: number;
  startTime: string;
  endTime: string;
  machine: string;
  expectedUpdatedAt?: string;
};

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let updates: BatchUpdate[];
  let bypassScheduleValidation = false;
  let bypassOverlapCheck = false;
  try {
    const body = await request.json();
    if (!Array.isArray(body.updates) || body.updates.length === 0) {
      return NextResponse.json({ error: "updates musí být neprázdné pole" }, { status: 400 });
    }
    updates = body.updates;
    // bypassScheduleValidation přeskakuje jen working hours validaci, NE firemní odstávky (companyDays).
    bypassScheduleValidation = body.bypassScheduleValidation === true;
    bypassOverlapCheck = body.bypassOverlapCheck === true;
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

  try {
    const results = await prisma.$transaction(async (tx) => {
      // Fetch UVNITŘ transakce — eliminuje TOCTOU gap
      const existingBlocks = await tx.block.findMany({
        where: { id: { in: updates.map((u) => u.id) } },
        select: {
          id: true,
          type: true,
          machine: true,
          startTime: true,
          endTime: true,
          orderNumber: true,
          updatedAt: true,
        },
      });

      // Optimistic locking — per-block check
      const staleBlockIds: number[] = [];
      for (const u of updates) {
        if (!u.expectedUpdatedAt) continue;
        const existing = existingBlocks.find((b) => b.id === u.id);
        if (!existing) continue;
        const expected = new Date(u.expectedUpdatedAt);
        if (isNaN(expected.getTime())) continue;
        if (existing.updatedAt.getTime() !== expected.getTime()) {
          staleBlockIds.push(u.id);
        }
      }
      if (staleBlockIds.length > 0) {
        throw new AppError("CONFLICT", `Bloky byly mezitím změněny jiným uživatelem: ${staleBlockIds.join(", ")}`);
      }

      // Validate schedule — only for ZAKAZKA blocks (mirrors single-block PUT behaviour)
      const zakazkaUpdates = updates.filter((u) => {
        const existing = existingBlocks.find((b) => b.id === u.id);
        return existing?.type === "ZAKAZKA";
      });

      if (zakazkaUpdates.length > 0) {
        for (const u of zakazkaUpdates) {
          const scheduleError = await validateBlockScheduleFromDb(
            u.machine, new Date(u.startTime), new Date(u.endTime), "ZAKAZKA", bypassScheduleValidation
          );
          if (scheduleError) {
            throw new AppError("SCHEDULE_VIOLATION", scheduleError.error);
          }
        }
      }

      const updated: Awaited<ReturnType<typeof tx.block.update>>[] = [];

      // Zpracovat v obráceném pořadí — při chain push (autoResolveOverlap) poslední blok
      // v chainu se posouvá na volné místo jako první, čímž uvolní prostor pro předchozí.
      // Pro lasso batch (bloky se nepřekrývají navzájem) pořadí nehraje roli.
      const reversed = [...updates].reverse();
      for (const u of reversed) {
        if (!bypassOverlapCheck) {
          await checkBlockOverlap(u.machine, new Date(u.startTime), new Date(u.endTime), u.id, tx);
        }

        const result = await tx.block.update({
          where: { id: u.id },
          data: {
            startTime: new Date(u.startTime),
            endTime: new Date(u.endTime),
            machine: u.machine,
          },
        });
        updated.push(result);
      }

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

    // Refetch s Reservation include pro reservationConfirmedAt
    const resultsWithRes = await prisma.block.findMany({
      where: { id: { in: results.map(r => r.id) } },
      include: { Reservation: { select: { confirmedAt: true } } },
    });

    emitSSE("block:batch-updated", { blocks: resultsWithRes.map(serializeBlock), sourceUserId: session.id });
    return NextResponse.json(resultsWithRes.map(serializeBlock));
  } catch (error: unknown) {
    if (isAppError(error)) {
      const statusMap: Record<string, number> = {
        OVERLAP: 409,
        CONFLICT: 409,
        SCHEDULE_VIOLATION: 422,
      };
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: statusMap[error.code] ?? 400 }
      );
    }
    if (isPrismaNotFound(error)) {
      return NextResponse.json({ error: "Jeden nebo více bloků nenalezeno" }, { status: 404 });
    }
    logger.error("[POST /api/blocks/batch]", error);
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
