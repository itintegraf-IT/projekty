import { blockPrintMinutes } from "./printTimeClient";

/**
 * Jeden zdroj pravdy pro mapování Block → POST /api/blocks payload (audit #2).
 *
 * Do 7/2026 existovaly 4 ručně kopírované mapy (undo single, undo multi, paste,
 * group paste), které divergovaly — undo/paste tiše ztrácely pantone pole,
 * materialInStock a materialNote. Tento helper má EXPLICITNÍ výčet všech polí;
 * test blockPayload.test.ts
 * drží tripwire přes EXPECTED_PAYLOAD_KEYS — nové pole Blocku se sem přidává vědomě
 * (a nikdy nemizí tiše).
 *
 * Vědomé vlastnosti payloadu:
 * - `dataOk` se NEPOSÍLÁ — server si ho odvozuje z dataStatusId (POST /api/blocks).
 * - `recurrenceType` je vždy "NONE" — payload vytváří samostatný blok; volající
 *   cesty (undo/paste) jsou guardované na standalone bloky a kopie sérii nedědí.
 * - splitGroupId se DEFAULTNĚ neposílá (paste/kopie = nový nezávislý blok, nedědí
 *   skupinu). Undo-obnova ho ale předá přes `opts.splitGroupId`, aby se smazaná
 *   split část vrátila do své skupiny (POST /api/blocks ji uloží). recurrenceParentId
 *   a reservationId se neposílají nikdy — série/rezervace jsou z undo guardované.
 * - Request flagy (bypassScheduleValidation, resolveChain, autoShiftIfBusy) do
 *   payloadu NEPATŘÍ — přidává si je call-site podle kontextu.
 */

/** Strukturální typ zdroje — klient-safe, žádný import z app komponent. */
export type BlockPayloadSource = {
  orderNumber: string;
  machine: string;
  startTime: string | Date;
  endTime: string | Date;
  type: string;
  blockVariant?: string | null;
  description: string | null;
  locked: boolean;
  printMinutes?: number | null;
  deadlineExpedice: string | null;
  jobPresetId: number | null;
  dataStatusId: number | null;
  dataStatusLabel: string | null;
  dataRequiredDate: string | null;
  materialStatusId: number | null;
  materialStatusLabel: string | null;
  materialRequiredDate: string | null;
  materialOk: boolean;
  barvyStatusId: number | null;
  barvyStatusLabel: string | null;
  lakStatusId: number | null;
  lakStatusLabel: string | null;
  specifikace: string | null;
  materialNote?: string | null;
  obalka?: boolean | null;
  vnitrky?: boolean | null;
  tiskoveArchy?: string | null;
  serie?: string | null;
  pantoneRequiredDate?: string | null;
  pantoneOk?: boolean | null;
  pantoneRequired?: boolean | null;
  materialInStock?: boolean | null;
  materialIssued?: boolean | null;
  recurrenceType?: string;
};

export type BlockCreatePayloadOpts = {
  /** Cílový stroj (paste) — bez override zůstává stroj bloku (undo restore). */
  machine?: string;
  /** Cílový start ISO (paste) — bez override původní pozice bloku. */
  startTime?: string;
  /** Cílový end ISO (paste) — bez override původní end bloku. */
  endTime?: string;
  /** Vložená kopie se nikdy nevkládá zamčená (paste: false); undo vrací původní locked. */
  locked?: boolean;
  /**
   * Split skupina — posílá se JEN při undo-obnově smazaného bloku, aby se vrátil
   * do své skupiny (POST /api/blocks ji uloží). Paste/kopie klíč vynechává (kopie
   * je nový nezávislý blok). `undefined` = neposílat; `null` = standalone (no-op).
   */
  splitGroupId?: number | null;
};

/** Kanonický seznam klíčů payloadu (bez podmíněného printMinutes u ZAKAZKA). */
export const EXPECTED_PAYLOAD_KEYS = [
  "orderNumber",
  "machine",
  "startTime",
  "endTime",
  "type",
  "blockVariant",
  "description",
  "locked",
  "deadlineExpedice",
  "jobPresetId",
  "dataStatusId",
  "dataStatusLabel",
  "dataRequiredDate",
  "materialStatusId",
  "materialStatusLabel",
  "materialRequiredDate",
  "materialOk",
  "barvyStatusId",
  "barvyStatusLabel",
  "lakStatusId",
  "lakStatusLabel",
  "specifikace",
  "materialNote",
  "obalka",
  "vnitrky",
  "tiskoveArchy",
  "serie",
  "pantoneRequiredDate",
  "pantoneOk",
  "pantoneRequired",
  "materialInStock",
  "materialIssued",
  "recurrenceType",
] as const;

export function blockToCreatePayload(
  block: BlockPayloadSource,
  opts: BlockCreatePayloadOpts = {},
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    orderNumber: block.orderNumber,
    machine: opts.machine ?? block.machine,
    startTime: opts.startTime ?? block.startTime,
    endTime: opts.endTime ?? block.endTime,
    type: block.type,
    blockVariant: block.blockVariant ?? "STANDARD",
    description: block.description,
    locked: opts.locked ?? block.locked,
    deadlineExpedice: block.deadlineExpedice,
    jobPresetId: block.jobPresetId,
    dataStatusId: block.dataStatusId,
    dataStatusLabel: block.dataStatusLabel,
    dataRequiredDate: block.dataRequiredDate,
    materialStatusId: block.materialStatusId,
    materialStatusLabel: block.materialStatusLabel,
    materialRequiredDate: block.materialRequiredDate,
    materialOk: block.materialOk,
    barvyStatusId: block.barvyStatusId,
    barvyStatusLabel: block.barvyStatusLabel,
    lakStatusId: block.lakStatusId,
    lakStatusLabel: block.lakStatusLabel,
    specifikace: block.specifikace,
    materialNote: block.materialNote ?? null,
    obalka: block.obalka ?? false,
    vnitrky: block.vnitrky ?? false,
    tiskoveArchy: block.tiskoveArchy ?? null,
    serie: block.serie ?? null,
    pantoneRequiredDate: block.pantoneRequiredDate ?? null,
    pantoneOk: block.pantoneOk ?? false,
    pantoneRequired: block.pantoneRequired ?? false,
    materialInStock: block.materialInStock ?? false,
    materialIssued: block.materialIssued ?? false,
    recurrenceType: "NONE",
  };
  if (block.type === "ZAKAZKA") {
    payload.printMinutes = blockPrintMinutes(block);
  }
  // splitGroupId jen na explicitní přání (undo-obnova) — paste ho vynechává.
  if (opts.splitGroupId !== undefined) {
    payload.splitGroupId = opts.splitGroupId;
  }
  return payload;
}

/**
 * Vrací `splitGroupId`, který smí undo-obnova poslat na POST — nebo `undefined`,
 * když ho poslat NELZE (blok se obnoví jako standalone).
 *
 * `splitGroupId` je self-FK na `Block.id` (migrace: ON DELETE SET NULL). Na POST
 * smíme poslat jen hodnotu, která po této deleci pořád ukazuje na existující blok:
 * - LEAF (splitGroupId ≠ vlastní id, root přežil) → vrátí splitGroupId → blok se
 *   vrátí do skupiny (3/3).
 * - ROOT (splitGroupId === vlastní id) nebo osiřelý leaf (root smazán v téže dávce)
 *   → kotva je pryč → `undefined`; poslat staré id by spadlo na FK violation
 *   („Chyba při vytváření bloku"), takže blok obnovíme jako standalone.
 */
export function restoreSplitGroupId(
  block: { id: number; splitGroupId: number | null },
  deletedIds: number[],
): number | undefined {
  if (block.splitGroupId == null) return undefined;
  if (deletedIds.includes(block.splitGroupId)) return undefined;
  return block.splitGroupId;
}
