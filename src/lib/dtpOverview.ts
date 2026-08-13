import { addDaysToCivilDate, utcToPragueDateStr } from "./dateUtils";
import { blockMatchesQuery, type OrderSearchable } from "./orderSearch";

/**
 * Výběr zakázek pro DTP přehled (postranní panel v planneru) — vytaženo z
 * `DtpPanel.tsx` 12. 8. 2026, když do panelu přibylo hledání podle čísla
 * zakázky (opakovaný požadavek DTP z auditu plánovače).
 *
 * Podstata: BEZ dotazu se nic nemění — panel ukazuje běžnou frontu (nejbližších
 * 30 dnů + vše s nehotovými daty). S dotazem se okno vědomě zahazuje a hledá se
 * napříč všemi zakázkami, jinak by DTP starší nebo vzdálenou zakázku nenašel
 * vůbec a pole by lhalo.
 */

/** Kolik dnů dopředu ukazuje panel bez zadaného dotazu. */
export const DTP_HORIZON_DAYS = 30;

export type DtpStatusFilter = "all" | "none" | number; // number = dataStatusId

/** Strukturální podmnožina `Block` — lib nesmí záviset na klientské komponentě. */
export type DtpOverviewBlock = OrderSearchable & {
  id: number;
  type: string;
  startTime: string;
  endTime: string;
  dataOk: boolean;
  dataStatusId: number | null;
};

/**
 * Patří blok do běžné fronty přehledu (tj. zobrazil by se i bez hledání)?
 * Slouží zároveň jako podklad pro štítek „mimo přehled" u nalezené zakázky.
 *
 * `horizon` jde předat zvenčí, aby se v cyklu nepočítal znovu pro každý blok —
 * `utcToPragueDateStr` jde přes `Intl.DateTimeFormat` a panel běží nad celou
 * tabulkou bloků (`GET /api/blocks` nemá rozsahový limit). Původní kód
 * v `DtpPanel` ho měl hoistnutý nad filtrem a extrakcí se to ztratilo.
 */
export function isInDtpDefaultList(
  block: DtpOverviewBlock,
  now: Date,
  horizon: string = addDaysToCivilDate(utcToPragueDateStr(now), DTP_HORIZON_DAYS),
): boolean {
  if (block.type !== "ZAKAZKA") return false;
  if (new Date(block.endTime).getTime() < now.getTime()) return false;
  const startDate = utcToPragueDateStr(new Date(block.startTime));
  return startDate <= horizon || block.dataOk === false;
}

function matchesStatus(block: DtpOverviewBlock, filter: DtpStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "none") return block.dataStatusId === null;
  return block.dataStatusId === filter;
}

/**
 * Vrací seřazený seznam i množinu id, která ve frontě bez hledání nejsou —
 * volající je potřebuje pro štítek „mimo přehled" a bez tohohle by si musel
 * `isInDtpDefaultList` zavolat na každý výsledek znovu.
 */
export function selectDtpOverviewBlocks<T extends DtpOverviewBlock>({
  blocks,
  query,
  statusFilter,
  now,
}: {
  blocks: T[];
  query: string;
  statusFilter: DtpStatusFilter;
  now: Date;
}): { list: T[]; outsideIds: Set<number> } {
  const q = query.trim();
  // Jednou pro celý průchod — ne uvnitř predikátu (viz isInDtpDefaultList).
  const horizon = addDaysToCivilDate(utcToPragueDateStr(now), DTP_HORIZON_DAYS);

  const found = blocks.filter((b) => {
    const inScope = q
      ? b.type === "ZAKAZKA" && blockMatchesQuery(b, q)
      : isInDtpDefaultList(b, now, horizon);
    return inScope && matchesStatus(b, statusFilter);
  });

  const startMs = (b: DtpOverviewBlock) => new Date(b.startTime).getTime();
  if (!q) {
    // Bez dotazu je z definice všechno uvnitř přehledu → prázdná množina.
    return { list: found.sort((a, b) => startMs(a) - startMs(b)), outsideIds: new Set() };
  }

  // Při hledání by chronologie vyplavila nahoru dávno dotištěné zakázky a to,
  // co DTP zajímá teď, by spadlo pod ně. Živá fronta jde proto nahoru (nejbližší
  // první), zakázky mimo přehled pod ni (nejčerstvější první).
  const live: T[] = [];
  const outside: T[] = [];
  for (const b of found) (isInDtpDefaultList(b, now, horizon) ? live : outside).push(b);
  return {
    list: [
      ...live.sort((a, b) => startMs(a) - startMs(b)),
      ...outside.sort((a, b) => startMs(b) - startMs(a)),
    ],
    outsideIds: new Set(outside.map((b) => b.id)),
  };
}
