import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMoveCommand, buildEditCommand, buildCreateCommand, buildDeleteCommand, buildMoveOrResizeCommand } from "./commands";
import { StaleUndoError, type Block, type EditSnapshot, type UndoEffects } from "./types";

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

/** Fake effects: drží živé bloky v mapě, batchUpdate posune a bumpne updatedAt. */
function makeEffects(live: Map<number, Block>) {
  const calls = { batch: [] as unknown[][], added: [] as Block[][] };
  const effects: UndoEffects = {
    getLiveBlock: (id) => live.get(id),
    batchUpdate: async (updates) => {
      calls.batch.push(updates);
      const res = updates.map((u) => {
        const cur = live.get(u.id)!;
        const next = { ...cur, startTime: u.startTime, endTime: u.endTime, machine: u.machine, updatedAt: cur.updatedAt + "+" };
        live.set(u.id, next);
        return next;
      });
      return res;
    },
    addToState: (blocks) => { calls.added.push(blocks); },
    removeFromState: () => {},
    putBlock: async () => { throw new Error("unused"); },
    postBlock: async () => { throw new Error("unused"); },
    deleteBlock: async () => { throw new Error("unused"); },
  };
  return { effects, calls };
}

test("buildMoveCommand: undo přesune blok zpět na 'before' pozici", async () => {
  const live = new Map([[1, blk(1, { startTime: "2026-07-10T10:00:00.000Z", updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const before = [{ id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1" }];
  const after  = [{ id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2" }];
  const cmd = buildMoveCommand("Přesun", before, after);
  await cmd.undo(effects);
  assert.equal(calls.batch.length, 1);
  assert.equal((calls.batch[0][0] as { startTime: string }).startTime, "2026-07-10T08:00:00.000Z");
  assert.equal(live.get(1)!.startTime, "2026-07-10T08:00:00.000Z");
});

test("buildMoveCommand: guard hodí StaleUndoError, když updatedAt neodpovídá", async () => {
  const live = new Map([[1, blk(1, { updatedAt: "CIZI" })]]);
  const { effects } = makeEffects(live);
  const before = [{ id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1" }];
  const after  = [{ id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2" }];
  const cmd = buildMoveCommand("Přesun", before, after);
  await assert.rejects(() => cmd.undo(effects), StaleUndoError);
});

test("buildMoveCommand: undo→redo funguje po osvěžení updatedAt (guard nepadne)", async () => {
  const live = new Map([[1, blk(1, { startTime: "2026-07-10T10:00:00.000Z", updatedAt: "v2" })]]);
  const { effects } = makeEffects(live);
  const before = [{ id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1" }];
  const after  = [{ id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2" }];
  const cmd = buildMoveCommand("Přesun", before, after);
  await cmd.undo(effects);            // live.updatedAt -> "v2+"
  await cmd.redo(effects);            // guard porovná před redo 'before' proti live -> osvěžené sedí
  assert.equal(live.get(1)!.startTime, "2026-07-10T10:00:00.000Z");
});

/** Rozšíření fake effects o putBlock (osvěží updatedAt a vrátí volitelně shifted). */
function makeEditEffects(live: Map<number, Block>) {
  const calls = { put: [] as Array<{ id: number; body: Record<string, unknown> }>, batch: [] as unknown[][], added: [] as Block[][] };
  const effects: UndoEffects = {
    getLiveBlock: (id) => live.get(id),
    putBlock: async (id, body) => {
      calls.put.push({ id, body });
      const cur = live.get(id)!;
      const next = { ...cur, ...body, updatedAt: cur.updatedAt + "+" } as Block;
      live.set(id, next);
      return next;
    },
    batchUpdate: async (updates) => {
      calls.batch.push(updates);
      return updates.map((u) => {
        const cur = live.get(u.id)!;
        const n = { ...cur, startTime: u.startTime, endTime: u.endTime, machine: u.machine, updatedAt: cur.updatedAt + "+" };
        live.set(u.id, n); return n;
      });
    },
    addToState: (blocks) => { calls.added.push(blocks); },
    removeFromState: () => {},
    postBlock: async () => { throw new Error("unused"); },
    deleteBlock: async () => { throw new Error("unused"); },
  };
  return { effects, calls };
}

test("buildEditCommand: undo pošle PUT se starými hodnotami polí", async () => {
  const live = new Map([[1, blk(1, { description: "NEW", updatedAt: "v2" })]]);
  const { effects, calls } = makeEditEffects(live);
  const before: EditSnapshot = { id: 1, updatedAt: "v1", fields: { description: "OLD" } };
  const after:  EditSnapshot = { id: 1, updatedAt: "v2", fields: { description: "NEW" } };
  const cmd = buildEditCommand("Editace", before, after);
  await cmd.undo(effects);
  assert.equal(calls.put.length, 1);
  assert.equal(calls.put[0].body.description, "OLD");
  assert.equal(live.get(1)!.description, "OLD");
});

test("buildEditCommand: guard hodí StaleUndoError při neshodě updatedAt", async () => {
  const live = new Map([[1, blk(1, { updatedAt: "CIZI" })]]);
  const { effects } = makeEditEffects(live);
  const before: EditSnapshot = { id: 1, updatedAt: "v1", fields: { description: "OLD" } };
  const after:  EditSnapshot = { id: 1, updatedAt: "v2", fields: { description: "NEW" } };
  const cmd = buildEditCommand("Editace", before, after);
  await assert.rejects(() => cmd.undo(effects), StaleUndoError);
});

test("buildEditCommand: undo pošle PUT s expectedUpdatedAt = 'after'.updatedAt", async () => {
  const live = new Map([[1, blk(1, { description: "NEW", updatedAt: "v2" })]]);
  const { effects, calls } = makeEditEffects(live);
  const before: EditSnapshot = { id: 1, updatedAt: "v1", fields: { description: "OLD" } };
  const after:  EditSnapshot = { id: 1, updatedAt: "v2", fields: { description: "NEW" } };
  const cmd = buildEditCommand("Editace", before, after);
  await cmd.undo(effects);
  assert.equal(calls.put.length, 1);
  assert.equal(calls.put[0].body.expectedUpdatedAt, after.updatedAt);
});

test("buildEditCommand: addToState nedostane 'shifted' property z PUT odpovědi", async () => {
  const live = new Map([[1, blk(1, { description: "NEW", updatedAt: "v2" })]]);
  const calls = { put: [] as Array<{ id: number; body: Record<string, unknown> }>, added: [] as Block[][] };
  const effects: UndoEffects = {
    getLiveBlock: (id) => live.get(id),
    putBlock: async (id, body) => {
      calls.put.push({ id, body });
      const cur = live.get(id)!;
      const next = { ...cur, ...body, updatedAt: cur.updatedAt + "+" } as Block;
      live.set(id, next);
      return { ...next, shifted: [blk(2, { updatedAt: "s1" })] };
    },
    batchUpdate: async () => { throw new Error("unused"); },
    addToState: (blocks) => { calls.added.push(blocks); },
    removeFromState: () => {},
    postBlock: async () => { throw new Error("unused"); },
    deleteBlock: async () => { throw new Error("unused"); },
  };
  const before: EditSnapshot = { id: 1, updatedAt: "v1", fields: { description: "OLD" } };
  const after:  EditSnapshot = { id: 1, updatedAt: "v2", fields: { description: "NEW" } };
  const cmd = buildEditCommand("Editace", before, after);
  await cmd.undo(effects);
  assert.equal(calls.added.length, 1);
  assert.equal("shifted" in calls.added[0][0], false);
});

test("buildEditCommand: aplikuje serverové siblings přes addToState (#9 undo cesta) + nestrká 'siblings' do primárního bloku", async () => {
  const live = new Map([[1, blk(1, { description: "NEW", updatedAt: "v2" })]]);
  const calls = { added: [] as Block[][] };
  const effects: UndoEffects = {
    getLiveBlock: (id) => live.get(id),
    putBlock: async (id, body) => {
      const cur = live.get(id)!;
      const next = { ...cur, ...body, updatedAt: cur.updatedAt + "+" } as Block;
      live.set(id, next);
      // undo shared-field editace → server znovu propaguje a vrátí sourozence s čerstvým updatedAt
      return { ...next, siblings: [blk(2, { splitGroupId: 42, updatedAt: "sib+" })] };
    },
    batchUpdate: async () => { throw new Error("unused"); },
    addToState: (blocks) => { calls.added.push(blocks); },
    removeFromState: () => {},
    postBlock: async () => { throw new Error("unused"); },
    deleteBlock: async () => { throw new Error("unused"); },
  };
  const before: EditSnapshot = { id: 1, updatedAt: "v1", fields: { description: "OLD" } };
  const after:  EditSnapshot = { id: 1, updatedAt: "v2", fields: { description: "NEW" } };
  const cmd = buildEditCommand("Editace", before, after);
  await cmd.undo(effects);
  // primární blok NEnese 'siblings' property (nezanese se do stavu)
  assert.equal("siblings" in calls.added[0][0], false);
  // sourozenci se aplikovali druhým addToState voláním s čerstvým updatedAt
  assert.equal(calls.added.length, 2);
  assert.equal(calls.added[1][0].id, 2);
  assert.equal(calls.added[1][0].updatedAt, "sib+");
});

test("buildEditCommand: obnoví i odsunuté sousedy přes batch", async () => {
  const live = new Map([
    [1, blk(1, { description: "NEW", updatedAt: "v2" })],
    [2, blk(2, { startTime: "2026-07-10T11:00:00.000Z", updatedAt: "s2" })],
  ]);
  const { effects, calls } = makeEditEffects(live);
  const before: EditSnapshot = { id: 1, updatedAt: "v1", fields: { description: "OLD" } };
  const after:  EditSnapshot = { id: 1, updatedAt: "v2", fields: { description: "NEW" } };
  const shiftedBefore = [{ id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "s2" }];
  const shiftedAfter  = [{ id: 2, startTime: "2026-07-10T11:00:00.000Z", endTime: "2026-07-10T12:00:00.000Z", machine: "XL_105", updatedAt: "s2" }];
  const cmd = buildEditCommand("Editace", before, after, shiftedBefore, shiftedAfter);
  await cmd.undo(effects);
  assert.equal(calls.batch.length, 1);
  assert.equal((calls.batch[0][0] as { startTime: string }).startTime, "2026-07-10T09:00:00.000Z");
});

/** Fake effects pro buildCreateCommand: postBlock vrací nové id, deleteBlock smaže z mapy. */
function makeCreateEffects(live: Map<number, Block>, nextId = { v: 100 }) {
  const calls = { deleted: [] as number[], posted: [] as Record<string, unknown>[], added: [] as Block[][], removed: [] as number[][] };
  const effects: UndoEffects = {
    getLiveBlock: (id) => live.get(id),
    deleteBlock: async (id) => { calls.deleted.push(id); live.delete(id); },
    postBlock: async (body) => {
      calls.posted.push(body);
      const id = nextId.v++;
      const b = blk(id, { updatedAt: "n1" });
      live.set(id, b); return b;
    },
    addToState: (blocks) => { calls.added.push(blocks); },
    removeFromState: (ids) => { calls.removed.push(ids); },
    batchUpdate: async () => { throw new Error("unused"); },
    putBlock: async () => { throw new Error("unused"); },
  };
  return { effects, calls };
}

test("buildCreateCommand: undo smaže vytvořený blok", async () => {
  const live = new Map([[100, blk(100, { updatedAt: "n1" })]]);
  const { effects, calls } = makeCreateEffects(live);
  const cmd = buildCreateCommand("Vložení", [{ id: 100, updatedAt: "n1", payload: { orderNumber: "X" } }]);
  await cmd.undo(effects);
  assert.deepEqual(calls.deleted, [100]);
  assert.deepEqual(calls.removed, [[100]]);
});

test("buildCreateCommand: undo hodí StaleUndoError, když byl blok mezitím změněn", async () => {
  const live = new Map([[100, blk(100, { updatedAt: "CIZI" })]]);
  const { effects } = makeCreateEffects(live);
  const cmd = buildCreateCommand("Vložení", [{ id: 100, updatedAt: "n1", payload: { orderNumber: "X" } }]);
  await assert.rejects(() => cmd.undo(effects), StaleUndoError);
});

test("buildCreateCommand: redo re-POSTne a remapne id pro další undo", async () => {
  const live = new Map([[100, blk(100, { updatedAt: "n1" })]]);
  const { effects, calls } = makeCreateEffects(live, { v: 500 });
  const cmd = buildCreateCommand("Vložení", [{ id: 100, updatedAt: "n1", payload: { orderNumber: "X" } }]);
  await cmd.undo(effects);            // smaže 100
  await cmd.redo(effects);            // re-POST -> nové id 500 (nextId=500)
  // po redo musí jít znovu undo bez chyby (id byl remapnut na nově vytvořený)
  await cmd.undo(effects);
  assert.equal(calls.posted.length, 1);
  assert.deepEqual(calls.deleted, [100, 500]);
});

test("buildDeleteCommand: undo re-POSTne smazané bloky", async () => {
  const live = new Map<number, Block>();
  const { effects, calls } = makeCreateEffects(live);
  const cmd = buildDeleteCommand("Smazání", [{ payload: { orderNumber: "A" } }, { payload: { orderNumber: "B" } }]);
  await cmd.undo(effects);
  assert.equal(calls.posted.length, 2);
  assert.equal(calls.added.length, 1);
  assert.equal(calls.added[0].length, 2);
});

test("buildDeleteCommand: redo znovu smaže obnovené bloky", async () => {
  const live = new Map<number, Block>();
  const { effects, calls } = makeCreateEffects(live);
  const cmd = buildDeleteCommand("Smazání", [{ payload: { orderNumber: "A" } }]);
  await cmd.undo(effects);            // re-POST -> id 100
  await cmd.redo(effects);            // DELETE 100
  assert.deepEqual(calls.deleted, [100]);
});

test("buildDeleteCommand: undo předá payload vč. splitGroupId do postBlock (split část se vrátí do skupiny)", async () => {
  const live = new Map<number, Block>();
  const { effects, calls } = makeCreateEffects(live);
  const cmd = buildDeleteCommand("Smazání bloku", [{ payload: { orderNumber: "A", splitGroupId: 42 } }]);
  await cmd.undo(effects);
  assert.equal(calls.posted.length, 1);
  assert.equal(calls.posted[0].splitGroupId, 42);
});

test("buildMoveOrResizeCommand: MOVE (start changed) → undo použije batchUpdate", async () => {
  const live = new Map([[1, blk(1, { startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const prev = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1" };
  const updated = { id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2" };
  const cmd = buildMoveOrResizeCommand(prev, updated, [], []);
  assert.ok(cmd);
  await cmd!.undo(effects);
  assert.equal(calls.batch.length, 1);
  assert.equal((calls.batch[0][0] as { startTime: string }).startTime, "2026-07-10T08:00:00.000Z");
});

test("buildMoveOrResizeCommand: MOVE (machine changed) → undo použije batchUpdate", async () => {
  const live = new Map([[1, blk(1, { machine: "XL_106", updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const prev = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1" };
  const updated = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_106", updatedAt: "v2" };
  const cmd = buildMoveOrResizeCommand(prev, updated, [], []);
  assert.ok(cmd);
  await cmd!.undo(effects);
  assert.equal(calls.batch.length, 1);
});

test("buildMoveOrResizeCommand: RESIZE (jen endTime) → undo použije PUT se starým endTime, NE batch", async () => {
  const live = new Map([[1, blk(1, { endTime: "2026-07-10T11:00:00.000Z", updatedAt: "v2" })]]);
  const { effects, calls } = makeEditEffects(live);
  const prev = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1" };
  const updated = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2" };
  const cmd = buildMoveOrResizeCommand(prev, updated, [], []);
  assert.ok(cmd);
  await cmd!.undo(effects);
  assert.equal(calls.put.length, 1);
  assert.equal(calls.put[0].body.endTime, "2026-07-10T09:00:00.000Z");
  assert.equal(calls.batch.length, 0);
});

test("buildMoveOrResizeCommand: bez změny času/stroje vrátí null", () => {
  const prev = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1" };
  const updated = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v2" };
  const cmd = buildMoveOrResizeCommand(prev, updated, [], []);
  assert.equal(cmd, null);
});

test("buildEditCommand: undo pošle PUT s bypassScheduleValidation:true (undo nevaliduje pracovní dobu)", async () => {
  const live = new Map([[1, blk(1, { endTime: "2026-07-10T11:00:00.000Z", updatedAt: "v2" })]]);
  const { effects, calls } = makeEditEffects(live);
  const before: EditSnapshot = { id: 1, updatedAt: "v1", fields: { endTime: "2026-07-10T09:00:00.000Z" } };
  const after:  EditSnapshot = { id: 1, updatedAt: "v2", fields: { endTime: "2026-07-10T11:00:00.000Z" } };
  const cmd = buildEditCommand("Změna délky", before, after);
  await cmd.undo(effects);
  assert.equal(calls.put[0].body.bypassScheduleValidation, true, "undo edit musí obcházet validaci pracovní doby — vrací dříve existující stav");
  await cmd.redo(effects);
  assert.equal(calls.put[1].body.bypassScheduleValidation, true, "redo edit taktéž");
});
