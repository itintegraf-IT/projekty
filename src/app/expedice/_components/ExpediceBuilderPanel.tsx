"use client";
import React, { useState } from "react";

type Kind = "MANUAL_JOB" | "INTERNAL_TRANSFER";

const KIND_LABELS: Record<Kind, string> = {
  MANUAL_JOB: "Ruční zakázka",
  INTERNAL_TRANSFER: "Interní závoz",
};

interface ExpediceBuilderPanelProps {
  onCreated: () => void;
}

export function ExpediceBuilderPanel({ onCreated }: ExpediceBuilderPanelProps) {
  const [kind, setKind] = useState<Kind>("MANUAL_JOB");
  const [orderNumber, setOrderNumber] = useState("");
  const [description, setDescription] = useState("");
  const [expediceNote, setExpediceNote] = useState("");
  const [doprava, setDoprava] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderNumber.trim() && !description.trim()) {
      setError("Vyplň alespoň číslo zakázky nebo popis");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/expedice/manual-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          orderNumber: orderNumber.trim() || null,
          description: description.trim() || null,
          expediceNote: expediceNote.trim() || null,
          doprava: doprava.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Chyba serveru");
      }
      // Reset formuláře
      setOrderNumber("");
      setDescription("");
      setExpediceNote("");
      setDoprava("");
      setKind("MANUAL_JOB");
      onCreated();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Chyba při vytváření");
    } finally {
      setSaving(false);
    }
  }

  const sectionLabel: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
    color: "var(--text-muted)", textTransform: "uppercase",
    marginBottom: 8,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "7px 10px", borderRadius: 7,
    background: "var(--surface-2)", border: "1px solid rgba(255,255,255,0.1)",
    color: "var(--text)", fontSize: 12, outline: "none",
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    boxSizing: "border-box",
    transition: "border-color 120ms ease-out, box-shadow 120ms ease-out",
  };

  return (
    <>
    <style>{`
      .expedice-input:focus {
        border-color: rgba(59,130,246,0.6) !important;
        box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
      }
    `}</style>
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column" }}>
      {/* Obsah formuláře — nepoužívá vlastní scroll, aside se scrolluje celý */}
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Typ */}
        <div>
          <div style={sectionLabel}>Typ položky</div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["MANUAL_JOB", "INTERNAL_TRANSFER"] as Kind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                style={{
                  flex: 1, padding: "6px 8px", borderRadius: 7, fontSize: 11,
                  fontWeight: 500, cursor: "pointer", border: "none",
                  background: kind === k ? "rgba(59,130,246,0.18)" : "var(--surface-2)",
                  color: kind === k ? "#3b82f6" : "var(--text-muted)",
                  outline: kind === k ? "1px solid rgba(59,130,246,0.35)" : "1px solid rgba(255,255,255,0.08)",
                  transition: "all 120ms ease-out",
                }}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>

        {/* Číslo zakázky */}
        <div>
          <div style={sectionLabel}>Číslo zakázky</div>
          <input
            type="text"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            placeholder={kind === "INTERNAL_TRANSFER" ? "Volitelné" : "Např. 17521"}
            className="expedice-input"
            style={inputStyle}
          />
        </div>

        {/* Popis */}
        <div>
          <div style={sectionLabel}>Popis</div>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Název nebo popis zakázky"
            className="expedice-input"
            style={inputStyle}
          />
        </div>

        {/* Poznámka */}
        <div>
          <div style={sectionLabel}>Poznámka</div>
          <textarea
            value={expediceNote}
            onChange={(e) => setExpediceNote(e.target.value)}
            placeholder="Interní poznámka pro expedici"
            rows={2}
            className="expedice-input"
            style={{ ...inputStyle, resize: "vertical", minHeight: 52 }}
          />
        </div>

        {/* Doprava */}
        <div>
          <div style={sectionLabel}>Doprava / destinace</div>
          <input
            type="text"
            value={doprava}
            onChange={(e) => setDoprava(e.target.value)}
            placeholder="Kam / jak"
            className="expedice-input"
            style={inputStyle}
          />
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: "4px 16px 16px",
      }}>
        {error && (
          <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 8 }}>
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={saving}
          style={{
            width: "100%", padding: "8px 16px", borderRadius: 8,
            background: saving ? "rgba(59,130,246,0.08)" : "rgba(59,130,246,0.16)",
            border: "1px solid rgba(59,130,246,0.28)",
            color: saving ? "rgba(59,130,246,0.5)" : "#3b82f6",
            fontSize: 12, fontWeight: 600, cursor: saving ? "default" : "pointer",
            transition: "all 120ms ease-out",
          }}
        >
          {saving ? "Přidávám..." : "Přidat do fronty"}
        </button>
      </div>
    </form>
    </>
  );
}
