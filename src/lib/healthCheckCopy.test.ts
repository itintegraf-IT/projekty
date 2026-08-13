import { test } from "node:test";
import assert from "node:assert/strict";
import { HEALTH_COPY, copyFor } from "./healthCheckCopy";
import { computeIntegrityIssues, computeSplitDivergence } from "./healthChecks.server";

/**
 * Klíče se ODVOZUJÍ z kontrol samotných, ne z ručně psaného seznamu. Ten se totiž
 * po přejmenování klíče kontroly tiše rozešel a vysvětlivka se v panelu přestala
 * vykreslovat, aniž by to jediný test chytil.
 *
 * Pět klíčů karet zůstává vyjmenovaných — jsou to názvy sekcí v `HealthResult.checks`,
 * ne klíče integritních řádků, a z běhu kontrol se odvodit nedají.
 */
const CARD_KEYS = ["overlaps", "drift", "outsideHours", "integrity", "attachments"];
const REQUIRED = [
  ...CARD_KEYS,
  ...computeIntegrityIssues([], { jobPresetIds: new Set<number>() }).map((i) => i.key),
  computeSplitDivergence([]).key,
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

test("copy: seznam povinných klíčů se opravdu odvodil z kontrol (ne prázdný)", () => {
  assert.equal(REQUIRED.length, 13);
  assert.equal(REQUIRED.includes("splitFieldsDiverged"), true);
  assert.equal(REQUIRED.includes("badPrintMinutes"), true);
});

test("copy: návod u rozešlé skupiny nesmí radit „kteroukoli část\"", () => {
  // Propagace v PUT bere hodnoty z EDITOVANÉHO bloku a rozešle je na sourozence —
  // původní text tedy naváděl přepsat správnou hodnotu tou špatnou.
  const c = HEALTH_COPY.splitFieldsDiverged;
  assert.equal(c.coStim.includes("kteroukoli"), false);
  assert.match(c.coStim, /správné hodnoty/);
  assert.match(c.coStim, /na pořadí záleží/);
});

test("copyFor: neznámý klíč vrací null, ne výjimku", () => {
  assert.equal(copyFor("neexistuje"), null);
});
