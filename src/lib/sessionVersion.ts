import { prisma } from "./prisma";

/**
 * Revokace sessions (audit SEC-03): JWT nese `tokenVersion` a tady se
 * porovnává s aktuální hodnotou v DB. Bump verze (změna role, změna hesla)
 * nebo smazání účtu okamžitě zneplatní všechny dřív vydané tokeny —
 * bez toho by propuštěný zaměstnanec měl přístup až do expirace (7–90 dní).
 *
 * getSession() se volá při každém requestu, proto krátká in-memory cache:
 * revokace se propíše do ~CACHE_TTL_MS, což je pro tenhle účel dost.
 * Cache je per-proces (aplikace jede záměrně single-instance fork mód).
 */
const CACHE_TTL_MS = 30_000;

type CacheEntry = { version: number | null; expiresAt: number };
const cache = new Map<number, CacheEntry>();

/** Testovací/administrační hook — zahodí cache (např. po bumpu). */
export function invalidateSessionVersionCache(userId?: number): void {
  if (userId === undefined) cache.clear();
  else cache.delete(userId);
}

async function loadVersion(userId: number, now: number): Promise<number | null> {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > now) return cached.version;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true },
  });
  const version = user ? user.tokenVersion : null; // null = účet neexistuje
  cache.set(userId, { version, expiresAt: now + CACHE_TTL_MS });
  return version;
}

/**
 * true = token je stále platný. false = účet smazán nebo verze nesouhlasí.
 * Při chybě DB záměrně `true` (fail-open): výpadek databáze nesmí odhlásit
 * celou firmu — samotná aplikace bez DB stejně nic neudělá.
 */
export async function checkSessionVersion(userId: number, tokenVersion: number): Promise<boolean> {
  try {
    const current = await loadVersion(userId, Date.now());
    if (current === null) return false;
    return current === tokenVersion;
  } catch {
    return true;
  }
}

/** Minimální tvar transakčního klienta, který bumpTokenVersion potřebuje. */
type TokenVersionTx = {
  user: {
    update: (args: {
      where: { id: number };
      data: { tokenVersion: { increment: number } };
    }) => Promise<unknown>;
  };
};

/**
 * Zvýší verzi tokenů uživatele (= odhlásí ho všude) a zahodí cache.
 * Volat uvnitř transakce, která mění roli/heslo.
 */
export async function bumpTokenVersion(tx: TokenVersionTx, userId: number): Promise<void> {
  await tx.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
  invalidateSessionVersionCache(userId);
}
