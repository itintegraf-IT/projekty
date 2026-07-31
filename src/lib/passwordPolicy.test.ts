import test from "node:test";
import assert from "node:assert/strict";
import { validatePassword, PASSWORD_MIN_LENGTH, BCRYPT_COST } from "./passwordPolicy";

test("validatePassword: prázdné a nestringové hodnoty odmítne", () => {
  assert.equal(validatePassword("").ok, false);
  assert.equal(validatePassword(undefined).ok, false);
  assert.equal(validatePassword(null).ok, false);
  assert.equal(validatePassword(12345678901234).ok, false);
});

test("validatePassword: krátké heslo odmítne, hraniční délku přijme", () => {
  const short = "a".repeat(PASSWORD_MIN_LENGTH - 1);
  const exact = "a".repeat(PASSWORD_MIN_LENGTH);
  const shortResult = validatePassword(short);
  assert.equal(shortResult.ok, false);
  if (!shortResult.ok) assert.match(shortResult.error, new RegExp(`alespoň ${PASSWORD_MIN_LENGTH}`));
  assert.equal(validatePassword(exact).ok, true);
});

test("validatePassword: heslo nad 72 bajtů odmítne (bcrypt limit)", () => {
  assert.equal(validatePassword("a".repeat(73)).ok, false);
  assert.equal(validatePassword("a".repeat(72)).ok, true);
  // Diakritika = 2 bajty: 40 znaků "á" = 80 bajtů → přes limit.
  assert.equal(validatePassword("á".repeat(40)).ok, false);
});

test("validatePassword: heslo shodné s username odmítne (case-insensitive)", () => {
  assert.equal(validatePassword("planovac1234", "planovac1234").ok, false);
  assert.equal(validatePassword("PLANOVAC1234", "planovac1234").ok, false);
  assert.equal(validatePassword("planovac1234!", "planovac1234").ok, true);
});

test("BCRYPT_COST je alespoň 12", () => {
  assert.ok(BCRYPT_COST >= 12);
});
