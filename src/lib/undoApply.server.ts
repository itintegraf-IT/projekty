import { AppError } from "@/lib/errors";
import { isRestorableField } from "@/lib/undo/restoreFields";

export type UndoOp =
  | { kind: "upsert"; id: number; expectedUpdatedAt?: string; fields: Record<string, unknown> }
  | { kind: "remove"; id: number; expectedUpdatedAt?: string };

export type UndoDirection = "undo" | "redo";

/** Sloupce bez defaultu a bez `?` — bez nich Prisma create neprojde. */
export const REQUIRED_ON_CREATE = ["orderNumber", "machine", "startTime", "endTime"] as const;

function bad(message: string): never {
  throw new AppError("VALIDATION_ERROR", message);
}

/**
 * Jediná brána mezi tělem requestu a transakcí. Endpoint NESMÍ být univerzální
 * zápis do Block — všechno, co projde sem, se zapíše doslova bez další validace.
 */
export function sanitizeUndoOps(raw: unknown): UndoOp[] {
  if (!Array.isArray(raw) || raw.length === 0) bad("Seznam operací je prázdný nebo není pole.");
  if (raw.length > 200) bad("Seznam operací je příliš dlouhý (max 200).");

  const seen = new Set<number>();
  const ops: UndoOp[] = [];

  for (const item of raw) {
    if (typeof item !== "object" || item === null) bad("Operace není objekt.");
    const o = item as Record<string, unknown>;

    if (!Number.isInteger(o.id) || (o.id as number) <= 0) bad(`Neplatné id bloku: ${String(o.id)}`);
    const id = o.id as number;
    if (seen.has(id)) bad(`Blok ${id} je v dávce vícekrát — undo musí mít na blok jedinou operaci.`);
    seen.add(id);

    let expectedUpdatedAt: string | undefined;
    if (o.expectedUpdatedAt !== undefined) {
      if (typeof o.expectedUpdatedAt !== "string" || Number.isNaN(new Date(o.expectedUpdatedAt).getTime())) {
        bad(`Neplatné expectedUpdatedAt u bloku ${id}.`);
      }
      expectedUpdatedAt = o.expectedUpdatedAt;
    }

    if (o.kind === "remove") {
      ops.push({ kind: "remove", id, expectedUpdatedAt });
      continue;
    }
    if (o.kind !== "upsert") bad(`Neznámá operace: ${String(o.kind)}`);

    if (typeof o.fields !== "object" || o.fields === null || Array.isArray(o.fields)) {
      bad(`Chybí fields u bloku ${id}.`);
    }
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(o.fields as Record<string, unknown>)) {
      if (!isRestorableField(key)) bad(`Pole "${key}" undo obnovovat nesmí (blok ${id}).`);
      fields[key] = value;
    }
    ops.push({ kind: "upsert", id, expectedUpdatedAt, fields });
  }
  return ops;
}
