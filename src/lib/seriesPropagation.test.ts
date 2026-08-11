import assert from "node:assert/strict";
import test from "node:test";
import { SERIES_EXCLUDED_FIELDS, stripSeriesPropagatedFields } from "./seriesPropagation";

test("SERIES_EXCLUDED_FIELDS obsahuje právě 16 očekávaných polí", () => {
  assert.deepEqual([...SERIES_EXCLUDED_FIELDS], [
    "dataRequiredDate",
    "deadlineExpedice",
    "materialRequiredDate",
    "pantoneRequiredDate",
    "dataOk",
    "materialOk",
    "pantoneOk",
    "materialIssued",
    "materialInStock",
    "pantoneRequired",
    "pantoneInStock",
    "pantoneIssued",
    "obalka",
    "vnitrky",
    "tiskoveArchy",
    "serie",
  ]);
});

test("stripSeriesPropagatedFields odstraní per-occurrence pole (SERIES_EXCLUDED_FIELDS má 16 položek)", () => {
  const payload = {
    orderNumber: "12345",
    dataRequiredDate: "2026-06-24",
    deadlineExpedice: "2026-07-01",
    materialRequiredDate: "2026-06-20",
    pantoneRequiredDate: "2026-06-22",
    dataOk: true,
    materialOk: true,
    pantoneOk: false,
    materialIssued: true,
    materialInStock: false,
    pantoneRequired: true,
  };
  const result = stripSeriesPropagatedFields(payload);
  assert.deepEqual(result, { orderNumber: "12345" });
});

test("stripSeriesPropagatedFields zachová všechna sdílená pole z buildPayload", () => {
  const payload = {
    orderNumber: "12345",
    type: "ZAKAZKA",
    blockVariant: "STANDARD",
    description: "popis",
    locked: false,
    specifikace: "spec",
    jobPresetId: 3,
    jobPresetLabel: "Preset A",
    dataStatusId: 1,
    dataStatusLabel: "OK",
    materialStatusId: 7,
    materialStatusLabel: "ROLE",
    materialNote: "note",
    barvyStatusId: 2,
    barvyStatusLabel: "CMYK",
    lakStatusId: null,
    lakStatusLabel: null,
    endTime: "2026-06-30T14:00:00.000Z",
  };
  const result = stripSeriesPropagatedFields(payload);
  assert.deepEqual(result, payload);
});

test("stripSeriesPropagatedFields nemutuje vstupní objekt", () => {
  const payload = {
    orderNumber: "12345",
    dataRequiredDate: "2026-06-24",
    deadlineExpedice: "2026-07-01",
    materialOk: true,
  };
  const snapshot = JSON.stringify(payload);
  stripSeriesPropagatedFields(payload);
  assert.equal(JSON.stringify(payload), snapshot);
});

test("stripSeriesPropagatedFields funguje na prázdném objektu", () => {
  const result = stripSeriesPropagatedFields({});
  assert.deepEqual(result, {});
});

test("stripSeriesPropagatedFields odstraní pole i s falsy hodnotami", () => {
  const payload = {
    orderNumber: "12345",
    dataRequiredDate: null,
    deadlineExpedice: "",
    materialOk: false,
    pantoneRequired: false,
    materialInStock: 0 as unknown,
  };
  const result = stripSeriesPropagatedFields(payload);
  assert.deepEqual(result, { orderNumber: "12345" });
});
