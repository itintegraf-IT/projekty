import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

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
export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(SECRET);
}

/** Vrátí hodnoty pro Set-Cookie hlavičku (pro HTTP přístup přes IP) */
export function getCookieOptions(): { secure: boolean } {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_HTTP_SESSION === "true") {
    throw new Error(
      "[auth] ALLOW_HTTP_SESSION=true is not permitted in production. " +
      "Remove this env var from the production environment."
    );
  }
  const secure = process.env.NODE_ENV === "production";
  return { secure };
}

export async function createSession(user: SessionUser) {
  const token = await createSessionToken(user);
  const { secure } = getCookieOptions();
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
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
