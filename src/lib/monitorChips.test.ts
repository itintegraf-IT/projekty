import test from "node:test";
import assert from "node:assert/strict";
import { buildMonitorChips } from "./monitorChips.js";
import type { Block } from "../app/_components/TimelineGrid.js";

function mk(over: Partial<Block> = {}): Block {
  return {
    id: 1,
    machine: "XL_106",
    orderNumber: "25-2418",
    type: "ZAKAZKA",
    startTime: "2026-08-10T06:00:00.000Z",
    endTime: "2026-08-10T09:00:00.000Z",
    printCompletedAt: null,
    blockVariant: "STANDARD",
    locked: false,
    dataStatusLabel: null,
    dataOk: false,
    materialStatusLabel: null,
    materialOk: false,
    materialInStock: false,
    materialIssued: false,
    pantoneRequired: false,
    pantoneRequiredDate: null,
    pantoneOk: false,
    specifikace: null,
    ...over,
  } as Block;
}

test("buildMonitorChips: prázdná zakázka nemá jediný chip", () => {
  assert.deepEqual(buildMonitorChips(mk()), []);
});

test("buildMonitorChips: pořadí je obálka → vnitřky → archy → série → data → materiál → pantone → varianta", () => {
  const chips = buildMonitorChips(mk({
    obalka: true,
    vnitrky: true,
    tiskoveArchy: "3 archy",
    serie: "2. série",
    dataStatusLabel: "Data OK",
    dataOk: true,
    materialStatusLabel: "Skladem",
    materialInStock: true,
    pantoneOk: true,
    blockVariant: "POZASTAVENO",
  }));
  assert.deepEqual(chips.map((c) => c.label), [
    "OBÁLKA", "VNITŘKY", "3 archy", "2. série", "Data OK", "Skladem", "PANTONE", "Pozastaveno",
  ]);
});

test("buildMonitorChips: materiál je připravený i když je jen vydaný (nález I5)", () => {
  const issued = buildMonitorChips(mk({ materialStatusLabel: "Vydáno", materialIssued: true }));
  assert.equal(issued[0].tone, "ok");

  const stock = buildMonitorChips(mk({ materialStatusLabel: "Skladem", materialInStock: true }));
  assert.equal(stock[0].tone, "ok");

  const confirmed = buildMonitorChips(mk({ materialStatusLabel: "Potvrzeno", materialOk: true }));
  assert.equal(confirmed[0].tone, "ok");
});

test("buildMonitorChips: materiál bez jediného příznaku připravenosti čeká", () => {
  const chips = buildMonitorChips(mk({ materialStatusLabel: "Archy objednány" }));
  assert.deepEqual(chips, [{ label: "Archy objednány", tone: "wait" }]);
});

test("buildMonitorChips: data bez potvrzení čekají", () => {
  const chips = buildMonitorChips(mk({ dataStatusLabel: "Data chybí", dataOk: false }));
  assert.deepEqual(chips, [{ label: "Data chybí", tone: "wait" }]);
});

test("buildMonitorChips: Pantone vzniká ze tří nezávislých cest", () => {
  assert.equal(buildMonitorChips(mk({ pantoneRequired: true }))[0].label, "PANTONE");
  assert.equal(buildMonitorChips(mk({ pantoneRequiredDate: "2026-08-12T00:00:00.000Z" }))[0].label, "PANTONE");
  assert.equal(buildMonitorChips(mk({ pantoneOk: true }))[0].tone, "ok");
  assert.equal(buildMonitorChips(mk({ pantoneRequired: true }))[0].tone, "wait");
});

test("buildMonitorChips: STANDARD varianta chip nedělá, POZASTAVENO je červené", () => {
  assert.deepEqual(buildMonitorChips(mk({ blockVariant: "STANDARD" })), []);
  assert.deepEqual(buildMonitorChips(mk({ blockVariant: "POZASTAVENO" })), [
    { label: "Pozastaveno", tone: "danger" },
  ]);
  assert.deepEqual(buildMonitorChips(mk({ blockVariant: "BEZ_SACKU" })), [
    { label: "Bez sáčku", tone: "plain" },
  ]);
});

test("buildMonitorChips: chybějící blockVariant (undefined) chip nedělá", () => {
  assert.deepEqual(buildMonitorChips(mk({ blockVariant: undefined })), []);
});
