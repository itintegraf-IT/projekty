import { SignJWT } from "jose";
import type { SessionUser } from "./auth";

const jwtSecretRaw = process.env.JWT_SECRET;
if (!jwtSecretRaw) {
  throw new Error(
    "[sessionToken] JWT_SECRET env variable is not set. " +
    "Add it to .env (development) or to the production environment."
  );
}
const SECRET = new TextEncoder().encode(jwtSecretRaw);

/** Podepíše JWT session token. `expiresIn` ve formátu jose (např. "7d", "365d"). */
export async function signSessionToken(
  user: SessionUser,
  expiresIn: string = "7d"
): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(SECRET);
}
