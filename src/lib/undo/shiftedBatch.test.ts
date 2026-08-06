import { test } from "node:test";
import assert from "node:assert/strict";
import { accumulateShifted, excludeShiftedTargeted, type ShiftedSnapshots } from "./shiftedBatch";
import type { BlockSnapshot, EditSnapshot } from "./types";

// `over` musí nést `id` a smí přepsat kterékoli z ostatních 6 polí — BlockSnapshot má
// všech 7 polí POVINNÝCH (types.ts), takže defaulty + přepis dají vždy platný tvar
// bez castu (žádné `as never` — tenhle modul žádná business pole nepotřebuje,
// pracuje čistě s pozicí a id).
function pos(over: Partial<BlockSnapshot> & { id: number }): BlockSnapshot {
  return {
    startTime: "2026-09-02T06:00:00.000Z", endTime: "2026-09-02T08:00:00.000Z",
    machine: "XL_105", updatedAt: "v1", printMinutes: 120, scheduleBypassed: false,
    ...over,
  };
}

const EMPTY: ShiftedSnapshots = { before: [], after: [] };

// ─── accumulateShifted ────────────────────────────────────────────────────

test("accumulateShifted: prázdný akumulátor + první PUT — vrátí přesně to, co přišlo", () => {
  const next: ShiftedSnapshots = {
    before: [pos({ id: 9, updatedAt: "s1" })],
    after: [pos({ id: 9, updatedAt: "s2", startTime: "2026-09-02T10:00:00.000Z" })],
  };
  const acc = accumulateShifted(EMPTY, next);
  assert.deepEqual(acc, next);
});

test("accumulateShifted: druhé volání s JINÝM id — připojí se, první záznam zůstane beze změny", () => {
  const first = accumulateShifted(EMPTY, {
    before: [pos({ id: 9, updatedAt: "s1" })],
    after: [pos({ id: 9, updatedAt: "s2" })],
  });
  const second = accumulateShifted(first, {
    before: [pos({ id: 10, updatedAt: "t1" })],
    after: [pos({ id: 10, updatedAt: "t2" })],
  });
  assert.equal(second.before.length, 2);
  assert.deepEqual(second.before.map((b) => b.id), [9, 10]);
  assert.deepEqual(second.after.map((b) => b.id), [9, 10]);
  assert.equal(second.before[0].updatedAt, "s1", "první soused beze změny");
});

test("accumulateShifted: druhé volání se STEJNÝM id — before zůstává PRVNÍ (předdávkové), after se přepíše na NOVÉ", () => {
  const first = accumulateShifted(EMPTY, {
    before: [pos({ id: 9, updatedAt: "s1", startTime: "2026-09-02T06:00:00.000Z" })],
    after: [pos({ id: 9, updatedAt: "s2", startTime: "2026-09-02T08:00:00.000Z" })],
  });
  const second = accumulateShifted(first, {
    // "před" druhého PUTu = "po" prvního — jen mezistav, nesmí se objevit ve výsledku
    before: [pos({ id: 9, updatedAt: "s2", startTime: "2026-09-02T08:00:00.000Z" })],
    after: [pos({ id: 9, updatedAt: "s3", startTime: "2026-09-02T10:00:00.000Z" })],
  });
  assert.equal(second.before.length, 1, "žádný duplicitní záznam pro id 9");
  assert.equal(second.before[0].updatedAt, "s1", "before zůstává PŘEDDÁVKOVÁ pozice, ne mezistav");
  assert.equal(second.before[0].startTime, "2026-09-02T06:00:00.000Z");
  assert.equal(second.after[0].updatedAt, "s3", "after je KONEČNÁ pozice po celé dávce");
  assert.equal(second.after[0].startTime, "2026-09-02T10:00:00.000Z");
});

test("accumulateShifted: TŘETÍ volání se stejným id — after sleduje POSLEDNÍ PUT, ne prostřední (MUTAČNÍ POJISTKA)", () => {
  // Kdyby dedup omylem "zamrzl" po druhém volání a další update ignoroval, třetí PUT
  // by se ztratil beze stopy — test musí projít TŘEMI voláními, ne dvěma, jinak
  // tuhle třídu chyby nechytí (druhé volání by prošlo i s chybnou implementací).
  let acc = accumulateShifted(EMPTY, {
    before: [pos({ id: 9, updatedAt: "s1" })],
    after: [pos({ id: 9, updatedAt: "s2" })],
  });
  acc = accumulateShifted(acc, {
    before: [pos({ id: 9, updatedAt: "s2" })],
    after: [pos({ id: 9, updatedAt: "s3" })],
  });
  acc = accumulateShifted(acc, {
    before: [pos({ id: 9, updatedAt: "s3" })],
    after: [pos({ id: 9, updatedAt: "s4", startTime: "2026-09-02T12:00:00.000Z" })],
  });
  assert.equal(acc.before.length, 1);
  assert.equal(acc.before[0].updatedAt, "s1", "before pořád předdávkové, i po třech PUTech");
  assert.equal(acc.after[0].updatedAt, "s4", "after je z POSLEDNÍHO PUTu, ne prostředního (s3)");
  assert.equal(acc.after[0].startTime, "2026-09-02T12:00:00.000Z");
});

test("accumulateShifted: next s VÍC bloky v jednom PUTu — nové i známé id se zpracují nezávisle", () => {
  const first = accumulateShifted(EMPTY, {
    before: [pos({ id: 9, updatedAt: "s1" })],
    after: [pos({ id: 9, updatedAt: "s2" })],
  });
  const second = accumulateShifted(first, {
    before: [pos({ id: 9, updatedAt: "s2" }), pos({ id: 10, updatedAt: "t1" })], // 9 známé, 10 nové
    after: [pos({ id: 9, updatedAt: "s3" }), pos({ id: 10, updatedAt: "t2" })],
  });
  assert.equal(second.before.length, 2, "id 9 se NEZDVOJÍ");
  assert.deepEqual(second.before.map((b) => b.id), [9, 10], "9 zůstává na svém místě (update in place), 10 se připojí na konec");
  const nine = second.after.find((b) => b.id === 9)!;
  const ten = second.after.find((b) => b.id === 10)!;
  assert.equal(nine.updatedAt, "s3");
  assert.equal(ten.updatedAt, "t2");
});

test("accumulateShifted: prázdné next nezmění akumulátor", () => {
  const first = accumulateShifted(EMPTY, {
    before: [pos({ id: 9, updatedAt: "s1" })],
    after: [pos({ id: 9, updatedAt: "s2" })],
  });
  const second = accumulateShifted(first, EMPTY);
  assert.deepEqual(second, first);
});

test("accumulateShifted: čistá funkce — nemutuje vstupní acc ani next", () => {
  const acc: ShiftedSnapshots = { before: [pos({ id: 1, updatedAt: "a1" })], after: [pos({ id: 1, updatedAt: "a2" })] };
  const next: ShiftedSnapshots = { before: [pos({ id: 1, updatedAt: "a2" })], after: [pos({ id: 1, updatedAt: "a3" })] };
  const accBeforeLen = acc.before.length;
  const nextBeforeLen = next.before.length;
  accumulateShifted(acc, next);
  assert.equal(acc.before.length, accBeforeLen, "acc.before se nesmí zmenšit ani zvětšit");
  assert.equal(acc.after[0].updatedAt, "a2", "acc.after se nesmí přepsat");
  assert.equal(next.before.length, nextBeforeLen);
});

// ─── excludeShiftedTargeted ───────────────────────────────────────────────

test("excludeShiftedTargeted: prázdná množina cílů — shifted projde beze změny", () => {
  const shifted: ShiftedSnapshots = {
    before: [pos({ id: 9, updatedAt: "s1" })],
    after: [pos({ id: 9, updatedAt: "s2" })],
  };
  const result = excludeShiftedTargeted(shifted, new Set());
  assert.deepEqual(result, shifted);
});

test("excludeShiftedTargeted: id odsunutého souseda JE mezi cíli — vyřadí se z before i after", () => {
  const shifted: ShiftedSnapshots = {
    before: [pos({ id: 9, updatedAt: "s1" })],
    after: [pos({ id: 9, updatedAt: "s2" })],
  };
  const result = excludeShiftedTargeted(shifted, new Set([9]));
  assert.deepEqual(result.before, []);
  assert.deepEqual(result.after, []);
});

test("excludeShiftedTargeted: id odsunutého souseda NENÍ mezi cíli — zůstane beze změny", () => {
  const shifted: ShiftedSnapshots = {
    before: [pos({ id: 9, updatedAt: "s1" })],
    after: [pos({ id: 9, updatedAt: "s2" })],
  };
  const result = excludeShiftedTargeted(shifted, new Set([99]));
  assert.deepEqual(result, shifted);
});

test("excludeShiftedTargeted: víc odsunutých sousedů, jen ČÁST je mezi cíli — before/after zůstanou zarovnané podle id", () => {
  const shifted: ShiftedSnapshots = {
    before: [pos({ id: 9, updatedAt: "s1" }), pos({ id: 10, updatedAt: "t1" }), pos({ id: 11, updatedAt: "u1" })],
    after: [pos({ id: 9, updatedAt: "s2" }), pos({ id: 10, updatedAt: "t2" }), pos({ id: 11, updatedAt: "u2" })],
  };
  const result = excludeShiftedTargeted(shifted, new Set([10]));
  assert.deepEqual(result.before.map((b) => b.id), [9, 11]);
  assert.deepEqual(result.after.map((b) => b.id), [9, 11], "after musí zůstat zarovnané se before podle id, ne jen podle indexu");
});

test("excludeShiftedTargeted: čistá funkce — nemutuje vstupní shifted", () => {
  const shifted: ShiftedSnapshots = {
    before: [pos({ id: 9, updatedAt: "s1" })],
    after: [pos({ id: 9, updatedAt: "s2" })],
  };
  excludeShiftedTargeted(shifted, new Set([9]));
  assert.equal(shifted.before.length, 1, "vstupní pole se nesmí zkrátit");
});

// ─── Scénář z reálného plánu: dvě instance série na jednom stroji za sebou ──
// (zadání opravy handleSaveAll, atomické undo etapa A, 6. 8. 2026) — plánovač uloží
// „Celou sérii", blok 1 a blok 2 stojí na stejném stroji těsně za sebou. PUT bloku 1
// ho chain pushem odsune (posune blok 2 dál), ale blok 2 je TAKÉ člen ukládané série
// a dostane VLASTNÍ PUT o pár iterací dál ve stejné smyčce handleSaveAll — je tedy
// zároveň v `saveBefore` (vlastní cíl) i, bez filtru, v odsunutých sousedech.
// `sanitizeUndoOps` (src/lib/undoApply.server.ts) by takovou dávku odmítla (400,
// "je v dávce vícekrát") a Ctrl+Z by selhal ÚPLNĚ — ne jen pro odsunutého souseda,
// ale pro celý krok historie včetně bloku 1.

test("integrace accumulateShifted + excludeShiftedTargeted: druhý člen série odsunutý PRVNÍM PUTem, ale i sám mezi cíli — po filtru NESMÍ zůstat v shifted", () => {
  // Simulace dvou iterací smyčky handleSaveAll nad ids = [1, 2].
  const saveBefore: EditSnapshot[] = [
    { id: 1, updatedAt: "a1", fields: { locked: false } },
    { id: 2, updatedAt: "b1", fields: { locked: false } }, // blok 2 má i VLASTNÍ PUT — je cíl
  ];

  // Iterace 1: PUT bloku 1 vrátí shifted = [blok 2 s NOVOU pozicí] (chain push).
  const shiftedFromPut1: ShiftedSnapshots = {
    before: [pos({ id: 2, updatedAt: "b1", startTime: "2026-09-02T08:00:00.000Z", endTime: "2026-09-02T10:00:00.000Z" })],
    after: [pos({ id: 2, updatedAt: "b2", startTime: "2026-09-02T08:30:00.000Z", endTime: "2026-09-02T10:30:00.000Z" })],
  };
  // Iterace 2: PUT bloku 2 (jeho vlastní editace) — v tomhle scénáři už dál nic neodsune.
  const shiftedFromPut2: ShiftedSnapshots = EMPTY;

  let saveShifted: ShiftedSnapshots = EMPTY;
  saveShifted = accumulateShifted(saveShifted, shiftedFromPut1);
  saveShifted = accumulateShifted(saveShifted, shiftedFromPut2);

  assert.equal(saveShifted.before.length, 1, "před filtrem je blok 2 v odsunutých (tak to server reálně pošle)");

  const targetIds = new Set(saveBefore.map((t) => t.id));
  const finalShifted = excludeShiftedTargeted(saveShifted, targetIds);

  assert.deepEqual(finalShifted.before, [], "blok 2 má vlastní cíl → nesmí zůstat v odsunutých, jinak sanitizeUndoOps dávku odmítne");
  assert.deepEqual(finalShifted.after, []);
});

test("integrace accumulateShifted + excludeShiftedTargeted: skutečný divák (mimo ukládanou sérii) filtrem PROJDE — nesmí se ztratit", () => {
  // Stejná dávka jako výš (ids = [1, 2]), ale chain push navíc odsune i blok 3,
  // který NENÍ členem ukládané série (žádný vlastní PUT, není v saveBefore).
  const saveBefore: EditSnapshot[] = [
    { id: 1, updatedAt: "a1", fields: { locked: false } },
    { id: 2, updatedAt: "b1", fields: { locked: false } },
  ];
  const shiftedFromPut1: ShiftedSnapshots = {
    before: [
      pos({ id: 2, updatedAt: "b1" }),
      pos({ id: 3, updatedAt: "c1", startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z" }),
    ],
    after: [
      pos({ id: 2, updatedAt: "b2" }),
      pos({ id: 3, updatedAt: "c2", startTime: "2026-09-02T10:30:00.000Z", endTime: "2026-09-02T12:30:00.000Z" }),
    ],
  };
  const saveShifted = accumulateShifted(EMPTY, shiftedFromPut1);
  const finalShifted = excludeShiftedTargeted(saveShifted, new Set(saveBefore.map((t) => t.id)));

  assert.deepEqual(finalShifted.before.map((b) => b.id), [3], "blok 2 vyřazen (má vlastní cíl), blok 3 zůstává");
  assert.deepEqual(finalShifted.after.map((b) => b.id), [3]);
  assert.equal(finalShifted.after[0].updatedAt, "c2");
});
