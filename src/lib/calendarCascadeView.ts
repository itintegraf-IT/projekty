import type { CalendarCascade } from "@/lib/reportMetrics";

/**
 * Zobrazovací pravidla sekce „Využití kalendáře".
 *
 * Vlastní modul ze stejného důvodu jako `monitorView.ts`, `tiskarBlockView.ts`
 * a `dtpOverview.ts`: je to čistá logika, kterou má smysl testovat, a testovací
 * příkaz projektu složku `src/app/reporty/` vůbec neprochází. Rovnice
 * v rozpadu je přitom to jediné, co uživatel na sekci může ověřit okem — takže
 * je to poslední místo, kde chceme netestovaný kód.
 */

/** Hodiny na desetiny jako CELÉ číslo — v plovoucí čárce by 0,1 + 0,2 rovnici rozbilo. */
const tenths = (hours: number): number => Math.round(hours * 10);

/** Podíl na kalendáři v celých procentech. `null` u nulového základu. */
const shareOfCalendar = (part: number, calendar: number): number | null =>
  calendar > 0 ? Math.round((part / calendar) * 100) : null;

/**
 * Rozpad nevyužitého kalendáře v DESETINÁCH hodiny, spočítaný tak, aby
 * zobrazená rovnice platila přesně.
 *
 * Dvě pravidla, obě vynucená tím, co se na obrazovce reálně stalo:
 *
 * 1) **Celek se nebere ze součtu složek, ale z `kalendář − obsazeno`.** Nad
 *    těmi dvěma čísly stojí v kaskádě dva řádky a čtenář si rozdíl odečte
 *    sám. Když se `tenths()` aplikuje na kalendář, na obsazeno i na každou
 *    složku nezávisle, výsledky se rozejdou: fuzz přes 6 000 realistických
 *    období našel rozdíl 0,1 h u 2 084 z nich (kalendář 168,0 · obsazeno 39,1
 *    → 128,9, ale součet složek hlásil 129,1). Řádky nad rovnicí jsou to,
 *    čemu čtenář věří, takže rovnice se musí přizpůsobit jim.
 *
 * 2) **Reziduum (neobsazené směny) se DOPOČÍTÁVÁ jako zbytek**, ne zaokrouhluje
 *    zvlášť. Je to táž zásada, jakou drží server: víkend, odstávka a chybějící
 *    rozvrh jsou definované kbelíky, poslední absorbuje, co zbylo.
 *
 * Reziduum by po zaokrouhlení mohlo vyjít o desetinu či dvě záporné (chyba
 * každého zaokrouhlení je až 0,05 h a sčítá se), a to jedině v případě, kdy je
 * jeho skutečná hodnota prakticky nulová. Záporné hodiny v reportu by byly horší
 * než ta desetina, takže se přebytek odečte od NEJVĚTŠÍ definované složky —
 * rovnice tím zůstane přesná a žádné číslo nevyjde pod nulu.
 */
function breakdownTenths(c: CalendarCascade): {
  totalT: number; weekendT: number; shutdownT: number; noRosterT: number; unstaffedT: number;
} {
  const totalT = Math.max(0, tenths(c.calendarHours) - tenths(c.staffedHours));
  const parts = [tenths(c.unused.weekend), tenths(c.unused.shutdown), tenths(c.unused.noRoster)];
  let restT = totalT - parts[0] - parts[1] - parts[2];
  while (restT < 0) {
    const biggest = parts.indexOf(Math.max(...parts));
    if (parts[biggest] <= 0) break; // není z čeho ubrat; dál by cyklus jel donekonečna
    parts[biggest] -= 1;
    restT += 1;
  }
  return { totalT, weekendT: parts[0], shutdownT: parts[1], noRosterT: parts[2], unstaffedT: restT };
}

export { tenths, shareOfCalendar, breakdownTenths };
