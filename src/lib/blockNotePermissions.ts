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
