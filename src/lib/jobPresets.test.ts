import assert from "node:assert/strict";
import test from "node:test";
import { applyJobPresetToDraft, type JobPreset, type JobPresetDraftValues } from "./jobPresets";

function emptyDraft(): JobPresetDraftValues {
  return {
    blockVariant: "STANDARD",
    specifikace: "",
    dataStatusId: "",
    dataRequiredDate: "",
    materialStatusId: "",
    materialRequiredDate: "",
    materialInStock: false,
    pantoneRequired: false,
    pantoneRequiredDate: "",
    barvyStatusId: "",
    lakStatusId: "",
    deadlineExpedice: "",
    jobPresetId: null,
    jobPresetLabel: "",
  };
}

function presetSkeleton(overrides: Partial<JobPreset> = {}): JobPreset {
  return {
    id: 1,
    name: "Test Preset",
    isSystemPreset: false,
    isActive: true,
    sortOrder: 0,
    appliesToZakazka: true,
    appliesToRezervace: false,
    machineConstraint: null,
    blockVariant: null,
    specifikace: null,
    dataStatusId: null,
    dataRequiredDateOffsetDays: null,
    materialStatusId: null,
    materialRequiredDateOffsetDays: null,
    materialInStock: null,
    pantoneRequired: null,
    pantoneRequiredDateOffsetDays: null,
    barvyStatusId: null,
    lakStatusId: null,
    deadlineExpediceOffsetDays: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("smoke: applyJobPresetToDraft is callable", () => {
  const result = applyJobPresetToDraft(emptyDraft(), presetSkeleton(), "ZAKAZKA");
  assert.equal(result.next.jobPresetId, 1);
  assert.equal(result.next.jobPresetLabel, "Test Preset");
});

test("empty draft: preset offsets fill all empty date fields", () => {
  const result = applyJobPresetToDraft(
    emptyDraft(),
    presetSkeleton({
      dataRequiredDateOffsetDays: 11,
      materialRequiredDateOffsetDays: 5,
      pantoneRequiredDateOffsetDays: 3,
      deadlineExpediceOffsetDays: 14,
    }),
    "ZAKAZKA"
  );
  assert.notEqual(result.next.dataRequiredDate, "", "dataRequiredDate should be filled");
  assert.notEqual(result.next.materialRequiredDate, "", "materialRequiredDate should be filled");
  assert.notEqual(result.next.pantoneRequiredDate, "", "pantoneRequiredDate should be filled");
  assert.notEqual(result.next.deadlineExpedice, "", "deadlineExpedice should be filled");
  assert.deepEqual(result.overwrittenFields, [], "no overwrites — all fields were empty");
});

test("filled dataRequiredDate is preserved when preset has offset", () => {
  const draft = emptyDraft();
  draft.dataRequiredDate = "2026-05-11";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ dataRequiredDateOffsetDays: -1 }),
    "ZAKAZKA"
  );
  assert.equal(result.next.dataRequiredDate, "2026-05-11", "preserved user value");
  assert.ok(
    !result.overwrittenFields.includes("dataRequiredDate"),
    "dataRequiredDate must NOT appear in overwrittenFields"
  );
});

test("filled materialRequiredDate is preserved when preset has offset", () => {
  const draft = emptyDraft();
  draft.materialRequiredDate = "2026-05-15";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ materialRequiredDateOffsetDays: 7 }),
    "ZAKAZKA"
  );
  assert.equal(result.next.materialRequiredDate, "2026-05-15");
  assert.ok(!result.overwrittenFields.includes("materialRequiredDate"));
});

test("filled pantoneRequiredDate is preserved when preset has offset", () => {
  const draft = emptyDraft();
  draft.pantoneRequiredDate = "2026-05-20";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ pantoneRequiredDateOffsetDays: 3 }),
    "ZAKAZKA"
  );
  assert.equal(result.next.pantoneRequiredDate, "2026-05-20");
  assert.ok(!result.overwrittenFields.includes("pantoneRequiredDate"));
});

test("filled deadlineExpedice is preserved when preset has offset", () => {
  const draft = emptyDraft();
  draft.deadlineExpedice = "2026-05-30";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ deadlineExpediceOffsetDays: 14 }),
    "ZAKAZKA"
  );
  assert.equal(result.next.deadlineExpedice, "2026-05-30");
  assert.ok(!result.overwrittenFields.includes("deadlineExpedice"));
});

test("filled status IDs are preserved when preset provides values", () => {
  const draft = emptyDraft();
  draft.dataStatusId = "10";
  draft.materialStatusId = "20";
  draft.barvyStatusId = "30";
  draft.lakStatusId = "40";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({
      dataStatusId: 99,
      materialStatusId: 99,
      barvyStatusId: 99,
      lakStatusId: 99,
    }),
    "ZAKAZKA"
  );
  assert.equal(result.next.dataStatusId, "10");
  assert.equal(result.next.materialStatusId, "20");
  assert.equal(result.next.barvyStatusId, "30");
  assert.equal(result.next.lakStatusId, "40");
  assert.ok(!result.overwrittenFields.includes("dataStatusId"));
  assert.ok(!result.overwrittenFields.includes("materialStatusId"));
  assert.ok(!result.overwrittenFields.includes("barvyStatusId"));
  assert.ok(!result.overwrittenFields.includes("lakStatusId"));
});

test("empty status IDs are filled from preset", () => {
  const result = applyJobPresetToDraft(
    emptyDraft(),
    presetSkeleton({
      dataStatusId: 5,
      materialStatusId: 6,
      barvyStatusId: 7,
      lakStatusId: 8,
    }),
    "ZAKAZKA"
  );
  assert.equal(result.next.dataStatusId, "5");
  assert.equal(result.next.materialStatusId, "6");
  assert.equal(result.next.barvyStatusId, "7");
  assert.equal(result.next.lakStatusId, "8");
});

test("preset materialInStock=true does NOT clear filled materialRequiredDate", () => {
  const draft = emptyDraft();
  draft.materialRequiredDate = "2026-05-15";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ materialInStock: true }),
    "ZAKAZKA"
  );
  assert.equal(result.next.materialInStock, true, "materialInStock toggled to true");
  assert.equal(
    result.next.materialRequiredDate,
    "2026-05-15",
    "materialRequiredDate preserved (NOT cleared)"
  );
  assert.ok(
    !result.overwrittenFields.includes("materialRequiredDate"),
    "materialRequiredDate not in overwrites"
  );
});

test("preset materialInStock=true DOES clear empty materialRequiredDate (no-op)", () => {
  const result = applyJobPresetToDraft(
    emptyDraft(),
    presetSkeleton({ materialInStock: true }),
    "ZAKAZKA"
  );
  assert.equal(result.next.materialInStock, true);
  assert.equal(result.next.materialRequiredDate, "");
  assert.ok(
    !result.overwrittenFields.includes("materialRequiredDate"),
    "no-op clearing must not appear in overwrittenFields"
  );
});

test("preset pantoneRequired=false does NOT clear filled pantoneRequiredDate", () => {
  const draft = emptyDraft();
  draft.pantoneRequiredDate = "2026-05-20";
  draft.pantoneRequired = true;
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ pantoneRequired: false }),
    "ZAKAZKA"
  );
  assert.equal(result.next.pantoneRequired, false, "pantoneRequired toggled to false");
  assert.equal(
    result.next.pantoneRequiredDate,
    "2026-05-20",
    "pantoneRequiredDate preserved (NOT cleared)"
  );
  assert.ok(!result.overwrittenFields.includes("pantoneRequiredDate"));
});

test("filled specifikace is preserved when preset provides one", () => {
  const draft = emptyDraft();
  draft.specifikace = "Moje specifická poznámka";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ specifikace: "Default z presetu" }),
    "ZAKAZKA"
  );
  assert.equal(result.next.specifikace, "Moje specifická poznámka");
  assert.ok(!result.overwrittenFields.includes("specifikace"));
});

test("empty specifikace is filled from preset", () => {
  const result = applyJobPresetToDraft(
    emptyDraft(),
    presetSkeleton({ specifikace: "Default z presetu" }),
    "ZAKAZKA"
  );
  assert.equal(result.next.specifikace, "Default z presetu");
});

test("blockVariant != STANDARD is preserved", () => {
  const draft = emptyDraft();
  draft.blockVariant = "BEZ_TECHNOLOGIE";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ blockVariant: "BEZ_SACKU" }),
    "ZAKAZKA"
  );
  assert.equal(result.next.blockVariant, "BEZ_TECHNOLOGIE");
  assert.deepEqual(result.overwrittenFields, []);
});

test("blockVariant = STANDARD gets overridden by preset", () => {
  const result = applyJobPresetToDraft(
    emptyDraft(),
    presetSkeleton({ blockVariant: "BEZ_SACKU" }),
    "ZAKAZKA"
  );
  assert.equal(result.next.blockVariant, "BEZ_SACKU");
});

test("jobPresetId is always overwritten", () => {
  const draft = emptyDraft();
  draft.jobPresetId = 99;
  draft.jobPresetLabel = "Old preset";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ id: 42, name: "New preset" }),
    "ZAKAZKA"
  );
  assert.equal(result.next.jobPresetId, 42);
  assert.equal(result.next.jobPresetLabel, "New preset");
});

test("planner workflow: paste + change preset preserves all dates", () => {
  // Scénář 2 ze specu: blok zkopírovaný s vyplněnými daty, change presetu zachová data
  const draft = emptyDraft();
  draft.dataRequiredDate = "2026-05-11";
  draft.materialRequiredDate = "2026-05-09";
  draft.pantoneRequiredDate = "2026-05-08";
  draft.deadlineExpedice = "2026-05-25";
  draft.dataStatusId = "1";
  draft.materialStatusId = "2";
  draft.jobPresetId = 1;
  draft.jobPresetLabel = "XL 106 LED";

  const newPreset = presetSkeleton({
    id: 2,
    name: "XL 105",
    dataRequiredDateOffsetDays: -1,
    materialRequiredDateOffsetDays: 0,
    pantoneRequiredDateOffsetDays: -2,
    deadlineExpediceOffsetDays: 7,
    dataStatusId: 5,
    materialStatusId: 6,
  });

  const result = applyJobPresetToDraft(draft, newPreset, "ZAKAZKA");

  // Všechny "uživatelské" hodnoty zůstávají
  assert.equal(result.next.dataRequiredDate, "2026-05-11");
  assert.equal(result.next.materialRequiredDate, "2026-05-09");
  assert.equal(result.next.pantoneRequiredDate, "2026-05-08");
  assert.equal(result.next.deadlineExpedice, "2026-05-25");
  assert.equal(result.next.dataStatusId, "1");
  assert.equal(result.next.materialStatusId, "2");

  // Identita presetu se aktualizuje
  assert.equal(result.next.jobPresetId, 2);
  assert.equal(result.next.jobPresetLabel, "XL 105");

  // overwrittenFields by mělo být prázdné — žádné uživatelské pole jsme nepřepsali
  assert.deepEqual(result.overwrittenFields, []);
});
