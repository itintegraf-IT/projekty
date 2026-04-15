import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { unlink, readFile } from "fs/promises";
import path from "path";

const ALLOWED_ROLES = ["ADMIN", "PLANOVAT", "OBCHODNIK"];

type RouteContext = { params: Promise<{ id: string; attachmentId: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: rawId, attachmentId: rawAttId } = await params;
  const reservationId = parseInt(rawId, 10);
  const attachmentId = parseInt(rawAttId, 10);
  if (isNaN(reservationId) || isNaN(attachmentId)) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  try {
    const attachment = await prisma.reservationAttachment.findUnique({
      where: { id: attachmentId },
      include: { reservation: { select: { requestedByUserId: true } } },
    });
    if (!attachment || attachment.reservationId !== reservationId) {
      return NextResponse.json({ error: "Příloha nenalezena" }, { status: 404 });
    }
    if (session.role === "OBCHODNIK" && attachment.reservation.requestedByUserId !== session.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const filePath = path.join(
      process.cwd(),
      "data",
      "reservation-attachments",
      String(reservationId),
      attachment.storageKey
    );

    const fileBuffer = await readFile(filePath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.originalName)}"`,
        "Content-Length": String(attachment.sizeBytes),
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "ENOENT") {
      return NextResponse.json({ error: "Soubor nenalezen na disku" }, { status: 404 });
    }
    logger.error(`[GET /api/reservations/${reservationId}/attachments/${attachmentId}]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: rawId, attachmentId: rawAttId } = await params;
  const reservationId = parseInt(rawId, 10);
  const attachmentId = parseInt(rawAttId, 10);
  if (isNaN(reservationId) || isNaN(attachmentId)) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  try {
    const attachment = await prisma.reservationAttachment.findUnique({
      where: { id: attachmentId },
      include: { reservation: { select: { requestedByUserId: true, status: true } } },
    });
    if (!attachment || attachment.reservationId !== reservationId) {
      return NextResponse.json({ error: "Příloha nenalezena" }, { status: 404 });
    }

    // OBCHODNIK smí jen vlastní
    if (session.role === "OBCHODNIK" && attachment.reservation.requestedByUserId !== session.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Smazání povoleno jen u SUBMITTED a ACCEPTED
    if (!["SUBMITTED", "ACCEPTED"].includes(attachment.reservation.status)) {
      return NextResponse.json(
        { error: "Přílohy lze mazat jen u rezervací ve stavu SUBMITTED nebo ACCEPTED" },
        { status: 409 }
      );
    }

    // Smazat z DB + filesystemu
    await prisma.reservationAttachment.delete({ where: { id: attachmentId } });

    const filePath = path.join(
      process.cwd(),
      "data",
      "reservation-attachments",
      String(reservationId),
      attachment.storageKey
    );
    try {
      await unlink(filePath);
    } catch {
      // Soubor mohl být ručně smazán — DB záznam je pryč, OK
      logger.warn(`[DELETE attachment] Soubor ${filePath} nenalezen na disku, DB záznam smazán`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error(`[DELETE /api/reservations/${reservationId}/attachments/${attachmentId}]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
