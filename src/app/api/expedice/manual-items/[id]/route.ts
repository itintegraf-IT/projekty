import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { civilDateToUTCMidnight } from "@/lib/dateUtils";
import { getNextExpeditionSortOrder, getExpeditionDayKey } from "@/lib/expedition";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
    }

    const existing = await prisma.expeditionManualItem.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Položka nenalezena" }, { status: 404 });
    }

    const body: {
      kind?: string;
      orderNumber?: string | null;
      description?: string | null;
      expediceNote?: string | null;
      doprava?: string | null;
      date?: string | null;
      expeditionSortOrder?: number | null;
    } = await req.json();

    // Validace kind, pokud je přítomen
    if (body.kind !== undefined && body.kind !== "MANUAL_JOB" && body.kind !== "INTERNAL_TRANSFER") {
      return NextResponse.json({ error: "Neplatný typ položky" }, { status: 400 });
    }

    // Validace: alespoň jedno z orderNumber nebo description musí zůstat vyplněno
    const nextOrderNumber =
      "orderNumber" in body ? (body.orderNumber?.trim() || null) : existing.orderNumber;
    const nextDescription =
      "description" in body ? (body.description?.trim() || null) : existing.description;
    if (!nextOrderNumber && !nextDescription) {
      return NextResponse.json(
        { error: "Vyplň alespoň číslo zakázky nebo popis" },
        { status: 400 }
      );
    }

    // Zpracovat datum: null = vrátit do fronty
    let newDate: Date | null = existing.date;
    let newSortOrder: number | null = existing.expeditionSortOrder;

    if ("date" in body) {
      if (body.date === null || body.date === "") {
        // Vrátit do fronty
        newDate = null;
        newSortOrder = null;
      } else {
        // Přesunout na konkrétní den
        const dayKey = getExpeditionDayKey(body.date);
        if (!dayKey) {
          return NextResponse.json({ error: "Neplatné datum" }, { status: 400 });
        }
        newDate = civilDateToUTCMidnight(dayKey);
        // Pokud není explicitně zadán sortOrder, přidělit nový na konec dne
        if ("expeditionSortOrder" in body && body.expeditionSortOrder !== undefined) {
          newSortOrder = body.expeditionSortOrder;
        } else {
          newSortOrder = await prisma.$transaction(async (tx) =>
            getNextExpeditionSortOrder(tx, newDate!)
          );
        }
      }
    } else if ("expeditionSortOrder" in body) {
      newSortOrder = body.expeditionSortOrder ?? null;
    }

    const updated = await prisma.expeditionManualItem.update({
      where: { id },
      data: {
        ...(body.kind !== undefined ? { kind: body.kind as "MANUAL_JOB" | "INTERNAL_TRANSFER" } : {}),
        ...(nextOrderNumber !== existing.orderNumber ? { orderNumber: nextOrderNumber } : {}),
        ...(nextDescription !== existing.description ? { description: nextDescription } : {}),
        ...("expediceNote" in body ? { expediceNote: body.expediceNote?.trim() || null } : {}),
        ...("doprava" in body ? { doprava: body.doprava?.trim() || null } : {}),
        date: newDate,
        expeditionSortOrder: newSortOrder,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PUT /api/expedice/manual-items/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
    }

    const existing = await prisma.expeditionManualItem.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Položka nenalezena" }, { status: 404 });
    }

    await prisma.expeditionManualItem.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/expedice/manual-items/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
