export interface SerializedBlockNote {
  id: number;
  blockId: number;
  text: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: number;
  createdByUsername: string;
}

export interface SerializableBlockNote {
  id: number;
  blockId: number;
  text: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: number;
  createdByUsername: string;
}

export function serializeBlockNote(note: SerializableBlockNote): SerializedBlockNote {
  return {
    id: note.id,
    blockId: note.blockId,
    text: note.text,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    createdByUserId: note.createdByUserId,
    createdByUsername: note.createdByUsername,
  };
}
