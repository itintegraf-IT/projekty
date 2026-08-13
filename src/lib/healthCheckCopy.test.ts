import { test } from "node:test";
import assert from "node:assert/strict";
import { HEALTH_COPY, copyFor } from "./healthCheckCopy";

const REQUIRED = [
  "overlaps", "drift", "outsideHours", "integrity", "attachments",
  "orphanJobPreset", "invalidMachine", "invalidType", "negativeInterval",
  "badPrintMinutes", "unalignedStart", "inconsistentPrintCompleted", "splitFieldsDiverged",
];

test("copy: každá kontrola má obě věty", () => {
  for (const key of REQUIRED) {
    const c = HEALTH_COPY[key];
    assert.ok(c, `chybí text pro ${key}`);
    assert.ok(c.znamena.length > 20, `${key}: „co to znamená" je příliš krátké`);
    assert.ok(c.coStim.length > 20, `${key}: „co s tím" je příliš krátké`);
  }
});

test("copy: žádný text navíc pro zrušené kontroly", () => {
  for (const gone of ["undersizedSplitGroup", "orphanSplitGroup", "orphanReservation", "orphanRecurrenceParent"]) {
    assert.equal(gone in HEALTH_COPY, false, `text pro zrušenou kontrolu ${gone}`);
  }
});

test("copyFor: neznámý klíč vrací null, ne výjimku", () => {
  assert.equal(copyFor("neexistuje"), null);
});
