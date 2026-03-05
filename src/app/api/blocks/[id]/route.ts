import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  try {
    const body = await request.json();

    const block = await prisma.block.update({
      where: { id },
      data: {
        ...(body.orderNumber !== undefined && { orderNumber: String(body.orderNumber) }),
        ...(body.machine !== undefined && { machine: body.machine }),
        ...(body.startTime !== undefined && { startTime: new Date(body.startTime) }),
        ...(body.endTime !== undefined && { endTime: new Date(body.endTime) }),
        ...(body.type !== undefined && { type: body.type }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.locked !== undefined && { locked: body.locked }),
        ...(body.deadlineExpedice !== undefined && {
          deadlineExpedice: body.deadlineExpedice ? new Date(body.deadlineExpedice) : null,
        }),
        // DATA
        ...(body.dataStatusId !== undefined && { dataStatusId: body.dataStatusId }),
        ...(body.dataStatusLabel !== undefined && { dataStatusLabel: body.dataStatusLabel }),
        ...(body.dataRequiredDate !== undefined && {
          dataRequiredDate: body.dataRequiredDate ? new Date(body.dataRequiredDate) : null,
        }),
        ...(body.dataOk !== undefined && { dataOk: body.dataOk }),
        // MATERIÁL
        ...(body.materialStatusId !== undefined && { materialStatusId: body.materialStatusId }),
        ...(body.materialStatusLabel !== undefined && { materialStatusLabel: body.materialStatusLabel }),
        ...(body.materialRequiredDate !== undefined && {
          materialRequiredDate: body.materialRequiredDate ? new Date(body.materialRequiredDate) : null,
        }),
        ...(body.materialOk !== undefined && { materialOk: body.materialOk }),
        // BARVY
        ...(body.barvyStatusId !== undefined && { barvyStatusId: body.barvyStatusId }),
        ...(body.barvyStatusLabel !== undefined && { barvyStatusLabel: body.barvyStatusLabel }),
        // LAK
        ...(body.lakStatusId !== undefined && { lakStatusId: body.lakStatusId }),
        ...(body.lakStatusLabel !== undefined && { lakStatusLabel: body.lakStatusLabel }),
        // SPECIFIKACE
        ...(body.specifikace !== undefined && { specifikace: body.specifikace }),
      },
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
  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  try {
    await prisma.block.delete({ where: { id } });
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
