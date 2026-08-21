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

function move(id: number, oldStart: string, newStart: string, newEnd: string) {
  return { id, oldStartTime: D(oldStart), startTime: D(newStart), endTime: D(newEnd) };
}

test("prázdná dávka nic nepřekračuje", () => {
  const i = measureCascade([]);
  assert.deepEqual(i, { movedCount: 0, maxShiftMs: 0, farthestEnd: null, exceeded: false });
});

test("pět bloků o hodinu je pod prahem", () => {
  const moves = Array.from({ length: 5 }, (_, k) =>
    move(k, `2026-08-18T0${k}:00:00.000Z`, `2026-08-18T0${k + 1}:00:00.000Z`, `2026-08-18T0${k + 2}:00:00.000Z`),
  );
  const i = measureCascade(moves);
  assert.equal(i.movedCount, 5);
  assert.equal(i.exceeded, false);
});

test("šestý blok práh překročí", () => {
  const moves = Array.from({ length: 6 }, (_, k) =>
    move(k, `2026-08-18T0${k}:00:00.000Z`, `2026-08-18T0${k + 1}:00:00.000Z`, `2026-08-18T0${k + 2}:00:00.000Z`),
  );
  assert.equal(measureCascade(moves).exceeded, true);
});

test("JEDINÝ blok odsunutý dál než 7 dní práh překročí taky", () => {
  const i = measureCascade([
    move(1, "2026-08-18T08:00:00.000Z", "2026-08-30T08:00:00.000Z", "2026-08-30T10:00:00.000Z"),
  ]);
  assert.equal(i.movedCount, 1);
  assert.ok(i.maxShiftMs > MAX_RIGID_PUSH_MS);
  assert.equal(i.exceeded, true);
});

test("měří NEJVĚTŠÍ posun jednoho bloku, ne rozpětí dávky", () => {
  // Dlouhá, ale drobná kaskáda: 3 bloky, každý o hodinu, poslední daleko v čase.
  const i = measureCascade([
    move(1, "2026-08-18T08:00:00.000Z", "2026-08-18T09:00:00.000Z", "2026-08-18T11:00:00.000Z"),
    move(2, "2026-08-25T08:00:00.000Z", "2026-08-25T09:00:00.000Z", "2026-08-25T11:00:00.000Z"),
    move(3, "2026-09-01T08:00:00.000Z", "2026-09-01T09:00:00.000Z", "2026-09-01T11:00:00.000Z"),
  ]);
  assert.equal(i.maxShiftMs, 60 * 60 * 1000);
  assert.equal(i.exceeded, false);
});

test("farthestEnd je nejzazší NOVÝ konec v dávce", () => {
  const i = measureCascade([
    move(1, "2026-08-18T08:00:00.000Z", "2026-08-18T09:00:00.000Z", "2026-08-19T11:00:00.000Z"),
    move(2, "2026-08-18T12:00:00.000Z", "2026-08-18T13:00:00.000Z", "2026-08-21T06:00:00.000Z"),
  ]);
  assert.equal(i.farthestEnd?.toISOString(), "2026-08-21T06:00:00.000Z");
});

test("věta nese počet i nejzazší datum", () => {
  const i = measureCascade([
    move(1, "2026-08-18T08:00:00.000Z", "2026-08-20T09:00:00.000Z", "2026-08-21T06:00:00.000Z"),
  ]);
  const msg = cascadeConfirmMessage(i);
  assert.ok(msg.includes("1 navazujících bloků"), msg);
  assert.ok(msg.includes(formatPragueDateShort(new Date("2026-08-21T06:00:00.000Z"))), msg);
});

test("týž blok posunutý dvakrát se počítá jako JEDEN", () => {
  // Batch/reflow scénář: kotva A posune blok #7, kotva B ho potká znovu a odsune
  // dál — vstup nese id=7 dvakrát, ale je to pořád jeden fyzický blok.
  const i = measureCascade([
    move(7, "2026-08-18T08:00:00.000Z", "2026-08-18T11:00:00.000Z", "2026-08-18T12:00:00.000Z"),
    move(7, "2026-08-18T11:00:00.000Z", "2026-08-18T15:00:00.000Z", "2026-08-18T16:00:00.000Z"),
  ]);
  assert.equal(i.movedCount, 1);
});

test("kumulativní posun se měří od PRVNÍ pozice, ne po skocích", () => {
  // Blok #7 se posune nejdřív o 3 dny (kotva A), pak o dalších 4 dny + 1 hodinu
  // (kotva B) — po skocích by to byly dva bezpečné posuny pod stropem (3 dny,
  // 4 dny + 1 h), ale kumulativně je to 7 dní + 1 h, přes MAX_RIGID_PUSH_MS
  // (přesně 7 dní) — a právě tuhle díru má dedup zacelit.
  const i = measureCascade([
    move(7, "2026-08-18T08:00:00.000Z", "2026-08-21T08:00:00.000Z", "2026-08-21T10:00:00.000Z"),
    move(7, "2026-08-21T08:00:00.000Z", "2026-08-25T09:00:00.000Z", "2026-08-25T11:00:00.000Z"),
  ]);
  assert.equal(i.movedCount, 1);
  assert.equal(i.maxShiftMs, 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
  assert.ok(i.maxShiftMs > MAX_RIGID_PUSH_MS);
  assert.equal(i.exceeded, true);
});

test("CASCADE_CONFIRM má HTTP 409 — errorStatus je switch s default 500, tohle to hlídá", () => {
  assert.equal(errorStatus("CASCADE_CONFIRM"), 409);
});

test("práh je od 21. 8. 2026 VYNUCEN — CASCADE_CONFIRM_ENFORCED je true, práh zůstává 5", () => {
  assert.equal(CASCADE_CONFIRM_ENFORCED, true);
  assert.equal(CASCADE_CONFIRM_MAX_BLOCKS, 5);
});
