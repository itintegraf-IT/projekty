/**
 * Vypínač autoposunu (Task 6D, etapa 6) — tvrdá pojistka vedle měkkého kaskádového
 * dialogu. Plánovač si autoposun vypne per uživatel (preference `autoshift`,
 * `PlannerPage.tsx`); klient pak posílá `resolveChain: false` na všech šesti
 * serverových cestách, které sahají na `resolveChainPushFromDb` (přímo nebo přes
 * `reflowBlockInTx`). Chain push se v tom případě vůbec nespustí a kolize s
 * navazujícím blokem skončí běžným `OVERLAP` — tenhle modul jen vysvětlí PROČ.
 *
 * Jediný zdroj pravdy pro hlášku a pro rozpoznání „request výslovně vypnul
 * autoposun" — nepatří sem detekce toho, jestli je pro danou cestu default
 * zapnuto/vypnuto (to řeší každá route sama, `=== true` vs. `!== false`, viz
 * `autoShiftWiring.test.ts`).
 */

export const AUTOSHIFT_OFF_OVERLAP_MESSAGE =
  "Posun koliduje s navazující zakázkou — autoposun je vypnutý, uvolni místo ručně.";

/**
 * Request výslovně vypnul autoposun (`resolveChain: false`), ne jen neposlal příznak.
 * Chybějící příznak NENÍ vypnutí — u splitu a obou reflow cest to dnes znamená
 * zapnuto (zpětná snášenlivost se starým klientem).
 */
export function autoShiftExplicitlyOff(body: unknown): boolean {
  if (body === null || typeof body !== "object") return false;
  return (body as Record<string, unknown>).resolveChain === false;
}

/**
 * Hláška pro OVERLAP: při vypnutém autoposunu vysvětlí PROČ se to neposunulo samo
 * (jinak by uživatel viděl stejnou obecnou kolizní hlášku jako při běžném přeplnění
 * a nepochopil by, že za tím stojí jeho vlastní vypínač). Věta z `AUTOSHIFT_OFF_OVERLAP_MESSAGE`
 * zůstává DOSLOVA (rozhodnutí review) a původní hláška se připojí v závorce — jinak by
 * zmizel nejužitečnější detail (číslo kolidujícího bloku a stroj), bez kterého plánovač
 * neví, kde ručně uvolnit místo.
 */
export function overlapMessageFor(originalMessage: string, autoShiftOff: boolean): string {
  return autoShiftOff ? `${AUTOSHIFT_OFF_OVERLAP_MESSAGE} (${originalMessage})` : originalMessage;
}
