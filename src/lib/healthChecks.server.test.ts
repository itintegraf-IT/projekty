import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOverlapPairs, type BlockRow } from "./healthChecks.server";

const D = (iso: string) => new Date(iso);
function blk(o: Partial<BlockRow> & Pick<BlockRow, "id" | "startTime" | "endTime">): BlockRow {
  return {
    orderNumber: `Z-${o.id}`, machine: "XL_105", type: "ZAKAZKA",
    printMinutes: 120, printCompletedAt: null,
    splitGroupId: null, reservationId: null, jobPresetId: null, recurrenceParentId: null,
    ...o,
  };
}
const NOW = D("2026-07-17T00:00:00.000Z");

test("computeOverlapPairs: dva budoucí překrývající se bloky → 1 pár", () => {
  const a = blk({ id: 1, startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  const b = blk({ id: 2, startTime: D("2026-08-01T09:00:00Z"), endTime: D("2026-08-01T11:00:00Z") });
  const pairs = computeOverlapPairs([a, b], NOW);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a.id, 1);
  assert.equal(pairs[0].b.id, 2);
  assert.equal(pairs[0].overlapMinutes, 60);
});

test("computeOverlapPairs: dotýkající se bloky (end===start) → 0 párů", () => {
  const a = blk({ id: 1, startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  const b = blk({ id: 2, startTime: D("2026-08-01T10:00:00Z"), endTime: D("2026-08-01T12:00:00Z") });
  assert.equal(computeOverlapPairs([a, b], NOW).length, 0);
});

test("computeOverlapPairs: překryv celý v minulosti → 0 (jen budoucí)", () => {
  const a = blk({ id: 1, startTime: D("2026-06-01T08:00:00Z"), endTime: D("2026-06-01T10:00:00Z") });
  const b = blk({ id: 2, startTime: D("2026-06-01T09:00:00Z"), endTime: D("2026-06-01T11:00:00Z") });
  assert.equal(computeOverlapPairs([a, b], NOW).length, 0);
});

test("computeOverlapPairs: různé stroje ve stejný čas → 0", () => {
  const a = blk({ id: 1, machine: "XL_105", startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  const b = blk({ id: 2, machine: "XL_106", startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  assert.equal(computeOverlapPairs([a, b], NOW).length, 0);
});

test("computeOverlapPairs: typově agnostické (REZERVACE × UDRZBA) → 1 pár", () => {
  const a = blk({ id: 1, type: "REZERVACE", startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  const b = blk({ id: 2, type: "UDRZBA", startTime: D("2026-08-01T09:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  const pairs = computeOverlapPairs([a, b], NOW);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].overlapMinutes, 60);
});

test("computeOverlapPairs: tři vzájemně se překrývající → 3 páry", () => {
  const a = blk({ id: 1, startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T11:00:00Z") });
  const b = blk({ id: 2, startTime: D("2026-08-01T09:00:00Z"), endTime: D("2026-08-01T12:00:00Z") });
  const c = blk({ id: 3, startTime: D("2026-08-01T10:00:00Z"), endTime: D("2026-08-01T13:00:00Z") });
  assert.equal(computeOverlapPairs([a, b, c], NOW).length, 3);
});
