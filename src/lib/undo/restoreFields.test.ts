import { test } from "node:test";
import assert from "node:assert/strict";
import { UNDO_RESTORABLE_FIELDS, isRestorableField, blockToRestoreFields } from "./restoreFields";

const FORBIDDEN = [
  "id", "createdAt", "updatedAt", "reservationId", "recurrenceParentId",
  "printCompletedAt", "printCompletedByUserId", "printCompletedByUsername",
];

test("allowlist neobsahuje žádné zakázané pole", () => {
  for (const f of FORBIDDEN) {
    assert.equal(UNDO_RESTORABLE_FIELDS.includes(f as never), false, `${f} nesmí být obnovitelné`);
  }
});

test("allowlist má přesně 43 položek (tripwire — nové pole Blocku se přidává vědomě)", () => {
  assert.equal(UNDO_RESTORABLE_FIELDS.length, 43);
  assert.equal(new Set(UNDO_RESTORABLE_FIELDS).size, 43, "duplicita v allowlistu");
});

test("isRestorableField pouští povolená a blokuje zakázaná", () => {
  assert.equal(isRestorableField("startTime"), true);
  assert.equal(isRestorableField("scheduleBypassed"), true);
  assert.equal(isRestorableField("printCompletedAt"), false);
  assert.equal(isRestorableField("neexistujiciSloupec"), false);
});

test("blockToRestoreFields vrátí jen povolená pole a zahodí zbytek", () => {
  const fields = blockToRestoreFields({
    id: 7,
    orderNumber: "17300",
    machine: "XL_105",
    startTime: "2026-09-02T04:00:00.000Z",
    endTime: "2026-09-02T06:00:00.000Z",
    type: "ZAKAZKA",
    printMinutes: 120,
    scheduleBypassed: false,
    dataOk: true,
    specifikace: "Lak jen na obálce",
    printCompletedAt: "2026-09-01T10:00:00.000Z",
    reservationId: 18,
    updatedAt: "2026-09-01T10:00:00.000Z",
  } as never);
  assert.equal(fields.orderNumber, "17300");
  assert.equal(fields.dataOk, true, "dataOk se obnovuje přímo, ne odvozením");
  assert.equal("id" in fields, false);
  assert.equal("printCompletedAt" in fields, false);
  assert.equal("reservationId" in fields, false);
  assert.equal("updatedAt" in fields, false);
});
