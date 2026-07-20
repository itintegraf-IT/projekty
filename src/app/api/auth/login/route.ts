import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rateLimiter";

async function recordLogin(entry: {
  userId: number | null;
  username: string;
  success: boolean;
  failureReason?: string;
  ipAddress: string;
}): Promise<void> {
  try {
    await prisma.loginLog.create({ data: entry });
  } catch (err) {
    logger.error("[login] zápis LoginLog selhal", err);
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { allowed, retryAfterSeconds } = checkRateLimit("login", ip, 10, 15 * 60 * 1000);
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
      await recordLogin({
        userId: user?.id ?? null,
        username: u,
        success: false,
        failureReason: "INVALID_CREDENTIALS",
        ipAddress: ip,
      });
      return NextResponse.json({ error: "Nesprávné přihlašovací údaje" }, { status: 401 });
    }

    await createSession({
      id: user.id,
      username: user.username,
      role: user.role,
      assignedMachine: user.assignedMachine ?? null,
    });
    await recordLogin({
      userId: user.id,
      username: user.username,
      success: true,
      ipAddress: ip,
    });
    return NextResponse.json({ ok: true, role: user.role });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("[POST /api/auth/login]", error);
    const detail = process.env.NODE_ENV !== "production" ? msg : undefined;
    return NextResponse.json(
      { error: "Chyba serveru", ...(detail ? { detail } : {}) },
      { status: 500 }
    );
  }
}
