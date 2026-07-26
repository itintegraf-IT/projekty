import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseKioskDevices,
  resolveKioskDeviceByKey,
  pntidForUsername,
} from "./kioskDevices.ts";

const SAMPLE = '[{"device":"KBA106","key":"secret1","username":"tiskar.kba106","pntid":25}]';

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

test("resolveKioskDeviceByKey: správný klíč → entry", () => {
  const d = parseKioskDevices(SAMPLE);
  const m = resolveKioskDeviceByKey(d, "KBA106", "secret1");
  assert.equal(m?.username, "tiskar.kba106");
});

test("resolveKioskDeviceByKey: špatný klíč → null", () => {
  const d = parseKioskDevices(SAMPLE);
  assert.equal(resolveKioskDeviceByKey(d, "KBA106", "špatně"), null);
});

test("resolveKioskDeviceByKey: neznámé zařízení → null", () => {
  const d = parseKioskDevices(SAMPLE);
  assert.equal(resolveKioskDeviceByKey(d, "NEEXISTUJE", "secret1"), null);
});

test("pntidForUsername: najde pntid", () => {
  const d = parseKioskDevices(SAMPLE);
  assert.equal(pntidForUsername(d, "tiskar.kba106"), 25);
  assert.equal(pntidForUsername(d, "nikdo"), null);
});
