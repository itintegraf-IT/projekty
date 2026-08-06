// ─── reservationSiblings ───────────────────────────────────────────────────────
// Bloky patřící k téže rezervaci. Plánovač běžně rozpustí jednu rezervaci do
// více bloků (OBÁLKA na XL 105, VNITŘKY na XL 106) a chce je překlopit na
// zakázku jedním krokem (připomínka plánovače, 8/2026).
//
// Proč se nedá klíčovat jen na reservationId:
//   - `Ctrl+C/V` kopie reservationId záměrně neposílá (blockPayload.ts),
//   - split tail ho také nekopíruje (api/blocks/[id]/split/route.ts),
//   - druhý drop téže rezervace z fronty server odmítne (409),
// takže druhý blok rezervace má reservationId = null a jediné pojítko je
// `orderNumber`, do kterého server při dropu vynutil kód rezervace („R123").
//
// Filtr na `type === "REZERVACE"` je nutný: Job Builder formát čísla nevaliduje,
// takže „R123" jde napsat i běžné zakázce a ta se do překlopení nesmí připlést.

type ReservationBlockLike = {
  id: number;
  type: string;
  orderNumber: string;
  reservationId?: number | null;
  splitGroupId?: number | null;
};

/** Ostatní bloky téže rezervace (bez `block` samotného), v pořadí vstupu. */
export function findReservationSiblings<T extends ReservationBlockLike>(
  block: T,
  allBlocks: T[],
): T[] {
  return allBlocks.filter((b) => {
    if (b.id === block.id) return false;
    if (b.type !== "REZERVACE") return false;
    if (b.orderNumber === block.orderNumber) return true;
    // null == null nesmí spojit dvě nesouvisející rezervace bez vazby.
    return block.reservationId != null && b.reservationId === block.reservationId;
  });
}

export type ReservationSiblingSplit<T> = {
  /**
   * Stejná `splitGroupId` jako `block` (a nenulová) — druhá půlka rozdělené
   * zakázky. Server ji propaguje přes SPLIT_SHARED_FIELDS při KAŽDÉM PUTu na
   * kteréhokoli člena skupiny (`api/blocks/[id]/route.ts`), takže se překlopí
   * i na volbu „jen tento blok" — bez rozlišení by ta volba lhala (nahlásil
   * Vojta z reálného testování, 8/2026).
   */
  required: T[];
  /** Zbytek — typicky kopie rezervace na jiném stroji. Překlopí se jen na výslovné potvrzení. */
  optional: T[];
};

/**
 * Rozdělí sourozence (výstup `findReservationSiblings`) na povinné a
 * volitelné pro dialog překlopení rezervace na zakázku (`BlockEdit`).
 * Pořadí uvnitř obou skupin kopíruje pořadí vstupu.
 */
export function splitReservationSiblings<T extends ReservationBlockLike>(
  block: T,
  siblings: T[],
): ReservationSiblingSplit<T> {
  const required: T[] = [];
  const optional: T[] = [];
  for (const sibling of siblings) {
    // block.splitGroupId != null: „null == null" nesmí spárovat dva bloky,
    // které nejsou split (běžná kopie rezervace na druhém stroji by jinak
    // vždycky vyšla jako „ČÁST SPLITU").
    if (block.splitGroupId != null && sibling.splitGroupId === block.splitGroupId) {
      required.push(sibling);
    } else {
      optional.push(sibling);
    }
  }
  return { required, optional };
}
