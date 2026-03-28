import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseBadgeColor } from "@/lib/badgeColors";

// GET /api/codebook?category=DATA&includeInactive=true
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const includeInactive = searchParams.get("includeInactive") === "true";

  try {
    const options = await prisma.codebookOption.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { sortOrder: "asc" },
    });
    return NextResponse.json(options);
  } catch (error) {
    console.error("[GET /api/codebook]", error);
    return NextResponse.json({ error: "Chyba při načítání číselníku" }, { status: 500 });
  }
}

// POST /api/codebook — přidání nové položky (ADMIN only)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    if (!body.category || !body.label) {
      return NextResponse.json({ error: "Chybí category nebo label" }, { status: 400 });
    }

    const badgeColorResult = parseBadgeColor(body.badgeColor);
    if ("error" in badgeColorResult) {
      return NextResponse.json({ error: badgeColorResult.error }, { status: 400 });
    }

    // auto sortOrder = max + 1 v dané kategorii
    const maxItem = await prisma.codebookOption.findFirst({
      where: { category: String(body.category) },
      orderBy: { sortOrder: "desc" },
    });
    const nextSortOrder = (maxItem?.sortOrder ?? -1) + 1;

    const option = await prisma.codebookOption.create({
      data: {
        category: String(body.category),
        label: String(body.label),
        sortOrder: body.sortOrder ?? nextSortOrder,
        isActive: body.isActive ?? true,
        shortCode: body.shortCode ?? null,
        isWarning: body.isWarning ?? false,
        badgeColor: badgeColorResult.color,
      },
    });
    return NextResponse.json(option, { status: 201 });
  } catch (error) {
    console.error("[POST /api/codebook]", error);
    return NextResponse.json({ error: "Chyba při vytváření položky" }, { status: 500 });
  }
}
