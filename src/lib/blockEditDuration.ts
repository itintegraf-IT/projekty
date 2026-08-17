/**
 * Rozhodnutí, jestli a jak editační formulář (`BlockEdit.tsx`) posílá délku bloku
 * v payloadu PUT/POST. NENÍ součástí `blockPayload.ts` — ten je jediný zdroj pravdy
 * pro `Block → POST /api/blocks` a drží tripwire `EXPECTED_PAYLOAD_KEYS`; rozhodování
 * konkrétního editačního formuláře tam nepatří.
 *
 * Vznik: incident 14. 8. 2026 (zakázka 18827). Split snížil `printMinutes` z 360 na
 * 120, o 77 sekund později uložil plánovač v už otevřeném panelu jinou změnu (popis,
 * specifikace) — a spolu s ní odešla i délka 6 h, hodnota z okamžiku otevření panelu.
 * Server ji vzal jako autoritativní a chain push odsunul 75 navazujících zakázek.
 * Kořen: `durationHours` v `BlockEdit` je `useState` inicializovaný jednou při mountu
 * a `buildPayload()` posílal délku při KAŽDÉM uložení bez ohledu na to, jestli se jí
 * uživatel dotkl. Tahle funkce dělá to rozhodnutí explicitně a testovatelně.
 */

export type DurationPayloadInput = {
  /** Typ zvolený ve formuláři v okamžiku uložení. */
  type: string;
  /**
   * True, když se typ zvolený ve formuláři liší od typu uloženého na bloku.
   * Při překlopení rezervace na zakázku (`buildFlipPayload`) server nemá z čeho
   * tiskovou délku odvodit — `oldBlock.printMinutes` je u ne-ZAKAZKY `null` — a
   * spadl by na fallback ze spanu. U změny typu se proto délka posílá vždycky,
   * i když se jí uživatel jinak nedotkl.
   */
  typeChanged: boolean;
  /** True, jakmile uživatel sáhl na select délky (viz `durationTouched` v BlockEdit). */
  touched: boolean;
  /** Délka v hodinách, jak ji drží formulářový stav. */
  durationHours: number;
  /** Start bloku (ISO string nebo Date) — základ pro dopočet `endTime` u ne-ZAKAZKY. */
  startTime: string | Date;
};

/**
 * Vrací fragment payloadu, který se rozprostře do `buildPayload()`.
 *
 * | podmínka                          | výsledek                                    |
 * | ---------------------------------- | -------------------------------------------- |
 * | `!touched && !typeChanged`         | `{}` — délka se NEPOSÍLÁ                     |
 * | jinak a `type === "ZAKAZKA"`       | `{ printMinutes: Math.round(durationHours*60) }` |
 * | jinak (REZERVACE / UDRZBA)         | `{ endTime: <ISO string startTime + durationHours> }` |
 */
export function durationPayload(
  input: DurationPayloadInput
): { printMinutes: number } | { endTime: string } | Record<string, never> {
  const { type, typeChanged, touched, durationHours, startTime } = input;

  if (!touched && !typeChanged) {
    return {};
  }

  if (type === "ZAKAZKA") {
    return { printMinutes: Math.round(durationHours * 60) };
  }

  const start = startTime instanceof Date ? startTime : new Date(startTime);
  return { endTime: new Date(start.getTime() + durationHours * 3600000).toISOString() };
}
