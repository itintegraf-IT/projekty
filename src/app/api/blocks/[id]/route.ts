import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { AppError, isAppError } from "@/lib/errors";
import { normalizeBlockVariant } from "@/lib/blockVariants";
import { parseNullableCivilDateForDb, serializeAuditValue, serializeBlock } from "@/lib/blockSerialization";
import { getExpeditionDayKey, getNextExpeditionSortOrder } from "@/lib/expedition";
import { resolvePresetForBlock } from "@/lib/jobPresetServer";
import { validateBlockScheduleFromDb } from "@/lib/scheduleValidationServer";
import { checkBlockOverlap } from "@/lib/overlapCheck";

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
    return NextResponse.json(serializeBlock(block));
  } catch (error) {
    logger.error(`[GET /api/blocks/${id}]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}

const SPLIT_SHARED_FIELDS = [
  "orderNumber", "description", "specifikace", "deadlineExpedice",
  "expediceNote", "doprava",
  "expeditionPublishedAt", "expeditionSortOrder",
  "jobPresetId", "jobPresetLabel",
  "type", "blockVariant",
  "dataStatusId", "dataStatusLabel", "dataRequiredDate", "dataOk",
  "materialStatusId", "materialStatusLabel", "materialRequiredDate", "materialOk", "materialInStock",
  "pantoneRequiredDate", "pantoneOk", "pantoneRequired",
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
        pantoneRequired: body.pantoneRequired,
        materialInStock: body.materialInStock,
      };
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // bypassScheduleValidation přeskakuje jen working hours validaci, NE firemní odstávky (companyDays).
    const bypassScheduleValidation = (body as Record<string, unknown>).bypassScheduleValidation === true;
    // bypassOverlapCheck přeskakuje overlap check — používá se POUZE při drag & drop / resize,
    // kde autoResolveOverlap ihned po uložení vyřeší překryvy přes batch endpoint.
    const bypassOverlapCheck = (body as Record<string, unknown>).bypassOverlapCheck === true;
    // Explicitně smazat příznaky z allowed — nesmí jít do prisma.block.update
    delete (allowed as Record<string, unknown>).bypassScheduleValidation;
    delete (allowed as Record<string, unknown>).bypassOverlapCheck;
    delete (allowed as Record<string, unknown>).expeditionPublishedAt;
    delete (allowed as Record<string, unknown>).expeditionSortOrder;
    // Remove undefined values
    Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);

    // ── DATA chip auto-derivace ──
    // Pravidlo 1 a 2 se vyhodnocují uvnitř transakce (potřebují oldBlock pro porovnání).
    // Viz komentář "DATA chip auto-derivace" níže.

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
          const scheduleError = await validateBlockScheduleFromDb(checkMachine, checkStart, checkEnd, checkType, bypassScheduleValidation);
          if (scheduleError) return NextResponse.json({ error: scheduleError.error }, { status: 422 });
        }
      }
    }

    const AUDITED_FIELDS = [
      "dataStatusLabel", "dataRequiredDate", "dataOk",
      "materialStatusLabel", "materialRequiredDate", "materialOk", "materialNote",
      "pantoneRequiredDate", "pantoneOk", "pantoneRequired", "materialInStock",
      "deadlineExpedice",
      "expediceNote", "doprava",
      "blockVariant",
      "jobPresetLabel",
    ] as const;
    type AuditedField = typeof AUDITED_FIELDS[number];

    const block = await prisma.$transaction(async (tx) => {
      const oldBlock = await tx.block.findUnique({ where: { id } });
      if (!oldBlock) {
        throw new AppError("NOT_FOUND", "Blok nenalezen");
      }

      // ── DATA chip auto-derivace (potřebuje oldBlock) ──
      // Pravidlo 1: Změna dataRequiredDate → vymazat chip + dataOk=false
      //   Spouští se JEN pokud se datum skutečně změnilo (ne jen proto, že ho klient poslal znovu).
      if (allowed.dataRequiredDate !== undefined) {
        const oldDateKey = oldBlock.dataRequiredDate?.toISOString().slice(0, 10) ?? null;
        const newRaw = allowed.dataRequiredDate as string | null;
        const newDateKey = newRaw ? new Date(newRaw + "T00:00:00.000Z").toISOString().slice(0, 10) : null;
        if (newDateKey !== oldDateKey) {
          allowed.dataStatusId = null;
          allowed.dataStatusLabel = null;
          allowed.dataOk = false;
        }
      }
      // Pravidlo 2: Změna chipu → auto-derivovat dataOk
      if (allowed.dataStatusId !== undefined && !(allowed.dataRequiredDate !== undefined && allowed.dataStatusId === null)) {
        allowed.dataOk = allowed.dataStatusId !== null;
      }

      // Overlap check — pokud se mění čas nebo stroj (přeskočit při drag/resize, kde autoResolveOverlap řeší overlap)
      if (!bypassOverlapCheck) {
        const checkMachine = (allowed.machine as string | undefined) ?? oldBlock.machine;
        const checkStart = allowed.startTime ? new Date(allowed.startTime as string) : oldBlock.startTime;
        const checkEnd = allowed.endTime ? new Date(allowed.endTime as string) : oldBlock.endTime;
        if (
          checkStart.getTime() !== oldBlock.startTime.getTime() ||
          checkEnd.getTime() !== oldBlock.endTime.getTime() ||
          checkMachine !== oldBlock.machine
        ) {
          await checkBlockOverlap(checkMachine, checkStart, checkEnd, id, tx);
        }
      }

      // Normalizace blockVariant — platí na výsledný type, ne jen na vstup
      // Fallback na existující hodnotu z DB pokud blockVariant není v requestu (předchází tiché přepísání na STANDARD)
      const resultingType = (allowed.type as string | undefined) ?? oldBlock?.type ?? "ZAKAZKA";
      const blockVariant = normalizeBlockVariant(
        (allowed.blockVariant as string | undefined) ?? oldBlock?.blockVariant,
        resultingType
      );
      const nextDeadlineExpedice =
        allowed.deadlineExpedice !== undefined
          ? parseNullableCivilDateForDb(allowed.deadlineExpedice)
          : oldBlock.deadlineExpedice;
      const oldExpeditionDayKey = getExpeditionDayKey(oldBlock.deadlineExpedice);
      const nextExpeditionDayKey = getExpeditionDayKey(nextDeadlineExpedice);
      const mustClearExpeditionState =
        resultingType !== "ZAKAZKA" || nextDeadlineExpedice == null;
      let nextExpeditionPublishedAt = oldBlock.expeditionPublishedAt;
      let nextExpeditionSortOrder = oldBlock.expeditionSortOrder;

      if (mustClearExpeditionState) {
        nextExpeditionPublishedAt = null;
        nextExpeditionSortOrder = null;
      } else if (oldBlock.expeditionPublishedAt != null) {
        if (oldExpeditionDayKey !== nextExpeditionDayKey || oldBlock.expeditionSortOrder == null) {
          nextExpeditionSortOrder = await getNextExpeditionSortOrder(tx, nextDeadlineExpedice);
        }
      } else {
        nextExpeditionSortOrder = null;
      }

      const presetExplicitlyChanged = allowed.jobPresetId !== undefined;
      let presetUpdate:
        | { jobPresetId: number | null; jobPresetLabel: string | null }
        | null = null;

      if (resultingType === "UDRZBA") {
        presetUpdate = { jobPresetId: null, jobPresetLabel: null };
      } else if (presetExplicitlyChanged) {
        const presetResult = await resolvePresetForBlock(allowed.jobPresetId, resultingType);
        if ("error" in presetResult) {
          throw new AppError("PRESET_INVALID", presetResult.error);
        }
        presetUpdate = presetResult;
      } else if (allowed.type !== undefined && oldBlock.jobPresetId) {
        const existingPreset = await prisma.jobPreset.findUnique({
          where: { id: oldBlock.jobPresetId },
          select: { appliesToZakazka: true, appliesToRezervace: true },
        });
        if (existingPreset) {
          if (resultingType === "ZAKAZKA" && !existingPreset.appliesToZakazka) {
            throw new AppError("PRESET_INVALID", "Vybraný preset není povolen pro zakázku.");
          }
          if (resultingType === "REZERVACE" && !existingPreset.appliesToRezervace) {
            throw new AppError("PRESET_INVALID", "Vybraný preset není povolen pro rezervaci.");
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
            deadlineExpedice: nextDeadlineExpedice,
          }),
          ...(allowed.expediceNote !== undefined && {
            expediceNote: normalizeNullableText(allowed.expediceNote),
          }),
          ...(allowed.doprava !== undefined && {
            doprava: normalizeNullableText(allowed.doprava),
          }),
          ...(!isSameNullableDate(oldBlock.expeditionPublishedAt, nextExpeditionPublishedAt) && {
            expeditionPublishedAt: nextExpeditionPublishedAt,
          }),
          ...((oldBlock.expeditionSortOrder ?? null) !== (nextExpeditionSortOrder ?? null) && {
            expeditionSortOrder: nextExpeditionSortOrder,
          }),
          // DATA
          ...(allowed.dataStatusId !== undefined && { dataStatusId: allowed.dataStatusId as number }),
          ...(allowed.dataStatusLabel !== undefined && { dataStatusLabel: allowed.dataStatusLabel as string }),
          ...(allowed.dataRequiredDate !== undefined && {
            dataRequiredDate: parseNullableCivilDateForDb(allowed.dataRequiredDate),
          }),
          ...(allowed.dataOk !== undefined && { dataOk: allowed.dataOk as boolean }),
          // MATERIÁL
          ...(allowed.materialStatusId !== undefined && { materialStatusId: allowed.materialStatusId as number }),
          ...(allowed.materialStatusLabel !== undefined && { materialStatusLabel: allowed.materialStatusLabel as string }),
          ...(allowed.materialRequiredDate !== undefined && {
            materialRequiredDate: parseNullableCivilDateForDb(allowed.materialRequiredDate),
          }),
          ...(allowed.materialOk !== undefined && { materialOk: allowed.materialOk as boolean }),
          ...(allowed.materialNote !== undefined && {
            materialNote: allowed.materialNote as string | null,
            materialNoteByUsername: allowed.materialNote ? session.username : null,
          }),
          // PANTONE
          ...(allowed.pantoneRequiredDate !== undefined && {
            pantoneRequiredDate: parseNullableCivilDateForDb(allowed.pantoneRequiredDate),
          }),
          ...(allowed.pantoneOk !== undefined && { pantoneOk: allowed.pantoneOk as boolean }),
          ...(allowed.pantoneRequired !== undefined && { pantoneRequired: allowed.pantoneRequired as boolean }),
          ...(allowed.pantoneRequired === false && {
            pantoneRequiredDate: null,
            pantoneOk: false,
          }),
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
          .filter((field) => serializeAuditValue(field, oldBlock[field as AuditedField]) !== serializeAuditValue(field, updated[field as AuditedField]))
          .map((field) => ({
            blockId: id,
            orderNumber: oldBlock.orderNumber,
            userId: session.id,
            username: session.username,
            action: "UPDATE",
            field,
            oldValue: serializeAuditValue(field, oldBlock[field as AuditedField]),
            newValue: serializeAuditValue(field, updated[field as AuditedField]),
          }));

        // Pokud auto-unpublish (mustClearExpeditionState), přidat EXPEDITION_UNPUBLISH záznam
        if (mustClearExpeditionState && oldBlock.expeditionPublishedAt != null) {
          changes.push({
            blockId: id,
            orderNumber: oldBlock.orderNumber,
            userId: session.id,
            username: session.username,
            action: "EXPEDITION_UNPUBLISH",
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
        if (presetExplicitlyChanged || resultingType === "UDRZBA") {
          sharedUpdate.jobPresetId = updated.jobPresetId;
          sharedUpdate.jobPresetLabel = updated.jobPresetLabel;
        }
        if (!isSameNullableDate(oldBlock.expeditionPublishedAt, updated.expeditionPublishedAt)) {
          sharedUpdate.expeditionPublishedAt = updated.expeditionPublishedAt;
        }
        if ((oldBlock.expeditionSortOrder ?? null) !== (updated.expeditionSortOrder ?? null)) {
          sharedUpdate.expeditionSortOrder = updated.expeditionSortOrder;
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

    return NextResponse.json(serializeBlock(block));
  } catch (error: unknown) {
    if (isAppError(error)) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        PRESET_INVALID: 400,
        SCHEDULE_VIOLATION: 422,
        CONFLICT: 409,
        OVERLAP: 409,
      };
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: statusMap[error.code] ?? 400 }
      );
    }
    if (isPrismaNotFound(error)) {
      return NextResponse.json({ error: "Blok nenalezen" }, { status: 404 });
    }
    logger.error(`[PUT /api/blocks/${id}]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
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

  // Volitelný důvod zamítnutí rezervace (z body)
  let rejectionReason = "Blok vymazán z plánu";
  try {
    const body = await request.json();
    if (body?.reason && typeof body.reason === "string" && body.reason.trim()) {
      rejectionReason = body.reason.trim();
    }
  } catch {
    // Bez body — použije se výchozí důvod
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

      // Pokud byl blok spojen s rezervací → zamítnout (REJECTED)
      if (blockToDelete?.reservationId) {
        const reservation = await tx.reservation.findUnique({
          where: { id: blockToDelete.reservationId },
          select: { id: true, status: true, code: true, companyName: true, requestedByUserId: true },
        });
        if (reservation && reservation.status !== "REJECTED" && reservation.status !== "WITHDRAWN") {
          await tx.reservation.update({
            where: { id: reservation.id },
            data: {
              status: "REJECTED",
              plannerUserId: session.id,
              plannerUsername: session.username,
              plannerDecisionReason: rejectionReason,
              scheduledBlockId: null,
              scheduledMachine: null,
              scheduledStartTime: null,
              scheduledEndTime: null,
              scheduledAt: null,
            },
          });
          await tx.notification.create({
            data: {
              type: "RESERVATION_REJECTED",
              message: `Rezervace ${reservation.code} (${reservation.companyName}) byla zamítnuta: ${rejectionReason}`,
              reservationId: reservation.id,
              targetUserId: reservation.requestedByUserId,
              createdByUserId: session.id,
              createdByUsername: session.username,
            },
          });
        }
      }
    });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (isPrismaNotFound(error)) {
      return NextResponse.json({ error: "Blok nenalezen" }, { status: 404 });
    }
    logger.error(`[DELETE /api/blocks/${id}]`, error);
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

function normalizeNullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function isSameNullableDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.getTime() === b.getTime();
}
