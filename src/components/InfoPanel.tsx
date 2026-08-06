"use client";

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

export function AuditList({ logs, onJumpToBlock }: {
  logs: AuditLogEntry[];
  onJumpToBlock: (orderNumber: string) => void;
}) {
  function fmtDatetime(iso: string) {
    return formatPragueMaybeToday(iso);
  }
  function fmtVal(val: string | null, field: string | null) {
    return fmtAuditVal(val, field);
  }

  return (
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
                    onClick={() => onJumpToBlock(log.orderNumber!)}
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
                {/* Propagace sdíleného pole ze split skupiny — odlišeno od UPDATE, protože
                    šlo o jeden zásah na jiném bloku, který se sem jen automaticky promítl
                    (ne nezávislou editaci tohoto bloku). */}
                {log.action === "SPLIT_PROPAGATE" && log.field && (
                  <span> · <span style={{ color: "var(--info)" }}>↔ Převzato z rozdělené zakázky</span> · {FIELD_LABELS[log.field] ?? log.field}: <span style={{ color: "var(--text)" }}>{fmtVal(log.oldValue, log.field)} → {fmtVal(log.newValue, log.field)}</span></span>
                )}
                {log.action === "CREATE" && <span style={{ color: "#22c55e" }}> · Přidána</span>}
                {log.action === "DELETE" && <span style={{ color: "#ef4444" }}> · Smazána</span>}
                {log.action === "PRINT_COMPLETE" && <span style={{ color: "#22c55e" }}> · ✓ Tisk dokončen</span>}
                {log.action === "PRINT_UNDO" && <span style={{ color: "#f59e0b" }}> · Vráceno hotovo</span>}
                {log.action === "PRINT_RESET" && <span style={{ color: "#64748b" }}> · Reset potvrzení (přeplánováno)</span>}
                {log.action === "EXPEDITION_PUBLISH" && <span style={{ color: "#22c55e" }}> · Zařazena do expedice</span>}
                {log.action === "EXPEDITION_UNPUBLISH" && <span style={{ color: "#f59e0b" }}> · Odebrána z expedice</span>}
                {log.action === "AUTO_SHIFT" && log.oldValue && log.newValue && (
                  <span style={{ color: "#f59e0b" }}> · Automaticky posunuto: <span style={{ color: "var(--text)" }}>{fmtVal(log.oldValue, "startTime")} → {fmtVal(log.newValue, "startTime")}</span></span>
                )}
                {log.action === "AUTO_REFLOW" && log.oldValue && log.newValue && (
                  <span style={{ color: "#f59e0b" }}> · ⟳ přepočet dle kalendáře: <span style={{ color: "var(--text)" }}>{fmtVal(log.oldValue, "startTime")} → {fmtVal(log.newValue, "startTime")}</span></span>
                )}
                {(log.action === "UNDO" || log.action === "REDO") && (
                  <span style={{ color: "var(--text-muted)" }}>
                    {" "}· {log.action === "UNDO" ? "↶ vráceno zpět" : "↷ znovu provedeno"}
                    {/* I2 (go/no-go audit 5. 8. 2026): field === "fields" značí, že se
                        obnovila obchodní pole beze změny pozice (undoApply.server.ts)
                        — oldValue/newValue nejsou časový span, ale seznam klíčů, takže
                        se NESMÍ vykreslit jako šipka mezi časy (falešný dojem přesunu,
                        který se nekonal). */}
                    {log.field === "fields" && log.newValue && (
                      <span style={{ color: "var(--text)" }}>: obnoveno {log.newValue.split(", ").map((k) => FIELD_LABELS[k] ?? k).join(", ")}</span>
                    )}
                    {log.field !== "fields" && log.oldValue && log.newValue && (
                      <span style={{ color: "var(--text)" }}>: {fmtVal(log.oldValue, "startTime")} → {fmtVal(log.newValue, "startTime")}</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
