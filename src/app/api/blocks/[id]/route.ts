import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { normalizeBlockVariant } from "@/lib/blockVariants";
import { checkScheduleViolationSync } from "@/lib/scheduleValidation";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  try {
    const block = await prisma.block.findUnique({ where: { id } });
    if (!block) {
      return NextResponse.json({ error: "Blok nenalezen" }, { status: 404 });
    }
    // TISKAR smí číst jen bloky svého stroje
    if (session.role === "TISKAR" && block.machine !== session.assignedMachine) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(block);
  } catch (error) {
    console.error(`[GET /api/blocks/${id}]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}

const SPLIT_SHARED_FIELDS = [
  "orderNumber", "description", "specifikace", "deadlineExpedice",
  "dataStatusId", "dataStatusLabel", "dataRequiredDate", "dataOk",
  "materialStatusId", "materialStatusLabel", "materialRequiredDate", "materialOk",
  "barvyStatusId", "barvyStatusLabel", "lakStatusId", "lakStatusLabel",
] as const;
type SplitSharedField = typeof SPLIT_SHARED_FIELDS[number];

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  try {
    const body = await request.json();

    // Role-based field filter
    let allowed: Record<string, unknown>;
    if (["ADMIN", "PLANOVAT"].includes(session.role)) {
      allowed = body;
    } else if (session.role === "DTP") {
      allowed = {
        dataStatusId: body.dataStatusId,
        dataStatusLabel: body.dataStatusLabel,
        dataRequiredDate: body.dataRequiredDate,
        dataOk: body.dataOk,
      };
    } else if (session.role === "MTZ") {
      allowed = {
        materialStatusId: body.materialStatusId,
        materialStatusLabel: body.materialStatusLabel,
        materialRequiredDate: body.materialRequiredDate,
        materialOk: body.materialOk,
        materialNote: body.materialNote,
      };
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Remove undefined values
    Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);

    // Server-side validace pracovní doby:
    // Validujeme pokud se mění startTime/endTime/machine NEBO pokud se typ mění na ZAKAZKA
    // (blok mohl být mimo provoz jako REZERVACE a přejmenovat se na ZAKAZKA).
    const timingChanged = allowed.startTime !== undefined || allowed.endTime !== undefined || allowed.machine !== undefined;
    const typeChangingToZakazka = (allowed.type as string | undefined) === "ZAKAZKA";
    if (timingChanged || typeChangingToZakazka) {
      const existing = await prisma.block.findUnique({
        where: { id },
        select: { startTime: true, endTime: true, machine: true, type: true },
      });
      if (existing) {
        const checkType = (allowed.type as string | undefined) ?? existing.type;
        if (checkType === "ZAKAZKA") {
          const checkMachine = (allowed.machine as string | undefined) ?? existing.machine;
          const checkStart = allowed.startTime ? new Date(allowed.startTime as string) : existing.startTime;
          const checkEnd = allowed.endTime ? new Date(allowed.endTime as string) : existing.endTime;
          const [schedule, exceptions] = await Promise.all([
            prisma.machineWorkHours.findMany({ where: { machine: checkMachine } }),
            prisma.machineScheduleException.findMany({
              where: {
                machine: checkMachine,
                date: {
                  gte: new Date(checkStart.getTime() - 24 * 60 * 60 * 1000),
                  lte: new Date(checkEnd.getTime()   + 24 * 60 * 60 * 1000),
                },
              },
            }),
          ]);
          const violation = checkScheduleViolationSync(checkMachine, checkStart, checkEnd, schedule, exceptions);
          if (violation) return NextResponse.json({ error: violation }, { status: 422 });
        }
      }
    }

    const AUDITED_FIELDS = [
      "dataStatusLabel", "dataRequiredDate", "dataOk",
      "materialStatusLabel", "materialRequiredDate", "materialOk", "materialNote",
      "deadlineExpedice",
      "blockVariant",
    ] as const;
    type AuditedField = typeof AUDITED_FIELDS[number];

    const block = await prisma.$transaction(async (tx) => {
      const oldBlock = await tx.block.findUnique({ where: { id } });

      // Normalizace blockVariant — platí na výsledný type, ne jen na vstup
      // Fallback na existující hodnotu z DB pokud blockVariant není v requestu (předchází tiché přepísání na STANDARD)
      const resultingType = (allowed.type as string | undefined) ?? oldBlock?.type ?? "ZAKAZKA";
      const blockVariant = normalizeBlockVariant(
        (allowed.blockVariant as string | undefined) ?? oldBlock?.blockVariant,
        resultingType
      );

      // PRINT_RESET: pokud ADMIN/PLANOVAT skutečně mění startTime/endTime/machine a blok je potvrzený
      const timingActuallyChanged = oldBlock != null && (
        (allowed.startTime !== undefined && new Date(allowed.startTime as string).getTime() !== oldBlock.startTime.getTime()) ||
        (allowed.endTime !== undefined && new Date(allowed.endTime as string).getTime() !== oldBlock.endTime.getTime()) ||
        (allowed.machine !== undefined && allowed.machine !== oldBlock.machine)
      );
      const needsPrintReset =
        timingActuallyChanged &&
        oldBlock?.printCompletedAt != null &&
        ["ADMIN", "PLANOVAT"].includes(session.role);

      const updated = await tx.block.update({
        where: { id },
        data: {
          ...(allowed.orderNumber !== undefined && { orderNumber: String(allowed.orderNumber) }),
          ...(allowed.machine !== undefined && { machine: allowed.machine as string }),
          ...(allowed.startTime !== undefined && { startTime: new Date(allowed.startTime as string) }),
          ...(allowed.endTime !== undefined && { endTime: new Date(allowed.endTime as string) }),
          // PRINT_RESET — vyčistit potvrzení při přeplánování
          ...(needsPrintReset && {
            printCompletedAt: null,
            printCompletedByUserId: null,
            printCompletedByUsername: null,
          }),
          ...(allowed.type !== undefined && { type: allowed.type as string }),
          // Aplikovat blockVariant pokud byl explicitně zadán, nebo pokud se mění type (invariant: non-ZAKAZKA → STANDARD)
          ...((allowed.blockVariant !== undefined || allowed.type !== undefined) && { blockVariant }),
          ...(allowed.description !== undefined && { description: allowed.description as string }),
          ...(allowed.locked !== undefined && { locked: allowed.locked as boolean }),
          ...(allowed.deadlineExpedice !== undefined && {
            deadlineExpedice: allowed.deadlineExpedice ? new Date(allowed.deadlineExpedice as string) : null,
          }),
          // DATA
          ...(allowed.dataStatusId !== undefined && { dataStatusId: allowed.dataStatusId as number }),
          ...(allowed.dataStatusLabel !== undefined && { dataStatusLabel: allowed.dataStatusLabel as string }),
          ...(allowed.dataRequiredDate !== undefined && {
            dataRequiredDate: allowed.dataRequiredDate ? new Date(allowed.dataRequiredDate as string) : null,
          }),
          ...(allowed.dataOk !== undefined && { dataOk: allowed.dataOk as boolean }),
          // MATERIÁL
          ...(allowed.materialStatusId !== undefined && { materialStatusId: allowed.materialStatusId as number }),
          ...(allowed.materialStatusLabel !== undefined && { materialStatusLabel: allowed.materialStatusLabel as string }),
          ...(allowed.materialRequiredDate !== undefined && {
            materialRequiredDate: allowed.materialRequiredDate ? new Date(allowed.materialRequiredDate as string) : null,
          }),
          ...(allowed.materialOk !== undefined && { materialOk: allowed.materialOk as boolean }),
          ...(allowed.materialNote !== undefined && {
            materialNote: allowed.materialNote as string | null,
            materialNoteByUsername: allowed.materialNote ? session.username : null,
          }),
          // BARVY
          ...(allowed.barvyStatusId !== undefined && { barvyStatusId: allowed.barvyStatusId as number }),
          ...(allowed.barvyStatusLabel !== undefined && { barvyStatusLabel: allowed.barvyStatusLabel as string }),
          // LAK
          ...(allowed.lakStatusId !== undefined && { lakStatusId: allowed.lakStatusId as number }),
          ...(allowed.lakStatusLabel !== undefined && { lakStatusLabel: allowed.lakStatusLabel as string }),
          // SPECIFIKACE
          ...(allowed.specifikace !== undefined && { specifikace: allowed.specifikace as string }),
          // OPAKOVÁNÍ
          ...(allowed.recurrenceType !== undefined && { recurrenceType: allowed.recurrenceType as string }),
          // SPLIT SKUPINA
          ...(allowed.splitGroupId !== undefined && { splitGroupId: allowed.splitGroupId as number | null }),
        },
      });

      if (oldBlock) {
        const changes: {
          blockId: number;
          orderNumber: string | null;
          userId: number;
          username: string;
          action: string;
          field?: string;
          oldValue?: string;
          newValue?: string;
        }[] = AUDITED_FIELDS
          .filter((field) => String(oldBlock[field as AuditedField] ?? "") !== String(updated[field as AuditedField] ?? ""))
          .map((field) => ({
            blockId: id,
            orderNumber: oldBlock.orderNumber,
            userId: session.id,
            username: session.username,
            action: "UPDATE",
            field,
            oldValue: String(oldBlock[field as AuditedField] ?? ""),
            newValue: String(updated[field as AuditedField] ?? ""),
          }));

        if (needsPrintReset) {
          changes.push({
            blockId: id,
            orderNumber: oldBlock?.orderNumber ?? null,
            userId: session.id,
            username: session.username,
            action: "PRINT_RESET",
            field: "printCompletedAt",
            oldValue: String(oldBlock?.printCompletedByUsername ?? ""),
            newValue: "",
          });
        }

        if (changes.length > 0) {
          await tx.auditLog.createMany({ data: changes });
        }
      }

      // Propagace shared fields do split skupiny
      const groupId = updated.splitGroupId;
      if (groupId != null) {
        const sharedUpdate: Record<string, unknown> = {};
        for (const field of SPLIT_SHARED_FIELDS) {
          if ((allowed as Record<string, unknown>)[field] !== undefined) {
            sharedUpdate[field] = (updated as Record<string, unknown>)[field];
          }
        }
        if (Object.keys(sharedUpdate).length > 0) {
          await tx.block.updateMany({
            where: { splitGroupId: groupId, id: { not: id } },
            data: sharedUpdate,
          });
        }
      }

      return updated;
    });

    return NextResponse.json(block);
  } catch (error: unknown) {
    if (isPrismaNotFound(error)) {
      return NextResponse.json({ error: "Blok nenalezen" }, { status: 404 });
    }
    console.error(`[PUT /api/blocks/${id}]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const blockToDelete = await tx.block.findUnique({ where: { id }, select: { orderNumber: true } });

      await tx.auditLog.create({
        data: {
          blockId: id,
          orderNumber: blockToDelete?.orderNumber ?? null,
          userId: session.id,
          username: session.username,
          action: "DELETE",
        },
      });

      await tx.block.delete({ where: { id } });
    });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (isPrismaNotFound(error)) {
      return NextResponse.json({ error: "Blok nenalezen" }, { status: 404 });
    }
    console.error(`[DELETE /api/blocks/${id}]`, error);
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
