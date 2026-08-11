/**
 * Sloupce `Block`, které undo obnovuje DOSLOVA.
 *
 * NENÍ to `blockToCreatePayload` — ten je tvarovaný pro POST /api/blocks
 * a spoléhá na její odvozeniny (`dataOk` si server dopočítá z `dataStatusId`,
 * `recurrenceType` posílá natvrdo "NONE"). Undo vrací stav, který v DB
 * existoval, takže žádné odvozeniny spouštět nesmí a hodnoty jdou ze sloupců.
 *
 * Vědomě VYNECHANÉ (8 sloupců):
 *   id, createdAt, updatedAt      — spravuje Prisma / nese je op.id
 *   printCompleted{At,ByUserId,ByUsername} — potvrzení tisku má vlastní endpoint
 *   reservationId                 — business vazba, undo ji nesmí přepojit
 *   recurrenceParentId            — série; undo je guardované na standalone bloky
 *
 * Počet drží tripwire v restoreFields.test.ts — nový sloupec Blocku se sem
 * přidává vědomě (a nikdy nemizí tiše).
 */
export const UNDO_RESTORABLE_FIELDS = [
  // pozice a tiskové hodiny
  "machine", "startTime", "endTime", "printMinutes", "scheduleBypassed",
  // identita
  "orderNumber", "type", "blockVariant", "locked", "splitGroupId", "recurrenceType",
  // popis a preset
  "description", "jobPresetId", "jobPresetLabel", "specifikace",
  // DATA
  "dataStatusId", "dataStatusLabel", "dataRequiredDate", "dataOk",
  // MATERIÁL
  "materialStatusId", "materialStatusLabel", "materialRequiredDate", "materialOk",
  "materialNote", "materialNoteByUsername", "materialInStock", "materialIssued",
  // PANTONE
  "pantoneRequired", "pantoneOk", "pantoneRequiredDate", "pantoneInStock", "pantoneIssued",
  // barvy / lak
  "barvyStatusId", "barvyStatusLabel", "lakStatusId", "lakStatusLabel",
  // výrobní štítky
  "obalka", "vnitrky", "tiskoveArchy", "serie",
  // expedice
  "deadlineExpedice", "doprava", "expediceNote",
  "expeditionPublishedAt", "expeditionSortOrder",
] as const;

export type UndoRestorableField = (typeof UNDO_RESTORABLE_FIELDS)[number];

const ALLOWED = new Set<string>(UNDO_RESTORABLE_FIELDS);

export function isRestorableField(key: string): key is UndoRestorableField {
  return ALLOWED.has(key);
}

/** Cokoliv, co má sloupce Blocku — Prisma řádek i serializovaný klientský blok. */
export type RestoreSource = Record<string, unknown>;

/** Block → snapshot obnovitelných polí. Nepovolené klíče tiše zahodí. */
export function blockToRestoreFields(block: RestoreSource): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of UNDO_RESTORABLE_FIELDS) {
    if (key in block) out[key] = block[key];
  }
  return out;
}
