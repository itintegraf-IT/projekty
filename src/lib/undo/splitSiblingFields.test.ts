import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSplitEditTargets } from "./splitSiblingFields";
import { SPLIT_SHARED_FIELDS } from "../splitSharedFields";

const SHARED = ["orderNumber", "type"] as const;

test("buildSplitEditTargets: nesdílené pole — sourozenci se do cílů vůbec nezařadí", () => {
  // Scénář z review (I1): plánovač otevře část 1/3 rozdělené zakázky a zaškrtne jen
  // OBALKA — server ho na sourozence nikdy nepropaguje (není v SPLIT_SHARED_FIELDS),
  // takže sourozenci nemají v undo kroku co dělat.
  const { beforeTargets, afterTargets } = buildSplitEditTargets(
    ["obalka"], SHARED,
    { id: 1, updatedAt: "a1", obalka: false },
    { id: 1, updatedAt: "a2", obalka: true },
    [{ id: 2, updatedAt: "b1", obalka: false }],
    [{ id: 2, updatedAt: "b1", obalka: false }],
  );
  assert.equal(beforeTargets.length, 1, "žádný sourozenec v before");
  assert.equal(afterTargets.length, 1, "žádný sourozenec v after");
  assert.deepEqual(beforeTargets[0].fields, { obalka: false });
  assert.deepEqual(afterTargets[0].fields, { obalka: true });
});

test("buildSplitEditTargets: smíšená editace — primár nese VŠECHNA pole, sourozenec jen sdílený průnik ZE SVÝCH hodnot", () => {
  // Sourozenec má ZÁMĚRNĚ jinou hodnotu orderNumber i jiný updatedAt než primár (ne jen
  // jinak pojmenované stejné hodnoty) — jinak by mutace „čti fields/updatedAt z primáru
  // místo ze sourozence" prošla nepoznaná (re-recenze Fix round 1, test gap).
  const { beforeTargets, afterTargets } = buildSplitEditTargets(
    ["locked", "orderNumber"], SHARED,
    { id: 1, updatedAt: "a1", locked: false, orderNumber: "PRIM-OLD" },
    { id: 1, updatedAt: "a2", locked: true, orderNumber: "PRIM-NEW" },
    [{ id: 2, updatedAt: "b1", locked: false, orderNumber: "SIB-OLD" }],
    [{ id: 2, updatedAt: "b2", locked: false, orderNumber: "SIB-NEW" }],
  );
  assert.deepEqual(beforeTargets[0].fields, { locked: false, orderNumber: "PRIM-OLD" }, "primár nese celý changedFields ze svých hodnot");
  assert.deepEqual(afterTargets[0].fields, { locked: true, orderNumber: "PRIM-NEW" });
  assert.equal(beforeTargets.length, 2, "sourozenec se zařadí, protože orderNumber je sdílené");
  assert.equal(afterTargets.length, 2);
  assert.equal(beforeTargets[1].id, 2);
  assert.equal(beforeTargets[1].updatedAt, "b1", "sourozenec musí nést SVOJI updatedAt, ne primárovu");
  assert.deepEqual(beforeTargets[1].fields, { orderNumber: "SIB-OLD" }, "sourozenec nese SVOJI hodnotu (ne primárovu) a NEnese locked — server ho nikdy nepropaguje");
  assert.equal(afterTargets[1].updatedAt, "b2");
  assert.deepEqual(afterTargets[1].fields, { orderNumber: "SIB-NEW" });
});

test("buildSplitEditTargets: materialIssued se vrací sourozencům (regrese Fix round 2)", () => {
  // Fix round 1 počítal průnik proti zastaralé klientské kopii SPLIT_SHARED_FIELDS, která
  // materialIssued (a 4 další pole) postrádala — sourozenci ho tak přestali dostávat v undo
  // kroku, i když ho server na ně dál propaguje (api/blocks/[id]/route.ts). Test importuje
  // SKUTEČNÝ sdílený seznam (ne lokální mock), takže hlídá i budoucí regresi stejné třídy.
  const { beforeTargets, afterTargets } = buildSplitEditTargets(
    ["materialIssued"], SPLIT_SHARED_FIELDS,
    { id: 1, updatedAt: "a1", materialIssued: false },
    { id: 1, updatedAt: "a2", materialIssued: true },
    [{ id: 2, updatedAt: "b1", materialIssued: false }],
    [{ id: 2, updatedAt: "b2", materialIssued: true }],
  );
  assert.equal(beforeTargets.length, 2, "sourozenec se zařadí — materialIssued JE sdílené pole (server ho propaguje)");
  assert.equal(afterTargets.length, 2);
  assert.deepEqual(beforeTargets[1].fields, { materialIssued: false });
  assert.deepEqual(afterTargets[1].fields, { materialIssued: true });
});

test("buildSplitEditTargets: bez sourozenců funguje jako prostá editace primárního bloku", () => {
  const { beforeTargets, afterTargets } = buildSplitEditTargets(
    ["orderNumber"], SHARED,
    { id: 1, updatedAt: "a1", orderNumber: "OLD" },
    { id: 1, updatedAt: "a2", orderNumber: "NEW" },
    [], [],
  );
  assert.equal(beforeTargets.length, 1);
  assert.equal(afterTargets.length, 1);
});

test("buildSplitEditTargets: víc sourozenců — všichni dostanou stejný sdílený průnik, žádný se neztratí", () => {
  const { beforeTargets, afterTargets } = buildSplitEditTargets(
    ["type"], SHARED,
    { id: 1, updatedAt: "a1", type: "REZERVACE" },
    { id: 1, updatedAt: "a2", type: "ZAKAZKA" },
    [{ id: 2, updatedAt: "b1", type: "REZERVACE" }, { id: 3, updatedAt: "c1", type: "REZERVACE" }],
    [{ id: 2, updatedAt: "b2", type: "ZAKAZKA" }, { id: 3, updatedAt: "c2", type: "ZAKAZKA" }],
  );
  assert.equal(beforeTargets.length, 3);
  assert.equal(afterTargets.length, 3);
  assert.deepEqual(beforeTargets.map((t) => t.id), [1, 2, 3]);
  assert.deepEqual(afterTargets.map((t) => t.id), [1, 2, 3]);
});

// ─── symetrie siblingsOld/siblingsNew (review M3) ────────────────────────────
// Sourozenec bez páru na druhé straně nesmí rozjet beforeTargets/afterTargets na
// různou délku — jinak by expectedUpdatedAt cíle bez páru vyšlo undefined a
// buildMultiEditCommand by shodilo StaleUndoError i tu polovinu kroku, co byla v pořádku.

test("buildSplitEditTargets: sourozenec chybí v siblingsNew (jen v siblingsOld) — vypadne z OBOU stran", () => {
  const { beforeTargets, afterTargets } = buildSplitEditTargets(
    ["type"], SHARED,
    { id: 1, updatedAt: "a1", type: "REZERVACE" },
    { id: 1, updatedAt: "a2", type: "ZAKAZKA" },
    [{ id: 2, updatedAt: "b1", type: "REZERVACE" }, { id: 3, updatedAt: "c1", type: "REZERVACE" }], // 3 je jen tady
    [{ id: 2, updatedAt: "b2", type: "ZAKAZKA" }],
  );
  assert.equal(beforeTargets.length, 2, "primár + jen sourozenec 2 (3 nemá pár)");
  assert.equal(afterTargets.length, 2);
  assert.deepEqual(beforeTargets.map((t) => t.id), [1, 2]);
  assert.deepEqual(afterTargets.map((t) => t.id), [1, 2]);
});

test("buildSplitEditTargets: sourozenec chybí v siblingsOld (jen v siblingsNew) — vypadne z OBOU stran", () => {
  const { beforeTargets, afterTargets } = buildSplitEditTargets(
    ["type"], SHARED,
    { id: 1, updatedAt: "a1", type: "REZERVACE" },
    { id: 1, updatedAt: "a2", type: "ZAKAZKA" },
    [{ id: 2, updatedAt: "b1", type: "REZERVACE" }],
    [{ id: 2, updatedAt: "b2", type: "ZAKAZKA" }, { id: 3, updatedAt: "c2", type: "ZAKAZKA" }], // 3 je jen tady
  );
  assert.equal(beforeTargets.length, 2, "primár + jen sourozenec 2 (3 nemá pár)");
  assert.equal(afterTargets.length, 2);
  assert.deepEqual(beforeTargets.map((t) => t.id), [1, 2]);
  assert.deepEqual(afterTargets.map((t) => t.id), [1, 2]);
});
