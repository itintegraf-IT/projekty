/**
 * Sloupce Block, které raw `SELECT` vrací v jiném tvaru, než dává Prisma klient.
 * MySQL BOOLEAN je TINYINT(1) → raw čtení vrátí 0/1 místo false/true
 * (ověřeno proti dev DB, viz komentář v src/lib/undoApply.server.ts:147-155).
 *
 * Zdroj pravdy je prisma/schema.prisma, model Block. Když do něj přibude
 * Boolean nebo DateTime sloupec, MUSÍ přibýt i sem — jinak ho revize uloží
 * jako 0/1, resp. jako řetězec, a rozdíl bude hlásit změnu i tam, kde žádná není.
 */
export const BLOCK_BOOLEAN_COLUMNS = [
  "locked", "dataOk", "materialOk", "obalka", "vnitrky",
  "materialInStock", "materialIssued", "pantoneRequired", "pantoneOk",
  "scheduleBypassed",
] as const;

export const BLOCK_DATE_COLUMNS = [
  "startTime", "endTime", "deadlineExpedice", "dataRequiredDate",
  "materialRequiredDate", "pantoneRequiredDate", "expeditionPublishedAt",
  "printCompletedAt", "createdAt", "updatedAt",
] as const;

/**
 * Relační pole modelu Block. `withRevision` přes ně zakazuje vnořený zápis:
 * `rtx.block.update({ where: { id: dítě }, data: { Block_Block_…: { update: … } } })`
 * je typově validní, projde buildem i testy, změní RODIČOVSKÝ řádek — a revize
 * o něm nevznikne, protože obal čte výhradně `args.where`, nikdy `args.data`
 * (ověřeno sondou proti dev DB 7. 8. 2026, nezávisle čtyřmi optikami recenze).
 *
 * Zdroj pravdy je prisma/schema.prisma, model Block. Když přibude relace,
 * MUSÍ přibýt i sem — jinak se otevře tichá cesta, jak měnit bloky mimo
 * černou skříňku. Hlídá to schema-sync test v blockColumns.test.ts.
 */
export const BLOCK_RELATION_FIELDS = [
  "Block_Block_recurrenceParentIdToBlock",
  "other_Block_Block_recurrenceParentIdToBlock",
  "Reservation",
  "splitGroup",
  "notes",
] as const;

/**
 * Klíče, kterými vede vnořený zápis do Block z JINÝCH modelů
 * (`SplitGroup.blocks`, `Reservation.blocks`, `BlockNote.block`).
 * Delegáty těch modelů `withRevision` propouští, ale s toutéž kontrolou.
 */
export const BLOCK_INBOUND_RELATION_FIELDS = ["blocks", "block"] as const;

/**
 * Vnořené operace, které v `data` znamenají zápis. `connect`/`disconnect`/`set`
 * jsou v seznamu záměrně: u to-many relace (`other_Block_…: { set: [] }`)
 * vynulují cizím řádkům `recurrenceParentId`, tedy zapíší do jiných bloků.
 */
export const NESTED_WRITE_OPERATIONS = [
  "create", "createMany", "update", "updateMany", "upsert",
  "delete", "deleteMany", "connect", "disconnect", "connectOrCreate", "set",
] as const;
