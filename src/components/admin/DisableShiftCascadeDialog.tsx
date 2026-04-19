"use client";

import { SHIFT_LABELS, type ShiftType } from "@/lib/shifts";

export type CascadeAffected = {
  id: number;
  date: string;
  shift: ShiftType;
  printerName: string;
};

type Props = {
  affectedCount: number;
  affected: CascadeAffected[];
  saving?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const FONT_STACK = "-apple-system, BlinkMacSystemFont, sans-serif";

export function DisableShiftCascadeDialog({ affectedCount, affected, saving = false, onConfirm, onCancel }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT_STACK,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onCancel();
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 24,
          maxWidth: 640,
          width: "calc(100% - 32px)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0, marginBottom: 12, color: "var(--warning, #f59e0b)" }}>
          ⚠ Zrušíš {affectedCount} {affectedCount === 1 ? "přiřazení" : affectedCount < 5 ? "přiřazení" : "přiřazení"}
        </h3>
        <p style={{ color: "var(--text)", margin: 0, marginBottom: 12, fontSize: 14 }}>
          Vypnutím této směny se smažou následující obsazení tiskařů pro budoucí dny. Akce je trvalá.
        </p>
        <ul
          style={{
            flex: 1,
            overflowY: "auto",
            margin: 0,
            marginBottom: 16,
            padding: "8px 0 8px 20px",
            color: "var(--text)",
            fontSize: 14,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--surface-2)",
            minHeight: 60,
            maxHeight: 260,
          }}
        >
          {affected.map((a) => (
            <li key={a.id} style={{ padding: "4px 12px" }}>
              <span style={{ color: "var(--text-muted)" }}>{a.date}</span> — {SHIFT_LABELS[a.shift]}:{" "}
              <strong>{a.printerName}</strong>
            </li>
          ))}
          {affectedCount > affected.length && (
            <li style={{ padding: "4px 12px", color: "var(--text-muted)", fontStyle: "italic" }}>
              …a dalších {affectedCount - affected.length}
            </li>
          )}
        </ul>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={{
              padding: "8px 16px",
              background: "var(--surface-2)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              cursor: saving ? "not-allowed" : "pointer",
              fontSize: 14,
              opacity: saving ? 0.6 : 1,
            }}
          >
            Zrušit
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            style={{
              padding: "8px 16px",
              background: "var(--danger, #b91c1c)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: saving ? "not-allowed" : "pointer",
              fontSize: 14,
              fontWeight: 500,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Ukládám…" : "Ano, smazat a uložit"}
          </button>
        </div>
      </div>
    </div>
  );
}
