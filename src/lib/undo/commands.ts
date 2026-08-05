import { StaleUndoError, type BlockSnapshot, type EditSnapshot, type HistoryEntry, type UndoEffects, type UndoOpClient } from "./types";

function guard(effects: UndoEffects, expected: BlockSnapshot[]): void {
  for (const s of expected) {
    const live = effects.getLiveBlock(s.id);
    if (!live || live.updatedAt !== s.updatedAt) throw new StaleUndoError();
  }
}

/**
 * BlockSnapshot → operace obnovy pozice. printMinutes/scheduleBypassed jdou do fields jen
 * když jsou ve snapshotu přítomné — TADY, v posOp (u REZERVACE/UDRZBA se tak neposílá jejich
 * `null`/`false` bez důvodu). Pozor, tahle podmíněnost neplatí univerzálně: větev
 * `endChanged` v `buildMoveOrResizeCommand` staví primární fields přímo, bez posOp, a obě
 * pole tam posílá bezpodmínečně (`?? null` / `?? false`) — neškodí (obě jsou v allowlistu
 * a u ne-ZAKAZKA bloku už beztak null/false), ale je to jiná cesta než tahle funkce.
 */
function posOp(t: BlockSnapshot, expectedUpdatedAt?: string): UndoOpClient {
  return {
    kind: "upsert", id: t.id, expectedUpdatedAt,
    fields: {
      startTime: t.startTime, endTime: t.endTime, machine: t.machine,
      ...(t.printMinutes !== undefined ? { printMinutes: t.printMinutes } : {}),
      ...(t.scheduleBypassed !== undefined ? { scheduleBypassed: t.scheduleBypassed } : {}),
    },
  };
}

/** Odpověď serveru → osvěžení verzí ve snapshotech (aby další krok guardem prošel). */
function refresh(snapshots: Array<{ id: number; updatedAt: string }>, updated: Array<{ id: number; updatedAt: string }>) {
  const byId = new Map(updated.map((b) => [b.id, b.updatedAt]));
  for (const s of snapshots) { const u = byId.get(s.id); if (u) s.updatedAt = u; }
}

/**
 * Poziční přesun (drag / resize / lasso) + odsunutí sousedé — JEDNO atomické volání
 * `applyUndo` (POST /api/blocks/undo). Dřív šlo o sekvenci nezávislých `batchUpdate`
 * volání bez transakce mezi nimi; teď celý krok historie projde buď celý, nebo vůbec.
 * before/after jsou mutable: po každém apply se jejich updatedAt osvěží z odpovědi,
 * aby další guard/expectedUpdatedAt seděl.
 */
export function buildMoveCommand(label: string, before: BlockSnapshot[], after: BlockSnapshot[]): HistoryEntry {
  const apply = async (effects: UndoEffects, target: BlockSnapshot[], expected: BlockSnapshot[], direction: "undo" | "redo") => {
    guard(effects, expected);
    const expMap = new Map(expected.map((e) => [e.id, e.updatedAt]));
    const res = await effects.applyUndo({
      label, direction,
      ops: target.map((t) => posOp(t, expMap.get(t.id))),
    });
    refresh(target, res.updated);
    effects.addToState(res.updated);
  };
  return {
    label,
    undo: (effects) => apply(effects, before, after, "undo"),
    redo: (effects) => apply(effects, after, before, "redo"),
  };
}

/**
 * Editace polí primárního bloku + volitelná obnova odsunutých sousedů —
 * JEDNO atomické volání `applyUndo`. Dřív to byl PUT následovaný batchem, mezi
 * kterými nebyla transakce: když selhal batch, editace zůstala provedená.
 *
 * Guard před voláním kontroluje jen primární blok (rychlá klientská zkratka,
 * ušetří zbytečný round-trip) — server uvnitř `applyUndo` kontroluje
 * `expectedUpdatedAt` VŠECH cílů (primár i sousedé) atomicky před prvním
 * zápisem, takže částečná aplikace kroku historie nehrozí, i když klient
 * sousedy předem neguarduje.
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
    target: EditSnapshot, expected: EditSnapshot,
    shiftedTarget: BlockSnapshot[], shiftedExpected: BlockSnapshot[],
    direction: "undo" | "redo",
  ) => {
    const live = effects.getLiveBlock(target.id);
    if (!live || live.updatedAt !== expected.updatedAt) throw new StaleUndoError();
    const expMap = new Map(shiftedExpected.map((e) => [e.id, e.updatedAt]));
    const res = await effects.applyUndo({
      label, direction,
      ops: [
        { kind: "upsert", id: target.id, expectedUpdatedAt: expected.updatedAt, fields: target.fields },
        ...shiftedTarget.map((t) => posOp(t, expMap.get(t.id))),
      ],
    });
    refresh([target, ...shiftedTarget], res.updated);
    effects.addToState(res.updated);
  };
  return {
    label,
    undo: (effects) => apply(effects, before, after, shiftedBefore, shiftedAfter, "undo"),
    redo: (effects) => apply(effects, after, before, shiftedAfter, shiftedBefore, "redo"),
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
  shiftedBefore: BlockSnapshot[] = [],
  shiftedAfter: BlockSnapshot[] = [],
): HistoryEntry {
  const apply = async (
    effects: UndoEffects,
    targets: EditSnapshot[],
    expected: EditSnapshot[],
    shiftedTarget: BlockSnapshot[],
    shiftedExpected: BlockSnapshot[],
  ) => {
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
      if (alreadyThere) {
        // Server cíl překlopil sám (propagace do split skupiny) a bumpnul mu
        // verzi. Bez tohohle by opačný směr spadl na guard s předchozí verzí.
        t.updatedAt = (live as { updatedAt: string }).updatedAt;
        continue;
      }
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
    // Změna typu REZERVACE→ZAKAZKA umí blok re-expandovat přes pauzy směn
    // a odsunout následníky; bez tohohle by je Ctrl+Z nechal přesunuté.
    await restoreShifted(effects, shiftedTarget, shiftedExpected);
  };
  return {
    label,
    undo: (effects) => apply(effects, before, after, shiftedBefore, shiftedAfter),
    redo: (effects) => apply(effects, after, before, shiftedAfter, shiftedBefore),
  };
}

/**
 * MOVE vs RESIZE dispatcher pro poziční mutace bloku (drag/resize). Obě větve teď
 * jedou přes `applyUndo` (buildMoveCommand/buildEditCommand), liší se jen tvarem polí:
 * - start nebo machine se změnily → MOVE (buildMoveCommand): startTime/endTime/machine přes
 *   `posOp`, který k nim (podmíněně, jen když jsou přítomné) připojí i scheduleBypassed —
 *   ten se při čistém MOVE MĚNÍ (server ho přepočítával podle nové pozice, `batch/route.ts:160`),
 *   na rozdíl od printMinutes, který je při MOVE invariant a proto se v `posOp` neřeší zvlášť.
 * - jen endTime se změnil → RESIZE (buildEditCommand): endTime + printMinutes + scheduleBypassed
 *   (endpoint nic nederivuje, takže bez explicitních hodnot by po undo zůstal blok se spanem
 *   neodpovídajícím tiskovým minutám, nebo s bypass příznakem nesedícím na geometrii —
 *   viz api/blocks/[id]/route.ts:153,265,374).
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
    // printMinutes i scheduleBypassed musí jít v poli explicitně — endpoint nic nederivuje
    // (na rozdíl od staré PUT route, která obojí z nové pozice/endTime dopočítala sama, viz
    // api/blocks/[id]/route.ts:153,265,374). Bez printMinutes by po undo zůstal blok se
    // spanem, který neodpovídá tiskovým minutám. Bez scheduleBypassed by zůstal nesedět
    // s geometrií: buď zůstane `true`, i když se blok vrátil do normální pracovní doby,
    // nebo naopak `false` u bloku, který se vrátil mimo ni — druhý případ je horší, protože
    // chain push ho pak bude tiše re-expandovat přes pauzy místo aby ho nechal na místě.
    return buildEditCommand(
      "Změna délky",
      { id: prev.id, updatedAt: prev.updatedAt, fields: { endTime: prev.endTime, printMinutes: prev.printMinutes ?? null, scheduleBypassed: prev.scheduleBypassed ?? false } },
      { id: updated.id, updatedAt: updated.updatedAt, fields: { endTime: updated.endTime, printMinutes: updated.printMinutes ?? null, scheduleBypassed: updated.scheduleBypassed ?? false } },
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
