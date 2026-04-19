"use client";

const FONT_STACK = "-apple-system, BlinkMacSystemFont, sans-serif";

export type ConflictingBlock = {
  id: number;
  orderNumber: string;
  description: string | null;
  startTime: string; // ISO
  endTime: string;   // ISO
};

function formatDT(iso: string): string {
  try {
    return new Date(iso).toLocaleString("cs-CZ", { timeZone: "Europe/Prague" });
  } catch {
    return iso;
  }
}

export function ShiftCascadeDialog({
  conflictingBlocks,
  onCancel,
  onConfirm,
  busy,
}: {
  conflictingBlocks: ConflictingBlock[];
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT_STACK,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--danger)",
          borderRadius: 12,
          width: "min(640px, 92vw)",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 16px 40px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--danger)" }}>
            Zkrácení směny ovlivní existující bloky
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Následující bloky by po uložení spadly mimo aktivní pracovní dobu. Můžeš změnu zrušit a bloky nejdřív přeplánovat, nebo uložit přesto (bloky zůstanou v DB, ale budou viditelně mimo pracovní interval).
          </div>
        </div>

        <div style={{ padding: "10px 18px", overflow: "auto", flex: 1 }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
            }}
          >
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                  Zakázka
                </th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                  Popis
                </th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                  Od
                </th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                  Do
                </th>
              </tr>
            </thead>
            <tbody>
              {conflictingBlocks.map((b) => (
                <tr key={b.id}>
                  <td style={{ padding: "6px 8px", borderBottom: "1px solid color-mix(in oklab, var(--border) 60%, transparent)", fontWeight: 600 }}>
                    {b.orderNumber}
                  </td>
                  <td style={{ padding: "6px 8px", borderBottom: "1px solid color-mix(in oklab, var(--border) 60%, transparent)", color: "var(--text-muted)" }}>
                    {b.description ?? "—"}
                  </td>
                  <td style={{ padding: "6px 8px", borderBottom: "1px solid color-mix(in oklab, var(--border) 60%, transparent)", whiteSpace: "nowrap" }}>
                    {formatDT(b.startTime)}
                  </td>
                  <td style={{ padding: "6px 8px", borderBottom: "1px solid color-mix(in oklab, var(--border) 60%, transparent)", whiteSpace: "nowrap" }}>
                    {formatDT(b.endTime)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            style={{
              background: "var(--surface-2)",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "7px 14px",
              fontSize: 13,
              cursor: busy ? "not-allowed" : "pointer",
              fontFamily: FONT_STACK,
              opacity: busy ? 0.6 : 1,
            }}
          >
            Zrušit změnu
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            style={{
              background: "var(--danger)",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "7px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
              fontFamily: FONT_STACK,
              opacity: busy ? 0.6 : 1,
            }}
          >
            Uložit i přesto
          </button>
        </div>
      </div>
    </div>
  );
}
