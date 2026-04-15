import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseBadgeColor } from "@/lib/badgeColors";

// PUT /api/codebook/[id] — edit položky (ADMIN only)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || !["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const numId = Number(id);
  if (isNaN(numId)) return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });

  try {
    const body = await request.json();

    const badgeColorResult = body.badgeColor !== undefined ? parseBadgeColor(body.badgeColor) : null;
    if (badgeColorResult && "error" in badgeColorResult) {
      return NextResponse.json({ error: badgeColorResult.error }, { status: 400 });
    }

    const updated = await prisma.codebookOption.update({
      where: { id: numId },
      data: {
        ...(body.label !== undefined ? { label: String(body.label) } : {}),
        ...(body.isWarning !== undefined ? { isWarning: Boolean(body.isWarning) } : {}),
        ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
        ...(body.shortCode !== undefined ? { shortCode: body.shortCode } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) } : {}),
        ...(badgeColorResult ? { badgeColor: badgeColorResult.color } : {}),
      },
    });
    return NextResponse.json(updated);
  } catch (error) {
    logger.error("Update codebook option failed", error);
    return NextResponse.json({ error: "Chyba při ukládání" }, { status: 500 });
  }
}

// DELETE /api/codebook/[id] — smazání položky (ADMIN only)
// Bezpečné — bloky mají uložený snapshotLabel, takže historická data zůstanou
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || !["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const numId = Number(id);
  if (isNaN(numId)) return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });

  try {
    const existing = await prisma.codebookOption.findUnique({
      where: { id: numId },
      select: { category: true, label: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Položka nenalezena" }, { status: 404 });
    }

    const presetWhere =
      existing.category === "DATA"
        ? { dataStatusId: numId }
        : existing.category === "MATERIAL"
          ? { materialStatusId: numId }
          : existing.category === "BARVY"
            ? { barvyStatusId: numId }
            : existing.category === "LAK"
              ? { lakStatusId: numId }
              : null;

    if (presetWhere) {
      const dependentPreset = await prisma.jobPreset.findFirst({
        where: {
          isActive: true,
          ...presetWhere,
        },
        select: { name: true },
      });
      if (dependentPreset) {
        return NextResponse.json(
          { error: `Položku nelze smazat — používá ji aktivní preset '${dependentPreset.name}'.` },
          { status: 409 }
        );
      }
    }

    await prisma.codebookOption.delete({ where: { id: numId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Delete codebook option failed", error);
    return NextResponse.json({ error: "Chyba při mazání" }, { status: 500 });
  }
}
