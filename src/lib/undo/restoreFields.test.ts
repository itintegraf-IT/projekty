import { test } from "node:test";
import assert from "node:assert/strict";
import { UNDO_RESTORABLE_FIELDS, isRestorableField, blockToRestoreFields } from "./restoreFields";

const FORBIDDEN = [
  "id", "createdAt", "updatedAt", "reservationId", "recurrenceParentId",
  "printCompletedAt", "printCompletedByUserId", "printCompletedByUsername",
];

/**
 * Fixture se VŠEMI 45 povoleným poli na rozlišitelných hodnotách + 8 zakázaných.
 * Když blockToRestoreFields nějaké povolené pole ztratí, deepEqual selže s názvem pole.
 * Zakázaná pole jsou v fixtuře jen aby se ověřila jejich filtrace.
 */
const FULL_BLOCK = {
  // pozice a tiskové hodiny
  machine: "XL_105",
  startTime: "2026-09-02T04:00:00.000Z",
  endTime: "2026-09-02T06:00:00.000Z",
  printMinutes: 120,
  scheduleBypassed: false,
  // identita
  orderNumber: "17300",
  type: "ZAKAZKA",
  blockVariant: "BEZ_TECHNOLOGIE",
  locked: true,
  splitGroupId: 9,
  recurrenceType: "NONE",
  // popis a preset
  description: "Etikety jogurt",
  jobPresetId: 7,
  jobPresetLabel: "Standard IML",
  specifikace: "Lak jen na obálce",
  // DATA
  dataStatusId: 2,
  dataStatusLabel: "Dodána",
  dataRequiredDate: "2026-09-01T00:00:00.000Z",
  dataOk: true,
  // MATERIÁL
  materialStatusId: 3,
  materialStatusLabel: "Na skladě",
  materialRequiredDate: "2026-09-01T00:00:00.000Z",
  materialOk: true,
  materialNote: "Fólie od dodavatele X",
  materialNoteByUsername: "mtz_user",
  materialInStock: true,
  materialIssued: false,
  // PANTONE
  pantoneRequired: true,
  pantoneOk: false,
  pantoneRequiredDate: "2026-08-31T00:00:00.000Z",
  pantoneInStock: true,
  pantoneIssued: false,
  // barvy / lak
  barvyStatusId: 4,
  barvyStatusLabel: "Pantone 485",
  lakStatusId: 5,
  lakStatusLabel: "Mat",
  // výrobní štítky
  obalka: true,
  vnitrky: true,
  tiskoveArchy: "12",
  serie: "A",
  // expedice
  deadlineExpedice: "2026-09-10T00:00:00.000Z",
  doprava: "ZÁSILKOVNA",
  expediceNote: "Poslat do Brna",
  expeditionPublishedAt: "2026-09-01T10:00:00.000Z",
  expeditionSortOrder: 1,
  // zakázaná pole (filtrují se)
  id: 7,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  reservationId: 18,
  recurrenceParentId: 5,
  printCompletedAt: "2026-09-01T10:00:00.000Z",
  printCompletedByUserId: 99,
  printCompletedByUsername: "tiskarna_user",
} as never;

test("allowlist neobsahuje žádné zakázané pole", () => {
  for (const f of FORBIDDEN) {
    assert.equal(UNDO_RESTORABLE_FIELDS.includes(f as never), false, `${f} nesmí být obnovitelné`);
  }
});

test("allowlist má přesně 45 položek (tripwire — nové pole Blocku se přidává vědomě)", () => {
  assert.equal(UNDO_RESTORABLE_FIELDS.length, 45);
  assert.equal(new Set(UNDO_RESTORABLE_FIELDS).size, 45, "duplicita v allowlistu");
});

test("isRestorableField pouští všechna povolená a blokuje zakázaná", () => {
  // Reprezentativní vzorek povolených
  assert.equal(isRestorableField("startTime"), true);
  assert.equal(isRestorableField("scheduleBypassed"), true);
  assert.equal(isRestorableField("materialOk"), true);
  assert.equal(isRestorableField("pantoneRequiredDate"), true);
  // Reprezentativní vzorek zakázaných
  assert.equal(isRestorableField("printCompletedAt"), false);
  assert.equal(isRestorableField("reservationId"), false);
  assert.equal(isRestorableField("recurrenceParentId"), false);
  assert.equal(isRestorableField("neexistujiciSloupec"), false);
});

test("field-inventory: blockToRestoreFields vrátí všech 45 povolených polí (tripwire)", () => {
  const restored = blockToRestoreFields(FULL_BLOCK);
  assert.deepEqual(restored, {
    // pozice a tiskové hodiny
    machine: "XL_105",
    startTime: "2026-09-02T04:00:00.000Z",
    endTime: "2026-09-02T06:00:00.000Z",
    printMinutes: 120,
    scheduleBypassed: false,
    // identita
    orderNumber: "17300",
    type: "ZAKAZKA",
    blockVariant: "BEZ_TECHNOLOGIE",
    locked: true,
    splitGroupId: 9,
    recurrenceType: "NONE",
    // popis a preset
    description: "Etikety jogurt",
    jobPresetId: 7,
    jobPresetLabel: "Standard IML",
    specifikace: "Lak jen na obálce",
    // DATA
    dataStatusId: 2,
    dataStatusLabel: "Dodána",
    dataRequiredDate: "2026-09-01T00:00:00.000Z",
    dataOk: true,
    // MATERIÁL
    materialStatusId: 3,
    materialStatusLabel: "Na skladě",
    materialRequiredDate: "2026-09-01T00:00:00.000Z",
    materialOk: true,
    materialNote: "Fólie od dodavatele X",
    materialNoteByUsername: "mtz_user",
    materialInStock: true,
    materialIssued: false,
    // PANTONE
    pantoneRequired: true,
    pantoneOk: false,
    pantoneRequiredDate: "2026-08-31T00:00:00.000Z",
    pantoneInStock: true,
    pantoneIssued: false,
    // barvy / lak
    barvyStatusId: 4,
    barvyStatusLabel: "Pantone 485",
    lakStatusId: 5,
    lakStatusLabel: "Mat",
    // výrobní štítky
    obalka: true,
    vnitrky: true,
    tiskoveArchy: "12",
    serie: "A",
    // expedice
    deadlineExpedice: "2026-09-10T00:00:00.000Z",
    doprava: "ZÁSILKOVNA",
    expediceNote: "Poslat do Brna",
    expeditionPublishedAt: "2026-09-01T10:00:00.000Z",
    expeditionSortOrder: 1,
  });
});

test("zakázaná pole se filtrují (id, createdAt, updatedAt, potvrzení tisku, reservationId, recurrenceParentId)", () => {
  const restored = blockToRestoreFields(FULL_BLOCK);
  assert.equal("id" in restored, false);
  assert.equal("createdAt" in restored, false);
  assert.equal("updatedAt" in restored, false);
  assert.equal("printCompletedAt" in restored, false);
  assert.equal("printCompletedByUserId" in restored, false);
  assert.equal("printCompletedByUsername" in restored, false);
  assert.equal("reservationId" in restored, false);
  assert.equal("recurrenceParentId" in restored, false);
});
