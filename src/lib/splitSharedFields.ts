/**
 * Sdílený zdroj pravdy pro pole, která server propaguje ze split bloku na jeho
 * sourozence v téže skupině (`splitGroupId`). Používá ho jak skutečná propagace
 * (`PUT /api/blocks/[id]`), tak klient (`PlannerPage.tsx` — lokální optimistický
 * patch sourozenců + `buildSplitEditTargets`, který počítá, co se sourozencům
 * posílá adresně přes undo).
 *
 * Dřív existovaly DVĚ nezávislé kopie a klientská se rozešla (chyběla jí
 * `materialIssued`, `expediceNote`, `doprava`, `expeditionPublishedAt`,
 * `expeditionSortOrder`) — review Tasku 7 Fix round 2 to odhalila jako regresi:
 * `buildSplitEditTargets` počítal průnik `changedFields ∩ SPLIT_SHARED_FIELDS`
 * proti zastaralé klientské kopii, takže `materialIssued` přestalo chodit
 * sourozencům v undo kroku, i když ho server na ně dál propaguje. Jeden modul
 * pro obě strany takovou drift napříště strukturálně vylučuje.
 *
 * POZOR — NIKDY sem nepřidávat startTime/endTime/machine: split sourozenci se na
 * serveru aktualizují přes `updateMany`, který NEprochází finální pojistkou
 * `assertNoOverlapForBlocks` (ta kontroluje jen editovaný blok + chain-push
 * posuny). Časové pole tady by otevřelo nehlídaný překryv.
 *
 * Čistý `as const` seznam bez importu — modul čte i prohlížeč (`PlannerPage.tsx`
 * je `"use client"`), nesmí sem přibýt nic serverového (Prisma, `.server` modul).
 */
export const SPLIT_SHARED_FIELDS = [
  "orderNumber", "description", "specifikace", "deadlineExpedice",
  "expediceNote", "doprava",
  "expeditionPublishedAt", "expeditionSortOrder",
  "jobPresetId", "jobPresetLabel",
  "type", "blockVariant",
  "dataStatusId", "dataStatusLabel", "dataRequiredDate", "dataOk",
  "materialStatusId", "materialStatusLabel", "materialRequiredDate", "materialOk", "materialInStock", "materialIssued",
  "pantoneRequiredDate", "pantoneOk", "pantoneRequired",
  "barvyStatusId", "barvyStatusLabel", "lakStatusId", "lakStatusLabel",
] as const;

export type SplitSharedField = typeof SPLIT_SHARED_FIELDS[number];
