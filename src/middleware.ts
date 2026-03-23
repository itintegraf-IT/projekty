import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose/jwt/verify";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "integraf-dev-secret-please-change-in-production"
);

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

    // TISKAR smí jen / a /api/* (ne /admin)
    if (role === "TISKAR") {
      if (pathname.startsWith("/admin") || pathname.startsWith("/tiskar")) {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }

    // Ostatní role nesmí na /tiskar (fallback redirect)
    if (role !== "TISKAR" && pathname.startsWith("/tiskar")) {
      return NextResponse.redirect(new URL("/", req.url));
    }

    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", req.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
