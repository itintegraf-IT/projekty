import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUserFacets } from "./auditFacets";

test("buildUserFacets: aktivní uživatelé mají hasActivity=true", () => {
  const out = buildUserFacets(
    [{ username: "vojta", role: "ADMIN" }, { username: "nahled", role: "VIEWER" }],
    ["vojta"],
  );
  const vojta = out.find((u) => u.username === "vojta");
  const nahled = out.find((u) => u.username === "nahled");
  assert.equal(vojta?.hasActivity, true);
  assert.equal(nahled?.hasActivity, false);
  assert.equal(vojta?.role, "ADMIN");
});

test("buildUserFacets: smazaný účet z auditu je doplněn s role=null", () => {
  const out = buildUserFacets(
    [{ username: "vojta", role: "ADMIN" }],
    ["vojta", "byvaly_planovac"],
  );
  const deleted = out.find((u) => u.username === "byvaly_planovac");
  assert.ok(deleted, "smazaný účet musí být v seznamu");
  assert.equal(deleted?.role, null);
  assert.equal(deleted?.hasActivity, true);
});

test("buildUserFacets: aktivní řazeni před neaktivní, uvnitř abecedně", () => {
  const out = buildUserFacets(
    [
      { username: "zdenka", role: "DTP" },   // neaktivní
      { username: "bara", role: "MTZ" },     // aktivní
      { username: "adam", role: "VIEWER" },  // neaktivní
    ],
    ["bara"],
  );
  assert.deepEqual(out.map((u) => u.username), ["bara", "adam", "zdenka"]);
});

test("buildUserFacets: prázdný vstup vrací prázdné pole", () => {
  assert.deepEqual(buildUserFacets([], []), []);
});
