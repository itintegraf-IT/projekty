"use client";

import { useCallback, useEffect, useState } from "react";
import { countUnread, countNewSince, totalBadge } from "@/lib/notifications";
import type { NotificationItem } from "@/components/InboxPanel";
import type { AuditLogEntry } from "@/components/InfoPanel";

const AUDIT_ROLES = ["ADMIN", "PLANOVAT"];
const INBOX_ROLES = ["DTP", "MTZ", "OBCHODNIK", "ADMIN", "PLANOVAT"];

export function useNotifications(role: string) {
  const canSeeAudit = AUDIT_ROLES.includes(role);
  const canSeeInbox = INBOX_ROLES.includes(role);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifNewCount, setNotifNewCount] = useState(0);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditNewCount, setAuditNewCount] = useState(0);

  const fetchAudit = useCallback(() => {
    if (!AUDIT_ROLES.includes(role)) return;
    fetch("/api/audit/today")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: AuditLogEntry[]) => {
        setAuditLogs(data);
        setAuditNewCount(countNewSince(data, localStorage.getItem("auditLastSeen")));
      })
      .catch(() => { /* zachovat poslední validní data — neměnit stav */ });
  }, [role]);

  const fetchNotifications = useCallback(() => {
    if (!INBOX_ROLES.includes(role)) return;
    fetch("/api/notifications")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data: NotificationItem[]) => {
        setNotifications(data);
        setNotifNewCount(countUnread(data));
      })
      .catch(() => { /* zachovat poslední validní stav */ });
  }, [role]);

  useEffect(() => {
    fetchAudit();
    fetchNotifications();
    const interval = setInterval(() => { fetchAudit(); fetchNotifications(); }, 60_000);
    return () => clearInterval(interval);
  }, [fetchAudit, fetchNotifications]);

  const markRead = useCallback(async (notifId: number): Promise<boolean> => {
    const r = await fetch(`/api/notifications/${notifId}/read`, { method: "PATCH" });
    if (!r.ok) return false;
    setNotifications((prev) => prev.map((n) => n.id === notifId ? { ...n, isRead: true } : n));
    setNotifNewCount((prev) => Math.max(0, prev - 1));
    return true;
  }, []);

  const markAuditSeen = useCallback(() => {
    localStorage.setItem("auditLastSeen", new Date().toISOString());
    setAuditNewCount(0);
  }, []);

  return {
    notifications, auditLogs, notifNewCount, auditNewCount,
    totalBadge: totalBadge(notifNewCount, auditNewCount),
    canSeeInbox, canSeeAudit,
    fetchNotifications, fetchAudit, markRead, markAuditSeen,
  };
}
