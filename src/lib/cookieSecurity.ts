/**
 * Rozhodnutí, zda session cookie dostane příznak `Secure` — čistá funkce,
 * aby šla testovat bez `next/headers` (audit vytýkal, že tahle bezpečnostně
 * kritická větev nebyla krytá testy).
 *
 * Historie (audit SEC-001): `secure` se derivovalo slepě z `NODE_ENV`, takže
 * na HTTP nasazení prohlížeč cookie se `Secure` zahodil → přihlášení „prošlo",
 * ale uživatel zůstal odhlášený, a to bez chybové hlášky. Escape-hatch
 * `ALLOW_HTTP_SESSION` navíc v produkci vyhazoval výjimku, takže se to nedalo
 * obejít. Nahrazeno derivací z reálného protokolu + explicitním `COOKIE_SECURE`
 * podle doporučení auditu.
 *
 * Priorita rozhodování:
 *   1. `COOKIE_SECURE=true|false` — vědomé rozhodnutí operátora, vyhrává
 *   2. `X-Forwarded-Proto` od reverzní proxy — reálný protokol požadavku
 *   3. `NODE_ENV` — bezpečný default (produkce = secure)
 */
export function resolveCookieSecure(input: {
  /** hodnota ENV `COOKIE_SECURE` */
  explicit: string | undefined;
  /** hlavička `X-Forwarded-Proto` (od nginx/caddy), nebo null */
  forwardedProto: string | null;
  /** hodnota `NODE_ENV` */
  nodeEnv: string | undefined;
}): boolean {
  if (input.explicit === "true") return true;
  if (input.explicit === "false") return false;

  // Proxy může poslat seznam ("https, http") — platí první (nejblíž klientovi).
  const proto = input.forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (proto) return proto === "https";

  return input.nodeEnv === "production";
}
