import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// DELETE — ADMIN nebo PLANOVAT — smaže výjimku (den se vrátí k šabloně)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const exceptionId = parseInt(id, 10);
  if (isNaN(exceptionId)) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  const existing = await prisma.machineScheduleException.findUnique({
    where: { id: exceptionId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Výjimka nenalezena" }, { status: 404 });
  }

  await prisma.machineScheduleException.delete({ where: { id: exceptionId } });

  return NextResponse.json({ ok: true });
}
