import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSplitPropagateAuditRows, type SplitPropagateSibling } from "@/lib/splitPropagateAudit";

function sibling(over: Partial<SplitPropagateSibling> = {}): SplitPropagateSibling {
  return { id: 101, orderNumber: "5000", ...over };
}

test("prázdný seznam sourozenců → žádné řádky", () => {
  const rows = buildSplitPropagateAuditRows({ siblings: [], sharedUpdate: { orderNumber: "17300" } });
  assert.deepEqual(rows, []);
});

test("prázdné sharedUpdate → žádné řádky (i když sourozenci existují)", () => {
  const rows = buildSplitPropagateAuditRows({ siblings: [sibling()], sharedUpdate: {} });
  assert.deepEqual(rows, []);
});

test("reálný scénář ze zadání: překlopení REZERVACE→ZAKAZKA propaguje orderNumber sourozenci", () => {
  const rows = buildSplitPropagateAuditRows({
    siblings: [sibling({ id: 202, orderNumber: "TEST-P8-REZ" })],
    sharedUpdate: { orderNumber: "17300" },
  });
  assert.deepEqual(rows, [
    { blockId: 202, orderNumber: "TEST-P8-REZ", field: "orderNumber", oldValue: "TEST-P8-REZ", newValue: "17300" },
  ]);
});

test("sourozenec, který cílovou hodnotu už má, řádek nedostane (idempotence)", () => {
  const rows = buildSplitPropagateAuditRows({
    siblings: [sibling({ id: 303, orderNumber: "17300" })],
    sharedUpdate: { orderNumber: "17300" },
  });
  assert.deepEqual(rows, []);
});

test("z více polí ve sharedUpdate se zapíší jen ta, co se sourozenci reálně změnila", () => {
  const rows = buildSplitPropagateAuditRows({
    siblings: [sibling({ id: 404, orderNumber: "5000", description: "Stará zakázka", specifikace: "Lesk" })],
    sharedUpdate: { orderNumber: "5000", description: "Nová zakázka", specifikace: "Lesk" },
  });
  // orderNumber a specifikace beze změny → nepatří; description se změnilo → jediný řádek
  assert.deepEqual(rows, [
    { blockId: 404, orderNumber: "5000", field: "description", oldValue: "Stará zakázka", newValue: "Nová zakázka" },
  ]);
});

test("víc sourozenců — každý dostane vlastní řádky se svým blockId/orderNumber, nezávisle na ostatních", () => {
  const rows = buildSplitPropagateAuditRows({
    siblings: [
      sibling({ id: 11, orderNumber: "A1", doprava: "Vlastní odvoz" }),
      sibling({ id: 12, orderNumber: "A2", doprava: "PPL" }), // už cílovou hodnotu má
    ],
    sharedUpdate: { doprava: "PPL" },
  });
  assert.deepEqual(rows, [
    { blockId: 11, orderNumber: "A1", field: "doprava", oldValue: "Vlastní odvoz", newValue: "PPL" },
  ]);
});

test("null → hodnota se serializuje na prázdný string na straně staré hodnoty", () => {
  const rows = buildSplitPropagateAuditRows({
    siblings: [sibling({ id: 55, expediceNote: null })],
    sharedUpdate: { expediceNote: "Křehké, opatrně" },
  });
  assert.deepEqual(rows, [
    { blockId: 55, orderNumber: "5000", field: "expediceNote", oldValue: "", newValue: "Křehké, opatrně" },
  ]);
});

test("hodnota → null se serializuje na prázdný string na straně nové hodnoty", () => {
  const rows = buildSplitPropagateAuditRows({
    siblings: [sibling({ id: 56, expediceNote: "Křehké, opatrně" })],
    sharedUpdate: { expediceNote: null },
  });
  assert.deepEqual(rows, [
    { blockId: 56, orderNumber: "5000", field: "expediceNote", oldValue: "Křehké, opatrně", newValue: "" },
  ]);
});

test("Date pole (deadlineExpedice) se porovnává hodnotou, ne referencí — beze změny nevznikne řádek", () => {
  const rows = buildSplitPropagateAuditRows({
    siblings: [sibling({ id: 77, deadlineExpedice: new Date("2026-09-02T00:00:00.000Z") })],
    sharedUpdate: { deadlineExpedice: new Date("2026-09-02T00:00:00.000Z") },
  });
  assert.deepEqual(rows, []);
});

test("Date pole (deadlineExpedice) se skutečnou změnou vytvoří řádek s civilním datem", () => {
  const rows = buildSplitPropagateAuditRows({
    siblings: [sibling({ id: 78, deadlineExpedice: new Date("2026-09-02T00:00:00.000Z") })],
    sharedUpdate: { deadlineExpedice: new Date("2026-09-05T00:00:00.000Z") },
  });
  assert.deepEqual(rows, [
    { blockId: 78, orderNumber: "5000", field: "deadlineExpedice", oldValue: "2026-09-02", newValue: "2026-09-05" },
  ]);
});

test("řádek nenese action/userId/username — ty doplňuje volající (parita s buildBatchAuditRows)", () => {
  const rows = buildSplitPropagateAuditRows({
    siblings: [sibling({ id: 99, orderNumber: "X" })],
    sharedUpdate: { orderNumber: "Y" },
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["blockId", "field", "newValue", "oldValue", "orderNumber"]);
});
