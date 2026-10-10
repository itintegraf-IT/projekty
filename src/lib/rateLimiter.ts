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
 *
 * Adresa smyčky (127.x.x.x, ::1) se vrací jako "unknown". Když proxy IP klienta
 * nepošle, Next.js si `x-forwarded-for` doplní adresou socketu, tedy nginxu na
 * localhostu (`next/dist/server/base-server.js`, `??=`). Bez převodu by se
 * mírnější limit pro "unknown" v login route nikdy nezapnul a celá firma by
 * sdílela přísný limit — tak produkce běžela do 10. 10. 2026 (POUCENI P34).
 */
export function getClientIp(req: NextRequest | Request): string {
  const h = req.headers;
  const realIp = h.get("x-real-ip")?.trim();
  if (realIp) return loopbackAsUnknown(realIp);
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return loopbackAsUnknown(parts[parts.length - 1]);
  }
  return "unknown";
}

function loopbackAsUnknown(ip: string): string {
  if (ip === "::1") return "unknown";
  const v4 = ip.toLowerCase().startsWith("::ffff:") ? ip.slice(7) : ip;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4) ? "unknown" : ip;
}

/**
 * Fixní token bucket. Vrací allowed + retryAfterSeconds.
 * - name  — jmenný prostor limiteru (např. "login", "put-shifts")
 * - key   — identifikátor žadatele (IP nebo userId)
 * - max   — povolený počet requestů v okně
 * - windowMs — velikost okna
 */
/**
 * Varianta pro počítání POUZE neúspěchů (login per účet): `isRateLimited`
 * jen čte stav, `recordFailure` inkrementuje, `clearRateLimit` maže po
 * úspěšném přihlášení. Oddělené, aby úspěšný login nevyčerpával limit
 * a útočník nemohl cizí účet držet zamčený (review S2).
 */
export function isRateLimited(name: string, key: string, max: number): boolean {
  const entry = getStore(name).get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) return false;
  return entry.count >= max;
}

export function recordFailure(name: string, key: string, windowMs: number): void {
  const store = getStore(name);
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  entry.count += 1;
}

export function clearRateLimit(name: string, key: string): void {
  getStore(name).delete(key);
}

export function getRetryAfterSeconds(name: string, key: string): number {
  const entry = getStore(name).get(key);
  if (!entry) return 0;
  return Math.max(0, Math.ceil((entry.resetAt - Date.now()) / 1000));
}

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
