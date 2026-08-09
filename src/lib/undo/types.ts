import type { Block } from "@/app/_components/TimelineGrid";

export type { Block };

/** Poziční snapshot bloku pro move/undo. `updatedAt` slouží jako verze pro souběh-guard. */
export type BlockSnapshot = {
  id: number;
  startTime: string;
  endTime: string;
  machine: string;
  updatedAt: string;
  /**
   * Jen u ZAKAZKA. Endpoint nederivuje, takže resize musí obnovit i tiskové minuty.
   * POVINNÉ (nullable) — dřív volitelné (`?:`) nechávalo volající místa, která pole
   * vynechala, projít kompilátorem bez varování; chyba se projevila až v prohlížeči
   * (mutační test, Task 7 Step 0).
   */
  printMinutes: number | null;
  /**
   * Platí, že pozice bloku porušuje kalendář (mimo pracovní dobu / v odstávce) a byla
   * tam umístěna s vypnutým zámkem. Staré cesty ho přepočítávaly z nové pozice
   * (`[id]/route.ts`, `batch/route.ts`) — nový endpoint nederivuje nic, takže i tenhle
   * příznak musí jít obnovit doslova ze snapshotu, jinak zůstane nesedět s geometrií,
   * kterou undo/redo vrátí. POVINNÉ ze stejného důvodu jako printMinutes výše.
   */
  scheduleBypassed: boolean;
};

/** Snapshot editovaných polí bloku pro edit/undo (before i after). */
export type EditSnapshot = {
  id: number;
  updatedAt: string;
  /** Pole, která undo/redo pošle na PUT (klíč → hodnota). Jen editovaná pole. */
  fields: Record<string, unknown>;
};

/**
 * Klientský tvar operace pro `POST /api/blocks/undo`. Záměrná duplikace `UndoOp`
 * z `src/lib/undoApply.server.ts` — klientský kód nesmí importovat `.server.ts`
 * modul, proto je tenhle typ nadeklarovaný samostatně. Tvar musí zůstat shodný.
 */
export type UndoOpClient =
  | {
      kind: "upsert";
      id: number;
      expectedUpdatedAt?: string;
      fields: Record<string, unknown>;
      /** Původní datum vzniku — server ho použije JEN při vzkříšení smazaného bloku. */
      createdAt?: string;
    }
  | { kind: "remove"; id: number; expectedUpdatedAt?: string };

export type UndoRequest = { label: string; direction: "undo" | "redo"; ops: UndoOpClient[] };
export type UndoResponse = { updated: Block[]; removed: number[] };

/** Injektované vedlejší efekty. Reálná implementace žije v PlannerPage; v testech se podstrčí fake. */
export interface UndoEffects {
  /**
   * Atomické provedení celého kroku historie undo/redo — buď projde celá dávka,
   * nebo se nezmění nic. Chybu ze serveru propaguje jako Error s její hláškou;
   * při souběhu (jiný uživatel mezitím blok změnil) navíc nese `.code === "CONFLICT"`
   * (viz `isStale` v `useUndoManager.ts`, který ho léčí stejně jako `StaleUndoError`).
   */
  applyUndo(req: UndoRequest): Promise<UndoResponse>;
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
  /**
   * Vrací počet bloků, které krok doopravdy zasáhl (z odpovědi serveru) —
   * `undoCore` ho vypíše do hlášky. `void` je povolené kvůli případným
   * budoucím krokům, které s bloky nepracují; hláška pak zůstane bez čísla.
   */
  undo(effects: UndoEffects): Promise<number | void>;
  redo(effects: UndoEffects): Promise<number | void>;
}

/** Hodí builder, když živý blok neodpovídá snapshotu (někdo ho mezitím změnil). */
export class StaleUndoError extends Error {
  constructor(message = "Blok byl mezitím změněn") {
    super(message);
    this.name = "StaleUndoError";
  }
}
