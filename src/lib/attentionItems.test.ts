import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ATTENTION_THRESHOLDS,
  buildAttentionItems,
  attentionCalmSentence,
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
      waiting: [{ id: 1, orderNumber: "25-1043", waitingDays: ATTENTION_THRESHOLDS.reservationWaitingDays }],
    });
    assert.equal(under.length, 0, "přesně na prahu se ještě nehlásí");

    const over = buildAttentionItems({
      ...calm,
      waiting: [{ id: 1, orderNumber: "25-1043", waitingDays: ATTENTION_THRESHOLDS.reservationWaitingDays + 1 }],
    });
    assert.equal(over.length, 1);
    assert.equal(over[0].severity, "warn");
  });

  it("čekající rezervace se slučují do JEDNÉ položky, ne do seznamu", () => {
    // Pás má být krátký. Tři řádky o rezervacích by ho zaplavily.
    const items = buildAttentionItems({
      ...calm,
      waiting: [
        { id: 1, orderNumber: "25-1043", waitingDays: 5 },
        { id: 2, orderNumber: "25-1051", waitingDays: 4 },
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
      waiting: [{ id: 1, orderNumber: "25-1043", waitingDays: 5 }],
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
  it("nula přeplánovaných dní nevypíše „0 dní z 30“, ale důvod", () => {
    // Nastane, když bloky leží výhradně na dnech s nulovou kapacitou (víkend,
    // celozávodní odstávka) — vytížení je tam nedefinované, takže se den do
    // počtu nezapočítá, ale hodiny nad kapacitou existují.
    const items = buildAttentionItems({
      ...calm,
      overbooked: [{ machine: "XL_106", overbookedHours: 8, overbookedDays: 0 }],
    });
    assert.equal(items.length, 1);
    assert.doesNotMatch(items[0].when, /^0 /);
    assert.match(items[0].when, /mimo pracovní dobu/);
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
      waiting: [{ id: 1, orderNumber: "25-1043", waitingDays: 5 }],
      health: { loaded: true, total: 3, uncomputed: 1 },
    });
    assert.equal(items.length, 4);
    for (const it of items) {
      assert.ok(it.href && it.href.length > 0, `${it.key} nemá odkaz`);
      assert.ok(it.linkLabel && it.linkLabel.length > 0, `${it.key} nemá popisek odkazu`);
    }
  });

  it("odkazy míří jen na cesty, které v aplikaci existují", () => {
    const items = buildAttentionItems({
      overbooked: [{ machine: "XL_106", overbookedHours: 1, overbookedDays: 1 }],
      waiting: [{ id: 1, orderNumber: "25-1043", waitingDays: 9 }],
      health: { loaded: true, total: 1, uncomputed: 0 },
    });
    // `/` umí jen ?highlight=<id>; machine ani date neexistují.
    for (const it of items) {
      assert.doesNotMatch(it.href!, /[?&](machine|date)=/, `${it.key} používá neexistující parametr`);
    }
  });
});

describe("attentionItems — klidný stav", () => {
  it("vyjmenuje, co bylo ověřeno", () => {
    const s = attentionCalmSentence(calm);
    assert.match(s, /stroj/i);
    assert.match(s, /rezervac/i);
    assert.match(s, /kontrol/i);
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
