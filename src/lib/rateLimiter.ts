import type { NextRequest } from "next/server";

type Bucket = { count: number; resetAt: number };
type Store = Map<string, Bucket>;

const stores = new Map<string, Store>();

function getStore(name: string): Store {
  let store = stores.get(name);
  if (!store) {
    store = new Map<string, Bucket>();
    stores.set(name, store);
  }
  return store;
}

export function getClientIp(req: NextRequest | Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Fixní token bucket. Vrací allowed + retryAfterSeconds.
 * - name  — jmenný prostor limiteru (např. "login", "put-shifts")
 * - key   — identifikátor žadatele (IP nebo userId)
 * - max   — povolený počet requestů v okně
 * - windowMs — velikost okna
 */
export function checkRateLimit(
  name: string,
  key: string,
  max: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const store = getStore(name);
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (entry.count >= max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
