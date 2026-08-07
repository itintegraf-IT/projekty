import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSplitEditTargets, buildSplitEditTargetsWithShifted, buildPassiveSiblingTargets, mergePositionIntoTargets, mergeAnchorPositionIfChanged, pickShiftedSplitSiblings } from "./splitSiblingFields";
import { accumulateShifted, excludeShiftedTargeted, type ShiftedSnapshots } from "./shiftedBatch";
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

// ─── mergeAnchorPositionIfChanged (etapa A, jeden krok historie) ────────────
// handleBlockUpdate (PlannerPage.tsx) dřív zapisoval poziční mutaci
// (buildMoveOrResizeCommand) VEDLE kroku s business poli (buildMultiEditCommand)
// — oba nesly TYTÉŽ odsunuté sousedy, takže první Ctrl+Z jim zvedl updatedAt
// a druhý na ně narazil se zastaralým snapshotem (StaleUndoError). Tahle
// funkce slije pozici kotvy PŘÍMO do jejího cíle, takže zbyde jeden krok.

test("mergeAnchorPositionIfChanged: změnila se pole I pozice — kotva nese OBOJÍ v jednom cíli", () => {
  const beforeTargets: EditSnapshot[] = [{ id: 1, updatedAt: "a1", fields: { description: "stará" } }];
  const afterTargets: EditSnapshot[] = [{ id: 1, updatedAt: "a2", fields: { description: "nová" } }];
  const prev = pos({ id: 1, updatedAt: "a1" });
  const updated = pos({ id: 1, updatedAt: "a2", startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z" });
  const res = mergeAnchorPositionIfChanged({ beforeTargets, afterTargets, prev, updated });
  assert.equal(res.beforeTargets.length, 1);
  assert.deepEqual(res.beforeTargets[0].fields, {
    description: "stará",
    startTime: "2026-09-02T06:00:00.000Z", endTime: "2026-09-02T08:00:00.000Z",
    machine: "XL_105", printMinutes: 120, scheduleBypassed: false,
  });
  assert.deepEqual(res.afterTargets[0].fields, {
    description: "nová",
    startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z",
    machine: "XL_105", printMinutes: 120, scheduleBypassed: false,
  });
});

test("mergeAnchorPositionIfChanged: změnila se JEN pole (pozice identická) — cíl NENESE žádný poziční klíč", () => {
  // Kdyby se poziční pětice slévala vždycky, undoApply.server.ts (touchesPosition)
  // by čistě polní editaci vykreslil jako poziční audit řádek ("18:00 → 18:00"
  // místo výpisu polí) — přesně bug popsaný v zadání.
  const beforeTargets: EditSnapshot[] = [{ id: 1, updatedAt: "a1", fields: { description: "stará" } }];
  const afterTargets: EditSnapshot[] = [{ id: 1, updatedAt: "a2", fields: { description: "nová" } }];
  const prev = pos({ id: 1, updatedAt: "a1" });
  const updated = pos({ id: 1, updatedAt: "a2" }); // identická pozice
  const res = mergeAnchorPositionIfChanged({ beforeTargets, afterTargets, prev, updated });
  assert.deepEqual(res.beforeTargets[0].fields, { description: "stará" });
  assert.deepEqual(res.afterTargets[0].fields, { description: "nová" });
  for (const key of ["startTime", "endTime", "machine", "printMinutes", "scheduleBypassed"]) {
    assert.equal(key in res.beforeTargets[0].fields, false, `${key} nesmí být v cíli (before)`);
    assert.equal(key in res.afterTargets[0].fields, false, `${key} nesmí být v cíli (after)`);
  }
});

test("mergeAnchorPositionIfChanged: changedFields prázdné (cíl bez business polí) + pozice se změnila — fields ponese jen pozici, stejný tvar jako dnešní mutationCmd", () => {
  const beforeTargets: EditSnapshot[] = [{ id: 1, updatedAt: "a1", fields: {} }];
  const afterTargets: EditSnapshot[] = [{ id: 1, updatedAt: "a2", fields: {} }];
  const prev = pos({ id: 1, updatedAt: "a1" });
  const updated = pos({ id: 1, updatedAt: "a2", startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z" });
  const res = mergeAnchorPositionIfChanged({ beforeTargets, afterTargets, prev, updated });
  assert.deepEqual(res.beforeTargets[0].fields, {
    startTime: "2026-09-02T06:00:00.000Z", endTime: "2026-09-02T08:00:00.000Z",
    machine: "XL_105", printMinutes: 120, scheduleBypassed: false,
  });
  assert.deepEqual(res.afterTargets[0].fields, {
    startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z",
    machine: "XL_105", printMinutes: 120, scheduleBypassed: false,
  });
});

test("mergeAnchorPositionIfChanged: kotva NENÍ první v poli cílů — sloučí se přesto, hledá se podle id", () => {
  const beforeTargets: EditSnapshot[] = [
    { id: 2, updatedAt: "b1", fields: { orderNumber: "SIB" } }, // sourozenec první
    { id: 1, updatedAt: "a1", fields: { description: "stará" } }, // kotva druhá
  ];
  const afterTargets: EditSnapshot[] = [
    { id: 2, updatedAt: "b1", fields: { orderNumber: "SIB" } },
    { id: 1, updatedAt: "a2", fields: { description: "nová" } },
  ];
  const prev = pos({ id: 1, updatedAt: "a1" });
  const updated = pos({ id: 1, updatedAt: "a2", machine: "XL_106" });
  const res = mergeAnchorPositionIfChanged({ beforeTargets, afterTargets, prev, updated });
  assert.deepEqual(res.beforeTargets[0].fields, { orderNumber: "SIB" }, "sourozenec beze změny");
  assert.deepEqual(res.beforeTargets[1].fields, {
    description: "stará",
    startTime: "2026-09-02T06:00:00.000Z", endTime: "2026-09-02T08:00:00.000Z",
    machine: "XL_105", printMinutes: 120, scheduleBypassed: false,
  }, "kotva na DRUHÉ pozici v poli přesto dostane pozici");
  assert.deepEqual(res.afterTargets[1].fields, {
    description: "nová",
    startTime: "2026-09-02T06:00:00.000Z", endTime: "2026-09-02T08:00:00.000Z",
    machine: "XL_106", printMinutes: 120, scheduleBypassed: false,
  });
});

test("mergeAnchorPositionIfChanged: jen scheduleBypassed se liší — MUTAČNÍ POJISTKA, pořád se to počítá jako poziční změna", () => {
  const beforeTargets: EditSnapshot[] = [{ id: 1, updatedAt: "a1", fields: {} }];
  const afterTargets: EditSnapshot[] = [{ id: 1, updatedAt: "a2", fields: {} }];
  const prev = pos({ id: 1, updatedAt: "a1", scheduleBypassed: false });
  const updated = pos({ id: 1, updatedAt: "a2", scheduleBypassed: true });
  const res = mergeAnchorPositionIfChanged({ beforeTargets, afterTargets, prev, updated });
  assert.equal("scheduleBypassed" in res.beforeTargets[0].fields, true, "scheduleBypassed musí být součástí diffu, ne jen startTime/endTime/machine");
  assert.equal(res.afterTargets[0].fields.scheduleBypassed, true);
});

test("mergeAnchorPositionIfChanged: jen printMinutes se liší — MUTAČNÍ POJISTKA, pořád se to počítá jako poziční změna", () => {
  const beforeTargets: EditSnapshot[] = [{ id: 1, updatedAt: "a1", fields: {} }];
  const afterTargets: EditSnapshot[] = [{ id: 1, updatedAt: "a2", fields: {} }];
  const prev = pos({ id: 1, updatedAt: "a1", printMinutes: 100 });
  const updated = pos({ id: 1, updatedAt: "a2", printMinutes: 150 });
  const res = mergeAnchorPositionIfChanged({ beforeTargets, afterTargets, prev, updated });
  assert.equal("printMinutes" in res.beforeTargets[0].fields, true, "printMinutes musí být součástí diffu");
  assert.equal(res.afterTargets[0].fields.printMinutes, 150);
});

test("mergeAnchorPositionIfChanged: cíl s id mimo kotvu se vrátí beze změny (žádná cizí pozice, žádný duch)", () => {
  const beforeTargets: EditSnapshot[] = [{ id: 5, updatedAt: "x1", fields: { description: "x" } }];
  const afterTargets: EditSnapshot[] = [{ id: 5, updatedAt: "x2", fields: { description: "y" } }];
  const prev = pos({ id: 1, updatedAt: "a1" }); // jiné id než v targets
  const updated = pos({ id: 1, updatedAt: "a2", machine: "XL_106" });
  const res = mergeAnchorPositionIfChanged({ beforeTargets, afterTargets, prev, updated });
  assert.deepEqual(res.beforeTargets, beforeTargets);
  assert.deepEqual(res.afterTargets, afterTargets);
});

// ─── pickShiftedSplitSiblings (etapa A pokračování, handleSaveAll, 7. 8. 2026) ──
// handleBlockUpdate řeší shifted split sourozence pro JEDEN PUT inline (viz
// PlannerPage.tsx, C-1). handleSaveAll potřebuje totéž přes VÍC PUTů jedné dávky —
// tahle funkce je jeho čistá, testovatelná verze (PlannerPage.tsx testy mít nemůže,
// repo nemá nástroje na testování React komponent — proto se co nejvíc logiky
// vytahuje sem).

// Stejný vzor jako `pos()` výš, jen navíc NESE `splitGroupId` v typu výsledku —
// `pos()` ho typově nemá (`BlockSnapshot` nemá tohle pole), takže by nešel použít
// jako vstup pro funkci, která na `splitGroupId` filtruje.
function sib(
  over: Partial<BlockSnapshot> & Record<string, unknown> & { id: number; splitGroupId: number | null; updatedAt: string },
): BlockSnapshot & { splitGroupId: number | null } {
  return {
    startTime: "2026-09-02T06:00:00.000Z", endTime: "2026-09-02T08:00:00.000Z",
    machine: "XL_105", printMinutes: 120, scheduleBypassed: false,
    ...over,
  };
}

test("pickShiftedSplitSiblings: soused se shodným splitGroupId a přítomný v prevById — spáruje old/new podle id", () => {
  const tailOld = sib({ id: 9, splitGroupId: 100, updatedAt: "s1", orderNumber: "OLD" });
  const tailNew = sib({ id: 9, splitGroupId: 100, updatedAt: "s2", orderNumber: "NEW" });
  const prevById = new Map([[9, tailOld]]);
  const res = pickShiftedSplitSiblings([tailNew], 100, prevById);
  assert.deepEqual(res.shiftedSplitSiblingsOld, [tailOld]);
  assert.deepEqual(res.shiftedSplitSiblingsNew, [tailNew]);
});

test("pickShiftedSplitSiblings: jiný splitGroupId — nezařadí se (soused patří do CIZÍ split skupiny)", () => {
  const other = sib({ id: 9, splitGroupId: 200, updatedAt: "s2" });
  const prevById = new Map([[9, sib({ id: 9, splitGroupId: 200, updatedAt: "s1" })]]);
  const res = pickShiftedSplitSiblings([other], 100, prevById);
  assert.deepEqual(res.shiftedSplitSiblingsOld, []);
  assert.deepEqual(res.shiftedSplitSiblingsNew, []);
});

test("pickShiftedSplitSiblings: primarySplitGroupId je null A odsunutý soused MÁ TAKÉ splitGroupId null — MUTAČNÍ POJISTKA pro early-return guard", () => {
  // Editovaný blok není ve split skupině (běžný případ — většina bloků). Odsunutý
  // soused NENÍ jeho sourozenec, jen náhodou má TAKÉ splitGroupId null (běžné pro
  // libovolný blok mimo split). Bez explicitního `primarySplitGroupId == null`
  // guardu by cyklový filtr `s.splitGroupId !== primarySplitGroupId` vyhodnotil
  // `null !== null` jako false a nechal by tenhle "cizí" blok projít jako falešný
  // sourozenec — přesně scénář, který by test s NEnulovým splitGroupId (100) na
  // druhé straně nikdy neodhalil (loopový filtr by ho vyřadil i bez guardu).
  const shifted = [sib({ id: 9, splitGroupId: null, updatedAt: "s2" })];
  const prevById = new Map([[9, sib({ id: 9, splitGroupId: null, updatedAt: "s1" })]]);
  const res = pickShiftedSplitSiblings(shifted, null, prevById);
  assert.deepEqual(res.shiftedSplitSiblingsOld, [], "blok bez split skupiny nesmí být sourozencem editovaného bloku, který TAKÉ není ve split skupině");
  assert.deepEqual(res.shiftedSplitSiblingsNew, []);
});

test("pickShiftedSplitSiblings: primarySplitGroupId je undefined A odsunutý soused má splitGroupId null — prázdný výsledek", () => {
  const shifted = [sib({ id: 9, splitGroupId: null, updatedAt: "s2" })];
  const prevById = new Map([[9, sib({ id: 9, splitGroupId: null, updatedAt: "s1" })]]);
  const res = pickShiftedSplitSiblings(shifted, undefined, prevById);
  assert.deepEqual(res.shiftedSplitSiblingsOld, []);
  assert.deepEqual(res.shiftedSplitSiblingsNew, []);
});

test("pickShiftedSplitSiblings: soused odpovídá splitGroupId, ale prevById ho nezná — přeskočí se", () => {
  // Klient tenhle blok vůbec nemá načtený (mimo viditelný rozsah timeline) — undo
  // by ho stejně neuměl vrátit, stejný vzor jako snapshotShiftedFromResponse.
  const shifted = [sib({ id: 9, splitGroupId: 100, updatedAt: "s2" })];
  const res = pickShiftedSplitSiblings(shifted, 100, new Map());
  assert.deepEqual(res.shiftedSplitSiblingsOld, []);
  assert.deepEqual(res.shiftedSplitSiblingsNew, []);
});

test("pickShiftedSplitSiblings: víc odsunutých bloků, jen část patří do primárovy skupiny — zbytek vypadne, pořadí i párování podle id zůstanou", () => {
  const tail = sib({ id: 9, splitGroupId: 100, updatedAt: "s2" });
  const stranger = sib({ id: 3, splitGroupId: 200, updatedAt: "c2" }); // odsunutý, ale JINÁ split skupina
  const tail2 = sib({ id: 10, splitGroupId: 100, updatedAt: "t2" });
  const prevById = new Map([
    [9, sib({ id: 9, splitGroupId: 100, updatedAt: "s1" })],
    [3, sib({ id: 3, splitGroupId: 200, updatedAt: "c1" })],
    [10, sib({ id: 10, splitGroupId: 100, updatedAt: "t1" })],
  ]);
  const res = pickShiftedSplitSiblings([tail, stranger, tail2], 100, prevById);
  assert.deepEqual(res.shiftedSplitSiblingsNew.map((s) => s.id), [9, 10], "stranger (jiná skupina) vypadl, pořadí zbylých zachováno");
  assert.deepEqual(res.shiftedSplitSiblingsOld.map((s) => s.id), [9, 10], "old zůstává zarovnané s new podle indexu");
});

test("pickShiftedSplitSiblings: extra business pole (type, orderNumber) projdou beze změny — funkce nic neořezává, jen filtruje a páruje", () => {
  const tailOld = sib({ id: 9, splitGroupId: 100, updatedAt: "s1", type: "REZERVACE", orderNumber: "17300" });
  const tailNew = sib({ id: 9, splitGroupId: 100, updatedAt: "s2", type: "ZAKAZKA", orderNumber: "17300" });
  const res = pickShiftedSplitSiblings([tailNew], 100, new Map([[9, tailOld]]));
  assert.equal((res.shiftedSplitSiblingsNew[0] as Record<string, unknown>).type, "ZAKAZKA");
  assert.equal((res.shiftedSplitSiblingsOld[0] as Record<string, unknown>).type, "REZERVACE");
});

test("pickShiftedSplitSiblings: čistá funkce — nemutuje shifted ani prevById", () => {
  const tail = sib({ id: 9, splitGroupId: 100, updatedAt: "s2" });
  const shifted = [tail];
  const prevById = new Map([[9, sib({ id: 9, splitGroupId: 100, updatedAt: "s1" })]]);
  pickShiftedSplitSiblings(shifted, 100, prevById);
  assert.equal(shifted.length, 1);
  assert.equal(prevById.size, 1);
});

test("pickShiftedSplitSiblings: MUTAČNÍ POJISTKA — blok BEZ split skupiny (splitGroupId null) se nesmí spárovat se žádným primárem", () => {
  // Bez podmínky `s.splitGroupId !== primarySplitGroupId` (nebo s ledabylým `==`
  // porovnáním) by tenhle blok mohl omylem projít a dostat cizí SPLIT_SHARED_FIELDS.
  const foreignBlock = sib({ id: 55, splitGroupId: null, updatedAt: "z2" });
  const prevById = new Map([[55, sib({ id: 55, splitGroupId: null, updatedAt: "z1" })]]);
  const res = pickShiftedSplitSiblings([foreignBlock], 100, prevById);
  assert.equal(res.shiftedSplitSiblingsNew.length, 0, "blok bez split skupiny (null) se nesmí zařadit k žádnému primárovi");
});

// ─── Integrace: handleSaveAll — HEAD editovaný přes „Celou sérii", TAIL odsunutý
// chain pushem a vyloučený ze `siblings` (přesný scénář ze zadání, atomické undo
// etapa A, 7. 8. 2026) ──────────────────────────────────────────────────────────
// HEAD (id 1) nese recurrenceParentId → je v `ids`, které handleSaveAll ukládá.
// TAIL (id 2) je jeho split sourozenec, ale recurrenceParentId nekopíruje (split
// route.ts) → do `ids` se NIKDY nedostane. Editace HEADu přes „Celou sérii" mění
// sdílené pole (orderNumber) A ZÁROVEŇ chain pushem odsune TAIL — server ho kvůli
// tomu vyloučí z `siblings` (dvojitá SSE pojistka) a pošle ho JEN v `shifted`.
// Test poskládá přesně to, co handleSaveAll dělá pro JEDNU iteraci smyčky
// (ids = [1], stejné jako reálné volání `onSaveAll([block.id], pending)` v
// BlockEdit.tsx) — pomocí SKUTEČNÝCH čistých funkcí, ne mocků.

test("handleSaveAll scénář: TAIL dostane sdílené pole I pozici v JEDNOM cíli, nezůstane duplicitně v odsunutých", () => {
  // Snapshot PŘED smyčkou (prevById v handleSaveAll) — obsahuje HEAD i TAIL,
  // přestože `ids` = [1] nese jen HEAD.
  const headOld = sib({ id: 1, splitGroupId: 500, updatedAt: "head-v1", orderNumber: "17300", type: "ZAKAZKA", startTime: "2026-09-02T06:00:00.000Z", endTime: "2026-09-02T08:00:00.000Z" });
  const tailOld = sib({ id: 2, splitGroupId: 500, updatedAt: "tail-v1", orderNumber: "17300", type: "ZAKAZKA", startTime: "2026-09-02T08:00:00.000Z", endTime: "2026-09-02T10:00:00.000Z" });
  const prevById = new Map([[1, headOld], [2, tailOld]]);

  // Odpověď serveru na PUT bloku 1: orderNumber změněný, endTime protažený do
  // prostoru TAILu. `siblings` je PRÁZDNÉ (TAIL vyloučen), TAIL je JEN v `shifted`,
  // už s propagovaným orderNumber (refetch běží až PO propagaci).
  const updated = sib({ id: 1, splitGroupId: 500, updatedAt: "head-v2", orderNumber: "17777", type: "ZAKAZKA", startTime: "2026-09-02T06:00:00.000Z", endTime: "2026-09-02T09:00:00.000Z" });
  const tailShifted = sib({ id: 2, splitGroupId: 500, updatedAt: "tail-v2", orderNumber: "17777", type: "ZAKAZKA", startTime: "2026-09-02T09:00:00.000Z", endTime: "2026-09-02T11:00:00.000Z" });
  const siblingsFromServer: Array<typeof updated> = []; // TAIL je vyloučen ze siblings

  const prev = prevById.get(1)!;
  const changed = ["orderNumber", "endTime"]; // trackedHere diff (handleSaveAll)

  const siblingsOld = siblingsFromServer.map((s) => prevById.get(s.id)).filter((b): b is typeof prev => b != null);
  const { shiftedSplitSiblingsOld, shiftedSplitSiblingsNew } = pickShiftedSplitSiblings(
    [tailShifted], updated.splitGroupId, prevById,
  );
  const { beforeTargets, afterTargets, absorbedShiftedIds } = buildSplitEditTargetsWithShifted({
    changedFields: changed, sharedFields: SPLIT_SHARED_FIELDS,
    before: prev, after: updated, siblingsOld, siblingsNew: siblingsFromServer,
    shiftedSplitSiblingsOld, shiftedSplitSiblingsNew,
  });

  // handleSaveAll dál akumuluje POZIČNÍ odsunuté přes accumulateShifted (stejný
  // tvar, jaký reálně staví snapshotShiftedFromResponse).
  let saveShifted: ShiftedSnapshots = { before: [], after: [] };
  saveShifted = accumulateShifted(saveShifted, { before: [tailOld], after: [tailShifted] });
  const saveBefore = [...beforeTargets];
  const saveAfter = [...afterTargets];
  const absorbedShiftedIdsAll = new Set(absorbedShiftedIds);

  // recordSaveAllUndo — finální krok, který skládá undo krok pro CELOU dávku.
  const finalShifted = excludeShiftedTargeted(
    saveShifted,
    new Set([...saveBefore.map((t) => t.id), ...absorbedShiftedIdsAll]),
  );

  assert.deepEqual(saveBefore.map((t) => t.id).sort(), [1, 2], "HEAD i TAIL musí mít vlastní cíl v saveBefore");
  assert.deepEqual(saveAfter.map((t) => t.id).sort(), [1, 2]);

  const headBefore = saveBefore.find((t) => t.id === 1)!;
  const headAfter = saveAfter.find((t) => t.id === 1)!;
  assert.deepEqual(headBefore.fields, { orderNumber: "17300", endTime: "2026-09-02T08:00:00.000Z" });
  assert.deepEqual(headAfter.fields, { orderNumber: "17777", endTime: "2026-09-02T09:00:00.000Z" });

  const tailBefore = saveBefore.find((t) => t.id === 2)!;
  const tailAfter = saveAfter.find((t) => t.id === 2)!;
  assert.equal(tailBefore.fields.orderNumber, "17300", "TAIL v before nese PŮVODNÍ sdílenou hodnotu — tohle je přesně to pole, které bez opravy zůstávalo nevrácené (Ctrl+Z by ho nechal na 17777)");
  assert.equal(tailAfter.fields.orderNumber, "17777", "TAIL v after nese NOVOU propagovanou hodnotu");
  assert.equal(tailBefore.fields.startTime, "2026-09-02T08:00:00.000Z", "TAIL nese v TOMTÉŽ cíli i PŮVODNÍ pozici (byl chain pushnutý)");
  assert.equal(tailAfter.fields.startTime, "2026-09-02T09:00:00.000Z");
  assert.equal(tailBefore.updatedAt, "tail-v1", "expectedUpdatedAt cíle je TAILova vlastní verze, ne HEADova");
  assert.equal(tailAfter.updatedAt, "tail-v2");

  assert.deepEqual([...absorbedShiftedIds], [2]);
  assert.equal(finalShifted.before.length, 0, "TAIL nesmí zůstat i v pozičním seznamu odsunutých — jinak by sanitizeUndoOps odmítl celou dávku (400, duplicitní id)");
  assert.equal(finalShifted.after.length, 0);
});

test("REGRESE (dokumentační): stejný scénář přes holé buildSplitEditTargets (jen siblings, bez shifted-vědomí) TAIL úplně vynechá — tohle byl bug před opravou 7. 8. 2026", () => {
  // Server pošle TAIL jen v `shifted` (viz test výš) — buildSplitEditTargets zná
  // jen `siblingsOld`/`siblingsNew`, které jsou prázdné (TAIL byl ze siblings
  // vyloučen). Bez buildSplitEditTargetsWithShifted/pickShiftedSplitSiblings se
  // TAIL do beforeTargets/afterTargets nedostane VŮBEC — Ctrl+Z by vrátil jen
  // HEAD a TAIL by si nechal propagovanou hodnotu (split skupina se tiše rozejde).
  const { beforeTargets, afterTargets } = buildSplitEditTargets({
    changedFields: ["orderNumber", "endTime"], sharedFields: SPLIT_SHARED_FIELDS,
    before: { id: 1, updatedAt: "head-v1", orderNumber: "17300" },
    after: { id: 1, updatedAt: "head-v2", orderNumber: "17777" },
    siblingsOld: [], siblingsNew: [],
  });
  assert.deepEqual(beforeTargets.map((t) => t.id), [1], "TAIL (id 2) tu chybí — přesně tohle byl bug");
  assert.deepEqual(afterTargets.map((t) => t.id), [1]);
});
