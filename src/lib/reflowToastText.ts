/**
 * Hlášky po přepočtu („Přepočítat" na stroji i na jednom bloku).
 *
 * Vlastní modul má jediný důvod: `PlannerPage.tsx` je přes 3000 řádků a nemá
 * testovací harness, takže věta složená přímo v handleru se otestovat nedá.
 * Vzor je `cascadeDialogText.ts` z kaskádové vlny 17. 8. 2026.
 *
 * SKLOŇOVÁNÍ SE NEŘEŠÍ. Dnešní hláška u přesunu zní „Posunuto 1 navazujících
 * bloků" (`PlannerPage.tsx`, tři místa) a tahle ji musí kopírovat doslova —
 * jinak by táž věc měla v aplikaci dvě různé podoby. Pluralizační helper se
 * pro tuhle vlnu vědomě NEZAVÁDÍ (spec §3.1).
 */

/** Odsunutí se do věty přidá jen tehdy, když k němu došlo — „odsunuto 0" nikdy. */
function shiftedClause(movedCount: number): string {
  return movedCount > 0 ? `, odsunuto ${movedCount} navazujících bloků` : "";
}

export function reflowMachineToast(i: {
  reflowedCount: number;
  skippedCount: number;
  movedCount: number;
}): string {
  const skipped = i.skippedCount > 0 ? `, přeskočeno ${i.skippedCount} (zamčené/nevejde se)` : "";
  return `Přepočteno ${i.reflowedCount} bloků${skipped}${shiftedClause(i.movedCount)}`;
}

export function reflowBlockToast(i: {
  changed: boolean;
  timesMoved: boolean;
  movedCount: number;
}): string {
  if (!i.changed) return "Blok už na kalendář sedí.";
  // Zrušení zbytkové značky bez posunu — plán se nehnul, takže ani chain push
  // neproběhl a věta o odsunutí sem nepatří ani omylem.
  if (!i.timesMoved) return 'Značka „odložené mimo pracovní dobu" zrušena — plán se nepohnul.';
  return `Blok přepočítán podle aktuálního kalendáře${shiftedClause(i.movedCount)}.`;
}
