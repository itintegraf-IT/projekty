import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMoveCommand, buildEditCommand, buildMultiEditCommand, buildCreateCommand, buildDeleteCommand, buildMoveOrResizeCommand } from "./commands";
import { StaleUndoError, type Block, type EditSnapshot, type UndoEffects, type UndoRequest } from "./types";

function blk(id: number, over: Partial<Block> = {}): Block {
  return {
    id, orderNumber: "X", machine: "XL_105", startTime: "2026-07-10T08:00:00.000Z",
    endTime: "2026-07-10T09:00:00.000Z", type: "ZAKAZKA", jobPresetId: null, jobPresetLabel: null,
    description: null, locked: false, deadlineExpedice: null, expediceNote: null, doprava: null,
    expeditionPublishedAt: null, expeditionSortOrder: null, dataStatusId: null, dataStatusLabel: null,
    dataRequiredDate: null, dataOk: false, materialStatusId: null, materialStatusLabel: null,
    materialRequiredDate: null, materialOk: false, materialInStock: false, materialIssued: false,
    pantoneRequiredDate: null, pantoneOk: false, pantoneRequired: false, barvyStatusId: null,
    barvyStatusLabel: null, lakStatusId: null, lakStatusLabel: null, specifikace: null,
    materialNote: null, materialNoteByUsername: null, recurrenceType: "NONE", recurrenceParentId: null,
    splitGroupId: null, printCompletedAt: null, printCompletedByUserId: null,
    printCompletedByUsername: null, reservationId: null, reservationConfirmedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "v1", ...over,
  } as Block;
}

/**
 * Fake effects: applyUndo aplikuje ops na živou mapu a bumpne updatedAt. Je to JEDINÁ
 * cesta, kterou zapisuje libovolný builder v tomhle souboru (buildMoveCommand,
 * buildEditCommand, buildMultiEditCommand, buildCreateCommand, buildDeleteCommand) —
 * starší putBlock/postBlock/deleteBlock/batchUpdate z Tasku 7 zmizely z `UndoEffects`
 * úplně (Task 8).
 *
 * POZOR (review Tasku 7, nález I3): `applyUndo` tady mutuje `live` PŘÍMO, takže asserce
 * typu `live.has(id)` projdou i BEZ volání `addToState`/`removeFromState` — v reálné
 * aplikaci je `live` == `blocksRef.current` a ten se mění VÝHRADNĚ přes tyhle dvě effect
 * metody. Testy proto vedle `live.*` musí ověřovat i `calls.added`/`calls.removed`.
 */
function makeEffects(live: Map<number, Block>) {
  const calls = {
    undo: [] as UndoRequest[],
    added: [] as Block[][],
    removed: [] as number[][],
  };
  const effects: UndoEffects = {
    getLiveBlock: (id) => live.get(id),
    applyUndo: async (req) => {
      calls.undo.push(req);
      const updated: Block[] = [];
      const removed: number[] = [];
      for (const op of req.ops) {
        if (op.kind === "remove") { live.delete(op.id); removed.push(op.id); continue; }
        const cur = live.get(op.id);
        const next = { ...(cur ?? blk(op.id)), ...op.fields, id: op.id,
          updatedAt: (cur?.updatedAt ?? "v0") + "+" } as Block;
        live.set(op.id, next);
        updated.push(next);
      }
      return { updated, removed };
    },
    addToState: (blocks) => { calls.added.push(blocks); },
    removeFromState: (ids) => { calls.removed.push(ids); },
  };
  return { effects, calls };
}

test("buildMoveCommand: undo pošle JEDNO volání applyUndo se všemi pozicemi", async () => {
  const live = new Map([
    [1, blk(1, { startTime: "2026-07-10T10:00:00.000Z", updatedAt: "v2" })],
    [2, blk(2, { startTime: "2026-07-10T12:00:00.000Z", updatedAt: "w2" })],
  ]);
  const { effects, calls } = makeEffects(live);
  const before = [
    { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1", printMinutes: null, scheduleBypassed: false },
    { id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "w1", printMinutes: null, scheduleBypassed: false },
  ];
  const after = [
    { id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2", printMinutes: null, scheduleBypassed: false },
    { id: 2, startTime: "2026-07-10T12:00:00.000Z", endTime: "2026-07-10T13:00:00.000Z", machine: "XL_105", updatedAt: "w2", printMinutes: null, scheduleBypassed: false },
  ];
  await buildMoveCommand("Přesun", before, after).undo(effects);
  assert.equal(calls.undo.length, 1, "celý krok historie je JEDNO volání");
  assert.equal(calls.undo[0].direction, "undo");
  assert.equal(calls.undo[0].ops.length, 2);
  assert.equal((calls.undo[0].ops[0] as { expectedUpdatedAt?: string }).expectedUpdatedAt, "v2");
  assert.equal(live.get(1)!.startTime, "2026-07-10T08:00:00.000Z");
  assert.equal(live.get(2)!.startTime, "2026-07-10T09:00:00.000Z");
});

test("buildEditCommand: undo pošle primár i odsunuté sousedy v JEDNOM volání", async () => {
  const live = new Map([
    [1, blk(1, { type: "ZAKAZKA", updatedAt: "v2" })],
    [2, blk(2, { startTime: "2026-07-10T12:00:00.000Z", updatedAt: "w2" })],
  ]);
  const { effects, calls } = makeEffects(live);
  const cmd = buildEditCommand(
    "Editace",
    { id: 1, updatedAt: "v1", fields: { description: "puvodni" } },
    { id: 1, updatedAt: "v2", fields: { description: "nove" } },
    [{ id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "w1", printMinutes: null, scheduleBypassed: false }],
    [{ id: 2, startTime: "2026-07-10T12:00:00.000Z", endTime: "2026-07-10T13:00:00.000Z", machine: "XL_105", updatedAt: "w2", printMinutes: null, scheduleBypassed: false }],
  );
  await cmd.undo(effects);
  assert.equal(calls.undo.length, 1);
  assert.equal(calls.undo[0].ops.length, 2, "primár + soused v jedné dávce");
  assert.equal(live.get(1)!.description, "puvodni");
  assert.equal(live.get(2)!.startTime, "2026-07-10T09:00:00.000Z");
});

test("buildMoveCommand: guard hodí StaleUndoError, když updatedAt neodpovídá", async () => {
  const live = new Map([[1, blk(1, { updatedAt: "CIZI" })]]);
  const { effects } = makeEffects(live);
  const before = [{ id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1", printMinutes: null, scheduleBypassed: false }];
  const after  = [{ id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2", printMinutes: null, scheduleBypassed: false }];
  const cmd = buildMoveCommand("Přesun", before, after);
  await assert.rejects(() => cmd.undo(effects), StaleUndoError);
});

test("buildMoveCommand: undo→redo funguje po osvěžení updatedAt (guard nepadne)", async () => {
  const live = new Map([[1, blk(1, { startTime: "2026-07-10T10:00:00.000Z", updatedAt: "v2" })]]);
  const { effects } = makeEffects(live);
  const before = [{ id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1", printMinutes: null, scheduleBypassed: false }];
  const after  = [{ id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2", printMinutes: null, scheduleBypassed: false }];
  const cmd = buildMoveCommand("Přesun", before, after);
  await cmd.undo(effects);            // live.updatedAt -> "v2+"
  await cmd.redo(effects);            // guard porovná před redo 'before' proti live -> osvěžené sedí
  assert.equal(live.get(1)!.startTime, "2026-07-10T10:00:00.000Z");
});

// ─── scheduleBypassed (fix round 1 — stejná past jako printMinutes ve Step 3b, jiný sloupec) ──

test("buildMoveCommand: undo obnoví scheduleBypassed=true (blok byl bypass, po přesunu už není)", async () => {
  // Zrcadlový/horší případ: bypass blok přesunut do platné pozice (server uložil false).
  // Bez opravy by po undo zůstala geometrie mimo pracovní dobu s scheduleBypassed=false,
  // takže by ho chain push tiše re-expandoval přes pauzy místo re-expanze.
  const live = new Map([[1, blk(1, { startTime: "2026-07-10T10:00:00.000Z", scheduleBypassed: false, updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const before = [{ id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1", printMinutes: null, scheduleBypassed: true }];
  const after  = [{ id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2", printMinutes: null, scheduleBypassed: false }];
  await buildMoveCommand("Přesun", before, after).undo(effects);
  const fields = (calls.undo[0].ops[0] as { fields: Record<string, unknown> }).fields;
  assert.equal(fields.scheduleBypassed, true, "blok byl bypass před přesunem — undo ho musí vrátit, i když teď bypass není");
  assert.equal(live.get(1)!.scheduleBypassed, true);
});

test("buildMoveCommand: undo obnoví scheduleBypassed=false (blok bypass nebyl, po přesunu je)", async () => {
  // Primární případ ze zadání: zámek pracovní doby vypnutý, blok přetažen mimo provoz
  // (server uložil true). Bez opravy by po undo zůstal blok v normální pracovní době,
  // ale trvale označený jako bypass.
  const live = new Map([[1, blk(1, { startTime: "2026-07-10T10:00:00.000Z", scheduleBypassed: true, updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const before = [{ id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1", printMinutes: null, scheduleBypassed: false }];
  const after  = [{ id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2", printMinutes: null, scheduleBypassed: true }];
  await buildMoveCommand("Přesun", before, after).undo(effects);
  const fields = (calls.undo[0].ops[0] as { fields: Record<string, unknown> }).fields;
  assert.equal(fields.scheduleBypassed, false, "blok bypass nebyl — undo nesmí nechat viset true ze stavu po přesunu");
  assert.equal(live.get(1)!.scheduleBypassed, false);
});

test("buildEditCommand: guard hodí StaleUndoError při neshodě updatedAt", async () => {
  const live = new Map([[1, blk(1, { updatedAt: "CIZI" })]]);
  const { effects } = makeEffects(live);
  const before: EditSnapshot = { id: 1, updatedAt: "v1", fields: { description: "OLD" } };
  const after:  EditSnapshot = { id: 1, updatedAt: "v2", fields: { description: "NEW" } };
  const cmd = buildEditCommand("Editace", before, after);
  await assert.rejects(() => cmd.undo(effects), StaleUndoError);
});

test("buildEditCommand: primární op v applyUndo nese expectedUpdatedAt = 'after'.updatedAt", async () => {
  const live = new Map([[1, blk(1, { description: "NEW", updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const before: EditSnapshot = { id: 1, updatedAt: "v1", fields: { description: "OLD" } };
  const after:  EditSnapshot = { id: 1, updatedAt: "v2", fields: { description: "NEW" } };
  const cmd = buildEditCommand("Editace", before, after);
  await cmd.undo(effects);
  assert.equal(calls.undo.length, 1);
  assert.equal((calls.undo[0].ops[0] as { expectedUpdatedAt?: string }).expectedUpdatedAt, after.updatedAt);
});

// ─── buildCreateCommand ───────────────────────────────────────────────────────
// Task 7: undo/redo jde přes JEDNO applyUndo volání (created + shifted sousedé v téže
// dávce), obnova při redo je pod PŮVODNÍM id (žádný remap). makeEffects nahrazuje starší
// makeCreateEffects — ten stavěl na postBlock/deleteBlock, které tenhle builder už nevolá.

test("buildCreateCommand: undo hodí StaleUndoError, když byl vytvořený blok mezitím změněn", async () => {
  const live = new Map([[100, blk(100, { updatedAt: "CIZI" })]]);
  const { effects } = makeEffects(live);
  const cmd = buildCreateCommand("Vložení", [{ id: 100, updatedAt: "n1", fields: { orderNumber: "X" } }]);
  await assert.rejects(() => cmd.undo(effects), StaleUndoError);
});

test("buildCreateCommand: undo smaže vytvořený blok A vrátí sousedy v JEDNOM volání", async () => {
  const live = new Map([
    [10, blk(10, { updatedAt: "n1" })],                                        // vytvořený
    [2, blk(2, { startTime: "2026-07-10T12:00:00.000Z", updatedAt: "w2" })],   // odsunutý
  ]);
  const { effects, calls } = makeEffects(live);
  const cmd = buildCreateCommand(
    "Vložení bloku",
    [{ id: 10, updatedAt: "n1", fields: { orderNumber: "X", machine: "XL_105", startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z" } }],
    [{ id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "w1", printMinutes: null, scheduleBypassed: false }],
    [{ id: 2, startTime: "2026-07-10T12:00:00.000Z", endTime: "2026-07-10T13:00:00.000Z", machine: "XL_105", updatedAt: "w2", printMinutes: null, scheduleBypassed: false }],
  );
  await cmd.undo(effects);
  assert.equal(calls.undo.length, 1, "smazání i návrat sousedů v jedné transakci");
  const kinds = calls.undo[0].ops.map((o) => o.kind).sort();
  assert.deepEqual(kinds, ["remove", "upsert"]);
  assert.equal(live.has(10), false);
  assert.equal(live.get(2)!.startTime, "2026-07-10T09:00:00.000Z");
  // I3: `live.*` výše projde i bez volání addToState/removeFromState (fake mutuje
  // `live` přímo) — v reálné appce je addToState/removeFromState jediná cesta,
  // kterou se stav dostane do blocksRef.current, proto se musí ověřit zvlášť.
  assert.equal(calls.removed.length, 1, "removeFromState se skutečně zavolal");
  assert.deepEqual(calls.removed[0], [10]);
  assert.equal(calls.added.length, 1, "addToState se skutečně zavolal pro vráceného souseda");
  assert.deepEqual(calls.added[0].map((b) => b.id), [2]);
});

test("buildCreateCommand: redo obnoví blok se STEJNÝM id (žádný remap)", async () => {
  const live = new Map([[2, blk(2, { startTime: "2026-07-10T09:00:00.000Z", updatedAt: "w1" })]]);
  const { effects, calls } = makeEffects(live);
  const cmd = buildCreateCommand(
    "Vložení bloku",
    [{ id: 10, updatedAt: "n1", fields: { orderNumber: "X", machine: "XL_105", startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z" } }],
    [{ id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "w1", printMinutes: null, scheduleBypassed: false }],
    [{ id: 2, startTime: "2026-07-10T12:00:00.000Z", endTime: "2026-07-10T13:00:00.000Z", machine: "XL_105", updatedAt: "w2", printMinutes: null, scheduleBypassed: false }],
  );
  await cmd.redo(effects);
  assert.ok(live.has(10), "blok se vrátil pod původním id");
  assert.equal(calls.added.length, 1, "addToState se skutečně zavolal (I3)");
  assert.deepEqual(calls.added[0].map((b) => b.id).sort((a, b) => a - b), [2, 10], "addToState dostal jak obnovený blok, tak odsunutého souseda");
});

test("buildCreateCommand: undo → redo → undo se sousedy — redo vrátí souseda na AFTER pozici, druhé undo neshodí guard", async () => {
  // Review I2: mutační test prokázal, že bez `...shiftedAfter.map(posOp)` v redo ops
  // a bez `refresh(...)` po undu/redu zůstane 25/25 zelených. Scénář: plánovač vloží
  // zakázku, která odsune dvacet navazujících bloků, Ctrl+Z vrátí všechno, Ctrl+Y má
  // vrátit stav zpátky VČETNĚ sousedů — bez toho by dávka spadla na overlap pojistku
  // (soused zůstal na staré pozici) a bez refresh by druhé Ctrl+Z spadlo na StaleUndoError
  // a krok historie by se nenávratně zahodil.
  const live = new Map([
    [10, blk(10, { updatedAt: "n1" })],
    [2, blk(2, { startTime: "2026-07-10T12:00:00.000Z", updatedAt: "w2" })],
  ]);
  const { effects, calls } = makeEffects(live);
  const created = [{ id: 10, updatedAt: "n1", fields: { orderNumber: "X", machine: "XL_105", startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z" } }];
  const shiftedBefore = [{ id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "w1", printMinutes: null, scheduleBypassed: false }];
  const shiftedAfter = [{ id: 2, startTime: "2026-07-10T12:00:00.000Z", endTime: "2026-07-10T13:00:00.000Z", machine: "XL_105", updatedAt: "w2", printMinutes: null, scheduleBypassed: false }];
  const cmd = buildCreateCommand("Vložení bloku", created, shiftedBefore, shiftedAfter);

  await cmd.undo(effects);
  assert.equal(live.get(2)!.startTime, "2026-07-10T09:00:00.000Z", "1. undo: soused na BEFORE pozici");

  await cmd.redo(effects);
  assert.ok(live.has(10), "blok obnoven pod původním id");
  assert.equal(live.get(2)!.startTime, "2026-07-10T12:00:00.000Z", "redo musí vrátit souseda na AFTER pozici (mutace: chybějící shiftedAfter ops)");

  await cmd.undo(effects); // nesmí spadnout na StaleUndoError (mutace: chybějící refresh)
  assert.equal(live.has(10), false);
  assert.equal(live.get(2)!.startTime, "2026-07-10T09:00:00.000Z", "2. undo: soused zase na BEFORE pozici");
  assert.equal(calls.undo.length, 3, "undo → redo → undo = tři volání applyUndo");
});

test("buildCreateCommand: změněný odsunutý soused shodí undo dřív, než se cokoli smaže", async () => {
  const live = new Map([
    [1, blk(1, { updatedAt: "new" })],
    [2, blk(2, { updatedAt: "CIZI" })], // někdo jiný s ním mezitím hnul
  ]);
  const { effects, calls } = makeEffects(live);
  const created = [{ id: 1, updatedAt: "new", fields: {} }];
  const shiftedBefore = [{ id: 2, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v2", printMinutes: null, scheduleBypassed: false }];
  const shiftedAfter = [{ id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "v2", printMinutes: null, scheduleBypassed: false }];

  await assert.rejects(
    () => buildCreateCommand("Vložení", created, shiftedBefore, shiftedAfter).undo(effects),
    StaleUndoError,
  );
  assert.equal(calls.undo.length, 0, "nic se nesmí zapsat, když sousedy nejde vrátit — guard proběhne PŘED applyUndo");
  assert.equal(calls.added.length, 0);
  assert.equal(calls.removed.length, 0);
});

test("buildCreateCommand: bez odsunutých sousedů pošle jen smazání vytvořeného bloku", async () => {
  const live = new Map([[1, blk(1, { updatedAt: "new" })]]);
  const { effects, calls } = makeEffects(live);
  await buildCreateCommand("Vložení", [{ id: 1, updatedAt: "new", fields: {} }]).undo(effects);
  assert.equal(calls.undo.length, 1);
  assert.equal(calls.undo[0].ops.length, 1, "žádný zbytečný soused v dávce");
  assert.equal(calls.undo[0].ops[0].kind, "remove");
  assert.equal(live.has(1), false);
  assert.deepEqual(calls.removed, [[1]]);
  // addToState SE volá (bezpodmínečně, s res.updated) — jen s prázdným polem, protože
  // nebyl žádný soused k upsertu. Volání samo o sobě je neškodné (no-op merge).
  assert.deepEqual(calls.added, [[]], "addToState dostal prázdné pole — nic se neupsertovalo, jen smazalo");
});

// ─── buildDeleteCommand ───────────────────────────────────────────────────────
// Task 7: undo obnoví blok pod PŮVODNÍM id (žádný remap → mizí restoredId a s ním
// třída duplicit z opakovaného Ctrl+Z), redo ho zase smaže — obojí JEDNO applyUndo volání.
// Fix round 1 (M1): DeletedRef nese `updatedAt` a undo/redo posílají expectedUpdatedAt —
// blok se vrací pod PŮVODNÍM id, které vidí přes SSE každý klient, takže bez zámku by
// redo mohlo smazat mezitímní cizí změnu beze stopy.

test("buildDeleteCommand: undo obnoví blok pod původním id se zámkem, redo ho zase smaže se ZÁMKEM OSVĚŽENÝM po undu", async () => {
  const live = new Map<number, Block>();
  const { effects, calls } = makeEffects(live);
  const cmd = buildDeleteCommand("Smazání bloku", [{
    id: 738, updatedAt: "del1",
    fields: { orderNumber: "17300", machine: "XL_105", startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z" },
  }]);

  await cmd.undo(effects);
  assert.ok(live.has(738));
  assert.equal(calls.undo[0].ops[0].kind, "upsert");
  assert.equal((calls.undo[0].ops[0] as { expectedUpdatedAt?: string }).expectedUpdatedAt, "del1",
    "undo posílá expectedUpdatedAt zachycený v okamžiku smazání (server ho na neexistujícím řádku přeskočí, ale musí tam být)");
  assert.equal(calls.added.length, 1, "addToState se skutečně zavolal (I3)");
  assert.deepEqual(calls.added[0].map((b) => b.id), [738]);

  const restoredUpdatedAt = live.get(738)!.updatedAt;
  await cmd.redo(effects);
  assert.equal(live.has(738), false);
  assert.equal(calls.undo[1].ops[0].kind, "remove");
  assert.equal((calls.undo[1].ops[0] as { expectedUpdatedAt?: string }).expectedUpdatedAt, restoredUpdatedAt,
    "redo musí zamykat na ČERSTVOU verzi po undu (refresh), ne na hodnotu z okamžiku smazání — jinak by mezitímní cizí "
    + "změna (jiný klient přesunul blok po undu) zmizela beze stopy (review M1)");
  assert.equal(calls.removed.length, 1, "removeFromState se skutečně zavolal (I3)");
  assert.deepEqual(calls.removed[0], [738]);
});

test("buildDeleteCommand: dávka dvou bloků — undo obnoví oba, redo oba zase smaže", async () => {
  // I3: smazaný starý test měl dva bloky v jedné dávce (odpovídá „Smazat vše" nad
  // lasem) — bez téhle náhrady by vícenásobná obnova neměla pokrytí.
  const live = new Map<number, Block>();
  const { effects, calls } = makeEffects(live);
  const cmd = buildDeleteCommand("Smazání bloků", [
    { id: 100, updatedAt: "d1", fields: { orderNumber: "A", machine: "XL_105", startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z" } },
    { id: 200, updatedAt: "d2", fields: { orderNumber: "B", machine: "XL_105", startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z" } },
  ]);

  await cmd.undo(effects);
  assert.ok(live.has(100) && live.has(200), "oba bloky obnoveny");
  assert.equal(calls.undo[0].ops.length, 2, "obě obnovy v jedné dávce");
  assert.equal(calls.added.length, 1, "jedna dávka do addToState");
  assert.deepEqual(calls.added[0].map((b) => b.id).sort((a, b) => a - b), [100, 200], "addToState skutečně dostal oba bloky");

  await cmd.redo(effects);
  assert.equal(live.has(100), false);
  assert.equal(live.has(200), false);
  assert.equal(calls.removed.length, 1);
  assert.deepEqual(calls.removed[0].sort((a, b) => a - b), [100, 200], "removeFromState skutečně dostal oba bloky");
});

test("buildMoveOrResizeCommand: MOVE (start changed) → undo pošle JEDNO volání applyUndo", async () => {
  const live = new Map([[1, blk(1, { startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const prev = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1", printMinutes: null, scheduleBypassed: false };
  const updated = { id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2", printMinutes: null, scheduleBypassed: false };
  const cmd = buildMoveOrResizeCommand(prev, updated, [], []);
  assert.ok(cmd);
  await cmd.undo(effects);
  assert.equal(calls.undo.length, 1);
  const fields = (calls.undo[0].ops[0] as { fields: Record<string, unknown> }).fields;
  assert.equal(fields.startTime, "2026-07-10T08:00:00.000Z");
});

test("buildMoveOrResizeCommand: MOVE (machine changed) → undo pošle JEDNO volání applyUndo", async () => {
  const live = new Map([[1, blk(1, { machine: "XL_106", updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const prev = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1", printMinutes: null, scheduleBypassed: false };
  const updated = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_106", updatedAt: "v2", printMinutes: null, scheduleBypassed: false };
  const cmd = buildMoveOrResizeCommand(prev, updated, [], []);
  assert.ok(cmd);
  await cmd.undo(effects);
  assert.equal(calls.undo.length, 1);
});

test("buildMoveOrResizeCommand: RESIZE (jen endTime) → undo pošle JEDNO volání applyUndo s endTime, NE MOVE", async () => {
  const live = new Map([[1, blk(1, { endTime: "2026-07-10T11:00:00.000Z", updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const prev = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1", printMinutes: null, scheduleBypassed: false };
  const updated = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2", printMinutes: null, scheduleBypassed: false };
  const cmd = buildMoveOrResizeCommand(prev, updated, [], []);
  assert.ok(cmd);
  await cmd.undo(effects);
  assert.equal(calls.undo.length, 1);
  assert.equal(calls.undo[0].ops.length, 1, "bez odsunutých sousedů jen primární blok");
  const fields = (calls.undo[0].ops[0] as { fields: Record<string, unknown> }).fields;
  assert.equal(fields.endTime, "2026-07-10T09:00:00.000Z");
});

test("buildMoveOrResizeCommand: resize obnovuje i printMinutes (endpoint nederivuje)", async () => {
  const live = new Map([[1, blk(1, { endTime: "2026-07-10T11:00:00.000Z", printMinutes: 180, updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const cmd = buildMoveOrResizeCommand(
    { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1", printMinutes: 60, scheduleBypassed: false },
    { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2", printMinutes: 180, scheduleBypassed: false },
  );
  assert.ok(cmd, "změna endu musí dát undo záznam");
  await cmd.undo(effects);
  const fields = (calls.undo[0].ops[0] as { fields: Record<string, unknown> }).fields;
  assert.equal(fields.endTime, "2026-07-10T09:00:00.000Z");
  assert.equal(fields.printMinutes, 60, "bez printMinutes by blok zůstal se spanem ≠ tiskové minuty");
});

test("buildMoveOrResizeCommand: resize obnovuje i scheduleBypassed (endpoint nederivuje, fix round 1)", async () => {
  const live = new Map([[1, blk(1, { endTime: "2026-07-10T11:00:00.000Z", scheduleBypassed: false, updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const cmd = buildMoveOrResizeCommand(
    { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1", printMinutes: null, scheduleBypassed: true },
    { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2", printMinutes: null, scheduleBypassed: false },
  );
  assert.ok(cmd, "změna endu musí dát undo záznam");
  await cmd.undo(effects);
  const fields = (calls.undo[0].ops[0] as { fields: Record<string, unknown> }).fields;
  assert.equal(fields.scheduleBypassed, true, "bez scheduleBypassed by resize vrátil délku, ale nechal blok nesedět s geometrií");
});

test("buildMoveOrResizeCommand: bez změny času/stroje vrátí null", () => {
  const prev = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1", printMinutes: null, scheduleBypassed: false };
  const updated = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v2", printMinutes: null, scheduleBypassed: false };
  const cmd = buildMoveOrResizeCommand(prev, updated, [], []);
  assert.equal(cmd, null);
});

test("buildMoveOrResizeCommand: MOVE větev propíše printMinutes i scheduleBypassed primárního bloku do ops", async () => {
  // Review I4 — Task 7 Step 0 zpřísnění typu odhalilo, že MOVE větev (na rozdíl od RESIZE)
  // nikdy neposílala scheduleBypassed primárního bloku. Test jde přes buildMoveOrResizeCommand
  // (ne přímo přes buildMoveCommand s ručně sestaveným snapshotem) — jedině tak cvičí SAMOTNÉ
  // sestavení MOVE větve, kde k mezeře došlo. Hodnoty jsou záměrně NE-defaultní (printMinutes
  // != null, scheduleBypassed != false), aby mutace „natvrdo null/false" test spolehlivě shodila.
  const live = new Map([[1, blk(1, { startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const prev = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1", printMinutes: 45, scheduleBypassed: true };
  const updated = { id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2", printMinutes: 90, scheduleBypassed: false };
  const cmd = buildMoveOrResizeCommand(prev, updated, [], []);
  assert.ok(cmd);
  await cmd.undo(effects);
  const fields = (calls.undo[0].ops[0] as { fields: Record<string, unknown> }).fields;
  assert.equal(fields.printMinutes, 45, "MOVE větev musí nést printMinutes PRIMÁRNÍHO bloku, ne natvrdo null");
  assert.equal(fields.scheduleBypassed, true, "MOVE větev musí nést scheduleBypassed primárního bloku, ne natvrdo false");
});

// ─── buildMultiEditCommand ────────────────────────────────────────────────────
// Task 7: JEDNO applyUndo volání pro všechny cíle + odsunuté sousedy, expectedUpdatedAt
// se nově posílá u KAŽDÉHO cíle (atomicita ruší kolizi ze sekvenčních PUTů) a skip-pokud-
// -už-hotovo optimalizace mizí (byla nutná jen kvůli sekvenčnímu putBlock). makeEffects
// nahrazuje starší makeMultiEffects, který stavěl na putBlock — ten už tenhle builder nevolá.

const flipBefore = (id: number): EditSnapshot =>
  ({ id, updatedAt: "v1", fields: { type: "REZERVACE", orderNumber: "R123" } });
const flipAfter = (id: number): EditSnapshot =>
  ({ id, updatedAt: "v2", fields: { type: "ZAKAZKA", orderNumber: "5000" } });

test("buildMultiEditCommand: všechny cíle i sourozenci v JEDNOM volání s expectedUpdatedAt", async () => {
  const live = new Map([
    [1, blk(1, { type: "ZAKAZKA", updatedAt: "a2" })],
    [2, blk(2, { type: "ZAKAZKA", updatedAt: "b2" })],
    [3, blk(3, { startTime: "2026-07-10T12:00:00.000Z", updatedAt: "c2" })],
  ]);
  const { effects, calls } = makeEffects(live);
  const cmd = buildMultiEditCommand(
    "Překlopení rezervace",
    [{ id: 1, updatedAt: "a1", fields: { type: "REZERVACE" } }, { id: 2, updatedAt: "b1", fields: { type: "REZERVACE" } }],
    [{ id: 1, updatedAt: "a2", fields: { type: "ZAKAZKA" } }, { id: 2, updatedAt: "b2", fields: { type: "ZAKAZKA" } }],
    [{ id: 3, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "c1", printMinutes: null, scheduleBypassed: false }],
    [{ id: 3, startTime: "2026-07-10T12:00:00.000Z", endTime: "2026-07-10T13:00:00.000Z", machine: "XL_105", updatedAt: "c2", printMinutes: null, scheduleBypassed: false }],
  );
  await cmd.undo(effects);
  assert.equal(calls.undo.length, 1);
  assert.equal(calls.undo[0].ops.length, 3);
  assert.equal((calls.undo[0].ops[0] as { expectedUpdatedAt?: string }).expectedUpdatedAt, "a2",
    "zámek jde nově i na multi-edit — endpoint kontroluje všechny najednou");
  assert.equal(live.get(1)!.type, "REZERVACE");
  assert.equal(live.get(3)!.startTime, "2026-07-10T09:00:00.000Z");
  assert.equal(calls.added.length, 1, "addToState se skutečně zavolal (I3)");
  assert.deepEqual(calls.added[0].map((b) => b.id).sort((a, b) => a - b), [1, 2, 3]);
});

test("buildMultiEditCommand: guard proběhne PŘED prvním zápisem (žádné částečné undo)", async () => {
  const live = new Map([
    [1, blk(1, { type: "ZAKAZKA", orderNumber: "5000", updatedAt: "v2" })],
    [2, blk(2, { type: "ZAKAZKA", orderNumber: "5000", updatedAt: "CIZI" })], // někdo změnil
  ]);
  const { effects, calls } = makeEffects(live);
  const cmd = buildMultiEditCommand("x", [flipBefore(1), flipBefore(2)], [flipAfter(1), flipAfter(2)]);
  await assert.rejects(() => cmd.undo(effects), StaleUndoError);
  assert.equal(calls.undo.length, 0, "nic se nesmí zapsat, když blok 2 neprojde guardem");
});

test("buildMultiEditCommand: chybějící blok ve stavu shodí undo", async () => {
  const live = new Map([[1, blk(1, { type: "ZAKAZKA", updatedAt: "v2" })]]);
  const { effects } = makeEffects(live);
  const cmd = buildMultiEditCommand("x", [flipBefore(1), flipBefore(9)], [flipAfter(1), flipAfter(9)]);
  await assert.rejects(() => cmd.undo(effects), StaleUndoError);
});

test("buildMultiEditCommand: redo znovu překlopí a undo je pak zase možné", async () => {
  const live = new Map([[1, blk(1, { type: "ZAKAZKA", orderNumber: "5000", updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const before = [flipBefore(1)];
  const after = [flipAfter(1)];
  const cmd = buildMultiEditCommand("x", before, after);
  await cmd.undo(effects);          // → REZERVACE, updatedAt osvěžený z odpovědi
  assert.equal(live.get(1)!.type, "REZERVACE");
  await cmd.redo(effects);          // → ZAKAZKA (guard musí projít díky refresh() po undu)
  assert.equal(live.get(1)!.type, "ZAKAZKA");
  assert.deepEqual(calls.undo.map((r) => r.direction), ["undo", "redo"]);
});

test("buildMultiEditCommand: split sourozenci se vrací adresně, ne přes propagaci", async () => {
  const live = new Map([
    [1, blk(1, { splitGroupId: 5, orderNumber: "NOVE", updatedAt: "a2" })],
    [2, blk(2, { splitGroupId: 5, orderNumber: "NOVE", updatedAt: "b2" })],
  ]);
  const { effects, calls } = makeEffects(live);
  await buildMultiEditCommand(
    "Úprava bloku",
    [{ id: 1, updatedAt: "a1", fields: { orderNumber: "PUVODNI" } }, { id: 2, updatedAt: "b1", fields: { orderNumber: "PUVODNI" } }],
    [{ id: 1, updatedAt: "a2", fields: { orderNumber: "NOVE" } }, { id: 2, updatedAt: "b2", fields: { orderNumber: "NOVE" } }],
  ).undo(effects);
  assert.equal(calls.undo[0].ops.length, 2, "sourozenec je vlastní operace, ne důsledek propagace");
  assert.equal(live.get(2)!.orderNumber, "PUVODNI");
});

test("buildMoveCommand: undo vrátí počet dotčených bloků (podklad pro hlášku)", async () => {
  const live = new Map([
    [1, blk(1, { startTime: "2026-07-10T10:00:00.000Z", updatedAt: "v2" })],
    [2, blk(2, { startTime: "2026-07-10T12:00:00.000Z", updatedAt: "w2" })],
  ]);
  const { effects } = makeEffects(live);
  const before = [
    { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1", printMinutes: null, scheduleBypassed: false },
    { id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "w1", printMinutes: null, scheduleBypassed: false },
  ];
  const after = [
    { id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2", printMinutes: null, scheduleBypassed: false },
    { id: 2, startTime: "2026-07-10T12:00:00.000Z", endTime: "2026-07-10T13:00:00.000Z", machine: "XL_105", updatedAt: "w2", printMinutes: null, scheduleBypassed: false },
  ];
  const n = await buildMoveCommand("Přesun", before, after).undo(effects);
  assert.equal(n, 2, "počet se bere z ODPOVĚDI serveru, ne z počtu poslaných ops");
});
