import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { normalizeBlockVariant } from "@/lib/blockVariants";
import { resolvePresetForBlock } from "@/lib/jobPresetServer";
import { checkScheduleViolationWithTemplates, serializeTemplates } from "@/lib/scheduleValidation";

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
    const blockVariant = normalizeBlockVariant(body.blockVariant, blockType);
    if (blockType === "ZAKAZKA") {
      const machine = body.machine as string;
      const startTime = new Date(body.startTime);
      const endTime = new Date(body.endTime);
      const [rawTemplates, exceptions, companyDays] = await Promise.all([
        prisma.machineWorkHoursTemplate.findMany({
          where: { machine },
          include: { days: true },
        }),
        prisma.machineScheduleException.findMany({
          where: {
            machine,
            date: {
              gte: new Date(startTime.getTime() - 24 * 60 * 60 * 1000),
              lte: new Date(endTime.getTime()   + 24 * 60 * 60 * 1000),
            },
          },
        }),
        prisma.companyDay.findMany({
          where: { startDate: { lt: endTime }, endDate: { gt: startTime } },
        }),
      ]);
      const templates = serializeTemplates(rawTemplates);
      const violation = checkScheduleViolationWithTemplates(machine, startTime, endTime, templates, exceptions);
      if (violation) return NextResponse.json({ error: violation }, { status: 422 });
      const cdConflict = companyDays.find((cd) => cd.machine === null || cd.machine === machine);
      if (cdConflict) return NextResponse.json({ error: "Blok zasahuje do plánované odstávky." }, { status: 422 });
    }

    // Pokud je přítomno reservationId — drop z QUEUE_READY fronty rezervace
    const reservationId: number | undefined = body.reservationId ? Number(body.reservationId) : undefined;
    let reservation: { id: number; code: string; requestedByUserId: number; status: string } | null = null;
    if (reservationId !== undefined) {
      reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        select: { id: true, code: true, requestedByUserId: true, status: true },
      });
      if (!reservation) {
        return NextResponse.json({ error: "Rezervace nenalezena" }, { status: 404 });
      }
      if (reservation.status !== "QUEUE_READY") {
        return NextResponse.json(
          { error: "Rezervace není ve stavu QUEUE_READY — nelze naplánovat" },
          { status: 409 }
        );
      }
    }

    const finalOrderNumberPreview = reservation ? reservation.code : String(body.orderNumber);
    const finalTypePreview = reservation ? "REZERVACE" : blockType;
    const presetResult = await resolvePresetForBlock(body.jobPresetId, finalTypePreview);
    if ("error" in presetResult) {
      return NextResponse.json({ error: presetResult.error }, { status: 400 });
    }

    // Atomická transakce: block.create + auditLog.create buď oba projdou, nebo oba selžou
    const block = await prisma.$transaction(async (tx) => {
      // Pokud jde o rezervaci — vynutit typ REZERVACE a orderNumber = kód rezervace
      const finalOrderNumber = finalOrderNumberPreview;
      const finalType = finalTypePreview;
      const finalVariant = reservation ? "STANDARD" : blockVariant;
      const finalRecurrence = reservation ? "NONE" : (body.recurrenceType ?? "NONE");

      const newBlock = await tx.block.create({
        data: {
          orderNumber: finalOrderNumber,
          machine: body.machine,
          startTime: new Date(body.startTime),
          endTime: new Date(body.endTime),
          type: finalType,
          blockVariant: finalVariant,
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
          // MATERIÁL POZNÁMKA (jen obsah — autor se nepřenáší, je server-owned)
          materialNote: body.materialNote ?? null,
          // PANTONE + MATERIAL IN STOCK
          pantoneRequiredDate: body.pantoneRequiredDate ? new Date(body.pantoneRequiredDate) : null,
          pantoneOk: body.pantoneOk ?? false,
          materialInStock: body.materialInStock ?? false,
          // OPAKOVÁNÍ
          recurrenceType: finalRecurrence,
          recurrenceParentId: body.recurrenceParentId ?? null,
          // SPLIT SKUPINA
          splitGroupId: body.splitGroupId ?? null,
          // JOB PRESET
          jobPresetId: presetResult.jobPresetId,
          jobPresetLabel: presetResult.jobPresetLabel,
          // REZERVACE
          reservationId: reservationId ?? null,
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

      // Pokud jde o rezervaci — přepnout na SCHEDULED + notifikace
      if (reservation) {
        const startTime = new Date(body.startTime);
        const endTime = new Date(body.endTime);
        const startCZ = startTime.toLocaleString("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "short", timeStyle: "short" });
        await tx.reservation.update({
          where: { id: reservation.id },
          data: {
            status: "SCHEDULED",
            scheduledBlockId: newBlock.id,
            scheduledMachine: body.machine,
            scheduledStartTime: startTime,
            scheduledEndTime: endTime,
            scheduledAt: new Date(),
          },
        });
        await tx.notification.create({
          data: {
            type: "RESERVATION_SCHEDULED",
            message: `Rezervace ${reservation.code} byla zařazena na ${body.machine.replace("_", " ")} dne ${startCZ}`,
            reservationId: reservation.id,
            targetUserId: reservation.requestedByUserId,
            createdByUserId: session.id,
            createdByUsername: session.username,
          },
        });
      }

      return newBlock;
    });

    return NextResponse.json(block, { status: 201 });
  } catch (error) {
    console.error("[POST /api/blocks]", error);
    return NextResponse.json({ error: "Chyba při vytváření bloku" }, { status: 500 });
  }
}
