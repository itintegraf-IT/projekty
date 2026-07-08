import { test } from "node:test";
import assert from "node:assert/strict";
import { createUndoCore } from "./useUndoManager";
import { StaleUndoError, type HistoryEntry, type UndoEffects } from "@/lib/undo/types";

const noEffects = {} as UndoEffects;
function entry(log: string[], id: string, opts: { stale?: boolean } = {}): HistoryEntry {
  return {
    label: id,
    undo: async () => { if (opts.stale) throw new StaleUndoError(); log.push(`undo:${id}`); },
    redo: async () => { log.push(`redo:${id}`); },
  };
}

test("core: record → undo → redo přesouvá mezi stacky a hlásí can*", async () => {
  const log: string[] = []; const toasts: string[] = [];
  const core = createUndoCore(() => noEffects, (m) => toasts.push(m));
  core.record(entry(log, "A"));
  assert.equal(core.state().canUndo, true);
  await core.undo();
  assert.deepEqual(log, ["undo:A"]);
  assert.equal(core.state().canRedo, true);
  await core.redo();
  assert.deepEqual(log, ["undo:A", "redo:A"]);
});

test("core: StaleUndoError zahodí záznam a ukáže toast", async () => {
  const log: string[] = []; const toasts: string[] = [];
  const core = createUndoCore(() => noEffects, (m) => toasts.push(m));
  core.record(entry(log, "A", { stale: true }));
  await core.undo();
  assert.match(toasts.join("|"), /mezitím změněn/);
  assert.equal(core.state().canUndo, false);   // zahozeno, ne vráceno zpět
});

test("core: MAX_HISTORY ořízne nejstarší", async () => {
  const log: string[] = [];
  const core = createUndoCore(() => noEffects, () => {});
  for (let i = 0; i < 35; i++) core.record(entry(log, `E${i}`));
  assert.equal(core.state().depth, 30);
});
