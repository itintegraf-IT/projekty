import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSplitPropagateAuditRows,
  SPLIT_PROPAGATE_AUDITED_FIELDS,
  type SplitPropagateSibling,
} from "@/lib/splitPropagateAudit";
import { SPLIT_SHARED_FIELDS } from "@/lib/splitSharedFields";
import { AUDITED_FIELDS } from "@/lib/auditedFields";

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
    siblings: [sibling({ id: 404, orderNumber: "5000", doprava: "PPL", expediceNote: "Křehké" })],
    sharedUpdate: { orderNumber: "5000", doprava: "Vlastní odvoz", expediceNote: "Křehké" },
  });
  // orderNumber a expediceNote beze změny → nepatří; doprava se změnilo → jediný řádek
  assert.deepEqual(rows, [
    { blockId: 404, orderNumber: "5000", field: "doprava", oldValue: "PPL", newValue: "Vlastní odvoz" },
  ]);
});

test("Fix round 1: pole mimo AUDITED_FIELDS (description, dataStatusId, barvyStatusLabel) se NEZAPÍŠE, i když se hodnota reálně změnila", () => {
  const rows = buildSplitPropagateAuditRows({
    siblings: [
      sibling({
        id: 88,
        orderNumber: "5000", // v průniku, ale beze změny (kontrola, že se filtr netýká TOHOTO důvodu)
        description: "Stará zakázka", // v SPLIT_SHARED_FIELDS, MIMO AUDITED_FIELDS
        dataStatusId: 3, // v SPLIT_SHARED_FIELDS, MIMO AUDITED_FIELDS (jen *Label se audituje)
        barvyStatusLabel: "Modrá", // v SPLIT_SHARED_FIELDS, ale barvy/lak nejsou v AUDITED_FIELDS vůbec
      }),
    ],
    sharedUpdate: {
      orderNumber: "5000",
      description: "Nová zakázka",
      dataStatusId: 9,
      barvyStatusLabel: "Červená",
    },
  });
  assert.deepEqual(rows, []);
});

test("Fix round 1: SPLIT_PROPAGATE_AUDITED_FIELDS je přesně průnik SPLIT_SHARED_FIELDS a AUDITED_FIELDS, spočítaný programově", () => {
  const auditedSet = new Set<string>(AUDITED_FIELDS);
  const expected = (SPLIT_SHARED_FIELDS as readonly string[]).filter((f) => auditedSet.has(f));
  // Přepočet ze dvou SKUTEČNÝCH zdrojů pravdy — chrání proti driftu, kdyby export
  // v splitPropagateAudit.ts sklouzl na ruční (a časem neaktuální) výčet.
  assert.deepEqual([...SPLIT_PROPAGATE_AUDITED_FIELDS], expected);
  assert.ok(SPLIT_PROPAGATE_AUDITED_FIELDS.length > 0, "průnik nesmí vyjít prázdný — jinak by SPLIT_PROPAGATE nikdy nic nezapsal");
  for (const field of SPLIT_PROPAGATE_AUDITED_FIELDS) {
    assert.ok((SPLIT_SHARED_FIELDS as readonly string[]).includes(field), `${field} musí být v SPLIT_SHARED_FIELDS`);
    assert.ok((AUDITED_FIELDS as readonly string[]).includes(field), `${field} musí být v AUDITED_FIELDS`);
  }
});

test("Fix round 1 tripwire: konkrétní obsah průniku (nové pole se sem přidává vědomě)", () => {
  assert.deepEqual([...SPLIT_PROPAGATE_AUDITED_FIELDS], [
    "orderNumber", "deadlineExpedice", "expediceNote", "doprava",
    "jobPresetLabel", "type", "blockVariant",
    "dataStatusLabel", "dataRequiredDate", "dataOk",
    "materialStatusLabel", "materialRequiredDate", "materialOk", "materialInStock", "materialIssued",
    "pantoneRequiredDate", "pantoneOk", "pantoneRequired",
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
