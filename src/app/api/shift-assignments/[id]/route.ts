import { NextResponse } from "next/server";
import { AppError, isAppError, errorStatus } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  try {
    const user = await requireRole(["ADMIN", "PLANOVAT"]);
    if (!Number.isFinite(id)) throw new AppError("VALIDATION_ERROR", "Neplatné ID.");

    await prisma.shiftAssignment.delete({ where: { id } });
    logger.info("[shift-assignments.DELETE]", { id, by: user.username });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    }
    if ((err as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Přiřazení nenalezeno." }, { status: 404 });
    }
    logger.error("[shift-assignments.DELETE] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
