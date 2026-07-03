"use client";

import { formatPragueMaybeToday } from "@/lib/auditFormatters";

export type NotificationItem = {
  id: number;
  type?: string;
  message?: string;
  blockId: number | null;
  blockOrderNumber: string | null;
  targetRole: string | null;
  targetUserId?: number | null;
  reservationId?: number | null;
  createdByUserId: number;
  createdByUsername: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

export function InboxList({ notifications, onMarkRead, onJumpToBlock }: {
  notifications: NotificationItem[];
  onMarkRead: (id: number) => void;
  onJumpToBlock: (orderNumber: string) => void;
}) {
  function fmtDatetime(iso: string) {
    return formatPragueMaybeToday(iso);
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px" }}>
      {notifications.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", marginTop: 32 }}>
          Žádná upozornění.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {notifications.map((n) => {
            const isReservationNotif = n.type && n.type !== "BLOCK_NOTIFY";
            return (
              <div key={n.id} style={{ padding: "8px 10px", borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)", opacity: n.isRead ? 0.5 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>od {n.createdByUsername}</span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{fmtDatetime(n.createdAt)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  {isReservationNotif ? (
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.4 }}>{n.message}</div>
                      {n.reservationId && (
                        <a
                          href={`/rezervace?id=${n.reservationId}`}
                          style={{ fontSize: 11, color: "#7c3aed", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2 }}
                        >
                          → Zobrazit rezervaci
                        </a>
                      )}
                    </div>
                  ) : n.blockOrderNumber ? (
                    <button
                      onClick={() => onJumpToBlock(n.blockOrderNumber!)}
                      style={{ background: "none", border: "none", padding: 0, color: "#3b82f6", fontWeight: 600, cursor: "pointer", fontSize: 11, textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2 }}
                    >
                      {n.blockOrderNumber}
                    </button>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>#{n.blockId}</span>
                  )}
                  {!n.isRead && (
                    <button
                      onClick={() => onMarkRead(n.id)}
                      style={{ fontSize: 10, fontWeight: 600, color: "#22c55e", background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}
                    >
                      ✓ Přečteno
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
