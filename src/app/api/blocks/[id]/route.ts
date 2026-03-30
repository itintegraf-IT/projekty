import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { normalizeBlockVariant } from "@/lib/blockVariants";
import { resolvePresetForBlock } from "@/lib/jobPresetServer";
import { checkScheduleViolationWithTemplates, serializeTemplates } from "@/lib/scheduleValidation";

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
  "jobPresetId", "jobPresetLabel",
  "type", "blockVariant",
  "dataStatusId", "dataStatusLabel", "dataRequiredDate", "dataOk",
  "materialStatusId", "materialStatusLabel", "materialRequiredDate", "materialOk", "materialInStock",
  "pantoneRequiredDate", "pantoneOk",
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
        pantoneRequiredDate: body.pantoneRequiredDate,
        pantoneOk: body.pantoneOk,
        materialInStock: body.materialInStock,
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
          const [rawTemplates, exceptions, companyDays] = await Promise.all([
            prisma.machineWorkHoursTemplate.findMany({
              where: { machine: checkMachine },
              include: { days: true },
            }),
            prisma.machineScheduleException.findMany({
              where: {
                machine: checkMachine,
                date: {
                  gte: new Date(checkStart.getTime() - 24 * 60 * 60 * 1000),
                  lte: new Date(checkEnd.getTime()   + 24 * 60 * 60 * 1000),
                },
              },
            }),
            prisma.companyDay.findMany({
              where: { startDate: { lt: checkEnd }, endDate: { gt: checkStart } },
            }),
          ]);
          const templates = serializeTemplates(rawTemplates);
          const violation = checkScheduleViolationWithTemplates(checkMachine, checkStart, checkEnd, templates, exceptions);
          if (violation) return NextResponse.json({ error: violation }, { status: 422 });
          const cdConflict = companyDays.find(
            (cd) => cd.machine === null || cd.machine === checkMachine
          );
          if (cdConflict) return NextResponse.json({ error: "Blok zasahuje do plánované odstávky." }, { status: 422 });
        }
      }
    }

    const AUDITED_FIELDS = [
      "dataStatusLabel", "dataRequiredDate", "dataOk",
      "materialStatusLabel", "materialRequiredDate", "materialOk", "materialNote",
      "pantoneRequiredDate", "pantoneOk", "materialInStock",
      "deadlineExpedice",
      "blockVariant",
      "jobPresetLabel",
    ] as const;
    type AuditedField = typeof AUDITED_FIELDS[number];

    const block = await prisma.$transaction(async (tx) => {
      const oldBlock = await tx.block.findUnique({ where: { id } });
      if (!oldBlock) {
        throw new Error("NOT_FOUND");
      }

      // Normalizace blockVariant — platí na výsledný type, ne jen na vstup
      // Fallback na existující hodnotu z DB pokud blockVariant není v requestu (předchází tiché přepísání na STANDARD)
      const resultingType = (allowed.type as string | undefined) ?? oldBlock?.type ?? "ZAKAZKA";
      const blockVariant = normalizeBlockVariant(
        (allowed.blockVariant as string | undefined) ?? oldBlock?.blockVariant,
        resultingType
      );
      const presetExplicitlyChanged = allowed.jobPresetId !== undefined;
      let presetUpdate:
        | { jobPresetId: number | null; jobPresetLabel: string | null }
        | null = null;

      if (resultingType === "UDRZBA") {
        presetUpdate = { jobPresetId: null, jobPresetLabel: null };
      } else if (presetExplicitlyChanged) {
        const presetResult = await resolvePresetForBlock(allowed.jobPresetId, resultingType);
        if ("error" in presetResult) {
          throw new Error(`PRESET:${presetResult.error}`);
        }
        presetUpdate = presetResult;
      } else if (allowed.type !== undefined && oldBlock.jobPresetId) {
        const existingPreset = await prisma.jobPreset.findUnique({
          where: { id: oldBlock.jobPresetId },
          select: { appliesToZakazka: true, appliesToRezervace: true },
        });
        if (existingPreset) {
          if (resultingType === "ZAKAZKA" && !existingPreset.appliesToZakazka) {
            throw new Error("PRESET:Vybraný preset není povolen pro zakázku.");
          }
          if (resultingType === "REZERVACE" && !existingPreset.appliesToRezervace) {
            throw new Error("PRESET:Vybraný preset není povolen pro rezervaci.");
          }
        }
      }

      // Pokud se type mění z ZAKAZKA na jiný typ, vyčistit printCompleted jako konzistenční cleanup
      const typeChangingAwayFromZakazka =
        oldBlock?.type === "ZAKAZKA" &&
        (allowed.type as string | undefined) !== undefined &&
        (allowed.type as string | undefined) !== "ZAKAZKA";

      const updated = await tx.block.update({
        where: { id },
        data: {
          ...(allowed.orderNumber !== undefined && { orderNumber: String(allowed.orderNumber) }),
          ...(allowed.machine !== undefined && { machine: allowed.machine as string }),
          ...(allowed.startTime !== undefined && { startTime: new Date(allowed.startTime as string) }),
          ...(allowed.endTime !== undefined && { endTime: new Date(allowed.endTime as string) }),
          ...(allowed.type !== undefined && { type: allowed.type as string }),
          // Pokud se type mění pryč od ZAKAZKA, vyčistit printCompleted
          ...(typeChangingAwayFromZakazka && {
            printCompletedAt: null,
            printCompletedByUserId: null,
            printCompletedByUsername: null,
          }),
          // Aplikovat blockVariant pokud byl explicitně zadán, nebo pokud se mění type (invariant: non-ZAKAZKA → STANDARD)
          ...((allowed.blockVariant !== undefined || allowed.type !== undefined) && { blockVariant }),
          ...(presetUpdate && {
            jobPresetId: presetUpdate.jobPresetId,
            jobPresetLabel: presetUpdate.jobPresetLabel,
          }),
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
          // PANTONE
          ...(allowed.pantoneRequiredDate !== undefined && {
            pantoneRequiredDate: allowed.pantoneRequiredDate ? new Date(allowed.pantoneRequiredDate as string) : null,
          }),
          ...(allowed.pantoneOk !== undefined && { pantoneOk: allowed.pantoneOk as boolean }),
          // MATERIAL IN STOCK (pokud materialInStock=true, vynulovat materialRequiredDate)
          ...(allowed.materialInStock !== undefined && { materialInStock: allowed.materialInStock as boolean }),
          ...(allowed.materialInStock === true && { materialRequiredDate: null }),
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
        if (presetExplicitlyChanged || resultingType === "UDRZBA") {
          sharedUpdate.jobPresetId = updated.jobPresetId;
          sharedUpdate.jobPresetLabel = updated.jobPresetLabel;
        }
        if (Object.keys(sharedUpdate).length > 0) {
          // Pokud se type mění na non-ZAKAZKA, normalizovat blockVariant na STANDARD
          if (sharedUpdate.type && sharedUpdate.type !== "ZAKAZKA") {
            sharedUpdate.blockVariant = "STANDARD";
          }
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
    if (error instanceof Error && error.message.startsWith("PRESET:")) {
      return NextResponse.json({ error: error.message.slice("PRESET:".length) }, { status: 400 });
    }
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Blok nenalezen" }, { status: 404 });
    }
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
      const blockToDelete = await tx.block.findUnique({
        where: { id },
        select: { orderNumber: true, reservationId: true },
      });

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

      // Pokud byl blok spojen s rezervací ve stavu SCHEDULED → revert na QUEUE_READY
      if (blockToDelete?.reservationId) {
        await tx.reservation.updateMany({
          where: { id: blockToDelete.reservationId, status: "SCHEDULED" },
          data: {
            status: "QUEUE_READY",
            scheduledBlockId: null,
            scheduledMachine: null,
            scheduledStartTime: null,
            scheduledEndTime: null,
            scheduledAt: null,
          },
        });
      }
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
