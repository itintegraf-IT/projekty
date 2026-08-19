/**
 * Pole, která běžná editace bloku (`UPDATE` audit v `PUT /api/blocks/[id]`) sleduje
 * a při skutečné změně zapisuje do `AuditLog`. Zdroj pravdy na jednom místě — dřív
 * žila tahle konstanta jako lokální `const` uvnitř PUT handleru, takže ji nešlo
 * znovupoužít jinde bez ručního přepsání (přesně to riziko, které si tenhle projekt
 * už jednou vybralo: klientská kopie `SPLIT_SHARED_FIELDS` se rozešla se serverovou).
 *
 * Používá:
 *  - `src/app/api/blocks/[id]/route.ts` — filtr pro běžný `UPDATE` audit.
 *  - `src/lib/splitPropagateAudit.ts` — průnik s `SPLIT_SHARED_FIELDS`, aby
 *    `SPLIT_PROPAGATE` audit (propagace do split sourozenců) sledoval PŘESNĚ
 *    stejná pole jako přímá editace — historie pak vypadá stejně bez ohledu na
 *    to, jestli změnu udělal někdo přímo na bloku, nebo přišla propagací.
 */
export const AUDITED_FIELDS = [
  "dataStatusLabel", "dataRequiredDate", "dataOk",
  "materialStatusLabel", "materialRequiredDate", "materialOk", "materialNote",
  "pantoneRequiredDate", "pantoneOk", "pantoneRequired", "materialInStock", "materialIssued", "materialPartiallyIssued",
  "pantoneInStock", "pantoneIssued",
  "deadlineExpedice",
  "expediceNote", "doprava",
  "blockVariant",
  "jobPresetLabel",
  "obalka", "vnitrky", "tiskoveArchy", "serie",
  // Podstata překlopení rezervace na zakázku (REZERVACE→ZAKAZKA, R123→5000).
  // Do 8/2026 tu chyběly, takže v historii bloku byla po překlopení vidět
  // jen změna varianty a dohledat vznik zakázky nešlo.
  "type", "orderNumber",
] as const;

export type AuditedField = typeof AUDITED_FIELDS[number];
