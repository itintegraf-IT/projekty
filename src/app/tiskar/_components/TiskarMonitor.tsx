"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { startOfDay, addDays, addMinutes, format, isSameDay } from "date-fns";
import { cs } from "date-fns/locale";

// ─── Typy ────────────────────────────────────────────────────────────────────

interface TiskarBlock {
  id: number;
  orderNumber: string;
  machine: string;
  startTime: string;
  endTime: string;
  type: string;
  description: string | null;
  locked: boolean;
  deadlineExpedice: string | null;
  dataStatusLabel: string | null;
  materialStatusLabel: string | null;
  barvyStatusLabel: string | null;
  lakStatusLabel: string | null;
  specifikace: string | null;
  printCompletedAt: string | null;
  printCompletedByUsername: string | null;
  printCompletedByUserId: number | null;
}

interface Props {
  initialBlocks: TiskarBlock[];
  machine: string;
  username: string;
}

// ─── Konstanty ───────────────────────────────────────────────────────────────

const SLOT_HEIGHT = 26;       // px za 30 min
const TIME_COL_W = 72;        // px — časový sloupec vlevo
const HEADER_H = 52;          // px — výška headeru
const DAYS_AHEAD = 7;
const POLL_INTERVAL = 30_000; // 30 s

const MACHINE_LABELS: Record<string, string> = {
  XL_105: "XL 105",
  XL_106: "XL 106",
};

// ─── Styly bloků ─────────────────────────────────────────────────────────────

const BLOCK_ZAKAZKA = {
  background: "linear-gradient(180deg, rgba(59,130,246,0.22) 0%, rgba(59,130,246,0.12) 100%)",
  border: "1px solid rgba(59,130,246,0.35)",
  accentColor: "#3b82f6",
};

const BLOCK_ZAKAZKA_DONE = {
  background: "linear-gradient(180deg, rgba(34,197,94,0.22) 0%, rgba(34,197,94,0.12) 100%)",
  border: "1px solid rgba(34,197,94,0.35)",
  accentColor: "#22c55e",
};

const BLOCK_REZERVACE = {
  background: "linear-gradient(180deg, rgba(139,92,246,0.22) 0%, rgba(139,92,246,0.12) 100%)",
  border: "1px solid rgba(139,92,246,0.35)",
  accentColor: "#8b5cf6",
};

const BLOCK_UDRZBA = {
  background: "linear-gradient(180deg, rgba(239,68,68,0.22) 0%, rgba(239,68,68,0.12) 100%)",
  border: "1px solid rgba(239,68,68,0.35)",
  accentColor: "#ef4444",
};

// ─── Helper funkce ────────────────────────────────────────────────────────────

function dateToY(date: Date, viewStart: Date): number {
  const diffMs = date.getTime() - viewStart.getTime();
  return (diffMs / (30 * 60 * 1000)) * SLOT_HEIGHT;
}

function nowY(viewStart: Date): number {
  return dateToY(new Date(), viewStart);
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return format(d, "HH:mm");
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return format(d, "d. M. yyyy HH:mm", { locale: cs });
}

function getDayLabel(date: Date): string {
  return format(date, "EEE d. M.", { locale: cs });
}

// ─── Hlavní komponenta ────────────────────────────────────────────────────────

export default function TiskarMonitor({ initialBlocks, machine, username }: Props) {
  const [blocks, setBlocks] = useState<TiskarBlock[]>(initialBlocks);
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [now, setNow] = useState(() => new Date());
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);

  const viewStart = startOfDay(now);
  const totalSlots = DAYS_AHEAD * 48; // 48 slotů = 24h
  const totalHeight = totalSlots * SLOT_HEIGHT;

  // Tick "now" každou minutu
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Auto-scroll na "teď" při načtení
  useLayoutEffect(() => {
    if (hasScrolled.current || !scrollRef.current) return;
    hasScrolled.current = true;
    const y = nowY(viewStart);
    scrollRef.current.scrollTop = Math.max(0, y - 200);
  }, [viewStart]);

  // Polling každých 30 s
  const fetchBlocks = useCallback(async () => {
    try {
      const res = await fetch(`/api/blocks?machine=${machine}`);
      if (!res.ok) return;
      const data: TiskarBlock[] = await res.json();
      setBlocks(data);
    } catch (e) {
      console.error("Poll blocks failed", e);
    }
  }, [machine]);

  useEffect(() => {
    const t = setInterval(fetchBlocks, POLL_INTERVAL);
    return () => clearInterval(t);
  }, [fetchBlocks]);

  // Potvrzení / vrácení tisku
  async function handleComplete(blockId: number, completed: boolean) {
    setPendingIds((s) => new Set(s).add(blockId));
    // Optimistická aktualizace
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === blockId
          ? {
              ...b,
              printCompletedAt: completed ? new Date().toISOString() : null,
              printCompletedByUsername: completed ? username : null,
            }
          : b
      )
    );
    try {
      const res = await fetch(`/api/blocks/${blockId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
      });
      if (!res.ok) {
        // Vrátit stav zpět
        await fetchBlocks();
      } else {
        const updated: TiskarBlock = await res.json();
        setBlocks((prev) => prev.map((b) => (b.id === updated.id ? { ...b, ...updated, startTime: typeof updated.startTime === 'string' ? updated.startTime : new Date(updated.startTime).toISOString(), endTime: typeof updated.endTime === 'string' ? updated.endTime : new Date(updated.endTime).toISOString() } : b)));
      }
    } catch (e) {
      console.error("Complete failed", e);
      await fetchBlocks();
    } finally {
      setPendingIds((s) => { const n = new Set(s); n.delete(blockId); return n; });
    }
  }

  // Odhlášení
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  // Vygenerovat časové štítky
  const timeLabels: { y: number; label: string; isFullHour: boolean; isNewDay: boolean; date: Date }[] = [];
  for (let i = 0; i < totalSlots; i++) {
    const slotDate = addMinutes(viewStart, i * 30);
    const isFullHour = slotDate.getMinutes() === 0;
    const isNewDay = slotDate.getHours() === 0 && slotDate.getMinutes() === 0 && i > 0;
    timeLabels.push({
      y: i * SLOT_HEIGHT,
      label: format(slotDate, "HH:mm"),
      isFullHour,
      isNewDay,
      date: slotDate,
    });
  }

  const nowLineY = dateToY(now, viewStart);

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
      color: "var(--text)",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        height: HEADER_H,
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        padding: "0 20px",
        gap: 12,
        position: "sticky",
        top: 0,
        zIndex: 30,
      }}>
        {/* Stroj badge */}
        <div style={{
          background: "rgba(172,140,255,0.15)",
          color: "#ac8cff",
          borderRadius: 8,
          padding: "4px 12px",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.01em",
        }}>
          {MACHINE_LABELS[machine] ?? machine}
        </div>

        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Tiskař: <strong style={{ color: "var(--text)" }}>{username}</strong>
        </div>

        <div style={{ flex: 1 }} />

        {/* Aktuální čas */}
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {format(now, "HH:mm")}
        </div>

        {/* Odhlásit */}
        <button
          onClick={handleLogout}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "5px 12px",
            fontSize: 12,
            color: "var(--text-muted)",
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "all 0.12s ease-out",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
        >
          Odhlásit
        </button>
      </div>

      {/* Timeline */}
      <div
        ref={scrollRef}
        style={{ flex: 1, overflowY: "auto", overflowX: "hidden", position: "relative" }}
      >
        <div style={{ position: "relative", height: totalHeight, minWidth: "100%" }}>

          {/* Časové štítky + mřížka */}
          {timeLabels.map(({ y, label, isFullHour, isNewDay, date }) => (
            <div key={y} style={{ position: "absolute", top: y, left: 0, right: 0 }}>
              {/* Denní separator */}
              {isNewDay && (
                <div style={{
                  position: "absolute",
                  top: 0, left: 0, right: 0,
                  height: 28,
                  background: "var(--surface)",
                  borderTop: "1px solid var(--border)",
                  borderBottom: "1px solid var(--border)",
                  display: "flex", alignItems: "center",
                  paddingLeft: TIME_COL_W + 12,
                  fontSize: 11,
                  fontWeight: 600,
                  color: isSameDay(date, new Date()) ? "#3b82f6" : "var(--text-muted)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  zIndex: 5,
                }}>
                  {getDayLabel(date)}
                </div>
              )}

              {/* Časový label */}
              {isFullHour && !isNewDay && (
                <div style={{
                  position: "absolute",
                  top: 0, left: 0,
                  width: TIME_COL_W,
                  height: SLOT_HEIGHT,
                  display: "flex", alignItems: "center",
                  paddingLeft: 12,
                  fontSize: 11,
                  color: "var(--text-muted)",
                  fontVariantNumeric: "tabular-nums",
                  borderTop: "1px solid rgba(255,255,255,0.05)",
                }}>
                  {label}
                </div>
              )}

              {/* Mřížková čára */}
              <div style={{
                position: "absolute",
                top: 0,
                left: TIME_COL_W,
                right: 0,
                borderTop: isFullHour
                  ? "1px solid rgba(255,255,255,0.08)"
                  : "1px solid rgba(255,255,255,0.03)",
              }} />
            </div>
          ))}

          {/* "Teď" čára */}
          {nowLineY >= 0 && nowLineY < totalHeight && (
            <div style={{
              position: "absolute",
              top: nowLineY,
              left: TIME_COL_W,
              right: 0,
              height: 2,
              background: "#ef4444",
              zIndex: 10,
              boxShadow: "0 0 6px rgba(239,68,68,0.6)",
            }}>
              <div style={{
                position: "absolute",
                left: -6, top: -4,
                width: 10, height: 10,
                borderRadius: "50%",
                background: "#ef4444",
              }} />
            </div>
          )}

          {/* Bloky */}
          {blocks.map((block) => {
            const startD = new Date(block.startTime);
            const endD = new Date(block.endTime);
            const top = dateToY(startD, viewStart);
            const height = Math.max(28, dateToY(endD, viewStart) - top);

            if (top + height < 0 || top > totalHeight) return null;

            const isDone = block.printCompletedAt != null;
            const isOverdue = block.type !== "UDRZBA" && endD < now && !isDone;

            let style = block.type === "ZAKAZKA"
              ? (isDone ? BLOCK_ZAKAZKA_DONE : BLOCK_ZAKAZKA)
              : block.type === "REZERVACE"
              ? BLOCK_REZERVACE
              : BLOCK_UDRZBA;

            if (isOverdue) {
              style = {
                background: "linear-gradient(180deg, rgba(100,116,139,0.18) 0%, rgba(100,116,139,0.10) 100%)",
                border: "1px solid rgba(100,116,139,0.25)",
                accentColor: "#64748b",
              };
            }

            const isPending = pendingIds.has(block.id);
            const canConfirm = block.type === "ZAKAZKA";

            return (
              <div
                key={block.id}
                style={{
                  position: "absolute",
                  top,
                  left: TIME_COL_W + 8,
                  right: 12,
                  height,
                  background: style.background,
                  border: style.border,
                  borderRadius: 6,
                  overflow: "hidden",
                  zIndex: 8,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {/* Levý accent bar */}
                <div style={{
                  position: "absolute",
                  left: 0, top: 0, bottom: 0,
                  width: 3,
                  background: style.accentColor,
                  borderRadius: "3px 0 0 3px",
                  opacity: isOverdue ? 0.4 : 0.8,
                }} />

                {/* Obsah bloku */}
                <div style={{
                  flex: 1,
                  padding: "4px 8px 4px 10px",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}>
                  {/* Čas + číslo */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                      {fmtTime(block.startTime)}–{fmtTime(block.endTime)}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 700,
                      color: isOverdue ? "var(--text-muted)" : "var(--text)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {block.orderNumber}
                    </span>
                    {block.type !== "ZAKAZKA" && (
                      <span style={{
                        fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                        color: style.accentColor, flexShrink: 0,
                        background: `${style.accentColor}22`, borderRadius: 3, padding: "1px 4px",
                      }}>
                        {block.type === "REZERVACE" ? "Rezervace" : "Údržba"}
                      </span>
                    )}
                    {isDone && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, color: "#22c55e",
                        background: "rgba(34,197,94,0.15)", borderRadius: 3, padding: "1px 4px",
                        flexShrink: 0,
                      }}>
                        ✓ Hotovo
                      </span>
                    )}
                    {isOverdue && (
                      <span style={{
                        fontSize: 9, fontWeight: 600, color: "#f59e0b",
                        background: "rgba(245,158,11,0.15)", borderRadius: 3, padding: "1px 4px",
                        flexShrink: 0,
                      }}>
                        ⏳ Čeká
                      </span>
                    )}
                  </div>

                  {height >= 44 && block.description && (
                    <div style={{
                      fontSize: 11, color: "var(--text-muted)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {block.description}
                    </div>
                  )}

                  {height >= 60 && isDone && block.printCompletedAt && (
                    <div style={{ fontSize: 10, color: "#22c55e" }}>
                      Potvrzeno {fmtDateTime(block.printCompletedAt)}
                      {block.printCompletedByUsername && ` — ${block.printCompletedByUsername}`}
                    </div>
                  )}
                </div>

                {/* Tlačítko Hotovo — jen pro ZAKAZKA, pokud je dostatečná výška */}
                {canConfirm && height >= 60 && (
                  <div style={{
                    padding: "0 8px 6px 10px",
                    display: "flex",
                    justifyContent: "flex-end",
                  }}>
                    <button
                      onClick={() => handleComplete(block.id, !isDone)}
                      disabled={isPending}
                      style={{
                        padding: "3px 10px",
                        borderRadius: 5,
                        border: "none",
                        cursor: isPending ? "not-allowed" : "pointer",
                        fontSize: 11, fontWeight: 600,
                        fontFamily: "inherit",
                        transition: "all 0.12s ease-out",
                        background: isDone
                          ? "rgba(100,116,139,0.2)"
                          : "rgba(34,197,94,0.25)",
                        color: isDone ? "var(--text-muted)" : "#22c55e",
                        opacity: isPending ? 0.5 : 1,
                      }}
                    >
                      {isPending ? "..." : isDone ? "Vrátit hotovo" : "Hotovo"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
