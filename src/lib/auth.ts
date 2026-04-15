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
    return payload as unknown as SessionUser;
  } catch (error) {
    console.error("Session verification failed", error);
    return null;
  }
}

export async function deleteSession() {
  (await cookies()).delete(COOKIE);
}
