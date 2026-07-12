import { test } from "node:test";
import assert from "node:assert/strict";
import { assertRole } from "./authz";
import { isAppError, errorStatus } from "./errors";
import type { SessionUser } from "./auth";

const PLANNER: SessionUser = { id: 1, username: "novak", role: "PLANOVAT", assignedMachine: null };

test("assertRole: null session → UNAUTHORIZED (mapuje se na 401)", () => {
  try {
    assertRole(null, ["ADMIN", "PLANOVAT"]);
    assert.fail("mělo vyhodit");
  } catch (err) {
    assert.ok(isAppError(err));
    assert.equal(err.code, "UNAUTHORIZED");
    assert.equal(errorStatus(err.code), 401);
  }
});

test("assertRole: špatná role → FORBIDDEN (mapuje se na 403)", () => {
  try {
    assertRole({ ...PLANNER, role: "OBCHODNIK" }, ["ADMIN", "PLANOVAT"]);
    assert.fail("mělo vyhodit");
  } catch (err) {
    assert.ok(isAppError(err));
    assert.equal(err.code, "FORBIDDEN");
    assert.equal(errorStatus(err.code), 403);
  }
});

test("assertRole: povolená role → vrátí session beze změny", () => {
  const result = assertRole(PLANNER, ["ADMIN", "PLANOVAT"]);
  assert.deepEqual(result, PLANNER);
});

test("assertRole: role check je case-sensitive exact match", () => {
  assert.throws(() => assertRole({ ...PLANNER, role: "planovat" }, ["PLANOVAT"]));
});
