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

/**
 * IP klienta pro rate limiting a LoginLog.
 *
 * Priorita `x-real-ip` (nginx ho na produkci přepisuje skutečnou remote adresou)
 * a z `x-forwarded-for` se bere POSLEDNÍ hodnota — tu připojuje nejbližší proxy.
 * První (nejlevější) hodnota je plně pod kontrolou klienta, takže se s ní dal
 * rate limit obejít a otrávit audit (audit SEC-04 / A-3).
 */
export function getClientIp(req: NextRequest | Request): string {
  const h = req.headers;
  const realIp = h.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return "unknown";
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
