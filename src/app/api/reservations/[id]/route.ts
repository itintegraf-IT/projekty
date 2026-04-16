import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { serializeReservation } from "@/lib/reservationSerialization";
import { parseCivilDateForDb } from "@/lib/dateUtils";

const ALLOWED_ROLES = ["ADMIN", "PLANOVAT", "OBCHODNIK"];
const PLANNER_ROLES = ["ADMIN", "PLANOVAT"];

type RouteContext = { params: Promise<{ id: string }> };

function parseCivilDateInput(value: unknown): Date | null {
  return parseCivilDateForDb(value);
}

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
    logger.error(`[GET /api/reservations/${id}]`, error);
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

    // Role check — většinu akcí smí jen PLANOVAT/ADMIN, protinávrh-odpověď smí i OBCHODNIK
    const isPlanner = PLANNER_ROLES.includes(session.role);
    const isObchodnik = session.role === "OBCHODNIK";
    if (!isPlanner && !isObchodnik) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const reservation = await prisma.reservation.findUnique({ where: { id } });
    if (!reservation) return NextResponse.json({ error: "Rezervace nenalezena" }, { status: 404 });

    // ── accept: SUBMITTED → ACCEPTED ──────────────────────────────────────────
    if (action === "accept") {
      if (!isPlanner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

    // ── reject: SUBMITTED|ACCEPTED|QUEUE_READY|SCHEDULED|COUNTER_PROPOSED → REJECTED ──
    if (action === "reject") {
      if (!isPlanner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!["SUBMITTED", "ACCEPTED", "QUEUE_READY", "SCHEDULED", "COUNTER_PROPOSED"].includes(reservation.status)) {
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
      if (!isPlanner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

    // ── confirm: SCHEDULED → CONFIRMED ────────────────────────────────────────
    if (action === "confirm") {
      if (!isPlanner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (reservation.status !== "SCHEDULED") {
        return NextResponse.json(
          { error: `Nelze potvrdit rezervaci ve stavu ${reservation.status}` },
          { status: 409 }
        );
      }
      const updated = await prisma.$transaction(async (tx) => {
        const r = await tx.reservation.update({
          where: { id },
          data: {
            status: "CONFIRMED",
            confirmedAt: new Date(),
            confirmedByUserId: session.id,
            confirmedByUsername: session.username,
          },
        });
        await tx.notification.create({
          data: {
            type: "RESERVATION_CONFIRMED",
            message: `Vaše rezervace ${r.code} (${r.companyName}) byla potvrzena`,
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

    // ── counter-propose: SCHEDULED → COUNTER_PROPOSED ─────────────────────────
    if (action === "counter-propose") {
      if (!isPlanner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (reservation.status !== "SCHEDULED") {
        return NextResponse.json(
          { error: `Nelze navrhnout jiný termín pro rezervaci ve stavu ${reservation.status}` },
          { status: 409 }
        );
      }
      const { counterExpeditionDate, counterDataDate, reason } = body;
      if (!counterExpeditionDate && !counterDataDate) {
        return NextResponse.json({ error: "Vyplňte alespoň jeden navrhovaný termín" }, { status: 400 });
      }
      const reason_ = reason ? String(reason).trim() : "";
      if (!reason_) {
        return NextResponse.json({ error: "Důvod protinávrhu je povinný" }, { status: 400 });
      }
      const cpExpDate = counterExpeditionDate ? parseCivilDateInput(counterExpeditionDate) : null;
      const cpDataDate = counterDataDate ? parseCivilDateInput(counterDataDate) : null;
      if (counterExpeditionDate && !cpExpDate) {
        return NextResponse.json({ error: "Neplatný formát counterExpeditionDate" }, { status: 400 });
      }
      if (counterDataDate && !cpDataDate) {
        return NextResponse.json({ error: "Neplatný formát counterDataDate" }, { status: 400 });
      }
      const updated = await prisma.$transaction(async (tx) => {
        const r = await tx.reservation.update({
          where: { id },
          data: {
            status: "COUNTER_PROPOSED",
            counterProposedExpeditionDate: cpExpDate,
            counterProposedDataDate: cpDataDate,
            counterProposedReason: reason_,
            counterProposedAt: new Date(),
            counterProposedByUserId: session.id,
            counterProposedByUsername: session.username,
          },
        });
        await tx.notification.create({
          data: {
            type: "RESERVATION_COUNTER_PROPOSED",
            message: `K rezervaci ${r.code} (${r.companyName}) byl navržen jiný termín`,
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

    // ── accept-counter: COUNTER_PROPOSED → CONFIRMED (obchodník souhlasí) ────
    if (action === "accept-counter") {
      if (!isObchodnik) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (reservation.status !== "COUNTER_PROPOSED") {
        return NextResponse.json(
          { error: `Nelze potvrdit protinávrh pro rezervaci ve stavu ${reservation.status}` },
          { status: 409 }
        );
      }
      if (reservation.requestedByUserId !== session.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const updated = await prisma.$transaction(async (tx) => {
        const r = await tx.reservation.update({
          where: { id },
          data: {
            status: "CONFIRMED",
            requestedExpeditionDate: reservation.counterProposedExpeditionDate ?? reservation.requestedExpeditionDate,
            requestedDataDate: reservation.counterProposedDataDate ?? reservation.requestedDataDate,
            confirmedAt: new Date(),
            confirmedByUserId: reservation.counterProposedByUserId,
            confirmedByUsername: reservation.counterProposedByUsername,
          },
        });
        if (reservation.counterProposedByUserId) {
          await tx.notification.create({
            data: {
              type: "RESERVATION_COUNTER_ACCEPTED",
              message: `Obchodník souhlasil s protinávrhem pro ${r.code} (${r.companyName})`,
              reservationId: id,
              targetUserId: reservation.counterProposedByUserId,
              createdByUserId: session.id,
              createdByUsername: session.username,
            },
          });
        }
        return r;
      });
      return NextResponse.json(serializeReservation(updated));
    }

    // ── reject-counter: COUNTER_PROPOSED → WITHDRAWN (obchodník nesouhlasí) ──
    if (action === "reject-counter") {
      if (!isObchodnik) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (reservation.status !== "COUNTER_PROPOSED") {
        return NextResponse.json(
          { error: `Nelze odmítnout protinávrh pro rezervaci ve stavu ${reservation.status}` },
          { status: 409 }
        );
      }
      if (reservation.requestedByUserId !== session.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const withdrawnReason = body.reason ? String(body.reason).trim() : null;
      const updated = await prisma.$transaction(async (tx) => {
        const r = await tx.reservation.update({
          where: { id },
          data: {
            status: "WITHDRAWN",
            withdrawnAt: new Date(),
            withdrawnReason: withdrawnReason,
          },
        });
        if (reservation.counterProposedByUserId) {
          await tx.notification.create({
            data: {
              type: "RESERVATION_WITHDRAWN",
              message: `Obchodník odmítl protinávrh pro ${r.code} (${r.companyName})${withdrawnReason ? `: ${withdrawnReason}` : ""}`,
              reservationId: id,
              targetUserId: reservation.counterProposedByUserId,
              createdByUserId: session.id,
              createdByUsername: session.username,
            },
          });
        }
        return r;
      });
      return NextResponse.json(serializeReservation(updated));
    }

    return NextResponse.json({ error: `Neznámá akce: ${action}` }, { status: 400 });
  } catch (error) {
    logger.error(`[PATCH /api/reservations/${id}]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
