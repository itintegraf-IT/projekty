import { prisma } from "./prisma";
import { logger } from "./logger";

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
  } catch (err) {
    // Fail-open nesmí být němý: trvale rozbitý dotaz (např. chybějící sloupec
    // po nedokončené migraci) by jinak revokaci vypnul navždy a nikdo by se to
    // nedozvěděl. Log je rate-limitovaný, ať nezaplaví PM2 log.
    logFailOpen(err);
    return true;
  }
}

let lastFailOpenLogAt = 0;
function logFailOpen(err: unknown): void {
  const now = Date.now();
  if (now - lastFailOpenLogAt < 60_000) return;
  lastFailOpenLogAt = now;
  logger.error(
    "[sessionVersion] kontrola verze tokenu selhala — revokace sessions je DOČASNĚ NEAKTIVNÍ (fail-open). Ověř migraci tokenVersion a stav DB.",
    err
  );
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
