import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ATTENTION_THRESHOLDS,
  buildAttentionItems,
  attentionCalmSentence,
  attentionIsFullyVerified,
  type AttentionInput,
} from "./attentionItems";

/** Klidný vstup — nic nevyžaduje pozornost. Jednotlivé testy si ho upraví. */
const calm: AttentionInput = {
  overbooked: [],
  waiting: [],
  health: { loaded: true, total: 0, uncomputed: 0 },
};

describe("attentionItems — prahy", () => {
  it("rezervace pod prahem se nehlásí, nad prahem ano", () => {
    const under = buildAttentionItems({
      ...calm,
      waiting: [{ id: 1, orderNumber: "25-1043", status: "SUBMITTED", waitingDays: ATTENTION_THRESHOLDS.reservationWaitingDays }],
    });
    assert.equal(under.length, 0, "přesně na prahu se ještě nehlásí");

    const over = buildAttentionItems({
      ...calm,
      waiting: [{ id: 1, orderNumber: "25-1043", status: "SUBMITTED", waitingDays: ATTENTION_THRESHOLDS.reservationWaitingDays + 1 }],
    });
    assert.equal(over.length, 1);
    assert.equal(over[0].severity, "warn");
  });

  it("čekající rezervace se slučují do JEDNÉ položky, ne do seznamu", () => {
    // Pás má být krátký. Tři řádky o rezervacích by ho zaplavily.
    const items = buildAttentionItems({
      ...calm,
      waiting: [
        { id: 1, orderNumber: "25-1043", status: "SUBMITTED", waitingDays: 5 },
        { id: 2, orderNumber: "25-1051", status: "SUBMITTED", waitingDays: 4 },
      ],
    });
    assert.equal(items.length, 1);
    assert.match(items[0].title, /2 rezervace/);
    assert.match(items[0].when, /5/, "ukazuje nejdelší čekání, ne průměr");
  });

  it("přeplánovaný stroj je závažnější než čekající rezervace a jde první", () => {
    const items = buildAttentionItems({
      ...calm,
      overbooked: [{ machine: "XL_106", overbookedHours: 26.4, overbookedDays: 6 }],
      waiting: [{ id: 1, orderNumber: "25-1043", status: "SUBMITTED", waitingDays: 5 }],
    });
    assert.equal(items.length, 2);
    assert.equal(items[0].severity, "bad");
    assert.equal(items[1].severity, "warn");
  });

  it("každý stroj má vlastní položku", () => {
    const items = buildAttentionItems({
      ...calm,
      overbooked: [
        { machine: "XL_105", overbookedHours: 3, overbookedDays: 1 },
        { machine: "XL_106", overbookedHours: 26.4, overbookedDays: 6 },
      ],
    });
    assert.equal(items.length, 2);
    assert.notEqual(items[0].key, items[1].key, "klíče musí být různé");
  });
});

describe("attentionItems — hraniční případy přeplánování", () => {
  it("položka vždy nese horizont, ve kterém přeplánování platí", () => {
    // Bez horizontu se „přeplánován o 26 h" čte jako tvrzení o celém plánu.
    const items = buildAttentionItems({
      ...calm,
      overbooked: [{ machine: "XL_106", overbookedHours: 8, overbookedDays: 3 }],
    });
    assert.match(items[0].when, /z 30/);
  });

  it("nenulový počet dní se vypisuje i s horizontem", () => {
    const items = buildAttentionItems({
      ...calm,
      overbooked: [{ machine: "XL_106", overbookedHours: 8, overbookedDays: 6 }],
    });
    assert.match(items[0].when, /6 dní z 30/);
  });
});

describe("attentionItems — Kontrolní panel", () => {
  it("nálezy hlásí jako bad, nespočtené kontroly jako warn", () => {
    const bad = buildAttentionItems({ ...calm, health: { loaded: true, total: 3, uncomputed: 0 } });
    assert.equal(bad.length, 1);
    assert.equal(bad[0].severity, "bad");

    const warn = buildAttentionItems({ ...calm, health: { loaded: true, total: 0, uncomputed: 1 } });
    assert.equal(warn.length, 1);
    assert.equal(warn[0].severity, "warn");
  });

  it("nenačtený Kontrolní panel nevyrábí položku ANI klidné tvrzení", () => {
    // Kdyby nenačtený panel propadl na „bez nálezu", pás by tvrdil, že je
    // uklizeno, aniž by to kdokoliv ověřil. Táž vada, jakou řešil třetí stav
    // odznaku v etapě Kontrolního panelu.
    const input = { ...calm, health: { loaded: false, total: 0, uncomputed: 0 } };
    assert.equal(buildAttentionItems(input).length, 0);
    assert.doesNotMatch(attentionCalmSentence(input), /kontrol/i);
  });

  it("nálezy i nespočtené naráz dají dvě položky", () => {
    const items = buildAttentionItems({ ...calm, health: { loaded: true, total: 2, uncomputed: 1 } });
    assert.equal(items.length, 2);
  });
});

describe("attentionItems — odkazy", () => {
  it("každá položka vede někam, kde se to dá řešit", () => {
    const items = buildAttentionItems({
      overbooked: [{ machine: "XL_106", overbookedHours: 26.4, overbookedDays: 6 }],
      waiting: [{ id: 1, orderNumber: "25-1043", status: "SUBMITTED", waitingDays: 5 }],
      health: { loaded: true, total: 3, uncomputed: 1 },
    });
    assert.equal(items.length, 4);
    for (const it of items) {
      assert.ok(it.target.label.length > 0, `${it.key} nemá popisek cíle`);
    }
  });

  it("odkazy míří jen na cesty, které v aplikaci existují", () => {
    const items = buildAttentionItems({
      overbooked: [{ machine: "XL_106", overbookedHours: 1, overbookedDays: 1 }],
      waiting: [{ id: 1, orderNumber: "25-1043", status: "SUBMITTED", waitingDays: 9 }],
      health: { loaded: true, total: 1, uncomputed: 0 },
    });
    // Původní verze měla u tří položek `href: "/reporty"`. Tam se ale
    // uživatel už NACHÁZÍ a záložka je lokální stav bez URL, takže odkaz
    // způsobil reload a přistání na výchozí záložce — hůř než no-op.
    // Cesta v `href` proto musí být z tohohle seznamu; přepnutí záložky
    // není odkaz, ale `kind: "tab"`.
    const REAL_ROUTES = ["/rezervace", "/"];
    for (const it of items) {
      if (it.target.kind === "href") {
        const path = it.target.href.split("?")[0];
        assert.ok(REAL_ROUTES.includes(path), `${it.key} vede na neexistující cestu ${it.target.href}`);
        assert.doesNotMatch(it.target.href, /[?&](machine|date)=/, `${it.key} používá neexistující parametr`);
        assert.notEqual(path, "/reporty", `${it.key} odkazuje na stránku, na které uživatel stojí`);
      } else {
        assert.ok(["retro", "outlook", "health"].includes(it.target.tab), `${it.key} má neznámou záložku`);
      }
    }
  });
});

describe("attentionItems — klidný stav", () => {
  it("vyjmenuje, co bylo ověřeno", () => {
    const s = attentionCalmSentence(calm);
    assert.match(s, /stroj/i);
    assert.match(s, /rezervac/i);
    assert.match(s, /kontrol/i);
    assert.match(s, /30/, "musí říct, v jakém horizontu to platí");
  });

  it("věta nikdy netvrdí víc, než co se ověřilo", () => {
    const s = attentionCalmSentence({ ...calm, health: { loaded: false, total: 0, uncomputed: 0 } });
    assert.doesNotMatch(s, /kontrol/i);
    assert.match(s, /stroj/i, "co ověřeno bylo, se uvést má");
  });
});

describe("attentionItems — čísla v češtině", () => {
  it("hodiny mají desetinnou čárku, ne tečku", () => {
    const items = buildAttentionItems({
      ...calm,
      overbooked: [{ machine: "XL_106", overbookedHours: 26.4, overbookedDays: 6 }],
    });
    assert.match(items[0].title, /26,4/);
    assert.doesNotMatch(items[0].title, /26\.4/);
  });
});

describe("attentionItems — fronta rezervací", () => {
  it("QUEUE_READY dostane VLASTNÍ položku, ne mlčení", () => {
    // Pás bral původně jen SUBMITTED, zatímco seznam v RIZIKA počítá obojí
    // a barví řádky týmž prahem — pás tedy mlčel, zatímco pod ním svítily
    // čtyři červené řádky.
    const items = buildAttentionItems({
      ...calm,
      waiting: [
        { id: 1, orderNumber: "R-101", status: "QUEUE_READY", waitingDays: 9 },
        { id: 2, orderNumber: "R-102", status: "QUEUE_READY", waitingDays: 6 },
      ],
    });
    assert.equal(items.length, 1);
    assert.match(items[0].title, /2 rezervace čekají na naplánování/);
    assert.match(items[0].when, /9/);
  });

  it("oba stavy naráz dají dvě položky s různým textem", () => {
    const items = buildAttentionItems({
      ...calm,
      waiting: [
        { id: 1, orderNumber: "R-101", status: "QUEUE_READY", waitingDays: 9 },
        { id: 2, orderNumber: "R-102", status: "SUBMITTED", waitingDays: 5 },
      ],
    });
    assert.equal(items.length, 2);
    const keys = items.map((i) => i.key);
    assert.ok(keys.includes("reservations:unanswered"));
    assert.ok(keys.includes("reservations:queued"));
    assert.notEqual(items[0].title, items[1].title);
  });
});

describe("attentionItems — co pás smí tvrdit", () => {
  const withDays = (d: Record<string, number>) => ({ ...calm, checkedDaysByMachine: d });

  it("neposouzený stroj se v klidné větě NEZMÍNÍ", () => {
    // Nenaseedované týdny směn = žádný den s kapacitou = pás neověřil nic.
    const s = attentionCalmSentence(withDays({ XL_105: 0, XL_106: 0 }));
    assert.doesNotMatch(s, /kapacit/i, "o kapacitě nesmí tvrdit nic");
    assert.match(s, /rezervac/i, "co ověřeno bylo, se uvést má");
  });

  it("posouzený jen jeden stroj → věta jmenuje jeho, ne „ani jeden“", () => {
    const s = attentionCalmSentence(withDays({ XL_105: 30, XL_106: 0 }));
    assert.doesNotMatch(s, /ani jeden stroj/);
    assert.match(s, /XL 105/);
  });

  it("posouzeny oba → souhrnná formulace", () => {
    const s = attentionCalmSentence(withDays({ XL_105: 30, XL_106: 22 }));
    assert.match(s, /ani jeden stroj/);
  });

  it("pás NENÍ plně ověřený, dokud nedoběhne Kontrolní panel", () => {
    assert.equal(attentionIsFullyVerified({ ...calm, health: { loaded: false, total: 0, uncomputed: 0 } }), false);
    assert.equal(attentionIsFullyVerified(withDays({ XL_105: 0, XL_106: 30 })), false);
    assert.equal(attentionIsFullyVerified(withDays({ XL_105: 30, XL_106: 30 })), true);
  });
});
