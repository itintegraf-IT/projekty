import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rateLimiter";
import { recordLogin } from "@/lib/loginLog";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  // Když reverzní proxy neposílá X-Real-IP ani X-Forwarded-For, spadnou VŠICHNI
  // uživatelé do jednoho bucketu "unknown" a přísný limit by zamkl celou firmu.
  // Reálnou ochranu účtu v takovém případě dělá per-účet limiter níž.
  // (Nginx MUSÍ nastavovat X-Real-IP — viz docs/DEPLOY_WORKFLOW.md.)
  const ipLimitMax = ip === "unknown" ? 100 : 10;
  const { allowed, retryAfterSeconds } = checkRateLimit("login", ip, ipLimitMax, 15 * 60 * 1000);
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

    // Druhý limiter per-účet: útok z více IP (botnet, podvržené hlavičky)
    // by per-IP limit nikdy nepotkal (audit SEC-04).
    const perUser = checkRateLimit("login-user", u.toLowerCase(), 5, 15 * 60 * 1000);
    if (!perUser.allowed) {
      await recordLogin({
        userId: null, username: u, success: false,
        failureReason: "USER_RATE_LIMIT", ipAddress: ip,
      });
      return NextResponse.json(
        { error: `Příliš mnoho pokusů. Zkuste znovu za ${Math.ceil(perUser.retryAfterSeconds / 60)} minut.` },
        { status: 429, headers: { "Retry-After": String(perUser.retryAfterSeconds) } }
      );
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

    // TISKAR jede na kioskových terminálech u strojů (Raspberry Pi, autostart
    // prohlížeče, žádný OS účet). Terminál se přihlásí jednou a session musí
    // vydržet — 7denní default by znamenal ruční přihlašování každý týden.
    // 90 dní (dřív 365) je kompromis: na HTTP jde cookie po síti v plaintextu,
    // roční platnost ukradeného tokenu je neúměrná (audit K-4).
    const sessionDays = user.role === "TISKAR" ? 90 : 7;
    await createSession(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        assignedMachine: user.assignedMachine ?? null,
        tokenVersion: user.tokenVersion,
      },
      { days: sessionDays }
    );
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
