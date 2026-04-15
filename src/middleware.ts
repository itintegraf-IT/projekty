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

  // Allow login page and auth API without token
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get("integraf-session");
  if (!cookie) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    const { payload } = await jwtVerify(cookie.value, SECRET);
    const role = payload.role as string | undefined;

    // TISKAR smí jen / a /api/* (ne /admin, ne /rezervace)
    if (role === "TISKAR") {
      if (pathname.startsWith("/admin") || pathname.startsWith("/tiskar") || pathname.startsWith("/rezervace")) {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }

    // Ostatní role nesmí na /tiskar (fallback redirect)
    if (role !== "TISKAR" && pathname.startsWith("/tiskar")) {
      return NextResponse.redirect(new URL("/", req.url));
    }

    // OBCHODNIK nesmí na /admin
    if (role === "OBCHODNIK" && pathname.startsWith("/admin")) {
      return NextResponse.redirect(new URL("/", req.url));
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
