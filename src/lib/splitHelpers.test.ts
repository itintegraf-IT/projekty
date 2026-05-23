import { test } from "node:test";
import assert from "node:assert/strict";
import { findSplitPartner, getSplitChipState } from "./splitHelpers";
import type { Block } from "@/app/_components/TimelineGrid";

function mkBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: 1,
    orderNumber: "25-0001",
    machine: "XL_105",
    startTime: "2026-05-23T08:00:00.000Z",
    endTime: "2026-05-23T10:00:00.000Z",
    type: "ZAKAZKA",
    blockVariant: "STANDARD",
    jobPresetId: null,
    jobPresetLabel: null,
    description: null,
    locked: false,
    deadlineExpedice: null,
    expediceNote: null,
    doprava: null,
    expeditionPublishedAt: null,
    expeditionSortOrder: null,
    dataStatusId: null,
    dataStatusLabel: null,
    dataRequiredDate: null,
    dataOk: false,
    materialStatusId: null,
    materialStatusLabel: null,
    materialRequiredDate: null,
    materialOk: false,
    materialInStock: false,
    materialIssued: false,
    pantoneRequiredDate: null,
    pantoneOk: false,
    pantoneRequired: false,
    barvyStatusId: null,
    barvyStatusLabel: null,
    lakStatusId: null,
    lakStatusLabel: null,
    specifikace: null,
    materialNote: null,
    materialNoteByUsername: null,
    recurrenceType: "NONE",
    recurrenceParentId: null,
    splitGroupId: null,
    printCompletedAt: null,
    printCompletedByUserId: null,
    printCompletedByUsername: null,
    reservationId: null,
    reservationConfirmedAt: null,
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  };
}

test("findSplitPartner returns null when splitGroupId is null", () => {
  const me = mkBlock({ id: 1, splitGroupId: null });
  assert.equal(findSplitPartner(me, [me], "XL_105"), null);
});

test("findSplitPartner returns null when block is not on my machine", () => {
  const me = mkBlock({ id: 1, splitGroupId: 1, machine: "XL_106" });
  const other = mkBlock({ id: 2, splitGroupId: 1, machine: "XL_105" });
  assert.equal(findSplitPartner(me, [me, other], "XL_105"), null);
});

test("findSplitPartner returns null when no partner exists on other machine", () => {
  const me = mkBlock({ id: 1, splitGroupId: 1, machine: "XL_105" });
  const sibling = mkBlock({ id: 2, splitGroupId: 1, machine: "XL_105" });
  assert.equal(findSplitPartner(me, [me, sibling], "XL_105"), null);
});

test("findSplitPartner returns partner on other machine", () => {
  const me = mkBlock({ id: 1, splitGroupId: 1, machine: "XL_105" });
  const partner = mkBlock({ id: 2, splitGroupId: 1, machine: "XL_106" });
  const result = findSplitPartner(me, [me, partner], "XL_105");
  assert.equal(result?.id, 2);
});

test("findSplitPartner returns earliest by startTime when multiple partners", () => {
  const me = mkBlock({ id: 1, splitGroupId: 1, machine: "XL_105" });
  const later = mkBlock({ id: 2, splitGroupId: 1, machine: "XL_106", startTime: "2026-05-23T15:00:00.000Z" });
  const earlier = mkBlock({ id: 3, splitGroupId: 1, machine: "XL_106", startTime: "2026-05-23T10:00:00.000Z" });
  const result = findSplitPartner(me, [me, later, earlier], "XL_105");
  assert.equal(result?.id, 3);
});

test("getSplitChipState returns waiting when printCompletedAt is null", () => {
  const partner = mkBlock({ id: 2, startTime: "2026-05-23T14:30:00.000Z", printCompletedAt: null });
  const result = getSplitChipState(partner);
  assert.equal(result.state, "waiting");
  assert.equal(result.time.toISOString(), "2026-05-23T14:30:00.000Z");
});

test("getSplitChipState returns done when printCompletedAt is set", () => {
  const partner = mkBlock({ id: 2, startTime: "2026-05-23T14:00:00.000Z", printCompletedAt: "2026-05-23T15:45:00.000Z" });
  const result = getSplitChipState(partner);
  assert.equal(result.state, "done");
  assert.equal(result.time.toISOString(), "2026-05-23T15:45:00.000Z");
});
