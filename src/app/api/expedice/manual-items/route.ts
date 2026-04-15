import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body: {
      kind?: string;
      orderNumber?: string | null;
      description?: string | null;
      expediceNote?: string | null;
      doprava?: string | null;
    } = await req.json();

    const kind = body.kind;
    if (kind !== "MANUAL_JOB" && kind !== "INTERNAL_TRANSFER") {
      return NextResponse.json({ error: "Neplatný typ položky" }, { status: 400 });
    }

    const orderNumber = body.orderNumber?.trim() || null;
    const description = body.description?.trim() || null;

    if (!orderNumber && !description) {
      return NextResponse.json(
        { error: "Vyplň alespoň číslo zakázky nebo popis" },
        { status: 400 }
      );
    }

    const item = await prisma.expeditionManualItem.create({
      data: {
        kind,
        orderNumber,
        description,
        expediceNote: body.expediceNote?.trim() || null,
        doprava: body.doprava?.trim() || null,
        date: null,
        expeditionSortOrder: null,
      },
    });

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    logger.error("[POST /api/expedice/manual-items]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
