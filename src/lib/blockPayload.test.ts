import { test } from "node:test";
import assert from "node:assert/strict";
import { blockToCreatePayload, EXPECTED_PAYLOAD_KEYS, type BlockPayloadSource } from "./blockPayload";

/**
 * Fixture se VŠEMI poli na rozlišitelných non-default hodnotách.
 * Když blockToCreatePayload nějaké pole ztratí, deepEqual selže s názvem pole.
 */
const FULL_BLOCK: BlockPayloadSource = {
  orderNumber: "24123",
  machine: "XL_105",
  startTime: "2026-07-10T06:00:00.000Z",
  endTime: "2026-07-10T09:00:00.000Z",
  type: "ZAKAZKA",
  blockVariant: "BEZ_TECHNOLOGIE",
  description: "Etikety jogurt",
  locked: true,
  printMinutes: 150,
  deadlineExpedice: "2026-07-15",
  jobPresetId: 7,
  dataStatusId: 2,
  dataStatusLabel: "Dodána",
  dataRequiredDate: "2026-07-08",
  materialStatusId: 3,
  materialStatusLabel: "Na skladě",
  materialRequiredDate: "2026-07-09",
  materialOk: true,
  barvyStatusId: 4,
  barvyStatusLabel: "Pantone 485",
  lakStatusId: 5,
  lakStatusLabel: "Mat",
  specifikace: "IML 5×0,5",
  materialNote: "Fólie od dodavatele X",
  obalka: true,
  vnitrky: true,
  tiskoveArchy: "12",
  serie: "A",
  pantoneRequiredDate: "2026-07-07",
  pantoneOk: true,
  pantoneRequired: true,
  materialInStock: true,
  materialIssued: true,
  materialPartiallyIssued: true,
  pantoneInStock: true,
  pantoneIssued: false,
};

test("field-inventory: ZAKAZKA payload obsahuje všechna pole 1:1 (tripwire)", () => {
  const payload = blockToCreatePayload(FULL_BLOCK);
  assert.deepEqual(payload, {
    orderNumber: "24123",
    machine: "XL_105",
    startTime: "2026-07-10T06:00:00.000Z",
    endTime: "2026-07-10T09:00:00.000Z",
    type: "ZAKAZKA",
    blockVariant: "BEZ_TECHNOLOGIE",
    description: "Etikety jogurt",
    locked: true,
    deadlineExpedice: "2026-07-15",
    jobPresetId: 7,
    dataStatusId: 2,
    dataStatusLabel: "Dodána",
    dataRequiredDate: "2026-07-08",
    materialStatusId: 3,
    materialStatusLabel: "Na skladě",
    materialRequiredDate: "2026-07-09",
    materialOk: true,
    barvyStatusId: 4,
    barvyStatusLabel: "Pantone 485",
    lakStatusId: 5,
    lakStatusLabel: "Mat",
    specifikace: "IML 5×0,5",
    materialNote: "Fólie od dodavatele X",
    obalka: true,
    vnitrky: true,
    tiskoveArchy: "12",
    serie: "A",
    pantoneRequiredDate: "2026-07-07",
    pantoneOk: true,
    pantoneRequired: true,
    materialInStock: true,
    materialIssued: true,
    materialPartiallyIssued: true,
    pantoneInStock: true,
    pantoneIssued: false,
    recurrenceType: "NONE",
    printMinutes: 150,
  });
});

test("EXPECTED_PAYLOAD_KEYS: klíče payloadu přesně odpovídají kanonickému seznamu (nové pole Blocku se přidává vědomě)", () => {
  const payload = blockToCreatePayload(FULL_BLOCK);
  assert.deepEqual(
    Object.keys(payload).sort(),
    [...EXPECTED_PAYLOAD_KEYS, "printMinutes"].sort(),
  );
});

test("ne-ZAKAZKA: printMinutes se neposílá, klíče = kanonický seznam", () => {
  const udrzba: BlockPayloadSource = { ...FULL_BLOCK, type: "UDRZBA", printMinutes: null };
  const payload = blockToCreatePayload(udrzba);
  assert.equal("printMinutes" in payload, false);
  assert.deepEqual(Object.keys(payload).sort(), [...EXPECTED_PAYLOAD_KEYS].sort());
});

test("regrese #2: Pantone / SKLADEM / materialNote se NIKDY neztrácí", () => {
  const payload = blockToCreatePayload(FULL_BLOCK);
  assert.equal(payload.pantoneRequiredDate, "2026-07-07");
  assert.equal(payload.pantoneOk, true);
  assert.equal(payload.pantoneRequired, true);
  assert.equal(payload.materialInStock, true);
  assert.equal(payload.materialIssued, true);
  assert.equal(payload.materialNote, "Fólie od dodavatele X");
});

test("blockToCreatePayload doplní pantoneInStock i pantoneIssued jako false, když je zdroj nemá", () => {
  // Zdrojový objekt pantoneInStock/pantoneIssued VYNECHÁVÁ — obě pole jsou v
  // BlockPayloadSource volitelná, takže tohle zároveň ověřuje výchozí `?? false`,
  // ne jen prosté prokopírování hodnoty ze zdroje.
  const zdroj: BlockPayloadSource = {
    orderNumber: "25-9001",
    machine: "XL_106",
    startTime: "2026-08-11T06:00:00.000Z",
    endTime: "2026-08-11T09:00:00.000Z",
    type: "ZAKAZKA",
    description: null,
    locked: false,
    deadlineExpedice: null,
    jobPresetId: null,
    dataStatusId: null,
    dataStatusLabel: null,
    dataRequiredDate: null,
    materialStatusId: null,
    materialStatusLabel: null,
    materialRequiredDate: null,
    materialOk: false,
    barvyStatusId: null,
    barvyStatusLabel: null,
    lakStatusId: null,
    lakStatusLabel: null,
    specifikace: null,
  };
  const payload = blockToCreatePayload(zdroj);
  assert.equal(payload.pantoneInStock, false);
  assert.equal(payload.pantoneIssued, false);
});

test("split undo: opts.splitGroupId protáhne skupinu do payloadu (blok se vrátí do skupiny → 3/3)", () => {
  const payload = blockToCreatePayload(FULL_BLOCK, { splitGroupId: 42 });
  assert.equal(payload.splitGroupId, 42);
});

test("paste/kopie: bez opts se splitGroupId NEPOSÍLÁ (nový nezávislý blok, nedědí skupinu)", () => {
  const payload = blockToCreatePayload(FULL_BLOCK);
  assert.equal("splitGroupId" in payload, false);
});

test("split undo standalone: opts.splitGroupId=null se pošle jako null (no-op na serveru)", () => {
  const payload = blockToCreatePayload(FULL_BLOCK, { splitGroupId: null });
  assert.equal("splitGroupId" in payload, true);
  assert.equal(payload.splitGroupId, null);
});

test("B2: undo posílá splitGroupId bezpodmínečně (SplitGroup řádek přežije deleci → root i leaf zpět do skupiny)", () => {
  // Po B2 už splitGroupId není self-FK na Block.id, ale FK na stabilní SplitGroup.id,
  // který smazání kteréhokoli člena (i kořene) přežije. Undo tedy posílá splitGroupId
  // vždy — restoreSplitGroupId gymnastika (ROOT → undefined) zanikla.
  assert.equal(blockToCreatePayload(FULL_BLOCK, { splitGroupId: 100 }).splitGroupId, 100);
  const standalone = blockToCreatePayload({ ...FULL_BLOCK }, { splitGroupId: null });
  assert.equal(standalone.splitGroupId, null);
});

test("opts undo (bez opts): původní pozice, stroj i locked zůstávají", () => {
  const payload = blockToCreatePayload(FULL_BLOCK);
  assert.equal(payload.machine, "XL_105");
  assert.equal(payload.startTime, "2026-07-10T06:00:00.000Z");
  assert.equal(payload.endTime, "2026-07-10T09:00:00.000Z");
  assert.equal(payload.locked, true);
});

test("opts paste: override machine/startTime/endTime + locked: false, ostatní pole beze změny", () => {
  const payload = blockToCreatePayload(FULL_BLOCK, {
    machine: "XL_106",
    startTime: "2026-07-11T10:00:00.000Z",
    endTime: "2026-07-11T13:00:00.000Z",
    locked: false,
  });
  assert.equal(payload.machine, "XL_106");
  assert.equal(payload.startTime, "2026-07-11T10:00:00.000Z");
  assert.equal(payload.endTime, "2026-07-11T13:00:00.000Z");
  assert.equal(payload.locked, false);
  // věcná pole nedotčena
  assert.equal(payload.pantoneOk, true);
  assert.equal(payload.materialInStock, true);
  assert.equal(payload.obalka, true);
  assert.equal(payload.printMinutes, 150);
});

test("recurrenceType je vždy NONE — payload vytváří samostatný blok (kopie nedědí sérii)", () => {
  const seriovy: BlockPayloadSource = { ...FULL_BLOCK, recurrenceType: "DAILY" };
  const payload = blockToCreatePayload(seriovy);
  assert.equal(payload.recurrenceType, "NONE");
});

test("legacy ZAKAZKA bez printMinutes: fallback z elapsed zarovnaný na 30 min", () => {
  const legacy: BlockPayloadSource = { ...FULL_BLOCK, printMinutes: null };
  const payload = blockToCreatePayload(legacy);
  assert.equal(payload.printMinutes, 180); // 3 h elapsed
});

test("defenzivní defaulty: chybějící volitelná pole → false/null, ne undefined", () => {
  const minimal: BlockPayloadSource = {
    orderNumber: "99",
    machine: "XL_106",
    startTime: "2026-07-10T06:00:00.000Z",
    endTime: "2026-07-10T07:00:00.000Z",
    type: "ZAKAZKA",
    blockVariant: "STANDARD",
    description: null,
    locked: false,
    printMinutes: 60,
    deadlineExpedice: null,
    jobPresetId: null,
    dataStatusId: null,
    dataStatusLabel: null,
    dataRequiredDate: null,
    materialStatusId: null,
    materialStatusLabel: null,
    materialRequiredDate: null,
    materialOk: false,
    barvyStatusId: null,
    barvyStatusLabel: null,
    lakStatusId: null,
    lakStatusLabel: null,
    specifikace: null,
  };
  const payload = blockToCreatePayload(minimal);
  assert.equal(payload.materialNote, null);
  assert.equal(payload.obalka, false);
  assert.equal(payload.vnitrky, false);
  assert.equal(payload.tiskoveArchy, null);
  assert.equal(payload.serie, null);
  assert.equal(payload.pantoneRequiredDate, null);
  assert.equal(payload.pantoneOk, false);
  assert.equal(payload.pantoneRequired, false);
  assert.equal(payload.materialInStock, false);
  assert.equal(payload.materialIssued, false);
  for (const [k, v] of Object.entries(payload)) {
    assert.notEqual(v, undefined, `pole ${k} nesmí být undefined`);
  }
});
