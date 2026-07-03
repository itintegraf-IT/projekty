# Sjednocení notifikačních zvonků — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sloučit dva vizuálně identické notifikační zvonky (Aktivita + Upozornění) do jednoho zvonku s taby a přitom vytáhnout notifikační logiku i UI z přeplněné `PlannerPage.tsx`.

**Architecture:** Čistá logika → `src/lib/notifications.ts` (testovaná). Stav + fetch + polling → `src/hooks/useNotifications.ts`. UI → `NotificationBell.tsx` (zvonek + badge) a `NotificationsPanel.tsx` (levý panel s taby), který uvnitř vykreslí `InboxList` / `AuditList` (těla vytažená z dnešních `InboxPanel`/`InfoPanel`). PlannerPage jen drátuje.

**Tech Stack:** Next.js 16, React, TypeScript, ruční inline styly (žádný Tailwind na těchto panelech), `node --test --import tsx` pro unit testy.

## Global Constraints

- **Čistě frontend** — žádná změna API (`/api/notifications`, `/api/audit/today`), DB, ani logiky vytváření/čtení notifikací.
- **Behavior-preserving** — badge počty, drift „Přepočítat", „✓ Přečteno", odkazy na blok/rezervaci, role-based viditelnost i 60s polling zůstávají funkčně identické.
- **Žádná nová závislost** — tab přepínač je vlastní (2 tlačítka + `useState`), NE shadcn Tabs. Žádná React testovací knihovna.
- **Typy zůstávají exportované** z `src/components/InboxPanel.tsx` (`NotificationItem`) a `src/components/InfoPanel.tsx` (`AuditLogEntry`) — importuje je i `BlockDetail.tsx`.
- **Ikona zvonku** = existující SVG: `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>`.
- **Role:** audit (Aktivita) vidí `["ADMIN","PLANOVAT"]`; upozornění (Upozornění) vidí `["DTP","MTZ","OBCHODNIK","ADMIN","PLANOVAT"]`.
- Testy se spouští `node --test --import tsx <soubor>`; po hotové práci `npm run build` musí projít a `npx eslint <soubor>` bez nových warningů.

---

## File Structure

| Soubor | Odpovědnost |
| --- | --- |
| `src/lib/notifications.ts` | **nový** — čisté funkce: `countUnread`, `countNewSince`, `totalBadge` |
| `src/lib/notifications.test.ts` | **nový** — `node --test` pokrytí čistých funkcí |
| `src/hooks/useNotifications.ts` | **nový** — stav (notifikace, audit, počty), fetch, 60s polling, `markRead`, `markAuditSeen` |
| `src/components/NotificationBell.tsx` | **nový** — tlačítko zvonku + badge (nahrazuje 2 inline zvonky) |
| `src/components/NotificationsPanel.tsx` | **nový** — levý panel: hlavička + taby (chrome), uvnitř `InboxList`/`AuditList` |
| `src/components/InboxPanel.tsx` | refaktor → export `InboxList` (tělo bez chrome) + `type NotificationItem` (zachovat) |
| `src/components/InfoPanel.tsx` | refaktor → export `AuditList` (tělo bez chrome) + `type AuditLogEntry` (zachovat) |
| `src/app/_components/PlannerPage.tsx` | odlehčení — smazat 2 inline zvonky, panel-wiring, notif. stav/fetch; nahradit hookem + komponentami |

---

### Task 1: Čisté helpery pro notifikace + testy

**Files:**
- Create: `src/lib/notifications.ts`
- Test: `src/lib/notifications.test.ts`

**Interfaces:**
- Produces:
  - `countUnread(items: { isRead: boolean }[]): number`
  - `countNewSince(logs: { createdAt: string }[], lastSeenISO: string | null): number`
  - `totalBadge(notifNew: number, auditNew: number): number`

- [ ] **Step 1: Napsat failing test**

```typescript
// src/lib/notifications.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { countUnread, countNewSince, totalBadge } from "./notifications.ts";

test("countUnread počítá jen nepřečtené", () => {
  assert.equal(countUnread([]), 0);
  assert.equal(countUnread([{ isRead: false }, { isRead: true }, { isRead: false }]), 2);
});

test("countUnread — vše přečtené = 0", () => {
  assert.equal(countUnread([{ isRead: true }, { isRead: true }]), 0);
});

test("countNewSince — bez lastSeen počítá vše", () => {
  const logs = [{ createdAt: "2026-07-03T10:00:00.000Z" }, { createdAt: "2026-07-03T11:00:00.000Z" }];
  assert.equal(countNewSince(logs, null), 2);
});

test("countNewSince — jen novější než lastSeen", () => {
  const logs = [
    { createdAt: "2026-07-03T09:00:00.000Z" },
    { createdAt: "2026-07-03T12:00:00.000Z" },
  ];
  assert.equal(countNewSince(logs, "2026-07-03T10:00:00.000Z"), 1);
});

test("countNewSince — nic novějšího = 0", () => {
  const logs = [{ createdAt: "2026-07-03T09:00:00.000Z" }];
  assert.equal(countNewSince(logs, "2026-07-03T10:00:00.000Z"), 0);
});

test("totalBadge = součet", () => {
  assert.equal(totalBadge(0, 0), 0);
  assert.equal(totalBadge(3, 2), 5);
});
```

- [ ] **Step 2: Spustit test — musí selhat**

Run: `node --test --import tsx src/lib/notifications.test.ts`
Expected: FAIL (`Cannot find module './notifications.ts'`)

- [ ] **Step 3: Napsat implementaci**

```typescript
// src/lib/notifications.ts

/** Počet nepřečtených notifikací. */
export function countUnread(items: { isRead: boolean }[]): number {
  return items.filter((n) => !n.isRead).length;
}

/** Počet audit záznamů novějších než lastSeenISO (null = počítat vše). */
export function countNewSince(
  logs: { createdAt: string }[],
  lastSeenISO: string | null,
): number {
  const t = lastSeenISO ? new Date(lastSeenISO).getTime() : 0;
  return logs.filter((l) => new Date(l.createdAt).getTime() > t).length;
}

/** Celkový badge = nepřečtená upozornění + nová aktivita. */
export function totalBadge(notifNew: number, auditNew: number): number {
  return notifNew + auditNew;
}
```

- [ ] **Step 4: Spustit test — musí projít**

Run: `node --test --import tsx src/lib/notifications.test.ts`
Expected: PASS (6 testů zelených)

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications.ts src/lib/notifications.test.ts
git commit -m "feat(notif): čisté helpery countUnread/countNewSince/totalBadge + testy"
```

---

### Task 2: Hook `useNotifications`

**Files:**
- Create: `src/hooks/useNotifications.ts`

**Interfaces:**
- Consumes: `countUnread`, `countNewSince`, `totalBadge` z `@/lib/notifications`; `NotificationItem` z `@/components/InboxPanel`; `AuditLogEntry` z `@/components/InfoPanel`.
- Produces:
  ```typescript
  export function useNotifications(role: string): {
    notifications: NotificationItem[];
    auditLogs: AuditLogEntry[];
    notifNewCount: number;
    auditNewCount: number;
    totalBadge: number;
    canSeeInbox: boolean;
    canSeeAudit: boolean;
    fetchNotifications: () => void;
    fetchAudit: () => void;
    markRead: (notifId: number) => Promise<boolean>;
    markAuditSeen: () => void;
  }
  ```

- [ ] **Step 1: Napsat hook**

Tato logika je 1:1 vytažená z PlannerPage (dnešní `fetchTodayAudit` 856-872, `fetchNotifications` 874-884, polling effect 886-891, `handleMarkRead` 1296-1301, `handleOpenInfoPanel` audit-seen část 1201-1202). `markRead` nově vrací `boolean` (toast řeší volající v PlannerPage).

```typescript
// src/hooks/useNotifications.ts
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
```

- [ ] **Step 2: Ověřit typy buildem**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep useNotifications || echo "OK — žádná chyba v useNotifications"`
Expected: `OK — žádná chyba v useNotifications`

(Pozn.: hook nemá render test — projekt nemá React testovací knihovnu a nepřidáváme závislost. Ověří se integrací v Tasku 6.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useNotifications.ts
git commit -m "feat(notif): useNotifications hook — stav, fetch, 60s polling, markRead"
```

---

### Task 3: Refaktor `InboxPanel` → `InboxList` a `InfoPanel` → `AuditList`

**Files:**
- Modify: `src/components/InboxPanel.tsx`
- Modify: `src/components/InfoPanel.tsx`

**Interfaces:**
- Produces:
  - `InboxList({ notifications, onMarkRead, onJumpToBlock }: { notifications: NotificationItem[]; onMarkRead: (id: number) => void; onJumpToBlock: (orderNumber: string) => void })`
  - `AuditList({ logs, onJumpToBlock }: { logs: AuditLogEntry[]; onJumpToBlock: (orderNumber: string) => void })`
  - `type NotificationItem` (beze změny), `type AuditLogEntry` (beze změny)

- [ ] **Step 1: `InboxPanel.tsx` → `InboxList`**

Přejmenovat exportovanou funkci `InboxPanel` na `InboxList`, odstranit prop `onClose`, a **odstranit celý chrome header** (dnešní řádky 34-40 — `<div>` s „Inbox / Upozornění" a tlačítkem „Zpět"). Vnější `<div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--surface)", borderLeft: "1px solid var(--border)" }}>` (řádek 33) **zrušit** — kořenem `InboxList` se stane rovnou scroll-kontejner (dnešní řádek 41). Import `Button` odstranit (už není potřeba). `type NotificationItem` a `formatPragueMaybeToday` import ponechat.

Výsledek — `src/components/InboxPanel.tsx`:

```typescript
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
```

- [ ] **Step 2: `InfoPanel.tsx` → `AuditList`**

Přejmenovat `InfoPanel` na `AuditList`, odstranit prop `onClose` (a jeho volání na dnešním řádku 56 — `onClose();` před `onJumpToBlock` vypustit; zavření panelu nově řeší volající). Odstranit chrome header (řádky 33-39) a vnější `<div>` (řádek 32); kořenem se stane scroll-kontejner (řádek 40). Import `Button` odstranit. Zbylé importy (`FIELD_LABELS`, `fmtAuditVal`, `formatPragueMaybeToday`) a `type AuditLogEntry` ponechat.

Výsledek — `src/components/InfoPanel.tsx`:

```typescript
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
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Ověřit build (importéři se dočasně rozbijí — to je v pořádku, spraví Task 6)**

Run: `npx eslint src/components/InboxPanel.tsx src/components/InfoPanel.tsx`
Expected: 0 chyb, 0 warningů v těchto dvou souborech.

(Pozn.: `npm run build` teď selže na `PlannerPage.tsx`, protože pořád importuje staré `InboxPanel`/`InfoPanel`. To je očekávané — build se opraví v Tasku 6. Proto tady lintujeme jen změněné soubory, ne celý build.)

- [ ] **Step 4: Commit**

```bash
git add src/components/InboxPanel.tsx src/components/InfoPanel.tsx
git commit -m "refactor(notif): InboxPanel→InboxList, InfoPanel→AuditList (těla bez chrome)"
```

---

### Task 4: Komponenta `NotificationBell`

**Files:**
- Create: `src/components/NotificationBell.tsx`

**Interfaces:**
- Produces: `NotificationBell({ count, active, onClick, title }: { count: number; active: boolean; onClick: () => void; title?: string })`

- [ ] **Step 1: Napsat komponentu**

Sloučí geometrii dnešních dvou zvonků (PlannerPage 3151-3179) do jedné. `active` = panel otevřený (modré zvýraznění).

```typescript
// src/components/NotificationBell.tsx
"use client";

export function NotificationBell({ count, active, onClick, title }: {
  count: number;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={onClick}
        title={title ?? "Upozornění a aktivita"}
        style={{
          width: 28, height: 28, borderRadius: 8,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: active ? "rgba(59,130,246,0.14)" : "var(--surface-2)",
          border: `1px solid ${active ? "rgba(59,130,246,0.35)" : "var(--border)"}`,
          color: active ? "#3b82f6" : "var(--text-muted)",
          cursor: "pointer", transition: "all 120ms ease-out", padding: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
      </button>
      {count > 0 && (
        <span style={{
          position: "absolute", top: -3, right: -3,
          width: 14, height: 14, borderRadius: "50%",
          background: "#ef4444", color: "#fff",
          fontSize: 8, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>{count > 9 ? "9+" : count}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Ověřit lint**

Run: `npx eslint src/components/NotificationBell.tsx`
Expected: 0 chyb, 0 warningů.

- [ ] **Step 3: Commit**

```bash
git add src/components/NotificationBell.tsx
git commit -m "feat(notif): NotificationBell — jeden zvonek + badge"
```

---

### Task 5: Komponenta `NotificationsPanel`

**Files:**
- Create: `src/components/NotificationsPanel.tsx`

**Interfaces:**
- Consumes: `InboxList` + `NotificationItem` z `@/components/InboxPanel`; `AuditList` + `AuditLogEntry` z `@/components/InfoPanel`; `Button` z `@/components/ui/button`.
- Produces:
  ```typescript
  export type NotifTab = "inbox" | "activity";
  export function NotificationsPanel(props: {
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
  }): JSX.Element
  ```

- [ ] **Step 1: Napsat komponentu**

Chrome (hlavička + „Zpět") přebírá vzhled z dnešních panelů (InboxPanel 33-40). Taby jen pro `canSeeAudit`. Hlavička reflektuje aktivní tab. Interní `TabButton`.

```typescript
// src/components/NotificationsPanel.tsx
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
```

- [ ] **Step 2: Ověřit lint**

Run: `npx eslint src/components/NotificationsPanel.tsx`
Expected: 0 chyb, 0 warningů.

- [ ] **Step 3: Commit**

```bash
git add src/components/NotificationsPanel.tsx
git commit -m "feat(notif): NotificationsPanel — levý panel s taby Upozornění/Aktivita"
```

---

### Task 6: Integrace do `PlannerPage` (odlehčení)

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx`

**Interfaces:**
- Consumes: `useNotifications` z `@/hooks/useNotifications`; `NotificationBell` z `@/components/NotificationBell`; `NotificationsPanel` + `NotifTab` z `@/components/NotificationsPanel`; typy `NotificationItem`/`AuditLogEntry` (importy zůstávají kvůli ostatnímu kódu).

- [ ] **Step 1: Upravit importy (řádky 48-49)**

Nahradit:
```typescript
import { InfoPanel, type AuditLogEntry } from "@/components/InfoPanel";
import { InboxPanel, type NotificationItem } from "@/components/InboxPanel";
```
za:
```typescript
import { type AuditLogEntry } from "@/components/InfoPanel";
import { type NotificationItem } from "@/components/InboxPanel";
import { useNotifications } from "@/hooks/useNotifications";
import { NotificationBell } from "@/components/NotificationBell";
import { NotificationsPanel, type NotifTab } from "@/components/NotificationsPanel";
```

- [ ] **Step 2: Nahradit notif. stav hookem (řádky 546-551)**

Smazat:
```typescript
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [todayAuditLogs, setTodayAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditNewCount, setAuditNewCount] = useState(0);
  const [showInboxPanel, setShowInboxPanel] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifNewCount, setNotifNewCount] = useState(0);
```
Nahradit:
```typescript
  const notif = useNotifications(currentUser.role);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [notifTab, setNotifTab] = useState<NotifTab>("inbox");
```

- [ ] **Step 3: Smazat staré fetch funkce + polling effect (řádky 856-891)**

Smazat celé bloky `fetchTodayAudit` (856-872), `fetchNotifications` (874-884) a polling `useEffect` (886-891) — přesunuty do hooku. (Komentář „Refresh MachineWeekShifts…" na 893 zůstává.)

- [ ] **Step 4: Přepsat `handleOpenInfoPanel` → tab handler (řádky 1198-1203)**

Smazat `handleOpenInfoPanel` a nahradit ho handlerem přepínání tabu (audit se označí za viděný při přepnutí na Aktivitu):
```typescript
  function handleNotifTabChange(tab: NotifTab) {
    setNotifTab(tab);
    if (tab === "activity") {
      notif.fetchAudit();
      notif.markAuditSeen();
    }
  }

  function openNotifPanel() {
    setShowNotifPanel(true);
    setNotifTab("inbox");
    notif.fetchNotifications();
  }
```

- [ ] **Step 5: Sjednotit jump-to-block (řádky 1205-1210)**

`handleJumpToBlock` upravit tak, aby zavíral nový panel (dřív `setShowInfoPanel(false)`):
```typescript
  function handleJumpToBlock(orderNumber: string) {
    setShowNotifPanel(false);
    setFilterText(orderNumber);
    const match = blocks.find((b) => b.orderNumber === orderNumber);
    if (match) setSelectedBlock(match);
  }
```

- [ ] **Step 6: Přepsat `handleMarkRead` na hook (řádky 1296-1301)**

```typescript
  async function handleMarkRead(notifId: number) {
    const ok = await notif.markRead(notifId);
    if (!ok) showToast("Nepodařilo se označit jako přečtené", "error");
  }
```

- [ ] **Step 7: Nahradit dva zvonky v headeru jedním (řádky 3149-3213)**

Smazat oba bloky `{/* Bell — audit … */}` (3149-3180) a `{/* Bell — inbox … */}` (3182-3213). Nahradit jedním:
```tsx
          {/* Sloučený zvonek — Upozornění + Aktivita */}
          {notif.canSeeInbox && (
            <NotificationBell
              count={notif.totalBadge}
              active={showNotifPanel}
              onClick={openNotifPanel}
              title="Upozornění a aktivita"
            />
          )}
```

- [ ] **Step 8: Nahradit render InboxPanel (řádky 3347-3357) sloučeným panelem**

Smazat blok `{/* InboxPanel … */}` (3347-3357) a nahradit:
```tsx
        {/* Sloučený notifikační panel — Upozornění + Aktivita (vlevo) */}
        {notif.canSeeInbox && showNotifPanel && (
          <aside style={{ width: 320, flexShrink: 0, position: "relative", zIndex: 10, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <NotificationsPanel
              canSeeAudit={notif.canSeeAudit}
              activeTab={notifTab}
              onTabChange={handleNotifTabChange}
              onClose={() => setShowNotifPanel(false)}
              notifications={notif.notifications}
              auditLogs={notif.auditLogs}
              notifNewCount={notif.notifNewCount}
              auditNewCount={notif.auditNewCount}
              onMarkRead={handleMarkRead}
              onJumpToBlock={handleJumpToBlock}
            />
          </aside>
        )}
```

- [ ] **Step 9: Odstranit `InfoPanel` z pravého aside (řádky 3375-3380)**

V pravém `canEdit` aside smazat větev `showInfoPanel ? (<InfoPanel … />) :` — první podmínku i celý `<InfoPanel>` element. Řetěz podmínek začne rovnou dnešní druhou větví `showShutdowns ? (<ShutdownManager … />)`. Tedy z:
```tsx
          {showInfoPanel ? (
            <InfoPanel
              logs={todayAuditLogs}
              onClose={() => setShowInfoPanel(false)}
              onJumpToBlock={handleJumpToBlock}
            />
          ) : showShutdowns ? (
```
zůstane:
```tsx
          {showShutdowns ? (
```

- [ ] **Step 10: Ověřit build**

Run: `npm run build`
Expected: build projde bez chyb (žádná reference na `showInfoPanel`, `showInboxPanel`, `todayAuditLogs`, `setNotifications`, `fetchNotifications`, `fetchTodayAudit`, `InboxPanel`, `InfoPanel` už v PlannerPage nezůstala).

- [ ] **Step 11: Ověřit lint**

Run: `npx eslint src/app/_components/PlannerPage.tsx`
Expected: žádné NOVÉ warningy oproti výchozímu stavu (repo má známé warningy — `<img>`, exhaustive-deps; nesmí přibýt „unused var" pro smazané symboly ani „undefined" reference).

- [ ] **Step 12: Ověřit testy (regrese)**

Run: `node --test --import tsx src/lib/notifications.test.ts`
Expected: PASS (6 testů). Zbytek suite se nezměnil.

- [ ] **Step 13: Ruční ověření v UI**

Spustit `npm run dev`, přihlásit se jako ADMIN a ověřit:
- V headeru je **jeden** zvonek (ne dva).
- Klik otevře levý panel s taby **Upozornění** (výchozí) | **Aktivita**.
- Tab Upozornění ukazuje notifikace (drift „Přepočítat" funguje, „✓ Přečteno" sníží badge).
- Tab Aktivita ukazuje audit DTP/MTZ; přepnutí na něj vynuluje jeho počítadlo.
- Badge na zvonku = součet obou počtů.
- Klik na číslo bloku v notifikaci/auditu zavře panel a odfiltruje/vybere blok.
- Přihlásit se jako DTP: zvonek je jeden, panel **bez tabů**, jen Upozornění.

- [ ] **Step 14: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat(notif): sloučit dva zvonky do jednoho s taby; odlehčit PlannerPage"
```

---

## Self-Review (proti specu)

**Spec coverage:**
- Jeden zvonek vlevo → Task 4 (bell) + Task 6 (Step 7, 8). ✅
- Taby Upozornění/Aktivita, výchozí Upozornění → Task 5 + Task 6 (Step 2, 4). ✅
- Badge = součet → Task 1 (`totalBadge`) + Task 2 + Task 4. ✅
- DTP/MTZ/OBCHODNIK bez tabů → Task 5 (`canSeeAudit` guard) + Task 6 (Step 2 default „inbox"). ✅
- Vlastní tab přepínač, žádná nová závislost → Task 5 (`TabButton`). ✅
- Úroveň 3 (panel + zvonek + logika ven) → Tasky 2, 4, 5, 6. ✅
- Bez SSE, 60s polling zachován → Task 2 (`useEffect` interval). ✅
- API/DB/notif logika beze změny → žádný task se jich nedotýká. ✅
- Typy zůstávají exportované → Task 3 (ponechány), Task 6 Step 1 (importy typů zůstávají). ✅

**Placeholder scan:** žádné TBD/TODO; každý krok s kódem má úplný kód nebo přesné odkazy na řádky k odstranění. ✅

**Type consistency:** `NotifTab = "inbox" | "activity"` použit jednotně (Task 5 def, Task 6 import). `markRead` vrací `Promise<boolean>` (Task 2 def) → `handleMarkRead` (Task 6 Step 6) i wrapper konzistentní. `InboxList`/`AuditList` signatury (Task 3) sedí na volání v `NotificationsPanel` (Task 5). ✅
