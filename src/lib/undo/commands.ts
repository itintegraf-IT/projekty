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
      // Undo/redo vrací blok do stavu, který už jednou v DB legitimně existoval
      // (mohl být umístěn s bypassem / mimo provoz). Bez tohoto flagu server znovu
      // validuje pracovní dobu a undo selže na tom, co uživatel právě udělal. Server
      // stejně spočítá skutečnou konformitu (effectivelyBypassed) — stav se nezkazí.
      bypassScheduleValidation: true,
    });
    target.updatedAt = updated.updatedAt;
    const { shifted: _shifted, siblings, ...cleanUpdated } = updated;
    effects.addToState([cleanUpdated]);
    // #9: undo/redo shared-field editace split bloku re-triggeruje serverovou propagaci →
    // aplikovat i vrácené sourozence (čerstvý updatedAt), jinak by undo znovu otevřel falešný
    // 409 při následném splitu sourozence (symetrie s handleBlockUpdate v PlannerPage).
    if (siblings && siblings.length > 0) effects.addToState(siblings);
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
 * Editace polí NĚKOLIKA bloků jako JEDEN krok historie (překlopení celé
 * rezervace na zakázku, hromadné uložení). Bez tohohle by Ctrl+Z vrátil jen
 * poslední blok a zbytek by zůstal změněný.
 *
 * Dvě odchylky od `buildEditCommand`, obě vynucené serverovou propagací
 * sdílených polí do split sourozenců (SPLIT_SHARED_FIELDS):
 *   1. `expectedUpdatedAt` se NEposílá — PUT prvního bloku může bumpnout
 *      `updatedAt` dalších cílů a ty by pak spadly na vlastní 409. Souběh
 *      hlídá guard nad ŽIVÝM stavem, který proběhne celý PŘED prvním zápisem
 *      (částečně provedené undo je horší než žádné).
 *   2. Cíl, který už v požadovaném stavu je (server ho propagoval sám), se
 *      přeskočí místo zbytečného PUT.
 */
export function buildMultiEditCommand(
  label: string,
  before: EditSnapshot[],
  after: EditSnapshot[],
): HistoryEntry {
  const apply = async (effects: UndoEffects, targets: EditSnapshot[], expected: EditSnapshot[]) => {
    const expMap = new Map(expected.map((e) => [e.id, e.updatedAt]));
    for (const t of targets) {
      const live = effects.getLiveBlock(t.id);
      const exp = expMap.get(t.id);
      if (!live || exp === undefined || live.updatedAt !== exp) throw new StaleUndoError();
    }
    for (const t of targets) {
      const live = effects.getLiveBlock(t.id) as unknown as Record<string, unknown> | undefined;
      const alreadyThere = live !== undefined
        && Object.entries(t.fields).every(([k, v]) => live[k] === v);
      if (alreadyThere) continue;
      const updated = await effects.putBlock(t.id, {
        ...t.fields,
        resolveChain: true,
        bypassScheduleValidation: true,
      });
      t.updatedAt = updated.updatedAt;
      const { shifted: _shifted, siblings, ...cleanUpdated } = updated;
      effects.addToState([cleanUpdated]);
      if (siblings && siblings.length > 0) effects.addToState(siblings);
    }
  };
  return {
    label,
    undo: (effects) => apply(effects, before, after),
    redo: (effects) => apply(effects, after, before),
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

/** Přesune odsunuté sousedy na `target` pozice a osvěží jim snapshot verze. */
async function restoreShifted(
  effects: UndoEffects,
  target: BlockSnapshot[],
  expected: BlockSnapshot[],
): Promise<void> {
  if (target.length === 0) return;
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
}

/**
 * undo = DELETE vytvořených bloků; redo = re-POST (nová id → remap).
 *
 * `shiftedBefore`/`shiftedAfter` jsou sousedé, které při vytvoření odsunul
 * serverový chain push. Bez nich vrátil Ctrl+Z jen vložený blok a odsunutých
 * dvacet zakázek zůstalo na nových místech (připomínka plánovače, 8/2026).
 *
 * Na pořadí operací záleží — místo se musí uvolnit dřív, než do něj něco jede:
 * undo maže vytvořený blok PŘED návratem sousedů, redo naopak sousedy nejdřív
 * odsune a teprve pak POSTne blok (POST má overlap guard a jinak by spadl).
 */
export function buildCreateCommand(
  label: string,
  created: CreatedRef[],
  shiftedBefore: BlockSnapshot[] = [],
  shiftedAfter: BlockSnapshot[] = [],
): HistoryEntry {
  return {
    label,
    undo: async (effects) => {
      for (const c of created) {
        const live = effects.getLiveBlock(c.id);
        if (!live || live.updatedAt !== c.updatedAt) throw new StaleUndoError();
      }
      guard(effects, shiftedAfter);
      for (const c of created) await effects.deleteBlock(c.id);
      effects.removeFromState(created.map((c) => c.id));
      await restoreShifted(effects, shiftedBefore, shiftedAfter);
    },
    redo: async (effects) => {
      guard(effects, shiftedBefore);
      await restoreShifted(effects, shiftedAfter, shiftedBefore);
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
