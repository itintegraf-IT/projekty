export type CascadePayload = {
  movedCount: number;
  maxShiftMs: number;
  farthestEnd: string | null;
};

export type CascadeAsk = (p: CascadePayload) => Promise<boolean>;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Uživatel kaskádu ZAMÍTL — na odpovědi visí tenhle příznak, aby ji volající
 * nezpracoval jako chybu. Zamítnutí není selhání: nic se nestalo, protože to tak
 * uživatel chtěl. Červený toast s otázkou, na kterou právě odpověděl „Zrušit",
 * je matoucí a vypadá jako pád.
 */
export const CASCADE_DECLINED = Symbol.for("ig.cascadeDeclined");
export function isCascadeDeclined(res: Response): boolean {
  return (res as Response & { [CASCADE_DECLINED]?: boolean })[CASCADE_DECLINED] === true;
}

/**
 * Odešle mutaci a při 409 `CASCADE_CONFIRM` se zeptá uživatele; po potvrzení
 * požadavek ZOPAKUJE s `cascadeConfirmed: true`.
 *
 * Pokus je nejvýš JEDEN opakovaný — kdyby server 409 vrátil znovu (jiný práh,
 * souběžná změna), vrátí se ta odpověď volajícímu a dialog se už neotevře.
 * Nekonečné odklepávání by bylo horší než chyba.
 *
 * Při odmítnutí se vrací PŮVODNÍ odpověď 409, ale OZNAČENÁ příznakem
 * `CASCADE_DECLINED` (`isCascadeDeclined`) — volající si ji nemá zpracovat jako
 * chybu (viz komentář u příznaku výš), jen mlčky skončit.
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
  if (!confirmed) {
    (res as Response & { [CASCADE_DECLINED]?: boolean })[CASCADE_DECLINED] = true;
    return res;
  }

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
