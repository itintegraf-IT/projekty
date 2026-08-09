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

test("core: chyba ze serveru se propíše do toastu i s příčinou", async () => {
  const toasts: Array<{ msg: string; kind: string }> = [];
  const core = createUndoCore(
    () => ({} as never),
    (msg, kind) => { toasts.push({ msg, kind }); },
  );
  core.record({
    label: "Přesun bloku",
    undo: async () => { throw new Error("Blok koliduje s blokem #17301 na stroji XL 105."); },
    redo: async () => {},
  });
  await core.undo();
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].kind, "error");
  assert.ok(toasts[0].msg.includes("Blok koliduje s blokem #17301"),
    `toast "${toasts[0].msg}" neobsahuje serverovou příčinu`);
  assert.equal(core.state().canUndo, true, "po selhání se záznam vrací na zásobník");
});

test("core: CONFLICT ze serveru se chová jako StaleUndoError (záznam se zahodí)", async () => {
  const toasts: Array<{ msg: string; kind: string }> = [];
  const core = createUndoCore(() => ({} as never), (msg, kind) => { toasts.push({ msg, kind }); });
  core.record({
    label: "Přesun bloku",
    undo: async () => {
      const e = new Error("Bloky byly mezitím změněny jiným uživatelem: 12") as Error & { code?: string };
      e.code = "CONFLICT";
      throw e;
    },
    redo: async () => {},
  });
  await core.undo();
  assert.equal(core.state().canUndo, false, "stale záznam se zahazuje");
  assert.ok(toasts[0].msg.includes("mezitím změněn"));
});

test("core: chyba bez hlášky skončí tečkou, ne visící dvojtečkou", async () => {
  const toasts: Array<{ msg: string; kind: string }> = [];
  const core = createUndoCore(() => ({} as never), (msg, kind) => { toasts.push({ msg, kind }); });
  core.record({
    label: "Přesun bloku",
    undo: async () => { throw new Error(); }, // bez message
    redo: async () => {},
  });
  await core.undo();
  assert.equal(toasts[0].msg, "Vrácení zpět selhalo.", "prázdná hláška nesmí nechat viset dvojtečku bez textu");
  assert.equal(core.state().canUndo, true, "chyba bez hlášky není souběh — záznam se vrací na zásobník");
});

// ── Počet vrácených bloků v hlášce (Vojtova připomínka 9. 8. 2026) ───────────
// Dopředný posun hlásil „Posunuto 71 navazujících bloků", ale krok zpět mlčel,
// takže u velké dávky nešlo poznat, jestli se vrátily VŠECHNY.

function counting(n: number | void): HistoryEntry {
  return { label: "X", undo: async () => n, redo: async () => n };
}

test("core: undo velké dávky ukáže počet vrácených bloků", async () => {
  const toasts: string[] = [];
  const core = createUndoCore(() => noEffects, (m) => toasts.push(m));
  core.record(counting(71));
  await core.undo();
  assert.equal(toasts[0], "Vráceno zpět — 71 bloků");
});

test("core: redo ukáže počet stejně jako undo", async () => {
  const toasts: string[] = [];
  const core = createUndoCore(() => noEffects, (m) => toasts.push(m));
  core.record(counting(22));
  await core.undo();
  await core.redo();
  assert.equal(toasts[1], "Znovu provedeno — 22 bloků");
});

test("core: u jednoho bloku se číslo nevypisuje (byl by to šum)", async () => {
  const toasts: string[] = [];
  const core = createUndoCore(() => noEffects, (m) => toasts.push(m));
  core.record(counting(1));
  await core.undo();
  assert.equal(toasts[0], "Vráceno zpět");
});

test("core: české skloňování — 2 až 4 „bloky\", od 5 „bloků\"", async () => {
  for (const [n, expected] of [[2, "bloky"], [4, "bloky"], [5, "bloků"], [71, "bloků"]] as const) {
    const toasts: string[] = [];
    const core = createUndoCore(() => noEffects, (m) => toasts.push(m));
    core.record(counting(n));
    await core.undo();
    assert.equal(toasts[0], `Vráceno zpět — ${n} ${expected}`);
  }
});

test("core: krok bez počtu (void) hlášku nemění — zpětná kompatibilita", async () => {
  const toasts: string[] = [];
  const core = createUndoCore(() => noEffects, (m) => toasts.push(m));
  core.record(counting(undefined));
  await core.undo();
  assert.equal(toasts[0], "Vráceno zpět");
});
