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

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.role !== undefined) {
    // Nesmí si měnit roli sobě
    if (session.id === numId) {
      return NextResponse.json({ error: "Nelze změnit vlastní roli" }, { status: 403 });
    }
    const VALID_ROLES = ["ADMIN", "PLANOVAT", "MTZ", "DTP", "VIEWER"];
    if (!VALID_ROLES.includes(body.role)) {
      return NextResponse.json({ error: "Neplatná role" }, { status: 400 });
    }
    data.role = String(body.role);
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
      select: { id: true, username: true, role: true, createdAt: true },
    });
    return NextResponse.json(user);
  } catch {
    return NextResponse.json({ error: "Uživatel nenalezen" }, { status: 404 });
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
  } catch {
    return NextResponse.json({ error: "Uživatel nenalezen" }, { status: 404 });
  }
}
