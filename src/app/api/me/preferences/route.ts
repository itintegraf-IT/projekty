import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { AppError, isAppError } from "@/lib/errors";

function errorStatus(code: string): number {
  if (code === "FORBIDDEN") return 403;
  if (code === "NOT_FOUND") return 404;
  if (code === "VALIDATION_ERROR") return 400;
  return 500;
}

// GET /api/me/preferences
// Vrátí všechny uložené preference přihlášeného uživatele jako { key: value }
export async function GET(_request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Nepřihlášen." }, { status: 401 });

    const prefs = await prisma.userPreference.findMany({
      where: { userId: session.id },
    });

    const result: Record<string, string> = {};
    for (const p of prefs) result[p.key] = p.value;

    return NextResponse.json(result);
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    logger.error("[preferences GET] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}

// PUT /api/me/preferences
// Body: { key: string, value: string }
// Uloží nebo aktualizuje jednu preferenci přihlášeného uživatele (upsert)
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Nepřihlášen." }, { status: 401 });

    const body = await request.json();
    const { key, value } = body ?? {};

    if (typeof key !== "string" || key.trim() === "") {
      throw new AppError("VALIDATION_ERROR", "Parametr key musí být neprázdný string.");
    }
    if (typeof value !== "string") {
      throw new AppError("VALIDATION_ERROR", "Parametr value musí být string.");
    }
    if (key.length > 64 || value.length > 256) {
      throw new AppError("VALIDATION_ERROR", "Parametry key nebo value jsou příliš dlouhé.");
    }

    const ALLOWED_NUMERIC_KEYS = new Set(["zoom", "aside-width", "dtp-panel-width"]);
    if (!ALLOWED_NUMERIC_KEYS.has(key)) {
      throw new AppError("VALIDATION_ERROR", "Neznámý klíč preference.");
    }
    if (isNaN(Number(value))) {
      throw new AppError("VALIDATION_ERROR", "Hodnota pro tento klíč musí být číslo.");
    }

    await prisma.userPreference.upsert({
      where: { userId_key: { userId: session.id, key } },
      create: { userId: session.id, key, value },
      update: { value },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    logger.error("[preferences PUT] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
