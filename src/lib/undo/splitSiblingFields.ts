import type { BlockSnapshot, EditSnapshot } from "./types";

/** Cokoliv, z čeho lze vytáhnout pole podle klíče — Block i serializovaná odpověď serveru. */
export type FieldSource = Record<string, unknown>;

export type BuildSplitEditTargetsArgs = {
  changedFields: readonly string[];
  sharedFields: readonly string[];
  before: FieldSource & { id: number; updatedAt: string };
  after: FieldSource & { id: number; updatedAt: string };
  siblingsOld: ReadonlyArray<FieldSource & { id: number; updatedAt: string }>;
  siblingsNew: ReadonlyArray<FieldSource & { id: number; updatedAt: string }>;
};

/**
 * Sestaví before/after cíle pro `buildMultiEditCommand` z editace primárního bloku +
 * volitelných split sourozenců.
 *
 * OBJEKTOVÝ PARAMETR (D5, go/no-go audit 5. 8. 2026): funkce má dva páry stejně typovaných
 * argumentů (`before`/`after`, `siblingsOld`/`siblingsNew`). U pozičních parametrů projde
 * záměna páru typovou kontrolou beze stopy a TICHOU OBRÁCÍ SMĚR UNDO (undo by zapsalo "after"
 * jako "before" a naopak). Riziko se zvýšilo, jakmile přibyl druhý call site (`handleSaveAll`,
 * C1a) — objektový parametr dělá záměnu nemožnou (klíče se musí trefit jménem).
 *
 * Sourozenci dostávají VÝHRADNĚ průnik `changedFields` ∩ `sharedFields` — pole, která
 * server při propagaci do split skupiny (SPLIT_SHARED_FIELDS, `api/blocks/[id]/route.ts`)
 * doopravdy mění. `changedFields` bývá širší (EDIT_TRACKED_FIELDS pokrývá i pole jako
 * `locked`/`materialNote`/`materialIssued`/`obalka`/`vnitrky`/`tiskoveArchy`/`serie`,
 * která server na sourozence nikdy nepropaguje). Zapsat sourozencům celý `changedFields`
 * by je zbytečně bumplo VLASTNÍ nezměněnou hodnotou pole — a pokud by mezi editací
 * a Ctrl+Z kdokoli sáhl na kteréhokoli sourozence, klientský guard by shodil CELÉ
 * undo na StaleUndoError, i když se ta cizí změna editovaného pole vůbec netýkala
 * (review Tasku 7, nález I1).
 *
 * Sourozenci se do výsledku zařadí JEN když je průnik neprázdný — jinak by šlo
 * o zápis bez jediného skutečně měněného pole.
 *
 * `siblingsOld`/`siblingsNew` NEMUSÍ nést stejnou množinu id — funkce si sama
 * spočítá průnik (review Tasku 7, nález M3: sourozenec bez páru na druhé straně
 * by rozjel `beforeTargets`/`afterTargets` na různou délku a shodil i tu polovinu
 * kroku, která byla v pořádku — cíl bez páru dostane `expectedUpdatedAt: undefined`
 * → `StaleUndoError`). Symetrizace žije TADY, ne u volajícího — jinak by ji musel
 * hlídat každý budoucí call site zvlášť a stačilo by ji jednou zapomenout.
 */
export function buildSplitEditTargets(
  args: BuildSplitEditTargetsArgs,
): { beforeTargets: EditSnapshot[]; afterTargets: EditSnapshot[] } {
  const { changedFields, sharedFields, before, after, siblingsOld, siblingsNew } = args;
  const pick = (fields: readonly string[]) => (src: FieldSource): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const f of fields) out[f] = src[f];
    return out;
  };
  const pickAll = pick(changedFields);
  const sharedSet = new Set<string>(sharedFields);
  const sharedChanged = changedFields.filter((f) => sharedSet.has(f));
  const pickShared = pick(sharedChanged);

  const beforeTargets: EditSnapshot[] = [
    { id: before.id, updatedAt: before.updatedAt, fields: pickAll(before) },
  ];
  const afterTargets: EditSnapshot[] = [
    { id: after.id, updatedAt: after.updatedAt, fields: pickAll(after) },
  ];
  if (sharedChanged.length > 0) {
    const oldById = new Map(siblingsOld.map((o) => [o.id, o]));
    const newById = new Map(siblingsNew.map((s) => [s.id, s]));
    const commonIds = [...oldById.keys()].filter((id) => newById.has(id));
    for (const id of commonIds) {
      beforeTargets.push({ id, updatedAt: oldById.get(id)!.updatedAt, fields: pickShared(oldById.get(id)!) });
      afterTargets.push({ id, updatedAt: newById.get(id)!.updatedAt, fields: pickShared(newById.get(id)!) });
    }
  }
  return { beforeTargets, afterTargets };
}

export type BuildSplitEditTargetsWithShiftedArgs = BuildSplitEditTargetsArgs & {
  /**
   * Split sourozenci, které PUT route vyloučila ze `siblings`, protože je ve
   * stejné odpovědi odsunul chain push (`[id]/route.ts`: „Vyloučit sourozence,
   * kteří už jsou v shifted"). Server je pošle JEN ve `shifted` — s hodnotami PO
   * propagaci sdílených polí (refetch běží až po ní, v jedné transakci) — takže
   * jsou to plnohodnotné pozice + business data, ne jen souřadnice.
   *
   * MUSÍ být předem vyfiltrované volajícím na skutečné členy primárovy split
   * skupiny (shoda `splitGroupId`) — tahle funkce to vědomě neřeší sama, protože
   * `FieldSource` nenese typovaně `splitGroupId` a filtrování cizích odsunutých
   * sousedů by bylo mimo její čistou, generickou odpovědnost.
   */
  shiftedSplitSiblingsOld: ReadonlyArray<BlockSnapshot>;
  shiftedSplitSiblingsNew: ReadonlyArray<BlockSnapshot>;
};

export type BuildSplitEditTargetsWithShiftedResult = {
  beforeTargets: EditSnapshot[];
  afterTargets: EditSnapshot[];
  /**
   * Ids z `shiftedSplitSiblingsOld/New`, které tahle funkce POHLTILA do
   * `beforeTargets`/`afterTargets` (měly aspoň jedno reálně změněné sdílené pole).
   * Volající je MUSÍ vyřadit ze svého vlastního seznamu odsunutých sousedů
   * (`shiftedBefore`/`shiftedAfter` předávaného zvlášť do `buildMultiEditCommand`)
   * — jinak by stejné id bloku bylo ve DVOU cílech JEDNÉ dávky (sdílená pole
   * i pozice zvlášť) a `sanitizeUndoOps` by celý krok undo odmítl (400,
   * „je v dávce vícekrát"). Pozice se proto slučuje PŘÍMO do sdíleného cíle.
   */
  absorbedShiftedIds: ReadonlySet<number>;
};

/**
 * Jako `buildSplitEditTargets`, ale navíc pohltí split sourozence odsunuté chain
 * pushem, které server vyloučil ze `siblings` (C1c, go/no-go audit 5. 8. 2026).
 *
 * Bez tohohle by `buildSplitEditTargets` takového souseda vůbec neviděl (chybí
 * v `siblingsOld`/`siblingsNew`) a nedostal by SPLIT_SHARED_FIELDS — undo by
 * vrátilo primár, ale odsunutý soused by zůstal s hodnotami po propagaci.
 * Typický spouštěč: editace typu na split hlavě → re-expanze → ocas odsunut →
 * ocas mimo `siblings` → Ctrl+Z vrátí hlavě typ, ocas zůstane překlopený.
 */
export function buildSplitEditTargetsWithShifted(
  args: BuildSplitEditTargetsWithShiftedArgs,
): BuildSplitEditTargetsWithShiftedResult {
  const { shiftedSplitSiblingsOld, shiftedSplitSiblingsNew, ...rest } = args;
  const shiftedIds = new Set([...shiftedSplitSiblingsOld, ...shiftedSplitSiblingsNew].map((s) => s.id));

  const { beforeTargets: rawBefore, afterTargets: rawAfter } = buildSplitEditTargets({
    ...rest,
    siblingsOld: shiftedIds.size > 0 ? [...rest.siblingsOld, ...shiftedSplitSiblingsOld] : rest.siblingsOld,
    siblingsNew: shiftedIds.size > 0 ? [...rest.siblingsNew, ...shiftedSplitSiblingsNew] : rest.siblingsNew,
  });

  // POJISTKA (kontrola po etapě 5. 8. 2026 — C-1 test procházel ze špatného
  // důvodu): `shiftedIds.has(t.id)` samo o sobě neznamená, že `pickShared` výš
  // doopravdy něco našla — když volající pošle ochuzený snapshot (typicky
  // BlockSnapshot bez business polí, jaký dřív posílal `toSnap` v
  // PlannerPage.tsx), `fields` vyjde jen s `undefined` hodnotami, které
  // JSON.stringify na cestě k serveru tiše vynechá (prázdný/poloprázdný patch).
  // Takového "ducha" nesmíme nechat ve sdílených cílech — byl by tam BEZE
  // SMYSLU a zároveň by kvůli přítomnosti v `absorbedShiftedIds` zmizel i z
  // pozičního seznamu volajícího, takže by sourozenec ztratil obě věci najednou.
  // Degradace: soused BEZ jediného reálně přítomného sdíleného pole (na obou
  // stranách, before i after) se do sdílených cílů vůbec nezařadí a zůstává
  // výhradně v pozičním seznamu volajícího (shiftedBefore/After).
  const hasRealField = (t: EditSnapshot) => Object.values(t.fields).some((v) => v !== undefined);
  const afterById = new Map(rawAfter.map((t) => [t.id, t]));
  const ghostIds = new Set(
    rawBefore
      .filter((t) => shiftedIds.has(t.id) && !(hasRealField(t) && hasRealField(afterById.get(t.id)!)))
      .map((t) => t.id),
  );
  const beforeTargets = ghostIds.size === 0 ? rawBefore : rawBefore.filter((t) => !ghostIds.has(t.id));
  const afterTargets = ghostIds.size === 0 ? rawAfter : rawAfter.filter((t) => !ghostIds.has(t.id));

  // Jen ids, které tu OPRAVDU zůstaly (měly aspoň jedno reálně změněné sdílené
  // pole) — jinak bychom je zbytečně vyřadili z pozičního seznamu volajícího a
  // jejich návrat na správné místo by z dávky úplně vypadl.
  const absorbedShiftedIds = new Set(
    beforeTargets.filter((t) => shiftedIds.has(t.id)).map((t) => t.id),
  );
  if (absorbedShiftedIds.size === 0) {
    return { beforeTargets, afterTargets, absorbedShiftedIds };
  }

  const oldById = new Map(shiftedSplitSiblingsOld.map((s) => [s.id, s]));
  const newById = new Map(shiftedSplitSiblingsNew.map((s) => [s.id, s]));
  return {
    beforeTargets: mergePositionIntoTargets(beforeTargets, oldById),
    afterTargets: mergePositionIntoTargets(afterTargets, newById),
    absorbedShiftedIds,
  };
}

/**
 * Slije poziční pole (startTime/endTime/machine/printMinutes/scheduleBypassed)
 * z `byId` PŘÍMO do `fields` cílů se shodným id. Cíl bez odpovídajícího záznamu
 * v `byId` se vrátí beze změny.
 *
 * Sdílený vzor pro kohokoliv, kdo dostane EditSnapshot cíl (jen business pole,
 * typicky SPLIT_SHARED_FIELDS) A ZÁROVEŇ ho odsunul chain push (jen poziční
 * BlockSnapshot) — bez sloučení by šlo napsat jen jednu z těch dvou částí,
 * protože stejné id nesmí být ve DVOU cílech jedné dávky (`sanitizeUndoOps` by
 * krok odmítl, 400). Používá jak `buildSplitEditTargetsWithShifted` výš (C-1),
 * tak `PlannerPage.tsx` (`handleFlipReservation` → `recordFlipUndo`, I-1,
 * kontrola po etapě 5. 8. 2026): pasivní sourozenec, kterého flip zároveň
 * odsunul chain pushem, by jinak ztratil pozici, protože `buildPassiveSiblingTargets`
 * nese jen sdílená pole.
 */
export function mergePositionIntoTargets(
  targets: readonly EditSnapshot[],
  byId: ReadonlyMap<number, BlockSnapshot>,
): EditSnapshot[] {
  return targets.map((t) => {
    const pos = byId.get(t.id);
    if (!pos) return t;
    return {
      ...t,
      fields: {
        ...t.fields,
        startTime: pos.startTime, endTime: pos.endTime, machine: pos.machine,
        printMinutes: pos.printMinutes, scheduleBypassed: pos.scheduleBypassed,
      },
    };
  });
}

/**
 * Diff `sharedFields` pro páry (starý stav, aktuální stav) STEJNÉHO bloku, kde
 * volající nemá žádný "primární" blok — jen bloky, o které si NEŘEKL, ale server
 * je stejně propagoval (C1b, go/no-go audit 5. 8. 2026: `handleFlipReservation`
 * při volbě „jen tento blok" — server propaguje SPLIT_SHARED_FIELDS na CELOU
 * split skupinu bez ohledu na to, co si klient vyžádal přes `siblingIds`).
 *
 * Pár BEZ jediného reálně změněného sdíleného pole se do výsledku vůbec nezařadí
 * — stejná zásada jako u `buildSplitEditTargets` (zápis beze změny by byl jen šum
 * a zbytečně by riskoval StaleUndoError, kdyby mezitím kdokoli sáhl na pole mimo
 * `sharedFields`).
 */
export function buildPassiveSiblingTargets(
  sharedFields: readonly string[],
  pairs: ReadonlyArray<{
    old: FieldSource & { id: number; updatedAt: string };
    live: FieldSource & { id: number; updatedAt: string };
  }>,
): { beforeTargets: EditSnapshot[]; afterTargets: EditSnapshot[] } {
  const beforeTargets: EditSnapshot[] = [];
  const afterTargets: EditSnapshot[] = [];
  for (const { old, live } of pairs) {
    const changed = sharedFields.filter((f) => JSON.stringify(old[f]) !== JSON.stringify(live[f]));
    if (changed.length === 0) continue;
    const pick = (src: FieldSource): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const f of changed) out[f] = src[f];
      return out;
    };
    beforeTargets.push({ id: old.id, updatedAt: old.updatedAt, fields: pick(old) });
    afterTargets.push({ id: live.id, updatedAt: live.updatedAt, fields: pick(live) });
  }
  return { beforeTargets, afterTargets };
}
