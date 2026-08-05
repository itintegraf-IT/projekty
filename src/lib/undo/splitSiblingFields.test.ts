import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSplitEditTargets } from "./splitSiblingFields";

const SHARED = ["orderNumber", "type"] as const;

test("buildSplitEditTargets: nesdílené pole — sourozenci se do cílů vůbec nezařadí", () => {
  // Scénář z review (I1): plánovač otevře část 1/3 rozdělené zakázky a zaškrtne jen
  // OBALKA — server ho na sourozence nikdy nepropaguje (není v SPLIT_SHARED_FIELDS),
  // takže sourozenci nemají v undo kroku co dělat.
  const { beforeTargets, afterTargets } = buildSplitEditTargets(
    ["obalka"], SHARED,
    { id: 1, updatedAt: "a1", obalka: false },
    { id: 1, updatedAt: "a2", obalka: true },
    [{ id: 2, updatedAt: "b1", obalka: false }],
    [{ id: 2, updatedAt: "b1", obalka: false }],
  );
  assert.equal(beforeTargets.length, 1, "žádný sourozenec v before");
  assert.equal(afterTargets.length, 1, "žádný sourozenec v after");
  assert.deepEqual(beforeTargets[0].fields, { obalka: false });
  assert.deepEqual(afterTargets[0].fields, { obalka: true });
});

test("buildSplitEditTargets: smíšená editace — primár nese VŠECHNA pole, sourozenec jen sdílený průnik", () => {
  const { beforeTargets, afterTargets } = buildSplitEditTargets(
    ["locked", "orderNumber"], SHARED,
    { id: 1, updatedAt: "a1", locked: false, orderNumber: "OLD" },
    { id: 1, updatedAt: "a2", locked: true, orderNumber: "NEW" },
    [{ id: 2, updatedAt: "b1", locked: false, orderNumber: "OLD" }],
    [{ id: 2, updatedAt: "b2", locked: false, orderNumber: "NEW" }],
  );
  assert.deepEqual(beforeTargets[0].fields, { locked: false, orderNumber: "OLD" }, "primár nese celý changedFields");
  assert.deepEqual(afterTargets[0].fields, { locked: true, orderNumber: "NEW" });
  assert.equal(beforeTargets.length, 2, "sourozenec se zařadí, protože orderNumber je sdílené");
  assert.equal(afterTargets.length, 2);
  assert.deepEqual(beforeTargets[1].fields, { orderNumber: "OLD" }, "sourozenec NEnese locked — server ho nikdy nepropaguje");
  assert.deepEqual(afterTargets[1].fields, { orderNumber: "NEW" });
});

test("buildSplitEditTargets: bez sourozenců funguje jako prostá editace primárního bloku", () => {
  const { beforeTargets, afterTargets } = buildSplitEditTargets(
    ["orderNumber"], SHARED,
    { id: 1, updatedAt: "a1", orderNumber: "OLD" },
    { id: 1, updatedAt: "a2", orderNumber: "NEW" },
    [], [],
  );
  assert.equal(beforeTargets.length, 1);
  assert.equal(afterTargets.length, 1);
});

test("buildSplitEditTargets: víc sourozenců — všichni dostanou stejný sdílený průnik, žádný se neztratí", () => {
  const { beforeTargets, afterTargets } = buildSplitEditTargets(
    ["type"], SHARED,
    { id: 1, updatedAt: "a1", type: "REZERVACE" },
    { id: 1, updatedAt: "a2", type: "ZAKAZKA" },
    [{ id: 2, updatedAt: "b1", type: "REZERVACE" }, { id: 3, updatedAt: "c1", type: "REZERVACE" }],
    [{ id: 2, updatedAt: "b2", type: "ZAKAZKA" }, { id: 3, updatedAt: "c2", type: "ZAKAZKA" }],
  );
  assert.equal(beforeTargets.length, 3);
  assert.equal(afterTargets.length, 3);
  assert.deepEqual(beforeTargets.map((t) => t.id), [1, 2, 3]);
  assert.deepEqual(afterTargets.map((t) => t.id), [1, 2, 3]);
});

// ─── symetrie siblingsOld/siblingsNew (review M3) ────────────────────────────
// Sourozenec bez páru na druhé straně nesmí rozjet beforeTargets/afterTargets na
// různou délku — jinak by expectedUpdatedAt cíle bez páru vyšlo undefined a
// buildMultiEditCommand by shodilo StaleUndoError i tu polovinu kroku, co byla v pořádku.

test("buildSplitEditTargets: sourozenec chybí v siblingsNew (jen v siblingsOld) — vypadne z OBOU stran", () => {
  const { beforeTargets, afterTargets } = buildSplitEditTargets(
    ["type"], SHARED,
    { id: 1, updatedAt: "a1", type: "REZERVACE" },
    { id: 1, updatedAt: "a2", type: "ZAKAZKA" },
    [{ id: 2, updatedAt: "b1", type: "REZERVACE" }, { id: 3, updatedAt: "c1", type: "REZERVACE" }], // 3 je jen tady
    [{ id: 2, updatedAt: "b2", type: "ZAKAZKA" }],
  );
  assert.equal(beforeTargets.length, 2, "primár + jen sourozenec 2 (3 nemá pár)");
  assert.equal(afterTargets.length, 2);
  assert.deepEqual(beforeTargets.map((t) => t.id), [1, 2]);
  assert.deepEqual(afterTargets.map((t) => t.id), [1, 2]);
});

test("buildSplitEditTargets: sourozenec chybí v siblingsOld (jen v siblingsNew) — vypadne z OBOU stran", () => {
  const { beforeTargets, afterTargets } = buildSplitEditTargets(
    ["type"], SHARED,
    { id: 1, updatedAt: "a1", type: "REZERVACE" },
    { id: 1, updatedAt: "a2", type: "ZAKAZKA" },
    [{ id: 2, updatedAt: "b1", type: "REZERVACE" }],
    [{ id: 2, updatedAt: "b2", type: "ZAKAZKA" }, { id: 3, updatedAt: "c2", type: "ZAKAZKA" }], // 3 je jen tady
  );
  assert.equal(beforeTargets.length, 2, "primár + jen sourozenec 2 (3 nemá pár)");
  assert.equal(afterTargets.length, 2);
  assert.deepEqual(beforeTargets.map((t) => t.id), [1, 2]);
  assert.deepEqual(afterTargets.map((t) => t.id), [1, 2]);
});
