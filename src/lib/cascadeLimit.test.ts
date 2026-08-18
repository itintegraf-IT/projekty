import { test } from "node:test";
import assert from "node:assert/strict";
import {
  measureCascade, cascadeConfirmMessage,
  CASCADE_CONFIRM_MAX_BLOCKS, CASCADE_CONFIRM_ENFORCED,
} from "./cascadeLimit";
import { MAX_RIGID_PUSH_MS } from "./overlapResolver";
import { errorStatus } from "./errors";
import { formatPragueDateShort } from "./dateUtils";

const D = (iso: string) => new Date(iso);

function move(oldStart: string, newStart: string, newEnd: string) {
  return { oldStartTime: D(oldStart), startTime: D(newStart), endTime: D(newEnd) };
}

test("prázdná dávka nic nepřekračuje", () => {
  const i = measureCascade([]);
  assert.deepEqual(i, { movedCount: 0, maxShiftMs: 0, farthestEnd: null, exceeded: false });
});

test("pět bloků o hodinu je pod prahem", () => {
  const moves = Array.from({ length: 5 }, (_, k) =>
    move(`2026-08-18T0${k}:00:00.000Z`, `2026-08-18T0${k + 1}:00:00.000Z`, `2026-08-18T0${k + 2}:00:00.000Z`),
  );
  const i = measureCascade(moves);
  assert.equal(i.movedCount, 5);
  assert.equal(i.exceeded, false);
});

test("šestý blok práh překročí", () => {
  const moves = Array.from({ length: 6 }, (_, k) =>
    move(`2026-08-18T0${k}:00:00.000Z`, `2026-08-18T0${k + 1}:00:00.000Z`, `2026-08-18T0${k + 2}:00:00.000Z`),
  );
  assert.equal(measureCascade(moves).exceeded, true);
});

test("JEDINÝ blok odsunutý dál než 7 dní práh překročí taky", () => {
  const i = measureCascade([
    move("2026-08-18T08:00:00.000Z", "2026-08-30T08:00:00.000Z", "2026-08-30T10:00:00.000Z"),
  ]);
  assert.equal(i.movedCount, 1);
  assert.ok(i.maxShiftMs > MAX_RIGID_PUSH_MS);
  assert.equal(i.exceeded, true);
});

test("měří NEJVĚTŠÍ posun jednoho bloku, ne rozpětí dávky", () => {
  // Dlouhá, ale drobná kaskáda: 3 bloky, každý o hodinu, poslední daleko v čase.
  const i = measureCascade([
    move("2026-08-18T08:00:00.000Z", "2026-08-18T09:00:00.000Z", "2026-08-18T11:00:00.000Z"),
    move("2026-08-25T08:00:00.000Z", "2026-08-25T09:00:00.000Z", "2026-08-25T11:00:00.000Z"),
    move("2026-09-01T08:00:00.000Z", "2026-09-01T09:00:00.000Z", "2026-09-01T11:00:00.000Z"),
  ]);
  assert.equal(i.maxShiftMs, 60 * 60 * 1000);
  assert.equal(i.exceeded, false);
});

test("farthestEnd je nejzazší NOVÝ konec v dávce", () => {
  const i = measureCascade([
    move("2026-08-18T08:00:00.000Z", "2026-08-18T09:00:00.000Z", "2026-08-19T11:00:00.000Z"),
    move("2026-08-18T12:00:00.000Z", "2026-08-18T13:00:00.000Z", "2026-08-21T06:00:00.000Z"),
  ]);
  assert.equal(i.farthestEnd?.toISOString(), "2026-08-21T06:00:00.000Z");
});

test("věta nese počet i nejzazší datum", () => {
  const i = measureCascade([
    move("2026-08-18T08:00:00.000Z", "2026-08-20T09:00:00.000Z", "2026-08-21T06:00:00.000Z"),
  ]);
  const msg = cascadeConfirmMessage(i);
  assert.ok(msg.includes("1 navazujících bloků"), msg);
  assert.ok(msg.includes(formatPragueDateShort(new Date("2026-08-21T06:00:00.000Z"))), msg);
});

test("CASCADE_CONFIRM má HTTP 409 — errorStatus je switch s default 500, tohle to hlídá", () => {
  assert.equal(errorStatus("CASCADE_CONFIRM"), 409);
});

test("vlna se nasazuje v režimu MĚŘENÍ — vynucení se zapíná až samostatným commitem", () => {
  assert.equal(CASCADE_CONFIRM_ENFORCED, false);
  assert.equal(CASCADE_CONFIRM_MAX_BLOCKS, 5);
});
