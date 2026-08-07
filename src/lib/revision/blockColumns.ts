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
