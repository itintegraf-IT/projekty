import { typeUsesTiskoveHodiny } from "@/lib/printTime";

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
 * | jinak a typ tiskový (ZAKAZKA / REZERVACE) | `{ printMinutes: Math.round(durationHours*60) }` |
 * | jinak (UDRZBA)                     | `{ endTime: <ISO string startTime + durationHours> }` |
 */
export function durationPayload(
  input: DurationPayloadInput
): { printMinutes: number } | { endTime: string } | Record<string, never> {
  const { type, typeChanged, touched, durationHours, startTime } = input;

  if (!touched && !typeChanged) {
    return {};
  }

  // Etapa 9: REZERVACE je tiskový typ — délka jde jako printMinutes, end počítá
  // server expanzí. Formulář nový typ VŽDY doprovodí délkou (touched/typeChanged),
  // takže i legacy rezervace dostane pm, jakmile na délku někdo sáhne — to je
  // zamýšlená cesta „ručně opravit" ze spec §3 (server nezarovnaný start odmítne
  // s čitelnou 422, ne s tichým přepisem).
  if (typeUsesTiskoveHodiny(type)) {
    return { printMinutes: Math.round(durationHours * 60) };
  }

  const start = startTime instanceof Date ? startTime : new Date(startTime);
  return { endTime: new Date(start.getTime() + durationHours * 3600000).toISOString() };
}

export type DurationSyncAction =
  | { kind: "none" }
  | { kind: "sync"; durationHours: number }
  | { kind: "warn"; durationHours: number };

/**
 * Rozhodovací jádro efektu 2b/2c v `BlockEdit.tsx`. Srovnává PŘEDCHOZÍ a AKTUÁLNÍ
 * délku bloku, jak ji zná server (opravné kolo 1 — recenze etapy 2, 17. 8. 2026).
 *
 * KRITICKÉ pro volajícího: obě hodnoty musí být odvozené z `block.type`/`block`,
 * NIKDY z lokálního stavu formuláře `type`. `BlockEdit` počítá i jinou veličinu,
 * `currentDurationHours`, která z lokálního `type` vychází záměrně (řídí, jak se
 * má DISPLAYOVANÁ délka přepočítat, když uživatel přepne typ ručně) — tahle funkce
 * se ale musí krmit hodnotou NEZÁVISLOU na tom přepnutí (typicky
 * `blockPrintMinutes(block) / 60`, kde `blockPrintMinutes` čte `block.type` samo).
 * Prohození těch dvou zdrojů byl přesně nález opravného kola: kliknutí na
 * „Typ záznamu" (ZAKAZKA↔UDRZBA↔REZERVACE, mimo flip REZERVACE→ZAKAZKA) přepočítá
 * `currentDurationHours` i beze změny na serveru — u pozastavené zakázky span
 * (26 h) vs printMinutes (10 h) je reálně velký skok — a vypadalo to jako cizí
 * zásah, i když žádný neproběhl.
 *
 * - Beze změny → `none`.
 * - Změna + nedotčeno (`touched === false`) → tiše přesynchronizovat (`sync`).
 * - Změna + dotčeno (`touched === true`) → nepřepisovat, jen upozornit (`warn`).
 */
export function resolveDurationSync(
  prevServerDurationHours: number,
  nextServerDurationHours: number,
  touched: boolean
): DurationSyncAction {
  if (nextServerDurationHours === prevServerDurationHours) return { kind: "none" };
  return touched
    ? { kind: "warn", durationHours: nextServerDurationHours }
    : { kind: "sync", durationHours: nextServerDurationHours };
}
