"use client";

import { useEffect, useState } from "react";

export type Printer = {
  id: number;
  name: string;
  isActive: boolean;
  sortOrder: number;
};

const SECTION_BG = "var(--surface)";
const SEPARATOR = "color-mix(in oklab, var(--border) 70%, transparent)";
const TEXT_PRIMARY = "var(--text)";
const TEXT_SECONDARY = "var(--text-muted)";
const BORDER_SUBTLE = "var(--border)";
const FONT_STACK = "-apple-system, BlinkMacSystemFont, sans-serif";

const inputStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "7px 11px",
  color: TEXT_PRIMARY,
  fontSize: 13,
  fontFamily: FONT_STACK,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const btnPrimary: React.CSSProperties = {
  background: "var(--brand)",
  color: "var(--brand-contrast)",
  border: "none",
  borderRadius: 8,
  padding: "7px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: FONT_STACK,
  whiteSpace: "nowrap",
};

const btnSecondary: React.CSSProperties = {
  background: "var(--surface-2)",
  color: TEXT_SECONDARY,
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "7px 16px",
  fontSize: 13,
  cursor: "pointer",
  fontFamily: FONT_STACK,
  whiteSpace: "nowrap",
};

const btnDanger: React.CSSProperties = {
  background: "color-mix(in oklab, var(--danger) 15%, transparent)",
  color: "var(--danger)",
  border: "1px solid color-mix(in oklab, var(--danger) 25%, transparent)",
  borderRadius: 8,
  padding: "5px 12px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: FONT_STACK,
  whiteSpace: "nowrap",
};

const btnAddAccent: React.CSSProperties = {
  ...btnSecondary,
  display: "flex",
  alignItems: "center",
  gap: 7,
  background: "rgba(59,130,246,0.12)",
  color: "#3b82f6",
  border: "1px solid rgba(59,130,246,0.3)",
  fontWeight: 600,
};

export function PrinterCodebook() {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const res = await fetch("/api/printers");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Chyba načtení");
      }
      setPrinters(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Neznámá chyba");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setAddLoading(true);
    const res = await fetch("/api/printers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setAddLoading(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Chyba při ukládání.");
      return;
    }
    setNewName("");
    setShowAddForm(false);
    setError(null);
    await reload();
  }

  async function updateName(id: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const res = await fetch(`/api/printers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Chyba při ukládání.");
      return;
    }
    setError(null);
    await reload();
  }

  async function deactivate(id: number, name: string) {
    if (!confirm(`Opravdu deaktivovat tiskaře „${name}“?`)) return;
    const res = await fetch(`/api/printers/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Chyba při mazání.");
      return;
    }
    setError(null);
    await reload();
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          TISKAŘI
        </span>
        <button
          onClick={() => { setShowAddForm(v => !v); setNewName(""); }}
          style={btnAddAccent}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6.25" stroke="currentColor" strokeWidth="1.5" />
            <line x1="7" y1="4" x2="7" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="4" y1="7" x2="10" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Přidat
        </button>
      </div>

      {error && (
        <div style={{
          background: "color-mix(in oklab, var(--danger) 10%, transparent)",
          border: "1px solid color-mix(in oklab, var(--danger) 25%, transparent)",
          color: "var(--danger)",
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 13,
          marginBottom: 12,
        }}>
          {error}
        </div>
      )}

      <div style={{ background: SECTION_BG, borderRadius: 12, overflow: "hidden", border: `1px solid ${BORDER_SUBTLE}` }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: TEXT_SECONDARY, fontSize: 13 }}>Načítám...</div>
        ) : printers.length === 0 && !showAddForm ? (
          <div style={{ padding: 24, textAlign: "center", color: TEXT_SECONDARY, fontSize: 13 }}>Žádní tiskaři</div>
        ) : (
          printers.map((p, i) => (
            <PrinterRow
              key={p.id}
              printer={p}
              isLast={i === printers.length - 1 && !showAddForm}
              onSave={(name) => updateName(p.id, name)}
              onDeactivate={() => deactivate(p.id, p.name)}
            />
          ))
        )}

        {showAddForm && (
          <div style={{
            borderTop: printers.length > 0 ? `1px solid ${SEPARATOR}` : "none",
            padding: 14,
          }}>
            <form onSubmit={handleAdd} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                placeholder="Jméno tiskaře"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                maxLength={80}
              />
              <button
                type="button"
                style={btnSecondary}
                onClick={() => { setShowAddForm(false); setNewName(""); }}
              >
                Zrušit
              </button>
              <button
                type="submit"
                style={btnPrimary}
                disabled={addLoading || !newName.trim()}
              >
                {addLoading ? "Přidávám..." : "Přidat"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function PrinterRow({ printer, isLast, onSave, onDeactivate }: {
  printer: Printer;
  isLast: boolean;
  onSave: (name: string) => void | Promise<void>;
  onDeactivate: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(printer.name);

  useEffect(() => { setDraft(printer.name); }, [printer.name]);

  async function commit() {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === printer.name) {
      setDraft(printer.name);
      return;
    }
    await onSave(trimmed);
  }

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 14px",
      borderBottom: isLast ? "none" : `1px solid ${SEPARATOR}`,
    }}>
      {editing ? (
        <input
          autoFocus
          style={{ ...inputStyle, flex: 1 }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void commit(); }
            if (e.key === "Escape") { setDraft(printer.name); setEditing(false); }
          }}
          maxLength={80}
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          style={{
            flex: 1,
            textAlign: "left",
            background: "transparent",
            border: "none",
            color: TEXT_PRIMARY,
            fontSize: 14,
            fontFamily: FONT_STACK,
            padding: "4px 0",
            cursor: "text",
          }}
          title="Kliknutím upravit"
        >
          {printer.name}
        </button>
      )}
      <button style={btnDanger} onClick={() => void onDeactivate()}>
        Deaktivovat
      </button>
    </div>
  );
}
