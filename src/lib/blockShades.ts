// ─── blockShades.ts ────────────────────────────────────────────────────────────
// Střídání odstínů u sousedících bloků stejné barvy v gridu planneru.
//
// Cíl: když v jedné dráze stroje jede víc zakázek/rezervací STEJNÉ barvy za sebou
// (a často s téměř stejným názvem), slévají se v jednu plochu. Řešení: každá další
// zakázka téže barvy dostane opačnou "paritu" → grid jí dá o stupeň světlejší odstín.
//
// Klíčová chytrost oproti naivnímu střídání "řádek po řádku": rozdělené kusy JEDNÉ
// zakázky (stejný splitGroupId) sdílí paritu, takže split nevypadá jako nová zakázka.
// Parita se překlopí až u skutečně jiné zakázky.
//
// Čistá funkce bez DB / DOM závislostí → plně testovatelná (viz blockShades.test.ts).
// Vlastní vizuální aplikace odstínu (light/dark wash) žije v TimelineGrid.tsx; tady
// se počítá jen parita 0/1 per blok.

import { getBlockStyleKey } from "./blockStyles";

export type ShadeBlockInput = {
  id: number;
  type: string;
  blockVariant?: string | null;
  splitGroupId: number | null;
  startTime: string; // ISO
  printCompletedAt?: string | null;
};

// Identita zakázky pro účely střídání: dělené kusy sdílí splitGroupId (root má
// splitGroupId === vlastní id), samostatný blok padá na vlastní id.
function orderIdentity(b: ShadeBlockInput): number {
  return b.splitGroupId ?? b.id;
}

/**
 * Spočítá paritu odstínu (0 = základní, 1 = světlejší) pro bloky JEDNÉ dráhy stroje.
 *
 * - Vstup se interně seřadí podle startTime (tie-break id), takže caller nemusí řadit.
 * - Dokončený tisk (printCompletedAt != null) má vlastní tlumený vzhled → nepočítá se
 *   a v mapě chybí (grid ho vykreslí beze změny).
 * - Čítač běží zvlášť per barevný bucket; překlopí se při změně identity zakázky.
 *
 * @returns Map<blockId, 0 | 1> — jen pro bloky, které se střídání účastní.
 */
export function computeShadeParity(blocks: ShadeBlockInput[]): Map<number, 0 | 1> {
  const sorted = [...blocks].sort((a, b) => {
    const ta = new Date(a.startTime).getTime();
    const tb = new Date(b.startTime).getTime();
    if (ta !== tb) return ta - tb;
    return a.id - b.id;
  });

  const result = new Map<number, 0 | 1>();
  // per bucket: kolik zakázek už proběhlo (count) a identita poslední z nich
  const counter = new Map<string, number>();
  const lastIdentity = new Map<string, number>();

  for (const b of sorted) {
    if (b.printCompletedAt != null) continue; // dokončený tisk se neúčastní

    // bucket = klíč stylu bloku (sdílený getBlockStyleKey z blockStyles, audit #14 —
    // dřív lokální zrcadlo). Střídá se jen v rámci jedné barvy.
    const bucket = getBlockStyleKey(b.type, b.blockVariant);
    const identity = orderIdentity(b);

    if (lastIdentity.get(bucket) !== identity) {
      counter.set(bucket, (counter.get(bucket) ?? -1) + 1);
      lastIdentity.set(bucket, identity);
    }
    result.set(b.id, ((counter.get(bucket) ?? 0) % 2) as 0 | 1);
  }

  return result;
}
