import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import bcrypt from "bcryptjs";

// PUT /api/admin/users/[id] — změna role nebo hesla (ADMIN only)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const numId = Number(id);
  if (isNaN(numId)) return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if (body.role !== undefined) {
    // Nesmí si měnit roli sobě
    if (session.id === numId) {
      return NextResponse.json({ error: "Nelze změnit vlastní roli" }, { status: 403 });
    }
    const VALID_ROLES = ["ADMIN", "PLANOVAT", "MTZ", "DTP", "TISKAR", "OBCHODNIK", "VIEWER"];
    if (!VALID_ROLES.includes(String(body.role))) {
      return NextResponse.json({ error: "Neplatná role" }, { status: 400 });
    }
    data.role = String(body.role);

    // TISKAR: assignedMachine povinný; ostatní role: vždy vyčistit
    if (body.role === "TISKAR") {
      if (!body.assignedMachine || !["XL_105", "XL_106"].includes(String(body.assignedMachine))) {
        return NextResponse.json({ error: "Tiskař musí mít přiřazený stroj (XL_105 nebo XL_106)" }, { status: 400 });
      }
      data.assignedMachine = String(body.assignedMachine);
    } else {
      data.assignedMachine = null;
    }
  } else if (body.assignedMachine !== undefined) {
    // Změna stroje bez změny role — ověřit, že uživatel je skutečně TISKAR
    const targetUser = await prisma.user.findUnique({ where: { id: numId }, select: { role: true } });
    if (!targetUser) return NextResponse.json({ error: "Uživatel nenalezen" }, { status: 404 });
    if (targetUser.role !== "TISKAR") {
      return NextResponse.json({ error: "Stroj lze přiřadit jen roli TISKAR" }, { status: 400 });
    }
    if (!["XL_105", "XL_106"].includes(String(body.assignedMachine))) {
      return NextResponse.json({ error: "Neplatný stroj" }, { status: 400 });
    }
    data.assignedMachine = String(body.assignedMachine);
  }

  if (body.password !== undefined) {
    if (String(body.password).length < 1) {
      return NextResponse.json({ error: "Heslo nesmí být prázdné" }, { status: 400 });
    }
    data.passwordHash = await bcrypt.hash(String(body.password), 10);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Žádná změna" }, { status: 400 });
  }

  try {
    const user = await prisma.user.update({
      where: { id: numId },
      data,
      select: { id: true, username: true, role: true, assignedMachine: true, createdAt: true },
    });
    return NextResponse.json(user);
  } catch (error) {
    if ((error as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Uživatel nenalezen" }, { status: 404 });
    }
    logger.error("[PUT /api/admin/users/[id]] neočekávaná chyba", error);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}

// DELETE /api/admin/users/[id] — smazání uživatele (ADMIN only)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const numId = Number(id);
  if (isNaN(numId)) return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });

  if (session.id === numId) {
    return NextResponse.json({ error: "Nelze smazat vlastní účet" }, { status: 403 });
  }

  try {
    await prisma.user.delete({ where: { id: numId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if ((error as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Uživatel nenalezen" }, { status: 404 });
    }
    logger.error("[DELETE /api/admin/users/[id]] neočekávaná chyba", error);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
