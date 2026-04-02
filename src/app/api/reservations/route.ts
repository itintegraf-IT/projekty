import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseCivilDateForDb } from "@/lib/dateUtils";
import { serializeReservation } from "@/lib/reservationSerialization";

const ALLOWED_ROLES = ["ADMIN", "PLANOVAT", "OBCHODNIK"];

function parseCivilDateInput(value: unknown): Date | null {
  return parseCivilDateForDb(value);
}

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

    // Stavy dle bucketu — role-aware mapping (spec: SPECIFIKACE_DALSI_VLNY_ZMEN.md §GET /api/reservations)
    let statusFilter: string[] | undefined;
    if (session.role === "OBCHODNIK") {
      // OBCHODNIK: active = vlastní SUBMITTED+ACCEPTED+QUEUE_READY; archive = SCHEDULED+REJECTED
      if (bucket === "active")  statusFilter = ["SUBMITTED", "ACCEPTED", "QUEUE_READY"];
      else if (bucket === "archive") statusFilter = ["SCHEDULED", "REJECTED"];
      // bucket "new" → žádný filtr (OBCHODNIK nemá záložku Nové)
    } else {
      // ADMIN, PLANOVAT: new=SUBMITTED; active=ACCEPTED+QUEUE_READY; archive=SCHEDULED+REJECTED
      if (bucket === "new")         statusFilter = ["SUBMITTED"];
      else if (bucket === "active") statusFilter = ["ACCEPTED", "QUEUE_READY"];
      else if (bucket === "archive") statusFilter = ["SCHEDULED", "REJECTED"];
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

    return NextResponse.json(reservations.map(serializeReservation));
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

    // Validace datumů — odmítnout nevalidní hodnoty před zápisem do DB
    const expDate = parseCivilDateInput(requestedExpeditionDate);
    const dataDate = parseCivilDateInput(requestedDataDate);
    if (!expDate) {
      return NextResponse.json({ error: "Neplatný formát requestedExpeditionDate" }, { status: 400 });
    }
    if (!dataDate) {
      return NextResponse.json({ error: "Neplatný formát requestedDataDate" }, { status: 400 });
    }

    // Atomická transakce: create + generování kódu R{id}
    const reservation = await prisma.$transaction(async (tx) => {
      const r = await tx.reservation.create({
        data: {
          status: "SUBMITTED",
          companyName: String(companyName),
          erpOfferNumber: String(erpOfferNumber),
          requestedExpeditionDate: expDate,
          requestedDataDate: dataDate,
          requestText: requestText ? String(requestText) : null,
          requestedByUserId: session.id,
          requestedByUsername: session.username,
        },
      });
      const created = await tx.reservation.update({
        where: { id: r.id },
        data: { code: `R${r.id}` },
      });
      return tx.reservation.findUniqueOrThrow({
        where: { id: created.id },
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
    });

    return NextResponse.json(serializeReservation(reservation), { status: 201 });
  } catch (error) {
    console.error("[POST /api/reservations]", error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
