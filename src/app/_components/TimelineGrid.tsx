"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { snapGroupDelta, snapToNextValidStart } from "@/lib/workingTime";
import { badgeColorVar } from "@/lib/badgeColors";
import type { MachineWorkHours } from "@/lib/machineWorkHours";
import type { MachineScheduleException } from "@/lib/machineScheduleException";

// ─── Konstanty ────────────────────────────────────────────────────────────────
const SLOT_HEIGHT = 26;         // px na 30 min (1 hod = 52 px)
const DATE_COL_W = 44;          // šířka sloupce s datem (px)
const HEADER_HEIGHT = 33;       // výška sticky headeru (px) — pro sticky label uvnitř dne
const TIME_COL_W = 72;          // šířka sloupce s časy (px)
const MACHINE_GAP_W = 10;       // šířka neutrálního mezisloupce mezi stroji (px)
const VIEW_DAYS_BACK = 3;
const VIEW_DAYS_AHEAD = 30;

const WORK_START_H = 6;
const WORK_END_H = 22;
const MACHINES = ["XL_105", "XL_106"] as const;
const SLOT_MS = 30 * 60 * 1000;
const DRAG_THRESHOLD = 5;

// ─── Typy ─────────────────────────────────────────────────────────────────────
export type Block = {
  id: number;
  orderNumber: string;
  machine: string;
  startTime: string;
  endTime: string;
  type: string;
  description: string | null;
  locked: boolean;
  deadlineExpedice: string | null;
  // Výrobní sloupečky — DATA
  dataStatusId: number | null;
  dataStatusLabel: string | null;
  dataRequiredDate: string | null;
  dataOk: boolean;
  // Výrobní sloupečky — MATERIÁL
  materialStatusId: number | null;
  materialStatusLabel: string | null;
  materialRequiredDate: string | null;
  materialOk: boolean;
  // Výrobní sloupečky — BARVY
  barvyStatusId: number | null;
  barvyStatusLabel: string | null;
  // Výrobní sloupečky — LAK
  lakStatusId: number | null;
  lakStatusLabel: string | null;
  // Výrobní sloupečky — SPECIFIKACE
  specifikace: string | null;
  recurrenceType: string;
  recurrenceParentId: number | null;
  printCompletedAt: string | null;
  printCompletedByUserId: number | null;
  printCompletedByUsername: string | null;
  createdAt: string;
  updatedAt: string;
};

type BlockedOverlay = {
  top: number;
  height: number;
  key: string;
  date: Date;
  machine: string;
  overlayType: "start-block" | "end-block" | "full-block";
  effectiveStartHour: number;
  effectiveEndHour: number;
  isException: boolean;
  exceptionId: number | null;
};

type OverlayDragPreview = {
  machine: string;
  date: Date;
  edge: "start" | "end";
  hour: number;
} | null;

type DragInternalState =
  | {
      type: "move" | "resize";
      blockId: number;
      originalMachine: string;
      startClientY: number;
      startClientX: number;
      originalStart: Date;
      originalEnd: Date;
    }
  | {
      type: "multi-move";
      blocks: Array<{ id: number; machine: string; originalStart: Date; originalEnd: Date }>;
      startClientY: number;
      startClientX: number;
      anchorBlockId: number;
    }
  | {
      type: "overlay-resize";
      machine: string;
      date: Date;
      edge: "start" | "end";
      originalBoundaryHour: number;
      otherBoundaryHour: number;
      startClientY: number;
    };

type DragPreview = {
  blockId: number;
  top: number;
  height: number;
  machine: string;
} | null;

type ContextMenuState = {
  x: number;
  y: number;
  block: Block;
  splitAt: Date;
} | null;

interface TimelineGridProps {
  blocks: Block[];
  filterText: string;
  selectedBlockId: number | null;
  onBlockClick: (block: Block) => void;
  onBlockUpdate: (updatedBlock: Block, addToHistory?: boolean) => void;
  onBlockCreate: (newBlock: Block) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  queueDragItem?: { id: number; durationHours: number; type: string } | null;
  onQueueDrop?: (itemId: number, machine: string, startTime: Date) => void;
  onBlockDoubleClick?: (block: Block) => void;
  companyDays?: CompanyDay[];
  slotHeight?: number;
  daysAhead?: number;
  daysBack?: number;
  copiedBlockId?: number | null;
  onGridClick?: (machine: string, time: Date) => void;
  onBlockCopy?: (block: Block) => void;
  selectedBlockIds?: Set<number>;
  onMultiSelect?: (ids: Set<number>) => void;
  onMultiBlockUpdate?: (updates: { id: number; startTime: Date; endTime: Date; machine: string }[]) => void;
  canEdit?: boolean;
  canEditData?: boolean;
  canEditMat?: boolean;
  onError?: (msg: string) => void;
  workingTimeLock?: boolean;
  badgeColorMap?: Record<number, string | null>;
  machineWorkHours?: MachineWorkHours[];
  machineExceptions?: MachineScheduleException[];
  onExceptionUpsert?: (machine: string, date: Date, startHour: number, endHour: number, isActive: boolean) => Promise<void>;
  onExceptionDelete?: (id: number) => Promise<void>;
}

type QueueDropPreview = {
  machine: string;
  top: number;
  height: number;
  jobType: string;
} | null;


// ─── CompanyDay typ ────────────────────────────────────────────────────────────
export type CompanyDay = {
  id: number;
  startDate: string;
  endDate: string;
  label: string;
  machine?: string | null;
  createdAt: string;
};

// ─── České státní svátky ──────────────────────────────────────────────────────
function easterDate(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function czechHolidaySet(year: number): Set<string> {
  const s = new Set([
    `${year}-01-01`, `${year}-05-01`, `${year}-05-08`,
    `${year}-07-05`, `${year}-07-06`, `${year}-09-28`,
    `${year}-10-28`, `${year}-11-17`,
    `${year}-12-24`, `${year}-12-25`, `${year}-12-26`,
  ]);
  const easter = easterDate(year);
  const goodFriday = new Date(easter); goodFriday.setDate(easter.getDate() - 2);
  const easterMon  = new Date(easter); easterMon.setDate(easter.getDate() + 1);
  s.add(localDateStr(goodFriday));
  s.add(localDateStr(easterMon));
  return s;
}

// XL_105: 2 směny (6–14, 14–22), noční neprovozuje → weekend Pá 22:00–Po 06:00
// XL_106: 3 směny = 24h provoz → weekend Pá 22:00–Ne 22:00

// ─── Pomocné funkce ────────────────────────────────────────────────────────────
function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function dateToY(date: Date, viewStart: Date, slotHeight = SLOT_HEIGHT): number {
  const diffMs = date.getTime() - viewStart.getTime();
  return (diffMs / 60000 / 30) * slotHeight;
}

function yToDate(y: number, viewStart: Date, slotHeight = SLOT_HEIGHT): Date {
  const minutes = (y / slotHeight) * 30;
  return new Date(viewStart.getTime() + minutes * 60000);
}

function snapToSlot(date: Date): Date {
  const ms = date.getTime();
  return new Date(Math.round(ms / SLOT_MS) * SLOT_MS);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const MONTH_ABBR = ["Led","Úno","Bře","Dub","Kvě","Čvn","Čvc","Srp","Zář","Říj","Lis","Pro"];
const DAY_ABBR   = ["Ne","Po","Út","St","Čt","Pá","So"];

// ─── BlockCard ─────────────────────────────────────────────────────────────────
// ─── Vizuální config bloků ─────────────────────────────────────────────────────
const BLOCK_STYLES: Record<string, {
  gradient: string; border: string; accentBar: string;
  leftBg: string; textPrimary: string; textSub: string; glow: string;
}> = {
  ZAKAZKA: {
    gradient:    "linear-gradient(160deg, rgba(59,130,246,0.95) 0%, rgba(37,99,235,0.88) 100%)",
    border:      "rgba(59,130,246,0.65)",
    accentBar:   "#3b82f6",
    leftBg:      "rgba(59,130,246,0.14)",
    textPrimary: "#ffffff",
    textSub:     "#ffffff",
    glow:        "rgba(59,130,246,0.35)",
  },
  REZERVACE: {
    gradient:    "linear-gradient(160deg, rgba(102,0,153,0.95) 0%, rgba(77,0,115,0.88) 100%)",
    border:      "rgba(102,0,153,0.65)",
    accentBar:   "#660099",
    leftBg:      "rgba(102,0,153,0.14)",
    textPrimary: "#ffffff",
    textSub:     "#ffffff",
    glow:        "rgba(102,0,153,0.35)",
  },
  UDRZBA: {
    gradient:    "linear-gradient(160deg, rgba(34,197,94,0.95) 0%, rgba(22,163,74,0.88) 100%)",
    border:      "rgba(34,197,94,0.65)",
    accentBar:   "#22c55e",
    leftBg:      "rgba(34,197,94,0.14)",
    textPrimary: "#ffffff",
    textSub:     "#ffffff",
    glow:        "rgba(34,197,94,0.32)",
  },
};
const BLOCK_OVERDUE = {
  gradient:    "linear-gradient(160deg, rgba(100,116,139,0.16) 0%, rgba(71,85,105,0.10) 100%)",
  border:      "rgba(100,116,139,0.26)",
  accentBar:   "rgba(100,116,139,0.60)",
  leftBg:      "rgba(100,116,139,0.08)",
  textPrimary: "var(--text-muted)",
  textSub:     "var(--text-muted)",
  glow:        "transparent",
};
const BLOCK_PRINT_DONE = {
  gradient:    "linear-gradient(160deg, rgba(34,197,94,0.15) 0%, rgba(34,197,94,0.08) 100%)",
  border:      "rgba(34,197,94,0.30)",
  accentBar:   "rgba(34,197,94,0.70)",
  leftBg:      "rgba(34,197,94,0.08)",
  textPrimary: "var(--text)",
  textSub:     "var(--text-muted)",
  glow:        "rgba(34,197,94,0.15)",
};
const BLOCK_DEFAULT = {
  gradient:    "linear-gradient(160deg, rgba(148,163,184,0.12) 0%, rgba(100,116,139,0.08) 100%)",
  border:      "var(--border)",
  accentBar:   "color-mix(in oklab, var(--text-muted) 70%, var(--text-muted))",
  leftBg:      "rgba(148,163,184,0.08)",
  textPrimary: "var(--text)",
  textSub:     "var(--text-muted)",
  glow:        "transparent",
};

// ─── Pomocná funkce — bezpečný parse data z DB (ISO timestamp i date string) ──
function fmtDate(s: string | null | undefined): string {
  if (!s) return "–";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// Zkrácený formát bez roku: "5.1."
function fmtDateShort(s: string | null | undefined): string {
  if (!s) return "–";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "–";
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

function deadlineState(requiredDate: string | null | undefined, ok: boolean, now: Date, blockStartTime?: string | Date): "none" | "ok" | "warning" | "danger" | "earlyStart" {
  if (!requiredDate) return "none";
  if (ok) return "ok";
  const due = new Date(requiredDate);
  if (isNaN(due.getTime())) return "none";
  // Blok startuje dříve než dorazí materiál/data
  if (blockStartTime) {
    const start = new Date(blockStartTime);
    if (!isNaN(start.getTime()) && startOfDay(start).getTime() < startOfDay(due).getTime()) return "earlyStart";
  }
  if (isSameDay(due, now)) return "warning";
  if (startOfDay(now).getTime() > startOfDay(due).getTime()) return "danger";
  return "none";
}

function tint(color: string, percent: number): string {
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`;
}

const FIELD_ACCENT = {
  DATA:     "color-mix(in oklab, #0ea5e9 78%, var(--text) 22%)",  // tyrkysová — data
  MATERIAL: "color-mix(in oklab, #22c55e 78%, var(--text) 22%)",  // zelená — materiál
  EXPEDICE: "color-mix(in oklab, #f97316 78%, var(--text) 22%)",  // oranžová — expedice
};

// Deadline barvy jako tokeny — použito v DateBadge
const DEADLINE_BG: Record<string, string> = {
  ok:         "color-mix(in oklab, var(--success) 85%, black 15%)",
  danger:     "color-mix(in oklab, var(--danger) 85%, black 15%)",
  warning:    "color-mix(in oklab, var(--warning) 75%, black 25%)",
  earlyStart: "color-mix(in oklab, #f97316 85%, black 15%)",
  empty:      "rgba(255,255,255,0.12)",
  neutral:    "rgba(255,255,255,0.18)",
};
const DEADLINE_BORDER: Record<string, string> = {
  ok:         "color-mix(in oklab, var(--success) 70%, black 30%)",
  danger:     "color-mix(in oklab, var(--danger) 70%, black 30%)",
  warning:    "color-mix(in oklab, var(--warning) 60%, black 40%)",
  earlyStart: "color-mix(in oklab, #f97316 70%, black 30%)",
  empty:      "rgba(255,255,255,0.20)",
  neutral:    "rgba(255,255,255,0.30)",
};

// Deadline strong barvy pro tečky/ikonky — module level (eliminace duplicity)
const SUCCESS_STRONG     = "color-mix(in oklab, var(--success) 85%, var(--text) 15%)";
const WARNING_STRONG     = "color-mix(in oklab, var(--warning) 78%, var(--text) 22%)";
const DANGER_STRONG      = "color-mix(in oklab, var(--danger) 80%, var(--text) 20%)";
const EARLY_START_STRONG = "color-mix(in oklab, #f97316 85%, var(--text))";

// Chip bg/border pro mini D/M/E datum chipy — lehčí verze DEADLINE_BG/BORDER
function chipStateBg(stateKey: string): string {
  if (stateKey === "ok")         return "color-mix(in oklab, var(--success) 22%, transparent)";
  if (stateKey === "danger")     return "color-mix(in oklab, var(--danger) 25%, transparent)";
  if (stateKey === "warning")    return "color-mix(in oklab, var(--warning) 22%, transparent)";
  if (stateKey === "earlyStart") return "color-mix(in oklab, #f97316 22%, transparent)";
  return "rgba(255,255,255,0.08)";
}
function chipStateBorder(stateKey: string): string {
  if (stateKey === "ok")         return "color-mix(in oklab, var(--success) 50%, transparent)";
  if (stateKey === "danger")     return "color-mix(in oklab, var(--danger) 55%, transparent)";
  if (stateKey === "warning")    return "color-mix(in oklab, var(--warning) 50%, transparent)";
  if (stateKey === "earlyStart") return "color-mix(in oklab, #f97316 50%, transparent)";
  return "rgba(255,255,255,0.20)";
}

const MONTH_NAMES_TG = ["Leden","Únor","Březen","Duben","Květen","Červen","Červenec","Srpen","Září","Říjen","Listopad","Prosinec"];
const DAY_NAMES_TG   = ["Po","Út","St","Čt","Pá","So","Ne"];

// ─── InlineDatePicker — floating calendar pro dvojklik na badge ───────────────
function InlineDatePicker({
  x, y, currentValue, onPick, onClose,
}: {
  x: number; y: number; currentValue: string; onPick: (dateStr: string) => void; onClose: () => void;
}) {
  const today = new Date();
  const safeDate = currentValue ? currentValue.slice(0, 10) : "";
  const initial = safeDate ? new Date(safeDate + "T00:00:00") : today;
  const [viewYear,  setViewYear]  = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const selected = safeDate ? new Date(safeDate + "T00:00:00") : null;

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1);
  }
  function toStr(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  const firstDow = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const CELL = 30; const GAP = 2;
  const popW = 7 * CELL + 6 * GAP + 24;

  // Adjust to stay on screen
  const left = Math.min(x, window.innerWidth - popW - 8);
  const top  = y + 4;

  return (
    <>
      {/* Transparent overlay to catch outside clicks */}
      <div style={{ position: "fixed", inset: 0, zIndex: 9998 }} onMouseDown={onClose} />
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: "fixed", left, top, zIndex: 9999,
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
          padding: "12px 12px 10px",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <button onClick={prevMonth} style={{ width: 24, height: 24, borderRadius: 6, border: "none", background: "var(--surface-2)", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{MONTH_NAMES_TG[viewMonth]} {viewYear}</span>
          <button onClick={nextMonth} style={{ width: 24, height: 24, borderRadius: 6, border: "none", background: "var(--surface-2)", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        {/* Day headers */}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${CELL}px)`, gap: GAP, marginBottom: 2 }}>
          {DAY_NAMES_TG.map(d => (
            <div key={d} style={{ textAlign: "center", fontSize: 9, fontWeight: 600, color: "var(--text-muted)" }}>{d}</div>
          ))}
        </div>
        {/* Day cells */}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${CELL}px)`, gap: GAP }}>
          {cells.map((day, i) => {
            if (!day) return <div key={i} style={{ width: CELL, height: CELL }} />;
            const isSelected = !!selected && selected.getDate() === day && selected.getMonth() === viewMonth && selected.getFullYear() === viewYear;
            const isToday    = today.getDate() === day && today.getMonth() === viewMonth && today.getFullYear() === viewYear;
            return (
              <button key={i}
                onClick={() => { onPick(toStr(new Date(viewYear, viewMonth, day))); }}
                style={{
                  width: CELL, height: CELL, borderRadius: "50%",
                  background: isSelected ? "#3b82f6" : isToday && !isSelected ? "rgba(59,130,246,0.15)" : "transparent",
                  color: isSelected ? "#fff" : isToday ? "#3b82f6" : "var(--text)",
                  border: isToday ? "1.5px solid #3b82f6" : "1.5px solid transparent",
                  fontSize: 11, fontWeight: isSelected || isToday ? 700 : 400,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "background 100ms ease-out",
                }}
              >{day}</button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── DateBadge — klikatelná kolonka s datem + toggle OK ───────────────────────
function DateBadge({
  label, dateStr, ok, warn, danger, earlyStart, accent, onToggle, onDoubleClick,
}: {
  label: string; dateStr: string | null; ok: boolean; warn: boolean; danger: boolean; earlyStart?: boolean; accent?: string; onToggle: () => void; onDoubleClick?: (rect: DOMRect) => void;
}) {
  const [loading, setLoading] = useState(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const empty = !dateStr;
  const fmt = dateStr ? fmtDate(dateStr) : "—";

  const neutralAccent = accent ?? "var(--text-muted)";
  const stateKey = empty ? "empty" : ok ? "ok" : danger ? "danger" : warn ? "warning" : earlyStart ? "earlyStart" : "neutral";
  const bg          = DEADLINE_BG[stateKey];
  const borderColor = DEADLINE_BORDER[stateKey];
  const labelColor  = empty ? "var(--text-muted)" : "rgba(255,255,255,0.90)";
  const dateColor   = empty ? "var(--text-muted)" : "#fff";

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (empty || loading) return;
    if (onDoubleClick) {
      // Odložit toggle — zruší se pokud přijde dblclick dřív než timeout
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(async () => {
        clickTimerRef.current = null;
        setLoading(true);
        onToggle();
        setLoading(false);
      }, 220);
    } else {
      setLoading(true);
      onToggle();
      setLoading(false);
    }
  }

  function handleDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    // Zruš případný čekající single-click toggle
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
    if (onDoubleClick) onDoubleClick(e.currentTarget.getBoundingClientRect());
  }

  return (
    <div
      onClick={handleClick}
      onDoubleClick={onDoubleClick ? handleDoubleClick : undefined}
      style={{
        display: "flex", flexDirection: "column", gap: 2,
        padding: "5px 9px 5px 8px", borderRadius: 5,
        background: bg, border: `1px solid ${borderColor}`,
        borderLeft: `2px solid ${neutralAccent}`,
        cursor: empty ? "default" : "pointer", flex: "0 0 auto",
        transition: "all 0.12s", opacity: loading ? 0.6 : 1,
      }}
    >
      <span style={{ fontSize: 8, fontWeight: 700, color: labelColor, lineHeight: 1, letterSpacing: "0.07em" }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: dateColor, lineHeight: 1 }}>{fmt}</span>
        {!empty && (
          <span style={{ fontSize: 10, lineHeight: 1, color: empty ? "var(--text-muted)" : "rgba(255,255,255,0.80)" }}
                title={earlyStart ? "Start zakázky před dodáním" : undefined}>
            {ok ? "✓" : danger ? "‼" : warn ? "!" : earlyStart ? "⚠" : "·"}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── MiniChip — malý chip vpravo nahoře v bloku ───────────────────────────────
// Přepsání barvy textu pro konkrétní klíče (světlé → tmavý text, tmavé → světlý text)
// Všechny badge barvy mají pevný kontrastní text (bílý nebo černý)
const BADGE_TEXT_OVERRIDES: Record<string, string> = {
  blue:   "#111",
  green:  "#111",
  orange: "#111",
  red:    "#111",
  purple: "#111",
  cyan:   "#111",
  lime:   "#111",
  pink:   "#111",
  black:  "#fff",
};

function chipTextColor(colorKey: string | null | undefined): string | null {
  if (!colorKey) return null;
  return BADGE_TEXT_OVERRIDES[colorKey] ?? null;
}

function MiniChip({ label, accent, textColor }: { label: string; accent: string; textColor?: string }) {
  const tc = textColor ?? accent;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, color: tc, lineHeight: 1.5,
      background: tint(accent, 85), border: `1px solid ${tint(accent, 100)}`,
      borderRadius: 3, padding: "1px 5px", whiteSpace: "nowrap",
      display: "block",
    }}>
      {label}
    </span>
  );
}

// ─── BlockCard ─────────────────────────────────────────────────────────────────
function BlockCard({
  block, top, height, dimmed, selected, isDragging, isCopied, multiSelected, now,
  onClick, onDoubleClick, onMouseDown, onResizeMouseDown, onContextMenu, onBlockUpdate, onError,
  canEditData, canEditMat, onInlineDatePick, badgeColorMap,
}: {
  block: Block;
  top: number;
  height: number;
  dimmed: boolean;
  selected: boolean;
  isDragging: boolean;
  isCopied: boolean;
  multiSelected: boolean;
  now: Date;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onResizeMouseDown?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onBlockUpdate: (b: Block) => void;
  onError?: (msg: string) => void;
  canEditData?: boolean;
  canEditMat?: boolean;
  onInlineDatePick?: (blockId: number, field: "data" | "material", currentValue: string, rect: DOMRect) => void;
  badgeColorMap?: Record<number, string | null>;
}) {
  const [resizeHovered, setResizeHovered] = useState(false);
  const [hovered, setHovered]             = useState(false);

  const isPrintDone  = block.printCompletedAt != null;
  const isOverdue    = block.type !== "UDRZBA" && new Date(block.endTime) < now && !isPrintDone;
  const clampedHeight = Math.max(height, 20);

  const dataDeadlineState = deadlineState(block.dataRequiredDate, block.dataOk, now, block.startTime);
  const materialDeadlineState = deadlineState(block.materialRequiredDate, block.materialOk, now, block.startTime);

  const s = isPrintDone
    ? BLOCK_PRINT_DONE
    : isOverdue
    ? BLOCK_OVERDUE
    : (BLOCK_STYLES[block.type] ?? BLOCK_DEFAULT);

  // Badge accenty — custom barva z číselníku, fallback na dnešní chování per-field
  const dataKey    = block.dataStatusId     ? (badgeColorMap?.[block.dataStatusId]     ?? null) : null;
  const matKey     = block.materialStatusId ? (badgeColorMap?.[block.materialStatusId]  ?? null) : null;
  const barvyKey   = block.barvyStatusId    ? (badgeColorMap?.[block.barvyStatusId]     ?? null) : null;
  const lakKey     = block.lakStatusId      ? (badgeColorMap?.[block.lakStatusId]       ?? null) : null;
  const dataAccent    = (dataKey    ? badgeColorVar(dataKey)    : null) ?? s.accentBar;
  const matAccent     = (matKey     ? badgeColorVar(matKey)     : null) ?? s.textSub;
  const barvyAccent   = (barvyKey   ? badgeColorVar(barvyKey)   : null) ?? "var(--text-muted)";
  const lakAccent     = (lakKey     ? badgeColorVar(lakKey)     : null) ?? "var(--text-muted)";
  const dataText    = chipTextColor(dataKey);
  const matText     = chipTextColor(matKey);
  const barvyText   = chipTextColor(barvyKey);
  const lakText     = chipTextColor(lakKey);

  const hasNoteRow = (block.dataStatusLabel || block.materialStatusLabel || block.barvyStatusLabel || block.lakStatusLabel || block.specifikace);

  // Výškové mody (vzájemně se vylučují)
  const MODE_FULL    = clampedHeight >= 70;                              // plný layout
  const MODE_COMPACT = !MODE_FULL && clampedHeight >= 44 && block.type !== "UDRZBA";
  const MODE_TINY    = !MODE_FULL && !MODE_COMPACT && clampedHeight >= 24; // micro tečky
  // Výškové prahy pro FULL mode
  const showDates  = MODE_FULL;           // 2. řádek — date badges
  const showSpec   = clampedHeight >= 70;  // 3. řádek — specifikace (od FULL modu)
  const showDesc   = MODE_FULL && clampedHeight >= 44; // popis za číslem zakázky
  // Počet řádků popisu — roste s výškou bloku (13px/řádek, od ~55px výšky)
  const descLineClamp = Math.max(2, Math.floor((clampedHeight - 55) / 13));

  const opacity = dimmed ? 0.12 : isDragging ? 0.72 : 1;
  const glow = s.glow;
  const shadow  = selected
    ? "0 0 0 1.5px #FFE600, 0 4px 16px rgba(0,0,0,0.6)"
    : multiSelected
      ? "0 0 0 2px rgba(59,130,246,0.7), 0 4px 16px rgba(0,0,0,0.5)"
      : hovered && !isDragging
        ? `0 6px 24px rgba(0,0,0,0.55), 0 0 16px ${glow}, inset 0 1px 0 rgba(255,255,255,0.08)`
        : `0 2px 8px rgba(0,0,0,0.35), 0 0 10px ${glow}, inset 0 1px 0 rgba(255,255,255,0.05)`;

  async function toggleField(field: "dataOk" | "materialOk", current: boolean) {
    try {
      const res = await fetch(`/api/blocks/${block.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !current }),
      });
      if (res.ok) onBlockUpdate(await res.json());
    } catch (error) {
      console.error("Block field toggle failed", error);
      onError?.("Změnu sloupce se nepodařilo uložit.");
    }
  }

  return (
    <div
      data-block="true"
      onMouseDown={block.locked ? undefined : onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
      onContextMenu={onContextMenu}
      style={{
        position: "absolute", top, height: clampedHeight, left: 3,
        width: "calc(100% - 6px)",
        zIndex: isDragging ? 20 : resizeHovered ? 15 : hovered ? 5 : 1,
        cursor: block.locked ? "default" : isDragging ? "grabbing" : "grab",
        opacity, borderRadius: 7,
        border: isCopied ? "1.5px dashed #3b82f6" : multiSelected ? "1.5px solid rgba(59,130,246,0.8)" : `1px solid ${selected ? "#FFE600" : s.border}`,
        outline: isCopied ? "1px solid rgba(59,130,246,0.3)" : undefined,
        outlineOffset: isCopied ? "2px" : undefined,
        boxShadow: shadow,
        background: s.gradient,
        display: "flex", flexDirection: "column",
        overflow: "hidden", userSelect: "none",
        transition: isDragging ? "none" : "box-shadow 0.15s",
        animationName: "blockEnter",
        animationDuration: "220ms",
        animationTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        animationFillMode: "backwards",
      }}
    >
      {/* Levý barevný pruh — iOS Calendar style */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: s.accentBar, opacity: isOverdue ? 0.4 : 1, borderRadius: "7px 0 0 7px", flexShrink: 0 }} />


      {/* ── MODE_COMPACT: 2 řádky — [datumy horiz. + chips] / [číslo + popis] ── */}
      {MODE_COMPACT && (() => {
        const dStateKey = dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
        const mStateKey = materialDeadlineState === "none" ? "neutral" : materialDeadlineState;
        const dClr = dataDeadlineState === "ok" ? SUCCESS_STRONG : dataDeadlineState === "danger" ? DANGER_STRONG : dataDeadlineState === "warning" ? WARNING_STRONG : dataDeadlineState === "earlyStart" ? EARLY_START_STRONG : FIELD_ACCENT.DATA;
        const mClr = materialDeadlineState === "ok" ? SUCCESS_STRONG : materialDeadlineState === "danger" ? DANGER_STRONG : materialDeadlineState === "warning" ? WARNING_STRONG : materialDeadlineState === "earlyStart" ? EARLY_START_STRONG : FIELD_ACCENT.MATERIAL;
        const eClr = FIELD_ACCENT.EXPEDICE;
        const dateChip = (clr: string, stateKey: string, fieldAccent: string): React.CSSProperties => ({
          fontSize: 10, fontWeight: 600, color: clr,
          background: chipStateBg(stateKey),
          border: `1px solid ${chipStateBorder(stateKey)}`,
          borderLeft: `2px solid ${fieldAccent}`,
          borderRadius: 4, padding: "2px 6px 2px 5px",
          whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1, cursor: "pointer",
        });
        const dIcon = dataDeadlineState === "ok" ? " ✓" : dataDeadlineState === "danger" ? " ✕" : dataDeadlineState === "warning" ? " !" : dataDeadlineState === "earlyStart" ? " ⚠" : "";
        const mIcon = materialDeadlineState === "ok" ? " ✓" : materialDeadlineState === "danger" ? " ✕" : materialDeadlineState === "warning" ? " !" : materialDeadlineState === "earlyStart" ? " ⚠" : "";
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 8px", flex: 1, overflow: "hidden", minHeight: 0 }}>
            {/* Levá část: datumy + separator + číslo + popis */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, overflow: "hidden" }}>
              <span style={dateChip(dClr, dStateKey, FIELD_ACCENT.DATA)} title={dataDeadlineState === "earlyStart" ? "Start zakázky před dodáním dat" : undefined} onClick={block.dataRequiredDate ? (e) => { e.stopPropagation(); toggleField("dataOk", block.dataOk); } : undefined}>
                D&nbsp;{block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}
              </span>
              <span style={dateChip(mClr, mStateKey, FIELD_ACCENT.MATERIAL)} title={materialDeadlineState === "earlyStart" ? "Start zakázky před dodáním materiálu" : undefined} onClick={block.materialRequiredDate ? (e) => { e.stopPropagation(); toggleField("materialOk", block.materialOk); } : undefined}>
                M&nbsp;{block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${mIcon}` : "—"}
              </span>
              <span style={{ ...dateChip(eClr, "neutral", FIELD_ACCENT.EXPEDICE), cursor: "default" }}>
                E&nbsp;{block.deadlineExpedice ? fmtDateShort(block.deadlineExpedice) : "—"}
              </span>
              <div style={{ width: 1, height: 12, background: "var(--border)", flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: s.textPrimary, whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1 }}>
                {block.orderNumber}{block.locked && <span style={{ marginLeft: 2, fontSize: 9, opacity: 0.6 }}>🔒</span>}
                {isPrintDone && <span style={{ marginLeft: 4, fontSize: 9, color: "#22c55e", fontWeight: 700 }}>✓</span>}
                {isOverdue && !isPrintDone && block.type === "ZAKAZKA" && <span style={{ marginLeft: 4, fontSize: 9, color: "#f59e0b" }}>⏳</span>}
              </span>
              {(block.description || block.specifikace) && (
                <span style={{ display: "flex", alignItems: "baseline", gap: 3, flex: 1, minWidth: 0, overflow: "hidden" }}>
                  {block.description && (
                    <span style={{ fontSize: 9, fontWeight: 400, color: s.textSub, opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1, flexShrink: 1 }}>
                      {block.description}
                    </span>
                  )}
                  {block.specifikace && (
                    <span style={{ fontSize: 9, fontStyle: "italic", color: "var(--text-muted)", opacity: 0.72, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1, flexShrink: 2, minWidth: 0 }}>
                      {block.description ? "· " : ""}{block.specifikace}
                    </span>
                  )}
                </span>
              )}
            </div>
            {/* Pravá část: status chips + série */}
            {(hasNoteRow || block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
              <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
                {block.dataStatusLabel     && <MiniChip label={block.dataStatusLabel}     accent={dataAccent}  textColor={dataText  ?? undefined} />}
                {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={matAccent}   textColor={matText   ?? undefined} />}
                {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent={barvyAccent} textColor={barvyText ?? undefined} />}
                {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent={lakAccent}   textColor={lakText   ?? undefined} />}
                {(block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                  <span style={{ fontSize: 8, opacity: 0.4, color: s.textSub, flexShrink: 0 }}>↻</span>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── MODE_TINY: jednořádkový layout — [D chip] [M chip] [E chip] | číslo popis ── */}
      {MODE_TINY && (() => {
        const dStateKey = dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
        const mStateKey = materialDeadlineState === "none" ? "neutral" : materialDeadlineState;
        const dClr = dataDeadlineState === "ok" ? SUCCESS_STRONG : dataDeadlineState === "danger" ? DANGER_STRONG : dataDeadlineState === "warning" ? WARNING_STRONG : dataDeadlineState === "earlyStart" ? EARLY_START_STRONG : FIELD_ACCENT.DATA;
        const mClr = materialDeadlineState === "ok" ? SUCCESS_STRONG : materialDeadlineState === "danger" ? DANGER_STRONG : materialDeadlineState === "warning" ? WARNING_STRONG : materialDeadlineState === "earlyStart" ? EARLY_START_STRONG : FIELD_ACCENT.MATERIAL;
        const eClr = FIELD_ACCENT.EXPEDICE;
        const chipStyle = (clr: string, stateKey: string, fieldAccent: string): React.CSSProperties => ({
          fontSize: 9, fontWeight: 600, color: clr,
          background: chipStateBg(stateKey),
          border: `1px solid ${chipStateBorder(stateKey)}`,
          borderLeft: `2px solid ${fieldAccent}`,
          borderRadius: 3, padding: "1px 5px 1px 4px",
          whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1,
        });
        const dIcon = dataDeadlineState === "ok" ? " ✓" : dataDeadlineState === "danger" ? " ✕" : dataDeadlineState === "warning" ? " !" : dataDeadlineState === "earlyStart" ? " ⚠" : "";
        const mIcon = materialDeadlineState === "ok" ? " ✓" : materialDeadlineState === "danger" ? " ✕" : materialDeadlineState === "warning" ? " !" : materialDeadlineState === "earlyStart" ? " ⚠" : "";
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 8px", flex: 1, overflow: "hidden", minHeight: 0 }}>
            {/* Levá část: datum chips + číslo + popis */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, overflow: "hidden" }}>
              {block.type !== "UDRZBA" && <>
                <span style={chipStyle(dClr, dStateKey, FIELD_ACCENT.DATA)} title={dataDeadlineState === "earlyStart" ? "Start zakázky před dodáním dat" : undefined} onClick={block.dataRequiredDate ? (e) => { e.stopPropagation(); toggleField("dataOk", block.dataOk); } : undefined}>
                  D&nbsp;{block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}
                </span>
                <span style={chipStyle(mClr, mStateKey, FIELD_ACCENT.MATERIAL)} title={materialDeadlineState === "earlyStart" ? "Start zakázky před dodáním materiálu" : undefined} onClick={block.materialRequiredDate ? (e) => { e.stopPropagation(); toggleField("materialOk", block.materialOk); } : undefined}>
                  M&nbsp;{block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${mIcon}` : "—"}
                </span>
                <span style={{ ...chipStyle(eClr, "neutral", FIELD_ACCENT.EXPEDICE), cursor: "default" }}>
                  E&nbsp;{block.deadlineExpedice ? fmtDateShort(block.deadlineExpedice) : "—"}
                </span>
                <div style={{ width: 1, height: 10, background: "var(--border)", flexShrink: 0 }} />
              </>}
              <span style={{ fontSize: 10, fontWeight: 700, color: s.textPrimary, whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1 }}>
                {block.orderNumber}{block.locked && <span style={{ marginLeft: 2, fontSize: 8, opacity: 0.6 }}>🔒</span>}
              </span>
              {(block.description || block.specifikace) && (
                <span style={{ display: "flex", alignItems: "baseline", gap: 3, flex: 1, minWidth: 0, overflow: "hidden" }}>
                  {block.description && (
                    <span style={{ fontSize: 9, fontWeight: 400, color: s.textSub, opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1, flexShrink: 1 }}>
                      {block.description}
                    </span>
                  )}
                  {block.specifikace && (
                    <span style={{ fontSize: 9, fontStyle: "italic", color: "var(--text-muted)", opacity: 0.72, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1, flexShrink: 2, minWidth: 0 }}>
                      {block.description ? "· " : ""}{block.specifikace}
                    </span>
                  )}
                </span>
              )}
            </div>
            {/* Pravá část: status chips + série */}
            {(hasNoteRow || block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
              <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
                {block.dataStatusLabel     && <MiniChip label={block.dataStatusLabel}     accent={dataAccent}  textColor={dataText  ?? undefined} />}
                {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={matAccent}   textColor={matText   ?? undefined} />}
                {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent={barvyAccent} textColor={barvyText ?? undefined} />}
                {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent={lakAccent}   textColor={lakText   ?? undefined} />}
                {(block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                  <span style={{ fontSize: 8, opacity: 0.4, color: s.textSub, flexShrink: 0, lineHeight: 1 }}>↻</span>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Řádek 1: Číslo zakázky + popis + chips vpravo (FULL mode) ── */}
      {MODE_FULL && (
        <div style={{
          padding: "5px 9px 3px", display: "flex", alignItems: "flex-start",
          gap: 4, minWidth: 0, flexShrink: 0,
        }}>
          {/* Levá část: číslo + popis */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6, flex: 1, minWidth: 0, overflow: "hidden" }}>
            <span style={{
              fontSize: 12, fontWeight: 700, color: s.textPrimary,
              lineHeight: 1.2, flexShrink: 0, maxWidth: "60%",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {block.orderNumber}
              {block.locked && <span style={{ marginLeft: 3, fontSize: 9, opacity: 0.6 }}>🔒</span>}
            </span>
            {showDesc && block.description && (
              <span style={{
                fontSize: 10, fontWeight: 400, color: s.textSub, opacity: 0.75, lineHeight: 1.3,
                overflow: "hidden", display: "-webkit-box",
                WebkitLineClamp: descLineClamp, WebkitBoxOrient: "vertical",
                whiteSpace: "pre-wrap",
                flex: 1, minWidth: 0,
              }}>
                {block.description}
              </span>
            )}
          </div>
          {/* Pravá část: status chips + série */}
          {(hasNoteRow || block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
            <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
              {block.dataStatusLabel     && <MiniChip label={block.dataStatusLabel}     accent={dataAccent}  textColor={dataText  ?? undefined} />}
              {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={matAccent}   textColor={matText   ?? undefined} />}
              {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent={barvyAccent} textColor={barvyText ?? undefined} />}
              {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent={lakAccent}   textColor={lakText   ?? undefined} />}
              {(block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                <span style={{ fontSize: 8, opacity: 0.4, color: s.textSub }}>↻</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Řádek 2: Klikatelné date badges (FULL mode) — vždy všechny 3 ── */}
      {showDates && block.type !== "UDRZBA" && (
        <div style={{
          padding: "2px 7px 3px", display: "flex", gap: 5, flexWrap: "nowrap",
          flexShrink: 0,
        }}>
          <DateBadge
            label="DATA" dateStr={block.dataRequiredDate}
            ok={dataDeadlineState === "ok"} warn={dataDeadlineState === "warning"} danger={dataDeadlineState === "danger"} earlyStart={dataDeadlineState === "earlyStart"}
            accent={FIELD_ACCENT.DATA}
            onToggle={() => toggleField("dataOk", block.dataOk)}
            onDoubleClick={canEditData ? (rect) => onInlineDatePick?.(block.id, "data", block.dataRequiredDate ?? "", rect) : undefined}
          />
          <DateBadge
            label="MAT." dateStr={block.materialRequiredDate}
            ok={materialDeadlineState === "ok"} warn={materialDeadlineState === "warning"} danger={materialDeadlineState === "danger"} earlyStart={materialDeadlineState === "earlyStart"}
            accent={FIELD_ACCENT.MATERIAL}
            onToggle={() => toggleField("materialOk", block.materialOk)}
            onDoubleClick={canEditMat ? (rect) => onInlineDatePick?.(block.id, "material", block.materialRequiredDate ?? "", rect) : undefined}
          />
          <DateBadge
            label="EXP." dateStr={block.deadlineExpedice}
            ok={false} warn={false} danger={false} accent={FIELD_ACCENT.EXPEDICE}
            onToggle={() => {}}
          />
        </div>
      )}

      {/* ── Řádek 3: Specifikace (celý text) ── */}
      {showSpec && block.specifikace && (
        <div style={{ padding: "0 9px 3px", flexShrink: 0 }}>
          <span style={{
            fontSize: 9, color: "var(--text-muted)", lineHeight: 1.3,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}>
            {block.specifikace}
          </span>
        </div>
      )}


      {/* Resize handle — rohový iOS-style */}
      {!block.locked && (
        <div
          onMouseEnter={() => setResizeHovered(true)}
          onMouseLeave={() => setResizeHovered(false)}
          onMouseDown={(e) => { e.stopPropagation(); onResizeMouseDown?.(e); }}
          style={{
            position: "absolute", bottom: 0, right: 0,
            width: 20, height: 20,
            cursor: "ns-resize",
            display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
            padding: 4,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
            style={{ opacity: resizeHovered ? 1 : 0.28, transition: "opacity 0.15s ease-out", flexShrink: 0 }}
          >
            <line x1="2" y1="11" x2="11" y2="2" stroke={s.textPrimary} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="6" y1="11" x2="11" y2="6" stroke={s.textPrimary} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="10" y1="11" x2="11" y2="10" stroke={s.textPrimary} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
}

// ─── TimelineGrid ──────────────────────────────────────────────────────────────
export default function TimelineGrid({
  blocks, filterText, selectedBlockId,
  onBlockClick, onBlockUpdate, onBlockCreate, scrollRef,
  queueDragItem, onQueueDrop, onBlockDoubleClick,
  companyDays,
  slotHeight = SLOT_HEIGHT,
  daysAhead,
  daysBack,
  copiedBlockId,
  onGridClick,
  onBlockCopy,
  selectedBlockIds,
  onMultiSelect,
  onMultiBlockUpdate,
  canEdit = true,
  canEditData = false,
  canEditMat = false,
  onError,
  workingTimeLock = true,
  badgeColorMap = {},
  machineWorkHours,
  machineExceptions,
  onExceptionUpsert,
  onExceptionDelete,
}: TimelineGridProps) {
  const effectiveDaysBack  = daysBack  ?? VIEW_DAYS_BACK;
  const effectiveDaysAhead = daysAhead ?? VIEW_DAYS_AHEAD;
  const totalDays  = effectiveDaysBack + effectiveDaysAhead + 1;
  const dayHeight  = slotHeight * 48;
  const totalHeight = totalDays * dayHeight;

  const [viewStart, setViewStart] = useState<Date | null>(null);
  const [now, setNow]             = useState<Date | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [queueDropPreview, setQueueDropPreview] = useState<QueueDropPreview>(null);
  const [lassoRect, setLassoRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [inlinePicker, setInlinePicker] = useState<{ blockId: number; field: "data" | "material"; currentValue: string; x: number; y: number } | null>(null);
  const [overlayDragPreview, setOverlayDragPreview] = useState<OverlayDragPreview>(null);
  const [hoveredOverlayKey, setHoveredOverlayKey] = useState<string | null>(null);

  const dragStateRef    = useRef<DragInternalState | null>(null);
  const dragDidMove     = useRef(false);
  const viewStartRef    = useRef<Date | null>(null);
  const slotHeightRef   = useRef(slotHeight);
  const colRefs         = useRef<(HTMLDivElement | null)[]>([null, null]);
  const callbacksRef    = useRef({ onBlockUpdate, onBlockCreate, onMultiSelect, onMultiBlockUpdate, onError });
  const lassoRef        = useRef<{ startClientX: number; startClientY: number; active: boolean } | null>(null);
  const lassoRectRef    = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const blocksRef       = useRef(blocks);
  const selectedBlockIdsRef = useRef(selectedBlockIds ?? new Set<number>());
  const workingTimeLockRef  = useRef(workingTimeLock);
  workingTimeLockRef.current = workingTimeLock;
  const machineWorkHoursRef = useRef(machineWorkHours);
  machineWorkHoursRef.current = machineWorkHours;
  const machineExceptionsRef = useRef(machineExceptions);
  machineExceptionsRef.current = machineExceptions;
  const exceptionCallbacksRef = useRef({ onExceptionUpsert, onExceptionDelete });
  exceptionCallbacksRef.current = { onExceptionUpsert, onExceptionDelete };

  useEffect(() => { slotHeightRef.current = slotHeight; }, [slotHeight]);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  useEffect(() => { selectedBlockIdsRef.current = selectedBlockIds ?? new Set<number>(); }, [selectedBlockIds]);

  useEffect(() => {
    callbacksRef.current = { onBlockUpdate, onBlockCreate, onMultiSelect, onMultiBlockUpdate, onError };
  }, [onBlockUpdate, onBlockCreate, onMultiSelect, onMultiBlockUpdate, onError]);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const start = startOfDay(addDays(new Date(), -effectiveDaysBack));
    setViewStart(start);
    viewStartRef.current = start;
  }, [effectiveDaysBack]); // eslint-disable-line

  // Scroll na aktuální čas pouze při prvním nastavení viewStart (ne při změně daysBack)
  const hasScrolledToNow = useRef(false);
  useEffect(() => {
    if (!viewStart || !scrollRef.current) return;
    if (hasScrolledToNow.current) return;
    hasScrolledToNow.current = true;
    const y = dateToY(new Date(), viewStart);
    scrollRef.current.scrollTop = Math.max(0, y - 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewStart]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function clientYToTimelineY(clientY: number): number {
    const el = scrollRef.current;
    if (!el) return 0;
    return clientY - el.getBoundingClientRect().top + el.scrollTop;
  }

  function clientXToMachine(clientX: number): string {
    for (let i = 0; i < MACHINES.length; i++) {
      const ref = colRefs.current[i];
      if (!ref) continue;
      const rect = ref.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) return MACHINES[i];
    }
    return MACHINES[0];
  }

  // ── Globální mouse listenery ───────────────────────────────────────────────
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      // ── Lasso pohyb ──
      if (lassoRef.current) {
        const dx = e.clientX - lassoRef.current.startClientX;
        const dy = e.clientY - lassoRef.current.startClientY;
        if (!lassoRef.current.active && Math.hypot(dx, dy) > 5) lassoRef.current.active = true;
        if (lassoRef.current.active) {
          const rect = {
            left: Math.min(e.clientX, lassoRef.current.startClientX),
            top:  Math.min(e.clientY, lassoRef.current.startClientY),
            width: Math.abs(dx),
            height: Math.abs(dy),
          };
          lassoRectRef.current = rect;
          setLassoRect(rect);
        }
        return;
      }

      const ds = dragStateRef.current;
      const vs = viewStartRef.current;
      if (!ds || !vs) return;

      const deltaY = e.clientY - ds.startClientY;
      const deltaX = "startClientX" in ds ? e.clientX - ds.startClientX : 0;
      if (Math.abs(deltaY) + Math.abs(deltaX) > DRAG_THRESHOLD) dragDidMove.current = true;

      const sh = slotHeightRef.current;
      if (ds.type === "move") {
        const originalTop    = dateToY(ds.originalStart, vs, sh);
        const originalHeight = dateToY(ds.originalEnd, vs, sh) - originalTop;
        const newMachine     = clientXToMachine(e.clientX);
        const snappedStart   = snapToSlot(yToDate(originalTop + deltaY, vs, sh));
        const snappedTop     = dateToY(snappedStart, vs, sh);
        setDragPreview({ blockId: ds.blockId, top: snappedTop, height: originalHeight, machine: newMachine });
      } else if (ds.type === "resize") {
        const originalTop    = dateToY(ds.originalStart, vs, sh);
        const originalHeight = dateToY(ds.originalEnd, vs, sh) - originalTop;
        const rawEnd         = yToDate(originalTop + Math.max(sh, originalHeight + deltaY), vs, sh);
        const snappedEnd     = snapToSlot(rawEnd);
        const snappedHeight  = Math.max(sh, dateToY(snappedEnd, vs, sh) - originalTop);
        setDragPreview({ blockId: ds.blockId, top: originalTop, height: snappedHeight, machine: ds.originalMachine });
      } else if (ds.type === "multi-move") {
        const deltaMs    = Math.round((deltaY / sh) * 30 * 60 * 1000 / SLOT_MS) * SLOT_MS;
        const newMachine = clientXToMachine(e.clientX);
        const anchor     = ds.blocks.find(b => b.id === ds.anchorBlockId);
        if (!anchor) return;
        const newStart   = new Date(anchor.originalStart.getTime() + deltaMs);
        const newEnd     = new Date(anchor.originalEnd.getTime() + deltaMs);
        setDragPreview({ blockId: ds.anchorBlockId, top: dateToY(newStart, vs, sh), height: dateToY(newEnd, vs, sh) - dateToY(newStart, vs, sh), machine: newMachine });
      } else if (ds.type === "overlay-resize") {
        // Jeden slot = sh px = 30 min, takže 1 hodina = 2*sh px
        const deltaHours = Math.round(deltaY / (sh * 2));
        let newHour = Math.max(0, Math.min(24, ds.originalBoundaryHour + deltaHours));
        if (ds.edge === "start") newHour = Math.min(newHour, ds.otherBoundaryHour - 1);
        if (ds.edge === "end")   newHour = Math.max(newHour, ds.otherBoundaryHour + 1);
        setOverlayDragPreview({ machine: ds.machine, date: ds.date, edge: ds.edge, hour: newHour });
      }
    }

    async function onMouseUp(e: MouseEvent) {
      // ── Lasso puštění + hit testing ──
      if (lassoRef.current) {
        const lr = lassoRectRef.current;
        if (lassoRef.current.active && lr && lr.width > 5 && lr.height > 5) {
          const { left: lx, top: ly, width: lw, height: lh } = lr;
          const newSelected = new Set<number>();
          for (let i = 0; i < MACHINES.length; i++) {
            const col = colRefs.current[i];
            if (!col) continue;
            const colRect = col.getBoundingClientRect();
            if (colRect.right < lx || colRect.left > lx + lw) continue;
            for (const block of blocksRef.current.filter(b => b.machine === MACHINES[i])) {
              const vs = viewStartRef.current;
              if (!vs) continue;
              const sh = slotHeightRef.current;
              const blockTop    = dateToY(new Date(block.startTime), vs, sh);
              const blockHeight = dateToY(new Date(block.endTime), vs, sh) - blockTop;
              const screenTop   = colRect.top + blockTop;
              if (screenTop + blockHeight > ly && screenTop < ly + lh) newSelected.add(block.id);
            }
          }
          if (newSelected.size > 0) callbacksRef.current.onMultiSelect?.(newSelected);
          else callbacksRef.current.onMultiSelect?.(new Set());
        } else {
          // Kliknutí na prázdné místo → odznačit vše
          callbacksRef.current.onMultiSelect?.(new Set());
        }
        lassoRef.current = null;
        lassoRectRef.current = null;
        setLassoRect(null);
        return;
      }

      const ds = dragStateRef.current;
      const vs = viewStartRef.current;
      if (!ds || !vs) return;

      const moved = dragDidMove.current;
      dragStateRef.current = null;
      dragDidMove.current  = false;
      setDragPreview(null);
      if (!moved) return;

      const deltaY = e.clientY - ds.startClientY;
      const sh = slotHeightRef.current;

      if (ds.type === "move") {
        const originalTop = dateToY(ds.originalStart, vs, sh);
        const newMachine  = clientXToMachine(e.clientX);
        const duration    = ds.originalEnd.getTime() - ds.originalStart.getTime();
        let newStart      = snapToSlot(yToDate(originalTop + deltaY, vs, sh));
        if (workingTimeLockRef.current) {
          newStart = snapToNextValidStart(newMachine, newStart, duration, machineWorkHoursRef.current, machineExceptionsRef.current);
        }
        const newEnd      = new Date(newStart.getTime() + duration);
        try {
          const res     = await fetch(`/api/blocks/${ds.blockId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startTime: newStart.toISOString(), endTime: newEnd.toISOString(), machine: newMachine }) });
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: string };
            callbacksRef.current.onError?.(err.error ?? "Blok se nepodařilo přesunout.");
            return;
          }
          const updated: Block = await res.json();
          callbacksRef.current.onBlockUpdate(updated, true);
        } catch (error) {
          console.error("Block move failed", error);
          callbacksRef.current.onError?.("Blok se nepodařilo přesunout.");
        }
      } else if (ds.type === "resize") {
        const originalTop    = dateToY(ds.originalStart, vs, sh);
        const originalHeight = dateToY(ds.originalEnd, vs, sh) - originalTop;
        const newHeightRaw   = Math.max(sh, originalHeight + deltaY);
        const finalEnd       = snapToSlot(yToDate(originalTop + newHeightRaw, vs, sh));
        const minEnd         = new Date(ds.originalStart.getTime() + SLOT_MS);
        try {
          const res     = await fetch(`/api/blocks/${ds.blockId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endTime: finalEnd >= minEnd ? finalEnd.toISOString() : minEnd.toISOString() }) });
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: string };
            callbacksRef.current.onError?.(err.error ?? "Blok se nepodařilo změnit.");
            return;
          }
          const updated: Block = await res.json();
          callbacksRef.current.onBlockUpdate(updated, true);
        } catch (error) {
          console.error("Block resize failed", error);
          callbacksRef.current.onError?.("Blok se nepodařilo změnit.");
        }
      } else if (ds.type === "multi-move") {
        let deltaMs = Math.round((deltaY / sh) * 30 * 60 * 1000 / SLOT_MS) * SLOT_MS;
        // Určit cílový stroj PŘED snapem — snap musí validovat podle správného stroje
        const newMachine = clientXToMachine(e.clientX);
        if (workingTimeLockRef.current) {
          const blocksOnNewMachine = ds.blocks.map((b) => ({ ...b, machine: newMachine }));
          const { deltaMs: snapped, wasSnapped } = snapGroupDelta(blocksOnNewMachine, deltaMs, machineWorkHoursRef.current, machineExceptionsRef.current);
          deltaMs = snapped;
          if (wasSnapped) callbacksRef.current.onError?.("Bloky přeskočeny přes víkend/noc");
        }
        const updates    = ds.blocks.map(b => ({
          id:        b.id,
          machine:   newMachine,
          startTime: new Date(b.originalStart.getTime() + deltaMs),
          endTime:   new Date(b.originalEnd.getTime()   + deltaMs),
        }));
        callbacksRef.current.onMultiBlockUpdate?.(updates);
      } else if (ds.type === "overlay-resize") {
        const sh2 = slotHeightRef.current;
        const deltaHours = Math.round((e.clientY - ds.startClientY) / (sh2 * 2));
        let newHour = Math.max(0, Math.min(24, ds.originalBoundaryHour + deltaHours));
        if (ds.edge === "start") newHour = Math.min(newHour, ds.otherBoundaryHour - 1);
        if (ds.edge === "end")   newHour = Math.max(newHour, ds.otherBoundaryHour + 1);
        const newStartHour = ds.edge === "start" ? newHour : ds.otherBoundaryHour;
        const newEndHour   = ds.edge === "end"   ? newHour : ds.otherBoundaryHour;
        setOverlayDragPreview(null);
        await exceptionCallbacksRef.current.onExceptionUpsert?.(ds.machine, ds.date, newStartHour, newEndHour, true);
      }
    }

    function onSelectStart(e: Event) {
      if (lassoRef.current?.active) e.preventDefault();
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("selectstart", onSelectStart);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("selectstart", onSelectStart);
    };
  }, []); // prázdné deps — čte z refs

  // ── Zavřít context menu ───────────────────────────────────────────────────
  useEffect(() => {
    if (!contextMenu) return;
    function onDown() { setContextMenu(null); }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [contextMenu]);

  // ── Handlery bloků ─────────────────────────────────────────────────────────
  function handleBlockMouseDown(block: Block, e: React.MouseEvent) {
    if (block.locked) return;
    e.preventDefault();
    const vs = viewStartRef.current;
    if (!vs) return;
    const sh     = slotHeightRef.current;
    const top    = dateToY(new Date(block.startTime), vs, sh);
    const height = dateToY(new Date(block.endTime), vs, sh) - top;
    const ids    = selectedBlockIdsRef.current;
    const isMulti = ids.has(block.id) && ids.size > 1;
    if (isMulti) {
      const selBlocks = blocksRef.current.filter(b => ids.has(b.id) && !b.locked);
      dragStateRef.current = {
        type: "multi-move",
        blocks: selBlocks.map(b => ({ id: b.id, machine: b.machine, originalStart: new Date(b.startTime), originalEnd: new Date(b.endTime) })),
        startClientY: e.clientY, startClientX: e.clientX,
        anchorBlockId: block.id,
      };
    } else {
      dragStateRef.current = { type: "move", blockId: block.id, originalMachine: block.machine, startClientY: e.clientY, startClientX: e.clientX, originalStart: new Date(block.startTime), originalEnd: new Date(block.endTime) };
    }
    dragDidMove.current = false;
    setDragPreview({ blockId: block.id, top, height, machine: block.machine });
  }

  function handleResizeMouseDown(block: Block, e: React.MouseEvent) {
    if (block.locked) return;
    e.preventDefault();
    const vs = viewStartRef.current;
    if (!vs) return;
    dragStateRef.current = { type: "resize", blockId: block.id, originalMachine: block.machine, startClientY: e.clientY, startClientX: e.clientX, originalStart: new Date(block.startTime), originalEnd: new Date(block.endTime) };
    dragDidMove.current  = false;
    const sh     = slotHeightRef.current;
    const top    = dateToY(new Date(block.startTime), vs, sh);
    const height = dateToY(new Date(block.endTime), vs, sh) - top;
    setDragPreview({ blockId: block.id, top, height, machine: block.machine });
  }

  function handleBlockContextMenu(block: Block, e: React.MouseEvent) {
    e.preventDefault();
    if (block.locked) return;
    const vs = viewStartRef.current;
    if (!vs) return;
    const timelineY = clientYToTimelineY(e.clientY);
    const rawSplit  = snapToSlot(yToDate(timelineY, vs));
    const blockStart = new Date(block.startTime);
    const blockEnd   = new Date(block.endTime);
    const splitAt = rawSplit > blockStart && rawSplit < blockEnd
      ? rawSplit
      : snapToSlot(new Date((blockStart.getTime() + blockEnd.getTime()) / 2));
    setContextMenu({ x: e.clientX, y: e.clientY, block, splitAt });
  }

  async function handleSplitBlock() {
    if (!contextMenu) return;
    const { block, splitAt } = contextMenu;
    setContextMenu(null);
    try {
      const res1 = await fetch(`/api/blocks/${block.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endTime: splitAt.toISOString() }) });
      onBlockUpdate(await res1.json());
      const res2 = await fetch("/api/blocks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderNumber: block.orderNumber, machine: block.machine, type: block.type, startTime: splitAt.toISOString(), endTime: block.endTime, description: block.description, deadlineExpedice: block.deadlineExpedice, dataStatusId: block.dataStatusId, dataStatusLabel: block.dataStatusLabel, dataRequiredDate: block.dataRequiredDate, dataOk: block.dataOk, materialStatusId: block.materialStatusId, materialStatusLabel: block.materialStatusLabel, materialRequiredDate: block.materialRequiredDate, materialOk: block.materialOk, barvyStatusId: block.barvyStatusId, barvyStatusLabel: block.barvyStatusLabel, lakStatusId: block.lakStatusId, lakStatusLabel: block.lakStatusLabel, specifikace: block.specifikace }) });
      onBlockCreate(await res2.json());
    } catch (error) {
      console.error("Block split failed", error);
      callbacksRef.current.onError?.("Blok se nepodařilo rozdělit.");
    }
  }

  // ── Sticky header ──────────────────────────────────────────────────────────
  const header = (
    <div style={{ position: "sticky", top: 0, zIndex: 30, display: "flex", flexShrink: 0, backgroundColor: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
      {/* datum placeholder */}
      <div style={{ width: DATE_COL_W, flexShrink: 0, borderRight: "1px solid var(--border)" }} />
      {/* čas placeholder */}
      <div style={{ width: TIME_COL_W, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 8px" }}>
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: "var(--text-muted)", textTransform: "uppercase" }}>ČAS</span>
      </div>
      {MACHINES.flatMap((machine, idx) => [
        idx > 0 ? <div key={`hgap-${idx}`} style={{ width: TIME_COL_W, flexShrink: 0, borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)", backgroundColor: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: "var(--text-muted)", textTransform: "uppercase" }}>ČAS</span>
        </div> : null,
        <div key={machine} style={{ flex: 1, padding: "8px 12px", color: "var(--text)" }} className="text-xs font-bold">
          {machine.replace("_", "\u00a0")}
        </div>,
      ])}
    </div>
  );

  if (!viewStart) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {header}
        <div style={{ flex: 1 }} />
      </div>
    );
  }

  // ── Precompute markers ─────────────────────────────────────────────────────
  const todayDate = new Date();

  type DayInfo = { date: Date; y: number; isWeekend: boolean; isToday: boolean; isHoliday: boolean; isCompanyDay: boolean; companyDayLabel?: string };
  const days: DayInfo[] = [];

  // Výpočet svátkové sady pro všechny roky v zobrazovaném rozsahu
  const holidays = (() => {
    const years = new Set<number>();
    for (let i = 0; i < totalDays; i++) years.add(addDays(viewStart, i).getFullYear());
    const s = new Set<string>();
    years.forEach((y) => czechHolidaySet(y).forEach((d) => s.add(d)));
    return s;
  })();

  type HalfHourMark = { y: number; label: string; isFullHour: boolean; isLabel: boolean };
  const halfHourMarkers: HalfHourMark[] = [];
  // Kolik slotů (po 30 min) přeskočit mezi viditelnými štítky
  const labelStep = slotHeight >= 14 ? 1 : slotHeight >= 7 ? 2 : slotHeight >= 4 ? 4 : 8;

  const blockedOverlays: Record<string, BlockedOverlay[]> = { XL_105: [], XL_106: [] };

  for (let di = 0; di < totalDays; di++) {
    const day      = addDays(viewStart, di);
    const dayY     = di * dayHeight;
    const dow      = day.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isToday  = isSameDay(day, todayDate);
    const dateStr  = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const isHoliday = holidays.has(dateStr);
    const companyDayMatch = companyDays?.find((cd) => dateStr >= cd.startDate.slice(0, 10) && dateStr <= cd.endDate.slice(0, 10));
    days.push({ date: day, y: dayY, isWeekend, isToday, isHoliday, isCompanyDay: !!companyDayMatch, companyDayLabel: companyDayMatch?.label });
    // Blocked overlays — výjimka přebíjí šablonu, fallback na hardcoded
    for (const machine of MACHINES) {
      const exc = machineExceptions?.find(
        (e) => e.machine === machine && e.date.slice(0, 10) === dateStr
      );
      const row = exc ?? machineWorkHours?.find((r) => r.machine === machine && r.dayOfWeek === dow);
      const isException = !!exc;
      const excId = exc?.id ?? null;

      if (!row) {
        // Fallback: původní hardcoded logika (bez interakce)
        if (machine === "XL_105") {
          if (dow === 6 || dow === 0) {
            blockedOverlays.XL_105.push({ top: dayY, height: dayHeight, key: `b105-we-${di}`, date: day, machine, overlayType: "full-block", effectiveStartHour: 0, effectiveEndHour: 24, isException: false, exceptionId: null });
          } else {
            blockedOverlays.XL_105.push({ top: dayY, height: WORK_START_H * 2 * slotHeight, key: `b105-ns-${di}`, date: day, machine, overlayType: "start-block", effectiveStartHour: 0, effectiveEndHour: WORK_START_H, isException: false, exceptionId: null });
            blockedOverlays.XL_105.push({ top: dayY + WORK_END_H * 2 * slotHeight, height: (24 - WORK_END_H) * 2 * slotHeight, key: `b105-ne-${di}`, date: day, machine, overlayType: "end-block", effectiveStartHour: WORK_END_H, effectiveEndHour: 24, isException: false, exceptionId: null });
          }
        } else {
          if (dow === 6) {
            blockedOverlays.XL_106.push({ top: dayY, height: dayHeight, key: `b106-sat-${di}`, date: day, machine, overlayType: "full-block", effectiveStartHour: 0, effectiveEndHour: 24, isException: false, exceptionId: null });
          } else if (dow === 0) {
            blockedOverlays.XL_106.push({ top: dayY, height: WORK_END_H * 2 * slotHeight, key: `b106-sun-${di}`, date: day, machine, overlayType: "start-block", effectiveStartHour: 0, effectiveEndHour: WORK_END_H, isException: false, exceptionId: null });
          } else if (dow === 5) {
            blockedOverlays.XL_106.push({ top: dayY + WORK_END_H * 2 * slotHeight, height: (24 - WORK_END_H) * 2 * slotHeight, key: `b106-fri-${di}`, date: day, machine, overlayType: "end-block", effectiveStartHour: WORK_END_H, effectiveEndHour: 24, isException: false, exceptionId: null });
          }
        }
      } else if (!row.isActive) {
        blockedOverlays[machine].push({ top: dayY, height: dayHeight, key: `b-${machine}-off-${di}`, date: day, machine, overlayType: "full-block", effectiveStartHour: 0, effectiveEndHour: 24, isException, exceptionId: excId });
      } else {
        if (row.startHour > 0) {
          blockedOverlays[machine].push({ top: dayY, height: row.startHour * 2 * slotHeight, key: `b-${machine}-ns-${di}`, date: day, machine, overlayType: "start-block", effectiveStartHour: 0, effectiveEndHour: row.startHour, isException, exceptionId: excId });
        }
        if (row.endHour < 24) {
          blockedOverlays[machine].push({ top: dayY + row.endHour * 2 * slotHeight, height: (24 - row.endHour) * 2 * slotHeight, key: `b-${machine}-ne-${di}`, date: day, machine, overlayType: "end-block", effectiveStartHour: row.endHour, effectiveEndHour: 24, isException, exceptionId: excId });
        }
      }
    }
    for (let s = 0; s < 48; s++) {
      const h = Math.floor(s / 2);
      const m = s % 2 === 0 ? "00" : "30";
      halfHourMarkers.push({ y: dayY + s * slotHeight, label: `${String(h).padStart(2, "0")}:${m}`, isFullHour: m === "00", isLabel: s % labelStep === 0 });
    }
  }

  const currentTimeY = now ? dateToY(now, viewStart, slotHeight) : null;
  const filter       = filterText.trim().toLowerCase();

  // Multi-drag: odvozeno z dragPreview + selectedBlockIds (bez extra state)
  const isMultiDrag = !!dragPreview && !!selectedBlockIds && selectedBlockIds.size > 1 && selectedBlockIds.has(dragPreview.blockId);
  const multiAnchor = isMultiDrag ? (blocks.find(b => b.id === dragPreview!.blockId) ?? null) : null;
  const multiDelta  = multiAnchor ? dragPreview!.top - dateToY(new Date(multiAnchor.startTime), viewStart, slotHeight) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, cursor: dragPreview ? "grabbing" : "default" }}>
      {header}

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", minHeight: 0, backgroundColor: "var(--timeline-bg)" }}>
        <div style={{ height: totalHeight, display: "flex" }}>

          {/* ── Datum sloupec ─────────────────────────────────────────────── */}
          <div style={{ width: DATE_COL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 10, borderRight: "1px solid var(--border)", backgroundColor: "var(--surface)" }}>
            {days.map((d) => (
              <div
                key={d.y}
                style={{
                  position: "absolute",
                  top: d.y,
                  height: dayHeight,
                  left: 0,
                  right: 0,
                  borderLeft: d.isToday
                    ? "3px solid #2484f5"
                    : d.isHoliday
                    ? "3px solid #ef4444"
                    : d.isCompanyDay
                    ? "3px solid #8b5cf6"
                    : d.isWeekend
                    ? "3px solid #fb923c"
                    : "3px solid transparent",
                  backgroundColor: d.isToday
                    ? "rgba(36,132,245,0.07)"
                    : d.isHoliday
                    ? "rgba(239,68,68,0.12)"
                    : d.isCompanyDay
                    ? "rgba(139,92,246,0.12)"
                    : d.isWeekend
                    ? "rgba(251,146,60,0.04)"
                    : "transparent",
                }}
              >
                {/* Sticky label — drží se viditelnosti celý den při scrollování */}
                <div style={{
                  position: "sticky",
                  top: HEADER_HEIGHT,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  paddingTop: 8,
                  gap: 2,
                }}>
                  <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.05em", lineHeight: 1, color: d.isToday ? "#7dd3fc" : d.isHoliday ? "#fca5a5" : d.isCompanyDay ? "#fca5a5" : d.isWeekend ? "#fca5a5" : "var(--text-muted)" }}>
                    {DAY_ABBR[d.date.getDay()]}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, lineHeight: 1, color: d.isToday ? "#38bdf8" : d.isHoliday ? "#f87171" : d.isCompanyDay ? "#f87171" : d.isWeekend ? "#f87171" : "var(--text)" }}>
                    {d.date.getDate()}
                  </span>
                  <span style={{ fontSize: 8, fontWeight: 600, lineHeight: 1, color: d.isToday ? "#7dd3fc" : d.isHoliday ? "#fca5a5" : d.isCompanyDay ? "#fca5a5" : d.isWeekend ? "#fca5a5" : "var(--text-muted)" }}>
                    {MONTH_ABBR[d.date.getMonth()]}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* ── Čas sloupec ───────────────────────────────────────────────── */}
          <div style={{ width: TIME_COL_W, flexShrink: 0, position: "relative", zIndex: 9, borderRight: "1px solid var(--border)", backgroundColor: "var(--surface)" }}>
            {/* Firemní den overlay (hodinová přesnost) */}
            {companyDays?.map((cd) => {
              if (!viewStart) return null;
              const top    = dateToY(new Date(cd.startDate), viewStart, slotHeight);
              const bottom = dateToY(new Date(cd.endDate),   viewStart, slotHeight);
              const totalH = totalDays * dayHeight;
              const clampedTop    = Math.max(0, Math.min(top, totalH));
              const clampedBottom = Math.max(0, Math.min(bottom, totalH));
              const height = clampedBottom - clampedTop;
              if (height <= 0) return null;
              return (
                <div key={`ct-${cd.id}`} style={{ position: "absolute", top: clampedTop, height, left: 0, right: 0, backgroundColor: "rgba(220,38,38,0.22)", backgroundImage: "repeating-linear-gradient(-45deg, rgba(185,28,28,0.45) 0px, rgba(185,28,28,0.45) 4px, transparent 4px, transparent 9px)", pointerEvents: "none" }} />
              );
            })}
            {halfHourMarkers.filter((m) => m.isLabel).map((m) => (
              <div
                key={m.y}
                style={{
                  position: "absolute",
                  top: m.y,
                  left: 0,
                  right: 0,
                  height: slotHeight,
                  transform: "translateY(-50%)",
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 8,
                }}
              >
                <span style={{ fontSize: 9, lineHeight: 1, color: m.isFullHour ? "var(--text-muted)" : "color-mix(in oklab, var(--border) 85%, transparent)", fontWeight: m.isFullHour ? 500 : 400 }}>
                  {m.label}
                </span>
              </div>
            ))}
          </div>

          {/* ── Strojové sloupce ──────────────────────────────────────────── */}
          {MACHINES.map((machine, colIdx) => {
            const machineBlocks = blocks.filter((b) => b.machine === machine);

            return (
              <Fragment key={machine}>
                {colIdx > 0 && (
                  <div
                    style={{ width: TIME_COL_W, flexShrink: 0, position: "relative", zIndex: 9, borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)", backgroundColor: "var(--surface)", userSelect: "none" }}
                    onMouseDown={canEdit ? (e) => {
                      if (e.button !== 0) return;
                      if (dragStateRef.current) return;
                      lassoRef.current = { startClientX: e.clientX, startClientY: e.clientY, active: false };
                      e.preventDefault();
                    } : undefined}
                  >
                    {halfHourMarkers.filter((m) => m.isLabel).map((m) => (
                      <div
                        key={m.y}
                        style={{
                          position: "absolute",
                          top: m.y,
                          left: 0,
                          right: 0,
                          height: slotHeight,
                          transform: "translateY(-50%)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <span style={{ fontSize: 9, lineHeight: 1, color: m.isFullHour ? "var(--text-muted)" : "color-mix(in oklab, var(--border) 85%, transparent)", fontWeight: m.isFullHour ? 500 : 400 }}>
                          {m.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              <div
                ref={(el) => { colRefs.current[colIdx] = el; }}
                style={{ flex: 1, position: "relative", overflow: "hidden", minWidth: 0, backgroundColor: "var(--timeline-bg)" }}
                onDragOver={canEdit ? (e) => {
                  if (!queueDragItem) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  const vs = viewStartRef.current;
                  const el = scrollRef.current;
                  if (!vs || !el) return;
                  const rect = el.getBoundingClientRect();
                  const timelineY = e.clientY - rect.top + el.scrollTop;
                  const snappedStart = snapToSlot(yToDate(timelineY, vs, slotHeight));
                  const snappedY = dateToY(snappedStart, vs, slotHeight);
                  const height = queueDragItem.durationHours * 2 * slotHeight;
                  setQueueDropPreview({ machine, top: snappedY, height, jobType: queueDragItem.type });
                } : undefined}
                onDragLeave={canEdit ? (e) => {
                  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                    setQueueDropPreview(null);
                  }
                } : undefined}
                onDrop={canEdit ? (e) => {
                  e.preventDefault();
                  if (!onQueueDrop || !queueDragItem) return;
                  const vs = viewStartRef.current;
                  const el = scrollRef.current;
                  if (!vs || !el) return;
                  const rect = el.getBoundingClientRect();
                  const timelineY = e.clientY - rect.top + el.scrollTop;
                  const snappedStart = snapToSlot(yToDate(timelineY, vs));
                  setQueueDropPreview(null);
                  onQueueDrop(queueDragItem.id, machine, snappedStart);
                } : undefined}
                onMouseDown={canEdit ? (e) => {
                  if (e.button !== 0) return;
                  if ((e.target as HTMLElement).closest("[data-block]")) return;
                  if (dragStateRef.current) return;
                  lassoRef.current = { startClientX: e.clientX, startClientY: e.clientY, active: false };
                  e.preventDefault();
                } : undefined}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("[data-block]")) return;
                  const el = scrollRef.current;
                  const vs = viewStartRef.current;
                  if (!el || !vs || !onGridClick) return;
                  const rect = el.getBoundingClientRect();
                  const timelineY = e.clientY - rect.top + el.scrollTop;
                  const snappedTime = snapToSlot(yToDate(timelineY, vs, slotHeight));
                  onGridClick(machine, snappedTime);
                }}
              >
                {/* ── Denní cykly + střídání dnů (základní vrstva) ─────────── */}
                {days.map((d, di) => {
                  const isEven = di % 2 === 0;
                  const hpx = slotHeight * 2; // px na hodinu
                  const dow = d.date.getDay();
                  // Dynamické hranice ze schedule (union přes oba stroje)
                  const activeMachines = machineWorkHours?.filter((r) => r.dayOfWeek === dow && r.isActive) ?? [];
                  const nightEnd   = activeMachines.length > 0 ? Math.min(...activeMachines.map((r) => r.startHour)) : WORK_START_H;
                  const nightStart = activeMachines.length > 0 ? Math.max(...activeMachines.map((r) => r.endHour))   : WORK_END_H;
                  const midpoint   = Math.round((nightEnd + nightStart) / 2); // střed pracovního okna (pro ranní/odpolední split)
                  return (
                    <Fragment key={`dayshade-${d.y}`}>
                      {/* Základní tón každého druhého dne */}
                      {!isEven && <div className="tl-day-alt" style={{ position: "absolute", top: d.y, height: dayHeight, left: 0, right: 0, pointerEvents: "none" }} />}
                      {/* Noční — 0:00–nightEnd */}
                      {nightEnd > 0 && <div className="tl-night" style={{ position: "absolute", top: d.y, height: nightEnd * hpx, left: 0, right: 0, pointerEvents: "none" }} />}
                      {/* Ranní — nightEnd–midpoint */}
                      {midpoint > nightEnd && <div className="tl-morning" style={{ position: "absolute", top: d.y + nightEnd * hpx, height: (midpoint - nightEnd) * hpx, left: 0, right: 0, pointerEvents: "none" }} />}
                      {/* Odpolední — midpoint–nightStart */}
                      {nightStart > midpoint && <div className="tl-afternoon" style={{ position: "absolute", top: d.y + midpoint * hpx, height: (nightStart - midpoint) * hpx, left: 0, right: 0, pointerEvents: "none" }} />}
                      {/* Noční — nightStart–24:00 */}
                      {nightStart < 24 && <div className="tl-night" style={{ position: "absolute", top: d.y + nightStart * hpx, height: (24 - nightStart) * hpx, left: 0, right: 0, pointerEvents: "none" }} />}
                    </Fragment>
                  );
                })}

                {/* Dnešní pozadí */}
                {days.map((d) =>
                  d.isToday ? (
                    <div key={d.y} style={{ position: "absolute", top: d.y, height: dayHeight, left: 0, right: 0, backgroundColor: "rgba(36,132,245,0.04)", pointerEvents: "none" }} />
                  ) : null
                )}

                {/* Svátek overlay */}
                {days.map((d) =>
                  d.isHoliday && !d.isToday ? (
                    <div key={`h-${d.y}`} style={{ position: "absolute", top: d.y, height: dayHeight, left: 0, right: 0, backgroundColor: "rgba(239,68,68,0.06)", pointerEvents: "none" }} />
                  ) : null
                )}

                {/* Firemní den overlay (hodinová přesnost) */}
                {companyDays?.filter((cd) => !cd.machine || cd.machine === machine).map((cd) => {
                  if (!viewStart) return null;
                  const top    = dateToY(new Date(cd.startDate), viewStart, slotHeight);
                  const bottom = dateToY(new Date(cd.endDate),   viewStart, slotHeight);
                  const totalH = totalDays * dayHeight;
                  const clampedTop    = Math.max(0, Math.min(top, totalH));
                  const clampedBottom = Math.max(0, Math.min(bottom, totalH));
                  const height = clampedBottom - clampedTop;
                  if (height <= 0) return null;
                  return (
                    <div key={`c-${cd.id}`} style={{ position: "absolute", top: clampedTop, height, left: 0, right: 0, backgroundColor: "rgba(220,38,38,0.22)", backgroundImage: "repeating-linear-gradient(-45deg, rgba(185,28,28,0.45) 0px, rgba(185,28,28,0.45) 4px, transparent 4px, transparent 9px)", pointerEvents: "none" }} />
                  );
                })}

                {/* Blokované časy — víkendy + noční XL_105 (červená, interaktivní) */}
                {blockedOverlays[machine]?.map((n) => {
                  const isHovered = hoveredOverlayKey === n.key;
                  const showUI = canEdit && isHovered;
                  const borderStyle = n.isException ? "2px dashed rgba(56,189,248,0.7)" : "none";
                  // Live drag preview — pokud táhneme hranu tohoto overlaye
                  const isBeingDragged = overlayDragPreview &&
                    overlayDragPreview.machine === n.machine &&
                    overlayDragPreview.date.toDateString() === n.date.toDateString() &&
                    ((overlayDragPreview.edge === "start" && n.overlayType === "start-block") ||
                     (overlayDragPreview.edge === "end" && n.overlayType === "end-block"));
                  let renderTop = n.top;
                  let renderHeight = n.height;
                  if (isBeingDragged && overlayDragPreview) {
                    if (n.overlayType === "start-block") {
                      renderHeight = overlayDragPreview.hour * 2 * slotHeight;
                    } else if (n.overlayType === "end-block") {
                      renderTop = n.date ? (blockedOverlays[machine].find(x => x.key !== n.key && x.date.toDateString() === n.date.toDateString() && x.overlayType === "start-block")?.height ?? 0) + (overlayDragPreview.hour * 2 * slotHeight - (overlayDragPreview.hour * 2 * slotHeight)) : n.top;
                      // Recalculate from day start: dayY + overlayDragPreview.hour * 2 * slotHeight
                      const dayYforOverlay = n.top - n.effectiveStartHour * 2 * slotHeight;
                      renderTop = dayYforOverlay + overlayDragPreview.hour * 2 * slotHeight;
                      renderHeight = (24 - overlayDragPreview.hour) * 2 * slotHeight;
                    }
                  }
                  return (
                    <div
                      key={n.key}
                      style={{ position: "absolute", top: renderTop, height: renderHeight, left: 0, right: 0, backgroundColor: "rgba(220,38,38,0.18)", backgroundImage: "repeating-linear-gradient(-45deg, rgba(185,28,28,0.38) 0px, rgba(185,28,28,0.38) 4px, transparent 4px, transparent 9px)", pointerEvents: canEdit ? "auto" : "none", border: borderStyle, boxSizing: "border-box", transition: isBeingDragged ? "none" : "opacity 100ms", zIndex: 2 }}
                      onMouseEnter={() => canEdit && setHoveredOverlayKey(n.key)}
                      onMouseLeave={() => setHoveredOverlayKey(null)}
                    >
                      {/* × tlačítko */}
                      {showUI && (
                        <button
                          style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: "50%", background: "rgba(239,68,68,0.9)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700, lineHeight: 1, zIndex: 10 }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (n.isException && n.exceptionId) {
                              await exceptionCallbacksRef.current.onExceptionDelete?.(n.exceptionId);
                            } else {
                              if (n.overlayType === "full-block") {
                                // Celý den byl blokovaný — výjimka: celý den provoz
                                await exceptionCallbacksRef.current.onExceptionUpsert?.(n.machine, n.date, 0, 24, true);
                              } else if (n.overlayType === "start-block") {
                                // Odstraň ranní blokaci: work starts at 0, endHour = z end-block (nebo 24)
                                const endPartner = blockedOverlays[machine].find(x => x.overlayType === "end-block" && x.date.toDateString() === n.date.toDateString());
                                const endH = endPartner?.effectiveStartHour ?? 24;
                                await exceptionCallbacksRef.current.onExceptionUpsert?.(n.machine, n.date, 0, endH, true);
                              } else {
                                // Odstraň noční blokaci: work ends at 24, startHour = ze start-block (nebo 0)
                                const startPartner = blockedOverlays[machine].find(x => x.overlayType === "start-block" && x.date.toDateString() === n.date.toDateString());
                                const startH = startPartner?.effectiveEndHour ?? 0;
                                await exceptionCallbacksRef.current.onExceptionUpsert?.(n.machine, n.date, startH, 24, true);
                              }
                            }
                          }}
                        >×</button>
                      )}
                      {/* Drag handle — start-block: dole, end-block: nahoře */}
                      {showUI && n.overlayType === "start-block" && (() => {
                        // otherBoundaryHour = endHour pracovní doby pro tento den (= effectiveStartHour matching end-block)
                        const partner = blockedOverlays[machine].find(x => x.overlayType === "end-block" && x.date.toDateString() === n.date.toDateString());
                        const endHourOfDay = partner?.effectiveStartHour ?? 24;
                        return (
                          <div
                            style={{ position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)", width: 28, height: 8, borderRadius: 4, background: "rgba(239,68,68,0.7)", cursor: "ns-resize", zIndex: 10 }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              dragStateRef.current = {
                                type: "overlay-resize",
                                machine: n.machine,
                                date: n.date,
                                edge: "start",
                                originalBoundaryHour: n.effectiveEndHour,
                                otherBoundaryHour: endHourOfDay,
                                startClientY: e.clientY,
                              };
                              dragDidMove.current = false;
                            }}
                          />
                        );
                      })()}
                      {showUI && n.overlayType === "end-block" && (() => {
                        // otherBoundaryHour = startHour pracovní doby pro tento den (= effectiveEndHour matching start-block)
                        const partner = blockedOverlays[machine].find(x => x.overlayType === "start-block" && x.date.toDateString() === n.date.toDateString());
                        const startHourOfDay = partner?.effectiveEndHour ?? 0;
                        return (
                          <div
                            style={{ position: "absolute", top: 2, left: "50%", transform: "translateX(-50%)", width: 28, height: 8, borderRadius: 4, background: "rgba(239,68,68,0.7)", cursor: "ns-resize", zIndex: 10 }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              dragStateRef.current = {
                                type: "overlay-resize",
                                machine: n.machine,
                                date: n.date,
                                edge: "end",
                                originalBoundaryHour: n.effectiveStartHour,
                                otherBoundaryHour: startHourOfDay,
                                startClientY: e.clientY,
                              };
                              dragDidMove.current = false;
                            }}
                          />
                        );
                      })()}
                    </div>
                  );
                })}

                {/* Denní oddělovače */}
                {days.map((d) => (
                  <div key={d.y} style={{ position: "absolute", top: d.y, left: 0, right: 0, height: 1, backgroundColor: "color-mix(in oklab, var(--border) 85%, transparent)" }} />
                ))}

                {/* Hodinové čáry */}
                {halfHourMarkers.filter((m) => m.isLabel && m.isFullHour).map((m) => (
                  <div key={m.y} style={{ position: "absolute", top: m.y, left: 0, right: 0, height: 1, backgroundColor: "color-mix(in oklab, var(--border) 70%, transparent)" }} />
                ))}

                {/* Půlhodinové čáry */}
                {halfHourMarkers.filter((m) => m.isLabel && !m.isFullHour).map((m) => (
                  <div key={m.y} style={{ position: "absolute", top: m.y, left: 0, right: 0, height: 1, backgroundColor: "color-mix(in oklab, var(--border) 45%, transparent)" }} />
                ))}

                {/* Aktuální čas */}
                {currentTimeY !== null && (
                  <div style={{ position: "absolute", top: currentTimeY, left: 0, right: 0, zIndex: 10, borderTop: "2px solid #ef4444", pointerEvents: "none" }}>
                    {colIdx === 0 && (
                      <div style={{ position: "absolute", left: -4, top: -4, width: 8, height: 8, borderRadius: "50%", backgroundColor: "#ef4444" }} />
                    )}
                  </div>
                )}

                {/* Bloky patřící tomuto stroji */}
                {machineBlocks.map((block) => {
                  const isThisBlockDragging = isMultiDrag
                    ? !!selectedBlockIds?.has(block.id)
                    : dragPreview?.blockId === block.id;
                  // Vždy renderujeme na původní pozici; při tažení blok zešedne (ghost at origin)
                  const top    = dateToY(new Date(block.startTime), viewStart, slotHeight);
                  const height = dateToY(new Date(block.endTime), viewStart, slotHeight) - top;
                  const blockMatchesFilter = filter === "" || [block.orderNumber, block.description, block.specifikace].some(f => f?.toLowerCase().includes(filter));
                  const dimmed   = (!blockMatchesFilter) || !!isThisBlockDragging;
                  const selected = !isThisBlockDragging && block.id === selectedBlockId;

                  return (
                    <BlockCard
                      key={block.id}
                      block={block}
                      top={top}
                      height={height}
                      dimmed={dimmed}
                      selected={selected}
                      isDragging={false}
                      isCopied={block.id === copiedBlockId}
                      multiSelected={!!selectedBlockIds?.has(block.id)}
                      now={now ?? new Date()}
                      onClick={(e) => {
                        if (dragDidMove.current) return;
                        if (e.shiftKey) {
                          const next = new Set(selectedBlockIdsRef.current);
                          // Pokud začínáme nový multi-select, zahrnout i aktuálně otevřený blok v detailu
                          if (next.size === 0 && selectedBlockId != null) next.add(selectedBlockId);
                          if (next.has(block.id)) { next.delete(block.id); } else { next.add(block.id); }
                          callbacksRef.current.onMultiSelect?.(next);
                        } else {
                          onBlockClick(block);
                        }
                      }}
                      onDoubleClick={() => onBlockDoubleClick?.(block)}
                      onMouseDown={canEdit ? (e) => handleBlockMouseDown(block, e) : undefined}
                      onResizeMouseDown={canEdit ? (e) => handleResizeMouseDown(block, e) : undefined}
                      onContextMenu={canEdit ? (e) => handleBlockContextMenu(block, e) : undefined}
                      onBlockUpdate={callbacksRef.current.onBlockUpdate}
                      onError={callbacksRef.current.onError}
                      canEditData={canEditData}
                      canEditMat={canEditMat}
                      onInlineDatePick={(blockId, field, currentValue, rect) => {
                        setInlinePicker({ blockId, field, currentValue, x: rect.left, y: rect.bottom });
                      }}
                      badgeColorMap={badgeColorMap}
                    />
                  );
                })}

                {/* Landing zóny ostatních bloků při multi-move (odvozeno z dragPreview + selectedBlockIds) */}
                {isMultiDrag && dragPreview!.machine === machine && blocks
                  .filter(b => selectedBlockIds!.has(b.id) && b.id !== dragPreview!.blockId)
                  .map(b => {
                    const colorMap: Record<string, string> = { ZAKAZKA: "#1a6bcc", REZERVACE: "#7c3aed", UDRZBA: "#22c55e" };
                    const color = colorMap[b.type] ?? "color-mix(in oklab, var(--text-muted) 85%, #334155)";
                    const bTop    = dateToY(new Date(b.startTime), viewStart, slotHeight) + multiDelta;
                    const bHeight = dateToY(new Date(b.endTime), viewStart, slotHeight) - dateToY(new Date(b.startTime), viewStart, slotHeight);
                    return (
                      <div key={b.id} style={{
                        position: "absolute", top: bTop, height: Math.max(bHeight, slotHeight),
                        left: 3, width: "calc(100% - 6px)", borderRadius: 4,
                        backgroundColor: `${color}22`, border: `2px dashed ${color}cc`,
                        pointerEvents: "none", zIndex: 16,
                      }} />
                    );
                  })}

                {/* Landing zone — anchor blok (single i multi) */}
                {dragPreview && dragPreview.machine === machine && (() => {
                  const draggedBlock = blocks.find((b) => b.id === dragPreview.blockId);
                  if (!draggedBlock) return null;
                  const colorMap: Record<string, string> = { ZAKAZKA: "#1a6bcc", REZERVACE: "#7c3aed", UDRZBA: "#22c55e" };
                  const color = colorMap[draggedBlock.type] ?? "color-mix(in oklab, var(--text-muted) 85%, #334155)";
                  return (
                    <div style={{
                      position: "absolute",
                      top: dragPreview.top,
                      height: Math.max(dragPreview.height, slotHeight),
                      left: 3, width: "calc(100% - 6px)",
                      borderRadius: 4,
                      backgroundColor: `${color}22`,
                      border: `2px dashed ${color}cc`,
                      pointerEvents: "none",
                      zIndex: 16,
                    }} />
                  );
                })()}

                {/* Náhled při přetahování z fronty */}
                {queueDropPreview && queueDropPreview.machine === machine && (
                  <div style={{
                    position: "absolute",
                    top: queueDropPreview.top,
                    height: Math.max(queueDropPreview.height, slotHeight),
                    left: 3, width: "calc(100% - 6px)",
                    borderRadius: 4,
                    backgroundColor: "rgba(36,132,245,0.18)",
                    border: "2px dashed rgba(36,132,245,0.6)",
                    pointerEvents: "none",
                    zIndex: 15,
                  }} />
                )}
              </div>
              </Fragment>
            );
          })}

        </div>
      </div>

      {/* Lasso rectangle */}
      {lassoRect && (
        <div style={{
          position: "fixed",
          left: lassoRect.left, top: lassoRect.top,
          width: lassoRect.width, height: lassoRect.height,
          border: "1.5px dashed rgba(59,130,246,0.8)",
          backgroundColor: "rgba(59,130,246,0.08)",
          borderRadius: 4,
          pointerEvents: "none",
          zIndex: 9999,
        }} />
      )}

      {/* Inline datepicker pro double-click na DATA/MAT badge */}
      {inlinePicker && (
        <InlineDatePicker
          x={inlinePicker.x}
          y={inlinePicker.y}
          currentValue={inlinePicker.currentValue}
          onClose={() => setInlinePicker(null)}
          onPick={async (dateStr) => {
            setInlinePicker(null);
            const block = blocks.find((b) => b.id === inlinePicker.blockId);
            if (!block) return;
            const field = inlinePicker.field === "data" ? "dataRequiredDate" : "materialRequiredDate";
            try {
              const res = await fetch(`/api/blocks/${inlinePicker.blockId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [field]: dateStr }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const updated = await res.json();
              callbacksRef.current.onBlockUpdate(updated);
            } catch (err) {
              console.error("Inline date pick failed", err);
              callbacksRef.current.onError?.("Nepodařilo se uložit datum.");
            }
          }}
        />
      )}

      {/* Kontextové menu */}
      {contextMenu && (
        <div
          style={{ position: "fixed", top: contextMenu.y, left: contextMenu.x, zIndex: 1000 }}
          className="bg-slate-800 border border-slate-600 rounded-md shadow-2xl text-[11px] overflow-hidden"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button onClick={() => { onBlockCopy?.(contextMenu.block); setContextMenu(null); }} className="block w-full text-left px-4 py-2.5 text-slate-200 hover:bg-slate-700 transition-colors">
            ⎘ Kopírovat
          </button>
          <button onClick={handleSplitBlock} className="block w-full text-left px-4 py-2.5 text-slate-200 hover:bg-slate-700 transition-colors border-t border-slate-700">
            ✂ Rozdělit blok
          </button>
          <button onClick={() => setContextMenu(null)} className="block w-full text-left px-4 py-2.5 text-slate-400 hover:bg-slate-700 transition-colors border-t border-slate-700">
            Zrušit
          </button>
        </div>
      )}
    </div>
  );
}
