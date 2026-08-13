/**
 * Jediný zdroj pravdy pro „co znamená shoda při hledání zakázky".
 *
 * Vzniklo 12. 8. 2026, když do DTP přehledu přibylo vlastní hledání — do té doby
 * si stejnou podmínku opisovala čtyři místa (hlavičkové hledání v planneru,
 * `outOfRangeBlocks`, tiskařský `OrderSearchSheet` a ztlumení neshodujících se
 * bloků v `TimelineGrid`). Kdo přidá další pole, přidá ho tady a projeví se všude
 * najednou — dřív by přidání pátého pole rozešlo hledání (blok najde) od plánu
 * (blok zůstane ztlumený).
 *
 * Záměrně BEZ odstranění diakritiky — parita s dosavadním chováním hledání.
 */

/** Strukturální podmnožina `Block` — lib nesmí záviset na klientské komponentě. */
export type OrderSearchable = {
  orderNumber: string;
  description: string | null;
  specifikace: string | null;
  jobPresetLabel: string | null;
};

/**
 * Predikát filtru: prázdný dotaz NEFILTRUJE (projde všechno). Volající, který
 * pro prázdný dotaz chce prázdný seznam (hlavičkové hledání v planneru), si to
 * hlídá sám — tady by to bylo překvapivé chování predikátu.
 */
export function blockMatchesQuery(block: OrderSearchable, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [block.orderNumber, block.description, block.specifikace, block.jobPresetLabel]
    .some((f) => f?.toLowerCase().includes(q));
}
