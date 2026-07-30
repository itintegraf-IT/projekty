import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { validatePassword, BCRYPT_COST } from "@/lib/passwordPolicy";
import bcrypt from "bcryptjs";

const ROLE_ORDER: Record<string, number> = {
  ADMIN: 0, PLANOVAT: 1, MTZ: 2, DTP: 3, TISKAR: 4, OBCHODNIK: 5, VIEWER: 6,
};

function isPrismaUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === "P2002";
}

// GET /api/admin/users — seznam uživatelů (ADMIN only)
export async function GET() {
  try {
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
  } catch (err) {
    logger.error("[GET /api/admin/users] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}

// POST /api/admin/users — nový uživatel (ADMIN only)
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { username, password, role, assignedMachine } = body as {
      username?: string; password?: string; role?: string; assignedMachine?: string;
    };
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

    const pwCheck = validatePassword(password, String(username));
    if (!pwCheck.ok) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 });
    }

    const machine = role === "TISKAR" ? String(assignedMachine) : null;

    const passwordHash = await bcrypt.hash(String(password), BCRYPT_COST);
    const user = await prisma.user.create({
      data: { username: String(username), passwordHash, role: String(role), assignedMachine: machine },
      select: { id: true, username: true, role: true, assignedMachine: true, createdAt: true },
    });
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    // Jen skutečná unique-kolize je 409 — dřív se na 409 „jméno existuje"
    // mapoval i výpadek DB, což mátlo diagnostiku.
    if (isPrismaUniqueViolation(error)) {
      return NextResponse.json({ error: "Uživatelské jméno již existuje" }, { status: 409 });
    }
    logger.error("[POST /api/admin/users] neočekávaná chyba", error);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
