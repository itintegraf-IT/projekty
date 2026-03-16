import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  threeDaysAgo.setHours(0, 0, 0, 0);

  try {
    // Načíst dnešní logy od uživatelů s rolí DTP nebo MTZ
    const dtpMtzUsernames = await prisma.user.findMany({
      where: { role: { in: ["DTP", "MTZ"] } },
      select: { username: true },
    });
    const usernames = dtpMtzUsernames.map((u) => u.username);

    const logs = await prisma.auditLog.findMany({
      where: {
        createdAt: { gte: threeDaysAgo },
        username: { in: usernames },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(logs);
  } catch (error) {
    console.error("[GET /api/audit/today]", error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
