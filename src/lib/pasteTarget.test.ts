import test from "node:test";
import assert from "node:assert/strict";
import { computePasteTargetFromBlock, computePasteTargetFromGroup } from "./pasteTarget.js";
import type { Block } from "../app/_components/TimelineGrid.js";

function mkBlock(over: Partial<Block> = {}): Block {
  // minimální stub Block — pouze pole používaná v pasteTarget
  return {
    id: 1,
    machine: "XL_105",
    startTime: "2026-05-27T08:00:00.000Z",
    endTime: "2026-05-27T10:00:00.000Z",
    orderNumber: "TST-1",
    type: "ZAKAZKA",
    blockVariant: "STANDARD",
    locked: false,
    ...over,
  } as Block;
}

test("computePasteTargetFromBlock: stejný stroj + čas = endTime zarovnaný na 30min slot", () => {
  const b = mkBlock({ machine: "XL_106", endTime: "2026-05-27T10:00:00.000Z" });
  const t = computePasteTargetFromBlock(b);
  assert.equal(t.machine, "XL_106");
  assert.equal(t.time.toISOString(), "2026-05-27T10:00:00.000Z");
});

test("computePasteTargetFromBlock: endTime na 10:15 se zarovná na 10:30", () => {
  const b = mkBlock({ endTime: "2026-05-27T10:15:00.000Z" });
  const t = computePasteTargetFromBlock(b);
  assert.equal(t.time.toISOString(), "2026-05-27T10:30:00.000Z");
});

test("computePasteTargetFromBlock: endTime přesně na slotu se nezvětší", () => {
  const b = mkBlock({ endTime: "2026-05-27T10:30:00.000Z" });
  const t = computePasteTargetFromBlock(b);
  assert.equal(t.time.toISOString(), "2026-05-27T10:30:00.000Z");
});

test("computePasteTargetFromGroup: stroj = anchor (nejdříve startující) blok", () => {
  const a = mkBlock({ id: 1, machine: "XL_105", startTime: "2026-05-27T08:00:00.000Z", endTime: "2026-05-27T10:00:00.000Z" });
  const b = mkBlock({ id: 2, machine: "XL_106", startTime: "2026-05-27T09:00:00.000Z", endTime: "2026-05-27T11:00:00.000Z" });
  const t = computePasteTargetFromGroup([b, a]);
  assert.ok(t);
  assert.equal(t!.machine, "XL_105");
});

test("computePasteTargetFromGroup: čas = konec nejlatěji končícího bloku", () => {
  const a = mkBlock({ id: 1, startTime: "2026-05-27T08:00:00.000Z", endTime: "2026-05-27T10:00:00.000Z" });
  const b = mkBlock({ id: 2, startTime: "2026-05-27T09:00:00.000Z", endTime: "2026-05-27T11:30:00.000Z" });
  assert.equal(computePasteTargetFromGroup([a, b])!.time.toISOString(), "2026-05-27T11:30:00.000Z");
});

test("computePasteTargetFromGroup: prázdné pole vrátí null", () => {
  assert.equal(computePasteTargetFromGroup([]), null);
});
