import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";

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
    return NextResponse.json({ error: "Chyba serveru", detail: msg }, { status: 500 });
  }
}
