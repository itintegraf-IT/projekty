import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) throw new AppError("FORBIDDEN", "Nepřihlášený uživatel.");
    if (!["ADMIN", "PLANOVAT"].includes(user.role)) throw new AppError("FORBIDDEN", "Nedostatečné oprávnění.");

    const printers = await prisma.printer.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(printers);
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: err.code === "FORBIDDEN" ? 403 : 400 });
    logger.error("[printers.GET] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSession();
    if (!user) throw new AppError("FORBIDDEN", "Nepřihlášený uživatel.");
    if (!["ADMIN"].includes(user.role)) throw new AppError("FORBIDDEN", "Nedostatečné oprávnění.");

    const body = (await req.json()) as { name?: string };
    const name = body.name?.trim();
    if (!name) throw new AppError("VALIDATION_ERROR", "Jméno tiskaře je povinné.");
    if (name.length > 80) throw new AppError("VALIDATION_ERROR", "Jméno je příliš dlouhé (max 80 znaků).");

    const maxOrder = await prisma.printer.aggregate({ _max: { sortOrder: true } });
    const nextOrder = (maxOrder._max.sortOrder ?? 0) + 10;

    const printer = await prisma.printer.create({
      data: { name, sortOrder: nextOrder },
    });
    logger.info("[printers.POST] vytvořen tiskař", { id: printer.id, name, by: user.username });
    return NextResponse.json(printer, { status: 201 });
  } catch (err) {
    if (isAppError(err)) {
      const status = err.code === "FORBIDDEN" ? 403 : err.code === "VALIDATION_ERROR" ? 400 : 409;
      return NextResponse.json({ error: err.message }, { status });
    }
    logger.error("[printers.POST] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
