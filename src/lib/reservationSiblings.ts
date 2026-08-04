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
