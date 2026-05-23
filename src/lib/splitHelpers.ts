import type { Block } from "@/app/_components/TimelineGrid";

/**
 * Najde sourozenecký blok ze stejné split skupiny na **jiném** stroji,
 * než je tiskařův (myMachine). Vrátí null, pokud:
 *  - blok není splitnutý
 *  - blok není na tiskařově stroji
 *  - žádný partner na druhém stroji neexistuje
 *
 * Při více kandidátech vrátí prvního podle startTime (ASC).
 */
export function findSplitPartner(
  block: Block,
  allBlocks: Block[],
  myMachine: string
): Block | null {
  if (block.splitGroupId == null) return null;
  if (block.machine !== myMachine) return null;
  const candidates = allBlocks.filter(
    (b) =>
      b.id !== block.id &&
      b.splitGroupId === block.splitGroupId &&
      b.machine !== myMachine
  );
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  return candidates[0];
}

/**
 * Odvodí stav chipu z partnerova printCompletedAt.
 * - waiting: tisk ještě nebyl potvrzen → čas = startTime (plánovaný)
 * - done:    tisk potvrzen → čas = printCompletedAt
 */
export function getSplitChipState(partner: Block): {
  state: "waiting" | "done";
  time: Date;
} {
  if (partner.printCompletedAt) {
    return { state: "done", time: new Date(partner.printCompletedAt) };
  }
  return { state: "waiting", time: new Date(partner.startTime) };
}
