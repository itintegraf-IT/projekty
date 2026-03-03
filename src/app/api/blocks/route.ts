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
        deadlineData: body.deadlineData ? new Date(body.deadlineData) : null,
        deadlineMaterial: body.deadlineMaterial ? new Date(body.deadlineMaterial) : null,
        deadlineExpedice: body.deadlineExpedice ? new Date(body.deadlineExpedice) : null,
        deadlineDataOk: body.deadlineDataOk ?? false,
        deadlineMaterialOk: body.deadlineMaterialOk ?? false,
      },
    });

    return NextResponse.json(block, { status: 201 });
  } catch (error) {
    console.error("[POST /api/blocks]", error);
    return NextResponse.json({ error: "Chyba při vytváření bloku" }, { status: 500 });
  }
}
