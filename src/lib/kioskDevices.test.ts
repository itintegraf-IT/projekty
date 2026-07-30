import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseKioskDevices,
  resolveKioskDeviceByKey,
  pntidForUsername,
  KIOSK_KEY_MIN_LENGTH,
} from "./kioskDevices";

// Klíč musí mít ≥ KIOSK_KEY_MIN_LENGTH znaků (validace od hardening fáze).
const KEY = "a".repeat(KIOSK_KEY_MIN_LENGTH);
const SAMPLE = `[{"device":"KBA106","key":"${KEY}","username":"tiskar.kba106","pntid":25}]`;

test("parseKioskDevices: prázdný/undefined → []", () => {
  assert.deepEqual(parseKioskDevices(undefined), []);
  assert.deepEqual(parseKioskDevices(""), []);
});

test("parseKioskDevices: validní JSON", () => {
  const d = parseKioskDevices(SAMPLE);
  assert.equal(d.length, 1);
  assert.equal(d[0].pntid, 25);
  assert.equal(d[0].username, "tiskar.kba106");
});

test("parseKioskDevices: nevalidní JSON → throw", () => {
  assert.throws(() => parseKioskDevices("{není json"));
});

test("parseKioskDevices: chybějící pole → throw", () => {
  assert.throws(() => parseKioskDevices('[{"device":"X"}]'));
});

test("parseKioskDevices: prázdný klíč → throw (jinak by endpoint pustil ?key=)", () => {
  assert.throws(
    () => parseKioskDevices('[{"device":"X","key":"","username":"u","pntid":1}]'),
    /příliš krátký/
  );
});

test("parseKioskDevices: krátký klíč → throw", () => {
  const shortKey = "a".repeat(KIOSK_KEY_MIN_LENGTH - 1);
  assert.throws(
    () => parseKioskDevices(`[{"device":"X","key":"${shortKey}","username":"u","pntid":1}]`),
    /příliš krátký/
  );
});

test("resolveKioskDeviceByKey: správný klíč → entry", () => {
  const d = parseKioskDevices(SAMPLE);
  const m = resolveKioskDeviceByKey(d, "KBA106", KEY);
  assert.equal(m?.username, "tiskar.kba106");
});

test("resolveKioskDeviceByKey: špatný klíč → null", () => {
  const d = parseKioskDevices(SAMPLE);
  assert.equal(resolveKioskDeviceByKey(d, "KBA106", "b".repeat(KIOSK_KEY_MIN_LENGTH)), null);
});

test("resolveKioskDeviceByKey: prázdný klíč → null (rozdílná délka)", () => {
  const d = parseKioskDevices(SAMPLE);
  assert.equal(resolveKioskDeviceByKey(d, "KBA106", ""), null);
});

test("resolveKioskDeviceByKey: klíč jako prefix správného → null", () => {
  const d = parseKioskDevices(SAMPLE);
  assert.equal(resolveKioskDeviceByKey(d, "KBA106", KEY.slice(0, -1)), null);
});

test("resolveKioskDeviceByKey: neznámé zařízení → null", () => {
  const d = parseKioskDevices(SAMPLE);
  assert.equal(resolveKioskDeviceByKey(d, "NEEXISTUJE", KEY), null);
});

test("pntidForUsername: najde pntid", () => {
  const d = parseKioskDevices(SAMPLE);
  assert.equal(pntidForUsername(d, "tiskar.kba106"), 25);
  assert.equal(pntidForUsername(d, "nikdo"), null);
});
