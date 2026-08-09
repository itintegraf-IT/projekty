import { test } from "node:test";
import assert from "node:assert/strict";
import { suppressCoveredColumns, groupsWithAddressedTarget, sortHistoryEntries, type BlockHistoryEntry } from "./blockHistory";

test("sloupec pokrytý auditem se z revize odečte", () => {
  const out = suppressCoveredColumns(
    { deadlineExpedice: null, endTime: new Date("2026-08-08T14:00:00Z") },
    { deadlineExpedice: new Date("2026-08-12T00:00:00Z"), endTime: new Date("2026-08-08T18:00:00Z") },
    [{ action: "UPDATE", field: "deadlineExpedice", newValue: "2026-08-12" }],
  );
  assert.ok(out);
  assert.deepEqual(Object.keys(out.after), ["endTime"], "poziční změna zůstává viditelná");
});

test("když audit pokryje všechno, revize zmizí", () => {
  const out = suppressCoveredColumns(
    { deadlineExpedice: null },
    { deadlineExpedice: new Date("2026-08-12T00:00:00Z") },
    [{ action: "UPDATE", field: "deadlineExpedice", newValue: "2026-08-12" }],
  );
  assert.equal(out, null);
});

test("CREATE pokrývá celý řádek", () => {
  const out = suppressCoveredColumns({ machine: "XL_105" }, { machine: "XL_106" }, [
    { action: "CREATE", field: null, newValue: null },
  ]);
  assert.equal(out, null);
});

test("bez auditních řádků zůstane revize celá", () => {
  const out = suppressCoveredColumns({ machine: "XL_105" }, { machine: "XL_106" }, []);
  assert.ok(out);
  assert.deepEqual(Object.keys(out.after), ["machine"]);
});

test("AUTO_SHIFT potlačí obě poloviny posunu", () => {
  const out = suppressCoveredColumns(
    { startTime: new Date("2026-08-08T06:00:00Z"), endTime: new Date("2026-08-08T14:00:00Z") },
    { startTime: new Date("2026-08-09T06:00:00Z"), endTime: new Date("2026-08-09T14:00:00Z") },
    [{ action: "AUTO_SHIFT", field: "startTime/endTime", newValue: "2026-08-09T06:00:00.000Z" }],
  );
  assert.equal(out, null);
});

/**
 * Kvůli TOMUHLE tvaru je třetí parametr celý auditní řádek včetně `newValue`,
 * ne jen dvojice (action, field): undo/redo píše seznam vrácených sloupců do
 * `newValue`, `field` nese jen marker "fields". Bez `newValue` by mapa pokrytí
 * vrátila prázdno a panel by tytéž změny vykreslil dvakrát.
 */
test("undo obchodních polí potlačí sloupce vyjmenované v newValue", () => {
  const out = suppressCoveredColumns(
    { dataOk: false, materialNote: null },
    { dataOk: true, materialNote: "dorazí v pátek" },
    [{ action: "UNDO", field: "fields", newValue: "dataOk, materialNote" }],
  );
  assert.equal(out, null);
});

/**
 * Poziční undo řádek jmenuje `machine` ve `field`, ale do hodnot zapisuje POUZE
 * časový span — stroj v něm čtenář nevidí. Revize je tedy jediné místo, kde je
 * změna stroje zaznamenaná, a potlačit se nesmí (Task 10, fix 375f5a2d).
 */
test("poziční undo nepotlačí stroj — jinak by změna stroje zmizela z historie", () => {
  const out = suppressCoveredColumns(
    { machine: "XL_106", startTime: new Date("2026-08-09T06:00:00Z"), endTime: new Date("2026-08-09T14:00:00Z") },
    { machine: "XL_105", startTime: new Date("2026-08-08T06:00:00Z"), endTime: new Date("2026-08-08T14:00:00Z") },
    [{ action: "UNDO", field: "startTime/endTime/machine", newValue: "2026-08-08T06:00…–14:00" }],
  );
  assert.ok(out);
  assert.deepEqual(Object.keys(out.after), ["machine"]);
});

/** Klíč, který v „před" chybí (Json bez hodnoty), musí vyjít jako null, ne undefined. */
test("chybějící hodnota v před se doplní na null", () => {
  const out = suppressCoveredColumns({}, { description: "Katalog léto" }, []);
  assert.ok(out);
  assert.equal(out.before.description, null);
  assert.equal(out.after.description, "Katalog léto");
});

// ─── groupsWithAddressedTarget ────────────────────────────────────────────────

/**
 * Propagace = „cílem byl NĚKDO JINÝ, mě to zasáhlo jako člena množiny".
 * Uložení sdíleného pole na hlavě splitu: hlava adresně (`update`, viaMany=false),
 * sourozenci hromadně (`updateMany`, viaMany=true).
 */
test("skupina s adresným cílem: sourozenec splitu je propagace", () => {
  const addressed = groupsWithAddressedTarget([
    { groupId: "g1", viaMany: false }, // hlava
    { groupId: "g1", viaMany: true },  // sourozenec
  ]);
  assert.ok(addressed.has("g1"));
});

/**
 * Expediční přeřazení: routa staví `targetIds` z CELÉ skupiny, takže přes
 * `updateMany` projde i primární blok a všichni mají viaMany=true. Skupina
 * samých `true` znamená „nikdo nebyl jmenován adresně" — je to pravda, ne chyba,
 * ale propagace to NENÍ a panel to tak nesmí označit.
 */
test("skupina samých viaMany (expediční přeřazení) není propagace", () => {
  const addressed = groupsWithAddressedTarget([
    { groupId: "g2", viaMany: true },
    { groupId: "g2", viaMany: true },
    { groupId: "g2", viaMany: true },
  ]);
  assert.equal(addressed.has("g2"), false);
});

test("skupiny se vyhodnocují nezávisle", () => {
  const addressed = groupsWithAddressedTarget([
    { groupId: "g1", viaMany: true },
    { groupId: "g1", viaMany: false },
    { groupId: "g2", viaMany: true },
  ]);
  assert.deepEqual([...addressed], ["g1"]);
});

test("prázdný vstup nedá žádnou skupinu", () => {
  assert.equal(groupsWithAddressedTarget([]).size, 0);
});

// ── sortHistoryEntries (O2, nález z proklikávání 9. 8. 2026) ──────────────────
// Revize se zapisují až v EPILOGU transakce (withRevision volá blockRevision.createMany
// po doběhnutí těla), auditní řádky uvnitř těla — revize téže transakce má proto vždy
// pozdější razítko. NENÍ to o přesnosti sloupců, oba jsou datetime(3).

const auditEntry = (over: Partial<BlockHistoryEntry & { source: "audit" }> = {}) => ({
  source: "audit" as const, id: 1, createdAt: "2026-08-09T14:51:03.512Z", groupId: "G1",
  username: "v.tokan", action: "UNDO", field: "startTime/endTime/machine",
  oldValue: null, newValue: null, orderNumber: "18681", ...over,
});
const revisionEntry = (over: Partial<BlockHistoryEntry & { source: "revision" }> = {}) => ({
  source: "revision" as const, id: 10, createdAt: "2026-08-09T14:51:03.758Z", groupId: "G1",
  username: "v.tokan", action: "UNDO", label: "Krok zpět", propagated: false,
  lines: ["Délka tisku: 1,5h → 1h"], ...over,
});

test("O2: revize NESMÍ předběhnout auditní řádek téže transakce (zapisuje se v epilogu)", () => {
  const out = sortHistoryEntries([auditEntry(), revisionEntry()]);
  assert.deepEqual(out.map((e) => e.source), ["audit", "revision"],
    "nejdřív příčina (↶ vráceno zpět), pak doplňující revize");
});

test("O2: pořadí vstupu na výsledek nemá vliv", () => {
  const out = sortHistoryEntries([revisionEntry(), auditEntry()]);
  assert.deepEqual(out.map((e) => e.source), ["audit", "revision"]);
});

test("O2: skupina drží pohromadě — starší skupina se mezi její řádky nevloží", () => {
  const out = sortHistoryEntries([
    auditEntry({ id: 1, createdAt: "2026-08-09T14:51:03.512Z", groupId: "G1" }),
    revisionEntry({ id: 10, createdAt: "2026-08-09T14:51:03.758Z", groupId: "G1" }),
    auditEntry({ id: 2, createdAt: "2026-08-09T14:51:03.180Z", groupId: "G0" }),
    revisionEntry({ id: 9, createdAt: "2026-08-09T14:51:03.400Z", groupId: "G0" }),
  ]);
  assert.deepEqual(out.map((e) => e.id), [1, 10, 2, 9],
    "G1 (novější revize) celá nahoře, teprve pak celá G0");
});

test("O2: víc auditních řádků jedné skupiny stojí před její revizí", () => {
  const out = sortHistoryEntries([
    revisionEntry({ id: 10 }),
    auditEntry({ id: 3 }),
    auditEntry({ id: 1 }),
    auditEntry({ id: 2 }),
  ]);
  assert.deepEqual(out.map((e) => e.id), [3, 2, 1, 10], "audit sestupně dle id, revize až za nimi");
});

test("O2: historické řádky bez groupId se řadí podle vlastního času (beze změny chování)", () => {
  const out = sortHistoryEntries([
    auditEntry({ id: 1, groupId: null, createdAt: "2026-08-03T11:14:16.000Z" }),
    auditEntry({ id: 2, groupId: null, createdAt: "2026-08-07T15:31:00.000Z" }),
    auditEntry({ id: 3, groupId: null, createdAt: "2026-08-05T08:14:15.000Z" }),
  ]);
  assert.deepEqual(out.map((e) => e.id), [2, 3, 1], "sestupně podle času");
});

test("O2: řádek bez groupId se nesmí přilepit ke skupině se shodným časem", () => {
  const out = sortHistoryEntries([
    auditEntry({ id: 1, groupId: "G1", createdAt: "2026-08-09T14:51:03.512Z" }),
    revisionEntry({ id: 10, groupId: "G1", createdAt: "2026-08-09T14:51:03.758Z" }),
    auditEntry({ id: 5, groupId: null, createdAt: "2026-08-09T14:51:03.512Z" }),
  ]);
  // Osamocený řádek má vlastní klíč (…03.512) — je starší než klíč skupiny (…03.758).
  assert.deepEqual(out.map((e) => e.id), [1, 10, 5]);
});

test("O2: vstupní pole se nemutuje", () => {
  const input = [revisionEntry(), auditEntry()];
  const before = input.map((e) => e.id);
  sortHistoryEntries(input);
  assert.deepEqual(input.map((e) => e.id), before, "sort musí pracovat nad kopií");
});
