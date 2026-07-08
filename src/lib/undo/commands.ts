import { StaleUndoError, type BlockSnapshot, type EditSnapshot, type HistoryEntry, type UndoEffects } from "./types";

function guard(effects: UndoEffects, expected: BlockSnapshot[]): void {
  for (const s of expected) {
    const live = effects.getLiveBlock(s.id);
    if (!live || live.updatedAt !== s.updatedAt) throw new StaleUndoError();
  }
}

/**
 * Poziční přesun (drag / resize / lasso) + odsunutí sousedé. undo/redo přes batchUpdate.
 * before/after jsou mutable: po každém apply se jejich updatedAt osvěží z odpovědi serveru,
 * aby další guard/expectedUpdatedAt seděl.
 */
export function buildMoveCommand(label: string, before: BlockSnapshot[], after: BlockSnapshot[]): HistoryEntry {
  const apply = async (effects: UndoEffects, target: BlockSnapshot[], expected: BlockSnapshot[]) => {
    guard(effects, expected);
    const expMap = new Map(expected.map((e) => [e.id, e.updatedAt]));
    const res = await effects.batchUpdate(
      target.map((t) => ({
        id: t.id, startTime: t.startTime, endTime: t.endTime, machine: t.machine,
        expectedUpdatedAt: expMap.get(t.id),
      })),
    );
    const resMap = new Map(res.map((b) => [b.id, b.updatedAt]));
    for (const t of target) { const u = resMap.get(t.id); if (u) t.updatedAt = u; }
    effects.addToState(res);
  };
  return {
    label,
    undo: (effects) => apply(effects, before, after),
    redo: (effects) => apply(effects, after, before),
  };
}

/**
 * Editace polí primárního bloku (PUT) + volitelná obnova odsunutých sousedů (batch).
 * before/after nesou editovaná pole; shiftedBefore/After pozice sousedů. Mutable updatedAt.
 */
export function buildEditCommand(
  label: string,
  before: EditSnapshot,
  after: EditSnapshot,
  shiftedBefore: BlockSnapshot[] = [],
  shiftedAfter: BlockSnapshot[] = [],
): HistoryEntry {
  const apply = async (
    effects: UndoEffects,
    target: EditSnapshot,
    expected: EditSnapshot,
    shiftedTarget: BlockSnapshot[],
    shiftedExpected: BlockSnapshot[],
  ) => {
    const live = effects.getLiveBlock(target.id);
    if (!live || live.updatedAt !== expected.updatedAt) throw new StaleUndoError();
    const updated = await effects.putBlock(target.id, {
      ...target.fields,
      expectedUpdatedAt: expected.updatedAt,
      resolveChain: true,
    });
    target.updatedAt = updated.updatedAt;
    const { shifted: _shifted, ...cleanUpdated } = updated;
    effects.addToState([cleanUpdated]);
    if (shiftedTarget.length > 0) {
      const expMap = new Map(shiftedExpected.map((e) => [e.id, e.updatedAt]));
      const res = await effects.batchUpdate(
        shiftedTarget.map((t) => ({
          id: t.id, startTime: t.startTime, endTime: t.endTime, machine: t.machine,
          expectedUpdatedAt: expMap.get(t.id),
        })),
      );
      const resMap = new Map(res.map((b) => [b.id, b.updatedAt]));
      for (const t of shiftedTarget) { const u = resMap.get(t.id); if (u) t.updatedAt = u; }
      effects.addToState(res);
    }
  };
  return {
    label,
    undo: (effects) => apply(effects, before, after, shiftedBefore, shiftedAfter),
    redo: (effects) => apply(effects, after, before, shiftedAfter, shiftedBefore),
  };
}

/**
 * MOVE vs RESIZE dispatcher pro poziční mutace bloku (drag/resize).
 * - start nebo machine se změnily → MOVE, undo/redo přes batchUpdate (stávající chování).
 * - jen endTime se změnil → RESIZE, undo/redo přes PUT endTime (server invertuje printMinutes
 *   zpět; batch by pro ZAKAZKA endTime ignoroval a undo by byl no-op — viz api/blocks/batch).
 * - nic se nezměnilo → null (nezaznamenávat prázdnou undo položku).
 */
export function buildMoveOrResizeCommand(
  prev: BlockSnapshot,
  updated: BlockSnapshot,
  shiftedBefore: BlockSnapshot[] = [],
  shiftedAfter: BlockSnapshot[] = [],
): HistoryEntry | null {
  const startOrMachineChanged =
    new Date(prev.startTime).getTime() !== new Date(updated.startTime).getTime() ||
    prev.machine !== updated.machine;
  const endChanged = new Date(prev.endTime).getTime() !== new Date(updated.endTime).getTime();
  if (startOrMachineChanged) {
    return buildMoveCommand(
      "Přesun bloku",
      [
        { id: prev.id, startTime: prev.startTime, endTime: prev.endTime, machine: prev.machine, updatedAt: prev.updatedAt },
        ...shiftedBefore,
      ],
      [
        { id: updated.id, startTime: updated.startTime, endTime: updated.endTime, machine: updated.machine, updatedAt: updated.updatedAt },
        ...shiftedAfter,
      ],
    );
  }
  if (endChanged) {
    return buildEditCommand(
      "Změna délky",
      { id: prev.id, updatedAt: prev.updatedAt, fields: { endTime: prev.endTime } },
      { id: updated.id, updatedAt: updated.updatedAt, fields: { endTime: updated.endTime } },
      shiftedBefore,
      shiftedAfter,
    );
  }
  return null;
}

type CreatedRef = { id: number; updatedAt: string; payload: Record<string, unknown> };

/** undo = DELETE vytvořených bloků; redo = re-POST (nová id → remap). */
export function buildCreateCommand(label: string, created: CreatedRef[]): HistoryEntry {
  return {
    label,
    undo: async (effects) => {
      for (const c of created) {
        const live = effects.getLiveBlock(c.id);
        if (!live || live.updatedAt !== c.updatedAt) throw new StaleUndoError();
      }
      for (const c of created) await effects.deleteBlock(c.id);
      effects.removeFromState(created.map((c) => c.id));
    },
    redo: async (effects) => {
      const recreated: import("./types").Block[] = [];
      for (const c of created) {
        const b = await effects.postBlock(c.payload);
        c.id = b.id;            // remap pro další undo
        c.updatedAt = b.updatedAt;
        recreated.push(b);
      }
      effects.addToState(recreated);
    },
  };
}

type DeletedRef = { payload: Record<string, unknown>; restoredId?: number };

/** undo = re-POST smazaných (nová id → remap); redo = DELETE obnovených. */
export function buildDeleteCommand(label: string, deleted: DeletedRef[]): HistoryEntry {
  return {
    label,
    undo: async (effects) => {
      const recreated: import("./types").Block[] = [];
      for (const d of deleted) {
        const b = await effects.postBlock(d.payload);
        d.restoredId = b.id;
        recreated.push(b);
      }
      effects.addToState(recreated);
    },
    redo: async (effects) => {
      const ids = deleted.map((d) => d.restoredId).filter((id): id is number => typeof id === "number");
      for (const id of ids) await effects.deleteBlock(id);
      effects.removeFromState(ids);
      for (const d of deleted) d.restoredId = undefined;
    },
  };
}
