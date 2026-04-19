import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  try {
    const user = await getSession();
    if (!user) throw new AppError("FORBIDDEN", "Nepřihlášený uživatel.");
    if (user.role !== "ADMIN") throw new AppError("FORBIDDEN", "Nedostatečné oprávnění.");

    if (!Number.isFinite(id)) throw new AppError("VALIDATION_ERROR", "Neplatné ID.");

    const body = (await req.json()) as { name?: string; isActive?: boolean; sortOrder?: number };
    const data: Record<string, unknown> = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) throw new AppError("VALIDATION_ERROR", "Jméno je povinné.");
      data.name = name;
    }
    if (typeof body.isActive === "boolean") data.isActive = body.isActive;
    if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;

    if (Object.keys(data).length === 0) throw new AppError("VALIDATION_ERROR", "Žádné změny.");

    const printer = await prisma.printer.update({ where: { id }, data });
    logger.info("[printers.PUT] upraven tiskař", { id, by: user.username });
    return NextResponse.json(printer);
  } catch (err) {
    if (isAppError(err)) {
      const status = err.code === "FORBIDDEN" ? 403 : err.code === "VALIDATION_ERROR" ? 400 : 409;
      return NextResponse.json({ error: err.message }, { status });
    }
    if ((err as { code?: string })?.code === "P2025") return NextResponse.json({ error: "Tiskař nenalezen." }, { status: 404 });
    logger.error("[printers.PUT] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  try {
    const user = await getSession();
    if (!user) throw new AppError("FORBIDDEN", "Nepřihlášený uživatel.");
    if (user.role !== "ADMIN") throw new AppError("FORBIDDEN", "Nedostatečné oprávnění.");

    if (!Number.isFinite(id)) throw new AppError("VALIDATION_ERROR", "Neplatné ID.");

    // Měkké smazání — isActive=false, aby zůstaly historické ShiftAssignment záznamy
    const printer = await prisma.printer.update({
      where: { id },
      data: { isActive: false },
    });
    logger.info("[printers.DELETE] deaktivován tiskař", { id, by: user.username });
    return NextResponse.json(printer);
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: err.code === "FORBIDDEN" ? 403 : 400 });
    if ((err as { code?: string })?.code === "P2025") return NextResponse.json({ error: "Tiskař nenalezen." }, { status: 404 });
    logger.error("[printers.DELETE] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
