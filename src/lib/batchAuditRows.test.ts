import test from "node:test";
import assert from "node:assert/strict";
import { buildBatchAuditRows } from "./batchAuditRows.js";

const OLD = {
  machine: "XL_106",
  startTime: new Date("2026-08-13T06:00:00.000Z"),
  endTime: new Date("2026-08-13T07:00:00.000Z"),
};

function input(next: Partial<typeof OLD> = {}) {
  return {
    blockId: 1356,
    orderNumber: "18421/1",
    old: OLD,
    next: { ...OLD, ...next },
  };
}

test("posun času zapíše oldValue i newValue jako ISO rozsah s en-dash", () => {
  const rows = buildBatchAuditRows(
    input({
      startTime: new Date("2026-08-13T14:00:00.000Z"),
      endTime: new Date("2026-08-13T15:00:00.000Z"),
    })
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].field, "startTime/endTime");
  // oldValue je jádro opravy — bez něj nejde přesun vrátit z auditu
  assert.equal(rows[0].oldValue, "2026-08-13T06:00:00.000Z–2026-08-13T07:00:00.000Z");
  assert.equal(rows[0].newValue, "2026-08-13T14:00:00.000Z–2026-08-13T15:00:00.000Z");
  assert.equal(rows[0].blockId, 1356);
  assert.equal(rows[0].orderNumber, "18421/1");
});

test("nezměněný blok nezapíše žádný řádek", () => {
  assert.deepEqual(buildBatchAuditRows(input()), []);
});

test("změna stroje zapíše vlastní řádek s názvy strojů", () => {
  const rows = buildBatchAuditRows(input({ machine: "XL_105" }));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].field, "machine");
  assert.equal(rows[0].oldValue, "XL_106");
  assert.equal(rows[0].newValue, "XL_105");
});

test("přesun na jiný stroj v jiném čase zapíše oba řádky", () => {
  const rows = buildBatchAuditRows(
    input({ machine: "XL_105", startTime: new Date("2026-08-14T06:00:00.000Z") })
  );

  assert.deepEqual(
    rows.map((r) => r.field),
    ["startTime/endTime", "machine"]
  );
});

test("rozsah je čitelný pro fmtAuditVal — obě půlky začínají ISO datem", () => {
  const rows = buildBatchAuditRows(input({ startTime: new Date("2026-08-13T14:00:00.000Z") }));
  const ISO = /^\d{4}-\d{2}-\d{2}T/;

  for (const half of rows[0].oldValue.split("–")) {
    assert.ok(ISO.test(half), `půlka "${half}" nezačíná ISO datem`);
  }
});
