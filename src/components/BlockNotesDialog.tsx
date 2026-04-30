"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_NOTE_LENGTH, NOTE_EDIT_WINDOW_MS, type NoteRole } from "@/lib/blockNotePermissions";
import type { SerializedBlockNote } from "@/lib/blockNoteSerialization";

interface Props {
  open: boolean;
  blockId: number;
  blockMachine: string;
  blockOrderNumber: string;
  notes: SerializedBlockNote[];
  currentUser: { id: number; role: NoteRole; assignedMachine: string | null };
  canCreate: boolean;
  onClose: () => void;
  onCreate: (text: string) => Promise<void>;
  onUpdate: (noteId: number, text: string) => Promise<void>;
  onDelete: (noteId: number) => Promise<void>;
}

export function BlockNotesDialog({
  open,
  blockMachine,
  blockOrderNumber,
  notes,
  currentUser,
  canCreate,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) {
      setDraft("");
      setEditingId(null);
      setEditingText("");
      return;
    }
    const t = setTimeout(() => textareaRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const now = Date.now();
  function canEditExisting(n: SerializedBlockNote): boolean {
    if (currentUser.role === "ADMIN" || currentUser.role === "PLANOVAT") return true;
    if (currentUser.role !== "TISKAR") return false;
    if (n.createdByUserId !== currentUser.id) return false;
    if (currentUser.assignedMachine !== blockMachine) return false;
    return now - new Date(n.createdAt).getTime() <= NOTE_EDIT_WINDOW_MS;
  }

  async function submitNew() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onCreate(text);
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit() {
    if (editingId === null || busy) return;
    const text = editingText.trim();
    if (!text) return;
    setBusy(true);
    try {
      await onUpdate(editingId, text);
      setEditingId(null);
      setEditingText("");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(id: number) {
    if (busy) return;
    if (!confirm("Smazat poznámku?")) return;
    setBusy(true);
    try {
      await onDelete(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--surface, #0f172a)",
          border: "1px solid var(--border, #1f2a3d)",
          borderRadius: 10,
          width: "100%",
          maxWidth: 560,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          color: "var(--text, #e5e7eb)",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border, #1f2a3d)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            Poznámky · zakázka {blockOrderNumber} · {blockMachine}
          </h3>
          <button
            onClick={onClose}
            aria-label="Zavřít"
            style={{
              background: "transparent",
              border: 0,
              color: "var(--text-muted, #94a3b8)",
              fontSize: 22,
              cursor: "pointer",
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            overflowY: "auto",
            flex: 1,
          }}
        >
          {notes.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--text-muted, #94a3b8)", fontStyle: "italic", margin: 0 }}>
              Zatím žádné poznámky.
            </p>
          )}
          {notes.map((n) => {
            const editable = canEditExisting(n);
            const isEditing = editingId === n.id;
            const updated = n.updatedAt !== n.createdAt;
            return (
              <div
                key={n.id}
                style={{
                  borderLeft: "4px solid #f59e0b",
                  background: "rgba(30,41,59,0.7)",
                  padding: "8px 12px",
                  borderRadius: 4,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 11,
                    color: "var(--text-muted, #94a3b8)",
                    marginBottom: 4,
                  }}
                >
                  <span>
                    <strong style={{ color: "var(--text, #e5e7eb)" }}>{n.createdByUsername}</strong>
                    {" · "}
                    {new Date(n.createdAt).toLocaleString("cs-CZ", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                    {updated && " · upraveno"}
                  </span>
                  {editable && !isEditing && (
                    <span style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => {
                          setEditingId(n.id);
                          setEditingText(n.text);
                        }}
                        style={{
                          background: "transparent",
                          border: 0,
                          color: "#60a5fa",
                          cursor: "pointer",
                          fontSize: 11,
                          padding: 0,
                        }}
                      >
                        Upravit
                      </button>
                      <button
                        onClick={() => confirmDelete(n.id)}
                        style={{
                          background: "transparent",
                          border: 0,
                          color: "#f87171",
                          cursor: "pointer",
                          fontSize: 11,
                          padding: 0,
                        }}
                      >
                        Smazat
                      </button>
                    </span>
                  )}
                </div>
                {isEditing ? (
                  <>
                    <textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value.slice(0, MAX_NOTE_LENGTH))}
                      rows={3}
                      style={{
                        width: "100%",
                        background: "var(--surface-2, #111827)",
                        border: "1px solid var(--border, #1f2a3d)",
                        borderRadius: 4,
                        padding: "6px 8px",
                        color: "var(--text, #e5e7eb)",
                        fontFamily: "inherit",
                        fontSize: 13,
                        boxSizing: "border-box",
                        resize: "vertical",
                      }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 4, justifyContent: "flex-end" }}>
                      <button
                        onClick={() => {
                          setEditingId(null);
                          setEditingText("");
                        }}
                        style={{
                          padding: "4px 12px",
                          fontSize: 12,
                          borderRadius: 4,
                          background: "rgba(71,85,105,0.6)",
                          color: "var(--text, #e5e7eb)",
                          border: 0,
                          cursor: "pointer",
                        }}
                      >
                        Zrušit
                      </button>
                      <button
                        onClick={submitEdit}
                        disabled={busy || !editingText.trim()}
                        style={{
                          padding: "4px 12px",
                          fontSize: 12,
                          borderRadius: 4,
                          background: "#3b82f6",
                          color: "white",
                          border: 0,
                          cursor: busy || !editingText.trim() ? "not-allowed" : "pointer",
                          opacity: busy || !editingText.trim() ? 0.5 : 1,
                        }}
                      >
                        Uložit
                      </button>
                    </div>
                  </>
                ) : (
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--text, #e5e7eb)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      lineHeight: 1.5,
                      margin: 0,
                    }}
                  >
                    {n.text}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {canCreate && (
          <div
            style={{
              borderTop: "1px solid var(--border, #1f2a3d)",
              padding: "12px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_NOTE_LENGTH))}
              rows={3}
              placeholder="Nová poznámka…"
              style={{
                width: "100%",
                background: "var(--surface-2, #111827)",
                border: "1px solid var(--border, #1f2a3d)",
                borderRadius: 4,
                padding: "6px 8px",
                color: "var(--text, #e5e7eb)",
                fontFamily: "inherit",
                fontSize: 13,
                boxSizing: "border-box",
                resize: "vertical",
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--text-muted, #94a3b8)" }}>
                {draft.length}/{MAX_NOTE_LENGTH}
              </span>
              <button
                onClick={submitNew}
                disabled={busy || !draft.trim()}
                style={{
                  padding: "6px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 4,
                  background: "#f59e0b",
                  color: "#1f2937",
                  border: 0,
                  cursor: busy || !draft.trim() ? "not-allowed" : "pointer",
                  opacity: busy || !draft.trim() ? 0.5 : 1,
                }}
              >
                Přidat poznámku
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
