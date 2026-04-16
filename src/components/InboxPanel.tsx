"use client";

import { Button } from "@/components/ui/button";
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

export function InboxPanel({ notifications, onClose, onMarkRead, onJumpToBlock }: {
  notifications: NotificationItem[];
  onClose: () => void;
  onMarkRead: (id: number) => void;
  onJumpToBlock: (orderNumber: string) => void;
}) {
  function fmtDatetime(iso: string) {
    return formatPragueMaybeToday(iso);
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--surface)", borderLeft: "1px solid var(--border)" }}>
      <div style={{ padding: "10px 16px", background: "linear-gradient(135deg, color-mix(in oklab, var(--surface-2) 95%, transparent) 0%, var(--surface) 100%)", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Inbox</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginTop: 2 }}>Upozornění</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-xs text-slate-400"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="15 18 9 12 15 6"/></svg> Zpět</Button>
      </div>
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
    </div>
  );
}
