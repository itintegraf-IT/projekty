import type React from "react";
import { useCallback, useRef, useState } from "react";
import { StaleUndoError, type HistoryEntry, type UndoEffects } from "@/lib/undo/types";

const MAX_HISTORY = 30;
type Toast = (msg: string, kind: "info" | "error") => void;

/** Server hlásí souběh kódem CONFLICT — na klientovi má stejný osud jako StaleUndoError. */
function isStale(err: unknown): boolean {
  return err instanceof StaleUndoError || (err as { code?: string })?.code === "CONFLICT";
}

/** Hláška serveru je jediná informace, ze které plánovač pozná, co má udělat. */
function reason(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  return msg.length > 0 ? `: ${msg}` : ".";
}

/** Čisté jádro bez Reactu — testovatelné. */
/**
 * Dovětek s počtem dotčených bloků: „ — 71 bloků". U jednoho bloku se vynechá,
 * tam je číslo šum. Skloňování je české, ne „1 bloků" jako u dopředné hlášky.
 *
 * Bez něj krok zpět mlčel: přesun ohlásil „Posunuto 71 navazujících bloků",
 * ale po Ctrl+Z nebylo poznat, jestli se vrátily všechny (Vojta 9. 8. 2026).
 */
function blockSuffix(n: number | void): string {
  if (typeof n !== "number" || n <= 1) return "";
  return ` — ${n} ${n < 5 ? "bloky" : "bloků"}`;
}

export function createUndoCore(getEffects: () => UndoEffects, toast: Toast) {
  const undoStack: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];
  let onChange: (() => void) | null = null;
  const notify = () => onChange?.();

  const record = (entry: HistoryEntry) => {
    undoStack.push(entry);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    notify();
  };
  const undo = async () => {
    const entry = undoStack.pop();
    if (!entry) return;
    try {
      const n = await entry.undo(getEffects());
      redoStack.push(entry);
      toast(`Vráceno zpět${blockSuffix(n)}`, "info");
    } catch (err) {
      if (isStale(err)) toast(`Nelze vrátit${reason(err)}`, "error");
      else { undoStack.push(entry); toast(`Vrácení zpět selhalo${reason(err)}`, "error"); }
    } finally { notify(); }
  };
  const redo = async () => {
    const entry = redoStack.pop();
    if (!entry) return;
    try {
      const n = await entry.redo(getEffects());
      undoStack.push(entry);
      toast(`Znovu provedeno${blockSuffix(n)}`, "info");
    } catch (err) {
      if (isStale(err)) toast(`Nelze provést${reason(err)}`, "error");
      else { redoStack.push(entry); toast(`Znovu provedení selhalo${reason(err)}`, "error"); }
    } finally { notify(); }
  };
  return {
    record, undo, redo,
    setOnChange: (fn: () => void) => { onChange = fn; },
    state: () => ({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, depth: undoStack.length }),
  };
}

/** React hook nad jádrem. `effectsRef` je ref, aby jádro četlo vždy aktuální effects. */
export function useUndoManager(effectsRef: React.MutableRefObject<UndoEffects>, showToast: Toast) {
  const [, force] = useState(0);
  const coreRef = useRef<ReturnType<typeof createUndoCore> | null>(null);
  if (coreRef.current === null) {
    coreRef.current = createUndoCore(() => effectsRef.current, showToast);
    coreRef.current.setOnChange(() => force((n) => n + 1));
  }
  const core = coreRef.current;
  const record = useCallback((e: HistoryEntry) => core.record(e), [core]);
  const undo = useCallback(() => core.undo(), [core]);
  const redo = useCallback(() => core.redo(), [core]);
  const { canUndo, canRedo } = core.state();
  return { record, undo, redo, canUndo, canRedo };
}
