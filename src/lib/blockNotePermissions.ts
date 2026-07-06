export const NOTE_EDIT_WINDOW_MS = 30 * 60 * 1000;
export const MAX_NOTE_LENGTH = 500;

export type NoteRole = "ADMIN" | "PLANOVAT" | "TISKAR" | "DTP" | "MTZ" | "OBCHODNIK" | "VIEWER";

export interface NoteForPermission {
  id: number;
  blockId: number;
  createdByUserId: number;
  createdAt: Date;
  machine: string;
}

export interface NoteActor {
  id: number;
  role: NoteRole;
  assignedMachine: string | null;
}

export function canAccessBlockNotes(role: NoteRole): boolean {
  return role === "ADMIN" || role === "PLANOVAT" || role === "TISKAR";
}

/**
 * Vrátí kopii serializovaného bloku s prázdnými `notes`, pokud příjemce na tiskařské poznámky
 * NEMÁ právo (`canSeeNotes === false`). Když právo má, vrací původní objekt beze změny.
 *
 * NEMUTUJE vstup — vytváří mělkou kopii jen v případě stripu (sdílený SSE payload se nikdy
 * neupravuje in-place). Používá se v přímých HTTP odpovědích mutujícímu (DTP/MTZ) i v
 * per-connection strip smyčce SSE broadcastu.
 */
export function stripNotesIfDenied<T extends { notes?: unknown }>(block: T, canSeeNotes: boolean): T {
  if (canSeeNotes) return block;
  if (!("notes" in block)) return block;
  return { ...block, notes: [] };
}

export function canCreateBlockNote(actor: NoteActor, blockMachine: string): boolean {
  if (actor.role === "ADMIN" || actor.role === "PLANOVAT") return true;
  if (actor.role !== "TISKAR") return false;
  return actor.assignedMachine === blockMachine;
}

export function canEditBlockNote(note: NoteForPermission, actor: NoteActor, now: Date = new Date()): boolean {
  if (actor.role === "ADMIN" || actor.role === "PLANOVAT") return true;
  if (actor.role !== "TISKAR") return false;
  if (note.createdByUserId !== actor.id) return false;
  if (actor.assignedMachine !== note.machine) return false;
  return now.getTime() - note.createdAt.getTime() <= NOTE_EDIT_WINDOW_MS;
}
