import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import {
  checkRateLimit, getClientIp, isRateLimited, recordFailure,
  clearRateLimit, getRetryAfterSeconds,
} from "@/lib/rateLimiter";
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
    //
    // Heslo se ověřuje VŽDY jako první a limit blokuje jen CHYBNÉ pokusy —
    // jinak by kdokoli z LAN pěti špatnými hesly zamkl cizí účet (i admina)
    // a majitel se správným heslem by se nedostal dovnitř (review S2).
    // Brute-force tím neztrácí ochranu: útočník bez hesla dostane 429 a
    // hrubou sílu navíc drží per-IP limit výš.
    const userKey = u.toLowerCase();
    const user = await prisma.user.findUnique({ where: { username: u } });
    const credentialsOk = !!user && (await bcrypt.compare(password, user.passwordHash));

    if (!credentialsOk) {
      recordFailure("login-user", userKey, 15 * 60 * 1000);
      const limited = isRateLimited("login-user", userKey, 5);
      await recordLogin({
        userId: user?.id ?? null,
        username: u,
        success: false,
        failureReason: limited ? "USER_RATE_LIMIT" : "INVALID_CREDENTIALS",
        ipAddress: ip,
      });
      if (limited) {
        const retryAfter = getRetryAfterSeconds("login-user", userKey);
        return NextResponse.json(
          { error: `Příliš mnoho neúspěšných pokusů. Zkuste znovu za ${Math.ceil(retryAfter / 60)} minut.` },
          { status: 429, headers: { "Retry-After": String(retryAfter) } }
        );
      }
      return NextResponse.json({ error: "Nesprávné přihlašovací údaje" }, { status: 401 });
    }
    // Úspěch → počítadlo neúspěchů pryč.
    clearRateLimit("login-user", userKey);

    // TISKAR jede na kioskových terminálech u strojů (Raspberry Pi, autostart
    // prohlížeče, žádný OS účet). Terminál se přihlašuje RUČNĚ heslem a nemá
    // žádný automatický re-bootstrap — kratší session by po expiraci ukázala
    // u stroje přihlašovací formulář, ke kterému obsluha nezná heslo
    // (review V3). Delší platnost je vědomý ústupek k HTTP-uvnitř-VPN
    // rozhodnutí; revokace je od Fáze 4 okamžitá přes tokenVersion.
    // Kioskový bootstrap endpoint (/api/auth/kiosk) má 30 dní — ten se umí
    // obnovit sám svým klíčem.
    const sessionDays = user.role === "TISKAR" ? 365 : 7;
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
