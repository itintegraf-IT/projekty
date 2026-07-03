"use client";

import { Button } from "@/components/ui/button";
import { InboxList, type NotificationItem } from "@/components/InboxPanel";
import { AuditList, type AuditLogEntry } from "@/components/InfoPanel";

export type NotifTab = "inbox" | "activity";

function TabButton({ active, label, count, onClick }: {
  active: boolean; label: string; count: number; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        padding: "8px 6px", background: "none", border: "none", cursor: "pointer",
        fontSize: 12, fontWeight: 700,
        color: active ? "#3b82f6" : "var(--text-muted)",
        borderBottom: `2px solid ${active ? "#3b82f6" : "transparent"}`,
        transition: "color 120ms ease-out",
      }}
    >
      {label}
      {count > 0 && (
        <span style={{
          minWidth: 16, height: 16, padding: "0 4px", borderRadius: 8,
          background: active ? "#3b82f6" : "var(--surface-2)",
          color: active ? "#fff" : "var(--text-muted)",
          border: active ? "none" : "1px solid var(--border)",
          fontSize: 9, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>{count > 9 ? "9+" : count}</span>
      )}
    </button>
  );
}

export function NotificationsPanel({
  canSeeAudit, activeTab, onTabChange, onClose,
  notifications, auditLogs, notifNewCount, auditNewCount,
  onMarkRead, onJumpToBlock,
}: {
  canSeeAudit: boolean;
  activeTab: NotifTab;
  onTabChange: (tab: NotifTab) => void;
  onClose: () => void;
  notifications: NotificationItem[];
  auditLogs: AuditLogEntry[];
  notifNewCount: number;
  auditNewCount: number;
  onMarkRead: (id: number) => void;
  onJumpToBlock: (orderNumber: string) => void;
}) {
  const isActivity = canSeeAudit && activeTab === "activity";
  const eyebrow = isActivity ? "Posledních 3 dny" : "Inbox";
  const title = isActivity ? "DTP + MTZ aktivita" : "Upozornění";

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--surface)", borderLeft: "1px solid var(--border)" }}>
      <div style={{ padding: "10px 16px", background: "linear-gradient(135deg, color-mix(in oklab, var(--surface-2) 95%, transparent) 0%, var(--surface) 100%)", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>{eyebrow}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginTop: 2 }}>{title}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-xs text-slate-400"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="15 18 9 12 15 6"/></svg> Zpět</Button>
      </div>

      {canSeeAudit && (
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <TabButton active={activeTab === "inbox"} label="Upozornění" count={notifNewCount} onClick={() => onTabChange("inbox")} />
          <TabButton active={activeTab === "activity"} label="Aktivita" count={auditNewCount} onClick={() => onTabChange("activity")} />
        </div>
      )}

      {isActivity ? (
        <AuditList logs={auditLogs} onJumpToBlock={onJumpToBlock} />
      ) : (
        <InboxList notifications={notifications} onMarkRead={onMarkRead} onJumpToBlock={onJumpToBlock} />
      )}
    </div>
  );
}
