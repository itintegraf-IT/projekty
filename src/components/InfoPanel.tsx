"use client";

import { Button } from "@/components/ui/button";
import { FIELD_LABELS, fmtAuditVal, formatPragueMaybeToday } from "@/lib/auditFormatters";

export type AuditLogEntry = {
  id: number;
  blockId: number;
  orderNumber: string | null;
  userId: number;
  username: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
};

export function InfoPanel({ logs, onClose, onJumpToBlock }: {
  logs: AuditLogEntry[];
  onClose: () => void;
  onJumpToBlock: (orderNumber: string) => void;
}) {
  function fmtDatetime(iso: string) {
    return formatPragueMaybeToday(iso);
  }
  function fmtVal(val: string | null, field: string | null) {
    return fmtAuditVal(val, field);
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--surface)", borderLeft: "1px solid var(--border)" }}>
      <div style={{ padding: "10px 16px", background: "linear-gradient(135deg, color-mix(in oklab, var(--surface-2) 95%, transparent) 0%, var(--surface) 100%)", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Posledních 3 dny</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginTop: 2 }}>DTP + MTZ aktivita</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-xs text-slate-400"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="15 18 9 12 15 6"/></svg> Zpět</Button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px" }}>
        {logs.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", marginTop: 32 }}>
            Žádné změny od DTP / MTZ za poslední 3 dny.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {logs.map((log) => (
              <div key={log.id} style={{ padding: "8px 10px", borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{log.username}</span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{fmtDatetime(log.createdAt)}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {log.orderNumber ? (
                    <button
                      onClick={() => { onClose(); onJumpToBlock(log.orderNumber!); }}
                      style={{ background: "none", border: "none", padding: 0, color: "#3b82f6", fontWeight: 600, cursor: "pointer", fontSize: 11, textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2 }}
                    >
                      {log.orderNumber}
                    </button>
                  ) : (
                    <span>#{log.blockId}</span>
                  )}
                  {log.action === "UPDATE" && log.field && (
                    <span> · {FIELD_LABELS[log.field] ?? log.field}: <span style={{ color: "var(--text)" }}>{fmtVal(log.oldValue, log.field)} → {fmtVal(log.newValue, log.field)}</span></span>
                  )}
                  {log.action === "CREATE" && <span style={{ color: "#22c55e" }}> · Přidána</span>}
                  {log.action === "DELETE" && <span style={{ color: "#ef4444" }}> · Smazána</span>}
                  {log.action === "PRINT_COMPLETE" && <span style={{ color: "#22c55e" }}> · ✓ Tisk dokončen</span>}
                  {log.action === "PRINT_UNDO" && <span style={{ color: "#f59e0b" }}> · Vráceno hotovo</span>}
                  {log.action === "PRINT_RESET" && <span style={{ color: "#64748b" }}> · Reset potvrzení (přeplánováno)</span>}
                  {log.action === "EXPEDITION_PUBLISH" && <span style={{ color: "#22c55e" }}> · Zařazena do expedice</span>}
                  {log.action === "EXPEDITION_UNPUBLISH" && <span style={{ color: "#f59e0b" }}> · Odebrána z expedice</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
