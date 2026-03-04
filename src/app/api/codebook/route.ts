import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/codebook?category=DATA
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");

  try {
    const options = await prisma.codebookOption.findMany({
      where: {
        ...(category ? { category } : {}),
        isActive: true,
      },
      orderBy: { sortOrder: "asc" },
    });
    return NextResponse.json(options);
  } catch (error) {
    console.error("[GET /api/codebook]", error);
    return NextResponse.json({ error: "Chyba při načítání číselníku" }, { status: 500 });
  }
}

// POST /api/codebook — přidání nové položky (etapa 9: admin only)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.category || !body.label) {
      return NextResponse.json({ error: "Chybí category nebo label" }, { status: 400 });
    }
    const option = await prisma.codebookOption.create({
      data: {
        category: String(body.category),
        label: String(body.label),
        sortOrder: body.sortOrder ?? 0,
        isActive: body.isActive ?? true,
        shortCode: body.shortCode ?? null,
        isWarning: body.isWarning ?? false,
      },
    });
    return NextResponse.json(option, { status: 201 });
  } catch (error) {
    console.error("[POST /api/codebook]", error);
    return NextResponse.json({ error: "Chyba při vytváření položky" }, { status: 500 });
  }
}
