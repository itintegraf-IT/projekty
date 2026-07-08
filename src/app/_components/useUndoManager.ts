import type React from "react";
import { useCallback, useRef, useState } from "react";
import { StaleUndoError, type HistoryEntry, type UndoEffects } from "@/lib/undo/types";

const MAX_HISTORY = 30;
type Toast = (msg: string, kind: "info" | "error") => void;

/** Čisté jádro bez Reactu — testovatelné. */
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
      await entry.undo(getEffects());
      redoStack.push(entry);
      toast("Vráceno zpět", "info");
    } catch (err) {
      if (err instanceof StaleUndoError) toast("Nelze vrátit: blok byl mezitím změněn", "error");
      else { undoStack.push(entry); toast("Vrácení zpět selhalo.", "error"); if (typeof console !== "undefined") console.error("Undo failed", err); }
    } finally { notify(); }
  };
  const redo = async () => {
    const entry = redoStack.pop();
    if (!entry) return;
    try {
      await entry.redo(getEffects());
      undoStack.push(entry);
      toast("Znovu provedeno", "info");
    } catch (err) {
      if (err instanceof StaleUndoError) toast("Nelze provést: blok byl mezitím změněn", "error");
      else { redoStack.push(entry); toast("Znovu provedení selhalo.", "error"); if (typeof console !== "undefined") console.error("Redo failed", err); }
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
