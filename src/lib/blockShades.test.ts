import { test } from "node:test";
import assert from "node:assert/strict";
import { computeShadeParity, type ShadeBlockInput } from "./blockShades";

// Pomocník — minimální blok pro test parity odstínu.
function blk(over: Partial<ShadeBlockInput> & { id: number; startTime: string }): ShadeBlockInput {
  return {
    type: "ZAKAZKA",
    blockVariant: "STANDARD",
    splitGroupId: null,
    printCompletedAt: null,
    ...over,
  };
}

test("dvě různé zakázky za sebou → parita se překlopí 0 → 1", () => {
  const p = computeShadeParity([
    blk({ id: 1, startTime: "2026-06-03T06:00:00.000Z" }),
    blk({ id: 2, startTime: "2026-06-03T10:00:00.000Z" }),
  ]);
  assert.equal(p.get(1), 0);
  assert.equal(p.get(2), 1);
});

test("split (stejný splitGroupId) → oba kusy sdílí paritu; další zakázka se překlopí", () => {
  const p = computeShadeParity([
    blk({ id: 10, startTime: "2026-06-03T06:00:00.000Z" }),                        // zakázka A → 0
    blk({ id: 11, splitGroupId: 500, startTime: "2026-06-03T10:00:00.000Z" }),     // B, kus 1 (SplitGroup 500) → 1
    blk({ id: 12, splitGroupId: 500, startTime: "2026-06-03T14:00:00.000Z" }),     // B, kus 2 (sdílí SplitGroup 500) → 1
    blk({ id: 13, startTime: "2026-06-03T18:00:00.000Z" }),                        // zakázka C → 0
  ]);
  assert.equal(p.get(10), 0);
  assert.equal(p.get(11), 1);
  assert.equal(p.get(12), 1);
  assert.equal(p.get(13), 0);
});

test("B2: samostatný blok id=100 a split skupina splitGroupId=100 NEsdílí identitu (namespace g/b)", () => {
  // Regrese proti kolizi id-prostorů po přechodu na SplitGroup tabulku: Block.id a
  // SplitGroup.id jsou nezávislé sekvence, takže číselná shoda 100↔100 nesmí splynout.
  // Bez prefixu by orderIdentity vrátilo 100 pro oba → skupina by zdědila paritu 0
  // samostatného bloku (0,0,0). S prefixem `b100` ≠ `g100` → skupina se překlopí.
  const p = computeShadeParity([
    blk({ id: 100, startTime: "2026-06-03T06:00:00.000Z" }),                       // samostatná zakázka A → 0
    blk({ id: 201, splitGroupId: 100, startTime: "2026-06-03T10:00:00.000Z" }),    // SplitGroup 100, kus 1 → 1
    blk({ id: 202, splitGroupId: 100, startTime: "2026-06-03T14:00:00.000Z" }),    // SplitGroup 100, kus 2 → 1 (sdílí)
  ]);
  assert.equal(p.get(100), 0);
  assert.equal(p.get(201), 1);
  assert.equal(p.get(202), 1);
});

test("rezervace střídají nezávisle na zakázkách (per barevný bucket)", () => {
  const p = computeShadeParity([
    blk({ id: 1, type: "ZAKAZKA", startTime: "2026-06-03T06:00:00.000Z" }),
    blk({ id: 2, type: "REZERVACE", blockVariant: null, startTime: "2026-06-03T09:00:00.000Z" }),
    blk({ id: 3, type: "ZAKAZKA", startTime: "2026-06-03T12:00:00.000Z" }),
    blk({ id: 4, type: "REZERVACE", blockVariant: null, startTime: "2026-06-03T15:00:00.000Z" }),
  ]);
  // modrý bucket: 1 → 0, 3 → 1
  assert.equal(p.get(1), 0);
  assert.equal(p.get(3), 1);
  // fialový bucket počítá zvlášť: 2 → 0, 4 → 1
  assert.equal(p.get(2), 0);
  assert.equal(p.get(4), 1);
});

test("dokončený tisk se neúčastní — chybí v mapě a nespotřebuje krok parity", () => {
  const p = computeShadeParity([
    blk({ id: 1, startTime: "2026-06-03T06:00:00.000Z" }),                                        // A → 0
    blk({ id: 2, printCompletedAt: "2026-06-03T09:00:00.000Z", startTime: "2026-06-03T09:00:00.000Z" }), // hotový → skip
    blk({ id: 3, startTime: "2026-06-03T12:00:00.000Z" }),                                        // C → 1 (2. počítaná modrá)
  ]);
  assert.equal(p.get(1), 0);
  assert.equal(p.has(2), false);
  assert.equal(p.get(3), 1);
});

test("varianty ZAKAZKA se počítají jako samostatné buckety", () => {
  const p = computeShadeParity([
    blk({ id: 1, blockVariant: "STANDARD", startTime: "2026-06-03T06:00:00.000Z" }),
    blk({ id: 2, blockVariant: "BEZ_SACKU", startTime: "2026-06-03T09:00:00.000Z" }),
    blk({ id: 3, blockVariant: "STANDARD", startTime: "2026-06-03T12:00:00.000Z" }),
    blk({ id: 4, blockVariant: "BEZ_SACKU", startTime: "2026-06-03T15:00:00.000Z" }),
  ]);
  // STANDARD bucket: 1 → 0, 3 → 1
  assert.equal(p.get(1), 0);
  assert.equal(p.get(3), 1);
  // BEZ_SACKU bucket: 2 → 0, 4 → 1
  assert.equal(p.get(2), 0);
  assert.equal(p.get(4), 1);
});

test("neseřazený vstup se seřadí podle startTime → parita respektuje čas, ne pořadí v poli", () => {
  const p = computeShadeParity([
    blk({ id: 3, startTime: "2026-06-03T18:00:00.000Z" }),
    blk({ id: 1, startTime: "2026-06-03T06:00:00.000Z" }),
    blk({ id: 2, startTime: "2026-06-03T12:00:00.000Z" }),
  ]);
  assert.equal(p.get(1), 0);
  assert.equal(p.get(2), 1);
  assert.equal(p.get(3), 0);
});

test("tři různé zakázky za sebou → 0, 1, 0", () => {
  const p = computeShadeParity([
    blk({ id: 1, startTime: "2026-06-03T06:00:00.000Z" }),
    blk({ id: 2, startTime: "2026-06-03T10:00:00.000Z" }),
    blk({ id: 3, startTime: "2026-06-03T14:00:00.000Z" }),
  ]);
  assert.equal(p.get(1), 0);
  assert.equal(p.get(2), 1);
  assert.equal(p.get(3), 0);
});

test("prázdný vstup → prázdná mapa", () => {
  assert.equal(computeShadeParity([]).size, 0);
});
