import { MAX_RIGID_PUSH_MS } from "@/lib/overlapResolver";
import { formatPragueDateShort } from "@/lib/dateUtils";

/**
 * Práh, nad kterým se aplikace na kaskádu autoposunu zeptá.
 *
 * Vzniklo po havárii 17. 8. 2026 16:31: posun konce bloku o délku noční pauzy
 * odsunul 88 navazujících zakázek, některé o týdny — a nic tomu nebránilo,
 * protože ZAKAZKA horizont posunu nemá (`overlapResolver.ts`, komentář
 * „Zakázka horizont nemá"). Rigidní blok má strop `MAX_RIGID_PUSH_MS` = 7 dní.
 */
export const CASCADE_CONFIRM_MAX_BLOCKS = 5;

/**
 * Zapnuto = práh se VYNUCUJE: překročení odroluje celou transakci a vrátí 409
 * `CASCADE_CONFIRM` (`assertCascadeConfirmed`, `cascadeLimit.server.ts`).
 * Uživatel dopad potvrdí v dialogu a požadavek se zopakuje s
 * `cascadeConfirmed: true`, které kontrolu na daném volání přeskočí.
 *
 * Vynuceno od 21. 8. 2026 (rozhodnutí Vojty) — týden měření (etapy A+C+6,
 * 18.–20. 8.) potvrdil, že podmínky z Tasku B4 Step 1b jsou splněné: dialog se
 * ptá jednou za gesto, fokus sedí na „Zrušit", zamítnutí není chyba a strážný
 * test hlídá párování. Navíc existuje vypínač autoposunu (`autoshift`
 * preference) jako tvrdá pojistka vedle tohohle měkkého dialogu.
 *
 * Práh 5 je podložený měřením z logu testovací instance: běžné přetažení
 * plánovače posouvá 3–4 navazující bloky. Práh 5 tedy sedí těsně nad běžnou
 * prací — dialog se ozve až u nezvyklé kaskády, ne u každého druhého tahu.
 * (Lukášův návrh 3–4 by se ptal skoro pořád a dialog by přestal cokoli
 * znamenat.)
 *
 * NENÍ to feature flag za běhu — je to jeden commit tam (zapnutí, 21. 8. 2026)
 * a druhý zpět (`git revert`), pokud se ukáže, že práh nesedí.
 */
export const CASCADE_CONFIRM_ENFORCED = true;

export type CascadeImpact = {
  /** Kolik bloků by se posunulo. */
  movedCount: number;
  /**
   * NEJVĚTŠÍ posun JEDNOHO bloku, ne rozpětí celé dávky. Dlouhá, ale drobná
   * kaskáda (deset bloků po půlhodině napříč měsícem) by jinak vyšla stejně
   * jako jediný blok odsunutý o měsíc — a to je právě ten nebezpečný případ.
   */
  maxShiftMs: number;
  /** Nejzazší NOVÝ konec v dávce — do věty „nejdál do 21. 08.". */
  farthestEnd: Date | null;
  exceeded: boolean;
};

/**
 * Dedup podle `id` je NUTNÝ, ne kosmetický — souhrny přes víc voláni
 * `resolveChainPushFromDb` (batch s deseti kotvami, hromadný reflow stroje)
 * vidí TÝŽ blok víckrát: kotva A posune blok X, kotva B (nebo pozdější
 * reflow jiného bloku) ho potká znovu a odsune dál. Bez dedupu by `movedCount`
 * počítal X dvakrát a `maxShiftMs` by se měřil po skocích proti mezipoloze
 * (3 dny + 4 dny zvlášť), nikdy jako kumulativních 7 dní — právě ten
 * nejnebezpečnější případ by tak mohl proklouznout pod `MAX_RIGID_PUSH_MS`.
 * Uvnitř JEDNOHO volání `resolveChainPushFromDb` je `id` vždycky unikátní,
 * takže je dedup tam no-op; existuje kvůli součtům u volajících.
 *
 * „První výskyt vyhrává, poslední určuje cílovou pozici" platí JEN když volající
 * sbírá posuny SEKVENČNĚ — obě dnešní souhrnná volání (smyčka kotev v
 * `batch/route.ts`, smyčka driftnutých bloků v `reflowMachineInTx`) jsou
 * `for … await`, takže `moves` přibývají v pořadí, v jakém se volání skutečně
 * provedla. Kdyby je někdo zparalelizoval na `Promise.all`, pořadí v poli by
 * odpovídalo tomu, které volání doběhlo dřív, ne tomu, které bylo dřív
 * ZAVOLÁNO — „první výskyt" by tak vybral náhodnou mezipolohu místo skutečné
 * výchozí pozice a `maxShiftMs` by se měřil proti ní; práh by tiše pod-hlásil.
 */
export function measureCascade(
  moves: ReadonlyArray<{ id: number; startTime: Date; endTime: Date; oldStartTime: Date }>,
): CascadeImpact {
  // Sloučit podle id: oldStartTime z PRVNÍHO výskytu (výchozí pozice před celým
  // během), startTime/endTime z POSLEDNÍHO (finální pozice po celém běhu) —
  // stejný vzor „první výskyt vyhrává" jako `mergeBefore` (reflowBefore.server.ts).
  const byId = new Map<number, { startTime: Date; endTime: Date; oldStartTime: Date }>();
  for (const m of moves) {
    const existing = byId.get(m.id);
    byId.set(m.id, {
      oldStartTime: existing ? existing.oldStartTime : m.oldStartTime,
      startTime: m.startTime,
      endTime: m.endTime,
    });
  }

  let maxShiftMs = 0;
  let farthestEnd: Date | null = null;
  for (const m of byId.values()) {
    const shift = m.startTime.getTime() - m.oldStartTime.getTime();
    if (shift > maxShiftMs) maxShiftMs = shift;
    if (farthestEnd === null || m.endTime.getTime() > farthestEnd.getTime()) farthestEnd = m.endTime;
  }
  const movedCount = byId.size;
  return {
    movedCount,
    maxShiftMs,
    farthestEnd,
    exceeded: movedCount > CASCADE_CONFIRM_MAX_BLOCKS || maxShiftMs > MAX_RIGID_PUSH_MS,
  };
}

/**
 * Věta do potvrzovacího dialogu. Skloňování se neřeší — parita s dnešní hláškou
 * „Posunuto N navazujících bloků" (`PlannerPage.tsx`).
 *
 * Pozn. na formatPragueDateShort: vrací datum s koncovou tečkou (např. „03. 09."),
 * věta si vlastní tečku doplňuje sama — proto se koncová tečka odebírá, aby
 * nevznikly dvě za sebou. Odebrání je PODMÍNĚNÉ (replace), ne slepé (slice),
 * aby se při změně výstupu Intl.DateTimeFormat neuřízla číslice.
 */
export function cascadeConfirmMessage(i: CascadeImpact): string {
  const kam = i.farthestEnd
    ? `, nejdál do ${formatPragueDateShort(i.farthestEnd).replace(/\.$/, "")}`
    : "";
  return `Tato změna odsune ${i.movedCount} navazujících bloků${kam}. Potvrdit?`;
}
