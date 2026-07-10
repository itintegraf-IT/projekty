"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { snapGroupDeltaWithTemplates, snapToNextValidStartWithTemplates } from "@/lib/workingTime";
import { computePrintMinutes, expandPrintTime, isMachineRunnableAt, snapStartToNextRunnableSlot, type CompanyDayInterval } from "@/lib/printTime";
import { blockCalendarDrift, blockPrintMinutes, companyDayIntervalsFor, formatPrintHoursShort, getBlockSegments, printMidpoint, snapGroupDeltaStartOnly, splitGroupTotalPrintMinutes, type CalendarDriftInfo, type PrintSegment } from "@/lib/printTimeClient";
import {
  addDaysToCivilDate,
  civilDateDayOfWeek,
  civilDateFromParts,
  civilDateParts,
  civilDateToUTCMidnight,
  daysInCivilMonth,
  diffCivilDateDays,
  formatPragueDateShort,
  formatPragueDateTime,
  normalizeCivilDateInput,
  pragueOf,
  pragueToUTC,
  todayPragueDateStr,
  utcToPragueDateStr,
} from "@/lib/dateUtils";
import { badgeColorVar } from "@/lib/badgeColors";
import { computeShadeParity } from "@/lib/blockShades";
import { formatProductionTypeChip, PRODUCTION_CHIP_COLORS } from "@/lib/productionTags";
import { BLOCK_VARIANTS, VARIANT_CONFIG, type BlockVariant } from "@/lib/blockVariants";
import { DAY_SLOT_COUNT } from "@/lib/timeSlots";
import { Lock, Clock, Hourglass } from "lucide-react";
import { type MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { resolveScheduleRows, resolveDayIntervals } from "@/lib/scheduleValidation";
import { SHIFT_HOURS } from "@/lib/shifts";
import { ShiftEdgeHandles } from "@/components/planner/ShiftEdgeHandles";
import { SplitChip } from "@/components/SplitChip";
import { findSplitPartner, getSplitChipState } from "@/lib/splitHelpers";
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
  printMinutes?: number | null;
  scheduleBypassed?: boolean;
  blockVariant?: BlockVariant | null;
  jobPresetId: number | null;
  jobPresetLabel: string | null;
  description: string | null;
  locked: boolean;
  deadlineExpedice: string | null;
  // Expediční plán
  expediceNote: string | null;
  doprava: string | null;
  expeditionPublishedAt: string | null;
  expeditionSortOrder: number | null;
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
  materialIssued: boolean;
  // Výrobní sloupečky — PANTONE
  pantoneRequiredDate: string | null;
  pantoneOk: boolean;
  pantoneRequired: boolean;
  // Výrobní sloupečky — BARVY
  barvyStatusId: number | null;
  barvyStatusLabel: string | null;
  // Výrobní sloupečky — LAK
  lakStatusId: number | null;
  lakStatusLabel: string | null;
  // Výrobní sloupečky — SPECIFIKACE
  specifikace: string | null;
  // Výrobní štítky — OBÁLKA / VNITŘKY + multi-select metadata
  obalka?: boolean;
  vnitrky?: boolean;
  tiskoveArchy?: string | null;
  serie?: string | null;
  // Poznámka MTZ k materiálu
  materialNote: string | null;
  materialNoteByUsername: string | null;
  // Tiskařské poznámky (pole, řazené DESC podle createdAt) — viditelné jen pro ADMIN/PLANOVAT/TISKAR
  notes?: Array<{
    id: number;
    blockId: number;
    text: string;
    createdAt: string;
    updatedAt: string;
    createdByUserId: number;
    createdByUsername: string;
  }>;
  recurrenceType: string;
  recurrenceParentId: number | null;
  splitGroupId: number | null;
  printCompletedAt: string | null;
  printCompletedByUserId: number | null;
  printCompletedByUsername: string | null;
  reservationId: number | null;
  reservationConfirmedAt: string | null;
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

type DragInternalState =
  | {
      type: "move" | "resize";
      blockId: number;
      originalMachine: string;
      startClientY: number;
      startClientX: number;
      startScrollTop: number;
      originalStart: Date;
      originalEnd: Date;
    }
  | {
      type: "multi-move";
      blocks: Array<{ id: number; machine: string; type: string; originalStart: Date; originalEnd: Date }>;
      startClientY: number;
      startClientX: number;
      startScrollTop: number;
      anchorBlockId: number;
    }
  | {
      type: "shift-edge-resize";
      machine: string;
      date: Date;
      shift: "MORNING" | "AFTERNOON" | "NIGHT";
      edge: "start" | "end";
      origMin: number;
      startClientY: number;
      startScrollTop: number;
      jointDrag: boolean;
    };

// Validation ranges for shift-edge handles (in minutes from midnight)
function rangeFor(shift: "MORNING" | "AFTERNOON" | "NIGHT", edge: "start" | "end"): [number, number] {
  if (shift === "MORNING") return edge === "start" ? [240, 480] : [720, 960];
  if (shift === "AFTERNOON") return edge === "start" ? [720, 960] : [1200, 1440];
  // NIGHT
  return edge === "start" ? [1200, 1440] : [240, 480];
}

type DragPreview = {
  blockId: number;
  top: number;
  height: number;
  machine: string;
  resizeEnd?: Date;
  resizeStart?: Date;
  /** Tiskové minuty v okně [resizeStart, resizeEnd) — jen pro honest resize (ZAKAZKA + lock).
   *  Když je vyplněno, tooltip ukazuje "X h tisku (Y h celkem)" místo prosté délky. */
  resizePrintMinutes?: number;
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
  canEditDataDate?: boolean;
  canEditMat?: boolean;
  onDataChipDoubleClick?: (blockId: number, rect: DOMRect) => void;
  onError?: (msg: string) => void;
  onInfo?: (msg: string) => void;
  workingTimeLock?: boolean;
  badgeColorMap?: Record<number, string | null>;
  machineWeekShifts?: MachineWeekShiftsRow[];
  isTiskar?: boolean;
  onPrintComplete?: (blockId: number, completed: boolean) => Promise<void>;
  assignedMachine?: string | null;
  onNotify?: (blockId: number, orderNumber: string) => void;
  onBlockVariantChange?: (blockId: number, variant: BlockVariant) => void;
  onExpeditionPublish?:   (blockId: number) => Promise<void>;
  onExpeditionUnpublish?: (blockId: number) => Promise<void>;
  onOpenNotes?: (block: Block) => void;
  onShiftBoundsChange?: (
    machine: string,
    date: Date,
    shift: "MORNING" | "AFTERNOON" | "NIGHT",
    edge: "start" | "end",
    newMin: number | null,
    joint?: boolean,
  ) => Promise<void>;
  onSplitChipClick?: (partnerId: number) => void;
  pasteTarget?: { machine: string; time: Date } | null;
  clipboardHasContent?: boolean;
  /** Délka zdrojového bloku v ms — používá se pro snap markeru na pracovní dobu,
   *  aby marker ukazoval stejnou pozici, na kterou skutečný paste vloží blok.
   *  Pro ZAKAZKA zdroj je to tiskové minuty (blockPrintMinutes) × 60000, ne elapsed. */
  pasteSlotDurationMs?: number;
  /** True, když zdroj schránky je ZAKAZKA (single i celá skupina) — marker pak
   *  používá start-only snap přes tiskové hodiny (snapStartToNextRunnableSlot),
   *  stejně jako handlePaste/handleGroupPaste v PlannerPage. */
  pasteSourceIsZakazka?: boolean;
  /** Pravým klikem na prázdný grid — nastaví pasteTarget a okamžitě vloží blok. */
  onPasteHere?: (machine: string, time: Date) => void;
  /** Banner stroje „Přepočítat" (hromadný reflow driftujících bloků) — implementace
   *  (fetch + confirm + toast) žije v PlannerPage, TimelineGrid jen renderuje chip/tlačítko. */
  onReflowMachine?: (machine: string) => Promise<void>;
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
function easterDateStr(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return civilDateFromParts(year, month, day);
}

function czechHolidaySet(year: number): Set<string> {
  const s = new Set([
    `${year}-01-01`, `${year}-05-01`, `${year}-05-08`,
    `${year}-07-05`, `${year}-07-06`, `${year}-09-28`,
    `${year}-10-28`, `${year}-11-17`,
    `${year}-12-24`, `${year}-12-25`, `${year}-12-26`,
  ]);
  const easter = easterDateStr(year);
  s.add(addDaysToCivilDate(easter, -2));
  s.add(addDaysToCivilDate(easter, 1));
  return s;
}

// XL_105: 2 směny (6–14, 14–22), noční neprovozuje → weekend Pá 22:00–Po 06:00
// XL_106: 3 směny = 24h provoz → weekend Pá 22:00–Ne 22:00

// ─── Pomocné funkce ────────────────────────────────────────────────────────────
export function dateToY(date: Date, viewStart: Date, slotHeight = SLOT_HEIGHT): number {
  const viewStartDateStr = utcToPragueDateStr(viewStart);
  const target = pragueOf(date);
  const dayOffset = diffCivilDateDays(viewStartDateStr, target.dateStr);
  const totalSlots = dayOffset * DAY_SLOT_COUNT + target.hour * 2 + target.minute / 30;
  return totalSlots * slotHeight;
}

function yToDate(y: number, viewStart: Date, slotHeight = SLOT_HEIGHT): Date {
  const viewStartDateStr = utcToPragueDateStr(viewStart);
  const totalMinutes = Math.round((y / slotHeight) * 30);
  const dayOffset = Math.floor(totalMinutes / (DAY_SLOT_COUNT * 30));
  const minuteOfDay = totalMinutes - dayOffset * DAY_SLOT_COUNT * 30;
  const dateStr = addDaysToCivilDate(viewStartDateStr, dayOffset);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return pragueToUTC(dateStr, hour, minute);
}

function snapToSlot(date: Date): Date {
  const { dateStr, hour, minute } = pragueOf(date);
  const totalMinutes = hour * 60 + minute;
  const snappedMinutes = Math.round(totalMinutes / 30) * 30;
  const dayOffset = Math.floor(snappedMinutes / (DAY_SLOT_COUNT * 30));
  const minuteOfDay = snappedMinutes - dayOffset * DAY_SLOT_COUNT * 30;
  const targetDateStr = addDaysToCivilDate(dateStr, dayOffset);
  const targetHour = Math.floor(minuteOfDay / 60);
  const targetMinute = minuteOfDay % 60;
  return pragueToUTC(targetDateStr, targetHour, targetMinute);
}

// ─── Honest preview cache (poctivé náhledy přes tiskové hodiny) ───────────────
// mousemove střílí kontinuálně — expanze (walk přes weekShifts+companyDays) se
// smí spočítat max 1× per kandidátní slot, ne 1× per pixel. Cache je module-scope
// (přežívá remounty komponenty), klíčovaná na `${machine}|${startMs}|${printMinutes}`
// a čistí se při každém mousedown (handleBlockMouseDown/handleResizeMouseDown) —
// staré weekShifts/companyDays reference by jinak mohly vrátit zastaralý výsledek
// po jejich změně (řeší se čištěním, ne invalidací podle referencí — cache je malá
// a žije jen po dobu jednoho dragu).
const previewExpandCache = new Map<string, ReturnType<typeof expandPrintTime>>();

function clearPreviewExpandCache() {
  previewExpandCache.clear();
}

/** Memo wrapper nad expandPrintTime pro live náhledy. Nikdy nevyhazuje — expanze
 *  se selhá vrátí jako ok:false, aby volající mohl spadnout na naivní matematiku. */
function expandPrintTimeCached(
  machine: string,
  start: Date,
  printMinutes: number,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[]
): ReturnType<typeof expandPrintTime> {
  const key = `${machine}|${start.getTime()}|${printMinutes}`;
  const cached = previewExpandCache.get(key);
  if (cached) return cached;
  let result: ReturnType<typeof expandPrintTime>;
  try {
    result = expandPrintTime(machine, start, printMinutes, weekShifts, companyDays, false);
  } catch {
    result = { ok: false, reason: "START_NOT_RUNNABLE" };
  }
  previewExpandCache.set(key, result);
  return result;
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
  const normalized = normalizeCivilDateInput(s);
  if (!normalized) return "–";
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(civilDateToUTCMidnight(normalized));
}

// Zkrácený formát bez roku: "5.1."
function fmtDateShort(s: string | null | undefined): string {
  const normalized = normalizeCivilDateInput(s);
  if (!normalized) return "–";
  return formatPragueDateShort(civilDateToUTCMidnight(normalized));
}

function deadlineState(requiredDate: string | null | undefined, ok: boolean, now: Date, blockStartTime?: string | Date): "none" | "ok" | "warning" | "danger" | "earlyStart" {
  const dueDateStr = normalizeCivilDateInput(requiredDate);
  if (!dueDateStr) return "none";
  if (ok) return "ok";
  const todayDateStr = utcToPragueDateStr(now);
  // Blok startuje dříve než dorazí materiál/data
  if (blockStartTime) {
    const start = new Date(blockStartTime);
    if (!isNaN(start.getTime()) && utcToPragueDateStr(start) < dueDateStr) return "earlyStart";
  }
  if (todayDateStr === dueDateStr) return "warning";
  if (todayDateStr > dueDateStr) return "danger";
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
  issued:     "color-mix(in oklab, #3b82f6 85%, black 15%)",
  empty:      "rgba(0,0,0,0.45)",
  neutral:    "rgba(255,255,255,0.18)",
};
const DEADLINE_BORDER: Record<string, string> = {
  ok:         "color-mix(in oklab, var(--success) 70%, black 30%)",
  danger:     "color-mix(in oklab, var(--danger) 70%, black 30%)",
  warning:    "color-mix(in oklab, var(--warning) 60%, black 40%)",
  earlyStart: "color-mix(in oklab, #f97316 70%, black 30%)",
  issued:     "color-mix(in oklab, #3b82f6 70%, black 30%)",
  empty:      "rgba(255,255,255,0.55)",
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
  x, y, currentValue, onPick, onClose, onPickSkladem, onPickVydano, sklademActive, vydanoActive,
}: {
  x: number; y: number; currentValue: string; onPick: (dateStr: string) => void; onClose: () => void; onPickSkladem?: () => void; onPickVydano?: () => void; sklademActive?: boolean; vydanoActive?: boolean;
}) {
  const today = todayPragueDateStr();
  const safeDate = normalizeCivilDateInput(currentValue) ?? "";
  const initial = civilDateParts(safeDate || today);
  const [viewYear,  setViewYear]  = useState(initial.year);
  const [viewMonth, setViewMonth] = useState(initial.monthIndex);
  const selected = safeDate || null;

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1);
  }
  const firstDow = (civilDateDayOfWeek(civilDateFromParts(viewYear, viewMonth + 1, 1)) + 6) % 7;
  const daysInMonth = daysInCivilMonth(viewYear, viewMonth);
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
            const dateStr = civilDateFromParts(viewYear, viewMonth + 1, day);
            const isSelected = selected === dateStr;
            const isToday = today === dateStr;
            return (
              <button key={i}
                onClick={() => { onPick(dateStr); }}
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
        {(onPickSkladem || onPickVydano) && (
          <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8, display: "flex", gap: 6 }}>
            {onPickSkladem && (
              <button
                onClick={() => { onPickSkladem(); onClose(); }}
                style={{
                  flex: 1, padding: "6px 0", borderRadius: 8,
                  border: sklademActive ? "1px solid #10b981" : "none",
                  background: sklademActive ? "rgba(16,185,129,0.35)" : "rgba(16,185,129,0.15)",
                  color: sklademActive ? "#fff" : "#10b981",
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                  letterSpacing: "0.04em",
                }}
              >
                {sklademActive ? "Zrušit skladem" : "Skladem ✓"}
              </button>
            )}
            {onPickVydano && (
              <button
                onClick={() => { onPickVydano(); onClose(); }}
                style={{
                  flex: 1, padding: "6px 0", borderRadius: 8,
                  border: vydanoActive ? "1px solid #3b82f6" : "none",
                  background: vydanoActive ? "rgba(59,130,246,0.35)" : "rgba(59,130,246,0.15)",
                  color: vydanoActive ? "#fff" : "#3b82f6",
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                  letterSpacing: "0.04em",
                }}
              >
                {vydanoActive ? "Zrušit vydáno" : "Vydáno ➜"}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ─── DateBadge — klikatelná kolonka s datem + toggle OK ───────────────────────
function DateBadge({
  label, dateStr, ok, warn, danger, earlyStart, accent, onToggle, onDoubleClick, statusLabel, overrideText, customBg, customBorder, customTextColor,
}: {
  label: string; dateStr: string | null; ok: boolean; warn: boolean; danger: boolean; earlyStart?: boolean; accent?: string; onToggle?: () => void; onDoubleClick?: (rect: DOMRect) => void; statusLabel?: string | null; overrideText?: string; customBg?: string; customBorder?: string; customTextColor?: string;
}) {
  const [loading, setLoading] = useState(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const empty = !dateStr && !overrideText;
  const fmt = dateStr ? fmtDate(dateStr) : (overrideText ?? "—");

  const neutralAccent = accent ?? "var(--text-muted)";
  const stateKey = empty ? "empty" : ok ? "ok" : danger ? "danger" : warn ? "warning" : earlyStart ? "earlyStart" : "neutral";
  const bg          = customBg ?? DEADLINE_BG[stateKey];
  const borderColor = customBorder ?? DEADLINE_BORDER[stateKey];
  const labelColor  = customTextColor ?? (empty ? "#fff" : "rgba(255,255,255,0.90)");
  const dateColor   = customTextColor ?? (empty ? "rgba(255,255,255,0.95)" : "#fff");

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (empty || loading || !onToggle) return;
    if (onDoubleClick) {
      // Odložit toggle — zruší se pokud přijde dblclick dřív než timeout
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(async () => {
        clickTimerRef.current = null;
        setLoading(true);
        onToggle();
        setLoading(false);
      }, 350);
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
        userSelect: "none",
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

// ─── ProductionChips — typový chip OBÁLKA / VNITŘKY / TA·série ─────────────────
// Fragment (bez wrapperu) — lze vložit do flex clusteru i absolutního kontejneru.
// V praxi je nastavené vždy jen jedno (OBÁLKA nebo VNITŘKY nebo TA); série se
// spojí za tiskové archy. abbreviated = zkrácené OB./VN. pro krátké bloky.
function ProductionChips({ obalka, vnitrky, tiskoveArchy, serie, abbreviated }: {
  obalka?: boolean; vnitrky?: boolean; tiskoveArchy?: string | null; serie?: string | null; abbreviated?: boolean;
}) {
  const typeChip = formatProductionTypeChip(tiskoveArchy, serie);
  if (!obalka && !vnitrky && !typeChip) return null;
  // clamp = na krátkých blocích (abbreviated) dlouhý TA·série chip zkrátit ellipsis,
  // aby nikdy nevytlačil číslo zakázky (nejdůležitější info na bloku).
  const pill = (bg: string, fg: string, text: string, clamp?: boolean) => (
    <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.04em", padding: "2px 6px", borderRadius: 5, background: bg, color: fg, lineHeight: 1, whiteSpace: "nowrap", flexShrink: clamp ? 1 : 0, ...(clamp ? { maxWidth: 132, overflow: "hidden", textOverflow: "ellipsis" } : {}) }}>{text}</span>
  );
  const C = PRODUCTION_CHIP_COLORS;
  return (
    <>
      {obalka && pill(C.obalka.bg, C.obalka.fg, abbreviated ? "OB." : "OBÁLKA")}
      {vnitrky && pill(C.vnitrky.bg, C.vnitrky.fg, abbreviated ? "VN." : "VNITŘKY")}
      {typeChip && pill(C.type.bg, C.type.fg, typeChip, abbreviated)}
    </>
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
  canEdit, canEditData, canEditDataDate, canEditMat, onInlineDatePick, badgeColorMap,
  onBlockCopy, onBlockSplit, getSplitAt, isTiskar, onPrintComplete, onNotify, onBlockVariantChange,
  onExpeditionPublish, onExpeditionUnpublish,
  onDataChipDoubleClick,
  onOpenNotes,
  splitPart, splitTotal, splitTotalMinutes,
  splitPartner, onSplitChipClick,
  pauseOverlays, contentHeight,
  calendarDrift,
  shadeParity,
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
  // Σ tiskových minut všech členů split skupiny (bod 18 auditu) — 0/undefined = neukazovat
  splitTotalMinutes?: number;
  // Drift kalendáře (uložený end/start bloku nesedí na aktuální expanzi tiskových hodin) —
  // informační badge pro VŠECHNY role (viz níže), akce (banner „Přepočítat") je jen na stroji.
  calendarDrift?: CalendarDriftInfo | null;
  // Střídání odstínů — parita 0 (základní) / 1 (světlejší) pro odlišení sousedících
  // zakázek téže barvy; počítá rodič (computeShadeParity), undefined = neúčastní se.
  shadeParity?: 0 | 1;
  // Pauza (mimo provoz) uvnitř bloku, který zasahuje přes odstávku/nepracovní čas —
  // pixelové offsety (top/height) relativní k bloku, předpočítané v rodiči (má dateToY/viewStart/slotHeight).
  pauseOverlays?: { key: string; top: number; height: number }[];
  // Výška prvního print segmentu v px — když blok má segmenty, volba layout modu (MODE_FULL/…)
  // se řídí touto výškou místo clampedHeight, aby obsah nepropadl do pauzy. Beze změny pozice/výšky divu.
  contentHeight?: number;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onResizeMouseDown?: (e: React.MouseEvent) => void;
  onBlockUpdate: (b: Block, addToHistory?: boolean) => void;
  onError?: (msg: string) => void;
  canEdit?: boolean;
  canEditData?: boolean;
  canEditDataDate?: boolean;
  canEditMat?: boolean;
  onDataChipDoubleClick?: (blockId: number, rect: DOMRect) => void;
  onInlineDatePick?: (blockId: number, field: "data" | "material" | "pantone", currentValue: string, rect: DOMRect) => void;
  badgeColorMap?: Record<number, string | null>;
  onBlockCopy?: () => void;
  onBlockSplit?: (splitAt: Date) => void;
  getSplitAt?: (clientY: number) => Date;
  isTiskar?: boolean;
  onPrintComplete?: (blockId: number, completed: boolean) => Promise<void>;
  onNotify?: (blockId: number, orderNumber: string) => void;
  onBlockVariantChange?: (blockId: number, variant: BlockVariant) => void;
  onExpeditionPublish?:   (blockId: number) => Promise<void>;
  onExpeditionUnpublish?: (blockId: number) => Promise<void>;
  onOpenNotes?: (block: Block) => void;
  splitPartner?: Block | null;
  onSplitChipClick?: (partnerId: number) => void;
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
  const isUnconfirmedReservation = block.type === "REZERVACE" && block.reservationId != null && !block.reservationConfirmedAt;
  const isOverdue     = block.type === "ZAKAZKA" && new Date(block.endTime) < now && !isPrintDone && !isPozastaveno;
  // Deadline štítek — nezávislé na isOverdue (to je „konec bloku je v minulosti").
  // Tady srovnáváme civilní datum konce (Praha) s civilním datem deadlineExpedice:
  // string porovnání dateStr je DST-safe a přesně odpovídá „po deadline dni", i když
  // je blok ještě naplánovaný do budoucna (na rozdíl od isOverdue běží nezávisle na `now`).
  const isPastDeadline = block.type === "ZAKAZKA" && !!block.deadlineExpedice
    && utcToPragueDateStr(new Date(block.endTime)) > block.deadlineExpedice;
  const clampedHeight = Math.max(height, 20);
  // Layout mody se řídí výškou prvního print segmentu (obsah se má vejít do tiskové části,
  // ne propadnout do pauzy) — pro bloky bez segmentů (99 % plánu) je to prostě clampedHeight.
  const layoutHeight  = contentHeight ?? clampedHeight;

  const dataDeadlineState = deadlineState(block.dataRequiredDate, block.dataOk, now, block.startTime);
  const dataDisplayLabel = block.dataStatusLabel?.trim() || "";
  const dataCanToggle = false;
  const dataCanOpenCalendar    = !block.dataOk && !!canEditDataDate && !!onInlineDatePick;
  const dataCanOpenDtpPopover  = !!canEditData && !canEditDataDate && !!onDataChipDoubleClick;
  // materialInStock i materialIssued potlačují warning logiku materiálu
  const materialHandled = block.materialInStock || block.materialIssued;
  const effectiveMaterialDate = materialHandled ? null : block.materialRequiredDate;
  const effectiveMaterialOk   = materialHandled ? true : block.materialOk;
  const materialDeadlineState = materialHandled
    ? "ok"
    : deadlineState(block.materialRequiredDate, block.materialOk, now, block.startTime);
  const pantoneDeadlineState = deadlineState(block.pantoneRequiredDate, block.pantoneOk, now, block.startTime);

  const s = isPrintDone
    ? BLOCK_PRINT_DONE
    : isPozastaveno
    ? BLOCK_STYLES["ZAKAZKA_POZASTAVENO"]
    : isOverdue
    ? BLOCK_OVERDUE
    : (BLOCK_STYLES[getBlockStyleKey(block.type, block.blockVariant)] ?? BLOCK_STYLES["ZAKAZKA"]);

  // Střídání odstínů — světlý/tmavý wash přes gradient, aby šla vidět hranice mezi
  // sousedícími zakázkami/rezervacemi téže barvy. Aplikuje se jen na plné barevné
  // stavy; dokončený tisk a bloky po termínu mají vlastní tlumený vzhled → beze změny.
  const shadeEligible = !isPrintDone && !isOverdue && shadeParity != null;
  const shadedBackground = shadeEligible
    ? shadeParity === 1
      ? `linear-gradient(rgba(255,255,255,0.30), rgba(255,255,255,0.30)), ${s.gradient}`
      : `linear-gradient(rgba(6,10,20,0.10), rgba(6,10,20,0.10)), ${s.gradient}`
    : s.gradient;

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

  // Výškové mody (vzájemně se vylučují). Řídí se layoutHeight (výška prvního print segmentu,
  // pokud blok segmenty má) — u bloku s pauzou uprostřed se obsah vejde do tiskové části
  // a nepropadne do vizuální pauzy uprostřed bloku.
  const MODE_FULL    = layoutHeight >= 48;                              // plný layout (od ~1h při zoom=26)
  const MODE_COMPACT = !MODE_FULL && layoutHeight >= 44 && block.type !== "UDRZBA";
  const MODE_TINY    = !MODE_FULL && !MODE_COMPACT && layoutHeight >= 24; // micro tečky
  const MODE_MICRO_TEXT = !MODE_FULL && !MODE_COMPACT && !MODE_TINY && layoutHeight >= 14; // 14–23 px: sdílí TINY řádek (D/M/E chipy + číslo + popis)
  // Výškové prahy pro FULL mode
  const showDatesFull    = !isTiskar && MODE_FULL && layoutHeight >= 60 && block.type !== "UDRZBA"; // plný DateBadge řádek (≥60px)
  const showDatesCompact = !isTiskar && MODE_FULL && layoutHeight < 60  && block.type !== "UDRZBA"; // kompaktní chip řádek (48–59px)
  const showDates        = showDatesFull;
  const showSpec   = layoutHeight >= 80;  // 3. řádek — specifikace
  // Popis za číslem zakázky. Zobrazujeme v celém FULL módu (≥48px), ne až od 66px —
  // jinak bloky v pásmu 48–65px (typicky 2–2,5h při odzoomu) neukazovaly popis,
  // zatímco menší COMPACT/TINY bloky ho ukazují. Číslo zakázky výšku řádku určuje,
  // takže 1řádkový popis v tomto pásmu nestojí žádný prostor navíc.
  const showDesc   = MODE_FULL && layoutHeight >= 48;
  // Počet řádků popisu — v úzkém pásmu (48–65px) přesně 1 řádek (víc se nevejde vedle
  // datového řádku), od 66px roste s výškou bloku (13px/řádek).
  const descLineClamp = layoutHeight < 66 ? 1 : Math.max(2, Math.floor((layoutHeight - 55) / 13));

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
      if (res.ok) onBlockUpdate(await res.json(), true);
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
        onBlockUpdate(await res.json(), true);
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
      if (res.ok) onBlockUpdate(await res.json(), true);
    } catch (error) {
      console.error("Clear note failed", error);
      onError?.("Poznámku se nepodařilo smazat.");
    }
  }

  const menuItemStyle: React.CSSProperties = { borderRadius: 7, padding: "6px 10px", fontSize: 13, color: "rgba(255,255,255,0.9)", cursor: "pointer" };
  const hasNote = !!block.materialNote;
  const tiskarNotes = block.notes ?? [];
  const hasTiskarNotes = tiskarNotes.length > 0;
  const showMenu = (canEdit && !block.locked) || canEditMat || hasNote || !!onOpenNotes;

  const showTooltip = block.type !== "UDRZBA" && !badgeHovered;

  const blockDiv = (
    <div
      ref={blockCardRef}
      data-block="true"
      data-planner-block-card="true"
      onMouseDown={(e) => { e.preventDefault(); if (!block.locked) onMouseDown?.(e); }}
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
        border: isCopied ? "1.5px dashed #3b82f6" : multiSelected ? "2.5px solid #FFE600" : block.locked ? "1.5px solid rgba(251,191,36,0.7)" : isUnconfirmedReservation ? "1.5px dashed rgba(168,85,247,0.7)" : `1px solid ${selected ? "#FFE600" : s.border}`,
        outline: isCopied ? "1px solid rgba(59,130,246,0.3)" : undefined,
        outlineOffset: isCopied ? "2px" : undefined,
        boxShadow: block.locked
          ? `${shadow}, 0 0 0 1px rgba(251,191,36,0.35)`
          : shadow,
        background: shadedBackground,
        display: "flex", flexDirection: "column",
        overflow: "hidden", userSelect: "none",
        transition: isDragging ? "none" : "box-shadow 0.15s",
        animationName: "blockEnter",
        animationDuration: "220ms",
        animationTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        animationFillMode: "backwards",
      }}
    >
      {/* Levý barevný pruh — iOS Calendar style / amber lock strip */}
      {block.locked ? (
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 22, background: "rgba(251,191,36,0.4)", borderRadius: "7px 0 0 7px", borderRight: "1px solid rgba(251,191,36,0.35)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Lock size={11} strokeWidth={2} color="rgba(251,191,36,1)" />
        </div>
      ) : isUnconfirmedReservation ? (
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 22, background: "rgba(168,85,247,0.35)", borderRadius: "7px 0 0 7px", borderRight: "1px solid rgba(168,85,247,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Hourglass size={11} strokeWidth={2} color="rgba(168,85,247,1)" />
        </div>
      ) : (
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: s.accentBar, opacity: isOverdue ? 0.4 : 1, borderRadius: "7px 0 0 7px", flexShrink: 0 }} />
      )}

      {/* Modrý selection overlay */}
      {multiSelected && <div style={{ position: "absolute", inset: 0, borderRadius: 6, background: "rgba(255,230,0,0.12)", pointerEvents: "none", zIndex: 1 }} />}

      {/* Deadline štítek — pravý horní roh (FULL/COMPACT plný text, TINY jen ⚠).
          Fixní pozice top:4/right:4 — když je zároveň přítomný 📝 badge tiskařských
          poznámek (stejný roh), ten se odsune níž (viz jeho `top` níž), aby nekolidovaly.
          zIndex 4 — nad content (2–3), pod drag/resize stavy (5–20) i paste marker (25).
          Pod MODE_TINY (layoutHeight < 24, „micro tečky") se nezobrazuje vůbec —
          na bloku bez jakéhokoliv textového obsahu by badge jen kolidoval s okrajem. */}
      {isPastDeadline && (MODE_FULL || MODE_COMPACT || MODE_TINY) && (
        <span
          title={`Po termínu expedice (${block.deadlineExpedice})`}
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            background: "#b91c1c",
            color: "#fff",
            fontSize: 9,
            fontWeight: 800,
            lineHeight: 1,
            borderRadius: 4,
            padding: "1px 5px",
            zIndex: 4,
            userSelect: "none",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {MODE_TINY ? "⚠" : "⚠ PO DEADLINE"}
        </span>
      )}

      {/* Drift kalendáře štítek — druhé patro stacku pravého horního rohu, pod deadline
          badge (etapa 6). Informační pro VŠECHNY role (i TISKAR/VIEWER) — akce
          „Přepočítat" je jen v banneru stroje / BlockDetail, gatované na ADMIN/PLANOVAT.
          Parita s deadline badge: TINY jen „⚠", pod TINY nic. */}
      {!!calendarDrift && (MODE_FULL || MODE_COMPACT || MODE_TINY) && (
        <span
          title={
            calendarDrift.reason === "END_MISMATCH" && calendarDrift.expectedEnd
              ? `Konec nesedí na aktuální kalendář (správně do ${formatPragueDateTime(calendarDrift.expectedEnd)})`
              : "Umístění bloku nesedí na aktuální kalendář"
          }
          style={{
            position: "absolute",
            top: isPastDeadline ? 22 : 4,
            right: 4,
            background: "#f59e0b",
            color: "#1f2937",
            fontSize: 9,
            fontWeight: 800,
            lineHeight: 1,
            borderRadius: 4,
            padding: "1px 5px",
            zIndex: 4,
            userSelect: "none",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {MODE_TINY ? "⚠" : "⚠ KALENDÁŘ"}
        </span>
      )}

      {/* Tiskařské poznámky — oranžový pruh nahoře přes celou šířku + badge v rohu */}
      {hasTiskarNotes && (
        <>
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 4,
              background: "#f59e0b",
              borderTopLeftRadius: 7,
              borderTopRightRadius: 7,
              pointerEvents: "none",
              zIndex: 3,
            }}
          />
          <span
            title={`Poznámek tiskaře: ${tiskarNotes.length}`}
            onClick={onOpenNotes ? (e) => { e.stopPropagation(); onOpenNotes(block); } : undefined}
            style={{
              position: "absolute",
              // Odsunuto níž o každý přítomný badge nad ním ve stejném rohu (deadline, drift).
              top: 7 + (isPastDeadline ? 18 : 0) + (calendarDrift ? 18 : 0),
              right: 4,
              background: "#f59e0b",
              color: "#1f2937",
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1,
              padding: "2px 6px",
              borderRadius: 4,
              boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
              cursor: onOpenNotes ? "pointer" : "default",
              zIndex: 4,
              userSelect: "none",
            }}
          >
            📝 {tiskarNotes.length}
          </span>
        </>
      )}


      {/* ── MODE_COMPACT: 2 řádky — [datumy horiz. + chips] / [číslo + popis] ── */}
      {MODE_COMPACT && (() => {
        const dStateKey = block.dataStatusId ? "ok" : !block.dataRequiredDate ? "empty" : dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
        const mStateKey = block.materialIssued ? "issued" : block.materialInStock ? "ok" : (!block.materialRequiredDate ? "empty" : materialDeadlineState === "none" ? "neutral" : materialDeadlineState);
        const eStateKey = !block.deadlineExpedice ? "empty" : "neutral";
        const pStateKey = !block.pantoneRequired && !block.pantoneRequiredDate && !block.pantoneOk ? "empty" : block.pantoneOk ? "ok" : !block.pantoneRequiredDate ? "warning" : pantoneDeadlineState === "none" ? "neutral" : pantoneDeadlineState;
        const dateChip = (stateKey: string, fieldAccent: string, clickable: boolean): React.CSSProperties => ({
          fontSize: 10, fontWeight: 600,
          color: stateKey === "empty" ? "#fff" : "rgba(255,255,255,0.90)",
          background: DEADLINE_BG[stateKey] ?? DEADLINE_BG.neutral,
          borderTop: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`, borderRight: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`, borderBottom: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`,
          borderLeft: `2px solid ${fieldAccent}`,
          borderRadius: 4, padding: "2px 6px 2px 5px",
          whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1,
          cursor: clickable ? "pointer" : "default",
          userSelect: "none",
        });
        const dIcon = dataDeadlineState === "ok" ? " ✓" : dataDeadlineState === "danger" ? " ✕" : dataDeadlineState === "warning" ? " !" : dataDeadlineState === "earlyStart" ? " ⚠" : "";
        const mIcon = materialDeadlineState === "ok" ? " ✓" : materialDeadlineState === "danger" ? " ✕" : materialDeadlineState === "warning" ? " !" : materialDeadlineState === "earlyStart" ? " ⚠" : "";
        const pIcon = pantoneDeadlineState === "ok" ? " ✓" : pantoneDeadlineState === "danger" ? " ✕" : pantoneDeadlineState === "warning" ? " !" : pantoneDeadlineState === "earlyStart" ? " ⚠" : "";
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 4, paddingTop: 0, paddingBottom: 0, paddingLeft: (block.locked || isUnconfirmedReservation) ? 28 : 8, paddingRight: hasTiskarNotes ? 44 : 8, flex: 1, overflow: "hidden", minHeight: 0 }}>
            {/* Levá část: datumy + separator + číslo + popis */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 1, minWidth: 0, overflow: "hidden", maxWidth: (block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) ? "58%" : undefined }}>
              {!isTiskar && <>
                <span style={{
                    ...dateChip(dStateKey, FIELD_ACCENT.DATA, dataCanToggle),
                    ...(block.dataStatusId && dataAccent !== s.accentBar ? { background: dataAccent, borderTop: `1px solid ${dataAccent}`, borderRight: `1px solid ${dataAccent}`, borderBottom: `1px solid ${dataAccent}`, color: dataText ?? "#fff" } : {}),
                  }} title={dataDeadlineState === "earlyStart" ? "Start zakázky před dodáním dat" : undefined}
                  onClick={dataCanToggle ? (e) => { e.stopPropagation(); if (dataCanOpenCalendar || dataCanOpenDtpPopover) { if (compactDataTimerRef.current) clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = setTimeout(() => { compactDataTimerRef.current = null; toggleField("dataOk", block.dataOk); }, 350); } else { toggleField("dataOk", block.dataOk); } } : undefined}
                  onDoubleClick={(dataCanOpenCalendar || dataCanOpenDtpPopover) ? (e) => {
                    e.stopPropagation();
                    if (compactDataTimerRef.current) { clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = null; }
                    if (dataCanOpenCalendar) {
                      onInlineDatePick!(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect());
                    } else if (dataCanOpenDtpPopover) {
                      onDataChipDoubleClick!(block.id, e.currentTarget.getBoundingClientRect());
                    }
                  } : undefined}>
                  {block.dataStatusId ? dataDisplayLabel : `D\u00a0${block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}`}
                </span>
                <MaterialNoteAffordance indicatorSize={4} indicatorTop={1} indicatorRight={1} block={block}>
                  <span style={dateChip(mStateKey, FIELD_ACCENT.MATERIAL, !!block.materialRequiredDate && !block.materialInStock && !block.materialIssued)} title={materialDeadlineState === "earlyStart" ? "Start zakázky před dodáním materiálu" : undefined}
                    onClick={block.materialRequiredDate && !block.materialInStock && !block.materialIssued ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactMatTimerRef.current) clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = setTimeout(() => { compactMatTimerRef.current = null; toggleField("materialOk", block.materialOk); }, 350); } else { toggleField("materialOk", block.materialOk); } } : undefined}
                    onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactMatTimerRef.current) { clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = null; } onInlineDatePick(block.id, "material", block.materialRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                    M&nbsp;{block.materialIssued ? "VYD." : block.materialInStock ? "SKLAD" : block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${mIcon}` : "—"}
                  </span>
                </MaterialNoteAffordance>
                <span style={dateChip(eStateKey, FIELD_ACCENT.EXPEDICE, false)}>
                  E&nbsp;{block.deadlineExpedice ? fmtDateShort(block.deadlineExpedice) : "—"}
                </span>
                {(block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk) && (
                  <span style={dateChip(pStateKey, FIELD_ACCENT.PANTONE, !!block.pantoneRequiredDate)} title={pantoneDeadlineState === "earlyStart" ? "Start zakázky před dodáním pantonu" : undefined}
                    onClick={block.pantoneRequiredDate ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactPanTimerRef.current) clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = setTimeout(() => { compactPanTimerRef.current = null; toggleField("pantoneOk", block.pantoneOk); }, 350); } else { toggleField("pantoneOk", block.pantoneOk); } } : undefined}
                    onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactPanTimerRef.current) { clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = null; } onInlineDatePick(block.id, "pantone", block.pantoneRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                    P&nbsp;{block.pantoneOk ? "OK" : block.pantoneRequiredDate ? `${fmtDateShort(block.pantoneRequiredDate)}${pIcon}` : "⚠"}
                  </span>
                )}
                <div style={{ width: 1, height: 12, background: "var(--border)", flexShrink: 0 }} />
              </>}
              <span style={{ fontSize: 11, fontWeight: 700, color: s.textPrimary, whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1 }}>
                {block.orderNumber}{block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.85 }}><Lock size={9} strokeWidth={2} /></span>}{isUnconfirmedReservation && !block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.85 }}><Hourglass size={9} strokeWidth={2} /></span>}
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
            {/* Uprostřed: typový chip (OBÁLKA/VNITŘKY/TA·série), vystředěný spacery */}
            {(block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) && (
              <>
                <div style={{ flex: 1, minWidth: 6 }} />
                <ProductionChips obalka={block.obalka} vnitrky={block.vnitrky} tiskoveArchy={block.tiskoveArchy} serie={block.serie} abbreviated />
              </>
            )}
            <div style={{ flex: 1, minWidth: 6 }} />
            {/* Vpravo: status chipy + série marker + tiskař + split */}
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
              {(hasNoteRow || block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
                  {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={matAccent}   textColor={matText   ?? undefined} />}
                  {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent={barvyAccent} textColor={barvyText ?? undefined} />}
                  {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent={lakAccent}   textColor={lakText   ?? undefined} />}
                  {(block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                    <span style={{ fontSize: 8, opacity: 0.4, color: s.textSub, flexShrink: 0 }}>↻</span>
                  )}
                </div>
              )}
              {isTiskar && onPrintComplete && block.type === "ZAKAZKA" && (
                <button onClick={(e) => { e.stopPropagation(); setPrintPending(true); onPrintComplete(block.id, !isPrintDone).finally(() => setPrintPending(false)); }} disabled={printPending}
                  style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 5, border: "none", cursor: printPending ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", background: isPrintDone ? "rgba(100,116,139,0.3)" : "rgba(34,197,94,0.35)", color: isPrintDone ? "var(--text-muted)" : "#22c55e", opacity: printPending ? 0.5 : 1, transition: "all 0.12s ease-out", fontFamily: "inherit" }}
                  title={isPrintDone ? "Vrátit hotovo" : "Označit jako hotovo"}>
                  {printPending ? "·" : isPrintDone ? "↩" : "✓"}
                </button>
              )}
              {splitPartner && clampedHeight >= 32 && (() => {
                const { state, time } = getSplitChipState(splitPartner);
                return (
                  <SplitChip
                    partnerMachine={splitPartner.machine}
                    state={state}
                    time={time}
                    onClick={() => onSplitChipClick?.(splitPartner.id)}
                  />
                );
              })()}
            </div>
          </div>
        );
      })()}

      {/* ── MODE_TINY + MICRO_TEXT: jednořádkový layout — [D chip][M chip][E chip] · číslo · popis.
          Sdílený pro obě úzká pásma (14–43 px): chipy dodání dat/materiálu/expedice mají přednost,
          popis se uřízne elipsou, když nezbude místo. Půlhodinový blok v nadhledu (14–23 px) tak
          neztratí D/M/E chipy — dřív MICRO_TEXT ukazoval jen popis bez chipů. ── */}
      {(MODE_TINY || MODE_MICRO_TEXT) && (() => {
        const dStateKey = block.dataStatusId ? "ok" : !block.dataRequiredDate ? "empty" : dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
        const mStateKey = block.materialIssued ? "issued" : block.materialInStock ? "ok" : (!block.materialRequiredDate ? "empty" : materialDeadlineState === "none" ? "neutral" : materialDeadlineState);
        const eStateKey = !block.deadlineExpedice ? "empty" : "neutral";
        const chipStyle = (stateKey: string, fieldAccent: string, clickable: boolean): React.CSSProperties => ({
          fontSize: 9, fontWeight: 600,
          color: stateKey === "empty" ? "#fff" : "rgba(255,255,255,0.90)",
          background: DEADLINE_BG[stateKey] ?? DEADLINE_BG.neutral,
          borderTop: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`, borderRight: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`, borderBottom: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`,
          borderLeft: `2px solid ${fieldAccent}`,
          borderRadius: 3, padding: "1px 5px 1px 4px",
          whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1,
          cursor: clickable ? "pointer" : "default",
          userSelect: "none",
        });
        const dIcon = dataDeadlineState === "ok" ? " ✓" : dataDeadlineState === "danger" ? " ✕" : dataDeadlineState === "warning" ? " !" : dataDeadlineState === "earlyStart" ? " ⚠" : "";
        const mIcon = materialDeadlineState === "ok" ? " ✓" : materialDeadlineState === "danger" ? " ✕" : materialDeadlineState === "warning" ? " !" : materialDeadlineState === "earlyStart" ? " ⚠" : "";
        const pIcon = pantoneDeadlineState === "ok" ? " ✓" : pantoneDeadlineState === "danger" ? " ✕" : pantoneDeadlineState === "warning" ? " !" : pantoneDeadlineState === "earlyStart" ? " ⚠" : "";
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 4, paddingTop: 0, paddingBottom: 0, paddingLeft: (block.locked || isUnconfirmedReservation) ? 28 : 8, paddingRight: hasTiskarNotes ? 44 : 8, flex: 1, overflow: "hidden", minHeight: 0 }}>
            {/* Levá část: datum chips + číslo + popis */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 1, minWidth: 0, overflow: "hidden", maxWidth: (block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) ? "58%" : undefined }}>
              {!isTiskar && block.type !== "UDRZBA" && <>
                <span style={{
                    ...chipStyle(dStateKey, FIELD_ACCENT.DATA, dataCanToggle),
                    ...(block.dataStatusId && dataAccent !== s.accentBar ? { background: dataAccent, borderTop: `1px solid ${dataAccent}`, borderRight: `1px solid ${dataAccent}`, borderBottom: `1px solid ${dataAccent}`, color: dataText ?? "#fff" } : {}),
                  }} title={dataDeadlineState === "earlyStart" ? "Start zakázky před dodáním dat" : undefined}
                  onClick={dataCanToggle ? (e) => { e.stopPropagation(); if (dataCanOpenCalendar || dataCanOpenDtpPopover) { if (compactDataTimerRef.current) clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = setTimeout(() => { compactDataTimerRef.current = null; toggleField("dataOk", block.dataOk); }, 350); } else { toggleField("dataOk", block.dataOk); } } : undefined}
                  onDoubleClick={(dataCanOpenCalendar || dataCanOpenDtpPopover) ? (e) => {
                    e.stopPropagation();
                    if (compactDataTimerRef.current) { clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = null; }
                    if (dataCanOpenCalendar) {
                      onInlineDatePick!(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect());
                    } else if (dataCanOpenDtpPopover) {
                      onDataChipDoubleClick!(block.id, e.currentTarget.getBoundingClientRect());
                    }
                  } : undefined}>
                  {block.dataStatusId ? dataDisplayLabel : `D\u00a0${block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}`}
                </span>
                <MaterialNoteAffordance indicatorSize={4} indicatorTop={1} indicatorRight={1} block={block}>
                  <span style={chipStyle(mStateKey, FIELD_ACCENT.MATERIAL, !!block.materialRequiredDate && !block.materialInStock && !block.materialIssued)} title={materialDeadlineState === "earlyStart" ? "Start zakázky před dodáním materiálu" : undefined}
                    onClick={block.materialRequiredDate && !block.materialInStock && !block.materialIssued ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactMatTimerRef.current) clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = setTimeout(() => { compactMatTimerRef.current = null; toggleField("materialOk", block.materialOk); }, 350); } else { toggleField("materialOk", block.materialOk); } } : undefined}
                    onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactMatTimerRef.current) { clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = null; } onInlineDatePick(block.id, "material", block.materialRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                    M&nbsp;{block.materialIssued ? "VYD." : block.materialInStock ? "SKLAD" : block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${mIcon}` : "—"}
                  </span>
                </MaterialNoteAffordance>
                <span style={chipStyle(eStateKey, FIELD_ACCENT.EXPEDICE, false)}>
                  E&nbsp;{block.deadlineExpedice ? fmtDateShort(block.deadlineExpedice) : "—"}
                </span>
                {(block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk) && (() => {
                  const pStateKey = !block.pantoneRequired && !block.pantoneRequiredDate && !block.pantoneOk ? "empty" : block.pantoneOk ? "ok" : !block.pantoneRequiredDate ? "warning" : pantoneDeadlineState === "none" ? "neutral" : pantoneDeadlineState;
                  return (
                    <span style={chipStyle(pStateKey, FIELD_ACCENT.PANTONE, !!block.pantoneRequiredDate)} title={pantoneDeadlineState === "earlyStart" ? "Start zakázky před dodáním pantonu" : undefined}
                      onClick={block.pantoneRequiredDate ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactPanTimerRef.current) clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = setTimeout(() => { compactPanTimerRef.current = null; toggleField("pantoneOk", block.pantoneOk); }, 350); } else { toggleField("pantoneOk", block.pantoneOk); } } : undefined}
                      onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactPanTimerRef.current) { clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = null; } onInlineDatePick(block.id, "pantone", block.pantoneRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                      P&nbsp;{block.pantoneOk ? "OK" : block.pantoneRequiredDate ? `${fmtDateShort(block.pantoneRequiredDate)}${pIcon}` : "⚠"}
                    </span>
                  );
                })()}
                <div style={{ width: 1, height: 10, background: "var(--border)", flexShrink: 0 }} />
              </>}
              <span style={{ fontSize: 10, fontWeight: 700, color: s.textPrimary, whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1 }}>
                {block.orderNumber}{block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.85 }}><Lock size={8} strokeWidth={2} /></span>}{isUnconfirmedReservation && !block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.85 }}><Hourglass size={9} strokeWidth={2} /></span>}
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
            {/* Uprostřed: typový chip (OBÁLKA/VNITŘKY/TA·série), vystředěný spacery */}
            {(block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) && (
              <>
                <div style={{ flex: 1, minWidth: 6 }} />
                <ProductionChips obalka={block.obalka} vnitrky={block.vnitrky} tiskoveArchy={block.tiskoveArchy} serie={block.serie} abbreviated />
              </>
            )}
            <div style={{ flex: 1, minWidth: 6 }} />
            {/* Vpravo: status chipy + série marker + split marker + tiskař */}
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
              {(hasNoteRow || block.recurrenceType !== "NONE" || block.recurrenceParentId !== null || (splitTotal ?? 0) > 1) && (
                <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
                  {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={matAccent}   textColor={matText   ?? undefined} />}
                  {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent={barvyAccent} textColor={barvyText ?? undefined} />}
                  {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent={lakAccent}   textColor={lakText   ?? undefined} />}
                  {(block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                    <span style={{ fontSize: 8, opacity: 0.4, color: s.textSub, flexShrink: 0, lineHeight: 1 }}>↻</span>
                  )}
                  {(splitTotal ?? 0) > 1 && (
                    <span style={{ fontSize: 8, opacity: 0.55, color: s.textSub, flexShrink: 0, lineHeight: 1 }}>✂{splitPart}/{splitTotal}{(splitTotalMinutes ?? 0) > 0 ? ` · ${formatPrintHoursShort(splitTotalMinutes!)}` : ""}</span>
                  )}
                </div>
              )}
              {isTiskar && onPrintComplete && block.type === "ZAKAZKA" && (
                <button onClick={(e) => { e.stopPropagation(); setPrintPending(true); onPrintComplete(block.id, !isPrintDone).finally(() => setPrintPending(false)); }} disabled={printPending}
                  style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 5, border: "none", cursor: printPending ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", background: isPrintDone ? "rgba(100,116,139,0.3)" : "rgba(34,197,94,0.35)", color: isPrintDone ? "var(--text-muted)" : "#22c55e", opacity: printPending ? 0.5 : 1, transition: "all 0.12s ease-out", fontFamily: "inherit" }}
                  title={isPrintDone ? "Vrátit hotovo" : "Označit jako hotovo"}>
                  {printPending ? "·" : isPrintDone ? "↩" : "✓"}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Řádek 1: Číslo zakázky + popis + chips vpravo (FULL mode) ── */}
      {MODE_FULL && (
        <div style={{
          paddingTop: 5, paddingBottom: 3, paddingLeft: (block.locked || isUnconfirmedReservation) ? 28 : 9, paddingRight: hasTiskarNotes ? 44 : 9, display: "flex", alignItems: "flex-start",
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
              {block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 3, opacity: 0.85 }}><Lock size={9} strokeWidth={2} /></span>}{isUnconfirmedReservation && !block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.85 }}><Hourglass size={9} strokeWidth={2} /></span>}
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
              {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={matAccent}   textColor={matText   ?? undefined} />}
              {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent={barvyAccent} textColor={barvyText ?? undefined} />}
              {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent={lakAccent}   textColor={lakText   ?? undefined} />}
              {(block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                <span style={{ fontSize: 8, opacity: 0.4, color: s.textSub }}>↻</span>
              )}
              {(splitTotal ?? 0) > 1 && (
                <span style={{ fontSize: 8, opacity: 0.55, color: s.textSub, flexShrink: 0, lineHeight: 1 }}>✂{splitPart}/{splitTotal}{(splitTotalMinutes ?? 0) > 0 ? ` · ${formatPrintHoursShort(splitTotalMinutes!)}` : ""}</span>
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
            label="DATA" dateStr={block.dataStatusId ? null : block.dataRequiredDate}
            overrideText={block.dataStatusId ? dataDisplayLabel : undefined}
            ok={block.dataStatusId ? true : dataDeadlineState === "ok"} warn={dataDeadlineState === "warning"} danger={dataDeadlineState === "danger"} earlyStart={dataDeadlineState === "earlyStart"}
            accent={FIELD_ACCENT.DATA}
            onToggle={undefined}
            onDoubleClick={(dataCanOpenCalendar || dataCanOpenDtpPopover) ? (rect) => {
              if (dataCanOpenCalendar) { onInlineDatePick?.(block.id, "data", block.dataRequiredDate ?? "", rect); }
              else if (dataCanOpenDtpPopover) { onDataChipDoubleClick?.(block.id, rect); }
            } : undefined}
            statusLabel={block.dataStatusLabel}
            customBg={block.dataStatusId && dataAccent !== s.accentBar ? dataAccent : undefined}
            customBorder={block.dataStatusId && dataAccent !== s.accentBar ? dataAccent : undefined}
            customTextColor={block.dataStatusId && dataAccent !== s.accentBar ? (dataText ?? "#fff") : undefined}
          />
          <MaterialNoteAffordance block={block}>
            <DateBadge
              label="MAT." dateStr={materialHandled ? null : block.materialRequiredDate}
              overrideText={block.materialIssued ? "VYDÁNO" : block.materialInStock ? "SKLADEM" : undefined}
              ok={materialHandled || materialDeadlineState === "ok"} warn={!materialHandled && materialDeadlineState === "warning"} danger={!materialHandled && materialDeadlineState === "danger"} earlyStart={!materialHandled && materialDeadlineState === "earlyStart"}
              accent={FIELD_ACCENT.MATERIAL}
              onToggle={materialHandled ? () => {} : () => toggleField("materialOk", block.materialOk)}
              onDoubleClick={canEditMat ? (rect) => onInlineDatePick?.(block.id, "material", block.materialRequiredDate ?? "", rect) : undefined}
              statusLabel={block.materialStatusLabel}
              customBg={block.materialIssued ? DEADLINE_BG.issued : undefined}
              customBorder={block.materialIssued ? DEADLINE_BORDER.issued : undefined}
            />
          </MaterialNoteAffordance>
          <DateBadge
            label="EXP." dateStr={block.deadlineExpedice}
            ok={false} warn={false} danger={false} accent={FIELD_ACCENT.EXPEDICE}
            onToggle={() => {}}
          />
          {(block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk) && (
            <DateBadge
              label="PAN." dateStr={block.pantoneOk ? null : block.pantoneRequiredDate}
              overrideText={block.pantoneOk ? "OK" : !block.pantoneRequiredDate ? "⚠" : undefined}
              ok={pantoneDeadlineState === "ok"} warn={pantoneDeadlineState === "warning" || (!block.pantoneRequiredDate && !block.pantoneOk && block.pantoneRequired)} danger={pantoneDeadlineState === "danger"} earlyStart={pantoneDeadlineState === "earlyStart"} accent={FIELD_ACCENT.PANTONE}
              onToggle={() => toggleField("pantoneOk", block.pantoneOk)}
              onDoubleClick={canEditMat ? (rect) => onInlineDatePick?.(block.id, "pantone", block.pantoneRequiredDate ?? "", rect) : undefined}
            />
          )}
        </div>
      )}

      {/* ── Řádek 2b: Kompaktní datum chipy (MODE_FULL, 48–59px — plný DateBadge se nevejde) ── */}
      {showDatesCompact && (() => {
        const dSK = block.dataStatusId ? "ok" : !block.dataRequiredDate ? "empty" : dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
        const mSK = block.materialIssued ? "issued" : block.materialInStock ? "ok" : (!block.materialRequiredDate ? "empty" : materialDeadlineState === "none" ? "neutral" : materialDeadlineState);
        const eSK = !block.deadlineExpedice ? "empty" : "neutral";
        const pSK = !block.pantoneRequired && !block.pantoneRequiredDate && !block.pantoneOk ? "empty" : block.pantoneOk ? "ok" : !block.pantoneRequiredDate ? "warning" : pantoneDeadlineState === "none" ? "neutral" : pantoneDeadlineState;
        const cs = (sk: string, fa: string, clickable: boolean): React.CSSProperties => ({
          fontSize: 9, fontWeight: 600,
          color: sk === "empty" ? "#fff" : "rgba(255,255,255,0.90)",
          background: DEADLINE_BG[sk] ?? DEADLINE_BG.neutral,
          borderTop: `1px solid ${DEADLINE_BORDER[sk] ?? DEADLINE_BORDER.neutral}`, borderRight: `1px solid ${DEADLINE_BORDER[sk] ?? DEADLINE_BORDER.neutral}`, borderBottom: `1px solid ${DEADLINE_BORDER[sk] ?? DEADLINE_BORDER.neutral}`,
          borderLeft: `2px solid ${fa}`,
          borderRadius: 3, padding: "1px 5px 1px 4px",
          whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1,
          cursor: clickable ? "pointer" : "default",
          userSelect: "none",
        });
        const dIcon = dataDeadlineState === "ok" ? " ✓" : dataDeadlineState === "danger" ? " ✕" : dataDeadlineState === "warning" ? " !" : dataDeadlineState === "earlyStart" ? " ⚠" : "";
        const mIcon = materialDeadlineState === "ok" ? " ✓" : materialDeadlineState === "danger" ? " ✕" : materialDeadlineState === "warning" ? " !" : materialDeadlineState === "earlyStart" ? " ⚠" : "";
        const pIcon = pantoneDeadlineState === "ok" ? " ✓" : pantoneDeadlineState === "danger" ? " ✕" : pantoneDeadlineState === "warning" ? " !" : pantoneDeadlineState === "earlyStart" ? " ⚠" : "";
        return (
          <div style={{ padding: "0 7px 3px", display: "flex", gap: 4, flexShrink: 0, overflow: "hidden", alignItems: "center" }}>
            <span style={{
                ...cs(dSK, FIELD_ACCENT.DATA, dataCanToggle),
                ...(block.dataStatusId && dataAccent !== s.accentBar ? { background: dataAccent, borderTop: `1px solid ${dataAccent}`, borderRight: `1px solid ${dataAccent}`, borderBottom: `1px solid ${dataAccent}`, color: dataText ?? "#fff" } : {}),
              }}
              onClick={dataCanToggle ? (e) => { e.stopPropagation(); if (dataCanOpenCalendar || dataCanOpenDtpPopover) { if (compactDataTimerRef.current) clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = setTimeout(() => { compactDataTimerRef.current = null; toggleField("dataOk", block.dataOk); }, 350); } else { toggleField("dataOk", block.dataOk); } } : undefined}
              onDoubleClick={(dataCanOpenCalendar || dataCanOpenDtpPopover) ? (e) => { e.stopPropagation(); if (compactDataTimerRef.current) { clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = null; } if (dataCanOpenCalendar) { onInlineDatePick(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } else if (dataCanOpenDtpPopover) { onDataChipDoubleClick?.(block.id, e.currentTarget.getBoundingClientRect()); } } : undefined}>
              {block.dataStatusId ? dataDisplayLabel : `D\u00a0${block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}`}
            </span>
            <MaterialNoteAffordance indicatorSize={4} indicatorTop={1} indicatorRight={1} block={block}>
              <span style={cs(mSK, FIELD_ACCENT.MATERIAL, !!block.materialRequiredDate && !block.materialInStock && !block.materialIssued)}
                onClick={block.materialRequiredDate && !block.materialInStock && !block.materialIssued ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactMatTimerRef.current) clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = setTimeout(() => { compactMatTimerRef.current = null; toggleField("materialOk", block.materialOk); }, 350); } else { toggleField("materialOk", block.materialOk); } } : undefined}
                onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactMatTimerRef.current) { clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = null; } onInlineDatePick(block.id, "material", block.materialRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                M&nbsp;{block.materialIssued ? "VYD." : block.materialInStock ? "SKLAD" : block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${mIcon}` : "—"}
              </span>
            </MaterialNoteAffordance>
            <span style={cs(eSK, FIELD_ACCENT.EXPEDICE, false)}>
              E&nbsp;{block.deadlineExpedice ? fmtDateShort(block.deadlineExpedice) : "—"}
            </span>
            {(block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk) && (
              <span style={cs(pSK, FIELD_ACCENT.PANTONE, !!block.pantoneRequiredDate)} title={pantoneDeadlineState === "earlyStart" ? "Start zakázky před dodáním pantonu" : undefined}
                onClick={block.pantoneRequiredDate ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactPanTimerRef.current) clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = setTimeout(() => { compactPanTimerRef.current = null; toggleField("pantoneOk", block.pantoneOk); }, 350); } else { toggleField("pantoneOk", block.pantoneOk); } } : undefined}
                onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactPanTimerRef.current) { clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = null; } onInlineDatePick(block.id, "pantone", block.pantoneRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                P&nbsp;{block.pantoneOk ? "OK" : block.pantoneRequiredDate ? `${fmtDateShort(block.pantoneRequiredDate)}${pIcon}` : "⚠"}
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

      {/* SplitChip — jen pro TISKAR, MODE_FULL */}
      {MODE_FULL && splitPartner && clampedHeight >= 32 && (() => {
        const { state, time } = getSplitChipState(splitPartner);
        return (
          <SplitChip
            partnerMachine={splitPartner.machine}
            state={state}
            time={time}
            onClick={() => onSplitChipClick?.(splitPartner.id)}
          />
        );
      })()}

      {/* Výrobní štítky OBÁLKA/VNITŘKY — vpravo dole (FULL mode, je tam prostor).
          U TISKAŘE je spodní pruh obsazen tlačítkem Hotovo / SplitChipem → zvednout výš.
          Resize handle sedí v rohu (bottom:0 right:0, 20×20) — když je přítomný
          (blok není zamčený a nejsme v tiskařském režimu, kde je chip výš), odsuneme
          chip doleva o šířku handle (right:26), aby nezakrýval úchyt pro zkrácení/prodloužení. */}
      {MODE_FULL && (block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) && (
        <div style={{ position: "absolute", right: (!block.locked && !isTiskar) ? 26 : 6, bottom: isTiskar ? 32 : 4, display: "flex", gap: 5, zIndex: 4, pointerEvents: "none" }}>
          <ProductionChips obalka={block.obalka} vnitrky={block.vnitrky} tiskoveArchy={block.tiskoveArchy} serie={block.serie} />
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

      {/* ── Pauza (mimo provoz) uvnitř bloku — ztmavený „můstek" mezi print segmenty.
          Přerušované vodorovné okraje + červené šrafování odstávky (kreslí se NAD blokem,
          zIndex 2) dohromady vizuálně odliší od splitu (samostatné bloky s ✂ chipy).
          Levý accent bar bloku zůstává průběžný — drží identitu jedné zakázky. ── */}
      {pauseOverlays?.map((seg) => (
        <div key={seg.key} style={{
          position: "absolute", top: seg.top, height: seg.height, left: 0, right: 0,
          background: "rgba(10,15,28,0.55)",
          borderTop: "2px dashed rgba(148,163,184,0.7)",
          borderBottom: "2px dashed rgba(148,163,184,0.7)",
          pointerEvents: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {seg.height >= 40 && (
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: "rgba(203,213,225,0.85)", background: "rgba(2,6,23,0.6)", padding: "1px 8px", borderRadius: 6 }}>
              ⏸ PAUZA — mimo provoz
            </span>
          )}
        </div>
      ))}

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
        // Řádek délky: ZAKAZKA s tiskovými minutami odlišnými od uplynulého času bloku
        // (pauza přes odstávku/mimo provoz uvnitř bloku) zobrazí tisk i celek zvlášť.
        const fmtHoursTip = (mins: number) => {
          const h = mins / 60;
          return h % 1 === 0 ? `${h} h` : `${h.toFixed(1)} h`;
        };
        const elapsedMinsTip = Math.round((endD.getTime() - startD.getTime()) / 60000);
        const pmTip = block.type === "ZAKAZKA" ? blockPrintMinutes(block) : null;
        const durationLabel = (pmTip != null && pmTip !== elapsedMinsTip)
          ? `Tisk: ${fmtHoursTip(pmTip)} · Celkem: ${fmtHoursTip(elapsedMinsTip)}`
          : `Délka: ${fmtHoursTip(elapsedMinsTip)}`;
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
            {/* Délka — tisk vs. celkový čas na ose, když se liší (blok obsahuje pauzu) */}
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.4 }}>
              {durationLabel}
            </div>
            {/* Σ tiskový čas celé split skupiny (bod 18 auditu) */}
            {(splitTotal ?? 0) > 1 && (splitTotalMinutes ?? 0) > 0 && (
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.4 }}>
                {`Skupina: Σ ${fmtHoursTip(splitTotalMinutes!)} (${splitTotal} částí)`}
              </div>
            )}
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
            {/* Tiskařské poznámky — sekce v hoveru */}
            {tiskarNotes.length > 0 && (
              <div style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: "1px solid rgba(255,255,255,0.08)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "#f59e0b",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: 2,
                }}>
                  <span>📝 Poznámky tiskař</span>
                  <span style={{
                    background: "#f59e0b",
                    color: "#1f2937",
                    padding: "1px 5px",
                    borderRadius: 8,
                    fontSize: 9,
                    fontWeight: 700,
                  }}>{tiskarNotes.length}</span>
                </div>
                {tiskarNotes.slice(0, 3).map((n) => (
                  <div key={n.id} style={{ borderLeft: "2px solid #f59e0b", paddingLeft: 8 }}>
                    <div style={{
                      fontSize: 11,
                      color: "rgba(255,255,255,0.85)",
                      lineHeight: 1.45,
                      whiteSpace: "pre-wrap",
                    }}>{n.text}</div>
                    <div style={{
                      fontSize: 9,
                      color: "rgba(255,255,255,0.32)",
                      marginTop: 2,
                      letterSpacing: "0.02em",
                    }}>
                      {n.createdByUsername} · {new Date(n.createdAt).toLocaleString("cs-CZ", {
                        day: "numeric", month: "numeric",
                        hour: "2-digit", minute: "2-digit",
                        timeZone: "Europe/Prague",
                      })}
                      {n.updatedAt !== n.createdAt && " · upraveno"}
                    </div>
                  </div>
                ))}
                {tiskarNotes.length > 3 && (
                  <div style={{
                    fontSize: 10,
                    color: "#f59e0b",
                    textAlign: "center",
                    fontStyle: "italic",
                    marginTop: 4,
                  }}>
                    + {tiskarNotes.length - 3} dalších
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
        {onOpenNotes && block.type === "ZAKAZKA" && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => onOpenNotes(block)}
              style={{ ...menuItemStyle, color: "#fbbf24" }}
            >
              📝 Poznámka tiskaře{hasTiskarNotes ? ` (${tiskarNotes.length})` : ""}
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
        {/* Expedice akce — jen pro ZAKAZKA blok, jen pro editory */}
        {canEdit && block.type === "ZAKAZKA" && (
          <>
            <ContextMenuSeparator />
            {!block.deadlineExpedice ? (
              <ContextMenuItem disabled style={{ ...menuItemStyle, color: "rgba(255,255,255,0.3)" }}>
                🚚 Nejdřív vyplň termín expedice
              </ContextMenuItem>
            ) : block.expeditionPublishedAt ? (
              <ContextMenuItem
                onClick={() => onExpeditionUnpublish?.(block.id)}
                style={{ ...menuItemStyle, color: "rgba(239,68,68,0.9)" }}
              >
                🚚 Odebrat z Expedice
              </ContextMenuItem>
            ) : (
              <ContextMenuItem
                onClick={() => onExpeditionPublish?.(block.id)}
                style={menuItemStyle}
              >
                🚚 Zaplánovat do Expedice
              </ContextMenuItem>
            )}
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
  canEditDataDate = false,
  canEditMat = false,
  onDataChipDoubleClick,
  onError,
  onInfo,
  workingTimeLock = true,
  badgeColorMap = {},
  machineWeekShifts,
  isTiskar,
  onPrintComplete,
  assignedMachine,
  onNotify,
  onBlockVariantChange,
  onExpeditionPublish,
  onExpeditionUnpublish,
  onOpenNotes,
  onShiftBoundsChange,
  onSplitChipClick,
  pasteTarget,
  clipboardHasContent,
  pasteSlotDurationMs,
  pasteSourceIsZakazka,
  onPasteHere,
  onReflowMachine,
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
  const [shiftEdgePreview, setShiftEdgePreview] = useState<{
    machine: string; date: Date; shift: "MORNING" | "AFTERNOON" | "NIGHT"; edge: "start" | "end";
    previewMin: number;
  } | null>(null);
  const shiftEdgePreviewRef = useRef(shiftEdgePreview);
  // Banner stroje „Přepočítat" — brání double-clicku během probíhajícího hromadného reflow.
  const [reflowingMachine, setReflowingMachine] = useState<string | null>(null);
  const dragStateRef    = useRef<DragInternalState | null>(null);
  const dragDidMove     = useRef(false);
  const viewStartRef    = useRef<Date | null>(null);
  const slotHeightRef   = useRef(slotHeight);
  const colRefs         = useRef<(HTMLDivElement | null)[]>([null, null]);
  const callbacksRef    = useRef({ onBlockUpdate, onBlockCreate, onMultiSelect, onMultiBlockUpdate, onError, onInfo, onQueueDrop, onQueueDragCancel, onShiftBoundsChange });
  const queueDragItemRef = useRef(queueDragItem ?? null);
  const lassoRef        = useRef<{ startClientX: number; startClientY: number; active: boolean } | null>(null);
  const lassoRectRef    = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const blocksRef       = useRef(blocks);
  const selectedBlockIdsRef = useRef(selectedBlockIds ?? new Set<number>());

  // ── Precompute segmenty tiskových hodin (pauza uvnitř bloku) — jen bloky, kde
  // getBlockSegments vrátí non-null (ZAKAZKA, ne bypass, expanze sedí na uložený end
  // a obsahuje pauzu). 99 % bloků zde nemá záznam → renderují beze změny. Hook musí být
  // před případným early returnem (if (!viewStart)) níže — proto žije zde nahoře. ────
  const blockSegmentsMap = useMemo(() => {
    const m = new Map<number, PrintSegment[]>();
    for (const b of blocks) {
      const segs = getBlockSegments(b, machineWeekShifts ?? [], companyDays ?? []);
      if (segs) m.set(b.id, segs);
    }
    return m;
  }, [blocks, machineWeekShifts, companyDays]);

  // ── Precompute drift kalendáře (uložený end nesedí na aktuální expanzi) — vzor
  // blockSegmentsMap výše: hook musí být před early returnem (if (!viewStart)) níže.
  // `now` bereme jednou za render (ne per blok) — drift se nemění plynutím času tak
  // rychle, aby to vadilo; mapa se přepočítá při změně bloků/kalendáře, což stačí.
  const driftMap = useMemo(() => {
    const nowForDrift = new Date();
    const m = new Map<number, CalendarDriftInfo>();
    for (const b of blocks) {
      const drift = blockCalendarDrift(b, machineWeekShifts ?? [], companyDays ?? [], nowForDrift);
      if (drift) m.set(b.id, drift);
    }
    return m;
  }, [blocks, machineWeekShifts, companyDays]);

  // ── Right-click na prázdný grid: pozice myši pro výpočet času v "Vložit zde" ──
  const ctxGridMouseRef = useRef<{ x: number; y: number } | null>(null);
  // Lokální menu styl pro položky kontextového menu nad prázdným gridem
  // (analogie BlockCard.menuItemStyle, ale uvnitř TimelineGrid scope).
  const menuItemStyleEmpty: React.CSSProperties = {
    fontSize: 13,
    padding: "6px 10px",
    borderRadius: 7,
    color: "rgba(255,255,255,0.9)",
    cursor: "pointer",
    outline: "none",
  };

  // ── Edge auto-scroll při dragu ──────────────────────────────────────────────
  const autoScrollRef = useRef({ active: false, speed: 0, rafId: 0 });
  const lastMouseRef  = useRef({ clientX: 0, clientY: 0 });
  const workingTimeLockRef  = useRef(workingTimeLock);
  workingTimeLockRef.current = workingTimeLock;
  const machineWeekShiftsRef = useRef(machineWeekShifts);
  machineWeekShiftsRef.current = machineWeekShifts;
  const companyDaysRef = useRef(companyDays);
  companyDaysRef.current = companyDays;

  useEffect(() => { slotHeightRef.current = slotHeight; }, [slotHeight]);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  useEffect(() => { selectedBlockIdsRef.current = selectedBlockIds ?? new Set<number>(); }, [selectedBlockIds]);

  useEffect(() => {
    callbacksRef.current = { onBlockUpdate, onBlockCreate, onMultiSelect, onMultiBlockUpdate, onError, onInfo, onQueueDrop, onQueueDragCancel, onShiftBoundsChange };
  }, [onBlockUpdate, onBlockCreate, onMultiSelect, onMultiBlockUpdate, onError, onInfo, onQueueDrop, onQueueDragCancel, onShiftBoundsChange]);

  useEffect(() => { shiftEdgePreviewRef.current = shiftEdgePreview; }, [shiftEdgePreview]);

  useEffect(() => {
    // Nový queue drag start (null → item) čistí cache, stejně jako mousedown na bloku.
    if (queueDragItem && !queueDragItemRef.current) clearPreviewExpandCache();
    queueDragItemRef.current = queueDragItem ?? null;
  }, [queueDragItem]);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const start = pragueToUTC(addDaysToCivilDate(todayPragueDateStr(), -effectiveDaysBack), 0, 0);
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

  // ── Edge auto-scroll helpers ────────────────────────────────────────────────
  const EDGE_ZONE = 60;       // px od okraje scroll kontejneru
  const MAX_SCROLL_SPEED = 600; // px/s při kurzoru přímo na hraně

  function stopAutoScroll() {
    const as = autoScrollRef.current;
    if (as.rafId) cancelAnimationFrame(as.rafId);
    as.active = false;
    as.speed = 0;
    as.rafId = 0;
  }

  function autoScrollTick() {
    const as = autoScrollRef.current;
    if (!as.active) return;
    const el = scrollRef.current;
    if (!el) { stopAutoScroll(); return; }
    el.scrollTop += as.speed / 60; // 60fps → px/frame
    // Syntetický mousemove → přepočítá drag preview na nový scrollTop
    const lm = lastMouseRef.current;
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: lm.clientX, clientY: lm.clientY, bubbles: true }));
    as.rafId = requestAnimationFrame(autoScrollTick);
  }

  function updateAutoScroll(clientY: number) {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let speed = 0;
    if (clientY > rect.bottom - EDGE_ZONE) {
      const proximity = Math.min(1, Math.max(0, 1 - (rect.bottom - clientY) / EDGE_ZONE));
      speed = proximity * MAX_SCROLL_SPEED;
    } else if (clientY < rect.top + EDGE_ZONE) {
      const proximity = Math.min(1, Math.max(0, 1 - (clientY - rect.top) / EDGE_ZONE));
      speed = -proximity * MAX_SCROLL_SPEED;
    }
    const as = autoScrollRef.current;
    if (speed === 0) {
      if (as.active) stopAutoScroll();
    } else {
      as.speed = speed;
      if (!as.active) {
        as.active = true;
        as.rafId = requestAnimationFrame(autoScrollTick);
      }
    }
  }

  // ── Globální mouse listenery ───────────────────────────────────────────────
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      lastMouseRef.current = { clientX: e.clientX, clientY: e.clientY };

      // ── Edge auto-scroll — aktivní při jakémkoliv dragu ──
      const isDragging = !!(queueDragItemRef.current || lassoRef.current?.active || dragStateRef.current);
      if (isDragging) updateAutoScroll(e.clientY);
      else if (autoScrollRef.current.active) stopAutoScroll();

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
          const machine = visibleMachines[activeColIdx];
          const rect = el.getBoundingClientRect();
          const previewHeight = qdItem.durationHours * 2 * sh;
          const timelineY = e.clientY - rect.top + el.scrollTop - previewHeight / 2;
          const rawSnapped = snapToSlot(yToDate(timelineY, vs, sh));

          // Honest preview: jen ZAKAZKA + zapnutý zámek. Start se snapuje na nejbližší
          // runnable slot (stejně jako handleQueueDrop v PlannerPage) a výška se rozloží
          // expanzí přes tiskové hodiny — ne naivních durationHours*2*sh pixelů.
          let snappedStart = rawSnapped;
          let height = previewHeight;
          if (workingTimeLockRef.current && qdItem.type === "ZAKAZKA") {
            const weekShifts = machineWeekShiftsRef.current ?? [];
            const cdIntervals = companyDayIntervalsFor(machine, companyDaysRef.current ?? []);
            const snapped = snapStartToNextRunnableSlot(machine, rawSnapped, weekShifts, cdIntervals);
            if (snapped) {
              snappedStart = snapped;
              const pm = Math.round(qdItem.durationHours * 60);
              const exp = expandPrintTimeCached(machine, snappedStart, pm, weekShifts, cdIntervals);
              if (exp.ok) height = dateToY(exp.end, vs, sh) - dateToY(snappedStart, vs, sh);
            }
            // snapped === null (žádný runnable slot v horizontu) → fallback na rawSnapped/naivní výšku,
            // stejně jako u ostatních previews — preview nikdy neblokuje samotný drag.
          }

          const snappedY = dateToY(snappedStart, vs, sh);
          const previewEl = queuePreviewRefs.current[activeColIdx];
          if (previewEl) {
            previewEl.style.top = `${snappedY}px`;
            previewEl.style.height = `${Math.max(height, sh)}px`;
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

      const scrollDelta = (scrollRef.current?.scrollTop ?? 0) - ds.startScrollTop;
      const deltaY = e.clientY - ds.startClientY + scrollDelta;
      const deltaX = "startClientX" in ds ? e.clientX - ds.startClientX : 0;
      if (Math.abs(deltaY) + Math.abs(deltaX) > DRAG_THRESHOLD) dragDidMove.current = true;

      const sh = slotHeightRef.current;
      if (ds.type === "move") {
        const originalTop    = dateToY(ds.originalStart, vs, sh);
        const originalHeight = dateToY(ds.originalEnd, vs, sh) - originalTop;
        const newMachine     = clientXToMachine(e.clientX);
        const snappedStart   = snapToSlot(yToDate(originalTop + deltaY, vs, sh));
        const snappedTop     = dateToY(snappedStart, vs, sh);

        // Honest ghost: jen ZAKAZKA + zapnutý zámek. Jinak (nebo při selhání expanze)
        // dnešní naivní výška = stejná jako originál (blok se jen posouvá, délka se nemění).
        let height = originalHeight;
        const sourceBlock = blocksRef.current.find((b) => b.id === ds.blockId);
        if (workingTimeLockRef.current && sourceBlock?.type === "ZAKAZKA" && !sourceBlock.scheduleBypassed) {
          const pm = blockPrintMinutes(sourceBlock);
          const exp = expandPrintTimeCached(
            newMachine, snappedStart, pm,
            machineWeekShiftsRef.current ?? [],
            companyDayIntervalsFor(newMachine, companyDaysRef.current ?? [])
          );
          if (exp.ok) height = dateToY(exp.end, vs, sh) - snappedTop;
        }
        setDragPreview({ blockId: ds.blockId, top: snappedTop, height, machine: newMachine });
      } else if (ds.type === "resize") {
        const originalTop    = dateToY(ds.originalStart, vs, sh);
        const originalHeight = dateToY(ds.originalEnd, vs, sh) - originalTop;
        const rawEnd         = yToDate(originalTop + Math.max(sh, originalHeight + deltaY), vs, sh);
        const snappedEnd     = snapToSlot(rawEnd);
        let finalEnd         = snappedEnd;
        let resizePrintMinutes: number | undefined;

        const sourceBlock = blocksRef.current.find((b) => b.id === ds.blockId);
        // Guard nezarovnaného startu (legacy bloky) — computePrintMinutes by v mousemove smyčce házel (vzor getBlockSegments).
        if (workingTimeLockRef.current && sourceBlock?.type === "ZAKAZKA" && !sourceBlock.scheduleBypassed && snappedEnd.getTime() > ds.originalStart.getTime() && ds.originalStart.getTime() % SLOT_MS === 0) {
          const weekShifts = machineWeekShiftsRef.current ?? [];
          const cdIntervals = companyDayIntervalsFor(ds.originalMachine, companyDaysRef.current ?? []);
          const pm = computePrintMinutes(ds.originalMachine, ds.originalStart, snappedEnd, weekShifts, cdIntervals);
          const exp = expandPrintTimeCached(ds.originalMachine, ds.originalStart, Math.max(30, pm), weekShifts, cdIntervals);
          if (exp.ok) {
            finalEnd = exp.end;
            resizePrintMinutes = Math.max(30, pm);
          }
        }
        const snappedHeight = Math.max(sh, dateToY(finalEnd, vs, sh) - originalTop);
        setDragPreview({ blockId: ds.blockId, top: originalTop, height: snappedHeight, machine: ds.originalMachine, resizeEnd: finalEnd, resizeStart: ds.originalStart, resizePrintMinutes });
      } else if (ds.type === "multi-move") {
        const deltaMs    = Math.round((deltaY / sh) * 30 * 60 * 1000 / SLOT_MS) * SLOT_MS;
        const newMachine = clientXToMachine(e.clientX);
        const anchor     = ds.blocks.find(b => b.id === ds.anchorBlockId);
        if (!anchor) return;
        const newStart   = new Date(anchor.originalStart.getTime() + deltaMs);
        const newEnd     = new Date(anchor.originalEnd.getTime() + deltaMs);
        setDragPreview({ blockId: ds.anchorBlockId, top: dateToY(newStart, vs, sh), height: dateToY(newEnd, vs, sh) - dateToY(newStart, vs, sh), machine: newMachine });
      } else if (ds.type === "shift-edge-resize") {
        const scrollDeltaLocal = (scrollRef.current?.scrollTop ?? 0) - ds.startScrollTop;
        const dy = e.clientY - ds.startClientY + scrollDeltaLocal;
        const deltaMin = Math.round(dy / sh) * 30;
        const newMinRaw = ds.origMin + deltaMin;
        const range = rangeFor(ds.shift, ds.edge);
        const newMin = Math.max(range[0], Math.min(range[1], newMinRaw));
        if (Math.abs(dy) > DRAG_THRESHOLD) dragDidMove.current = true;
        setShiftEdgePreview({ machine: ds.machine, date: ds.date, shift: ds.shift, edge: ds.edge, previewMin: newMin });
      }
    }

    async function onMouseUp(e: MouseEvent) {
      stopAutoScroll();
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
      // Snapshot shift-edge preview BEFORE clearing — jinak by ho ref mohl ztratit.
      const shiftPreviewSnapshot = shiftEdgePreviewRef.current;
      dragStateRef.current = null;
      dragDidMove.current  = false;
      setDragPreview(null);
      // Clear shift-edge preview unconditionally (no-op for other drag types)
      setShiftEdgePreview(null);

      // shift-edge-resize handles own commit, with moved==false allowed fall-through
      if (ds.type === "shift-edge-resize") {
        if (!moved) return;
        const preview = shiftPreviewSnapshot;
        if (!preview || preview.previewMin === ds.origMin) return;
        const def = SHIFT_HOURS[ds.shift];
        const defaultMin = ds.edge === "start" ? def.start * 60 : def.end * 60;
        const valueToSend = preview.previewMin === defaultMin ? null : preview.previewMin;
        try {
          await callbacksRef.current.onShiftBoundsChange?.(
            ds.machine, ds.date, ds.shift, ds.edge, valueToSend, ds.jointDrag
          );
        } catch (err) {
          console.error("shift-edge-resize commit failed", err);
          callbacksRef.current.onError?.("Nepodařilo se upravit pracovní dobu.");
        }
        return;
      }

      if (!moved) return;

      const scrollDelta = (scrollRef.current?.scrollTop ?? 0) - ds.startScrollTop;
      const deltaY = e.clientY - ds.startClientY + scrollDelta;
      const sh = slotHeightRef.current;

      if (ds.type === "move") {
        const originalTop = dateToY(ds.originalStart, vs, sh);
        const newMachine  = clientXToMachine(e.clientX);
        const duration    = ds.originalEnd.getTime() - ds.originalStart.getTime();
        const requestedStart = snapToSlot(yToDate(originalTop + deltaY, vs, sh));
        const sourceBlock = blocksRef.current.find((b) => b.id === ds.blockId);
        const isZakazka = sourceBlock?.type === "ZAKAZKA";
        let newStart = requestedStart;
        if (workingTimeLockRef.current) {
          if (isZakazka) {
            const snapped = snapStartToNextRunnableSlot(
              newMachine,
              requestedStart,
              machineWeekShiftsRef.current ?? [],
              companyDayIntervalsFor(newMachine, companyDaysRef.current ?? [])
            );
            if (!snapped) {
              callbacksRef.current.onError?.("V okolí není žádný pracovní slot — blok nelze umístit.");
              return;
            }
            newStart = snapped;
          } else {
            newStart = snapToNextValidStartWithTemplates(newMachine, requestedStart, duration, machineWeekShiftsRef.current ?? []);
          }
          if (newStart.getTime() !== requestedStart.getTime()) {
            callbacksRef.current.onInfo?.("Blok přesunut mimo pracovní dobu — automaticky umístěn do nejbližšího dostupného slotu.");
          }
        }
        const body: Record<string, unknown> = {
          startTime: newStart.toISOString(),
          machine: newMachine,
          bypassScheduleValidation: !workingTimeLockRef.current,
          resolveChain: true,
        };
        if (isZakazka && sourceBlock) {
          body.printMinutes = blockPrintMinutes(sourceBlock);
        } else {
          body.endTime = new Date(newStart.getTime() + duration).toISOString();
        }
        try {
          const res     = await fetch(`/api/blocks/${ds.blockId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
          const res     = await fetch(`/api/blocks/${ds.blockId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endTime: finalEnd >= minEnd ? finalEnd.toISOString() : minEnd.toISOString(), bypassScheduleValidation: !workingTimeLockRef.current, resolveChain: true }) });
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
          const zakazkaOnly = blocksOnNewMachine.every((b) => b.type === "ZAKAZKA");
          if (zakazkaOnly) {
            const r = snapGroupDeltaStartOnly(
              blocksOnNewMachine.map((b) => ({ machine: b.machine, originalStart: b.originalStart })),
              deltaMs,
              machineWeekShiftsRef.current ?? [],
              companyDaysRef.current ?? []
            );
            if (!r) {
              callbacksRef.current.onError?.("V okolí není žádný pracovní slot — bloky nelze umístit.");
              return;
            }
            deltaMs = r.deltaMs;
            if (r.wasSnapped) callbacksRef.current.onError?.("Bloky přeskočeny přes víkend/noc");
          } else {
            // smíšený výběr: starý duration-based snap (ne-ZAKAZKA server nevaliduje)
            const { deltaMs: snapped, wasSnapped } = snapGroupDeltaWithTemplates(blocksOnNewMachine, deltaMs, machineWeekShiftsRef.current ?? []);
            deltaMs = snapped;
            if (wasSnapped) callbacksRef.current.onError?.("Bloky přeskočeny přes víkend/noc");
          }
        }
        const updates    = ds.blocks.map(b => ({
          id:        b.id,
          machine:   newMachine,
          startTime: new Date(b.originalStart.getTime() + deltaMs),
          endTime:   new Date(b.originalEnd.getTime()   + deltaMs),
        }));
        callbacksRef.current.onMultiBlockUpdate?.(updates);
      }
    }

    function onSelectStart(e: Event) {
      if (lassoRef.current?.active) e.preventDefault();
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("selectstart", onSelectStart);
    return () => {
      stopAutoScroll();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("selectstart", onSelectStart);
    };
  }, []); // prázdné deps — čte z refs


  // ── Handlery bloků ─────────────────────────────────────────────────────────
  function handleBlockMouseDown(block: Block, e: React.MouseEvent) {
    if (block.locked) return;
    if (e.button !== 0) return;
    e.preventDefault();
    const vs = viewStartRef.current;
    if (!vs) return;
    clearPreviewExpandCache();
    const sh     = slotHeightRef.current;
    const top    = dateToY(new Date(block.startTime), vs, sh);
    const height = dateToY(new Date(block.endTime), vs, sh) - top;
    const ids    = selectedBlockIdsRef.current;
    const isMulti = ids.has(block.id) && ids.size > 1;
    const sst = scrollRef.current?.scrollTop ?? 0;
    if (isMulti) {
      const selBlocks = blocksRef.current.filter(b => ids.has(b.id) && !b.locked);
      dragStateRef.current = {
        type: "multi-move",
        blocks: selBlocks.map(b => ({ id: b.id, machine: b.machine, type: b.type, originalStart: new Date(b.startTime), originalEnd: new Date(b.endTime) })),
        startClientY: e.clientY, startClientX: e.clientX, startScrollTop: sst,
        anchorBlockId: block.id,
      };
    } else {
      dragStateRef.current = { type: "move", blockId: block.id, originalMachine: block.machine, startClientY: e.clientY, startClientX: e.clientX, startScrollTop: sst, originalStart: new Date(block.startTime), originalEnd: new Date(block.endTime) };
    }
    dragDidMove.current = false;
    setDragPreview({ blockId: block.id, top, height, machine: block.machine });
  }

  function handleResizeMouseDown(block: Block, e: React.MouseEvent) {
    if (block.locked) return;
    e.preventDefault();
    const vs = viewStartRef.current;
    if (!vs) return;
    clearPreviewExpandCache();
    dragStateRef.current = { type: "resize", blockId: block.id, originalMachine: block.machine, startClientY: e.clientY, startClientX: e.clientX, startScrollTop: scrollRef.current?.scrollTop ?? 0, originalStart: new Date(block.startTime), originalEnd: new Date(block.endTime) };
    dragDidMove.current  = false;
    const sh     = slotHeightRef.current;
    const top    = dateToY(new Date(block.startTime), vs, sh);
    const height = dateToY(new Date(block.endTime), vs, sh) - top;
    setDragPreview({ blockId: block.id, top, height, machine: block.machine });
  }

  function calcSplitAt(clientY: number, block: Block): Date {
    const vs = viewStartRef.current;
    const blockStart = new Date(block.startTime);
    const blockEnd   = new Date(block.endTime);
    const calendarMid = snapToSlot(new Date((blockStart.getTime() + blockEnd.getTime()) / 2));
    // Default bod splitu: polovina TISKOVÝCH minut (ne kalendářní mid) — plánovač u bloku
    // s pauzou (přes odstávku) chce dělit podle odpracovaného tisku, ne podle hodin na ose.
    // printMidpoint může u malých pm (zaokrouhlení na slot) degenerovat na block.endTime —
    // takový výsledek není "uvnitř" bloku, proto padá zpět na kalendářní mid.
    let mid = calendarMid;
    if (block.type === "ZAKAZKA") {
      const pmMid = printMidpoint(block, machineWeekShiftsRef.current ?? [], companyDaysRef.current ?? []);
      if (pmMid && pmMid > blockStart && pmMid < blockEnd) {
        mid = snapToSlot(pmMid);
      }
    }
    if (!vs) return mid;
    const rawSplit = snapToSlot(yToDate(clientYToTimelineY(clientY), vs));
    return rawSplit > blockStart && rawSplit < blockEnd ? rawSplit : mid;
  }

  async function handleSplitBlockAt(block: Block, splitAt: Date) {
    // Model tiskových hodin: dopředu spočítat tiskové minuty obou částí, PŘED jakoukoli
    // mutací — tail POST musí poslat printMinutes, jinak server dopočítá pm z elapsed span
    // (u pozastaveného bloku = ~3× víc, nebo 422 při elapsed > 2400 — tichá korupce plánu).
    let headPm: number | null = null;
    let tailPm: number | null = null;
    if (block.type === "ZAKAZKA") {
      const totalPm = blockPrintMinutes(block);
      if (block.scheduleBypassed === true) {
        // Bypassnutý blok: computePrintMinutes není bypass-aware → elapsed-based split.
        // Runnable guard (isMachineRunnableAt, viz else větev) se zde záměrně NEaplikuje —
        // bypass blok byl umístěn PRÁVĚ MIMO runnable kalendář (to bypass znamená), guard
        // by na jeho vlastním rozsahu skoro vždy padal. Head/tail payloady níže nesou
        // bypassScheduleValidation:true, takže server obě části validuje bypass-větví
        // (end = start + pm, bez nároku na runnable start) — 422 z kalendářového důvodu
        // zde nehrozí.
        headPm = Math.round((splitAt.getTime() - new Date(block.startTime).getTime()) / 60000);
      } else {
        // Guard: splitAt musí padnout na runnable slot (tiskovou část kalendáře), jinak
        // by hlava commitla PUTem hned teď, ale tail POST se startem v pauze by spadl na
        // START_NOT_RUNNABLE (422) AŽ PO té — plán by zůstal v rozbitém mezistavu.
        const cdIntervals = companyDayIntervalsFor(block.machine, companyDaysRef.current ?? []);
        if (!isMachineRunnableAt(block.machine, splitAt, machineWeekShiftsRef.current ?? [], cdIntervals)) {
          callbacksRef.current.onError?.("Nelze rozdělit uvnitř pauzy — zvol místo v tiskové části.");
          return;
        }
        headPm = computePrintMinutes(
          block.machine,
          new Date(block.startTime),
          splitAt,
          machineWeekShiftsRef.current ?? [],
          cdIntervals
        );
      }
      tailPm = totalPm - headPm;
      if (headPm <= 0 || tailPm <= 0) {
        callbacksRef.current.onError?.("Nelze rozdělit v tomto místě — jedna část by neměla žádný tiskový čas.");
        return;
      }
    }
    // Sticky-bypass parity (Task 8, etapa 6): zdrojový blok s scheduleBypassed=true byl umístěn
    // MIMO kalendář (start typicky leží v pauze/odstávce) — bez explicitního bypass flagu by
    // server na head PUT zkusil kalendářní expanzi/inverzi na nerunnable startu a spadl (nebo
    // tiše seškrtal tiskový čas), tail POST by pak selhal na 422 AŽ PO commitu hlavy (rozbitý
    // mezistav: hlava zkrácená, ocas neexistuje). Sticky = jen REQUEST flag; server si
    // effectivelyBypassed dopočítá sám (část, která náhodou sedí na kalendář, se uloží jako
    // scheduleBypassed=false — to je správně, viz validateAndComputeEnd).
    const isBypassSource = block.type === "ZAKAZKA" && block.scheduleBypassed === true;
    // Kompenzační payload pro krok 1 — vrací hlavu na PŮVODNÍ (před-splitové) hodnoty. totalPm
    // (ne headPm!) je originální printMinutes bypass zdroje, protože před splitem měl blok
    // celý tiskový čas, ne jen hlavu.
    const headRevertBody = {
      endTime: block.endTime,
      ...(isBypassSource ? { printMinutes: blockPrintMinutes(block), bypassScheduleValidation: true } : {}),
    };
    // Zásobník kompenzací (LIFO) — každý úspěšný zápis hlavy sem přidá funkci, která ho vrátí.
    // Při selhání pozdějšího kroku se přehraje v obráceném pořadí zápisu (Krok 2 před Krokem 1).
    const compensations: Array<() => Promise<void>> = [];
    const runCompensations = async (): Promise<boolean> => {
      for (let i = compensations.length - 1; i >= 0; i--) {
        try {
          await compensations[i]();
        } catch {
          return false; // i kompenzace selhala — fail-safe hláška, žádný tichý stav
        }
      }
      return true;
    };
    try {
      // Krok 1: zkrátit původní blok
      const res1 = await fetch(`/api/blocks/${block.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endTime: splitAt.toISOString(),
          // pm jen pro bypass zdroj — ne-bypass head PUT posílá pouze endTime a server si
          // printMinutes NEZÁVISLE invertuje z čerstvého kalendáře (computePrintMinutes
          // v transakci); klientsky spočítané pm by při stale kalendáři tiše posunulo
          // hranici splitu (nález review T8). Tail POST pm potřebuje vždy (nový blok).
          ...(isBypassSource ? { printMinutes: headPm, bypassScheduleValidation: true } : {}),
        }),
      });
      if (!res1.ok) {
        const err = await res1.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Nepodařilo se zkrátit blok.");
      }
      const updatedBlock: Block = await res1.json();
      compensations.push(async () => {
        const revertRes = await fetch(`/api/blocks/${block.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(headRevertBody),
        });
        if (!revertRes.ok) throw new Error("revert krok 1 selhal");
        onBlockUpdate(await revertRes.json());
      });

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
        compensations.push(async () => {
          const revertRes = await fetch(`/api/blocks/${block.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ splitGroupId: null }),
          });
          if (!revertRes.ok) throw new Error("revert krok 2 selhal");
          onBlockUpdate(await revertRes.json());
        });
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
          ...(block.type === "ZAKAZKA" ? { printMinutes: tailPm } : {}),
          ...(isBypassSource ? { bypassScheduleValidation: true } : {}),
          resolveChain: true,
        }),
      });
      if (!res2.ok) {
        const err = await res2.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Nepodařilo se vytvořit druhý blok.");
      }
      onBlockCreate(await res2.json());
    } catch (error) {
      console.error("Block split failed", error);
      // Tail (nebo krok 2) selhal PO úspěšném zápisu hlavy — bez kompenzace by hlava zůstala
      // trvale zkrácená (tichá ztráta tiskového času). Když selhal už krok 1 (compensations
      // prázdný), není co vracet — použije se stará hláška z error.message beze změny chování.
      if (compensations.length > 0) {
        const reverted = await runCompensations();
        callbacksRef.current.onError?.(
          reverted
            ? "Rozdělení se nepovedlo — blok vrácen do původní délky."
            : "Rozdělení selhalo a blok se nepodařilo vrátit — obnov stránku a zkontroluj blok."
        );
      } else {
        callbacksRef.current.onError?.((error instanceof Error ? error.message : null) ?? "Blok se nepodařilo rozdělit.");
      }
    }
  }

  // ── Banner stroje „Přepočítat" — počet driftujících bloků per stroj z driftMap
  // (O(n) přes blocks, n je malé — počet bloků na gridu). Jen ADMIN/PLANOVAT (canEdit)
  // vidí chip + tlačítko (akce); badge na kartě už informaci nese pro všechny role.
  const driftCountByMachine = new Map<string, number>();
  for (const b of blocks) {
    if (!driftMap.has(b.id)) continue;
    driftCountByMachine.set(b.machine, (driftCountByMachine.get(b.machine) ?? 0) + 1);
  }

  async function handleReflowClick(machine: string) {
    const n = driftCountByMachine.get(machine) ?? 0;
    if (n === 0 || !onReflowMachine || reflowingMachine) return;
    const machineLabel = machine.replace("_", " ");
    if (!window.confirm(`Přepočítat ${n} bloků na ${machineLabel}? Bloky se posunou na nejbližší platné sloty (zamčené se přeskočí).`)) {
      return;
    }
    setReflowingMachine(machine);
    try {
      await onReflowMachine(machine);
    } finally {
      setReflowingMachine(null);
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
      {visibleMachines.flatMap((machine, idx) => {
        const driftCount = driftCountByMachine.get(machine) ?? 0;
        return [
        idx > 0 ? <div key={`hgap-${idx}`} style={{ width: TIME_COL_W, flexShrink: 0, borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)", backgroundColor: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: "var(--text-muted)", textTransform: "uppercase" }}>ČAS</span>
        </div> : null,
        <div key={machine} style={{ flex: 1, padding: "8px 12px", color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }} className="text-xs font-bold">
          <span>{machine.replace("_", "\u00a0")}</span>
          {canEdit && driftCount > 0 && (
            <>
              <span
                title="Počet bloků, jejichž umístění nesedí na aktuální kalendář pracovní doby/odstávek"
                style={{
                  fontSize: 10, fontWeight: 700, color: "#1f2937", background: "#f59e0b",
                  borderRadius: 4, padding: "1px 6px", lineHeight: 1.4, whiteSpace: "nowrap",
                }}
              >
                ⚠ {driftCount} nesedí na kalendář
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void handleReflowClick(machine); }}
                disabled={reflowingMachine === machine}
                style={{
                  fontSize: 10, fontWeight: 600, color: "#fff",
                  background: reflowingMachine === machine ? "rgba(59,130,246,0.5)" : "#3b82f6",
                  border: "none", borderRadius: 4, padding: "2px 8px", lineHeight: 1.4,
                  cursor: reflowingMachine === machine ? "default" : "pointer", whiteSpace: "nowrap",
                }}
              >
                {reflowingMachine === machine ? "Přepočítávám…" : "Přepočítat"}
              </button>
            </>
          )}
        </div>,
      ];
      })}
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

  const viewStartDateStr = utcToPragueDateStr(viewStart);
  const viewEnd = pragueToUTC(addDaysToCivilDate(viewStartDateStr, totalDays), 0, 0);
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

  // ── Precompute střídání odstínů (parita 0/1 per barevný bucket, per stroj) ──
  // Počítá se přes VŠECHNY bloky stroje (ne jen viditelné), aby střídání zůstalo
  // stabilní i při scrollu. Vlastní světlý/tmavý wash aplikuje BlockCard.
  const shadeParityByBlockId = (() => {
    const byMachine = new Map<string, Block[]>();
    for (const b of blocks) {
      if (!byMachine.has(b.machine)) byMachine.set(b.machine, []);
      byMachine.get(b.machine)!.push(b);
    }
    const merged = new Map<number, 0 | 1>();
    for (const arr of byMachine.values()) {
      for (const [id, parity] of computeShadeParity(arr)) merged.set(id, parity);
    }
    return merged;
  })();

  // ── Precompute markers ─────────────────────────────────────────────────────
  const todayDateStr = todayPragueDateStr();

  type DayInfo = {
    date: Date;
    dateStr: string;
    dayOfWeek: number;
    dayOfMonth: number;
    monthIndex: number;
    year: number;
    y: number;
    isWeekend: boolean;
    isToday: boolean;
    isHoliday: boolean;
    isCompanyDay: boolean;
    companyDayLabel?: string;
  };
  const days: DayInfo[] = [];

  // Výpočet svátkové sady pro všechny roky v zobrazovaném rozsahu
  const holidays = (() => {
    const years = new Set<number>();
    for (let i = 0; i < totalDays; i++) years.add(civilDateParts(addDaysToCivilDate(viewStartDateStr, i)).year);
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
    const dateStr = addDaysToCivilDate(viewStartDateStr, di);
    const day = pragueToUTC(dateStr, 0, 0);
    const dayY = di * dayHeight;
    const dow = civilDateDayOfWeek(dateStr);
    const parts = civilDateParts(dateStr);
    const isWeekend = dow === 0 || dow === 6;
    const isToday  = dateStr === todayDateStr;
    const isHoliday = holidays.has(dateStr);
    const companyDayMatch = companyDayPragueRanges.find(({ startPrague, endPrague }) => dateStr >= startPrague && dateStr <= endPrague)?.cd;
    days.push({
      date: day,
      dateStr,
      dayOfWeek: dow,
      dayOfMonth: parts.day,
      monthIndex: parts.monthIndex,
      year: parts.year,
      y: dayY,
      isWeekend,
      isToday,
      isHoliday,
      isCompanyDay: !!companyDayMatch,
      companyDayLabel: companyDayMatch?.label,
    });
    // Blocked overlays — pracovní doba per-týden
    for (const machine of visibleMachines) {
      const resolvedRows = machineWeekShifts ? resolveScheduleRows(machine, day, machineWeekShifts) : [];
      const row = resolvedRows.find((r) => r.dayOfWeek === dow);
      const isException = false;
      const excId = null;

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
      } else {
        // Forward-semantic intervaly (včetně prev-day NIGHT tail) — single source of truth.
        const intervals = machineWeekShifts
          ? resolveDayIntervals(machine, dateStr, machineWeekShifts)
          : [];
        // Live preview override pro aktuální den (jen source=current).
        const preview = shiftEdgePreview;
        const previewMatchesDay =
          preview && preview.machine === machine && utcToPragueDateStr(preview.date) === dateStr;

        // Pro prev-tail: preview.date ukazuje na předchozí den (owner).
        const prevDate = new Date(day.getTime() - 24 * 60 * 60 * 1000);
        const previewMatchesPrev =
          preview && preview.machine === machine && preview.shift === "NIGHT" &&
          preview.edge === "end" && utcToPragueDateStr(preview.date) === utcToPragueDateStr(prevDate);

        const activeSpans: Array<[number, number]> = [];
        for (const iv of intervals) {
          let startMin = iv.startMin;
          let endMin = iv.endMin;
          if (iv.source === "current" && previewMatchesDay && preview!.shift === iv.shift) {
            if (preview!.edge === "start") startMin = preview!.previewMin;
            if (preview!.edge === "end") endMin = preview!.previewMin;
          } else if (iv.source === "prev-tail" && previewMatchesPrev) {
            // Drag NIGHT-end of prev day: tail shrinks/expands on current day.
            endMin = preview!.previewMin;
          }
          const s = Math.round(startMin / 30);
          const e = Math.round(endMin / 30);
          if (e > s) activeSpans.push([s, e]);
        }
        // Sort + merge překrývajících se / sousedících span.
        activeSpans.sort((a, b) => a[0] - b[0]);
        const merged: Array<[number, number]> = [];
        for (const [s, e] of activeSpans) {
          if (merged.length && merged[merged.length - 1][1] >= s) {
            merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
          } else {
            merged.push([s, e]);
          }
        }
        // Komplement = blocked spans.
        let cursor = 0;
        const blockedSpans: Array<[number, number]> = [];
        for (const [s, e] of merged) {
          if (s > cursor) blockedSpans.push([cursor, s]);
          cursor = Math.max(cursor, e);
        }
        if (cursor < DAY_SLOT_COUNT) blockedSpans.push([cursor, DAY_SLOT_COUNT]);
        // Emit jeden BlockedOverlay per blocked span.
        for (let bi = 0; bi < blockedSpans.length; bi++) {
          const [bs, be] = blockedSpans[bi];
          const startsAtZero = bs === 0;
          const endsAtDay = be === DAY_SLOT_COUNT;
          const overlayType: "start-block" | "end-block" | "full-block" =
            startsAtZero && endsAtDay ? "full-block" : startsAtZero ? "start-block" : "end-block";
          blockedOverlays[machine].push({
            top: dayY + bs * slotHeight,
            height: (be - bs) * slotHeight,
            key: `b-${machine}-iv${bi}-${di}`,
            date: day,
            machine,
            overlayType,
            effectiveStartSlot: bs,
            effectiveEndSlot: be,
            isException,
            exceptionId: excId,
          });
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

  // Zamknuté bloky per machine pro TIME sloupec overlay
  const lockedBlocksByMachine = new Map<string, Block[]>();
  for (const machine of visibleMachines) {
    lockedBlocksByMachine.set(machine, blocks.filter(b => b.locked && b.machine === machine));
  }

  const unconfirmedResByMachine = new Map<string, Block[]>();
  for (const machine of visibleMachines)
    unconfirmedResByMachine.set(machine, blocks.filter(b => b.type === "REZERVACE" && b.reservationId != null && !b.reservationConfirmedAt && b.machine === machine));

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
            {days.map((d, di) => (
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
                    {DAY_ABBR[d.dayOfWeek]}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, lineHeight: 1, color: d.isToday ? "#38bdf8" : d.isHoliday ? "#f87171" : d.isCompanyDay ? "#f87171" : d.isWeekend ? "#f87171" : "var(--text)" }}>
                    {d.dayOfMonth}
                  </span>
                  <span style={{ fontSize: 8, fontWeight: 600, lineHeight: 1, color: d.isToday ? "#7dd3fc" : d.isHoliday ? "#fca5a5" : d.isCompanyDay ? "#fca5a5" : d.isWeekend ? "#fca5a5" : "var(--text-muted)" }}>
                    {MONTH_ABBR[d.monthIndex]}
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
                  {height >= 18 && (
                    <div style={{ position: "absolute", top: 4, left: 8, display: "flex", alignItems: "center", gap: 4, maxWidth: "calc(100% - 16px)" }}>
                      {cd.label && (
                        <div title={cd.label} style={{ height: 14, padding: "0 5px", borderRadius: 3, background: "rgba(153,27,27,0.85)", color: "#fecaca", fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", lineHeight: 1 }}>
                          {cd.label}
                        </div>
                      )}
                      <div style={{ height: 14, padding: "0 5px", borderRadius: 3, flexShrink: 0, background: !cd.machine ? "rgba(139,92,246,0.5)" : cd.machine === "XL_105" ? "rgba(59,130,246,0.4)" : "rgba(34,197,94,0.4)", color: !cd.machine ? "#c4b5fd" : cd.machine === "XL_105" ? "#93c5fd" : "#86efac", fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", whiteSpace: "nowrap", display: "flex", alignItems: "center", lineHeight: 1 }}>
                        {!cd.machine ? "OBA" : cd.machine === "XL_105" ? "XL 105" : "XL 106"}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {/* Lock overlay — amber indikátor zamknutých bloků */}
            {viewStart && (lockedBlocksByMachine.get(visibleMachines[0]) ?? []).map((lb) => {
              const totalH = totalDays * dayHeight;
              const top = dateToY(new Date(lb.startTime), viewStart, slotHeight);
              const bottom = dateToY(new Date(lb.endTime), viewStart, slotHeight);
              const clampedTop = Math.max(0, Math.min(top, totalH));
              const clampedBottom = Math.max(0, Math.min(bottom, totalH));
              const h = clampedBottom - clampedTop;
              if (h <= 0) return null;
              const startD = new Date(lb.startTime);
              const timeStr = startD.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
              return (
                <div key={`lock-t0-${lb.id}`} style={{ position: "absolute", top: clampedTop, height: h, left: 0, right: 0, background: "rgba(251,191,36,0.15)", borderTop: "1.5px solid rgba(251,191,36,0.5)", borderBottom: "1.5px solid rgba(251,191,36,0.5)", pointerEvents: "none", overflow: "hidden" }}>
                  {h >= 14 && (
                    <div style={{ position: "absolute", top: 2, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                      <Lock size={9} strokeWidth={2.5} color="rgba(251,191,36,1)" />
                      <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(251,191,36,1)", letterSpacing: "0.03em" }}>{timeStr}</span>
                    </div>
                  )}
                </div>
              );
            })}
            {/* Hourglass overlay — fialový indikátor nepotvrzených rezervací */}
            {viewStart && (unconfirmedResByMachine.get(visibleMachines[0]) ?? []).map((ub) => {
              const totalH = totalDays * dayHeight;
              const top = dateToY(new Date(ub.startTime), viewStart, slotHeight);
              const bottom = dateToY(new Date(ub.endTime), viewStart, slotHeight);
              const clampedTop = Math.max(0, Math.min(top, totalH));
              const clampedBottom = Math.max(0, Math.min(bottom, totalH));
              const h = clampedBottom - clampedTop;
              if (h <= 0) return null;
              const startD = new Date(ub.startTime);
              const timeStr = startD.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
              return (
                <div key={`hg-t0-${ub.id}`} style={{ position: "absolute", top: clampedTop, height: h, left: 0, right: 0, background: "rgba(168,85,247,0.12)", borderTop: "1.5px solid rgba(168,85,247,0.4)", borderBottom: "1.5px solid rgba(168,85,247,0.4)", pointerEvents: "none", overflow: "hidden" }}>
                  {h >= 14 && (
                    <div style={{ position: "absolute", top: 2, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                      <Hourglass size={9} strokeWidth={2.5} color="rgba(168,85,247,0.9)" />
                      <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(168,85,247,0.9)", letterSpacing: "0.03em" }}>{timeStr}</span>
                    </div>
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
                    {/* Lock overlay — amber indikátor zamknutých bloků (druhý stroj) */}
                    {viewStart && (lockedBlocksByMachine.get(visibleMachines[colIdx]) ?? []).map((lb) => {
                      const totalH = totalDays * dayHeight;
                      const top = dateToY(new Date(lb.startTime), viewStart, slotHeight);
                      const bottom = dateToY(new Date(lb.endTime), viewStart, slotHeight);
                      const clampedTop = Math.max(0, Math.min(top, totalH));
                      const clampedBottom = Math.max(0, Math.min(bottom, totalH));
                      const h = clampedBottom - clampedTop;
                      if (h <= 0) return null;
                      const startD = new Date(lb.startTime);
                      const timeStr = startD.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
                      return (
                        <div key={`lock-t${colIdx}-${lb.id}`} style={{ position: "absolute", top: clampedTop, height: h, left: 0, right: 0, background: "rgba(251,191,36,0.15)", borderTop: "1.5px solid rgba(251,191,36,0.5)", borderBottom: "1.5px solid rgba(251,191,36,0.5)", pointerEvents: "none", overflow: "hidden" }}>
                          {h >= 14 && (
                            <div style={{ position: "absolute", top: 2, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                              <Lock size={9} strokeWidth={2.5} color="rgba(251,191,36,1)" />
                              <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(251,191,36,1)", letterSpacing: "0.03em" }}>{timeStr}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* Hourglass overlay — fialový indikátor nepotvrzených rezervací (druhý stroj) */}
                    {viewStart && (unconfirmedResByMachine.get(visibleMachines[colIdx]) ?? []).map((ub) => {
                      const totalH = totalDays * dayHeight;
                      const top = dateToY(new Date(ub.startTime), viewStart, slotHeight);
                      const bottom = dateToY(new Date(ub.endTime), viewStart, slotHeight);
                      const clampedTop = Math.max(0, Math.min(top, totalH));
                      const clampedBottom = Math.max(0, Math.min(bottom, totalH));
                      const h = clampedBottom - clampedTop;
                      if (h <= 0) return null;
                      const startD = new Date(ub.startTime);
                      const timeStr = startD.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
                      return (
                        <div key={`hg-t${colIdx}-${ub.id}`} style={{ position: "absolute", top: clampedTop, height: h, left: 0, right: 0, background: "rgba(168,85,247,0.12)", borderTop: "1.5px solid rgba(168,85,247,0.4)", borderBottom: "1.5px solid rgba(168,85,247,0.4)", pointerEvents: "none", overflow: "hidden" }}>
                          {h >= 14 && (
                            <div style={{ position: "absolute", top: 2, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                              <Hourglass size={9} strokeWidth={2.5} color="rgba(168,85,247,0.9)" />
                              <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(168,85,247,0.9)", letterSpacing: "0.03em" }}>{timeStr}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              <ContextMenu>
              <ContextMenuTrigger asChild>
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
                onContextMenu={(e: React.MouseEvent) => {
                  // Block-level ContextMenu (uvnitř BlockCard) má precedenci díky
                  // Radix event propagation — pokud je target uvnitř bloku, gridové
                  // menu se vůbec neotevírá. Zaznamenáme pozici myši jen pro
                  // klik mimo blok, aby "Vložit zde" znalo místo vložení.
                  if ((e.target as HTMLElement).closest("[data-block]")) return;
                  ctxGridMouseRef.current = { x: e.clientX, y: e.clientY };
                }}
              >
                {/* ── Směnové pásy podle skutečného provozu stroje ─────────── */}
                {days.map((d) => {
                  const hpx = slotHeight * 2; // px na hodinu
                  return (
                    <Fragment key={`dayshade-${d.y}`}>
                      {/* Směnové pásy podle SKUTEČNÉHO provozu daného stroje (resolveDayIntervals):
                          kreslí se jen tam, kde stroj v daném čase reálně tiskne — XL_105 bez noční
                          směny nemá noční pás; noc navazuje přes půlnoc přes `prev-tail` interval,
                          takže na hranici dne ani víkendu nevzniká schod. Ranní směna je v CSS
                          transparentní (= base), proto se kreslí jen odpolední (tmavší) a noční
                          (nejtmavší). Odstávku překryje červený overlay navrch — pás pod ním nevadí. */}
                      {(machineWeekShifts ? resolveDayIntervals(machine, d.dateStr, machineWeekShifts) : [])
                        .filter((iv) => iv.shift !== "MORNING")
                        .map((iv, i) => (
                          <div
                            key={`shift-${d.y}-${i}`}
                            className={iv.shift === "NIGHT" ? "tl-night" : "tl-afternoon"}
                            style={{ position: "absolute", top: d.y + (iv.startMin / 60) * hpx, height: ((iv.endMin - iv.startMin) / 60) * hpx, left: 0, right: 0, pointerEvents: "none" }}
                          />
                        ))}
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
                      {height >= 18 && (
                        <div style={{ position: "absolute", top: 4, left: 8, display: "flex", alignItems: "center", gap: 4, maxWidth: "calc(100% - 16px)" }}>
                          {cd.label && (
                            <div title={cd.label} style={{ height: 14, padding: "0 5px", borderRadius: 3, background: "rgba(153,27,27,0.85)", color: "#fecaca", fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", lineHeight: 1 }}>
                              {cd.label}
                            </div>
                          )}
                          {cd.machine && (
                            <div style={{ height: 14, padding: "0 5px", borderRadius: 3, flexShrink: 0, background: cd.machine === "XL_105" ? "rgba(59,130,246,0.4)" : "rgba(34,197,94,0.4)", color: cd.machine === "XL_105" ? "#93c5fd" : "#86efac", fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", whiteSpace: "nowrap", display: "flex", alignItems: "center", lineHeight: 1 }}>
                              {cd.machine === "XL_105" ? "XL 105" : "XL 106"}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Blokované časy — víkendy + noční XL_105 (červená, read-only) */}
                {blockedOverlays[machine]?.map((n) => (
                  <div
                    key={n.key}
                    style={{ position: "absolute", top: n.top, height: n.height, left: 0, right: 0, backgroundColor: "rgba(220,38,38,0.18)", backgroundImage: "repeating-linear-gradient(-45deg, rgba(185,28,28,0.38) 0px, rgba(185,28,28,0.38) 4px, transparent 4px, transparent 9px)", pointerEvents: "none", boxSizing: "border-box", zIndex: 2 }}
                  />
                ))}

                {/* Shift-edge handles — jen na hranici šrafování (přechod active ↔ blocked) */}
                {canEdit && onShiftBoundsChange && machineWeekShifts && days.map((d) => (
                  <ShiftEdgeHandles
                    key={`shift-handles-${d.dateStr}`}
                    machine={machine}
                    day={d}
                    slotHeight={slotHeight}
                    machineWeekShifts={machineWeekShifts}
                    preview={shiftEdgePreview}
                    dragStateRef={dragStateRef}
                    dragDidMoveRef={dragDidMove}
                    scrollRef={scrollRef}
                    onReset={(m, ownerDate, shift, edge) =>
                      callbacksRef.current.onShiftBoundsChange?.(m, ownerDate, shift, edge, null, false)
                    }
                  />
                ))}

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

                {/* ── Paste target marker ─────────────────────────────────── */}
                {/* Renderuje se jednou na sloupec stroje, před BlockCards (přes zIndex).
                    Skryje se když je schránka prázdná — bez clipboardu marker nemá smysl
                    a slib „Sem (Ctrl+V)" by byl matoucí. */}
                {pasteTarget && clipboardHasContent && pasteTarget.machine === machine && viewStart && (() => {
                  // Snap na pracovní dobu pokud lock zapnutý, aby marker přesně odpovídal
                  // pozici, kam handlePaste/handleGroupPaste blok skutečně vloží.
                  // ZAKAZKA zdroj (single i celá skupina): start-only snap přes tiskové
                  // hodiny (stejná cesta jako handlePasteWithTarget/handleGroupPasteWithTarget
                  // v PlannerPage) — délka bloku se nesnapuje, jen start na runnable slot.
                  // Jinak (ne-ZAKAZKA nebo smíšená skupina): starý duration-based snap přes
                  // pasteSlotDurationMs. Fallback 30 min, pokud duration není k dispozici
                  // (např. když je clipboard prázdný a target je jen z grid clicku).
                  let effectiveTime = pasteTarget.time;
                  if (workingTimeLock && machineWeekShifts) {
                    if (pasteSourceIsZakazka) {
                      const snapped = snapStartToNextRunnableSlot(
                        pasteTarget.machine, pasteTarget.time, machineWeekShifts,
                        companyDayIntervalsFor(pasteTarget.machine, companyDays ?? [])
                      );
                      effectiveTime = snapped ?? pasteTarget.time;
                    } else {
                      const snapDurationMs = pasteSlotDurationMs ?? (30 * 60 * 1000);
                      effectiveTime = snapToNextValidStartWithTemplates(pasteTarget.machine, pasteTarget.time, snapDurationMs, machineWeekShifts);
                    }
                  }
                  const top = dateToY(effectiveTime, viewStart, slotHeight);
                  // Pokud je marker mimo viewport (cíl daleko mimo daysAhead/daysBack), nevykresluj
                  if (top < 0 || top > totalHeight) return null;
                  return (
                    <div
                      style={{
                        position: "absolute",
                        top: top - 1,
                        left: 0,
                        right: 0,
                        height: 0,
                        borderTop: "2px dashed rgba(59,130,246,0.85)",
                        pointerEvents: "none",
                        // Vyšší než drag stav BlockCard (zIndex 20) — marker zůstává viditelný
                        // i během dragu jiného bloku.
                        zIndex: 25,
                      }}
                      data-paste-marker
                    >
                      <div
                        style={{
                          position: "absolute",
                          left: 4,
                          top: -9,
                          padding: "1px 5px",
                          fontSize: 9,
                          fontWeight: 700,
                          color: "#fff",
                          background: "rgba(59,130,246,0.9)",
                          borderRadius: 4,
                          letterSpacing: "0.05em",
                          whiteSpace: "nowrap",
                        }}
                      >
                        ⎘ Sem (Ctrl+V)
                      </div>
                    </div>
                  );
                })()}

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
                  // Σ tiskových minut celé skupiny — pro chip „✂2/5 · 27h" a tooltip (bod 18 auditu)
                  const splitTotalMinutes = splitTotal > 0 ? splitGroupTotalPrintMinutes(splitSiblings) : 0;
                  // Split partner pro TISKAR — najde sourozenecký blok na druhém stroji
                  const splitPartner = isTiskar
                    ? findSplitPartner(block, blocks, assignedMachine ?? "")
                    : null;
                  // Segmenty tiskových hodin (pauza uvnitř bloku) — O(1) lookup z předpočítané mapy.
                  // Pauza overlaye = pixelové offsety relativní k top bloku; contentHeight = výška
                  // prvního print segmentu (layout mod se do ní vejde, nepropadne do pauzy).
                  const segs = blockSegmentsMap.get(block.id);
                  const pauseOverlays = segs
                    ?.filter((seg) => seg.kind === "pause")
                    .map((seg) => {
                      const segTop = dateToY(seg.start, viewStart, slotHeight) - top;
                      const segH   = dateToY(seg.end, viewStart, slotHeight) - dateToY(seg.start, viewStart, slotHeight);
                      return { key: seg.start.toISOString(), top: segTop, height: segH };
                    });
                  const firstPrintSeg = segs?.find((seg) => seg.kind === "print");
                  const contentHeight = firstPrintSeg
                    ? dateToY(firstPrintSeg.end, viewStart, slotHeight) - dateToY(firstPrintSeg.start, viewStart, slotHeight)
                    : undefined;

                  return (
                    <BlockCard
                      key={block.id}
                      block={block}
                      splitPart={splitPart}
                      splitTotal={splitTotal}
                      splitTotalMinutes={splitTotalMinutes}
                      top={top}
                      height={height}
                      pauseOverlays={pauseOverlays}
                      contentHeight={contentHeight}
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
                      canEditDataDate={canEditDataDate}
                      canEditMat={canEditMat}
                      onBlockCopy={() => onBlockCopy?.(block)}
                      onBlockSplit={(splitAt) => handleSplitBlockAt(block, splitAt)}
                      getSplitAt={(clientY) => calcSplitAt(clientY, block)}
                      onInlineDatePick={(blockId, field, currentValue, rect) => {
                        setInlinePicker({ blockId, field, currentValue, x: rect.left, y: rect.bottom });
                      }}
                      onDataChipDoubleClick={onDataChipDoubleClick}
                      badgeColorMap={badgeColorMap}
                      isTiskar={isTiskar}
                      onPrintComplete={onPrintComplete}
                      onNotify={onNotify}
                      onBlockVariantChange={onBlockVariantChange}
                      onExpeditionPublish={onExpeditionPublish}
                      onExpeditionUnpublish={onExpeditionUnpublish}
                      onOpenNotes={onOpenNotes}
                      splitPartner={splitPartner}
                      onSplitChipClick={onSplitChipClick}
                      calendarDrift={driftMap.get(block.id)}
                      shadeParity={shadeParityByBlockId.get(block.id)}
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

                {/* Resize tooltip — koncový čas + délka tisku */}
                {dragPreview && dragPreview.machine === machine && dragPreview.resizeEnd && dragPreview.resizeStart && (() => {
                  const end = dragPreview.resizeEnd!;
                  const start = dragPreview.resizeStart!;
                  const fmtTime = end.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
                  const totalMs = end.getTime() - start.getTime();
                  const totalMin = Math.round(totalMs / 60000);
                  const fmtHm = (min: number) => {
                    const h = Math.floor(min / 60);
                    const m = min % 60;
                    return h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
                  };
                  // Honest resize (ZAKAZKA + lock, expanze uspěla): "X h tisku (Y h celkem)".
                  // Jinak (dnešní chování) jen prostá délka intervalu.
                  const durLabel = dragPreview.resizePrintMinutes != null
                    ? `${fmtHm(dragPreview.resizePrintMinutes)} tisku (${fmtHm(totalMin)} celkem)`
                    : fmtHm(totalMin);
                  // Split skupina: při resize jedné části ukázat živě přepočítaný Σ tiskový
                  // čas CELÉ skupiny = ostatní části (beze změny) + tato část v nové délce.
                  // Pro tuto část bereme honest tiskové minuty (resizePrintMinutes), a když
                  // nejsou (bypass / bez zámku), fallback na délku tažení.
                  const resizedBlock = blocks.find((b) => b.id === dragPreview!.blockId);
                  let groupTotalLabel: string | null = null;
                  if (resizedBlock?.splitGroupId != null) {
                    const siblings = splitGroupMap.get(resizedBlock.splitGroupId) ?? [];
                    if (siblings.length > 1) {
                      const thisPm = dragPreview.resizePrintMinutes ?? totalMin;
                      const othersMin = siblings
                        .filter((b) => b.id !== dragPreview!.blockId)
                        .reduce((sum, b) => sum + blockPrintMinutes(b), 0);
                      groupTotalLabel = `skupina Σ ${fmtHm(othersMin + thisPm)}`;
                    }
                  }
                  return (
                    <div style={{
                      position: "absolute",
                      top: dragPreview.top + Math.max(dragPreview.height, slotHeight) + 4,
                      left: 3,
                      display: "flex", alignItems: "center", gap: 10,
                      background: "rgba(0,0,0,0.85)",
                      backdropFilter: "blur(12px)",
                      WebkitBackdropFilter: "blur(12px)",
                      border: "1px solid rgba(100,180,255,0.4)",
                      borderRadius: 8,
                      padding: "5px 10px",
                      pointerEvents: "none",
                      zIndex: 20,
                      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                      whiteSpace: "nowrap",
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#60a5fa", fontVariantNumeric: "tabular-nums" }}>→ {fmtTime}</span>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>|</span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums" }}>{durLabel}</span>
                      {groupTotalLabel && (
                        <>
                          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>|</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#c4b5fd", fontVariantNumeric: "tabular-nums" }}>✂ {groupTotalLabel}</span>
                        </>
                      )}
                    </div>
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
              </ContextMenuTrigger>
              <ContextMenuContent
                style={{ background: "#1c1c1e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: 4, minWidth: 180, zIndex: 500 }}
                onClick={(e) => e.stopPropagation()}
              >
                {clipboardHasContent ? (
                  <ContextMenuItem
                    onClick={() => {
                      const pos = ctxGridMouseRef.current;
                      const el = scrollRef.current;
                      const vs = viewStartRef.current;
                      if (!pos || !el || !vs || !onPasteHere) return;
                      const rect = el.getBoundingClientRect();
                      const timelineY = pos.y - rect.top + el.scrollTop;
                      const snappedTime = snapToSlot(yToDate(timelineY, vs, slotHeight));
                      onPasteHere(machine, snappedTime);
                    }}
                    style={menuItemStyleEmpty}
                  >
                    ⎘ Vložit zde
                  </ContextMenuItem>
                ) : (
                  <ContextMenuItem disabled style={{ ...menuItemStyleEmpty, color: "rgba(255,255,255,0.4)" }}>
                    Žádný blok není zkopírován
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
              </ContextMenu>
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
                body: JSON.stringify(f === "material" ? { [field]: dateStr, materialInStock: false, materialIssued: false } : { [field]: dateStr }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const updated = await res.json();
              callbacksRef.current.onBlockUpdate(updated, true);
            } catch (err) {
              console.error("Inline date pick failed", err);
              callbacksRef.current.onError?.("Nepodařilo se uložit datum.");
            }
          }}
          sklademActive={inlinePicker.field === "material" && !!blocks.find((b) => b.id === inlinePicker.blockId)?.materialInStock}
          vydanoActive={inlinePicker.field === "material" && !!blocks.find((b) => b.id === inlinePicker.blockId)?.materialIssued}
          onPickSkladem={inlinePicker.field === "material" ? async () => {
            const current = blocks.find((b) => b.id === inlinePicker.blockId);
            const nextValue = !current?.materialInStock;
            setInlinePicker(null);
            try {
              const res = await fetch(`/api/blocks/${inlinePicker.blockId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ materialInStock: nextValue }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const updated = await res.json();
              callbacksRef.current.onBlockUpdate(updated, true);
            } catch (err) {
              console.error("Inline skladem failed", err);
              callbacksRef.current.onError?.("Nepodařilo se uložit.");
            }
          } : undefined}
          onPickVydano={inlinePicker.field === "material" ? async () => {
            const current = blocks.find((b) => b.id === inlinePicker.blockId);
            const nextValue = !current?.materialIssued;
            setInlinePicker(null);
            try {
              const res = await fetch(`/api/blocks/${inlinePicker.blockId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ materialIssued: nextValue }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const updated = await res.json();
              callbacksRef.current.onBlockUpdate(updated, true);
            } catch (err) {
              console.error("Inline vydáno failed", err);
              callbacksRef.current.onError?.("Nepodařilo se uložit.");
            }
          } : undefined}
        />
      )}


    </div>
  );
}
