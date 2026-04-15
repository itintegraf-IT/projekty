import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";

// In-memory rate limiter: max 10 attempts per IP per 15 minutes
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { allowed, retryAfterSeconds } = checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: `Příliš mnoho pokusů. Zkuste znovu za ${Math.ceil(retryAfterSeconds / 60)} minut.` },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }

  try {
    let u = "";
    let password = "";
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const fd = await req.formData();
      u = String(fd.get("username") ?? "").trim();
      password = String(fd.get("password") ?? "");
    } else {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ error: "Neplatný formát požadavku" }, { status: 400 });
      }
      u = typeof (body as Record<string, unknown>)?.username === "string"
        ? (body as Record<string, unknown>).username as string
        : "";
      password = typeof (body as Record<string, unknown>)?.password === "string"
        ? (body as Record<string, unknown>).password as string
        : "";
      u = u.trim();
    }
    if (!u || !password) {
      return NextResponse.json({ error: "Chybí přihlašovací údaje" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { username: u } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return NextResponse.json({ error: "Nesprávné přihlašovací údaje" }, { status: 401 });
    }

    await createSession({
      id: user.id,
      username: user.username,
      role: user.role,
      assignedMachine: user.assignedMachine ?? null,
    });
    return NextResponse.json({ ok: true, role: user.role });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[POST /api/auth/login]", error);
    const detail = process.env.NODE_ENV !== "production" ? msg : undefined;
    return NextResponse.json(
      { error: "Chyba serveru", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}
