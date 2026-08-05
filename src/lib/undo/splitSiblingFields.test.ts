import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSplitEditTargets, buildSplitEditTargetsWithShifted, buildPassiveSiblingTargets, mergePositionIntoTargets } from "./splitSiblingFields";
import { SPLIT_SHARED_FIELDS } from "../splitSharedFields";
import type { BlockSnapshot, EditSnapshot } from "./types";

const SHARED = ["orderNumber", "type"] as const;

// `over` smí nést i business pole (type, orderNumber, ...) BEZ `as never` —
// reálný call site (`toFullSnap` v PlannerPage.tsx, oprava C-1) posílá plný
// blok, ne holý BlockSnapshot. `Record<string, unknown>` v průniku dovolí
// libovolné extra klíče přirozeně typované, takže fixtura odpovídá
// produkčnímu tvaru dat místo aby ho smluvně předstírala castem.
function pos(
  over: Partial<BlockSnapshot> & Record<string, unknown> & { id: number; updatedAt: string },
): BlockSnapshot {
  return {
    startTime: "2026-09-02T06:00:00.000Z", endTime: "2026-09-02T08:00:00.000Z",
    machine: "XL_105", printMinutes: 120, scheduleBypassed: false,
    ...over,
  };
}

test("buildSplitEditTargets: nesdílené pole — sourozenci se do cílů vůbec nezařadí", () => {
  // Scénář z review (I1): plánovač otevře část 1/3 rozdělené zakázky a zaškrtne jen
  // OBALKA — server ho na sourozence nikdy nepropaguje (není v SPLIT_SHARED_FIELDS),
  // takže sourozenci nemají v undo kroku co dělat.
  const { beforeTargets, afterTargets } = buildSplitEditTargets({
    changedFields: ["obalka"], sharedFields: SHARED,
    before: { id: 1, updatedAt: "a1", obalka: false },
    after: { id: 1, updatedAt: "a2", obalka: true },
    siblingsOld: [{ id: 2, updatedAt: "b1", obalka: false }],
    siblingsNew: [{ id: 2, updatedAt: "b1", obalka: false }],
  });
  assert.equal(beforeTargets.length, 1, "žádný sourozenec v before");
  assert.equal(afterTargets.length, 1, "žádný sourozenec v after");
  assert.deepEqual(beforeTargets[0].fields, { obalka: false });
  assert.deepEqual(afterTargets[0].fields, { obalka: true });
});

test("buildSplitEditTargets: smíšená editace — primár nese VŠECHNA pole, sourozenec jen sdílený průnik ZE SVÝCH hodnot", () => {
  // Sourozenec má ZÁMĚRNĚ jinou hodnotu orderNumber i jiný updatedAt než primár (ne jen
  // jinak pojmenované stejné hodnoty) — jinak by mutace „čti fields/updatedAt z primáru
  // místo ze sourozence" prošla nepoznaná (re-recenze Fix round 1, test gap).
  const { beforeTargets, afterTargets } = buildSplitEditTargets({
    changedFields: ["locked", "orderNumber"], sharedFields: SHARED,
    before: { id: 1, updatedAt: "a1", locked: false, orderNumber: "PRIM-OLD" },
    after: { id: 1, updatedAt: "a2", locked: true, orderNumber: "PRIM-NEW" },
    siblingsOld: [{ id: 2, updatedAt: "b1", locked: false, orderNumber: "SIB-OLD" }],
    siblingsNew: [{ id: 2, updatedAt: "b2", locked: false, orderNumber: "SIB-NEW" }],
  });
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
  const { beforeTargets, afterTargets } = buildSplitEditTargets({
    changedFields: ["materialIssued"], sharedFields: SPLIT_SHARED_FIELDS,
    before: { id: 1, updatedAt: "a1", materialIssued: false },
    after: { id: 1, updatedAt: "a2", materialIssued: true },
    siblingsOld: [{ id: 2, updatedAt: "b1", materialIssued: false }],
    siblingsNew: [{ id: 2, updatedAt: "b2", materialIssued: true }],
  });
  assert.equal(beforeTargets.length, 2, "sourozenec se zařadí — materialIssued JE sdílené pole (server ho propaguje)");
  assert.equal(afterTargets.length, 2);
  assert.deepEqual(beforeTargets[1].fields, { materialIssued: false });
  assert.deepEqual(afterTargets[1].fields, { materialIssued: true });
});

test("buildSplitEditTargets: bez sourozenců funguje jako prostá editace primárního bloku", () => {
  const { beforeTargets, afterTargets } = buildSplitEditTargets({
    changedFields: ["orderNumber"], sharedFields: SHARED,
    before: { id: 1, updatedAt: "a1", orderNumber: "OLD" },
    after: { id: 1, updatedAt: "a2", orderNumber: "NEW" },
    siblingsOld: [], siblingsNew: [],
  });
  assert.equal(beforeTargets.length, 1);
  assert.equal(afterTargets.length, 1);
});

test("buildSplitEditTargets: víc sourozenců — všichni dostanou stejný sdílený průnik, žádný se neztratí", () => {
  const { beforeTargets, afterTargets } = buildSplitEditTargets({
    changedFields: ["type"], sharedFields: SHARED,
    before: { id: 1, updatedAt: "a1", type: "REZERVACE" },
    after: { id: 1, updatedAt: "a2", type: "ZAKAZKA" },
    siblingsOld: [{ id: 2, updatedAt: "b1", type: "REZERVACE" }, { id: 3, updatedAt: "c1", type: "REZERVACE" }],
    siblingsNew: [{ id: 2, updatedAt: "b2", type: "ZAKAZKA" }, { id: 3, updatedAt: "c2", type: "ZAKAZKA" }],
  });
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
  const { beforeTargets, afterTargets } = buildSplitEditTargets({
    changedFields: ["type"], sharedFields: SHARED,
    before: { id: 1, updatedAt: "a1", type: "REZERVACE" },
    after: { id: 1, updatedAt: "a2", type: "ZAKAZKA" },
    siblingsOld: [{ id: 2, updatedAt: "b1", type: "REZERVACE" }, { id: 3, updatedAt: "c1", type: "REZERVACE" }], // 3 je jen tady
    siblingsNew: [{ id: 2, updatedAt: "b2", type: "ZAKAZKA" }],
  });
  assert.equal(beforeTargets.length, 2, "primár + jen sourozenec 2 (3 nemá pár)");
  assert.equal(afterTargets.length, 2);
  assert.deepEqual(beforeTargets.map((t) => t.id), [1, 2]);
  assert.deepEqual(afterTargets.map((t) => t.id), [1, 2]);
});

test("buildSplitEditTargets: sourozenec chybí v siblingsOld (jen v siblingsNew) — vypadne z OBOU stran", () => {
  const { beforeTargets, afterTargets } = buildSplitEditTargets({
    changedFields: ["type"], sharedFields: SHARED,
    before: { id: 1, updatedAt: "a1", type: "REZERVACE" },
    after: { id: 1, updatedAt: "a2", type: "ZAKAZKA" },
    siblingsOld: [{ id: 2, updatedAt: "b1", type: "REZERVACE" }],
    siblingsNew: [{ id: 2, updatedAt: "b2", type: "ZAKAZKA" }, { id: 3, updatedAt: "c2", type: "ZAKAZKA" }], // 3 je jen tady
  });
  assert.equal(beforeTargets.length, 2, "primár + jen sourozenec 2 (3 nemá pár)");
  assert.equal(afterTargets.length, 2);
  assert.deepEqual(beforeTargets.map((t) => t.id), [1, 2]);
  assert.deepEqual(afterTargets.map((t) => t.id), [1, 2]);
});

// ─── buildSplitEditTargetsWithShifted (C1c) ──────────────────────────────────

test("buildSplitEditTargetsWithShifted: bez odsunutých sourozenců se chová jako buildSplitEditTargets", () => {
  const res = buildSplitEditTargetsWithShifted({
    changedFields: ["orderNumber"], sharedFields: SHARED,
    before: { id: 1, updatedAt: "a1", orderNumber: "OLD" },
    after: { id: 1, updatedAt: "a2", orderNumber: "NEW" },
    siblingsOld: [], siblingsNew: [],
    shiftedSplitSiblingsOld: [], shiftedSplitSiblingsNew: [],
  });
  assert.equal(res.beforeTargets.length, 1);
  assert.equal(res.afterTargets.length, 1);
  assert.equal(res.absorbedShiftedIds.size, 0);
});

test("buildSplitEditTargetsWithShifted: chain-pushnutý sourozenec dostane sdílené pole I pozici v JEDNOM cíli (C1c)", () => {
  // Typ na hlavě se mění REZERVACE→ZAKAZKA (sdílené pole `type`), chain push zároveň
  // odsune ocas na nové místo — server ho vyloučí ze `siblings` (je v `shifted`).
  const res = buildSplitEditTargetsWithShifted({
    changedFields: ["type"], sharedFields: SPLIT_SHARED_FIELDS,
    before: { id: 1, updatedAt: "a1", type: "REZERVACE" },
    after: { id: 1, updatedAt: "a2", type: "ZAKAZKA" },
    siblingsOld: [], siblingsNew: [], // server ho do siblings NEDAL
    shiftedSplitSiblingsOld: [pos({ id: 9, updatedAt: "s1", type: "REZERVACE", startTime: "2026-09-02T08:00:00.000Z", endTime: "2026-09-02T10:00:00.000Z" })],
    shiftedSplitSiblingsNew: [pos({ id: 9, updatedAt: "s2", type: "ZAKAZKA", startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z" })],
  });
  assert.equal(res.beforeTargets.length, 2, "primár + pohlcený odsunutý soused");
  assert.deepEqual([...res.absorbedShiftedIds], [9]);
  const sibBefore = res.beforeTargets.find((t) => t.id === 9)!;
  const sibAfter = res.afterTargets.find((t) => t.id === 9)!;
  assert.equal(sibBefore.updatedAt, "s1", "soused nese SVOJI updatedAt (pro expectedUpdatedAt)");
  assert.deepEqual(sibBefore.fields, {
    type: "REZERVACE",
    startTime: "2026-09-02T08:00:00.000Z", endTime: "2026-09-02T10:00:00.000Z",
    machine: "XL_105", printMinutes: 120, scheduleBypassed: false,
  }, "sdílené pole I pozice v jednom fields objektu — jinak by sanitizeUndoOps odmítl duplicitní id v dávce");
  assert.equal(sibAfter.updatedAt, "s2");
  assert.deepEqual(sibAfter.fields, {
    type: "ZAKAZKA",
    startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z",
    machine: "XL_105", printMinutes: 120, scheduleBypassed: false,
  });
});

test("buildSplitEditTargetsWithShifted: odsunutý soused BEZ změny sdíleného pole zůstává jen pozicí volajícího (absorbedShiftedIds prázdné)", () => {
  // Sourozenec byl chain-pushnut, ale žádné sdílené pole se pro něj nezměnilo
  // (typ se nemění, jen orderNumber a to zrovna NENÍ v changedFields tady) —
  // nesmí se objevit v beforeTargets/afterTargets, jinak by ho volající vyřadil
  // ze svého pozičního seznamu a jeho návrat na místo by z dávky úplně vypadl.
  const res = buildSplitEditTargetsWithShifted({
    changedFields: ["locked"], sharedFields: SPLIT_SHARED_FIELDS, // locked NENÍ sdílené
    before: { id: 1, updatedAt: "a1", locked: false },
    after: { id: 1, updatedAt: "a2", locked: true },
    siblingsOld: [], siblingsNew: [],
    shiftedSplitSiblingsOld: [pos({ id: 9, updatedAt: "s1" })],
    shiftedSplitSiblingsNew: [pos({ id: 9, updatedAt: "s2", startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z" })],
  });
  assert.equal(res.beforeTargets.length, 1, "jen primár — soused nemá žádné reálně změněné sdílené pole");
  assert.equal(res.absorbedShiftedIds.size, 0, "MUTAČNÍ POJISTKA: kdyby se pohltil bezdůvodně, volající by ho chybně vyřadil z pozičního seznamu");
});

test("buildSplitEditTargetsWithShifted: POJISTKA — odsunutý soused s ochuzeným snapshotem (bez business polí) se nepohltí ani nezůstane duchem ve sdílených cílech (C-1, kontrola po etapě 5. 8. 2026)", () => {
  // Simuluje regresi C-1: `type` na primáru SE MĚNÍ (sdílené pole, sharedChanged
  // neprázdné), ale shiftedSplitSiblingsOld/New jsou postavené jako holý
  // BlockSnapshot BEZ business polí — přesně tvar, jaký dřív posílal `toSnap` na
  // místě, kam patřil `toFullSnap`. pickShared by na sourozenci četla `type` jako
  // undefined, které JSON.stringify na cestě k serveru tiše vyhodí z payloadu.
  // Na rozdíl od testu výš ("BEZ změny sdíleného pole") tady sharedChanged
  // NENÍ prázdné — absorpce se doopravdy spustí a pojistka ji musí zastavit.
  const res = buildSplitEditTargetsWithShifted({
    changedFields: ["type"], sharedFields: SHARED,
    before: { id: 1, updatedAt: "a1", type: "REZERVACE" },
    after: { id: 1, updatedAt: "a2", type: "ZAKAZKA" },
    siblingsOld: [], siblingsNew: [],
    shiftedSplitSiblingsOld: [pos({ id: 9, updatedAt: "s1" })], // BEZ type
    shiftedSplitSiblingsNew: [pos({ id: 9, updatedAt: "s2", startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z" })], // BEZ type
  });
  assert.equal(res.beforeTargets.length, 1, "jen primár — ochuzený soused se nesmí objevit ani jako prázdný duch");
  assert.equal(res.afterTargets.length, 1);
  assert.equal(res.beforeTargets.find((t) => t.id === 9), undefined, "id 9 nesmí být ve sdílených cílech vůbec");
  assert.equal(res.afterTargets.find((t) => t.id === 9), undefined);
  assert.equal(res.absorbedShiftedIds.size, 0, "soused NEBYL pohlcen — volající ho MUSÍ nechat v pozičním seznamu, jinak zmizí úplně (duch by ho odtud vyřadil, a přitom by sám nic neuchoval)");
});

test("buildSplitEditTargetsWithShifted: víc odsunutých sourozenců — jen ti se skutečně změněným sdíleným polem se pohltí", () => {
  const res = buildSplitEditTargetsWithShifted({
    changedFields: ["type"], sharedFields: SHARED,
    before: { id: 1, updatedAt: "a1", type: "REZERVACE" },
    after: { id: 1, updatedAt: "a2", type: "ZAKAZKA" },
    siblingsOld: [{ id: 2, updatedAt: "b1", type: "REZERVACE" }],
    siblingsNew: [{ id: 2, updatedAt: "b2", type: "ZAKAZKA" }],
    shiftedSplitSiblingsOld: [pos({ id: 9, updatedAt: "s1", type: "REZERVACE" })],
    shiftedSplitSiblingsNew: [pos({ id: 9, updatedAt: "s2", type: "ZAKAZKA" })],
  });
  assert.equal(res.beforeTargets.length, 3, "primár + běžný soused (siblings) + odsunutý soused (shifted)");
  assert.deepEqual([...res.absorbedShiftedIds], [9]);
  assert.deepEqual(res.beforeTargets.map((t) => t.id).sort(), [1, 2, 9]);
});

// ─── buildPassiveSiblingTargets (C1b) ────────────────────────────────────────

test("buildPassiveSiblingTargets: sourozenec se skutečně změněným sdíleným polem se zařadí s POUZE tím polem", () => {
  const { beforeTargets, afterTargets } = buildPassiveSiblingTargets(SPLIT_SHARED_FIELDS, [
    { old: { id: 9, updatedAt: "s1", type: "REZERVACE", orderNumber: "17300" }, live: { id: 9, updatedAt: "s2", type: "ZAKAZKA", orderNumber: "17300" } },
  ]);
  assert.equal(beforeTargets.length, 1);
  assert.equal(afterTargets.length, 1);
  assert.deepEqual(beforeTargets[0].fields, { type: "REZERVACE" }, "jen type se změnil — orderNumber NESMÍ být ve fields, i když je sdílené");
  assert.deepEqual(afterTargets[0].fields, { type: "ZAKAZKA" });
  assert.equal(beforeTargets[0].updatedAt, "s1");
  assert.equal(afterTargets[0].updatedAt, "s2");
});

test("buildPassiveSiblingTargets: pár beze změny sdíleného pole se do výsledku vůbec nezařadí", () => {
  // MUTAČNÍ POJISTKA: kdyby funkce zařazovala páry bez ohledu na skutečnou změnu,
  // C1b by zbytečně poslalo no-op upsert za KAŽDÉHO člena split skupiny při
  // KAŽDÉM překlopení — neškodilo by to datově, ale bylo by to šum v audit logu
  // a zbytečné riziko StaleUndoError z cizí nesouvisející změny.
  const { beforeTargets, afterTargets } = buildPassiveSiblingTargets(SPLIT_SHARED_FIELDS, [
    { old: { id: 9, updatedAt: "s1", type: "ZAKAZKA" }, live: { id: 9, updatedAt: "s1", type: "ZAKAZKA" } },
  ]);
  assert.equal(beforeTargets.length, 0);
  assert.equal(afterTargets.length, 0);
});

test("buildPassiveSiblingTargets: víc párů — jen ty se změnou se zařadí, žádný cizí únik polí mezi páry", () => {
  const { beforeTargets, afterTargets } = buildPassiveSiblingTargets(["type", "orderNumber"], [
    { old: { id: 9, updatedAt: "s1", type: "REZERVACE", orderNumber: "A" }, live: { id: 9, updatedAt: "s2", type: "ZAKAZKA", orderNumber: "A" } },
    { old: { id: 10, updatedAt: "t1", type: "ZAKAZKA", orderNumber: "B" }, live: { id: 10, updatedAt: "t1", type: "ZAKAZKA", orderNumber: "B" } },
    { old: { id: 11, updatedAt: "u1", type: "ZAKAZKA", orderNumber: "C" }, live: { id: 11, updatedAt: "u2", type: "ZAKAZKA", orderNumber: "D" } },
  ]);
  assert.deepEqual(beforeTargets.map((t) => t.id), [9, 11], "blok 10 nemá žádnou změnu — vypadl");
  assert.deepEqual(afterTargets.map((t) => t.id), [9, 11]);
  assert.deepEqual(beforeTargets[1].fields, { orderNumber: "C" }, "blok 11 nese jen orderNumber (type se neměnil), ne cizí pole bloku 9");
});

// ─── mergePositionIntoTargets (I-1) ──────────────────────────────────────────
// PlannerPage.tsx (recordFlipUndo) i buildSplitEditTargetsWithShifted (C-1) tuhle
// funkci volají, když EditSnapshot cíl (jen business pole) a odsunutý blok
// (jen poziční BlockSnapshot) mají stejné id a MUSÍ skončit v jednom cíli — jinak
// by stejné id bylo ve DVOU cílech jedné dávky a sanitizeUndoOps by ho odmítl (400).

test("mergePositionIntoTargets: cíl se shodným id dostane pozici PŘÍMO do fields (sdílené pole i pozice v jednom cíli)", () => {
  const targets: EditSnapshot[] = [{ id: 9, updatedAt: "s2", fields: { type: "ZAKAZKA" } }];
  const byId = new Map([[9, pos({ id: 9, updatedAt: "s2", startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z" })]]);
  const merged = mergePositionIntoTargets(targets, byId);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 9);
  assert.equal(merged[0].updatedAt, "s2", "updatedAt cíle se nemění — jen fields");
  assert.deepEqual(merged[0].fields, {
    type: "ZAKAZKA",
    startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z",
    machine: "XL_105", printMinutes: 120, scheduleBypassed: false,
  });
});

test("mergePositionIntoTargets: cíl BEZ odpovídajícího záznamu v byId se vrátí beze změny", () => {
  // MUTAČNÍ POJISTKA: cíl mimo byId nesmí dostat cizí pozici (blok 9) ani prázdný
  // objekt — jen cíle, které se REÁLNĚ posunuly (jsou v byId), smí dostat poziční pole.
  const targets: EditSnapshot[] = [{ id: 5, updatedAt: "a1", fields: { type: "ZAKAZKA" } }];
  const byId = new Map([[9, pos({ id: 9, updatedAt: "s2" })]]); // jiné id
  const merged = mergePositionIntoTargets(targets, byId);
  assert.deepEqual(merged, targets);
});

test("mergePositionIntoTargets: prázdné targets vrátí prázdné pole", () => {
  assert.deepEqual(mergePositionIntoTargets([], new Map()), []);
});

test("mergePositionIntoTargets + buildPassiveSiblingTargets: pasivní soused odsunutý chain pushem nese typ I pozici v jednom cíli (I-1 scénář)", () => {
  // Reprodukce I-1: „jen tento blok" překlopí kotvu REZERVACE→ZAKAZKA, server
  // propaguje `type` na pasivního souseda (SPLIT_SHARED_FIELDS) A ZÁROVEŇ ho
  // chain push odsune (re-expanze kotvy přes tiskové hodiny). Bez sloučení by
  // pasivní cíl z buildPassiveSiblingTargets nesl JEN type — Ctrl+Z by vrátil typ,
  // ale nechal blok na odsunuté pozici (díra v plánu).
  const passive = buildPassiveSiblingTargets(SPLIT_SHARED_FIELDS, [
    { old: { id: 9, updatedAt: "s1", type: "REZERVACE" }, live: { id: 9, updatedAt: "s3", type: "ZAKAZKA" } },
  ]);
  assert.deepEqual(passive.beforeTargets[0].fields, { type: "REZERVACE" }, "bez sloučení nese pasivní cíl jen type, žádnou pozici");
  const shiftBeforeById = new Map([[9, pos({ id: 9, updatedAt: "s1", startTime: "2026-09-02T06:00:00.000Z", endTime: "2026-09-02T08:00:00.000Z" })]]);
  const shiftAfterById = new Map([[9, pos({ id: 9, updatedAt: "s3", startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z" })]]);
  const before = mergePositionIntoTargets(passive.beforeTargets, shiftBeforeById);
  const after = mergePositionIntoTargets(passive.afterTargets, shiftAfterById);
  assert.equal(before.length, 1);
  assert.deepEqual(before[0].fields, {
    type: "REZERVACE",
    startTime: "2026-09-02T06:00:00.000Z", endTime: "2026-09-02T08:00:00.000Z",
    machine: "XL_105", printMinutes: 120, scheduleBypassed: false,
  }, "pasivní cíl po sloučení nese type I pozici v jednom fields objektu");
  assert.deepEqual(after[0].fields, {
    type: "ZAKAZKA",
    startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z",
    machine: "XL_105", printMinutes: 120, scheduleBypassed: false,
  });
});
