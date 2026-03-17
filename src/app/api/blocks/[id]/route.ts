import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: RouteContext) {
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
    return NextResponse.json(block);
  } catch (error) {
    console.error(`[GET /api/blocks/${id}]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}

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
      };
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Remove undefined values
    Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);

    const AUDITED_FIELDS = [
      "dataStatusLabel", "dataRequiredDate", "dataOk",
      "materialStatusLabel", "materialRequiredDate", "materialOk",
      "deadlineExpedice",
    ] as const;
    type AuditedField = typeof AUDITED_FIELDS[number];

    const block = await prisma.$transaction(async (tx) => {
      const oldBlock = await tx.block.findUnique({ where: { id } });

      const updated = await tx.block.update({
        where: { id },
        data: {
          ...(allowed.orderNumber !== undefined && { orderNumber: String(allowed.orderNumber) }),
          ...(allowed.machine !== undefined && { machine: allowed.machine as string }),
          ...(allowed.startTime !== undefined && { startTime: new Date(allowed.startTime as string) }),
          ...(allowed.endTime !== undefined && { endTime: new Date(allowed.endTime as string) }),
          ...(allowed.type !== undefined && { type: allowed.type as string }),
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
        },
      });

      if (oldBlock) {
        const changes = AUDITED_FIELDS
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
