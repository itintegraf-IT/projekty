"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { startOfDay, addMinutes, format, isSameDay } from "date-fns";
import { cs } from "date-fns/locale";

// ─── Typy ────────────────────────────────────────────────────────────────────

interface TiskarBlock {
  id: number;
  orderNumber: string;
  machine: string;
  startTime: string;
  endTime: string;
  type: string;
  blockVariant: string | null;
  description: string | null;
  locked: boolean;
  dataStatusLabel: string | null;
  materialStatusLabel: string | null;
  barvyStatusLabel: string | null;
  lakStatusLabel: string | null;
  specifikace: string | null;
  recurrenceType: string;
  recurrenceParentId: number | null;
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

const SLOT_HEIGHT = 26;
const TIME_COL_W  = 72;
const HEADER_H    = 52;
const DAYS_AHEAD  = 7;
const POLL_INTERVAL = 30_000;

const MACHINE_LABELS: Record<string, string> = {
  XL_105: "XL 105",
  XL_106: "XL 106",
};

// ─── Vizuální styly bloků (shodné s TimelineGrid) ────────────────────────────

const BLOCK_STYLES: Record<string, {
  gradient: string; border: string; accentBar: string;
  textPrimary: string; textSub: string; glow: string;
}> = {
  ZAKAZKA: {
    gradient:    "linear-gradient(160deg, rgba(59,130,246,0.95) 0%, rgba(37,99,235,0.88) 100%)",
    border:      "rgba(59,130,246,0.65)",
    accentBar:   "#3b82f6",
    textPrimary: "#ffffff",
    textSub:     "#ffffff",
    glow:        "rgba(59,130,246,0.35)",
  },
  REZERVACE: {
    gradient:    "linear-gradient(160deg, rgba(102,0,153,0.95) 0%, rgba(77,0,115,0.88) 100%)",
    border:      "rgba(102,0,153,0.65)",
    accentBar:   "#660099",
    textPrimary: "#ffffff",
    textSub:     "#ffffff",
    glow:        "rgba(102,0,153,0.35)",
  },
  UDRZBA: {
    gradient:    "linear-gradient(160deg, rgba(34,197,94,0.95) 0%, rgba(22,163,74,0.88) 100%)",
    border:      "rgba(34,197,94,0.65)",
    accentBar:   "#22c55e",
    textPrimary: "#ffffff",
    textSub:     "#ffffff",
    glow:        "rgba(34,197,94,0.32)",
  },
  ZAKAZKA_BEZ_TECHNOLOGIE: {
    gradient:    "linear-gradient(160deg, rgba(6,95,70,0.95) 0%, rgba(4,71,54,0.88) 100%)",
    border:      "rgba(6,95,70,0.65)",
    accentBar:   "#059669",
    textPrimary: "#ffffff",
    textSub:     "#e5e7eb",
    glow:        "rgba(6,95,70,0.32)",
  },
  ZAKAZKA_BEZ_SACKU: {
    gradient:    "linear-gradient(160deg, rgba(227,100,20,0.95) 0%, rgba(190,80,10,0.88) 100%)",
    border:      "rgba(227,100,20,0.65)",
    accentBar:   "#e36414",
    textPrimary: "#ffffff",
    textSub:     "#e5e7eb",
    glow:        "rgba(227,100,20,0.32)",
  },
  ZAKAZKA_POZASTAVENO: {
    gradient:    "linear-gradient(160deg, rgba(208,0,0,0.95) 0%, rgba(176,0,0,0.88) 100%)",
    border:      "rgba(208,0,0,0.65)",
    accentBar:   "#d00000",
    textPrimary: "#ffffff",
    textSub:     "#e5e7eb",
    glow:        "rgba(208,0,0,0.32)",
  },
};

const BLOCK_OVERDUE = {
  gradient:    "linear-gradient(160deg, rgba(100,116,139,0.16) 0%, rgba(71,85,105,0.10) 100%)",
  border:      "rgba(100,116,139,0.26)",
  accentBar:   "rgba(100,116,139,0.60)",
  textPrimary: "var(--text-muted)",
  textSub:     "var(--text-muted)",
  glow:        "transparent",
};

const BLOCK_PRINT_DONE = {
  gradient:    "linear-gradient(160deg, rgba(34,197,94,0.15) 0%, rgba(34,197,94,0.08) 100%)",
  border:      "rgba(34,197,94,0.30)",
  accentBar:   "rgba(34,197,94,0.70)",
  textPrimary: "var(--text)",
  textSub:     "var(--text-muted)",
  glow:        "rgba(34,197,94,0.15)",
};

function getBlockStyleKey(type: string, variant?: string | null): string {
  if (type === "ZAKAZKA" && variant && variant !== "STANDARD") return `ZAKAZKA_${variant}`;
  return type;
}

function tint(color: string, percent: number): string {
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`;
}

function MiniChip({ label, accent }: { label: string; accent: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, color: accent, lineHeight: 1.5,
      background: tint(accent, 85), border: `1px solid ${tint(accent, 100)}`,
      borderRadius: 3, padding: "1px 5px", whiteSpace: "nowrap",
      display: "block",
    }}>
      {label}
    </span>
  );
}

// ─── Helper funkce ────────────────────────────────────────────────────────────

function dateToY(date: Date, viewStart: Date): number {
  return ((date.getTime() - viewStart.getTime()) / (30 * 60 * 1000)) * SLOT_HEIGHT;
}

function fmtTime(iso: string): string {
  return format(new Date(iso), "HH:mm");
}

function fmtDateTime(iso: string): string {
  return format(new Date(iso), "d. M. HH:mm", { locale: cs });
}

function getDayLabel(date: Date): string {
  return format(date, "EEE d. M.", { locale: cs });
}

// ─── Hlavní komponenta ────────────────────────────────────────────────────────

export default function TiskarMonitor({ initialBlocks, machine, username }: Props) {
  const [blocks, setBlocks]     = useState<TiskarBlock[]>(initialBlocks);
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [now, setNow]           = useState(() => new Date());
  const scrollRef               = useRef<HTMLDivElement>(null);
  const hasScrolled             = useRef(false);

  const viewStart   = startOfDay(now);
  const totalSlots  = DAYS_AHEAD * 48;
  const totalHeight = totalSlots * SLOT_HEIGHT;

  // Tick každou minutu
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Auto-scroll na "teď"
  useLayoutEffect(() => {
    if (hasScrolled.current || !scrollRef.current) return;
    hasScrolled.current = true;
    scrollRef.current.scrollTop = Math.max(0, dateToY(now, viewStart) - 200);
  }, [now, viewStart]);

  // Polling
  const fetchBlocks = useCallback(async () => {
    try {
      const res = await fetch(`/api/blocks?machine=${machine}`);
      if (!res.ok) return;
      setBlocks(await res.json());
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
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === blockId
          ? { ...b, printCompletedAt: completed ? new Date().toISOString() : null, printCompletedByUsername: completed ? username : null }
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
        await fetchBlocks();
      } else {
        const updated: TiskarBlock = await res.json();
        setBlocks((prev) => prev.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)));
      }
    } catch (e) {
      console.error("Complete failed", e);
      await fetchBlocks();
    } finally {
      setPendingIds((s) => { const n = new Set(s); n.delete(blockId); return n; });
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  // Časové štítky
  const timeLabels: { y: number; label: string; isFullHour: boolean; isNewDay: boolean; date: Date }[] = [];
  for (let i = 0; i < totalSlots; i++) {
    const slotDate = addMinutes(viewStart, i * 30);
    timeLabels.push({
      y: i * SLOT_HEIGHT,
      label: format(slotDate, "HH:mm"),
      isFullHour: slotDate.getMinutes() === 0,
      isNewDay: slotDate.getHours() === 0 && slotDate.getMinutes() === 0 && i > 0,
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

      {/* ── Minimální header ─────────────────────────────────────────────────── */}
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
        flexShrink: 0,
      }}>
        <div style={{
          background: "rgba(172,140,255,0.15)",
          color: "#ac8cff",
          borderRadius: 8,
          padding: "4px 12px",
          fontSize: 13,
          fontWeight: 700,
        }}>
          {MACHINE_LABELS[machine] ?? machine}
        </div>

        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Tiskař: <strong style={{ color: "var(--text)" }}>{username}</strong>
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {format(now, "HH:mm")}
        </div>

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
            transition: "color 0.12s ease-out",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
        >
          Odhlásit
        </button>
      </div>

      {/* ── Timeline ─────────────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        style={{ flex: 1, overflowY: "auto", overflowX: "hidden", position: "relative" }}
      >
        <div style={{ position: "relative", height: totalHeight, minWidth: "100%" }}>

          {/* Mřížka + časové štítky */}
          {timeLabels.map(({ y, label, isFullHour, isNewDay, date }) => (
            <div key={y} style={{ position: "absolute", top: y, left: 0, right: 0 }}>
              {isNewDay && (
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0, height: 28,
                  background: "var(--surface)",
                  borderTop: "1px solid var(--border)",
                  borderBottom: "1px solid var(--border)",
                  display: "flex", alignItems: "center",
                  paddingLeft: TIME_COL_W + 12,
                  fontSize: 11, fontWeight: 600,
                  color: isSameDay(date, new Date()) ? "#3b82f6" : "var(--text-muted)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  zIndex: 5,
                }}>
                  {getDayLabel(date)}
                </div>
              )}

              {isFullHour && !isNewDay && (
                <div style={{
                  position: "absolute", top: 0, left: 0,
                  width: TIME_COL_W, height: SLOT_HEIGHT,
                  display: "flex", alignItems: "center",
                  paddingLeft: 12,
                  fontSize: 11, color: "var(--text-muted)",
                  fontVariantNumeric: "tabular-nums",
                  borderTop: "1px solid rgba(255,255,255,0.05)",
                }}>
                  {label}
                </div>
              )}

              <div style={{
                position: "absolute", top: 0, left: TIME_COL_W, right: 0,
                borderTop: isFullHour
                  ? "1px solid rgba(255,255,255,0.08)"
                  : "1px solid rgba(255,255,255,0.03)",
              }} />
            </div>
          ))}

          {/* "Teď" čára */}
          {nowLineY >= 0 && nowLineY < totalHeight && (
            <div style={{
              position: "absolute", top: nowLineY,
              left: TIME_COL_W, right: 0,
              height: 2, background: "#ef4444", zIndex: 10,
              boxShadow: "0 0 6px rgba(239,68,68,0.6)",
            }}>
              <div style={{
                position: "absolute", left: -6, top: -4,
                width: 10, height: 10, borderRadius: "50%", background: "#ef4444",
              }} />
            </div>
          )}

          {/* ── Bloky ───────────────────────────────────────────────────────── */}
          {blocks.map((block) => {
            const startD = new Date(block.startTime);
            const endD   = new Date(block.endTime);
            const top    = dateToY(startD, viewStart);
            const rawH   = dateToY(endD, viewStart) - top;
            const clampedHeight = Math.max(20, rawH);

            if (top + clampedHeight < 0 || top > totalHeight) return null;

            const isPrintDone   = block.printCompletedAt != null;
            const isPozastaveno = block.type === "ZAKAZKA" && block.blockVariant === "POZASTAVENO";
            const isOverdue     = block.type !== "UDRZBA" && endD < now && !isPrintDone && !isPozastaveno;
            const canConfirm    = block.type === "ZAKAZKA";
            const isPending     = pendingIds.has(block.id);

            const s = isPrintDone
              ? BLOCK_PRINT_DONE
              : isPozastaveno
              ? BLOCK_STYLES["ZAKAZKA_POZASTAVENO"]
              : isOverdue
              ? BLOCK_OVERDUE
              : (BLOCK_STYLES[getBlockStyleKey(block.type, block.blockVariant)] ?? BLOCK_STYLES["ZAKAZKA"]);

            // Výškové mody (stejná logika jako TimelineGrid)
            const MODE_FULL    = clampedHeight >= 48;
            const MODE_COMPACT = !MODE_FULL && clampedHeight >= 44;
            const MODE_TINY    = !MODE_FULL && !MODE_COMPACT && clampedHeight >= 20;

            const hasChips = block.dataStatusLabel || block.materialStatusLabel || block.barvyStatusLabel || block.lakStatusLabel;

            // Tlačítko Hotovo — mini verze pro compact/tiny
            function HotovoBtnMini() {
              if (!canConfirm) return null;
              return (
                <button
                  onClick={(e) => { e.stopPropagation(); handleComplete(block.id, !isPrintDone); }}
                  disabled={isPending}
                  title={isPrintDone ? "Vrátit hotovo" : "Označit jako hotovo"}
                  style={{
                    flexShrink: 0,
                    width: 22, height: 22,
                    borderRadius: 5,
                    border: "none",
                    cursor: isPending ? "not-allowed" : "pointer",
                    fontSize: 11, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: isPrintDone ? "rgba(100,116,139,0.3)" : "rgba(34,197,94,0.35)",
                    color: isPrintDone ? "var(--text-muted)" : "#22c55e",
                    opacity: isPending ? 0.5 : 1,
                    transition: "all 0.12s ease-out",
                    lineHeight: 1,
                    fontFamily: "inherit",
                  }}
                >
                  {isPending ? "·" : isPrintDone ? "↩" : "✓"}
                </button>
              );
            }

            return (
              <div
                key={block.id}
                style={{
                  position: "absolute",
                  top,
                  left: TIME_COL_W + 3,
                  right: 3,
                  height: clampedHeight,
                  background: s.gradient,
                  border: `1px solid ${s.border}`,
                  borderRadius: 7,
                  overflow: "hidden",
                  zIndex: 8,
                  display: "flex",
                  flexDirection: "column",
                  boxShadow: `0 2px 8px rgba(0,0,0,0.35), 0 0 10px ${s.glow}, inset 0 1px 0 rgba(255,255,255,0.05)`,
                }}
              >
                {/* Levý barevný pruh */}
                <div style={{
                  position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
                  background: s.accentBar, opacity: isOverdue ? 0.4 : 1,
                  borderRadius: "7px 0 0 7px",
                }} />

                {/* ── MODE_TINY: jednořádkový, jen číslo + Hotovo tlačítko ─── */}
                {MODE_TINY && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "0 6px 0 10px", flex: 1, overflow: "hidden",
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700,
                      color: s.textPrimary, whiteSpace: "nowrap", flexShrink: 0,
                    }}>
                      {block.orderNumber}
                    </span>
                    {isPrintDone && (
                      <span style={{ fontSize: 8, fontWeight: 700, color: "#22c55e", flexShrink: 0 }}>✓</span>
                    )}
                    <div style={{ flex: 1 }} />
                    <HotovoBtnMini />
                  </div>
                )}

                {/* ── MODE_COMPACT: číslo + popis + chipy + Hotovo tlačítko ── */}
                {MODE_COMPACT && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "0 6px 0 10px", flex: 1, overflow: "hidden",
                  }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700,
                      color: s.textPrimary, whiteSpace: "nowrap", flexShrink: 0,
                    }}>
                      {block.orderNumber}
                    </span>
                    {isPrintDone && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: "#22c55e", flexShrink: 0 }}>✓</span>
                    )}
                    {block.description && (
                      <span style={{
                        fontSize: 9, color: s.textSub, opacity: 0.75,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                      }}>
                        {block.description}
                      </span>
                    )}
                    {hasChips && (
                      <div style={{ display: "flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
                        {block.dataStatusLabel     && <MiniChip label={block.dataStatusLabel}     accent={s.accentBar} />}
                        {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={s.textSub} />}
                        {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent="var(--text-muted)" />}
                        {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent="var(--text-muted)" />}
                      </div>
                    )}
                    <HotovoBtnMini />
                  </div>
                )}

                {/* ── MODE_FULL: klasický víceřádkový layout ─────────────── */}
                {MODE_FULL && (
                  <>
                    {/* Řádek 1: číslo + typ badge + printDone + chipy vpravo */}
                    <div style={{
                      padding: "5px 9px 3px 10px",
                      display: "flex", alignItems: "flex-start", gap: 4,
                      flexShrink: 0,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                        <span style={{
                          fontSize: 12, fontWeight: 700,
                          color: s.textPrimary, whiteSpace: "nowrap", flexShrink: 0,
                        }}>
                          {block.orderNumber}
                        </span>
                        {block.type !== "ZAKAZKA" && (
                          <span style={{
                            fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                            color: s.accentBar,
                            background: tint(s.accentBar, 22),
                            borderRadius: 3, padding: "1px 4px", flexShrink: 0,
                          }}>
                            {block.type === "REZERVACE" ? "Rezervace" : "Údržba"}
                          </span>
                        )}
                        {isPrintDone && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, color: "#22c55e",
                            background: "rgba(34,197,94,0.2)", borderRadius: 3, padding: "1px 5px", flexShrink: 0,
                          }}>
                            ✓ Hotovo
                          </span>
                        )}
                        {isOverdue && !isPrintDone && block.type === "ZAKAZKA" && (
                          <span style={{
                            fontSize: 9, fontWeight: 600, color: "#f59e0b",
                            background: "rgba(245,158,11,0.15)", borderRadius: 3, padding: "1px 4px", flexShrink: 0,
                          }}>
                            ⏳
                          </span>
                        )}
                      </div>

                      {/* Status chipy vpravo nahoře */}
                      {hasChips && (
                        <div style={{ display: "flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
                          {block.dataStatusLabel     && <MiniChip label={block.dataStatusLabel}     accent={s.accentBar} />}
                          {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={s.textSub} />}
                          {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent="rgba(255,255,255,0.55)" />}
                          {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent="rgba(255,255,255,0.45)" />}
                        </div>
                      )}
                    </div>

                    {/* Čas */}
                    <div style={{
                      padding: "0 9px 0 10px",
                      fontSize: 10, color: s.textSub, opacity: 0.65,
                      fontVariantNumeric: "tabular-nums",
                      flexShrink: 0,
                    }}>
                      {fmtTime(block.startTime)} – {fmtTime(block.endTime)}
                    </div>

                    {/* Popis */}
                    {clampedHeight >= 72 && block.description && (
                      <div style={{
                        padding: "2px 9px 0 10px",
                        fontSize: 11, color: s.textSub, opacity: 0.75,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}>
                        {block.description}
                      </div>
                    )}

                    {/* Specifikace */}
                    {clampedHeight >= 90 && block.specifikace && (
                      <div style={{
                        padding: "2px 9px 0 10px",
                        fontSize: 10, fontStyle: "italic", color: s.textSub, opacity: 0.60,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}>
                        {block.specifikace}
                      </div>
                    )}

                    {/* Info o potvrzení */}
                    {clampedHeight >= 90 && isPrintDone && block.printCompletedAt && (
                      <div style={{
                        padding: "2px 9px 0 10px",
                        fontSize: 10, color: "#22c55e", flexShrink: 0,
                      }}>
                        {fmtDateTime(block.printCompletedAt)}
                        {block.printCompletedByUsername && ` — ${block.printCompletedByUsername}`}
                      </div>
                    )}

                    <div style={{ flex: 1 }} />

                    {/* Hotovo tlačítko — plná verze */}
                    {canConfirm && (
                      <div style={{ padding: "0 8px 6px 10px", display: "flex", justifyContent: "flex-end" }}>
                        <button
                          onClick={() => handleComplete(block.id, !isPrintDone)}
                          disabled={isPending}
                          style={{
                            padding: "3px 10px",
                            borderRadius: 5,
                            border: "none",
                            cursor: isPending ? "not-allowed" : "pointer",
                            fontSize: 11, fontWeight: 600,
                            fontFamily: "inherit",
                            transition: "all 0.12s ease-out",
                            background: isPrintDone ? "rgba(100,116,139,0.25)" : "rgba(34,197,94,0.3)",
                            color: isPrintDone ? "var(--text-muted)" : "#22c55e",
                            opacity: isPending ? 0.5 : 1,
                          }}
                        >
                          {isPending ? "…" : isPrintDone ? "Vrátit hotovo" : "Hotovo"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
