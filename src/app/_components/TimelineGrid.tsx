"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { snapGroupDeltaWithTemplates, snapToNextValidStartWithTemplates } from "@/lib/workingTime";
import { utcToPragueDateStr } from "@/lib/dateUtils";
import { badgeColorVar } from "@/lib/badgeColors";
import { BLOCK_VARIANTS, VARIANT_CONFIG, type BlockVariant } from "@/lib/blockVariants";
import { DAY_SLOT_COUNT, getSlotRange, slotToHour } from "@/lib/timeSlots";
import { Lock, Clock } from "lucide-react";
import type { MachineWorkHoursTemplate } from "@/lib/machineWorkHours";
import { resolveScheduleRows } from "@/lib/scheduleValidation";
import type { MachineScheduleException } from "@/lib/machineScheduleException";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";

// ─── Konstanty ────────────────────────────────────────────────────────────────
const SLOT_HEIGHT = 26;         // px na 30 min (1 hod = 52 px)

// Sdílený styl pro label chip uvnitř company day overlaye (Z10)
const COMPANY_DAY_CHIP_STYLE: CSSProperties = {
  position: "absolute", top: 4, left: 8, height: 14, padding: "0 5px",
  borderRadius: 3, background: "rgba(153,27,27,0.85)", color: "#fecaca",
  fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  maxWidth: "calc(100% - 16px)", display: "flex", alignItems: "center", lineHeight: 1,
};
const DATE_COL_W = 44;          // šířka sloupce s datem (px)
const HEADER_HEIGHT = 33;       // výška sticky headeru (px) — pro sticky label uvnitř dne
const TIME_COL_W = 72;          // šířka sloupce s časy (px)
const MACHINE_GAP_W = 10;       // šířka neutrálního mezisloupce mezi stroji (px)
const VIEW_DAYS_BACK = 3;
const VIEW_DAYS_AHEAD = 30;

const WORK_START_H = 6;
const WORK_END_H = 22;
const WORK_START_SLOT = WORK_START_H * 2;
const WORK_END_SLOT = WORK_END_H * 2;
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
  blockVariant?: BlockVariant | null;
  jobPresetId: number | null;
  jobPresetLabel: string | null;
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
  materialInStock: boolean;
  // Výrobní sloupečky — PANTONE
  pantoneRequiredDate: string | null;
  pantoneOk: boolean;
  // Výrobní sloupečky — BARVY
  barvyStatusId: number | null;
  barvyStatusLabel: string | null;
  // Výrobní sloupečky — LAK
  lakStatusId: number | null;
  lakStatusLabel: string | null;
  // Výrobní sloupečky — SPECIFIKACE
  specifikace: string | null;
  // Poznámka MTZ k materiálu
  materialNote: string | null;
  materialNoteByUsername: string | null;
  recurrenceType: string;
  recurrenceParentId: number | null;
  splitGroupId: number | null;
  printCompletedAt: string | null;
  printCompletedByUserId: number | null;
  printCompletedByUsername: string | null;
  reservationId: number | null;
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
  effectiveStartSlot: number;
  effectiveEndSlot: number;
  isException: boolean;
  exceptionId: number | null;
};

type OverlayDragPreview = {
  machine: string;
  date: Date;
  edge: "start" | "end";
  slot: number;
  overlayKey: string;
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
      originalBoundarySlot: number;
      otherBoundarySlot: number;
      startClientY: number;
      overlayKey: string;
    };

type DragPreview = {
  blockId: number;
  top: number;
  height: number;
  machine: string;
} | null;


interface TimelineGridProps {
  blocks: Block[];
  filterText: string;
  selectedBlockId: number | null;
  onBlockClick: (block: Block) => void;
  onBlockUpdate: (updatedBlock: Block, addToHistory?: boolean) => void;
  onBlockCreate: (newBlock: Block) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  queueDragItem?: { id: number | string; durationHours: number; type: string } | null;
  onQueueDrop?: (itemId: number | string, machine: string, startTime: Date) => void;
  onQueueDragCancel?: () => void;
  onBlockDoubleClick?: (block: Block) => void;
  companyDays?: CompanyDay[];
  slotHeight?: number;
  daysAhead?: number;
  daysBack?: number;
  copiedBlockId?: number | null;
  onGridClick?: (machine: string, time: Date) => void;
  onGridClickEmpty?: () => void;
  onBlockCopy?: (block: Block) => void;
  selectedBlockIds?: Set<number>;
  onMultiSelect?: (ids: Set<number>) => void;
  onMultiBlockUpdate?: (updates: { id: number; startTime: Date; endTime: Date; machine: string }[]) => void;
  canEdit?: boolean;
  canEditData?: boolean;
  canEditMat?: boolean;
  onError?: (msg: string) => void;
  onInfo?: (msg: string) => void;
  workingTimeLock?: boolean;
  badgeColorMap?: Record<number, string | null>;
  machineWorkHours?: MachineWorkHoursTemplate[];
  machineExceptions?: MachineScheduleException[];
  onExceptionUpsert?: (machine: string, date: Date, startSlot: number, endSlot: number, isActive: boolean) => Promise<void>;
  onExceptionDelete?: (id: number) => Promise<void>;
  isTiskar?: boolean;
  onPrintComplete?: (blockId: number, completed: boolean) => Promise<void>;
  assignedMachine?: string | null;
  onNotify?: (blockId: number, orderNumber: string) => void;
  onBlockVariantChange?: (blockId: number, variant: BlockVariant) => void;
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
  ZAKAZKA_BEZ_TECHNOLOGIE: {
    gradient:    "linear-gradient(160deg, rgba(6,95,70,0.95) 0%, rgba(4,71,54,0.88) 100%)",
    border:      "rgba(6,95,70,0.65)",
    accentBar:   "#059669",
    leftBg:      "rgba(6,95,70,0.14)",
    textPrimary: "#ffffff",
    textSub:     "#e5e7eb",
    glow:        "rgba(6,95,70,0.32)",
  },
  ZAKAZKA_BEZ_SACKU: {
    gradient:    "linear-gradient(160deg, rgba(227,100,20,0.95) 0%, rgba(190,80,10,0.88) 100%)",
    border:      "rgba(227,100,20,0.65)",
    accentBar:   "#e36414",
    leftBg:      "rgba(227,100,20,0.14)",
    textPrimary: "#ffffff",
    textSub:     "#e5e7eb",
    glow:        "rgba(227,100,20,0.32)",
  },
  ZAKAZKA_POZASTAVENO: {
    gradient:    "linear-gradient(160deg, rgba(208,0,0,0.95) 0%, rgba(176,0,0,0.88) 100%)",
    border:      "rgba(208,0,0,0.65)",
    accentBar:   "#d00000",
    leftBg:      "rgba(208,0,0,0.14)",
    textPrimary: "#ffffff",
    textSub:     "#e5e7eb",
    glow:        "rgba(208,0,0,0.32)",
  },
};
const BLOCK_OVERDUE = {
  gradient:    "linear-gradient(160deg, rgba(251,146,60,0.22) 0%, rgba(234,88,12,0.14) 100%)",
  border:      "rgba(251,146,60,0.55)",
  accentBar:   "#f97316",
  leftBg:      "rgba(251,146,60,0.10)",
  textPrimary: "var(--text)",
  textSub:     "var(--text-muted)",
  glow:        "rgba(251,146,60,0.25)",
};
const BLOCK_PRINT_DONE = {
  gradient:    "linear-gradient(160deg, rgba(59,130,246,0.13) 0%, rgba(59,130,246,0.07) 100%)",
  border:      "rgba(59,130,246,0.28)",
  accentBar:   "rgba(59,130,246,0.55)",
  leftBg:      "rgba(59,130,246,0.07)",
  textPrimary: "var(--text)",
  textSub:     "var(--text-muted)",
  glow:        "rgba(59,130,246,0.10)",
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

function getBlockStyleKey(type: string, variant?: BlockVariant | null): string {
  if (type === "ZAKAZKA" && variant && variant !== "STANDARD") {
    return `ZAKAZKA_${variant}`;
  }
  return type;
}

// ─── Pomocná funkce — bezpečný parse data z DB (ISO timestamp i date string) ──
function fmtDate(s: string | null | undefined): string {
  if (!s) return "–";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Europe/Prague" });
}

// Zkrácený formát bez roku: "5.1."
function fmtDateShort(s: string | null | undefined): string {
  if (!s) return "–";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", timeZone: "Europe/Prague" });
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
  PANTONE:  "color-mix(in oklab, #a855f7 78%, var(--text) 22%)",  // fialová — pantone
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
  x, y, currentValue, onPick, onClose, onPickSkladem,
}: {
  x: number; y: number; currentValue: string; onPick: (dateStr: string) => void; onClose: () => void; onPickSkladem?: () => void;
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
        {onPickSkladem && (
          <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <button
              onClick={() => { onPickSkladem(); onClose(); }}
              style={{
                width: "100%", padding: "6px 0", borderRadius: 8, border: "none",
                background: "rgba(16,185,129,0.15)", color: "#10b981",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                letterSpacing: "0.04em",
              }}
            >
              Skladem ✓
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ─── DateBadge — klikatelná kolonka s datem + toggle OK ───────────────────────
function DateBadge({
  label, dateStr, ok, warn, danger, earlyStart, accent, onToggle, onDoubleClick, statusLabel, overrideText,
}: {
  label: string; dateStr: string | null; ok: boolean; warn: boolean; danger: boolean; earlyStart?: boolean; accent?: string; onToggle: () => void; onDoubleClick?: (rect: DOMRect) => void; statusLabel?: string | null; overrideText?: string;
}) {
  const [loading, setLoading] = useState(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const empty = !dateStr && !overrideText;
  const fmt = dateStr ? fmtDate(dateStr) : (overrideText ?? "—");

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
        background: bg,
        borderTop: `1px solid ${borderColor}`, borderRight: `1px solid ${borderColor}`, borderBottom: `1px solid ${borderColor}`,
        borderLeft: `2px solid ${neutralAccent}`,
        cursor: empty ? "default" : "pointer", flex: "0 0 auto",
        transition: "all 0.12s", opacity: loading ? 0.6 : 1,
      }}
    >
      <span style={{ fontSize: 8, fontWeight: 700, color: labelColor, lineHeight: 1, letterSpacing: "0.07em" }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: dateColor, lineHeight: 1 }}>{overrideText ?? (ok && statusLabel ? statusLabel : fmt)}</span>
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

// ─── MaterialNoteAffordance ────────────────────────────────────────────────────
// Jen HoverCard pro pasivní náhled — ContextMenu je nyní na celém bloku (BlockCard).
// Musí být MIMO BlockCard — definice uvnitř by způsobila remount při každém renderu.
function MaterialNoteAffordance({
  children, block,
  indicatorSize = 5, indicatorTop = 2, indicatorRight = 2,
}: {
  children: React.ReactElement;
  block: Block;
  indicatorSize?: number;
  indicatorTop?: number;
  indicatorRight?: number;
}) {
  const hasNote = !!block.materialNote;

  // display:"flex" → children jsou vždy block-level flex items (žádný line-height strut)
  const inner = (
    <div style={{ position: "relative", display: "flex" }}>
      {children}
      {hasNote && (
        <span style={{ position: "absolute", top: indicatorTop, right: indicatorRight, width: indicatorSize, height: indicatorSize, borderRadius: "50%", background: "rgba(255,255,255,0.75)", pointerEvents: "none" }} />
      )}
    </div>
  );

  if (!hasNote) return inner;

  return (
    <HoverCard openDelay={400} closeDelay={100}>
      <HoverCardTrigger asChild>{inner}</HoverCardTrigger>
      <HoverCardContent
        side="right" align="start"
        style={{
          background: "rgba(28, 28, 30, 0.96)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 14,
          padding: "12px 14px",
          maxWidth: 240,
          zIndex: 200,
          boxShadow: "0 8px 32px rgba(0,0,0,0.52), 0 2px 8px rgba(0,0,0,0.28)",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
        }}
      >
        <p style={{ margin: "0 0 7px", fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.32)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Poznámka MTZ
        </p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "rgba(255,255,255,0.88)", whiteSpace: "pre-wrap" }}>
          {block.materialNote}
        </p>
        {block.materialNoteByUsername && (
          <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.55)", flexShrink: 0 }}>
              {block.materialNoteByUsername[0]?.toUpperCase()}
            </div>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.42)" }}>
              {block.materialNoteByUsername}
            </span>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

// ─── BlockCard ─────────────────────────────────────────────────────────────────
function BlockCard({
  block, top, height, dimmed, selected, isDragging, isCopied, multiSelected, now,
  onClick, onDoubleClick, onMouseDown, onResizeMouseDown, onBlockUpdate, onError,
  canEdit, canEditData, canEditMat, onInlineDatePick, badgeColorMap,
  onBlockCopy, onBlockSplit, getSplitAt, isTiskar, onPrintComplete, onNotify, onBlockVariantChange,
  splitPart, splitTotal,
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
  splitPart?: number;
  splitTotal?: number;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onResizeMouseDown?: (e: React.MouseEvent) => void;
  onBlockUpdate: (b: Block) => void;
  onError?: (msg: string) => void;
  canEdit?: boolean;
  canEditData?: boolean;
  canEditMat?: boolean;
  onInlineDatePick?: (blockId: number, field: "data" | "material" | "pantone", currentValue: string, rect: DOMRect) => void;
  badgeColorMap?: Record<number, string | null>;
  onBlockCopy?: () => void;
  onBlockSplit?: (splitAt: Date) => void;
  getSplitAt?: (clientY: number) => Date;
  isTiskar?: boolean;
  onPrintComplete?: (blockId: number, completed: boolean) => Promise<void>;
  onNotify?: (blockId: number, orderNumber: string) => void;
  onBlockVariantChange?: (blockId: number, variant: BlockVariant) => void;
}) {
  const [resizeHovered, setResizeHovered] = useState(false);
  const [hovered, setHovered]             = useState(false);
  const [badgeHovered, setBadgeHovered]   = useState(false);
  const [printPending, setPrintPending]   = useState(false);
  const blockCardRef = useRef<HTMLDivElement>(null);
  const compactDataTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compactMatTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compactPanTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [noteOpen, setNoteOpen]   = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteRect, setNoteRect]   = useState<{ bottom: number; left: number } | null>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const splitAtRef      = useRef<Date | null>(null);
  const ctxMouseRef     = useRef<{ x: number; y: number } | null>(null);

  const isPrintDone   = block.printCompletedAt != null;
  const isPozastaveno = block.type === "ZAKAZKA" && block.blockVariant === "POZASTAVENO";
  const isOverdue     = block.type === "ZAKAZKA" && new Date(block.endTime) < now && !isPrintDone && !isPozastaveno;
  const clampedHeight = Math.max(height, 20);

  const dataDeadlineState = deadlineState(block.dataRequiredDate, block.dataOk, now, block.startTime);
  // materialInStock potlačuje warning logiku materiálu
  const effectiveMaterialDate = block.materialInStock ? null : block.materialRequiredDate;
  const effectiveMaterialOk   = block.materialInStock ? true : block.materialOk;
  const materialDeadlineState = block.materialInStock
    ? "ok"
    : deadlineState(block.materialRequiredDate, block.materialOk, now, block.startTime);

  const s = isPrintDone
    ? BLOCK_PRINT_DONE
    : isPozastaveno
    ? BLOCK_STYLES["ZAKAZKA_POZASTAVENO"]
    : isOverdue
    ? BLOCK_OVERDUE
    : (BLOCK_STYLES[getBlockStyleKey(block.type, block.blockVariant)] ?? BLOCK_STYLES["ZAKAZKA"]);

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

  const hasNoteRow = Boolean(
    block.dataStatusLabel ||
    block.materialStatusLabel ||
    block.barvyStatusLabel ||
    block.lakStatusLabel ||
    block.specifikace
  );

  // Výškové mody (vzájemně se vylučují)
  const MODE_FULL    = clampedHeight >= 48;                              // plný layout (od ~1h při zoom=26)
  const MODE_COMPACT = !MODE_FULL && clampedHeight >= 44 && block.type !== "UDRZBA";
  const MODE_TINY    = !MODE_FULL && !MODE_COMPACT && clampedHeight >= 24; // micro tečky
  // Výškové prahy pro FULL mode
  const showDatesFull    = !isTiskar && MODE_FULL && clampedHeight >= 60 && block.type !== "UDRZBA"; // plný DateBadge řádek (≥60px)
  const showDatesCompact = !isTiskar && MODE_FULL && clampedHeight < 60  && block.type !== "UDRZBA"; // kompaktní chip řádek (48–59px)
  const showDates        = showDatesFull;
  const showSpec   = clampedHeight >= 80;  // 3. řádek — specifikace
  const showDesc   = MODE_FULL && clampedHeight >= 66; // popis za číslem zakázky (jen u větších bloků)
  // Počet řádků popisu — roste s výškou bloku (13px/řádek, od ~55px výšky)
  const descLineClamp = Math.max(2, Math.floor((clampedHeight - 55) / 13));

  const opacity = dimmed ? 0.12 : isDragging ? 0.72 : 1;
  const glow = s.glow;
  const shadow  = selected
    ? "0 0 0 1.5px #FFE600, 0 4px 16px rgba(0,0,0,0.6)"
    : multiSelected
      ? "0 0 0 3px rgba(255,230,0,0.4), 0 0 12px rgba(255,230,0,0.3), 0 4px 16px rgba(0,0,0,0.5)"
      : hovered && !isDragging
        ? `0 6px 24px rgba(0,0,0,0.55), 0 0 16px ${glow}, inset 0 1px 0 rgba(255,255,255,0.08)`
        : `0 2px 8px rgba(0,0,0,0.35), 0 0 10px ${glow}, inset 0 1px 0 rgba(255,255,255,0.05)`;

  async function toggleField(field: "dataOk" | "materialOk" | "pantoneOk", current: boolean) {
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

  function openNoteEditor(pos: { bottom: number; left: number } | null) {
    setNoteRect(pos);
    setNoteDraft(block.materialNote ?? "");
    setNoteOpen(true);
    setTimeout(() => noteTextareaRef.current?.focus(), 50);
  }

  async function saveNote() {
    setNoteSaving(true);
    try {
      const res = await fetch(`/api/blocks/${block.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialNote: noteDraft.trim() || null }),
      });
      if (res.ok) {
        onBlockUpdate(await res.json());
        setNoteOpen(false);
      } else {
        onError?.("Poznámku se nepodařilo uložit.");
      }
    } catch (error) {
      console.error("Save note failed", error);
      onError?.("Poznámku se nepodařilo uložit.");
    } finally {
      setNoteSaving(false);
    }
  }

  async function clearNote() {
    try {
      const res = await fetch(`/api/blocks/${block.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialNote: null }),
      });
      if (res.ok) onBlockUpdate(await res.json());
    } catch (error) {
      console.error("Clear note failed", error);
      onError?.("Poznámku se nepodařilo smazat.");
    }
  }

  const menuItemStyle: React.CSSProperties = { borderRadius: 7, padding: "6px 10px", fontSize: 13, color: "rgba(255,255,255,0.9)", cursor: "pointer" };
  const hasNote = !!block.materialNote;
  const showMenu = (canEdit && !block.locked) || canEditMat || hasNote;

  const showTooltip = block.type !== "UDRZBA" && !badgeHovered;

  const blockDiv = (
    <div
      ref={blockCardRef}
      data-block="true"
      data-planner-block-card="true"
      onMouseDown={block.locked ? undefined : onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
      style={{
        position: "absolute", top, height: clampedHeight, left: 3,
        width: "calc(100% - 6px)",
        zIndex: isDragging ? 20 : resizeHovered ? 15 : hovered ? 5 : 1,
        cursor: block.locked ? "default" : isDragging ? "grabbing" : "grab",
        opacity, borderRadius: 7,
        border: isCopied ? "1.5px dashed #3b82f6" : multiSelected ? "2.5px solid #FFE600" : `1px solid ${selected ? "#FFE600" : s.border}`,
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

      {/* Modrý selection overlay */}
      {multiSelected && <div style={{ position: "absolute", inset: 0, borderRadius: 6, background: "rgba(255,230,0,0.12)", pointerEvents: "none", zIndex: 1 }} />}


      {/* ── MODE_COMPACT: 2 řádky — [datumy horiz. + chips] / [číslo + popis] ── */}
      {MODE_COMPACT && (() => {
        const dStateKey = !block.dataRequiredDate ? "empty" : dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
        const mStateKey = block.materialInStock ? "ok" : (!block.materialRequiredDate ? "empty" : materialDeadlineState === "none" ? "neutral" : materialDeadlineState);
        const eStateKey = !block.deadlineExpedice ? "empty" : "neutral";
        const pStateKey = !block.pantoneRequiredDate && !block.pantoneOk ? "empty" : block.pantoneOk ? "ok" : "neutral";
        const dateChip = (stateKey: string, fieldAccent: string, clickable: boolean): React.CSSProperties => ({
          fontSize: 10, fontWeight: 600,
          color: stateKey === "empty" ? "var(--text-muted)" : "rgba(255,255,255,0.90)",
          background: DEADLINE_BG[stateKey] ?? DEADLINE_BG.neutral,
          borderTop: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`, borderRight: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`, borderBottom: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`,
          borderLeft: `2px solid ${fieldAccent}`,
          borderRadius: 4, padding: "2px 6px 2px 5px",
          whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1,
          cursor: clickable ? "pointer" : "default",
        });
        const dIcon = dataDeadlineState === "ok" ? " ✓" : dataDeadlineState === "danger" ? " ✕" : dataDeadlineState === "warning" ? " !" : dataDeadlineState === "earlyStart" ? " ⚠" : "";
        const mIcon = materialDeadlineState === "ok" ? " ✓" : materialDeadlineState === "danger" ? " ✕" : materialDeadlineState === "warning" ? " !" : materialDeadlineState === "earlyStart" ? " ⚠" : "";
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 8px", flex: 1, overflow: "hidden", minHeight: 0 }}>
            {/* Levá část: datumy + separator + číslo + popis */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, overflow: "hidden" }}>
              {!isTiskar && <>
                <span style={dateChip(dStateKey, FIELD_ACCENT.DATA, !!block.dataRequiredDate)} title={dataDeadlineState === "earlyStart" ? "Start zakázky před dodáním dat" : undefined}
                  onClick={block.dataRequiredDate ? (e) => { e.stopPropagation(); if (canEditData && onInlineDatePick) { if (compactDataTimerRef.current) clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = setTimeout(() => { compactDataTimerRef.current = null; toggleField("dataOk", block.dataOk); }, 220); } else { toggleField("dataOk", block.dataOk); } } : undefined}
                  onDoubleClick={canEditData && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactDataTimerRef.current) { clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = null; } onInlineDatePick(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                  D&nbsp;{block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}
                </span>
                <MaterialNoteAffordance indicatorSize={4} indicatorTop={1} indicatorRight={1} block={block}>
                  <span style={dateChip(mStateKey, FIELD_ACCENT.MATERIAL, !!block.materialRequiredDate && !block.materialInStock)} title={materialDeadlineState === "earlyStart" ? "Start zakázky před dodáním materiálu" : undefined}
                    onClick={block.materialRequiredDate && !block.materialInStock ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactMatTimerRef.current) clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = setTimeout(() => { compactMatTimerRef.current = null; toggleField("materialOk", block.materialOk); }, 220); } else { toggleField("materialOk", block.materialOk); } } : undefined}
                    onDoubleClick={canEditMat && onInlineDatePick && !block.materialInStock ? (e) => { e.stopPropagation(); if (compactMatTimerRef.current) { clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = null; } onInlineDatePick(block.id, "material", block.materialRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                    M&nbsp;{block.materialInStock ? "SKLAD" : block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${mIcon}` : "—"}
                  </span>
                </MaterialNoteAffordance>
                <span style={dateChip(eStateKey, FIELD_ACCENT.EXPEDICE, false)}>
                  E&nbsp;{block.deadlineExpedice ? fmtDateShort(block.deadlineExpedice) : "—"}
                </span>
                {(block.pantoneRequiredDate || block.pantoneOk) && (
                  <span style={dateChip(pStateKey, FIELD_ACCENT.PANTONE, !!block.pantoneRequiredDate)}
                    onClick={block.pantoneRequiredDate ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactPanTimerRef.current) clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = setTimeout(() => { compactPanTimerRef.current = null; toggleField("pantoneOk", block.pantoneOk); }, 220); } else { toggleField("pantoneOk", block.pantoneOk); } } : undefined}
                    onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactPanTimerRef.current) { clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = null; } onInlineDatePick(block.id, "pantone", block.pantoneRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                    P&nbsp;{block.pantoneOk ? "OK" : block.pantoneRequiredDate ? fmtDateShort(block.pantoneRequiredDate) : "—"}
                  </span>
                )}
                <div style={{ width: 1, height: 12, background: "var(--border)", flexShrink: 0 }} />
              </>}
              <span style={{ fontSize: 11, fontWeight: 700, color: s.textPrimary, whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1 }}>
                {block.orderNumber}{block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.6 }}><Lock size={9} strokeWidth={2} /></span>}
                {isPrintDone && <span style={{ marginLeft: 4, fontSize: 9, color: "#22c55e", fontWeight: 700 }}>✓</span>}
                {isOverdue && !isPrintDone && block.type === "ZAKAZKA" && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 4 }}><Clock size={11} strokeWidth={2.5} color="#f59e0b" /></span>}
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
            {/* Hotovo mini tlačítko — jen pro TISKAR */}
            {isTiskar && onPrintComplete && block.type === "ZAKAZKA" && (
              <button onClick={(e) => { e.stopPropagation(); setPrintPending(true); onPrintComplete(block.id, !isPrintDone).finally(() => setPrintPending(false)); }} disabled={printPending}
                style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 5, border: "none", cursor: printPending ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", background: isPrintDone ? "rgba(100,116,139,0.3)" : "rgba(34,197,94,0.35)", color: isPrintDone ? "var(--text-muted)" : "#22c55e", opacity: printPending ? 0.5 : 1, transition: "all 0.12s ease-out", fontFamily: "inherit" }}
                title={isPrintDone ? "Vrátit hotovo" : "Označit jako hotovo"}>
                {printPending ? "·" : isPrintDone ? "↩" : "✓"}
              </button>
            )}
          </div>
        );
      })()}

      {/* ── MODE_TINY: jednořádkový layout — [D chip] [M chip] [E chip] | číslo popis ── */}
      {MODE_TINY && (() => {
        const dStateKey = !block.dataRequiredDate ? "empty" : dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
        const mStateKey = block.materialInStock ? "ok" : (!block.materialRequiredDate ? "empty" : materialDeadlineState === "none" ? "neutral" : materialDeadlineState);
        const eStateKey = !block.deadlineExpedice ? "empty" : "neutral";
        const chipStyle = (stateKey: string, fieldAccent: string, clickable: boolean): React.CSSProperties => ({
          fontSize: 9, fontWeight: 600,
          color: stateKey === "empty" ? "var(--text-muted)" : "rgba(255,255,255,0.90)",
          background: DEADLINE_BG[stateKey] ?? DEADLINE_BG.neutral,
          borderTop: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`, borderRight: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`, borderBottom: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`,
          borderLeft: `2px solid ${fieldAccent}`,
          borderRadius: 3, padding: "1px 5px 1px 4px",
          whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1,
          cursor: clickable ? "pointer" : "default",
        });
        const dIcon = dataDeadlineState === "ok" ? " ✓" : dataDeadlineState === "danger" ? " ✕" : dataDeadlineState === "warning" ? " !" : dataDeadlineState === "earlyStart" ? " ⚠" : "";
        const mIcon = materialDeadlineState === "ok" ? " ✓" : materialDeadlineState === "danger" ? " ✕" : materialDeadlineState === "warning" ? " !" : materialDeadlineState === "earlyStart" ? " ⚠" : "";
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 8px", flex: 1, overflow: "hidden", minHeight: 0 }}>
            {/* Levá část: datum chips + číslo + popis */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, overflow: "hidden" }}>
              {!isTiskar && block.type !== "UDRZBA" && <>
                <span style={chipStyle(dStateKey, FIELD_ACCENT.DATA, !!block.dataRequiredDate)} title={dataDeadlineState === "earlyStart" ? "Start zakázky před dodáním dat" : undefined}
                  onClick={block.dataRequiredDate ? (e) => { e.stopPropagation(); if (canEditData && onInlineDatePick) { if (compactDataTimerRef.current) clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = setTimeout(() => { compactDataTimerRef.current = null; toggleField("dataOk", block.dataOk); }, 220); } else { toggleField("dataOk", block.dataOk); } } : undefined}
                  onDoubleClick={canEditData && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactDataTimerRef.current) { clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = null; } onInlineDatePick(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                  D&nbsp;{block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}
                </span>
                <MaterialNoteAffordance indicatorSize={4} indicatorTop={1} indicatorRight={1} block={block}>
                  <span style={chipStyle(mStateKey, FIELD_ACCENT.MATERIAL, !!block.materialRequiredDate && !block.materialInStock)} title={materialDeadlineState === "earlyStart" ? "Start zakázky před dodáním materiálu" : undefined}
                    onClick={block.materialRequiredDate && !block.materialInStock ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactMatTimerRef.current) clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = setTimeout(() => { compactMatTimerRef.current = null; toggleField("materialOk", block.materialOk); }, 220); } else { toggleField("materialOk", block.materialOk); } } : undefined}
                    onDoubleClick={canEditMat && onInlineDatePick && !block.materialInStock ? (e) => { e.stopPropagation(); if (compactMatTimerRef.current) { clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = null; } onInlineDatePick(block.id, "material", block.materialRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                    M&nbsp;{block.materialInStock ? "SKLAD" : block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${mIcon}` : "—"}
                  </span>
                </MaterialNoteAffordance>
                <span style={chipStyle(eStateKey, FIELD_ACCENT.EXPEDICE, false)}>
                  E&nbsp;{block.deadlineExpedice ? fmtDateShort(block.deadlineExpedice) : "—"}
                </span>
                {(block.pantoneRequiredDate || block.pantoneOk) && (() => {
                  const pStateKey = !block.pantoneRequiredDate && !block.pantoneOk ? "empty" : block.pantoneOk ? "ok" : "neutral";
                  return (
                    <span style={chipStyle(pStateKey, FIELD_ACCENT.PANTONE, !!block.pantoneRequiredDate)}
                      onClick={block.pantoneRequiredDate ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactPanTimerRef.current) clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = setTimeout(() => { compactPanTimerRef.current = null; toggleField("pantoneOk", block.pantoneOk); }, 220); } else { toggleField("pantoneOk", block.pantoneOk); } } : undefined}
                      onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactPanTimerRef.current) { clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = null; } onInlineDatePick(block.id, "pantone", block.pantoneRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                      P&nbsp;{block.pantoneOk ? "OK" : block.pantoneRequiredDate ? fmtDateShort(block.pantoneRequiredDate) : "—"}
                    </span>
                  );
                })()}
                <div style={{ width: 1, height: 10, background: "var(--border)", flexShrink: 0 }} />
              </>}
              <span style={{ fontSize: 10, fontWeight: 700, color: s.textPrimary, whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1 }}>
                {block.orderNumber}{block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.6 }}><Lock size={8} strokeWidth={2} /></span>}
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
            {/* Pravá část: status chips + série + split */}
            {(hasNoteRow || block.recurrenceType !== "NONE" || block.recurrenceParentId !== null || (splitTotal ?? 0) > 1) && (
              <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
                {block.dataStatusLabel     && <MiniChip label={block.dataStatusLabel}     accent={dataAccent}  textColor={dataText  ?? undefined} />}
                {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={matAccent}   textColor={matText   ?? undefined} />}
                {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent={barvyAccent} textColor={barvyText ?? undefined} />}
                {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent={lakAccent}   textColor={lakText   ?? undefined} />}
                {(block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                  <span style={{ fontSize: 8, opacity: 0.4, color: s.textSub, flexShrink: 0, lineHeight: 1 }}>↻</span>
                )}
                {(splitTotal ?? 0) > 1 && (
                  <span style={{ fontSize: 8, opacity: 0.55, color: s.textSub, flexShrink: 0, lineHeight: 1 }}>✂{splitPart}/{splitTotal}</span>
                )}
              </div>
            )}
            {/* Hotovo mini tlačítko — jen pro TISKAR */}
            {isTiskar && onPrintComplete && block.type === "ZAKAZKA" && (
              <button onClick={(e) => { e.stopPropagation(); setPrintPending(true); onPrintComplete(block.id, !isPrintDone).finally(() => setPrintPending(false)); }} disabled={printPending}
                style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 5, border: "none", cursor: printPending ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", background: isPrintDone ? "rgba(100,116,139,0.3)" : "rgba(34,197,94,0.35)", color: isPrintDone ? "var(--text-muted)" : "#22c55e", opacity: printPending ? 0.5 : 1, transition: "all 0.12s ease-out", fontFamily: "inherit" }}
                title={isPrintDone ? "Vrátit hotovo" : "Označit jako hotovo"}>
                {printPending ? "·" : isPrintDone ? "↩" : "✓"}
              </button>
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
              {block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 3, opacity: 0.6 }}><Lock size={9} strokeWidth={2} /></span>}
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
          {/* Pravá část: status chips + série + split */}
          {(hasNoteRow || block.recurrenceType !== "NONE" || block.recurrenceParentId !== null || (splitTotal ?? 0) > 1) && (
            <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
              {block.dataStatusLabel     && <MiniChip label={block.dataStatusLabel}     accent={dataAccent}  textColor={dataText  ?? undefined} />}
              {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={matAccent}   textColor={matText   ?? undefined} />}
              {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent={barvyAccent} textColor={barvyText ?? undefined} />}
              {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent={lakAccent}   textColor={lakText   ?? undefined} />}
              {(block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                <span style={{ fontSize: 8, opacity: 0.4, color: s.textSub }}>↻</span>
              )}
              {(splitTotal ?? 0) > 1 && (
                <span style={{ fontSize: 8, opacity: 0.55, color: s.textSub, flexShrink: 0, lineHeight: 1 }}>✂{splitPart}/{splitTotal}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Řádek 2: Klikatelné date badges (FULL mode) — vždy všechny 3 ── */}
      {showDates && block.type !== "UDRZBA" && (
        <div
          style={{ padding: "2px 7px 3px", display: "flex", gap: 5, flexWrap: "nowrap", flexShrink: 0, alignItems: "center" }}
          onMouseEnter={() => setBadgeHovered(true)}
          onMouseLeave={() => setBadgeHovered(false)}
        >
          <DateBadge
            label="DATA" dateStr={block.dataRequiredDate}
            ok={dataDeadlineState === "ok"} warn={dataDeadlineState === "warning"} danger={dataDeadlineState === "danger"} earlyStart={dataDeadlineState === "earlyStart"}
            accent={FIELD_ACCENT.DATA}
            onToggle={() => toggleField("dataOk", block.dataOk)}
            onDoubleClick={canEditData ? (rect) => onInlineDatePick?.(block.id, "data", block.dataRequiredDate ?? "", rect) : undefined}
            statusLabel={block.dataStatusLabel}
          />
          <MaterialNoteAffordance block={block}>
            <DateBadge
              label="MAT." dateStr={block.materialInStock ? null : block.materialRequiredDate}
              overrideText={block.materialInStock ? "SKLADEM" : undefined}
              ok={block.materialInStock || materialDeadlineState === "ok"} warn={!block.materialInStock && materialDeadlineState === "warning"} danger={!block.materialInStock && materialDeadlineState === "danger"} earlyStart={!block.materialInStock && materialDeadlineState === "earlyStart"}
              accent={FIELD_ACCENT.MATERIAL}
              onToggle={block.materialInStock ? () => {} : () => toggleField("materialOk", block.materialOk)}
              onDoubleClick={canEditMat ? (rect) => onInlineDatePick?.(block.id, "material", block.materialRequiredDate ?? "", rect) : undefined}
              statusLabel={block.materialStatusLabel}
            />
          </MaterialNoteAffordance>
          <DateBadge
            label="EXP." dateStr={block.deadlineExpedice}
            ok={false} warn={false} danger={false} accent={FIELD_ACCENT.EXPEDICE}
            onToggle={() => {}}
          />
          {(block.pantoneRequiredDate || block.pantoneOk) && (
            <DateBadge
              label="PAN." dateStr={block.pantoneOk ? null : block.pantoneRequiredDate}
              overrideText={block.pantoneOk ? "OK" : undefined}
              ok={block.pantoneOk} warn={false} danger={false} accent={FIELD_ACCENT.PANTONE}
              onToggle={() => toggleField("pantoneOk", block.pantoneOk)}
              onDoubleClick={canEditMat ? (rect) => onInlineDatePick?.(block.id, "pantone", block.pantoneRequiredDate ?? "", rect) : undefined}
            />
          )}
        </div>
      )}

      {/* ── Řádek 2b: Kompaktní datum chipy (MODE_FULL, 48–59px — plný DateBadge se nevejde) ── */}
      {showDatesCompact && (() => {
        const dSK = !block.dataRequiredDate ? "empty" : dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
        const mSK = block.materialInStock ? "ok" : (!block.materialRequiredDate ? "empty" : materialDeadlineState === "none" ? "neutral" : materialDeadlineState);
        const eSK = !block.deadlineExpedice ? "empty" : "neutral";
        const pSK = !block.pantoneRequiredDate && !block.pantoneOk ? "empty" : block.pantoneOk ? "ok" : "neutral";
        const cs = (sk: string, fa: string, clickable: boolean): React.CSSProperties => ({
          fontSize: 9, fontWeight: 600,
          color: sk === "empty" ? "var(--text-muted)" : "rgba(255,255,255,0.90)",
          background: DEADLINE_BG[sk] ?? DEADLINE_BG.neutral,
          borderTop: `1px solid ${DEADLINE_BORDER[sk] ?? DEADLINE_BORDER.neutral}`, borderRight: `1px solid ${DEADLINE_BORDER[sk] ?? DEADLINE_BORDER.neutral}`, borderBottom: `1px solid ${DEADLINE_BORDER[sk] ?? DEADLINE_BORDER.neutral}`,
          borderLeft: `2px solid ${fa}`,
          borderRadius: 3, padding: "1px 5px 1px 4px",
          whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1,
          cursor: clickable ? "pointer" : "default",
        });
        const dIcon = dataDeadlineState === "ok" ? " ✓" : dataDeadlineState === "danger" ? " ✕" : dataDeadlineState === "warning" ? " !" : dataDeadlineState === "earlyStart" ? " ⚠" : "";
        const mIcon = materialDeadlineState === "ok" ? " ✓" : materialDeadlineState === "danger" ? " ✕" : materialDeadlineState === "warning" ? " !" : materialDeadlineState === "earlyStart" ? " ⚠" : "";
        return (
          <div style={{ padding: "0 7px 3px", display: "flex", gap: 4, flexShrink: 0, overflow: "hidden", alignItems: "center" }}>
            <span style={cs(dSK, FIELD_ACCENT.DATA, !!block.dataRequiredDate)}
              onClick={block.dataRequiredDate ? (e) => { e.stopPropagation(); if (canEditData && onInlineDatePick) { if (compactDataTimerRef.current) clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = setTimeout(() => { compactDataTimerRef.current = null; toggleField("dataOk", block.dataOk); }, 220); } else { toggleField("dataOk", block.dataOk); } } : undefined}
              onDoubleClick={canEditData && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactDataTimerRef.current) { clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = null; } onInlineDatePick(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
              D&nbsp;{block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}
            </span>
            <MaterialNoteAffordance indicatorSize={4} indicatorTop={1} indicatorRight={1} block={block}>
              <span style={cs(mSK, FIELD_ACCENT.MATERIAL, !!block.materialRequiredDate && !block.materialInStock)}
                onClick={block.materialRequiredDate && !block.materialInStock ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactMatTimerRef.current) clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = setTimeout(() => { compactMatTimerRef.current = null; toggleField("materialOk", block.materialOk); }, 220); } else { toggleField("materialOk", block.materialOk); } } : undefined}
                onDoubleClick={canEditMat && onInlineDatePick && !block.materialInStock ? (e) => { e.stopPropagation(); if (compactMatTimerRef.current) { clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = null; } onInlineDatePick(block.id, "material", block.materialRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                M&nbsp;{block.materialInStock ? "SKLAD" : block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${mIcon}` : "—"}
              </span>
            </MaterialNoteAffordance>
            <span style={cs(eSK, FIELD_ACCENT.EXPEDICE, false)}>
              E&nbsp;{block.deadlineExpedice ? fmtDateShort(block.deadlineExpedice) : "—"}
            </span>
            {(block.pantoneRequiredDate || block.pantoneOk) && (
              <span style={cs(pSK, FIELD_ACCENT.PANTONE, !!block.pantoneRequiredDate)}
                onClick={block.pantoneRequiredDate ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactPanTimerRef.current) clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = setTimeout(() => { compactPanTimerRef.current = null; toggleField("pantoneOk", block.pantoneOk); }, 220); } else { toggleField("pantoneOk", block.pantoneOk); } } : undefined}
                onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactPanTimerRef.current) { clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = null; } onInlineDatePick(block.id, "pantone", block.pantoneRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                P&nbsp;{block.pantoneOk ? "OK" : block.pantoneRequiredDate ? fmtDateShort(block.pantoneRequiredDate) : "—"}
              </span>
            )}
          </div>
        );
      })()}

      {/* ── Řádek 3: Specifikace (celý text) ── */}
      {showSpec && block.specifikace && (
        <div style={{ padding: "0 9px 3px", flexShrink: 0, position: "relative", zIndex: 2 }}>
          <span style={{
            fontSize: 10, color: s.textSub, opacity: 0.82, lineHeight: 1.3,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}>
            {block.specifikace}
          </span>
        </div>
      )}


      {/* Hotovo tlačítko pro TISKAR (FULL mode) */}
      {isTiskar && onPrintComplete && block.type === "ZAKAZKA" && MODE_FULL && (
        <div style={{ padding: "2px 7px 5px", display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setPrintPending(true); onPrintComplete(block.id, !isPrintDone).finally(() => setPrintPending(false)); }}
            disabled={printPending}
            style={{
              padding: "3px 10px", borderRadius: 5, border: "none",
              cursor: printPending ? "not-allowed" : "pointer",
              fontSize: 11, fontWeight: 600, fontFamily: "inherit",
              transition: "all 0.12s ease-out",
              background: isPrintDone ? "rgba(100,116,139,0.25)" : "rgba(34,197,94,0.3)",
              color: isPrintDone ? "var(--text-muted)" : "#22c55e",
              opacity: printPending ? 0.5 : 1,
            }}
          >
            {printPending ? "…" : isPrintDone ? "Vrátit hotovo" : "Hotovo"}
          </button>
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

      {/* ── Poznámka MTZ — inline editační popover (fixed = unikne overflow:hidden) ── */}
      {noteOpen && noteRect && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: noteRect.bottom + 6,
            left: Math.min(noteRect.left, window.innerWidth - 236),
            background: "#1c1c1e",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 12,
            padding: 12,
            width: 220,
            zIndex: 400,
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.45)", letterSpacing: 0.3 }}>
            POZNÁMKA MATERIÁL
          </p>
          <textarea
            ref={noteTextareaRef}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNote(); if (e.key === "Escape") setNoteOpen(false); }}
            rows={3}
            placeholder="Materiál skladem od…"
            style={{
              width: "100%", boxSizing: "border-box",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 8, padding: "7px 9px",
              fontSize: 13, lineHeight: 1.5,
              color: "rgba(255,255,255,0.9)",
              resize: "vertical",
              fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
            <button
              onClick={() => setNoteOpen(false)}
              style={{
                padding: "5px 12px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.14)",
                background: "transparent", color: "rgba(255,255,255,0.6)",
                fontSize: 12, fontWeight: 500, cursor: "pointer",
              }}
            >
              Zrušit
            </button>
            <button
              onClick={saveNote}
              disabled={noteSaving}
              style={{
                padding: "5px 12px", borderRadius: 7, border: "none",
                background: "#3b82f6", color: "#fff",
                fontSize: 12, fontWeight: 600, cursor: noteSaving ? "wait" : "pointer",
                opacity: noteSaving ? 0.7 : 1,
              }}
            >
              {noteSaving ? "Ukládám…" : "Uložit"}
            </button>
          </div>
        </div>
      )}

      {/* ── Indikátor specifikace — svislý proužek vpravo ── */}
      {block.specifikace && block.specifikace.length > 0 && !showSpec && (
        <div
          title="Obsahuje specifikaci"
          style={{
            position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)",
            width: 3, height: "55%", minHeight: 8, maxHeight: 22,
            borderRadius: 2, background: "rgba(251,191,36,0.8)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* ── Hover tooltip iOS-style pro malé bloky (< 60px) — portálovaný mimo stacking context ── */}
      {showTooltip && hovered && (() => {
        const rect = blockCardRef.current?.getBoundingClientRect();
        if (!rect || typeof document === "undefined") return null;
        const tooltipW = 240;
        const margin = 10;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Prefer right of block, fall back to left if not enough space
        const spaceRight = vw - rect.right - margin;
        const showRight = spaceRight >= tooltipW;
        const rawLeft = showRight ? rect.right + margin : rect.left - margin - tooltipW;
        // Clamp to viewport so tooltip never goes off-screen
        const left = Math.max(margin, Math.min(rawLeft, vw - tooltipW - margin));
        const top = Math.max(8, Math.min(rect.top, vh - 220));
        // Format time
        const startD = new Date(block.startTime);
        const endD   = new Date(block.endTime);
        const fmtTime = (d: Date) => d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
        const fmtDay  = (d: Date) => d.toLocaleDateString("cs-CZ", { day: "numeric", month: "short", timeZone: "Europe/Prague" });
        const sameDay = fmtDay(startD) === fmtDay(endD);
        const timeLabel = sameDay
          ? `${fmtDay(startD)}, ${fmtTime(startD)}–${fmtTime(endD)}`
          : `${fmtDay(startD)} ${fmtTime(startD)} – ${fmtDay(endD)} ${fmtTime(endD)}`;
        const machineLabel = block.machine === "XL_105" ? "XL 105" : "XL 106";
        const hasDateInfo = block.dataRequiredDate || block.materialRequiredDate || block.deadlineExpedice;
        return createPortal(
          <div style={{
            position: "fixed",
            left,
            top,
            width: tooltipW,
            zIndex: 9999,
            background: "rgba(28,28,30,0.88)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 14,
            padding: "12px 14px",
            pointerEvents: "none",
            boxShadow: "0 16px 48px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.25)",
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          }}>
            {/* Číslo zakázky + stroj */}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: block.description || block.specifikace ? 3 : 6 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.01em" }}>
                {block.orderNumber}
              </span>
              <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0, marginLeft: 8 }}>
                {machineLabel}
              </span>
            </div>
            {/* Popis */}
            {block.description && (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.4, marginBottom: block.specifikace ? 3 : 6 }}>
                {block.description}
              </div>
            )}
            {/* Specifikace */}
            {block.specifikace && (
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.42)", fontStyle: "italic", lineHeight: 1.35, marginBottom: 6 }}>
                {block.specifikace}
              </div>
            )}
            {/* Čas */}
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.4 }}>
              {timeLabel}
            </div>
            {/* Termíny */}
            {hasDateInfo && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: 4 }}>
                {block.dataRequiredDate && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10 }}>
                    <span style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.03em" }}>DATA</span>
                    <span style={{ color: block.dataOk ? "#30d158" : "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums" }}>
                      {fmtDate(block.dataRequiredDate)}{block.dataOk ? " ✓" : ""}
                    </span>
                  </div>
                )}
                {block.materialRequiredDate && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10 }}>
                    <span style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.03em" }}>MATERIÁL</span>
                    <span style={{ color: block.materialOk ? "#30d158" : "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums" }}>
                      {fmtDate(block.materialRequiredDate)}{block.materialOk ? " ✓" : ""}
                    </span>
                  </div>
                )}
                {block.deadlineExpedice && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10 }}>
                    <span style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.03em" }}>EXPEDICE</span>
                    <span style={{ color: "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums" }}>
                      {fmtDate(block.deadlineExpedice)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>,
          document.body
        );
      })()}
    </div>
  );

  if (!showMenu) return blockDiv;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        onContextMenu={(e: React.MouseEvent) => {
          splitAtRef.current  = getSplitAt?.(e.clientY) ?? null;
          ctxMouseRef.current = { x: e.clientX, y: e.clientY };
        }}
      >
        {blockDiv}
      </ContextMenuTrigger>
      <ContextMenuContent
        style={{ background: "#1c1c1e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "4px", minWidth: 180, zIndex: 500 }}
        onClick={(e) => e.stopPropagation()}
      >
        {canEdit && !block.locked && block.type === "ZAKAZKA" && (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger style={menuItemStyle}>
                Stav zakázky
              </ContextMenuSubTrigger>
              <ContextMenuSubContent style={{ background: "#1c1c1e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: 4, minWidth: 160 }}>
                {BLOCK_VARIANTS.map((v) => (
                  <ContextMenuItem key={v} onClick={() => onBlockVariantChange?.(block.id, v)} style={menuItemStyle}>
                    {block.blockVariant === v ? "✓ " : "\u00a0\u00a0"}{VARIANT_CONFIG[v].label}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
          </>
        )}
        {canEdit && !block.locked && (
          <>
            <ContextMenuItem
              onClick={() => onBlockCopy?.()}
              style={menuItemStyle}
            >
              ⎘ Kopírovat
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => { if (splitAtRef.current) onBlockSplit?.(splitAtRef.current); }}
              style={menuItemStyle}
            >
              ✂ Rozdělit blok
            </ContextMenuItem>
          </>
        )}
        {canEdit && !block.locked && (canEditMat || hasNote) && <ContextMenuSeparator />}
        {canEditMat && (
          <ContextMenuItem
            onClick={() => {
              const pos = ctxMouseRef.current;
              openNoteEditor(pos ? { bottom: pos.y + 4, left: pos.x } : null);
            }}
            style={menuItemStyle}
          >
            {hasNote ? "Upravit poznámku MTZ" : "Přidat poznámku MTZ"}
          </ContextMenuItem>
        )}
        {hasNote && canEditMat && (
          <ContextMenuItem
            onClick={clearNote}
            style={{ ...menuItemStyle, color: "rgba(255,80,80,0.9)" }}
          >
            Smazat poznámku MTZ
          </ContextMenuItem>
        )}
        {!canEditMat && hasNote && (
          <ContextMenuItem disabled style={{ ...menuItemStyle, color: "rgba(255,255,255,0.4)" }}>
            📌 Poznámka MTZ existuje
          </ContextMenuItem>
        )}
        {onPrintComplete && block.type === "ZAKAZKA" && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => onPrintComplete(block.id, !isPrintDone)}
              style={isPrintDone ? { ...menuItemStyle, color: "rgba(255,120,80,0.9)" } : menuItemStyle}
            >
              {isPrintDone ? "↩ Vrátit hotovo" : "✓ Označit jako hotovo"}
            </ContextMenuItem>
          </>
        )}
        {canEdit && block.type === "ZAKAZKA" && onNotify && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => onNotify(block.id, block.orderNumber)}
              style={menuItemStyle}
            >
              📣 Upozornit MTZ + DTP
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ─── TimelineGrid ──────────────────────────────────────────────────────────────
export default function TimelineGrid({
  blocks, filterText, selectedBlockId,
  onBlockClick, onBlockUpdate, onBlockCreate, scrollRef,
  queueDragItem, onQueueDrop, onQueueDragCancel, onBlockDoubleClick,
  companyDays,
  slotHeight = SLOT_HEIGHT,
  daysAhead,
  daysBack,
  copiedBlockId,
  onGridClick,
  onGridClickEmpty,
  onBlockCopy,
  selectedBlockIds,
  onMultiSelect,
  onMultiBlockUpdate,
  canEdit = true,
  canEditData = false,
  canEditMat = false,
  onError,
  onInfo,
  workingTimeLock = true,
  badgeColorMap = {},
  machineWorkHours,
  machineExceptions,
  onExceptionUpsert,
  onExceptionDelete,
  isTiskar,
  onPrintComplete,
  assignedMachine,
  onNotify,
  onBlockVariantChange,
}: TimelineGridProps) {
  const visibleMachines: string[] = assignedMachine ? [assignedMachine] : [...MACHINES];
  const effectiveDaysBack  = daysBack  ?? VIEW_DAYS_BACK;
  const effectiveDaysAhead = daysAhead ?? VIEW_DAYS_AHEAD;
  const totalDays  = effectiveDaysBack + effectiveDaysAhead + 1;
  const dayHeight  = slotHeight * 48;
  const totalHeight = totalDays * dayHeight;

  const [viewStart, setViewStart] = useState<Date | null>(null);
  const [now, setNow]             = useState<Date | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview>(null);
  const queuePreviewRefs = useRef<(HTMLDivElement | null)[]>([null, null]);
  const [lassoRect, setLassoRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [inlinePicker, setInlinePicker] = useState<{ blockId: number; field: "data" | "material" | "pantone"; currentValue: string; x: number; y: number } | null>(null);
  const [overlayDragPreview, setOverlayDragPreview] = useState<OverlayDragPreview>(null);
  const [hoveredOverlayKey, setHoveredOverlayKey] = useState<string | null>(null);

  const dragStateRef    = useRef<DragInternalState | null>(null);
  const dragDidMove     = useRef(false);
  const viewStartRef    = useRef<Date | null>(null);
  const slotHeightRef   = useRef(slotHeight);
  const colRefs         = useRef<(HTMLDivElement | null)[]>([null, null]);
  const callbacksRef    = useRef({ onBlockUpdate, onBlockCreate, onMultiSelect, onMultiBlockUpdate, onError, onInfo, onQueueDrop, onQueueDragCancel });
  const queueDragItemRef = useRef(queueDragItem ?? null);
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
    callbacksRef.current = { onBlockUpdate, onBlockCreate, onMultiSelect, onMultiBlockUpdate, onError, onInfo, onQueueDrop, onQueueDragCancel };
  }, [onBlockUpdate, onBlockCreate, onMultiSelect, onMultiBlockUpdate, onError, onInfo, onQueueDrop, onQueueDragCancel]);

  useEffect(() => { queueDragItemRef.current = queueDragItem ?? null; }, [queueDragItem]);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const start = startOfDay(addDays(new Date(), -effectiveDaysBack));
    setViewStart(start);
    viewStartRef.current = start;
  }, [effectiveDaysBack]);

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
    for (let i = 0; i < visibleMachines.length; i++) {
      const ref = colRefs.current[i];
      if (!ref) continue;
      const rect = ref.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) return visibleMachines[i];
    }
    return visibleMachines[0];
  }

  // ── Globální mouse listenery ───────────────────────────────────────────────
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      // ── Queue drag pohyb ──
      const qdItem = queueDragItemRef.current;
      if (qdItem) {
        const el = scrollRef.current;
        const vs = viewStartRef.current;
        const sh = slotHeightRef.current;
        const activeColIdx = visibleMachines.findIndex((_, i) => {
          const col = colRefs.current[i];
          if (!col) return false;
          const r = col.getBoundingClientRect();
          return e.clientX >= r.left && e.clientX <= r.right;
        });
        if (activeColIdx >= 0 && el && vs) {
          const rect = el.getBoundingClientRect();
          const previewHeight = qdItem.durationHours * 2 * sh;
          const timelineY = e.clientY - rect.top + el.scrollTop - previewHeight / 2;
          const snappedY = dateToY(snapToSlot(yToDate(timelineY, vs, sh)), vs, sh);
          const previewEl = queuePreviewRefs.current[activeColIdx];
          if (previewEl) {
            previewEl.style.top = `${snappedY}px`;
            previewEl.style.height = `${Math.max(previewHeight, sh)}px`;
            previewEl.style.display = "block";
          }
          queuePreviewRefs.current.forEach((r, i) => { if (i !== activeColIdx && r) r.style.display = "none"; });
        } else {
          queuePreviewRefs.current.forEach(r => { if (r) r.style.display = "none"; });
        }
        return;
      }

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
        const deltaSlots = Math.round(deltaY / sh);
        const newSlot = ds.edge === "start"
          ? Math.max(1, Math.min(ds.otherBoundarySlot - 1, ds.originalBoundarySlot + deltaSlots))
          : Math.max(ds.otherBoundarySlot + 1, Math.min(DAY_SLOT_COUNT - 1, ds.originalBoundarySlot + deltaSlots));
        setOverlayDragPreview({ machine: ds.machine, date: ds.date, edge: ds.edge, slot: newSlot, overlayKey: ds.overlayKey });
      }
    }

    async function onMouseUp(e: MouseEvent) {
      // ── Queue drag drop ──
      const qdItem = queueDragItemRef.current;
      if (qdItem) {
        queueDragItemRef.current = null; // okamžitě — zabraňuje duplicitnímu dropu při pomalé síti
        queuePreviewRefs.current.forEach(r => { if (r) r.style.display = "none"; });
        const el = scrollRef.current;
        const vs = viewStartRef.current;
        const sh = slotHeightRef.current;
        const activeColIdx = visibleMachines.findIndex((_, i) => {
          const col = colRefs.current[i];
          if (!col) return false;
          const r = col.getBoundingClientRect();
          return e.clientX >= r.left && e.clientX <= r.right;
        });
        if (activeColIdx >= 0 && el && vs) {
          const machine = visibleMachines[activeColIdx];
          const rect = el.getBoundingClientRect();
          const previewHeight = qdItem.durationHours * 2 * sh;
          const timelineY = e.clientY - rect.top + el.scrollTop - previewHeight / 2;
          const snappedStart = snapToSlot(yToDate(timelineY, vs, sh));
          callbacksRef.current.onQueueDrop?.(qdItem.id, machine, snappedStart);
        } else {
          callbacksRef.current.onQueueDragCancel?.();
        }
        return;
      }

      // ── Lasso puštění + hit testing ──
      if (lassoRef.current) {
        const lr = lassoRectRef.current;
        if (lassoRef.current.active && lr && lr.width > 5 && lr.height > 5) {
          const { left: lx, top: ly, width: lw, height: lh } = lr;
          const newSelected = new Set<number>();
          for (let i = 0; i < visibleMachines.length; i++) {
            const col = colRefs.current[i];
            if (!col) continue;
            const colRect = col.getBoundingClientRect();
            if (colRect.right < lx || colRect.left > lx + lw) continue;
            for (const block of blocksRef.current.filter(b => b.machine === visibleMachines[i])) {
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
        const requestedStart = snapToSlot(yToDate(originalTop + deltaY, vs, sh));
        let newStart = requestedStart;
        if (workingTimeLockRef.current) {
          newStart = snapToNextValidStartWithTemplates(newMachine, requestedStart, duration, machineWorkHoursRef.current ?? [], machineExceptionsRef.current);
          if (newStart.getTime() !== requestedStart.getTime()) {
            callbacksRef.current.onInfo?.("Blok přesunut mimo pracovní dobu — automaticky umístěn do nejbližšího dostupného slotu.");
          }
        }
        const newEnd      = new Date(newStart.getTime() + duration);
        try {
          const res     = await fetch(`/api/blocks/${ds.blockId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startTime: newStart.toISOString(), endTime: newEnd.toISOString(), machine: newMachine, bypassScheduleValidation: !workingTimeLockRef.current }) });
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
          const res     = await fetch(`/api/blocks/${ds.blockId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endTime: finalEnd >= minEnd ? finalEnd.toISOString() : minEnd.toISOString(), bypassScheduleValidation: !workingTimeLockRef.current }) });
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
          const { deltaMs: snapped, wasSnapped } = snapGroupDeltaWithTemplates(blocksOnNewMachine, deltaMs, machineWorkHoursRef.current ?? [], machineExceptionsRef.current);
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
        const deltaSlots = Math.round((e.clientY - ds.startClientY) / sh2);
        const newSlot = ds.edge === "start"
          ? Math.max(1, Math.min(ds.otherBoundarySlot - 1, ds.originalBoundarySlot + deltaSlots))
          : Math.max(ds.otherBoundarySlot + 1, Math.min(DAY_SLOT_COUNT - 1, ds.originalBoundarySlot + deltaSlots));
        const newStartSlot = ds.edge === "start" ? newSlot : ds.otherBoundarySlot;
        const newEndSlot   = ds.edge === "end"   ? newSlot : ds.otherBoundarySlot;
        setOverlayDragPreview(null);
        await exceptionCallbacksRef.current.onExceptionUpsert?.(ds.machine, ds.date, newStartSlot, newEndSlot, true);
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

  function calcSplitAt(clientY: number, block: Block): Date {
    const vs = viewStartRef.current;
    const mid = snapToSlot(new Date((new Date(block.startTime).getTime() + new Date(block.endTime).getTime()) / 2));
    if (!vs) return mid;
    const rawSplit = snapToSlot(yToDate(clientYToTimelineY(clientY), vs));
    const blockStart = new Date(block.startTime);
    const blockEnd   = new Date(block.endTime);
    return rawSplit > blockStart && rawSplit < blockEnd ? rawSplit : mid;
  }

  async function handleSplitBlockAt(block: Block, splitAt: Date) {
    try {
      // Krok 1: zkrátit původní blok
      const res1 = await fetch(`/api/blocks/${block.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endTime: splitAt.toISOString() }),
      });
      if (!res1.ok) {
        const err = await res1.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Nepodařilo se zkrátit blok.");
      }
      const updatedBlock: Block = await res1.json();

      // Krok 2: zajistit splitGroupId pro root blok (self-link pokud první split)
      let rootSplitGroupId: number;
      if (updatedBlock.splitGroupId != null) {
        rootSplitGroupId = updatedBlock.splitGroupId;
        onBlockUpdate(updatedBlock);
      } else {
        const res1b = await fetch(`/api/blocks/${block.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ splitGroupId: block.id }),
        });
        if (!res1b.ok) {
          const err = await res1b.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? "Nepodařilo se nastavit skupinu bloku.");
        }
        const rootBlock: Block = await res1b.json();
        onBlockUpdate(rootBlock);
        rootSplitGroupId = block.id;
      }

      // Krok 3: vytvořit nový blok jako sourozence
      const res2 = await fetch("/api/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber: block.orderNumber,
          machine: block.machine,
          type: block.type,
          blockVariant: block.blockVariant,
          startTime: splitAt.toISOString(),
          endTime: block.endTime,
          description: block.description,
          deadlineExpedice: block.deadlineExpedice,
          dataStatusId: block.dataStatusId,
          dataStatusLabel: block.dataStatusLabel,
          dataRequiredDate: block.dataRequiredDate,
          dataOk: block.dataOk,
          materialStatusId: block.materialStatusId,
          materialStatusLabel: block.materialStatusLabel,
          materialRequiredDate: block.materialRequiredDate,
          materialOk: block.materialOk,
          barvyStatusId: block.barvyStatusId,
          barvyStatusLabel: block.barvyStatusLabel,
          lakStatusId: block.lakStatusId,
          lakStatusLabel: block.lakStatusLabel,
          specifikace: block.specifikace,
          splitGroupId: rootSplitGroupId,
        }),
      });
      if (!res2.ok) {
        const err = await res2.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Nepodařilo se vytvořit druhý blok.");
      }
      onBlockCreate(await res2.json());
    } catch (error) {
      console.error("Block split failed", error);
      callbacksRef.current.onError?.((error instanceof Error ? error.message : null) ?? "Blok se nepodařilo rozdělit.");
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
      {visibleMachines.flatMap((machine, idx) => [
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

  const viewEnd = addDays(viewStart, totalDays);
  const viewStartMs = viewStart.getTime();
  const viewEndMs = viewEnd.getTime();
  const visibleBlocksByMachine = new Map<string, Block[]>(visibleMachines.map((machine) => [machine, []]));
  for (const block of blocks) {
    const bucket = visibleBlocksByMachine.get(block.machine);
    if (!bucket) continue;
    const blockStartMs = new Date(block.startTime).getTime();
    const blockEndMs = new Date(block.endTime).getTime();
    if (Number.isNaN(blockStartMs) || Number.isNaN(blockEndMs)) continue;
    if (blockStartMs < viewEndMs && blockEndMs > viewStartMs) {
      bucket.push(block);
    }
  }

  // ── Precompute split group map — O(n) místo O(n²) v machineBlocks.map() ───
  const splitGroupMap = (() => {
    const map = new Map<number, Block[]>();
    for (const b of blocks) {
      if (b.splitGroupId == null) continue;
      const gid = b.splitGroupId;
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid)!.push(b);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }
    return map;
  })();

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

  type HalfHourMark = { y: number; label: string; isFullHour: boolean; isLabel: boolean; key: string };
  const halfHourMarkers: HalfHourMark[] = [];
  // Kolik slotů (po 30 min) přeskočit mezi viditelnými štítky
  const labelStep = slotHeight >= 14 ? 1 : slotHeight >= 7 ? 2 : slotHeight >= 4 ? 4 : 8;

  const blockedOverlays: Record<string, BlockedOverlay[]> = { XL_105: [], XL_106: [] };

  // Předpočítané Prague date rozsahy pro company days — Prague midnight ≠ UTC midnight
  const companyDayPragueRanges = companyDays?.map((cd) => ({
    cd,
    startPrague: utcToPragueDateStr(new Date(cd.startDate)),
    endPrague:   utcToPragueDateStr(new Date(cd.endDate)),
  })) ?? [];

  for (let di = 0; di < totalDays; di++) {
    const day      = addDays(viewStart, di);
    const dayY     = dateToY(day, viewStart, slotHeight);
    const dow      = day.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isToday  = isSameDay(day, todayDate);
    const dateStr  = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const isHoliday = holidays.has(dateStr);
    const companyDayMatch = companyDayPragueRanges.find(({ startPrague, endPrague }) => dateStr >= startPrague && dateStr <= endPrague)?.cd;
    days.push({ date: day, y: dayY, isWeekend, isToday, isHoliday, isCompanyDay: !!companyDayMatch, companyDayLabel: companyDayMatch?.label });
    // Blocked overlays — výjimka přebíjí šablonu, fallback na hardcoded
    for (const machine of visibleMachines) {
      const exc = machineExceptions?.find(
        (e) => e.machine === machine && e.date.slice(0, 10) === dateStr
      );
      const resolvedRows = machineWorkHours ? resolveScheduleRows(machine, day, machineWorkHours) : [];
      const row = exc ?? resolvedRows.find((r) => r.dayOfWeek === dow);
      const isException = !!exc;
      const excId = exc?.id ?? null;

      if (!row) {
        // Fallback: původní hardcoded logika (bez interakce)
        if (machine === "XL_105") {
          if (dow === 6 || dow === 0) {
            blockedOverlays.XL_105.push({ top: dayY, height: dayHeight, key: `b105-we-${di}`, date: day, machine, overlayType: "full-block", effectiveStartSlot: 0, effectiveEndSlot: DAY_SLOT_COUNT, isException: false, exceptionId: null });
          } else {
            blockedOverlays.XL_105.push({ top: dayY, height: WORK_START_SLOT * slotHeight, key: `b105-ns-${di}`, date: day, machine, overlayType: "start-block", effectiveStartSlot: 0, effectiveEndSlot: WORK_START_SLOT, isException: false, exceptionId: null });
            blockedOverlays.XL_105.push({ top: dayY + WORK_END_SLOT * slotHeight, height: (DAY_SLOT_COUNT - WORK_END_SLOT) * slotHeight, key: `b105-ne-${di}`, date: day, machine, overlayType: "end-block", effectiveStartSlot: WORK_END_SLOT, effectiveEndSlot: DAY_SLOT_COUNT, isException: false, exceptionId: null });
          }
        } else {
          if (dow === 6) {
            blockedOverlays.XL_106.push({ top: dayY, height: dayHeight, key: `b106-sat-${di}`, date: day, machine, overlayType: "full-block", effectiveStartSlot: 0, effectiveEndSlot: DAY_SLOT_COUNT, isException: false, exceptionId: null });
          } else if (dow === 0) {
            blockedOverlays.XL_106.push({ top: dayY, height: WORK_END_SLOT * slotHeight, key: `b106-sun-${di}`, date: day, machine, overlayType: "start-block", effectiveStartSlot: 0, effectiveEndSlot: WORK_END_SLOT, isException: false, exceptionId: null });
          } else if (dow === 5) {
            blockedOverlays.XL_106.push({ top: dayY + WORK_END_SLOT * slotHeight, height: (DAY_SLOT_COUNT - WORK_END_SLOT) * slotHeight, key: `b106-fri-${di}`, date: day, machine, overlayType: "end-block", effectiveStartSlot: WORK_END_SLOT, effectiveEndSlot: DAY_SLOT_COUNT, isException: false, exceptionId: null });
          }
        }
      } else if (!row.isActive) {
        blockedOverlays[machine].push({ top: dayY, height: dayHeight, key: `b-${machine}-off-${di}`, date: day, machine, overlayType: "full-block", effectiveStartSlot: 0, effectiveEndSlot: DAY_SLOT_COUNT, isException, exceptionId: excId });
      } else {
        const rowRange = getSlotRange(row);
        if (rowRange.startSlot > 0) {
          blockedOverlays[machine].push({ top: dayY, height: rowRange.startSlot * slotHeight, key: `b-${machine}-ns-${di}`, date: day, machine, overlayType: "start-block", effectiveStartSlot: 0, effectiveEndSlot: rowRange.startSlot, isException, exceptionId: excId });
        }
        if (rowRange.endSlot < DAY_SLOT_COUNT) {
          blockedOverlays[machine].push({ top: dayY + rowRange.endSlot * slotHeight, height: (DAY_SLOT_COUNT - rowRange.endSlot) * slotHeight, key: `b-${machine}-ne-${di}`, date: day, machine, overlayType: "end-block", effectiveStartSlot: rowRange.endSlot, effectiveEndSlot: DAY_SLOT_COUNT, isException, exceptionId: excId });
        }
      }
    }
    for (let s = 0; s < 48; s++) {
      const h = Math.floor(s / 2);
      const m = s % 2 === 0 ? "00" : "30";
      halfHourMarkers.push({ y: dayY + s * slotHeight, label: `${String(h).padStart(2, "0")}:${m}`, isFullHour: m === "00", isLabel: s % labelStep === 0, key: `${di}-${s}` });
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
          <div
            style={{ width: TIME_COL_W, flexShrink: 0, position: "relative", zIndex: 9, borderRight: "1px solid var(--border)", backgroundColor: "var(--surface)", userSelect: "none" }}
            onMouseDown={canEdit ? (e) => {
              if (e.button !== 0) return;
              if (dragStateRef.current) return;
              lassoRef.current = { startClientX: e.clientX, startClientY: e.clientY, active: false };
              e.preventDefault();
            } : undefined}
          >
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
                <div key={`ct-${cd.id}`} style={{ position: "absolute", top: clampedTop, height, left: 0, right: 0, backgroundColor: "rgba(220,38,38,0.22)", backgroundImage: "repeating-linear-gradient(-45deg, rgba(185,28,28,0.45) 0px, rgba(185,28,28,0.45) 4px, transparent 4px, transparent 9px)", pointerEvents: "none", overflow: "hidden" }}>
                  {cd.label && height >= 18 && (
                    <div title={cd.label} style={COMPANY_DAY_CHIP_STYLE}>{cd.label}</div>
                  )}
                </div>
              );
            })}
            {halfHourMarkers.filter((m) => m.isLabel).map((m) => (
              <div
                key={m.key}
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
          {visibleMachines.map((machine, colIdx) => {
            const machineBlocks = visibleBlocksByMachine.get(machine) ?? [];

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
                        key={m.key}
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
                onMouseDown={canEdit ? (e) => {
                  if (e.button !== 0) return;
                  if ((e.target as HTMLElement).closest("[data-block]")) return;
                  if (dragStateRef.current) return;
                  lassoRef.current = { startClientX: e.clientX, startClientY: e.clientY, active: false };
                  e.preventDefault();
                } : undefined}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("[data-block]")) return;
                  onGridClickEmpty?.();
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
                  // Dynamické hranice ze schedule (union přes oba stroje) — per-datum resolve
                  const allResolvedRows = machineWorkHours
                    ? visibleMachines.flatMap((m) => resolveScheduleRows(m, d.date, machineWorkHours))
                    : [];
                  const activeMachines = allResolvedRows.filter((r) => r.dayOfWeek === dow && r.isActive);
                  const nightEnd   = activeMachines.length > 0 ? Math.min(...activeMachines.map((r) => slotToHour(getSlotRange(r).startSlot))) : WORK_START_H;
                  const nightStart = activeMachines.length > 0 ? Math.max(...activeMachines.map((r) => slotToHour(getSlotRange(r).endSlot)))   : WORK_END_H;
                  const midpoint   = Math.round((nightEnd + nightStart) / 2); // střed pracovního okna (pro ranní/odpolední split)
                  return (
                    <Fragment key={`dayshade-${d.y}`}>
                      {/* Základní tón každého druhého dne + směnové pruhy — skryté na víkendech a odstávkách */}
                      {/* Základní tón každého druhého dne — jen pro pracovní dny bez červeného šrafování */}
                      {!isEven && !d.isWeekend && !d.isCompanyDay && <div className="tl-day-alt" style={{ position: "absolute", top: d.y, height: dayHeight, left: 0, right: 0, pointerEvents: "none" }} />}
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
                    <div key={`c-${cd.id}`} style={{ position: "absolute", top: clampedTop, height, left: 0, right: 0, backgroundColor: "rgba(220,38,38,0.22)", backgroundImage: "repeating-linear-gradient(-45deg, rgba(185,28,28,0.45) 0px, rgba(185,28,28,0.45) 4px, transparent 4px, transparent 9px)", pointerEvents: "none", overflow: "hidden" }}>
                      {cd.label && height >= 18 && (
                        <div title={cd.label} style={{ position: "absolute", top: 4, left: 8, height: 14, padding: "0 5px", borderRadius: 3, background: "rgba(153,27,27,0.85)", color: "#fecaca", fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "calc(100% - 16px)", display: "flex", alignItems: "center", lineHeight: 1 }}>
                          {cd.label}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Blokované časy — víkendy + noční XL_105 (červená, interaktivní) */}
                {blockedOverlays[machine]?.map((n) => {
                  const borderStyle = n.isException ? "2px dashed rgba(56,189,248,0.7)" : "none";
                  // Live drag preview — pokud táhneme hranu tohoto overlaye
                  const isBeingDragged = overlayDragPreview?.overlayKey === n.key;
                  let renderTop = n.top;
                  let renderHeight = n.height;
                  if (isBeingDragged && overlayDragPreview) {
                    const dayYforOverlay = n.top - n.effectiveStartSlot * slotHeight;
                    if (overlayDragPreview.edge === "start") {
                      // spodní handle: blok 0..dragSlot
                      renderTop = dayYforOverlay;
                      renderHeight = overlayDragPreview.slot * slotHeight;
                    } else {
                      // horní handle: blok dragSlot..24h
                      renderTop = dayYforOverlay + overlayDragPreview.slot * slotHeight;
                      renderHeight = (DAY_SLOT_COUNT - overlayDragPreview.slot) * slotHeight;
                    }
                  }
                  return (
                    <div
                      key={n.key}
                      style={{ position: "absolute", top: renderTop, height: renderHeight, left: 0, right: 0, backgroundColor: "rgba(220,38,38,0.18)", backgroundImage: "repeating-linear-gradient(-45deg, rgba(185,28,28,0.38) 0px, rgba(185,28,28,0.38) 4px, transparent 4px, transparent 9px)", pointerEvents: "none", border: borderStyle, boxSizing: "border-box", transition: isBeingDragged ? "none" : "opacity 100ms", zIndex: 2 }}
                    >
                      {/* × tlačítko */}
                      {canEdit && (
                        <button
                          style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: "50%", background: "rgba(239,68,68,0.9)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700, lineHeight: 1, zIndex: 10, pointerEvents: "auto" }}
                          onMouseEnter={() => setHoveredOverlayKey(n.key)}
                          onMouseLeave={() => setHoveredOverlayKey(null)}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (n.isException && n.exceptionId) {
                              await exceptionCallbacksRef.current.onExceptionDelete?.(n.exceptionId);
                            } else {
                              if (n.overlayType === "full-block") {
                                // Celý den byl blokovaný — výjimka: celý den provoz
                                await exceptionCallbacksRef.current.onExceptionUpsert?.(n.machine, n.date, 0, DAY_SLOT_COUNT, true);
                              } else if (n.overlayType === "start-block") {
                                // Odstraň ranní blokaci: work starts at 0, endSlot = z end-block (nebo konec dne)
                                const endPartner = blockedOverlays[machine].find(x => x.overlayType === "end-block" && x.date.toDateString() === n.date.toDateString());
                                const endSlot = endPartner?.effectiveStartSlot ?? DAY_SLOT_COUNT;
                                await exceptionCallbacksRef.current.onExceptionUpsert?.(n.machine, n.date, 0, endSlot, true);
                              } else {
                                // Odstraň noční blokaci: work ends at konec dne, startSlot = ze start-block (nebo 0)
                                const startPartner = blockedOverlays[machine].find(x => x.overlayType === "start-block" && x.date.toDateString() === n.date.toDateString());
                                const startSlot = startPartner?.effectiveEndSlot ?? 0;
                                await exceptionCallbacksRef.current.onExceptionUpsert?.(n.machine, n.date, startSlot, DAY_SLOT_COUNT, true);
                              }
                            }
                          }}
                        >×</button>
                      )}
                      {/* Horní handle — jen pro end-block (táhne workEnd nahoru/dolů) */}
                      {canEdit && n.overlayType === "end-block" && (
                        <div
                          style={{ position: "absolute", top: 2, left: "50%", transform: "translateX(-50%)", width: 28, height: 8, borderRadius: 4, background: "rgba(239,68,68,0.7)", cursor: "ns-resize", zIndex: 10, pointerEvents: "auto" }}
                          onMouseEnter={() => setHoveredOverlayKey(n.key)}
                          onMouseLeave={() => setHoveredOverlayKey(null)}
                          onMouseDown={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            const workStart = blockedOverlays[machine].find(
                              x => x.overlayType === "start-block" && x.date.toDateString() === n.date.toDateString()
                            )?.effectiveEndSlot ?? 0;
                            dragStateRef.current = { type: "overlay-resize", machine: n.machine, date: n.date, edge: "end", originalBoundarySlot: n.effectiveStartSlot, otherBoundarySlot: workStart, startClientY: e.clientY, overlayKey: n.key };
                            dragDidMove.current = false;
                          }}
                        />
                      )}
                      {/* Spodní handle — jen pro start-block (táhne workStart nahoru/dolů) */}
                      {canEdit && n.overlayType === "start-block" && (
                        <div
                          style={{ position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)", width: 28, height: 8, borderRadius: 4, background: "rgba(239,68,68,0.7)", cursor: "ns-resize", zIndex: 10, pointerEvents: "auto" }}
                          onMouseEnter={() => setHoveredOverlayKey(n.key)}
                          onMouseLeave={() => setHoveredOverlayKey(null)}
                          onMouseDown={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            const workEnd = blockedOverlays[machine].find(
                              x => x.overlayType === "end-block" && x.date.toDateString() === n.date.toDateString()
                            )?.effectiveStartSlot ?? DAY_SLOT_COUNT;
                            dragStateRef.current = { type: "overlay-resize", machine: n.machine, date: n.date, edge: "start", originalBoundarySlot: n.effectiveEndSlot, otherBoundarySlot: workEnd, startClientY: e.clientY, overlayKey: n.key };
                            dragDidMove.current = false;
                          }}
                        />
                      )}
                    </div>
                  );
                })}

                {/* Denní oddělovače — skryté jen když je červené šrafování na OBOU stranách přechodu */}
                {days.map((d, di) => {
                  const prevEndsHere  = di > 0 && blockedOverlays[machine]?.some(n => n.top + n.height === d.y);
                  const thisStartsHere = blockedOverlays[machine]?.some(n => n.top === d.y);
                  if (prevEndsHere && thisStartsHere) return null;
                  return <div key={d.y} style={{ position: "absolute", top: d.y, left: 0, right: 0, height: 1, backgroundColor: "color-mix(in oklab, var(--border) 85%, transparent)" }} />;
                })}

                {/* Hodinové čáry */}
                {halfHourMarkers.filter((m) => m.isLabel && m.isFullHour).map((m) => (
                  <div key={m.key} style={{ position: "absolute", top: m.y, left: 0, right: 0, height: 1, backgroundColor: "color-mix(in oklab, var(--border) 70%, transparent)" }} />
                ))}

                {/* Půlhodinové čáry */}
                {halfHourMarkers.filter((m) => m.isLabel && !m.isFullHour).map((m) => (
                  <div key={m.key} style={{ position: "absolute", top: m.y, left: 0, right: 0, height: 1, backgroundColor: "color-mix(in oklab, var(--border) 45%, transparent)" }} />
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
                  const blockMatchesFilter = filter === "" || [block.orderNumber, block.description, block.specifikace, block.jobPresetLabel].some(f => f?.toLowerCase().includes(filter));
                  const dimmed   = (!blockMatchesFilter) || !!isThisBlockDragging;
                  const selected = !isThisBlockDragging && block.id === selectedBlockId;
                  // Split skupina — O(1) lookup z předpočítané mapy
                  const splitSiblings = block.splitGroupId != null ? (splitGroupMap.get(block.splitGroupId) ?? []) : [];
                  const splitTotal = splitSiblings.length > 1 ? splitSiblings.length : 0;
                  const splitPart  = splitTotal > 0 ? splitSiblings.findIndex(b => b.id === block.id) + 1 : 0;

                  return (
                    <BlockCard
                      key={block.id}
                      block={block}
                      splitPart={splitPart}
                      splitTotal={splitTotal}
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
                      onBlockUpdate={callbacksRef.current.onBlockUpdate}
                      onError={callbacksRef.current.onError}
                      canEdit={canEdit}
                      canEditData={canEditData}
                      canEditMat={canEditMat}
                      onBlockCopy={() => onBlockCopy?.(block)}
                      onBlockSplit={(splitAt) => handleSplitBlockAt(block, splitAt)}
                      getSplitAt={(clientY) => calcSplitAt(clientY, block)}
                      onInlineDatePick={(blockId, field, currentValue, rect) => {
                        setInlinePicker({ blockId, field, currentValue, x: rect.left, y: rect.bottom });
                      }}
                      badgeColorMap={badgeColorMap}
                      isTiskar={isTiskar}
                      onPrintComplete={onPrintComplete}
                      onNotify={onNotify}
                      onBlockVariantChange={onBlockVariantChange}
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

                {/* Náhled při přetahování z fronty — DOM ref, žádný re-render */}
                <div
                  ref={(el) => { queuePreviewRefs.current[colIdx] = el; }}
                  style={{
                    display: "none",
                    position: "absolute",
                    top: 0, height: 0,
                    left: 3, width: "calc(100% - 6px)",
                    borderRadius: 4,
                    backgroundColor: "rgba(36,132,245,0.18)",
                    border: "2px dashed rgba(36,132,245,0.6)",
                    pointerEvents: "none",
                    zIndex: 15,
                  }}
                />
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
            const f = inlinePicker.field;
            const field = f === "material" ? "materialRequiredDate" : f === "pantone" ? "pantoneRequiredDate" : "dataRequiredDate";
            try {
              const res = await fetch(`/api/blocks/${inlinePicker.blockId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(f === "material" ? { [field]: dateStr, materialInStock: false } : { [field]: dateStr }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const updated = await res.json();
              callbacksRef.current.onBlockUpdate(updated);
            } catch (err) {
              console.error("Inline date pick failed", err);
              callbacksRef.current.onError?.("Nepodařilo se uložit datum.");
            }
          }}
          onPickSkladem={inlinePicker.field === "material" ? async () => {
            setInlinePicker(null);
            try {
              const res = await fetch(`/api/blocks/${inlinePicker.blockId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ materialInStock: true }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const updated = await res.json();
              callbacksRef.current.onBlockUpdate(updated);
            } catch (err) {
              console.error("Inline skladem failed", err);
              callbacksRef.current.onError?.("Nepodařilo se uložit.");
            }
          } : undefined}
        />
      )}


    </div>
  );
}
