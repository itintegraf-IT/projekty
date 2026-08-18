import { test } from "node:test";
import assert from "node:assert/strict";
import { moveToBefore, mergeBefore, type ReflowBeforeSnapshot } from "./reflowBefore.server";
import type { AppliedMove } from "./overlapResolver.server";

function mv(id: number, oldStartIso: string, over: Partial<AppliedMove> = {}): AppliedMove {
  return {
    id,
    startTime: new Date("2026-08-20T10:00:00.000Z"),
    endTime: new Date("2026-08-20T12:00:00.000Z"),
    orderNumber: "18827",
    oldStartTime: new Date(oldStartIso),
    oldEndTime: new Date("2026-08-18T12:00:00.000Z"),
    oldUpdatedAt: new Date("2026-08-18T09:00:00.000Z"),
    oldPrintMinutes: 120,
    oldScheduleBypassed: false,
    ...over,
  } as AppliedMove;
}

test("moveToBefore vyrobí kompletní poziční snapshot z původních hodnot", () => {
  const s = moveToBefore("XL_105", mv(7, "2026-08-18T10:00:00.000Z"));
  assert.deepEqual(s, {
    id: 7,
    startTime: "2026-08-18T10:00:00.000Z",
    endTime: "2026-08-18T12:00:00.000Z",
    machine: "XL_105",
    updatedAt: "2026-08-18T09:00:00.000Z",
    printMinutes: 120,
    scheduleBypassed: false,
  });
});

test("mergeBefore drží PRVNÍ výskyt — hromadný přepočet smí blok posunout víckrát", () => {
  const acc = new Map<number, ReflowBeforeSnapshot>();
  mergeBefore(acc, [moveToBefore("XL_105", mv(7, "2026-08-18T10:00:00.000Z"))]);
  mergeBefore(acc, [moveToBefore("XL_105", mv(7, "2026-08-19T06:00:00.000Z"))]);
  assert.equal(acc.size, 1);
  assert.equal(acc.get(7)!.startTime, "2026-08-18T10:00:00.000Z");
});

test("mergeBefore přidá nové id vedle stávajících", () => {
  const acc = new Map<number, ReflowBeforeSnapshot>();
  mergeBefore(acc, [moveToBefore("XL_105", mv(7, "2026-08-18T10:00:00.000Z"))]);
  mergeBefore(acc, [moveToBefore("XL_105", mv(9, "2026-08-18T14:00:00.000Z"))]);
  assert.deepEqual([...acc.keys()].sort(), [7, 9]);
});
