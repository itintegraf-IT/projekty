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
 * Fake effects: applyUndo aplikuje ops na živou mapu a bumpne updatedAt (nová atomická
 * cesta). batchUpdate zůstává funkční se skutečným chováním nad `live` mapou — pořád ho
 * potřebují nemigrované buildery v tomhle souboru (buildMultiEditCommand/buildCreateCommand
 * přes `restoreShifted`), Task 6 migruje jen buildMoveCommand/buildEditCommand.
 */
function makeEffects(live: Map<number, Block>) {
  const calls = {
    undo: [] as UndoRequest[],
    added: [] as Block[][],
    removed: [] as number[][],
    batch: [] as unknown[][],
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
    putBlock: async () => { throw new Error("unused"); },
    postBlock: async () => { throw new Error("unused"); },
    deleteBlock: async () => { throw new Error("unused"); },
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
    { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1" },
    { id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "w1" },
  ];
  const after = [
    { id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2" },
    { id: 2, startTime: "2026-07-10T12:00:00.000Z", endTime: "2026-07-10T13:00:00.000Z", machine: "XL_105", updatedAt: "w2" },
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
    [{ id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "w1" }],
    [{ id: 2, startTime: "2026-07-10T12:00:00.000Z", endTime: "2026-07-10T13:00:00.000Z", machine: "XL_105", updatedAt: "w2" }],
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
    applyUndo: async () => { throw new Error("unused"); },
  };
  return { effects, calls };
}

test("buildEditCommand: guard hodí StaleUndoError při neshodě updatedAt", async () => {
  const live = new Map([[1, blk(1, { updatedAt: "CIZI" })]]);
  const { effects } = makeEditEffects(live);
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
    applyUndo: async () => { throw new Error("unused"); },
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

test("buildMoveOrResizeCommand: MOVE (start changed) → undo pošle JEDNO volání applyUndo", async () => {
  const live = new Map([[1, blk(1, { startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const prev = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1" };
  const updated = { id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2" };
  const cmd = buildMoveOrResizeCommand(prev, updated, [], []);
  assert.ok(cmd);
  await cmd.undo(effects);
  assert.equal(calls.undo.length, 1);
  assert.equal(calls.batch.length, 0, "MOVE jde přes applyUndo, ne přes starý batchUpdate");
  const fields = (calls.undo[0].ops[0] as { fields: Record<string, unknown> }).fields;
  assert.equal(fields.startTime, "2026-07-10T08:00:00.000Z");
});

test("buildMoveOrResizeCommand: MOVE (machine changed) → undo pošle JEDNO volání applyUndo", async () => {
  const live = new Map([[1, blk(1, { machine: "XL_106", updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const prev = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1" };
  const updated = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_106", updatedAt: "v2" };
  const cmd = buildMoveOrResizeCommand(prev, updated, [], []);
  assert.ok(cmd);
  await cmd.undo(effects);
  assert.equal(calls.undo.length, 1);
});

test("buildMoveOrResizeCommand: RESIZE (jen endTime) → undo pošle JEDNO volání applyUndo s endTime, NE MOVE", async () => {
  const live = new Map([[1, blk(1, { endTime: "2026-07-10T11:00:00.000Z", updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const prev = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1" };
  const updated = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2" };
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
    { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1", printMinutes: 60 },
    { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2", printMinutes: 180 },
  );
  assert.ok(cmd, "změna endu musí dát undo záznam");
  await cmd.undo(effects);
  const fields = (calls.undo[0].ops[0] as { fields: Record<string, unknown> }).fields;
  assert.equal(fields.endTime, "2026-07-10T09:00:00.000Z");
  assert.equal(fields.printMinutes, 60, "bez printMinutes by blok zůstal se spanem ≠ tiskové minuty");
});

test("buildMoveOrResizeCommand: bez změny času/stroje vrátí null", () => {
  const prev = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1" };
  const updated = { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v2" };
  const cmd = buildMoveOrResizeCommand(prev, updated, [], []);
  assert.equal(cmd, null);
});

// ─── buildMultiEditCommand ────────────────────────────────────────────────────

/** Fake effects s funkčním putBlock: zapisuje pole do živé mapy a bumpne updatedAt. */
function makeMultiEffects(live: Map<number, Block>) {
  const puts: Array<{ id: number; body: Record<string, unknown> }> = [];
  const effects: UndoEffects = {
    getLiveBlock: (id) => live.get(id),
    putBlock: async (id, body) => {
      puts.push({ id, body });
      const cur = live.get(id)!;
      const next = { ...cur, ...body, updatedAt: cur.updatedAt + "+" } as Block;
      live.set(id, next);
      return next;
    },
    batchUpdate: async () => [],
    addToState: (blocks) => { for (const b of blocks) live.set(b.id, b); },
    removeFromState: () => {},
    postBlock: async () => { throw new Error("unused"); },
    deleteBlock: async () => { throw new Error("unused"); },
    applyUndo: async () => { throw new Error("unused"); },
  };
  return { effects, puts };
}

const flipBefore = (id: number): EditSnapshot =>
  ({ id, updatedAt: "v1", fields: { type: "REZERVACE", orderNumber: "R123" } });
const flipAfter = (id: number): EditSnapshot =>
  ({ id, updatedAt: "v2", fields: { type: "ZAKAZKA", orderNumber: "5000" } });

test("buildMultiEditCommand: undo vrátí VŠECHNY bloky jedním krokem", async () => {
  const live = new Map([
    [1, blk(1, { type: "ZAKAZKA", orderNumber: "5000", updatedAt: "v2" })],
    [2, blk(2, { type: "ZAKAZKA", orderNumber: "5000", updatedAt: "v2" })],
  ]);
  const { effects, puts } = makeMultiEffects(live);
  const cmd = buildMultiEditCommand("Překlopení rezervace", [flipBefore(1), flipBefore(2)], [flipAfter(1), flipAfter(2)]);
  await cmd.undo(effects);
  assert.equal(puts.length, 2);
  assert.deepEqual(puts.map((p) => p.id), [1, 2]);
  assert.equal(puts[0].body.type, "REZERVACE");
  assert.equal(puts[1].body.orderNumber, "R123");
});

test("buildMultiEditCommand: neposílá expectedUpdatedAt (server propaguje do split sourozenců)", async () => {
  const live = new Map([[1, blk(1, { type: "ZAKAZKA", orderNumber: "5000", updatedAt: "v2" })]]);
  const { effects, puts } = makeMultiEffects(live);
  await buildMultiEditCommand("x", [flipBefore(1)], [flipAfter(1)]).undo(effects);
  assert.equal(puts[0].body.expectedUpdatedAt, undefined);
  assert.equal(puts[0].body.resolveChain, true);
  assert.equal(puts[0].body.bypassScheduleValidation, true);
});

test("buildMultiEditCommand: cíl už v požadovaném stavu se přeskočí", async () => {
  // Blok 2 server propagoval sám (split sourozenec) — druhý PUT by byl zbytečný.
  const live = new Map([
    [1, blk(1, { type: "ZAKAZKA", orderNumber: "5000", updatedAt: "v2" })],
    [2, blk(2, { type: "REZERVACE", orderNumber: "R123", updatedAt: "v2" })],
  ]);
  const { effects, puts } = makeMultiEffects(live);
  await buildMultiEditCommand("x", [flipBefore(1), flipBefore(2)], [flipAfter(1), flipAfter(2)]).undo(effects);
  assert.deepEqual(puts.map((p) => p.id), [1]);
});

test("buildMultiEditCommand: guard proběhne PŘED prvním zápisem (žádné částečné undo)", async () => {
  const live = new Map([
    [1, blk(1, { type: "ZAKAZKA", orderNumber: "5000", updatedAt: "v2" })],
    [2, blk(2, { type: "ZAKAZKA", orderNumber: "5000", updatedAt: "CIZI" })], // někdo změnil
  ]);
  const { effects, puts } = makeMultiEffects(live);
  const cmd = buildMultiEditCommand("x", [flipBefore(1), flipBefore(2)], [flipAfter(1), flipAfter(2)]);
  await assert.rejects(() => cmd.undo(effects), StaleUndoError);
  assert.equal(puts.length, 0, "blok 1 se nesmí zapsat, když blok 2 neprojde guardem");
});

test("buildMultiEditCommand: chybějící blok ve stavu shodí undo", async () => {
  const live = new Map([[1, blk(1, { type: "ZAKAZKA", updatedAt: "v2" })]]);
  const { effects } = makeMultiEffects(live);
  const cmd = buildMultiEditCommand("x", [flipBefore(1), flipBefore(9)], [flipAfter(1), flipAfter(9)]);
  await assert.rejects(() => cmd.undo(effects), StaleUndoError);
});

test("buildMultiEditCommand: redo znovu překlopí a undo je pak zase možné", async () => {
  const live = new Map([[1, blk(1, { type: "ZAKAZKA", orderNumber: "5000", updatedAt: "v2" })]]);
  const { effects, puts } = makeMultiEffects(live);
  const before = [flipBefore(1)];
  const after = [flipAfter(1)];
  const cmd = buildMultiEditCommand("x", before, after);
  await cmd.undo(effects);          // → REZERVACE, updatedAt v2+
  assert.equal(before[0].updatedAt, "v2+", "snapshot si osvěží verzi z odpovědi");
  await cmd.redo(effects);          // → ZAKAZKA
  assert.deepEqual(puts.map((p) => p.body.type), ["REZERVACE", "ZAKAZKA"]);
});

// ─── buildCreateCommand s odsunutými sousedy ─────────────────────────────────

test("buildCreateCommand: undo smaže vytvořený blok A vrátí odsunuté sousedy", async () => {
  const live = new Map([
    [1, blk(1, { updatedAt: "new" })],                                             // vytvořený
    [2, blk(2, { startTime: "2026-07-10T09:00:00.000Z", updatedAt: "v2" })],        // odsunutý
  ]);
  const { effects, calls } = makeEffects(live);
  const order: string[] = [];
  effects.deleteBlock = async () => { order.push("delete"); };
  const origBatch = effects.batchUpdate;
  effects.batchUpdate = async (u) => { order.push("batch"); return origBatch(u); };

  const created = [{ id: 1, updatedAt: "new", payload: { orderNumber: "X" } }];
  const shiftedBefore = [{ id: 2, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v2" }];
  const shiftedAfter = [{ id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "v2" }];

  await buildCreateCommand("Vložení", created, shiftedBefore, shiftedAfter).undo(effects);
  assert.deepEqual(order, ["delete", "batch"], "místo se musí uvolnit dřív, než se soused vrátí");
  assert.equal(live.get(2)!.startTime, "2026-07-10T08:00:00.000Z");
});

test("buildCreateCommand: redo nejdřív odsune sousedy, pak POSTne blok", async () => {
  const live = new Map([[2, blk(2, { startTime: "2026-07-10T08:00:00.000Z", updatedAt: "v2" })]]);
  const { effects } = makeEffects(live);
  const order: string[] = [];
  effects.postBlock = async () => { order.push("post"); return blk(1, { updatedAt: "again" }); };
  const origBatch = effects.batchUpdate;
  effects.batchUpdate = async (u) => { order.push("batch"); return origBatch(u); };

  const created = [{ id: 1, updatedAt: "new", payload: { orderNumber: "X" } }];
  const shiftedBefore = [{ id: 2, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v2" }];
  const shiftedAfter = [{ id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "v2" }];

  await buildCreateCommand("Vložení", created, shiftedBefore, shiftedAfter).redo(effects);
  assert.deepEqual(order, ["batch", "post"], "POST má overlap guard — místo musí být volné předem");
  assert.equal(created[0].id, 1);
  assert.equal(created[0].updatedAt, "again", "remap id/verze pro další undo");
});

test("buildCreateCommand: změněný odsunutý soused shodí undo dřív, než se cokoli smaže", async () => {
  const live = new Map([
    [1, blk(1, { updatedAt: "new" })],
    [2, blk(2, { updatedAt: "CIZI" })], // někdo jiný s ním mezitím hnul
  ]);
  const { effects } = makeEffects(live);
  let deleted = 0;
  effects.deleteBlock = async () => { deleted++; };
  const created = [{ id: 1, updatedAt: "new", payload: {} }];
  const shiftedBefore = [{ id: 2, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v2" }];
  const shiftedAfter = [{ id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "v2" }];

  await assert.rejects(
    () => buildCreateCommand("Vložení", created, shiftedBefore, shiftedAfter).undo(effects),
    StaleUndoError,
  );
  assert.equal(deleted, 0, "nic se nesmí smazat, když sousedy nejde vrátit");
});

test("buildCreateCommand: bez odsunutých se chová jako dřív (zpětná kompatibilita)", async () => {
  const live = new Map([[1, blk(1, { updatedAt: "new" })]]);
  const { effects, calls } = makeEffects(live);
  let deleted = 0;
  effects.deleteBlock = async () => { deleted++; };
  await buildCreateCommand("Vložení", [{ id: 1, updatedAt: "new", payload: {} }]).undo(effects);
  assert.equal(deleted, 1);
  assert.equal(calls.batch.length, 0, "žádný zbytečný batch, když se nic neodsunulo");
});

test("buildMultiEditCommand: po skipu je redo možné (osvěžená verze)", async () => {
  // Server propagoval sourozence sám → skip. Bez osvěžení updatedAt by opačný
  // směr spadl na guard s předchozí verzí a krok historie by byl mrtvý.
  const live = new Map([
    [1, blk(1, { type: "ZAKAZKA", orderNumber: "5000", updatedAt: "v2" })],
    // sourozenec už vrácený serverovou propagací, verze sedí na `after`
    [2, blk(2, { type: "REZERVACE", orderNumber: "R123", updatedAt: "v2" })],
  ]);
  const { effects, puts } = makeMultiEffects(live);
  const before = [flipBefore(1), flipBefore(2)];
  const after = [flipAfter(1), flipAfter(2)];
  const cmd = buildMultiEditCommand("x", before, after);
  await cmd.undo(effects);
  // před undo měl snapshot „v1"; bez osvěžení by redo spadlo na guard
  assert.equal(before[1].updatedAt, "v2", "skipnutý cíl si musí vzít živou verzi");
  await cmd.redo(effects); // nesmí spadnout na StaleUndoError
  // undo: blok 1 (blok 2 skipnut) · redo: oba, protože propagace už neplatí
  assert.deepEqual(puts.map((p) => p.id), [1, 1, 2]);
});

test("buildMultiEditCommand: vrací i řetězově odsunuté sousedy", async () => {
  const live = new Map([
    [1, blk(1, { type: "ZAKAZKA", orderNumber: "5000", updatedAt: "v2" })],
    [9, blk(9, { startTime: "2026-07-10T12:00:00.000Z", updatedAt: "s2" })],
  ]);
  const { effects } = makeMultiEffects(live);
  const batched: unknown[][] = [];
  effects.batchUpdate = async (u) => {
    batched.push(u);
    return u.map((x) => {
      const cur = live.get(x.id)!;
      const next = { ...cur, startTime: x.startTime, endTime: x.endTime, machine: x.machine, updatedAt: "s3" } as Block;
      live.set(x.id, next);
      return next;
    });
  };
  const shiftedBefore = [{ id: 9, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "s2" }];
  const shiftedAfter = [{ id: 9, startTime: "2026-07-10T12:00:00.000Z", endTime: "2026-07-10T13:00:00.000Z", machine: "XL_105", updatedAt: "s2" }];
  await buildMultiEditCommand("x", [flipBefore(1)], [flipAfter(1)], shiftedBefore, shiftedAfter).undo(effects);
  assert.equal(batched.length, 1, "odsunutý soused se musí vrátit");
  assert.equal(live.get(9)!.startTime, "2026-07-10T08:00:00.000Z");
});
