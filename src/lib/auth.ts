import { jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { assertRole } from "./authz";
import { signSessionToken } from "./sessionToken";
import { resolveCookieSecure } from "./cookieSecurity";

const jwtSecretRaw = process.env.JWT_SECRET;
if (!jwtSecretRaw) {
  throw new Error(
    "[auth] JWT_SECRET env variable is not set. " +
    "Add it to .env (development) or to the production environment."
  );
}
const SECRET = new TextEncoder().encode(jwtSecretRaw);
const COOKIE = "integraf-session";

export interface SessionUser {
  id: number;
  username: string;
  role: string;
  assignedMachine: string | null;
}

const VALID_ROLES = ["ADMIN", "PLANOVAT", "DTP", "MTZ", "OBCHODNIK", "TISKAR", "VIEWER"] as const;

function parseJwtPayload(payload: unknown): SessionUser {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("JWT payload is not an object");
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.id !== "number") throw new Error("JWT payload: id must be a number");
  if (typeof p.username !== "string") throw new Error("JWT payload: username must be a string");
  if (!VALID_ROLES.includes(p.role as typeof VALID_ROLES[number])) {
    throw new Error(`JWT payload: invalid role "${String(p.role)}"`);
  }
  return {
    id: p.id,
    username: p.username,
    role: p.role as string,
    assignedMachine: typeof p.assignedMachine === "string" ? p.assignedMachine : null,
  };
}

/** Vrátí JWT token pro session — pro ruční nastavení cookie v Route Handleru */
export async function createSessionToken(
  user: SessionUser,
  expiresIn: string = "7d"
): Promise<string> {
  return signSessionToken(user, expiresIn);
}

/**
 * Vrátí hodnoty pro Set-Cookie hlavičku.
 *
 * `secure` se NEderivuje z `NODE_ENV` (to rozbíjelo login na HTTP nasazení —
 * audit SEC-001), ale z reálného protokolu požadavku, s možností explicitního
 * přebití přes ENV `COOKIE_SECURE`. Rozhodovací logika je čistá a testovaná
 * v `cookieSecurity.ts`; tady se jen posbírají vstupy.
 *
 * Pro nasazení na čistém HTTP ve firemní LAN nastavit `COOKIE_SECURE=false`
 * (vědomý ústupek — cookie pak jde po síti v plaintextu).
 */
export async function getCookieOptions(): Promise<{ secure: boolean }> {
  const forwardedProto = (await headers()).get("x-forwarded-proto");
  return {
    secure: resolveCookieSecure({
      explicit: process.env.COOKIE_SECURE,
      forwardedProto,
      nodeEnv: process.env.NODE_ENV,
    }),
  };
}

export async function createSession(
  user: SessionUser,
  opts: { days?: number } = {}
) {
  const days = opts.days ?? 7;
  const token = await createSessionToken(user, `${days}d`);
  const { secure } = await getCookieOptions();
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * days,
    path: "/",
  });
}

export async function getSession(): Promise<SessionUser | null> {
  const c = (await cookies()).get(COOKIE);
  if (!c) return null;
  try {
    const { payload } = await jwtVerify(c.value, SECRET);
    return parseJwtPayload(payload);
  } catch (error) {
    console.error("Session verification failed", error);
    return null;
  }
}

export async function deleteSession() {
  (await cookies()).delete(COOKIE);
}

/**
 * Auth + role gate pro API routes (audit #81). Vyhazuje AppError
 * (UNAUTHORIZED/FORBIDDEN) — volat UVNITŘ try bloku route, catch mapuje
 * přes `errorStatus(err.code)`. Čisté jádro: `assertRole` v `@/lib/authz`.
 *
 *   const user = await requireRole(["ADMIN", "PLANOVAT"]);
 *
 * Standard pro nové routes; stávající return-style gaty se převádí průběžně.
 */
export async function requireRole(roles: readonly string[]): Promise<SessionUser> {
  return assertRole(await getSession(), roles);
}
