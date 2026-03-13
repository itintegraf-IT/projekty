import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSessionToken, getCookieOptions } from "@/lib/auth";

const COOKIE = "integraf-session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 dní

function getBaseUrl(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? (req.nextUrl?.protocol?.replace(":", "") ?? "http");
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
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
    const base = getBaseUrl(req);
    if (!u || !password) {
      return NextResponse.redirect(new URL("/login?error=" + encodeURIComponent("Chybí přihlašovací údaje"), base));
    }

    const user = await prisma.user.findUnique({ where: { username: u } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return NextResponse.redirect(new URL("/login?error=" + encodeURIComponent("Nesprávné přihlašovací údaje"), base));
    }

    const token = await createSessionToken({ id: user.id, username: user.username, role: user.role });
    const { secure } = getCookieOptions();
    const cookieParts = [
      `${COOKIE}=${token}`,
      "HttpOnly",
      "Path=/",
      `Max-Age=${MAX_AGE}`,
      "SameSite=Lax",
      ...(secure ? ["Secure"] : []),
    ];
    const res = NextResponse.redirect(new URL("/", base), 302);
    res.headers.set("Set-Cookie", cookieParts.join("; "));
    return res;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[POST /api/auth/login]", error);
    const base = getBaseUrl(req);
    return NextResponse.json({ error: "Chyba serveru", detail: msg }, { status: 500 });
  }
}
