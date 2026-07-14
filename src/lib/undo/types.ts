import type { Block } from "@/app/_components/TimelineGrid";

export type { Block };

/** Poziční snapshot bloku pro move/undo. `updatedAt` slouží jako verze pro souběh-guard. */
export type BlockSnapshot = {
  id: number;
  startTime: string;
  endTime: string;
  machine: string;
  updatedAt: string;
};

/** Snapshot editovaných polí bloku pro edit/undo (before i after). */
export type EditSnapshot = {
  id: number;
  updatedAt: string;
  /** Pole, která undo/redo pošle na PUT (klíč → hodnota). Jen editovaná pole. */
  fields: Record<string, unknown>;
};

/** Injektované vedlejší efekty. Reálná implementace žije v PlannerPage; v testech se podstrčí fake. */
export interface UndoEffects {
  putBlock(id: number, body: Record<string, unknown>): Promise<Block & { shifted?: Block[]; siblings?: Block[] }>;
  postBlock(body: Record<string, unknown>): Promise<Block>;
  deleteBlock(id: number): Promise<void>;
  batchUpdate(
    updates: Array<{ id: number; startTime: string; endTime: string; machine: string; expectedUpdatedAt?: string }>,
  ): Promise<Block[]>;
  /** Upsert bloků do stavu (merge podle id). */
  addToState(blocks: Block[]): void;
  /** Odebrat bloky ze stavu. */
  removeFromState(ids: number[]): void;
  /** Živý blok ze stavu (blocksRef.current) — pro souběh-guard. */
  getLiveBlock(id: number): Block | undefined;
}

export interface HistoryEntry {
  /** Krátký popis pro toast / tooltip tlačítka. */
  label: string;
  undo(effects: UndoEffects): Promise<void>;
  redo(effects: UndoEffects): Promise<void>;
}

/** Hodí builder, když živý blok neodpovídá snapshotu (někdo ho mezitím změnil). */
export class StaleUndoError extends Error {
  constructor(message = "Blok byl mezitím změněn") {
    super(message);
    this.name = "StaleUndoError";
  }
}
