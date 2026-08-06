import type { BlockSnapshot } from "./types";

/**
 * Pár pozičních snapshotů odsunutých sousedů (chain push) — stejný tvar, jaký vrací
 * `snapshotShiftedFromResponse` v `PlannerPage.tsx`. `before`/`after` jsou vždy
 * indexově zarovnané páry se STEJNOU množinou id (`before[i].id === after[i].id`)
 * — obě funkce v tomhle souboru ten invariant zachovávají, `buildMultiEditCommand`
 * (`src/lib/undo/commands.ts`) na něm staví párování `posOp`/`expectedUpdatedAt`.
 */
export type ShiftedSnapshots = { before: BlockSnapshot[]; after: BlockSnapshot[] };

/**
 * Přičte odsunuté sousedy z JEDNOHO PUTu (`next`) do akumulátoru běžícího přes VÍC
 * PUTů jedné dávky (hromadné uložení série/split skupiny — `handleSaveAll` v
 * `PlannerPage.tsx`). Stejný vzor, jaký uvnitř `putFlip` (`handleFlipReservation`,
 * tamtéž) dělá inline pro `flipShiftBefore`/`flipShiftAfter` — vytažený sem jako
 * čistá funkce, aby šel testovat samostatně (PlannerPage.tsx testy mít nemůže,
 * repo nemá nástroje na testování React komponent).
 *
 * Týž soused může být odsunut víc PUTy jedné dávky — typicky druhá editovaná
 * zakázka série odsune chain pushem tu samou první, kterou už odsunul PUT
 * předchozí zakázky. Pravidlo: PRVNÍ „před" je předdávková pozice (nikdo v dávce
 * se souseda ještě nedotkl), POSLEDNÍ „po" je jeho konečná pozice po celé dávce.
 * Cokoli mezi tím je mezistav, který undo/redo nikdy neuvidí — server ho přepsal
 * dalším PUTem dřív, než dávka doběhla.
 *
 * Čistá — nemutuje `acc` ani `next`, vrací nový pár polí.
 */
export function accumulateShifted(acc: ShiftedSnapshots, next: ShiftedSnapshots): ShiftedSnapshots {
  const before = [...acc.before];
  const after = [...acc.after];
  next.before.forEach((b, i) => {
    const known = before.findIndex((x) => x.id === b.id);
    if (known === -1) {
      before.push(b);
      after.push(next.after[i]);
    } else {
      after[known] = next.after[i];
    }
  });
  return { before, after };
}

/**
 * Vyřadí z odsunutých sousedů id, která jsou ZÁROVEŇ mezi cíli TÉŽE dávky
 * (`targetIds`) — v `handleSaveAll` typicky id z `saveBefore` (bloky s vlastním
 * PUTem a vlastním záznamem v undo kroku, včetně split sourozenců přidaných přes
 * `buildSplitEditTargets`).
 *
 * Nutné kvůli `sanitizeUndoOps` (`src/lib/undoApply.server.ts`): server odmítne
 * (400 „Blok X je v dávce vícekrát") krok historie, kde je stejné id ve DVOU
 * cílech. Reálný scénář z plánu: plánovač uloží celou sérii, dvě její instance
 * stojí na stejném stroji za sebou — PUT první odsune chain pushem druhou, ale
 * druhá je TAKÉ členem ukládané série a dostane vlastní PUT o pár iterací dál
 * (je v `saveBefore`/`saveAfter`). Bez filtru by šla do dávky DVAKRÁT — jednou
 * jako vlastní cíl, podruhé jako odsunutý soused — a celý krok undo (ne jen
 * odsunutí sousedé) by kvůli 400 selhal.
 *
 * Blok, který v dávce žádný vlastní cíl nemá (skutečně „jen" odsunutý soused),
 * filtrem projde beze změny. Čistá — nemutuje `shifted`.
 */
export function excludeShiftedTargeted(
  shifted: ShiftedSnapshots,
  targetIds: ReadonlySet<number>,
): ShiftedSnapshots {
  return {
    before: shifted.before.filter((s) => !targetIds.has(s.id)),
    after: shifted.after.filter((s) => !targetIds.has(s.id)),
  };
}
