import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import bcrypt from "bcryptjs";

const ROLE_ORDER: Record<string, number> = {
  ADMIN: 0, PLANOVAT: 1, MTZ: 2, DTP: 3, TISKAR: 4, OBCHODNIK: 5, VIEWER: 6,
};

// GET /api/admin/users — seznam uživatelů (ADMIN only)
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: { id: true, username: true, role: true, assignedMachine: true, createdAt: true },
  });

  users.sort((a, b) => {
    const ra = ROLE_ORDER[a.role] ?? 99;
    const rb = ROLE_ORDER[b.role] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.username.localeCompare(b.username);
  });

  return NextResponse.json(users);
}

// POST /api/admin/users — nový uživatel (ADMIN only)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { username, password, role, assignedMachine } = await req.json();
  if (!username || !password || !role) {
    return NextResponse.json({ error: "Chybí username, password nebo role" }, { status: 400 });
  }

  const VALID_ROLES = ["ADMIN", "PLANOVAT", "MTZ", "DTP", "TISKAR", "OBCHODNIK", "VIEWER"];
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "Neplatná role" }, { status: 400 });
  }

  if (role === "TISKAR") {
    if (!assignedMachine || !["XL_105", "XL_106"].includes(assignedMachine)) {
      return NextResponse.json({ error: "Tiskař musí mít přiřazený stroj (XL_105 nebo XL_106)" }, { status: 400 });
    }
  }

  const machine = role === "TISKAR" ? String(assignedMachine) : null;

  try {
    const passwordHash = await bcrypt.hash(String(password), 10);
    const user = await prisma.user.create({
      data: { username: String(username), passwordHash, role: String(role), assignedMachine: machine },
      select: { id: true, username: true, role: true, assignedMachine: true, createdAt: true },
    });
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    logger.error("Create admin user failed", error);
    return NextResponse.json({ error: "Uživatelské jméno již existuje" }, { status: 409 });
  }
}
