import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose/jwt/verify";

const jwtSecretRaw = process.env.JWT_SECRET;
if (!jwtSecretRaw) {
  throw new Error(
    "[middleware] JWT_SECRET env variable is not set. " +
    "Add it to .env (development) or to the production environment."
  );
}
const SECRET = new TextEncoder().encode(jwtSecretRaw);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Login page a explicitně vyjmenované auth routes bez tokenu.
  // Allowlist místo prefixu `/api/auth` — prefix by automaticky zveřejnil
  // každou budoucí auth route (audit SEC-08).
  const PUBLIC_AUTH_ROUTES = ["/api/auth/login", "/api/auth/logout", "/api/auth/kiosk"];
  if (pathname.startsWith("/login") || PUBLIC_AUTH_ROUTES.includes(pathname)) {
    return NextResponse.next();
  }

  // Liveness probe pro monitoring — záměrně přesná shoda (===), ne prefix,
  // aby výjimka nikdy nepokryla budoucí routes (viz audit SEC-08).
  if (pathname === "/api/health") {
    return NextResponse.next();
  }

  // Kioskový launcher (statický soubor v public/) musí naběhnout i bez session —
  // přihlášení řeší až vnořený iframe plánu. Bez této výjimky by middleware
  // terminál redirectoval na /login a lišta s přepínačem by se nikdy nezobrazila.
  if (pathname === "/vyroba-terminal.html") {
    return NextResponse.next();
  }

  const cookie = req.cookies.get("integraf-session");
  if (!cookie) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    const { payload } = await jwtVerify(cookie.value, SECRET, { algorithms: ["HS256"] });
    const role = payload.role as string | undefined;

    // TISKAR smí jen / a /api/* (ne /rezervace; /admin řeší allowlist níž)
    if (role === "TISKAR" && pathname.startsWith("/rezervace")) {
      return NextResponse.redirect(new URL("/", req.url));
    }

    // /admin — allowlist místo denylistu, aby nová role nebyla automaticky
    // průchozí (audit D-1). Page guard v admin/page.tsx zůstává jako druhá
    // vrstva; výsledné chování rolí je stejné jako dřív.
    if (pathname.startsWith("/admin")) {
      if (!role || !["ADMIN", "PLANOVAT"].includes(role)) {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }

    // /reporty — jen ADMIN
    if (pathname.startsWith("/reporty") && !pathname.startsWith("/api/")) {
      if (role !== "ADMIN") {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }

    // /api/report/dashboard — jen ADMIN
    if (pathname.startsWith("/api/report/dashboard")) {
      if (role !== "ADMIN") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // /rezervace — jen ADMIN, PLANOVAT, OBCHODNIK
    if (pathname.startsWith("/rezervace") && !pathname.startsWith("/api/")) {
      const allowed = ["ADMIN", "PLANOVAT", "OBCHODNIK"];
      if (!role || !allowed.includes(role)) {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }

    // /api/reservations — jen ADMIN, PLANOVAT, OBCHODNIK
    if (pathname.startsWith("/api/reservations")) {
      const allowed = ["ADMIN", "PLANOVAT", "OBCHODNIK"];
      if (!role || !allowed.includes(role)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // /expedice je dostupné všem přihlášeným rolím v read-only režimu,
    // proto tu záměrně nemá další role gate.

    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", req.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
