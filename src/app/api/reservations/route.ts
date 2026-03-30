import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const ALLOWED_ROLES = ["ADMIN", "PLANOVAT", "OBCHODNIK"];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const bucket = url.searchParams.get("bucket"); // "new" | "active" | "archive"
    const q = url.searchParams.get("q")?.trim() ?? "";

    // Stavy dle bucketu
    let statusFilter: string[] | undefined;
    if (bucket === "new") {
      statusFilter = ["SUBMITTED"];
    } else if (bucket === "active") {
      statusFilter = ["ACCEPTED", "QUEUE_READY", "SCHEDULED"];
    } else if (bucket === "archive") {
      statusFilter = ["REJECTED", "SCHEDULED"];
    }

    // OBCHODNIK vidí jen vlastní rezervace
    const ownerFilter = session.role === "OBCHODNIK"
      ? { requestedByUserId: session.id }
      : {};

    // Textové hledání
    const searchFilter = q
      ? {
          OR: [
            { companyName: { contains: q } },
            { erpOfferNumber: { contains: q } },
            { code: { contains: q } },
          ],
        }
      : {};

    const reservations = await prisma.reservation.findMany({
      where: {
        ...ownerFilter,
        ...(statusFilter ? { status: { in: statusFilter } } : {}),
        ...searchFilter,
      },
      orderBy: { createdAt: "desc" },
      include: {
        attachments: {
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return NextResponse.json(reservations);
  } catch (error) {
    console.error("[GET /api/reservations]", error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { companyName, erpOfferNumber, requestedExpeditionDate, requestedDataDate, requestText } = body;

    if (!companyName || !erpOfferNumber || !requestedExpeditionDate || !requestedDataDate) {
      return NextResponse.json(
        { error: "Chybí povinná pole: companyName, erpOfferNumber, requestedExpeditionDate, requestedDataDate" },
        { status: 400 }
      );
    }

    // Atomická transakce: create + generování kódu R{id}
    const reservation = await prisma.$transaction(async (tx) => {
      const r = await tx.reservation.create({
        data: {
          status: "SUBMITTED",
          companyName: String(companyName),
          erpOfferNumber: String(erpOfferNumber),
          requestedExpeditionDate: new Date(requestedExpeditionDate),
          requestedDataDate: new Date(requestedDataDate),
          requestText: requestText ? String(requestText) : null,
          requestedByUserId: session.id,
          requestedByUsername: session.username,
        },
      });
      return tx.reservation.update({
        where: { id: r.id },
        data: { code: `R${r.id}` },
      });
    });

    return NextResponse.json(reservation, { status: 201 });
  } catch (error) {
    console.error("[POST /api/reservations]", error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
