import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  try {
    const user = await getSession();
    if (!user) throw new AppError("FORBIDDEN", "Nepřihlášený uživatel.");
    if (!["ADMIN", "PLANOVAT"].includes(user.role)) throw new AppError("FORBIDDEN", "Nedostatečné oprávnění.");
    if (!Number.isFinite(id)) throw new AppError("VALIDATION_ERROR", "Neplatné ID.");

    await prisma.shiftAssignment.delete({ where: { id } });
    logger.info("[shift-assignments.DELETE]", { id, by: user.username });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isAppError(err)) {
      const status = err.code === "FORBIDDEN" ? 403 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    if ((err as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Přiřazení nenalezeno." }, { status: 404 });
    }
    logger.error("[shift-assignments.DELETE] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
