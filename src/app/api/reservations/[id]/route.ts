import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { serializeReservation } from "@/lib/reservationSerialization";

const ALLOWED_ROLES = ["ADMIN", "PLANOVAT", "OBCHODNIK"];
const PLANNER_ROLES = ["ADMIN", "PLANOVAT"];

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });

  try {
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        attachments: { orderBy: { createdAt: "asc" } },
        blocks: {
          select: {
            id: true,
            machine: true,
            startTime: true,
            endTime: true,
            orderNumber: true,
          },
        },
      },
    });

    if (!reservation) return NextResponse.json({ error: "Rezervace nenalezena" }, { status: 404 });

    // OBCHODNIK smí jen vlastní
    if (session.role === "OBCHODNIK" && reservation.requestedByUserId !== session.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(serializeReservation(reservation));
  } catch (error) {
    console.error(`[GET /api/reservations/${id}]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });

  try {
    const body = await request.json();
    const { action } = body;

    if (!action) return NextResponse.json({ error: "Chybí pole action" }, { status: 400 });

    // Jen PLANOVAT/ADMIN smí provádět stavové přechody
    if (!PLANNER_ROLES.includes(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const reservation = await prisma.reservation.findUnique({ where: { id } });
    if (!reservation) return NextResponse.json({ error: "Rezervace nenalezena" }, { status: 404 });

    // ── accept: SUBMITTED → ACCEPTED ──────────────────────────────────────────
    if (action === "accept") {
      if (reservation.status !== "SUBMITTED") {
        return NextResponse.json(
          { error: `Nelze přijmout rezervaci ve stavu ${reservation.status}` },
          { status: 409 }
        );
      }
      const updated = await prisma.reservation.update({
        where: { id },
        data: {
          status: "ACCEPTED",
          plannerUserId: session.id,
          plannerUsername: session.username,
        },
      });
      return NextResponse.json(serializeReservation(updated));
    }

    // ── reject: SUBMITTED|ACCEPTED|QUEUE_READY → REJECTED ─────────────────────
    if (action === "reject") {
      if (!["SUBMITTED", "ACCEPTED", "QUEUE_READY"].includes(reservation.status)) {
        return NextResponse.json(
          { error: `Nelze zamítnout rezervaci ve stavu ${reservation.status}` },
          { status: 409 }
        );
      }
      const reason = body.reason ? String(body.reason).trim() : "";
      if (!reason) {
        return NextResponse.json({ error: "Důvod zamítnutí je povinný" }, { status: 400 });
      }
      const updated = await prisma.$transaction(async (tx) => {
        const r = await tx.reservation.update({
          where: { id },
          data: {
            status: "REJECTED",
            plannerUserId: session.id,
            plannerUsername: session.username,
            plannerDecisionReason: reason,
          },
        });
        // Notifikace pro obchodníka
        await tx.notification.create({
          data: {
            type: "RESERVATION_REJECTED",
            message: `Rezervace ${r.code} (${r.companyName}) byla zamítnuta: ${reason}`,
            reservationId: id,
            targetUserId: r.requestedByUserId,
            createdByUserId: session.id,
            createdByUsername: session.username,
          },
        });
        return r;
      });
      return NextResponse.json(serializeReservation(updated));
    }

    // ── prepare: ACCEPTED → QUEUE_READY ───────────────────────────────────────
    if (action === "prepare") {
      if (reservation.status !== "ACCEPTED") {
        return NextResponse.json(
          { error: `Nelze připravit rezervaci ve stavu ${reservation.status}` },
          { status: 409 }
        );
      }
      const { planningPayload } = body;
      if (!planningPayload) {
        return NextResponse.json({ error: "Chybí planningPayload" }, { status: 400 });
      }
      const updated = await prisma.reservation.update({
        where: { id },
        data: {
          status: "QUEUE_READY",
          planningPayload,
          preparedAt: new Date(),
          plannerUserId: session.id,
          plannerUsername: session.username,
        },
      });
      return NextResponse.json(serializeReservation(updated));
    }

    // ── notify: manuální upozornění obchodníka ─────────────────────────────────
    if (action === "notify") {
      const notifMessage = body.message
        ? String(body.message)
        : `Upozornění k rezervaci ${reservation.code} (${reservation.companyName})`;
      await prisma.notification.create({
        data: {
          type: "RESERVATION_MANUAL",
          message: notifMessage,
          reservationId: id,
          targetUserId: reservation.requestedByUserId,
          createdByUserId: session.id,
          createdByUsername: session.username,
        },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: `Neznámá akce: ${action}` }, { status: 400 });
  } catch (error) {
    console.error(`[PATCH /api/reservations/${id}]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
