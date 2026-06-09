/**
 * Pole, která se NESMÍ propagovat z editované instance do ostatních sourozenců
 * při uložení rekurenční série přes "Celou sérii". Každé pole je per-occurrence:
 * uživatel ho nastavuje individuálně pro každou instanci v sérii.
 *
 * Datumové fieldy:                přepsání zničí historicky správné termíny.
 * Ready flagy (dataOk/materialOk/pantoneOk): "hotovo pro tuto instanci".
 * materialIssued/materialInStock: per-tisk stavy materiálu, navíc serverový
 *                                 side-effect by vynuloval *RequiredDate pole.
 * pantoneRequired:                serverový side-effect při false vynuluje
 *                                 pantoneRequiredDate i pantoneOk.
 *
 * Per-instance termíny se editují v sekci "Termíny série" v BlockEdit modalu
 * a ukládají se přes tlačítko "Uložit termíny série".
 */
export const SERIES_EXCLUDED_FIELDS = [
  "dataRequiredDate",
  "deadlineExpedice",
  "materialRequiredDate",
  "pantoneRequiredDate",
  "dataOk",
  "materialOk",
  "pantoneOk",
  "materialIssued",
  "materialInStock",
  "pantoneRequired",
  "obalka",
  "vnitrky",
  "tiskoveArchy",
  "serie",
] as const;

type ExcludedField = typeof SERIES_EXCLUDED_FIELDS[number];

export function stripSeriesPropagatedFields<T extends Record<string, unknown>>(
  payload: T
): Omit<T, ExcludedField> {
  const result = { ...payload };
  for (const field of SERIES_EXCLUDED_FIELDS) {
    delete result[field];
  }
  return result;
}
