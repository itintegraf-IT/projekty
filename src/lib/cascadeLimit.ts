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
 * Vypnuto = režim MĚŘENÍ: překročení prahu se jen zaloguje a transakce projde.
 * Po týdnu provozu se z logu pozná, jak často by se aplikace ptala, a teprve
 * pak se konstanta přepne SAMOSTATNÝM commitem (etapa B4). NENÍ to feature flag
 * za běhu — je to jeden commit tam a druhý zpět.
 */
export const CASCADE_CONFIRM_ENFORCED = false;

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

export function measureCascade(
  moves: ReadonlyArray<{ startTime: Date; endTime: Date; oldStartTime: Date }>,
): CascadeImpact {
  let maxShiftMs = 0;
  let farthestEnd: Date | null = null;
  for (const m of moves) {
    const shift = m.startTime.getTime() - m.oldStartTime.getTime();
    if (shift > maxShiftMs) maxShiftMs = shift;
    if (farthestEnd === null || m.endTime.getTime() > farthestEnd.getTime()) farthestEnd = m.endTime;
  }
  const movedCount = moves.length;
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
 */
export function cascadeConfirmMessage(i: CascadeImpact): string {
  const kam = i.farthestEnd ? `, nejdál do ${formatPragueDateShort(i.farthestEnd)}` : "";
  return `Tato změna odsune ${i.movedCount} navazujících bloků${kam}. Potvrdit?`;
}
