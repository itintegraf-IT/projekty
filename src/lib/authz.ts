import { AppError } from "./errors";
import type { SessionUser } from "./auth";

/**
 * Čisté jádro role-checku (audit #81) — testovatelné bez cookies/JWT/DB.
 * Route handlery používají async wrapper `requireRole` z `@/lib/auth`.
 *
 * Vyhazuje AppError, který catch blok route mapuje přes `errorStatus`:
 * UNAUTHORIZED → 401 (nepřihlášený), FORBIDDEN → 403 (špatná role).
 */
export function assertRole(
  session: SessionUser | null,
  roles: readonly string[],
): SessionUser {
  if (!session) {
    throw new AppError("UNAUTHORIZED", "Nepřihlášený uživatel.");
  }
  if (!roles.includes(session.role)) {
    throw new AppError("FORBIDDEN", "Nedostatečné oprávnění.");
  }
  return session;
}
