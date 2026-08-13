import type { Block } from "@/app/_components/TimelineGrid";
import { utcToPragueDateStr, addDaysToCivilDate, formatPragueDateShort, pragueToUTC } from "@/lib/dateUtils";

/**
 * Pravidla pro tiskařský Monitor — která zakázka patří na velkou kartu,
 * co je ve frontě dneška a jak daleko je běh.
 *
 * Záměrně čistá logika bez Reactu, aby šla pokrýt unit testy; MonitorView
 * na ní jen staví a sám nic nepočítá.
 */

export type HeroReason = "running" | "overdue" | "upcoming";
export type HeroPick = { block: Block; reason: HeroReason } | null;

/**
 * Okno, po které v plánu svítí červený alarm zpoždění (`overdueState.ts`).
 *
 * Velká karta Monitoru jím řídit PŘESTALA (13. 8. 2026) — drží zakázku, dokud
 * tiskař nedá HOTOVO nebo „Přeskočit →“ (viz `pickHeroBlock`). Konstanta tu
 * zůstává re-exportovaná jako ZÁRUKA, ne z pohodlí: kdyby si ji sem někdo
 * zkopíroval zpátky jako vlastní číslo, plán by červenal jinak dlouho, než by
 * se choval Monitor.
 */
export { OVERDUE_WINDOW_MS } from "./overdueState";

/** Otevřená zakázka na daném stroji = ZAKAZKA + správný stroj + neodklepnutá. */
function isOpenOrder(b: Block, machine: string): boolean {
  return b.type === "ZAKAZKA" && b.machine === machine && b.printCompletedAt == null;
}

function byStartAsc(a: Block, b: Block): number {
  return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
}

/**
 * Jak daleko zpět sahá sekce „NEDODĚLÁNO" ve frontě Monitoru.
 *
 * Pokryje každou reálnou kombinaci víkend + svátky + celozávodní odstávka.
 * Strop tu MUSÍ být: sekci nic neuklidí (zakázka z ní zmizí jen odklepnutím
 * nebo smazáním bloku) a `Block` řádky se v projektu nikdy nemažou, takže
 * bez něj by seznam rostl donekonečna, až by Monitor přestal být čitelný.
 *
 * ZÁMĚRNĚ to NENÍ `OVERDUE_WINDOW_MS`: to odpovídá na jinou otázku („je
 * zpoždění ještě akutní?", 16 h) a použití by udělalo dvouhodinovou slepou
 * skvrnu — zakázka stará 14 h by při běžícím jiném bloku nebyla ani na velké
 * kartě, ani tady.
 */
export const UNFINISHED_LOOKBACK_DAYS = 14;

/**
 * Spodní hranice okna nedodělaných zakázek — pražská půlnoc dne
 * `dnes − UNFINISHED_LOOKBACK_DAYS`.
 *
 * Sdílí ji fronta (`monitorQueue`) i velká karta (`pickHeroBlock`), aby se
 * nemohly rozejít: zakázka, kterou karta drží, musí být dohledatelná i ve
 * frontě, a naopak. Počítá se z CIVILNÍCH pražských dnů, ne odečtením
 * 14×24 h — jinak by se okno posunulo o hodinu na přechodu letního času.
 */
export function unfinishedFloorMs(now: Date): number {
  const todayStr = utcToPragueDateStr(now);
  return pragueToUTC(addDaysToCivilDate(todayStr, -UNFINISHED_LOOKBACK_DAYS), 0, 0).getTime();
}

/**
 * Zakázka na velkou kartu Monitoru, s důvodem výběru. Priorita:
 *  1. `overdue`  — zakázce vypršel čas, nikdo ji neodklepl a tiskař ji
 *                  nepřeskočil. Z několika vyhrává ta, která skončila
 *                  NEJPOZDĚJI — to je ta, kterou má tiskař rozdělanou.
 *  2. `running`  — je uvnitř svého času,
 *  3. `upcoming` — jinak nejbližší budoucí.
 *
 * `overdue` je záměrně PŘED `running` (13. 8. 2026). Do té doby přebíjel běh
 * podle plánu, takže v okamžiku, kdy začal následující blok, karta odskočila —
 * i když tiskař pořád tiskl tu předchozí, a zmizelo mu i tlačítko HOTOVO.
 *
 * Šestnáctihodinové okno tu ZÁMĚRNĚ NENÍ: karta drží zakázku, dokud tiskař
 * nedá HOTOVO nebo „Přeskočit →". `OVERDUE_WINDOW_MS` zůstává vyhrazené
 * červenému alarmu v plánu — kdo ho sem vrátí, obnoví opravenou vadu.
 * Jediná mez je `unfinishedFloorMs`, sdílená s frontou: bez ní by na kartě
 * navěky seděl blok, který v datech leží od loňska.
 *
 * `skippedIds` jsou zakázky, které tiskař u tohoto stroje vědomě odsunul.
 * Zůstávají ve frontě v sekci NEDODĚLÁNO, jen nesmí zpátky na kartu.
 */
export function pickHeroBlock(
  blocks: Block[],
  machine: string,
  now: Date,
  skippedIds?: ReadonlySet<number>
): HeroPick {
  const t = now.getTime();
  const floorMs = unfinishedFloorMs(now);
  const open = blocks.filter((b) => isOpenOrder(b, machine));

  const overdue = open
    .filter((b) => {
      if (skippedIds?.has(b.id)) return false;
      const end = new Date(b.endTime).getTime();
      return end <= t && end >= floorMs;
    })
    .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());
  if (overdue.length > 0) return { block: overdue[0], reason: "overdue" };

  const running = open
    .filter((b) => new Date(b.startTime).getTime() <= t && t < new Date(b.endTime).getTime())
    .sort(byStartAsc);
  if (running.length > 0) return { block: running[0], reason: "running" };

  const next = pickNextBlock(blocks, machine, now);
  return next ? { block: next, reason: "upcoming" } : null;
}

/** Nejbližší budoucí neodklepnutá zakázka na stroji (klidně i zítřejší). */
export function pickNextBlock(blocks: Block[], machine: string, now: Date): Block | null {
  const t = now.getTime();
  const upcoming = blocks
    .filter((b) => isOpenOrder(b, machine) && new Date(b.startTime).getTime() > t)
    .sort(byStartAsc);
  return upcoming[0] ?? null;
}

/**
 * Fronta Monitoru — zakázky na daném stroji pro dnešek a zítřek, obojí seřazené
 * podle začátku, plus sekce NEDODĚLÁNO (neodklepnuté zakázky z předchozích dnů,
 * max `UNFINISHED_LOOKBACK_DAYS` zpátky). Odklepnuté zůstávají v dnešní/zítřejší
 * frontě, fronta je ukazuje ztlumené, aby byl vidět postup směny. Rezervace a
 * údržba do fronty ani do NEDODĚLÁNO nepatří — tiskař odklepává zakázky.
 *
 * Dva dny záměrně: tiskař, který přeskočí zakázku kvůli chybějícímu materiálu,
 * často sáhne po něčem z dalšího dne. Na vzdálenější zakázky je tlačítko Najít.
 */
export function monitorQueue(
  blocks: Block[],
  machine: string,
  now: Date
): { overdue: Block[]; today: Block[]; tomorrow: Block[] } {
  const todayStr = utcToPragueDateStr(now);
  const tomorrowStr = addDaysToCivilDate(todayStr, 1);
  const onMachine = blocks.filter((b) => b.type === "ZAKAZKA" && b.machine === machine);
  const forDay = (dayStr: string) =>
    onMachine
      .filter((b) => utcToPragueDateStr(new Date(b.startTime)) === dayStr)
      .sort(byStartAsc);

  // Hranice z CIVILNÍCH pražských dnů, ne odečtením 14×24 h — jinak by se okno
  // posunulo o hodinu na přechodu letního času.
  const todayMidnightMs = pragueToUTC(todayStr, 0, 0).getTime();
  const floorMs = unfinishedFloorMs(now);

  // Rozhoduje endTime, ne startTime: noční směna 22:00–6:00 začala včera, ale
  // končí dnes — podle startu by spadla sem, i když právě běží na velké kartě.
  // Táž volba, na které stojí 16h okno hero karty (gotcha z 10. 8. 2026).
  const overdue = onMachine
    .filter((b) => {
      if (b.printCompletedAt != null) return false;
      // Pozastavená zakázka je výrobní stopka, ne zpoždění — plán ji z „po
      // termínu" taky vylučuje (BlockCard na ni nevolá overdueAlarmState).
      if (b.blockVariant === "POZASTAVENO") return false;
      const end = new Date(b.endTime).getTime();
      return end < todayMidnightMs && end >= floorMs;
    })
    .sort(byStartAsc);

  return { overdue, today: forDay(todayStr), tomorrow: forDay(tomorrowStr) };
}

/**
 * Postup běhu. `percent` je ořezaný na 0–100; `remainingMinutes` může být
 * záporné, pokud blok přetahuje — UI to zobrazí jako „přetahuje o X min".
 */
export function runProgress(block: Block, now: Date): { percent: number; remainingMinutes: number } {
  const start = new Date(block.startTime).getTime();
  const end = new Date(block.endTime).getTime();
  const t = now.getTime();
  const span = end - start;
  const percent = span <= 0 ? 100 : Math.max(0, Math.min(100, ((t - start) / span) * 100));
  return { percent, remainingMinutes: Math.ceil((end - t) / 60000) };
}

/**
 * Zakázka, kterou Monitor po odklepnutí drží na velké kartě, dokud tiskař
 * nezmáčkne „Další →" nebo „Vrátit".
 *
 * Vrátí ji jen tehdy, když v datech pořád je, pořád je odklepnutá a pořád je
 * na stejném stroji. Tím se jedním pravidlem řeší i to, že odklepnutí mezitím
 * někdo zrušil z jiné stanice (přijde přes SSE), blok úplně zmizel, nebo ho
 * plánovač mezitím přesunul na jiný stroj — karta by pak tvrdila „hotovo"
 * o zakázce, která hotová není, nebo ji ukazovala na stroji, kam už nepatří.
 */
export function resolveStickyBlock(blocks: Block[], stickyId: number | null, machine: string): Block | null {
  if (stickyId == null) return null;
  const block = blocks.find((b) => b.id === stickyId);
  if (!block) return null;
  if (block.printCompletedAt == null) return null;
  if (block.machine !== machine) return null;
  return block;
}

/**
 * Popisek dne pro zakázku, která teprve začne: `null` pro dnešek, `"zítra"`
 * pro následující den, jinak krátké datum (`"13. 08."`).
 *
 * Porovnávají se civilní pražské dny, ne rozdíl v hodinách — zakázka na 0:30
 * je „zítra" i ve 23:30, kdy do ní zbývá hodina.
 */
export function startDayLabel(startTime: string | Date, now: Date): string | null {
  const start = new Date(startTime);
  const startStr = utcToPragueDateStr(start);
  const todayStr = utcToPragueDateStr(now);
  if (startStr === todayStr) return null;
  if (startStr === addDaysToCivilDate(todayStr, 1)) return "zítra";
  return formatPragueDateShort(start);
}

/**
 * Zakázka, kterou si tiskař ručně vytáhl na velkou kartu, nebo null, když výběr
 * přestal platit (zakázka zmizela z dat nebo ji plánovač přesunul na jiný stroj).
 *
 * Odklepnutou zakázku vybrat **jde** — je to jediná cesta, jak z Monitoru vzít
 * zpět starší odklepnutí.
 */
export function resolveSelectedBlock(
  blocks: Block[],
  selectedId: number | null,
  machine: string
): Block | null {
  if (selectedId == null) return null;
  const block = blocks.find((b) => b.id === selectedId);
  if (!block) return null;
  if (block.machine !== machine) return null;
  if (block.type !== "ZAKAZKA") return null;
  return block;
}

/**
 * Stav zakázky podle jejího času — bez ohledu na to, jak se na kartu dostala.
 *
 * Záměrně **bez** šestnáctihodinového okna: to je pravidlo pro automatický výběr
 * (`pickHeroBlock`), ne pro zobrazení. Když si tiskař ručně vytáhne týden starou
 * neodklepnutou zakázku, „PŘETAHUJE" je pořád pravdivý popis.
 */
export function reasonForBlock(block: Block, now: Date): HeroReason {
  const t = now.getTime();
  const start = new Date(block.startTime).getTime();
  const end = new Date(block.endTime).getTime();
  if (t >= start && t < end) return "running";
  if (end <= t) return "overdue";
  return "upcoming";
}
