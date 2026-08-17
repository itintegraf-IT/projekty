import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tenths, shareOfCalendar, breakdownTenths } from "./calendarCascadeView";
import type { CalendarCascade } from "./reportMetrics";

/**
 * Sestaví kaskádu z hodin. `unused.total` se dopočítá, aby fixtura sama
 * neporušovala serverový invariant — testy tady hlídají ZOBRAZENÍ, ne výpočet.
 */
function cascade(o: {
  calendar: number; staffed: number; planned?: number; confirmed?: number;
  weekend?: number; shutdown?: number; noRoster?: number;
}): CalendarCascade {
  const weekend = o.weekend ?? 0;
  const shutdown = o.shutdown ?? 0;
  const noRoster = o.noRoster ?? 0;
  const total = o.calendar - o.staffed;
  return {
    calendarHours: o.calendar,
    staffedHours: o.staffed,
    plannedHours: o.planned ?? 0,
    confirmedHours: o.confirmed ?? 0,
    confirmedShareOfPlanned: null,
    unused: {
      total,
      weekend, shutdown, noRoster,
      unstaffedShift: total - weekend - shutdown - noRoster,
    },
  };
}

describe("calendarCascadeView — tenths", () => {
  it("zaokrouhluje na desetiny a vrací CELÉ číslo", () => {
    assert.equal(tenths(39.05), 391);
    assert.equal(tenths(153.90000000000003), 1539);
    assert.equal(tenths(0), 0);
  });

  it("celá čísla nechává beze zbytku", () => {
    assert.equal(tenths(168), 1680);
  });
});

describe("calendarCascadeView — podíl na kalendáři", () => {
  it("počítá celá procenta", () => {
    assert.equal(shareOfCalendar(84, 168), 50);
  });

  it("nulový kalendář dá null, ne dělení nulou", () => {
    assert.equal(shareOfCalendar(10, 0), null);
  });
});

describe("calendarCascadeView — rozpad je na obrazovce PLATNÁ ROVNICE", () => {
  /*
   * Tohle je jediný důvod, proč modul existuje odděleně od komponenty.
   *
   * Sekce vypisuje „nevyužitý kalendář X h = A · B · C · D". Kdyby se všech pět
   * čísel zaokrouhlilo nezávisle, rovnice by nesouhlasila u zhruba TŘETINY
   * reálných období (změřeno fuzzem při revizi: 2 084 z 6 000). Uživatel by pak
   * viděl 168,0 − 39,1 = 128,9 vedle rozpadu, který tvrdí 129,1.
   */
  it("součet složek se rovná vypsanému celku", () => {
    const b = breakdownTenths(cascade({ calendar: 168, staffed: 39.05, weekend: 48, shutdown: 0.05 }));
    assert.equal(b.weekendT + b.shutdownT + b.noRosterT + b.unstaffedT, b.totalT);
  });

  it("celek je rozdíl ZOBRAZENÝCH hodnot, ne zaokrouhlený součet", () => {
    // 168,0 − 39,1 = 128,9. Kdyby se celek bral z `unused.total` (128,95),
    // vypsal by se jako 129,0 a nesouhlasil by s řádky nad sebou.
    const b = breakdownTenths(cascade({ calendar: 168, staffed: 39.05 }));
    assert.equal(b.totalT, 1680 - 391);
  });

  it("reziduum absorbuje zaokrouhlení, jako to dělá server", () => {
    const b = breakdownTenths(cascade({
      calendar: 100, staffed: 10, weekend: 30.04, shutdown: 20.04, noRoster: 10.04,
    }));
    assert.equal(b.weekendT + b.shutdownT + b.noRosterT + b.unstaffedT, b.totalT);
    assert.equal(b.unstaffedT, b.totalT - b.weekendT - b.shutdownT - b.noRosterT);
  });

  it("žádná složka nevyjde ZÁPORNÁ, ani když se chyby zaokrouhlení sečtou", () => {
    // Reziduum je skutečně nulové a každá ze tří složek se zaokrouhlí nahoru.
    // Záporné hodiny v reportu by byly horší než ta desetina, takže se přebytek
    // odečte od největší složky.
    const b = breakdownTenths(cascade({
      calendar: 24, staffed: 0, weekend: 8.049, shutdown: 8.049, noRoster: 7.902,
    }));
    for (const [name, v] of Object.entries(b)) {
      assert.ok(v >= 0, `${name} je záporné: ${v}`);
    }
    assert.equal(b.weekendT + b.shutdownT + b.noRosterT + b.unstaffedT, b.totalT);
  });

  it("celek nikdy nevyjde záporný", () => {
    // Nemělo by nastat (staffed ≤ calendar), ale kdyby se to někdy rozešlo,
    // report nesmí ukázat „nevyužito −3 h".
    const b = breakdownTenths(cascade({ calendar: 10, staffed: 12 }));
    assert.equal(b.totalT, 0);
  });

  it("rovnice platí na TISÍCI náhodných vstupech", () => {
    // Deterministický generátor — `Math.random` by dělal test nereprodukovatelným.
    let seed = 20260817;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 1000; i++) {
      const calendar = Math.round(next() * 9600 * 100) / 100;
      const staffed = Math.round(next() * calendar * 100) / 100;
      const rest = calendar - staffed;
      const weekend = Math.round(next() * rest * 100) / 100;
      const shutdown = Math.round(next() * (rest - weekend) * 100) / 100;
      const noRoster = Math.round(next() * (rest - weekend - shutdown) * 100) / 100;
      const b = breakdownTenths(cascade({ calendar, staffed, weekend, shutdown, noRoster }));
      assert.equal(
        b.weekendT + b.shutdownT + b.noRosterT + b.unstaffedT, b.totalT,
        `rovnice neplatí pro kalendář=${calendar} obsazeno=${staffed} víkend=${weekend} odstávka=${shutdown} rozvrh=${noRoster}`,
      );
      for (const [name, v] of Object.entries(b)) {
        assert.ok(v >= 0, `${name} záporné (${v}) pro kalendář=${calendar} obsazeno=${staffed}`);
      }
    }
  });
});
