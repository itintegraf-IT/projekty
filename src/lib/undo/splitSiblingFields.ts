import type { EditSnapshot } from "./types";

/** Cokoliv, z čeho lze vytáhnout pole podle klíče — Block i serializovaná odpověď serveru. */
export type FieldSource = Record<string, unknown>;

/**
 * Sestaví before/after cíle pro `buildMultiEditCommand` z editace primárního bloku +
 * volitelných split sourozenců.
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
  changedFields: readonly string[],
  sharedFields: readonly string[],
  before: FieldSource & { id: number; updatedAt: string },
  after: FieldSource & { id: number; updatedAt: string },
  siblingsOld: ReadonlyArray<FieldSource & { id: number; updatedAt: string }>,
  siblingsNew: ReadonlyArray<FieldSource & { id: number; updatedAt: string }>,
): { beforeTargets: EditSnapshot[]; afterTargets: EditSnapshot[] } {
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
