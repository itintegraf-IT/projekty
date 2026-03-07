import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const blocks = await prisma.block.findMany({
      orderBy: { startTime: "asc" },
    });
    return NextResponse.json(blocks);
  } catch (error) {
    console.error("[GET /api/blocks]", error);
    return NextResponse.json({ error: "Chyba při načítání bloků" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.orderNumber || !body.machine || !body.startTime || !body.endTime) {
      return NextResponse.json(
        { error: "Chybí povinné pole: orderNumber, machine, startTime, endTime" },
        { status: 400 }
      );
    }

    const block = await prisma.block.create({
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

    return NextResponse.json(block, { status: 201 });
  } catch (error) {
    console.error("[POST /api/blocks]", error);
    return NextResponse.json({ error: "Chyba při vytváření bloku" }, { status: 500 });
  }
}
