import { serializeAuditValue } from "@/lib/blockSerialization";
import { SPLIT_SHARED_FIELDS } from "@/lib/splitSharedFields";
import { AUDITED_FIELDS } from "@/lib/auditedFields";

/**
 * Pole, která smí vytvořit `SPLIT_PROPAGATE` řádek — průnik toho, co se vůbec
 * propaguje do split sourozenců (`SPLIT_SHARED_FIELDS`) a toho, co běžná
 * editace bloku audituje (`AUDITED_FIELDS`, `UPDATE` větev v `route.ts`).
 *
 * Počítáno PROGRAMOVĚ z obou zdrojů pravdy, ne ručním výčtem — ruční kopie by
 * se rozešla při první změně jednoho z obou seznamů (tenhle projekt si přesně
 * tohle už jednou vybral: klientská kopie `SPLIT_SHARED_FIELDS` se rozešla se
 * serverovou a způsobila regresi, viz komentář v `splitSharedFields.ts`).
 *
 * Bez tohoto zúžení by propagace auditovala VÍC než přímá editace (např.
 * `dataStatusId`, `description`, `barvyStatusLabel` — pole, která `UPDATE`
 * audit záměrně nesleduje, protože do historie má jít čitelný popisek/hodnota,
 * ne vnitřní identifikátor nebo pole bez auditní historie vůbec) — sourozenec
 * by tak měl v historii jiný obrázek než blok editovaný přímo.
 */
const AUDITED_FIELD_SET: ReadonlySet<string> = new Set(AUDITED_FIELDS);
export const SPLIT_PROPAGATE_AUDITED_FIELDS: readonly string[] = SPLIT_SHARED_FIELDS.filter((field) =>
  AUDITED_FIELD_SET.has(field)
);
const PROPAGATE_FIELD_SET: ReadonlySet<string> = new Set(SPLIT_PROPAGATE_AUDITED_FIELDS);

/**
 * Minimální tvar sourozence potřebný k porovnání starých hodnot. Index signature
 * (`Record<string, unknown>`) místo plného Prisma `Block` typu záměrně — funkce
 * musí jít testovat bez databáze, a `sharedUpdate` obsahuje jen podmnožinu polí
 * dynamicky podle toho, co se u editovaného bloku skutečně změnilo.
 */
export type SplitPropagateSibling = { id: number; orderNumber: string | null } & Record<string, unknown>;

export type SplitPropagateAuditRow = {
  blockId: number;
  orderNumber: string | null;
  field: string;
  oldValue: string;
  newValue: string;
};

/**
 * Spočítá auditní řádky pro propagaci sdílených polí (`SPLIT_SHARED_FIELDS`) do
 * ostatních členů split skupiny. Volající (`PUT /api/blocks/[id]`) k nim doplní
 * `userId`/`username`/`action: "SPLIT_PROPAGATE"` a zapíše přes `tx.auditLog.createMany`
 * — parita s `buildBatchAuditRows` (stejné rozdělení odpovědnosti: čistá funkce vrací
 * jen blockId/orderNumber/field/oldValue/newValue, request-scoped údaje doplní caller).
 *
 * `sharedUpdate` musí být PŘESNĚ objekt, který jde do `tx.block.updateMany` (klíče
 * jsou podmnožinou `SPLIT_SHARED_FIELDS`) — `siblings` musí být načtení PŘED tímto
 * `updateMany`, jinak `sibling[field]` už bude nová hodnota a žádná změna se nenajde.
 *
 * Hodnoty se porovnávají přes `serializeAuditValue` (stejný serializátor jako běžný
 * UPDATE audit o pár řádků výš v route.ts) — díky tomu je formát oldValue/newValue
 * identický a porovnání je typově bezpečné i pro Date/boolean/number pole.
 *
 * Sourozenec, který cílovou hodnotu už má (propagace je idempotentní — týž
 * `sharedUpdate` se typicky posílá na víc sourozenců, z nichž někteří ji mohou mít
 * nastavenou už z dřívějška), žádný řádek nedostane. Bez tohoto filtru by jedna
 * editace formuláře se spoustou polí ve `sharedUpdate` vyrobila desítky prázdných
 * řádků v historii každého sourozence.
 *
 * `sharedUpdate` může nést i pole mimo `SPLIT_PROPAGATE_AUDITED_FIELDS` (propagace
 * sama je širší množina — `SPLIT_SHARED_FIELDS` — protože se dál zapisuje vždy
 * celá, i pole bez auditní historie). Do řádků se z nich ale dostane jen průnik
 * s `AUDITED_FIELDS`, aby historie sourozence vypadala stejně jako u přímé editace.
 */
export function buildSplitPropagateAuditRows(params: {
  siblings: SplitPropagateSibling[];
  sharedUpdate: Record<string, unknown>;
}): SplitPropagateAuditRow[] {
  const { siblings, sharedUpdate } = params;
  const fields = Object.keys(sharedUpdate).filter((field) => PROPAGATE_FIELD_SET.has(field));
  const rows: SplitPropagateAuditRow[] = [];

  for (const sibling of siblings) {
    for (const field of fields) {
      const oldValue = serializeAuditValue(field, sibling[field]);
      const newValue = serializeAuditValue(field, sharedUpdate[field]);
      if (oldValue === newValue) continue; // idempotentní no-op — sourozenec už hodnotu má
      rows.push({
        blockId: sibling.id,
        orderNumber: sibling.orderNumber,
        field,
        oldValue,
        newValue,
      });
    }
  }

  return rows;
}
