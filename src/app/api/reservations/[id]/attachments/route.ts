import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const ALLOWED_ROLES = ["ADMIN", "PLANOVAT", "OBCHODNIK"];
const MAX_FILES = 5;
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

// Magic bytes pro PDF, PNG, JPEG a Office
function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 4) return false;

  if (mimeType === "application/pdf") {
    return buffer.slice(0, 4).toString("ascii") === "%PDF";
  }
  if (mimeType === "image/png") {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  }
  if (mimeType === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  // Office Open XML (docx, xlsx, pptx) a starší formáty (doc, xls) jsou ZIP archivy — začínají PK
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/msword" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    return buffer[0] === 0x50 && buffer[1] === 0x4b;
  }
  return true;
}

// Sanitizace jména souboru — jen bezpečné znaky
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\]/g, "")       // žádné lomítka
    .replace(/\.\./g, "")         // žádné ".."
    .replace(/[^\w.\-\s()[\]]/g, "_") // nahradit nebezpečné znaky
    .slice(0, 255);
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
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
      select: { id: true, requestedByUserId: true },
    });
    if (!reservation) return NextResponse.json({ error: "Rezervace nenalezena" }, { status: 404 });
    if (session.role === "OBCHODNIK" && reservation.requestedByUserId !== session.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const attachments = await prisma.reservationAttachment.findMany({
      where: { reservationId: id },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(attachments);
  } catch (error) {
    logger.error(`[GET /api/reservations/${id}/attachments]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
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
      select: { id: true, requestedByUserId: true, status: true },
    });
    if (!reservation) return NextResponse.json({ error: "Rezervace nenalezena" }, { status: 404 });
    if (session.role === "OBCHODNIK" && reservation.requestedByUserId !== session.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Upload povolený jen do SUBMITTED a ACCEPTED
    if (!["SUBMITTED", "ACCEPTED"].includes(reservation.status)) {
      return NextResponse.json(
        { error: "Přílohy lze přidávat jen k rezervacím ve stavu SUBMITTED nebo ACCEPTED" },
        { status: 409 }
      );
    }

    // Kontrola počtu existujících příloh
    const existingCount = await prisma.reservationAttachment.count({ where: { reservationId: id } });
    if (existingCount >= MAX_FILES) {
      return NextResponse.json({ error: `Maximální počet příloh je ${MAX_FILES}` }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Chybí soubor" }, { status: 400 });

    // Validace MIME typu
    const mimeType = file.type;
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json(
        { error: `Nepodporovaný typ souboru: ${mimeType}. Povolené: PDF, PNG, JPG, Word, Excel` },
        { status: 400 }
      );
    }

    // Validace velikosti
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: `Soubor je příliš velký (max ${MAX_SIZE_BYTES / 1024 / 1024} MB)` },
        { status: 400 }
      );
    }

    // Načíst obsah a ověřit magic bytes
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!validateMagicBytes(buffer, mimeType)) {
      return NextResponse.json({ error: "Obsah souboru neodpovídá deklarovanému typu" }, { status: 400 });
    }

    // UUID jako storage key — originalName jen v DB
    const storageKey = crypto.randomUUID();
    const originalName = sanitizeFilename(file.name);

    // Nejdřív DB záznam, pak zápis na disk — eliminuje file leak při selhání DB
    const attachment = await prisma.reservationAttachment.create({
      data: {
        reservationId: id,
        originalName,
        storageKey,
        mimeType,
        sizeBytes: file.size,
        uploadedByUserId: session.id,
        uploadedByUsername: session.username,
      },
    });

    // Zapsat soubor na filesystem: data/reservation-attachments/{reservationId}/{uuid}
    const storageDir = path.join(process.cwd(), "data", "reservation-attachments", String(id));
    await mkdir(storageDir, { recursive: true });
    const filePath = path.join(storageDir, storageKey);
    try {
      await writeFile(filePath, buffer);
    } catch (writeError) {
      // Rollback DB záznamu pokud zápis na disk selže
      await prisma.reservationAttachment.delete({ where: { id: attachment.id } }).catch(() => {});
      throw writeError;
    }

    return NextResponse.json(attachment, { status: 201 });
  } catch (error) {
    logger.error(`[POST /api/reservations/${id}/attachments]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
