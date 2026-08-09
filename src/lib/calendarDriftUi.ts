import type { CalendarDriftInfo } from "@/lib/printTimeClient";

/**
 * Rozlišení „stav vs. porucha" pro nálezy klientského detektoru kalendáře —
 * jediný zdroj pravdy pro všechna tři místa, která se podle něj řídí: štítek na
 * kartě (`BlockCard`), hlavička detailu (`BlockDetail`) a počítadlo nad strojem
 * (`TimelineGrid`). Když se ta místa rozhodují každé samo, jedno z nich zaostane
 * a plánovači tvrdí každé něco jiného.
 */
const PARKED_REASONS: ReadonlySet<CalendarDriftInfo["reason"]> = new Set([
  "PARKED",
  "STALE_BYPASS",
] as const);

/**
 * `true` = zakázka je odložená mimo pracovní dobu (vědomě nebo se zbytkovou
 * značkou). Není to porucha: plánovač ji tam dal, tiskne slitě a vrátí se do
 * kalendáře až adresným tlačítkem „Přepočítat" v jejím detailu.
 */
export function isParkedDrift(reason: CalendarDriftInfo["reason"]): boolean {
  return PARKED_REASONS.has(reason);
}

/**
 * Počet nálezů per stroj pro pruh „⚠ N nesedí na kalendář — Přepočítat".
 *
 * Odložené zakázky se NEPOČÍTAJÍ a je to nosná vlastnost, ne kosmetika: pruh
 * pohání HROMADNOU akci, kterou obsluhuje serverový `detectCalendarDrift` —
 * a ten odložené bloky vyřazuje. Cokoliv, co se do počítadla dostane a akce se
 * toho nedotkne, je slib, který aplikace nesplní; navíc by chip u vědomého
 * odložení tvrdil „nesedí na kalendář" a dialog „bloky se posunou", což je
 * obojí nepravda.
 */
export function countActionableDriftByMachine(
  blocks: readonly { id: number; machine: string }[],
  driftByBlockId: ReadonlyMap<number, CalendarDriftInfo>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const b of blocks) {
    const drift = driftByBlockId.get(b.id);
    if (!drift || isParkedDrift(drift.reason)) continue;
    counts.set(b.machine, (counts.get(b.machine) ?? 0) + 1);
  }
  return counts;
}
