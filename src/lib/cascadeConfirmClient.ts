export type CascadePayload = {
  movedCount: number;
  maxShiftMs: number;
  farthestEnd: string | null;
};

export type CascadeAsk = (p: CascadePayload) => Promise<boolean>;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Odešle mutaci a při 409 `CASCADE_CONFIRM` se zeptá uživatele; po potvrzení
 * požadavek ZOPAKUJE s `cascadeConfirmed: true`.
 *
 * Pokus je nejvýš JEDEN opakovaný — kdyby server 409 vrátil znovu (jiný práh,
 * souběžná změna), vrátí se ta odpověď volajícímu a dialog se už neotevře.
 * Nekonečné odklepávání by bylo horší než chyba.
 *
 * Při odmítnutí se vrací PŮVODNÍ odpověď 409, aby si volající pustil svou
 * dosavadní chybovou větev (dnes: toast a žádná změna stavu — obě dragové
 * cesty v `TimelineGrid.tsx` při `!res.ok` do stavu nezapisují).
 *
 * `fetchImpl` existuje jen kvůli testům; v aplikaci se nepředává.
 */
export async function fetchWithCascadeConfirm(
  url: string,
  method: "POST" | "PUT",
  body: Record<string, unknown>,
  ask: CascadeAsk,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  const send = (b: Record<string, unknown>) =>
    fetchImpl(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    });

  const res = await send(body);
  if (res.status !== 409) return res;

  const data = (await res.clone().json().catch(() => ({}))) as {
    code?: string;
    cascade?: CascadePayload;
  };
  if (data.code !== "CASCADE_CONFIRM" || !data.cascade) return res;

  const confirmed = await ask(data.cascade);
  if (!confirmed) return res;

  return send({ ...body, cascadeConfirmed: true });
}

/**
 * Obalí dotaz tak, aby se za JEDNO uživatelské gesto zeptal nejvýš JEDNOU.
 *
 * Gesto, které vyrobí N requestů (překlopení rezervace přes sourozence, hromadné
 * uložení, série výskytů, vložení skupiny), by se jinak zeptalo až N×. Plánovač by
 * odklikával tentýž dialog dokola a přestal by ho číst — přesně to riziko, kvůli
 * kterému spec §7 chtěl týden měření před vynucením.
 *
 * Vrací NOVOU funkci se soukromou pamětí; každé gesto si musí vyrobit vlastní.
 */
export function askOncePerGesture(ask: CascadeAsk): CascadeAsk {
  let confirmed = false;
  return async (p) => {
    if (confirmed) return true;
    const ok = await ask(p);
    if (ok) confirmed = true;
    return ok;
  };
}
