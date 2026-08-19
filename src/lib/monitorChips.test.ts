import test from "node:test";
import assert from "node:assert/strict";
import { buildMonitorChips } from "./monitorChips.js";
import { serializeProductionTags } from "./productionTags.js";
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
    materialRequiredDate: null,
    materialOk: false,
    materialInStock: false,
    materialIssued: false,
    materialPartiallyIssued: false,
    pantoneRequired: false,
    pantoneRequiredDate: null,
    pantoneOk: false,
    pantoneInStock: false,
    pantoneIssued: false,
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
    tiskoveArchy: serializeProductionTags(["3. TA"]),
    serie: serializeProductionTags(["2. série"]),
    dataStatusLabel: "Data OK",
    dataOk: true,
    materialStatusLabel: "Skladem",
    materialInStock: true,
    pantoneOk: true,
    blockVariant: "POZASTAVENO",
  }));
  assert.deepEqual(chips, [
    { label: "OBÁLKA", tone: "brand" },
    { label: "VNITŘKY", tone: "brand" },
    { label: "3 TA", tone: "plain" },
    { label: "2 série", tone: "plain" },
    { label: "Data OK", tone: "ok" },
    { label: "Skladem", tone: "ok" },
    { label: "MAT. SKLADEM ✓", tone: "ok" },
    { label: "PANTONE", tone: "ok" },
    { label: "Pozastaveno", tone: "danger" },
  ]);
});

test("buildMonitorChips: archy a série se formátují z JSON pole, ne syrově", () => {
  const chips = buildMonitorChips(mk({
    tiskoveArchy: '["1. TA","5. TA"]',
    serie: '["2. série"]',
  }));
  assert.deepEqual(chips, [
    { label: "1, 5 TA", tone: "plain" },
    { label: "2 série", tone: "plain" },
  ]);
});

test("buildMonitorChips: neparsovatelná hodnota chip nedělá (stejně jako karta v plánu)", () => {
  assert.deepEqual(buildMonitorChips(mk({ tiskoveArchy: "3. TA", serie: null })), []);
});

test("buildMonitorChips: materiál je připravený i když je jen vydaný (nález I5)", () => {
  const issued = buildMonitorChips(mk({ materialStatusLabel: "Vydáno", materialIssued: true }));
  assert.equal(issued[0].tone, "ok");

  const stock = buildMonitorChips(mk({ materialStatusLabel: "Skladem", materialInStock: true }));
  assert.equal(stock[0].tone, "ok");

  const confirmed = buildMonitorChips(mk({ materialStatusLabel: "Potvrzeno", materialOk: true }));
  assert.equal(confirmed[0].tone, "ok");
});

test("buildMonitorChips: částečně vydaný materiál je ready (tone ok)", () => {
  const chips = buildMonitorChips(mk({ materialStatusLabel: "55m", materialInStock: false, materialIssued: false, materialOk: false, materialPartiallyIssued: true }));
  const mat = chips.find((c) => c.label === "55m");
  assert.equal(mat?.tone, "ok");
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
  assert.equal(buildMonitorChips(mk({ pantoneRequired: true }))[0].label, "PANTONE ČEKÁ");
  assert.equal(buildMonitorChips(mk({ pantoneRequiredDate: "2026-08-12T00:00:00.000Z" }))[0].label, "PANTONE ČEKÁ");
  assert.equal(buildMonitorChips(mk({ pantoneOk: true }))[0].tone, "ok");
  assert.equal(buildMonitorChips(mk({ pantoneRequired: true }))[0].tone, "wait");
});

test("buildMonitorChips: pantone skladem je hotový stav (tón ok), ne čekání", () => {
  const chips = buildMonitorChips(mk({ pantoneRequired: true, pantoneInStock: true }));
  assert.deepEqual(chips, [{ label: "PANTONE SKLADEM", tone: "ok" }]);
});

test("buildMonitorChips: pantone vydaný je hotový stav (tón ok)", () => {
  const chips = buildMonitorChips(mk({ pantoneRequired: true, pantoneIssued: true }));
  assert.deepEqual(chips, [{ label: "PANTONE VYDÁNO", tone: "ok" }]);
});

test("buildMonitorChips: pantone jen s termínem pořád čeká", () => {
  const chips = buildMonitorChips(mk({ pantoneRequired: true, pantoneRequiredDate: "2026-08-20T00:00:00.000Z" }));
  assert.deepEqual(chips, [{ label: "PANTONE ČEKÁ", tone: "wait" }]);
});

test("buildMonitorChips: pantone skladem se zobrazí i bez pantoneRequired (pojistka proti neviditelnému stavu)", () => {
  const chips = buildMonitorChips(mk({ pantoneInStock: true }));
  assert.deepEqual(chips, [{ label: "PANTONE SKLADEM", tone: "ok" }]);
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

test("buildMonitorChips: stav materiálu má vlastní textový chip", () => {
  const issued = buildMonitorChips(mk({ materialIssued: true }));
  assert.ok(issued.some((c) => c.label === "MAT. VYDÁNO ➜" && c.tone === "ok"));
  const partial = buildMonitorChips(mk({ materialPartiallyIssued: true }));
  assert.ok(partial.some((c) => c.label === "MAT. ČÁST. ½" && c.tone === "ok"));
  const inStock = buildMonitorChips(mk({ materialInStock: true }));
  assert.ok(inStock.some((c) => c.label === "MAT. SKLADEM ✓" && c.tone === "ok"));
  const waiting = buildMonitorChips(mk({ materialRequiredDate: "2026-08-21" }));
  assert.ok(waiting.some((c) => c.label === "MAT. ČEKÁ" && c.tone === "wait"));
});

test("buildMonitorChips: pantone chip nese stav vydání textově", () => {
  const issued = buildMonitorChips(mk({ pantoneRequired: true, pantoneIssued: true }));
  assert.ok(issued.some((c) => c.label === "PANTONE VYDÁNO" && c.tone === "ok"));
  const none = buildMonitorChips(mk({}));
  assert.ok(!none.some((c) => c.label.startsWith("PANTONE")));
});
