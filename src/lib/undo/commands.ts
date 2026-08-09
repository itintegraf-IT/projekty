import { StaleUndoError, type BlockSnapshot, type EditSnapshot, type HistoryEntry, type UndoEffects, type UndoOpClient } from "./types";

function guard(effects: UndoEffects, expected: BlockSnapshot[]): void {
  for (const s of expected) {
    const live = effects.getLiveBlock(s.id);
    if (!live || live.updatedAt !== s.updatedAt) throw new StaleUndoError();
  }
}

/**
 * BlockSnapshot → operace obnovy pozice. `printMinutes`/`scheduleBypassed` jdou do fields
 * VŽDY, bezpodmínečně — obě pole jsou v `BlockSnapshot` POVINNÁ (byť nullable, viz types.ts),
 * takže `!== undefined` by bylo vždy pravdivé (mrtvá podmínka, D1 z go/no-go auditu 5. 8. 2026
 * — dřív tu skutečně podmíněná spread-verze byla, dokud typ nezpřísnil na povinná pole).
 * Endpoint nic nederivuje, takže bez nich by po undo/redo zůstal blok se spanem
 * neodpovídajícím tiskovým minutám, nebo s bypass příznakem nesedícím na vrácenou geometrii.
 * Stejná bezpodmínečnost, jakou pro tahle dvě pole odjakživa používá i větev `endChanged`
 * v `buildMoveOrResizeCommand` (staví fields přímo, bez posOp, přes `?? null`/`?? false`) —
 * obě cesty jsou teď v souladu, ne dvě rozdílné.
 */
function posOp(t: BlockSnapshot, expectedUpdatedAt?: string): UndoOpClient {
  return {
    kind: "upsert", id: t.id, expectedUpdatedAt,
    fields: {
      startTime: t.startTime, endTime: t.endTime, machine: t.machine,
      printMinutes: t.printMinutes, scheduleBypassed: t.scheduleBypassed,
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
 * rezervace, hromadné uložení) — JEDNO atomické volání.
 *
 * `expectedUpdatedAt` se nově posílá u KAŽDÉHO cíle. Dřív se vynechával,
 * protože sekvenční PUTy si navzájem bumpovaly verze přes serverovou propagaci
 * do split sourozenců. Endpoint čte stav jednou a zapisuje až po kontrole
 * všech zámků, takže si cíle nemůžou nic shodit.
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
    targets: EditSnapshot[], expected: EditSnapshot[],
    shiftedTarget: BlockSnapshot[], shiftedExpected: BlockSnapshot[],
    direction: "undo" | "redo",
  ) => {
    const expMap = new Map(expected.map((e) => [e.id, e.updatedAt]));
    for (const t of targets) {
      const live = effects.getLiveBlock(t.id);
      const exp = expMap.get(t.id);
      if (!live || exp === undefined || live.updatedAt !== exp) throw new StaleUndoError();
    }
    const shiftMap = new Map(shiftedExpected.map((e) => [e.id, e.updatedAt]));
    const res = await effects.applyUndo({
      label, direction,
      ops: [
        ...targets.map((t) => ({ kind: "upsert" as const, id: t.id, expectedUpdatedAt: expMap.get(t.id), fields: t.fields })),
        ...shiftedTarget.map((t) => posOp(t, shiftMap.get(t.id))),
      ],
    });
    refresh([...targets, ...shiftedTarget], res.updated);
    effects.addToState(res.updated);
  };
  return {
    label,
    undo: (effects) => apply(effects, before, after, shiftedBefore, shiftedAfter, "undo"),
    redo: (effects) => apply(effects, after, before, shiftedAfter, shiftedBefore, "redo"),
  };
}

/**
 * MOVE vs RESIZE dispatcher pro poziční mutace bloku (drag/resize). Obě větve teď
 * jedou přes `applyUndo` (buildMoveCommand/buildEditCommand), liší se jen tvarem polí:
 * - start nebo machine se změnily → MOVE (buildMoveCommand): startTime/endTime/machine +
 *   scheduleBypassed (MĚNÍ se — server ho přepočítává podle nové pozice, `batch/route.ts:160`)
 *   + printMinutes (při MOVE invariant, ale `BlockSnapshot` ho má povinné, viz níž) jdou
 *   v primárním snapshotu explicitně; `posOp` je do `fields` propíše bezpodmínečně. Před
 *   zpřísněním `BlockSnapshot` na povinná pole (Task 7 Step 0) tahle větev scheduleBypassed
 *   vůbec neposílala — reálná mezera (undo po MOVE nechávalo bypass příznak nesedící na
 *   vrácenou geometrii), kterou zpřísnění typu odhalilo přes `npx tsc --noEmit`.
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
        { id: prev.id, startTime: prev.startTime, endTime: prev.endTime, machine: prev.machine, updatedAt: prev.updatedAt, printMinutes: prev.printMinutes ?? null, scheduleBypassed: prev.scheduleBypassed ?? false },
        ...shiftedBefore,
      ],
      [
        { id: updated.id, startTime: updated.startTime, endTime: updated.endTime, machine: updated.machine, updatedAt: updated.updatedAt, printMinutes: updated.printMinutes ?? null, scheduleBypassed: updated.scheduleBypassed ?? false },
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

/** Snapshot vytvořeného bloku — `fields` slouží k obnově při redo. */
type CreatedRef = { id: number; updatedAt: string; fields: Record<string, unknown> };

/**
 * undo = smazat vytvořené bloky A vrátit odsunuté sousedy — v JEDNÉ transakci.
 * redo = obnovit bloky (pod PŮVODNÍM id) A znovu odsunout sousedy, taktéž
 * v jedné transakci.
 *
 * `shiftedBefore`/`shiftedAfter` jsou sousedé, které při vytvoření odsunul
 * serverový chain push. Bez nich vrátil Ctrl+Z jen vložený blok a odsunutých
 * dvacet zakázek zůstalo na nových místech (připomínka plánovače, 8/2026).
 *
 * Dřív na pořadí záleželo (undo muselo mazat před návratem sousedů, redo
 * naopak), protože každý mezikrok narazil na finální pojistku batche. Uvnitř
 * transakce mezistavy nikdo nevidí, takže pořadí řeší server.
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
      const expMap = new Map(shiftedAfter.map((e) => [e.id, e.updatedAt]));
      const res = await effects.applyUndo({
        label, direction: "undo",
        ops: [
          ...created.map((c) => ({ kind: "remove" as const, id: c.id, expectedUpdatedAt: c.updatedAt })),
          ...shiftedBefore.map((t) => posOp(t, expMap.get(t.id))),
        ],
      });
      refresh(shiftedBefore, res.updated);
      effects.removeFromState(res.removed);
      effects.addToState(res.updated);
    },
    redo: async (effects) => {
      guard(effects, shiftedBefore);
      const expMap = new Map(shiftedBefore.map((e) => [e.id, e.updatedAt]));
      const res = await effects.applyUndo({
        label, direction: "redo",
        ops: [
          ...created.map((c) => ({ kind: "upsert" as const, id: c.id, fields: c.fields })),
          ...shiftedAfter.map((t) => posOp(t, expMap.get(t.id))),
        ],
      });
      refresh([...created, ...shiftedAfter], res.updated);
      effects.addToState(res.updated);
    },
  };
}

/** Snapshot smazaného bloku — `fields` z `blockToRestoreFields`, `updatedAt` z okamžiku smazání. */
type DeletedRef = {
  id: number;
  updatedAt: string;
  fields: Record<string, unknown>;
  /**
   * Datum vzniku smazaného bloku. Nejde do `fields` (allowlist
   * `UNDO_RESTORABLE_FIELDS` ho vědomě nemá) — server ho použije jen ve větvi
   * vzkříšení. Volitelné kvůli zpětné kompatibilitě: záznam v historii
   * vytvořený starším kódem ho nenese a undo funguje jako dřív.
   */
  createdAt?: string;
};

/**
 * undo = obnovit smazané bloky pod PŮVODNÍM id; redo = smazat je znovu.
 *
 * Původní id znamená, že bloku zůstane navázaná historie v AuditLogu
 * i notifikace. Zároveň tím mizí remap (`restoredId`) a s ním třída duplicit,
 * kdy opakované Ctrl+Z vyrábělo další a další kopie.
 *
 * `expectedUpdatedAt` na OBOU směrech (review Tasku 7, nález M1). Na undo je to
 * bezpečné vždy — `sanitizeUndoOps`/`applyUndoOps` kontrolu přeskočí, pokud řádek
 * ještě neexistuje (typický případ: blok je smazaný), takže na PRVNÍ undo nemá
 * žádný efekt. Skutečně chrání REDO: blok se vrací pod PŮVODNÍM id, které vidí
 * každý klient přes SSE — bez zámku by ho mohl kdokoli mezi undo a redo
 * přesunout/upravit a redo by tu změnu beze stopy smazal. `refresh(deleted, ...)`
 * po undu je nutný, aby redo dostalo updatedAt ČERSTVĚ obnoveného řádku, ne
 * hodnotu z okamžiku smazání (ta by u druhého a dalšího cyklu byla vždy stale).
 */
export function buildDeleteCommand(label: string, deleted: DeletedRef[]): HistoryEntry {
  return {
    label,
    undo: async (effects) => {
      const res = await effects.applyUndo({
        label, direction: "undo",
        ops: deleted.map((d) => ({
          kind: "upsert" as const,
          id: d.id,
          expectedUpdatedAt: d.updatedAt,
          fields: d.fields,
          ...(d.createdAt ? { createdAt: d.createdAt } : {}),
        })),
      });
      refresh(deleted, res.updated);
      effects.addToState(res.updated);
    },
    redo: async (effects) => {
      const res = await effects.applyUndo({
        label, direction: "redo",
        ops: deleted.map((d) => ({ kind: "remove" as const, id: d.id, expectedUpdatedAt: d.updatedAt })),
      });
      effects.removeFromState(res.removed);
    },
  };
}
