import assert from "node:assert/strict";
import test from "node:test";
import { AppError, isAppError } from "./errors";

test("AppError nastavuje code, message a name správně", () => {
  const err = new AppError("NOT_FOUND", "Blok nenalezen");
  assert.equal(err.code, "NOT_FOUND");
  assert.equal(err.message, "Blok nenalezen");
  assert.equal(err.name, "AppError");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof AppError);
});

test("AppError volitelně přijímá details", () => {
  const details = { blockId: 42 };
  const err = new AppError("FORBIDDEN", "Přístup odepřen", details);
  assert.deepEqual(err.details, details);
});

test("isAppError vrátí true pro AppError", () => {
  const err = new AppError("CONFLICT", "Kolize");
  assert.ok(isAppError(err));
});

test("isAppError vrátí false pro plain Error", () => {
  assert.equal(isAppError(new Error("obyčejná chyba")), false);
  assert.equal(isAppError(null), false);
  assert.equal(isAppError("string"), false);
  assert.equal(isAppError(undefined), false);
});

test("AppError podporuje všechny definované kódy", () => {
  const codes = ["NOT_FOUND", "FORBIDDEN", "PRESET_INVALID", "SCHEDULE_VIOLATION", "CONFLICT"] as const;
  for (const code of codes) {
    const err = new AppError(code, `test ${code}`);
    assert.equal(err.code, code);
  }
});
