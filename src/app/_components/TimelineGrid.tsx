"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { snapGroupDeltaWithTemplates, snapToNextValidStartWithTemplates } from "@/lib/workingTime";
import { computePrintMinutes, expandPrintTime, isMachineRunnableAt, snapStartToNextRunnableSlot, SLOT_MS, type CompanyDayInterval } from "@/lib/printTime";
import { blockCalendarDrift, blockPrintMinutes, companyDayIntervalsFor, getBlockSegments, printMidpoint, snapGroupDeltaStartOnly, splitGroupTotalPrintMinutes, type CalendarDriftInfo, type PrintSegment } from "@/lib/printTimeClient";
import { countActionableDriftByMachine } from "@/lib/calendarDriftUi";
import { Z_OVERLAY, Z_TIMELINE } from "@/lib/zLayers";
import { MACHINES } from "@/lib/machines";
import {
  addDaysToCivilDate,
  civilDateDayOfWeek,
  civilDateFromParts,
  civilDateParts,
  daysInCivilMonth,
  diffCivilDateDays,
  normalizeCivilDateInput,
  pragueOf,
  pragueToUTC,
  todayPragueDateStr,
  utcToPragueDateStr,
} from "@/lib/dateUtils";
import { computeShadeParity } from "@/lib/blockShades";
import { fetchWithCascadeConfirm, type CascadeAsk } from "@/lib/cascadeConfirmClient";
import type { BlockSnapshot } from "@/lib/undo/types";
import { blockMatchesQuery } from "@/lib/orderSearch";
import { type BlockVariant } from "@/lib/blockVariants";
import { DAY_SLOT_COUNT } from "@/lib/timeSlots";
import { Lock, Hourglass } from "lucide-react";
import { type MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { resolveScheduleRows, resolveDayIntervals } from "@/lib/scheduleValidation";
import { SHIFT_HOURS } from "@/lib/shifts";
import { ShiftEdgeHandles } from "@/components/planner/ShiftEdgeHandles";
import { findSplitPartner, hasUnconfirmedReservation } from "@/lib/splitHelpers";
import { BlockCard } from "@/components/planner/BlockCard";
import { DEFAULT_FONT_SCALE, plannerTypeScale, type PlannerTypeScale } from "@/lib/plannerTypography";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

// ─── Konstanty ────────────────────────────────────────────────────────────────
const SLOT_HEIGHT = 26;         // px na 30 min (1 hod = 52 px)
// Modulová konstanta, ne volání v default parametru — jinak by se `plannerTypeScale(...)`
// přepočítávalo při KAŽDÉM renderu gridu (stejný vzor jako `tiskarBlockView.ts:10`).
const DEFAULT_TS = plannerTypeScale(DEFAULT_FONT_SCALE);

const DATE_COL_W = 44;          // šířka sloupce s datem (px)
const TIME_COL_W = 72;          // šířka sloupce s časy (px)

/**
 * Barva popisku času na ose — celá hodina `--text`, půlhodina `--text-muted`.
 *
 * Půlhodina brala do 12. 8. 2026 `color-mix(--border 85%)`. `--border` je token
 * pro ČÁRY, ne pro text: ve světlém režimu je to světle šedá a na skoro bílém
 * pozadí osy z popisku nezbylo nic (nahlásil Vojta). V tmavém režimu je
 * `--border` bílá na 10 %, takže tam vada tolik nebila do očí a přežila.
 *
 * Je to táž třída chyby, jakou už projekt jednou opravoval u `--info` — viz
 * poznámka u jeho definice v `globals.css`. Barvu písma odvozuj jen z tokenů,
 * které jsou pro text udržované (`--text`, `--text-muted`).
 *
 * Helper existuje proto, že týž výraz byl zkopírovaný na DVOU osách (hlavní
 * vlevo a mezi strojovými sloupci) — takhle nejde opravit jen jedna z nich.
 * POZOR: vodorovné ČÁRY mřížky níž na `--border` zůstávají, tam ten token patří.
 */
function railLabelColor(isFullHour: boolean): string {
  return isFullHour ? "var(--text)" : "var(--text-muted)";
}
const VIEW_DAYS_BACK = 3;
const VIEW_DAYS_AHEAD = 30;

const WORK_START_H = 6;
const WORK_END_H = 22;
const WORK_START_SLOT = WORK_START_H * 2;
const WORK_END_SLOT = WORK_END_H * 2;
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
  pantoneInStock: boolean;
  pantoneIssued: boolean;
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

/**
 * Data pro krok historie po rozdělení zakázky (task S1, 19. 8. 2026). `before` je
 * snapshot PŘED splitem z odpovědi serveru (`before.shifted` má tvar `ReflowBeforeSnapshot`
 * — ZÁMĚRNĚ totožný s `BlockSnapshot`, viz `reflowBefore.server.ts`). `headLive` je hlava,
 * jak vypadala PŘED splitem v klientském stavu (parametr `block` v `handleSplitBlockAt`).
 * Skládání kroku historie (`buildSplitCommand` + `recordUndo`) žije v `PlannerPage`, ne tady.
 */
export type SplitDoneInfo = {
  head: Block;
  tail: Block;
  shifted: Block[];
  before: {
    head: { id: number; endTime: string; splitGroupId: number | null; printMinutes: number | null; scheduleBypassed: boolean; updatedAt: string };
    shifted: BlockSnapshot[];
  };
  headLive: Block;
};

interface TimelineGridProps {
  blocks: Block[];
  filterText: string;
  selectedBlockId: number | null;
  onBlockClick: (block: Block) => void;
  onBlockUpdate: (updatedBlock: Block, addToHistory?: boolean) => void;
  onBlockCreate: (newBlock: Block) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  queueDragItem?: { id: number | string; durationHours: number; type: string } | null;
  onQueueDrop?: (itemId: number | string, machine: string, startTime: Date) => void;
  onQueueDragCancel?: () => void;
  onBlockDoubleClick?: (block: Block) => void;
  companyDays?: CompanyDay[];
  slotHeight?: number;
  /** Stupeň písma. Nepovinný — bez něj se karta chová jako při výchozím M. */
  typeScale?: PlannerTypeScale;
  daysAhead?: number;
  daysBack?: number;
  copiedBlockId?: number | null;
  onGridClick?: (machine: string, time: Date) => void;
  onGridClickEmpty?: () => void;
  /** Kliknutí KAMKOLIV do mřížky — i na blok, na časovou osu nebo na sloupec s datem.
   *  Odlišné od `onGridClickEmpty`, které reaguje jen na prázdné místo ve sloupci stroje.
   *  Dnes tím plánovač ruší hledání (připomínka 13. 8. 2026: „vynulovat kliknutím
   *  kamkoliv do plánu"). Gesta (laso, přesun, resize, hranice směny) ho nespouštějí
   *  — hlídá `gestureEndedAtRef`. */
  onPlanClick?: () => void;
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
  /**
   * Potvrzení velké kaskády autoposunu (server 409 CASCADE_CONFIRM) — BEZ výchozí
   * hodnoty. Chybějící callback má spadnout na tsc, ne se tiše potvrdit (to je
   * přesně vada, kterou tahle vlna řeší).
   */
  onCascadeConfirm: CascadeAsk;
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
  /**
   * Krok historie po rozdělení zakázky (task S1) — skládá ho a zapisuje `PlannerPage`
   * přes `recordUndo`. BEZ výchozí hodnoty (žádné `?? (() => {})`): chybějící callback
   * má spadnout na `tsc`, ne tiše nezapsat krok (stejná past jako split sám do 19. 8. 2026).
   */
  onSplitDone: (data: SplitDoneInfo) => void;
}



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

// ─── BlockCard + jeho prezentační helpery (BlockDateChip, MiniChip, ProductionChips,
//     MaterialNoteAffordance, fmtDate/fmtDateShort/deadlineState/chipTextColor,
//     FIELD_ACCENT/DEADLINE_BG/DEADLINE_BORDER) žijí v @/components/planner/BlockCard
//     (fáze E2 dekompozice). InlineDatePicker zůstává tady — používá ho hlavní grid.

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
      <div style={{ position: "fixed", inset: 0, zIndex: Z_OVERLAY.backdrop }} onMouseDown={onClose} />
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: "fixed", left, top, zIndex: Z_OVERLAY.floating,
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

// ─── TimelineGrid ──────────────────────────────────────────────────────────────
export default function TimelineGrid({
  blocks, filterText, selectedBlockId,
  onBlockClick, onBlockUpdate, onBlockCreate, scrollRef,
  queueDragItem, onQueueDrop, onQueueDragCancel, onBlockDoubleClick,
  companyDays,
  slotHeight = SLOT_HEIGHT,
  typeScale = DEFAULT_TS,
  daysAhead,
  daysBack,
  copiedBlockId,
  onGridClick,
  onGridClickEmpty,
  onPlanClick,
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
  onCascadeConfirm,
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
  onSplitDone,
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
  const callbacksRef    = useRef({ onBlockUpdate, onBlockCreate, onMultiSelect, onMultiBlockUpdate, onError, onInfo, onCascadeConfirm, onQueueDrop, onQueueDragCancel, onShiftBoundsChange, onSplitDone });
  const queueDragItemRef = useRef(queueDragItem ?? null);
  const lassoRef        = useRef<{ startClientX: number; startClientY: number; active: boolean } | null>(null);
  const lassoRectRef    = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  // Čas, kdy doběhlo gesto, po kterém prohlížeč pošle na sloupec ještě syntetický
  // `click` (mousedown a mouseup mají společného předka = sloupec): dotažení lasa,
  // přetažení bloku, resize bloku i tažení hranice směny. Bez téhle pojistky by
  // takový `click` spustil `onGridClickEmpty` a smazal plánovači napsaný dotaz.
  // Ref, ne state: čte se v témže ticku.
  const gestureEndedAtRef = useRef(0);
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
    callbacksRef.current = { onBlockUpdate, onBlockCreate, onMultiSelect, onMultiBlockUpdate, onError, onInfo, onCascadeConfirm, onQueueDrop, onQueueDragCancel, onShiftBoundsChange, onSplitDone };
  }, [onBlockUpdate, onBlockCreate, onMultiSelect, onMultiBlockUpdate, onError, onInfo, onCascadeConfirm, onQueueDrop, onQueueDragCancel, onShiftBoundsChange, onSplitDone]);

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
        //
        // Odložené zakázky se od 8/2026 NEVYJÍMAJÍ: při zamčeném zámku posílá klient
        // `bypassScheduleValidation: false` a server u skutečné změny pozice bere příznak
        // Z REQUESTU, ne z bloku (`[id]/route.ts`) — takže odloženou zakázku re-expanduje
        // přes pauzy a značku zruší. Náhled s naivní výškou ukazoval něco jiného, než co
        // se po puštění myši stane; nesoulad tu byl už dřív, jen ho nikdo nespojil se značkou.
        let height = originalHeight;
        const sourceBlock = blocksRef.current.find((b) => b.id === ds.blockId);
        if (workingTimeLockRef.current && sourceBlock?.type === "ZAKAZKA") {
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
        // Odložené zakázky se nevyjímají ze stejného důvodu jako u tažení výš: server je
        // při zamčeném zámku re-expanduje, takže naivní náhled by lhal.
        if (workingTimeLockRef.current && sourceBlock?.type === "ZAKAZKA" && snappedEnd.getTime() > ds.originalStart.getTime() && ds.originalStart.getTime() % SLOT_MS === 0) {
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
        if (lassoRef.current.active) gestureEndedAtRef.current = Date.now();
        lassoRef.current = null;
        lassoRectRef.current = null;
        setLassoRect(null);
        return;
      }

      const ds = dragStateRef.current;
      const vs = viewStartRef.current;
      if (!ds || !vs) return;

      const moved = dragDidMove.current;
      // Stejná pojistka jako u lasa (viz komentář u `gestureEndedAtRef`) — pokrývá
      // VŠECHNY větve níž (move/resize/multi-move/shift-edge-resize), protože se
      // nastavuje před rozpadem podle `ds.type`.
      if (moved) gestureEndedAtRef.current = Date.now();
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
          const res     = await fetchWithCascadeConfirm(`/api/blocks/${ds.blockId}`, "PUT", body, callbacksRef.current.onCascadeConfirm);
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
          const res     = await fetchWithCascadeConfirm(
            `/api/blocks/${ds.blockId}`,
            "PUT",
            { endTime: finalEnd >= minEnd ? finalEnd.toISOString() : minEnd.toISOString(), bypassScheduleValidation: !workingTimeLockRef.current, resolveChain: true },
            callbacksRef.current.onCascadeConfirm,
          );
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
    // Klientský pre-guard (rychlá UX zpětná vazba) — serverový endpoint re-validuje autoritativně.
    // Bypass blok byl umístěn PRÁVĚ MIMO runnable kalendář → runnable guard se pro něj neaplikuje.
    if (block.type === "ZAKAZKA" && block.scheduleBypassed !== true) {
      const cdIntervals = companyDayIntervalsFor(block.machine, companyDaysRef.current ?? []);
      if (!isMachineRunnableAt(block.machine, splitAt, machineWeekShiftsRef.current ?? [], cdIntervals)) {
        callbacksRef.current.onError?.("Nelze rozdělit uvnitř pauzy — zvol místo v tiskové části.");
        return;
      }
    }
    // Atomický serverový split (B2): jeden request v jedné transakci vytvoří/převezme SplitGroup,
    // zkrátí hlavu (end přes tiskové hodiny), vytvoří ocas (věrná kopie zakázky) a přeloží
    // navazující bloky. Nahradilo 3-request orchestr s LIFO kompenzací — žádný rozbitý mezistav
    // (selhání = rollback celé transakce). expectedUpdatedAt = optimistic lock proti souběhu.
    // Tělo requestu NENESE `resolveChain` — u splitu není chain push opt-in, server ho
    // u ZAKAZKY dělá bezpodmínečně (`/api/blocks/[id]/split/route.ts`). I tak potřebuje
    // potvrzení velké kaskády stejně jako ostatní cesty, jinak dialog nikdy nedostane
    // šanci se zeptat a rozdělení nad prahem skončí slepě na chybové hlášce.
    try {
      const res = await fetchWithCascadeConfirm(
        `/api/blocks/${block.id}/split`,
        "POST",
        { splitAt: splitAt.toISOString(), expectedUpdatedAt: block.updatedAt },
        callbacksRef.current.onCascadeConfirm,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        callbacksRef.current.onError?.(err.error ?? "Blok se nepodařilo rozdělit.");
        return;
      }
      const { head, tail, shifted, before } = await res.json() as {
        head: Block; tail: Block; shifted?: Block[]; before: SplitDoneInfo["before"];
      };
      // Chain-push posuny (shifted) nese POUZE hlava; ocas se aplikuje samostatně (žádná dvojitá aplikace).
      onBlockUpdate({ ...head, shifted } as Block & { shifted?: Block[] });
      onBlockCreate(tail);
      // Krok historie (Ctrl+Z) — sestavuje a zapisuje PlannerPage (task S1). `block` je
      // hlava, jak vypadala PŘED splitem v klientském stavu (parametr téhle funkce).
      callbacksRef.current.onSplitDone?.({ head, tail, shifted: shifted ?? [], before, headLive: block });
    } catch (error) {
      console.error("Block split failed", error);
      callbacksRef.current.onError?.("Blok se nepodařilo rozdělit.");
    }
  }

  // ── Banner stroje „Přepočítat" — počet driftujících bloků per stroj z driftMap.
  // Jen ADMIN/PLANOVAT (canEdit) vidí chip + tlačítko (akce); badge na kartě už
  // informaci nese pro všechny role. Odložené zakázky se do počítadla nepočítají —
  // proč, a co by se stalo jinak, je u `countActionableDriftByMachine` (má testy).
  const driftCountByMachine = countActionableDriftByMachine(blocks, driftMap);

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
    <div style={{ position: "sticky", top: 0, zIndex: Z_TIMELINE.stickyHeader, display: "flex", flexShrink: 0, backgroundColor: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
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
        <div key={machine} style={{ flex: 1, padding: "8px 12px", color: "var(--text)", display: "flex", alignItems: "center", gap: 8, fontSize: typeScale.machineHead }} className="font-bold">
          <span>{machine.replace("_", "\u00a0")}</span>
          {canEdit && driftCount > 0 && (
            <>
              <span
                title="Počet bloků, jejichž umístění nesedí na aktuální kalendář pracovní doby/odstávek"
                style={{
                  fontSize: typeScale.driftBadge, fontWeight: 700, color: "#1f2937", background: "#f59e0b",
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
                  fontSize: typeScale.driftBadge, fontWeight: 600, color: "#fff",
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

  // ── Předpočet: začátek nejbližšího následujícího bloku na témže stroji ───────
  // Blok se kreslí minimálně 20 px (clampedHeight — kvůli čitelnosti chipů), ale
  // nikdy přes navazující blok. Bez toho krátký blok (30 min < 20 px při odzoomu)
  // vizuálně přeteče do souseda, i když časově jen navazuje. O(n log n) per stroj.
  const nextBlockStartMsById = (() => {
    const map = new Map<number, number>();
    for (const bucket of visibleBlocksByMachine.values()) {
      const sorted = [...bucket].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      for (let i = 0; i < sorted.length; i++) {
        const curStart = new Date(sorted[i].startTime).getTime();
        let nextStart = Infinity;
        for (let j = i + 1; j < sorted.length; j++) {
          const s = new Date(sorted[j].startTime).getTime();
          if (s > curStart) { nextStart = s; break; }
        }
        map.set(sorted[i].id, nextStart);
      }
    }
    return map;
  })();

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
  // Kolik slotů (po 30 min) přeskočit mezi viditelnými štítky.
  // Popisky se ředí podle velikosti SVÉHO písma, ne podle holé výšky slotu.
  // Jinak se osa při vyšším stupni zahustí právě tehdy, když uživatel chtěl
  // větší a přehlednější popisky. Práh 5 px je dnešní minimum na stupni M.
  const minLabelPitch = typeScale.rail + 5;
  const labelStep = slotHeight >= minLabelPitch ? 1
    : slotHeight * 2 >= minLabelPitch ? 2
    : slotHeight * 4 >= minLabelPitch ? 4
    : 8;

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

  // Které sloupce nese „Skladem"/„Vydáno" pro právě otevřený čip inline datepickeru.
  // DATA nemá ani jedno → null → tlačítka se v InlineDatePickeru nevykreslí.
  const inlinePickerFlagFields =
    inlinePicker?.field === "material" ? { inStock: "materialInStock", issued: "materialIssued" } as const
    : inlinePicker?.field === "pantone" ? { inStock: "pantoneInStock", issued: "pantoneIssued" } as const
    : null;
  const inlinePickerBlock = inlinePicker ? blocks.find((b) => b.id === inlinePicker.blockId) : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, cursor: dragPreview ? "grabbing" : "default" }}>
      {header}

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", minHeight: 0, backgroundColor: "var(--timeline-bg)" }}>
        <div
          style={{ height: totalHeight, display: "flex" }}
          // Klik kamkoliv do mřížky ruší hledání. Visí ZÁMĚRNĚ tady, ne na sloupci
          // stroje: plánovač, který si zakázku našel, na ni typicky klikne — a čeká,
          // že se pohled vrátí na všechny zakázky. Klik na blok propagaci nezastavuje,
          // takže sem dobublá; stavové chipy uvnitř bloku ji zastavují samy, což je
          // správně (odklepnutí DATA uprostřed hledání dotaz mazat nemá).
          onClick={(e) => {
            if (e.button !== 0) return;
            // Táž pojistka jako u `onGridClickEmpty`: po dotaženém gestu pošle
            // prohlížeč ještě `click` a ten by dotaz smazal uprostřed úkonu.
            if (Date.now() - gestureEndedAtRef.current > 150) onPlanClick?.();
          }}
        >

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
                  top: 0,
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
                <span style={{ fontSize: typeScale.rail, lineHeight: 1, color: railLabelColor(m.isFullHour), fontWeight: m.isFullHour ? 500 : 400 }}>
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
                        <span style={{ fontSize: typeScale.rail, lineHeight: 1, color: railLabelColor(m.isFullHour), fontWeight: m.isFullHour ? 500 : 400 }}>
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
              {/* Sloupec stroje. Atribut `data-machine-col` je stabilní hák pro hover
                  bublinu v BlockCard (oprava 17. 8. 2026): bublina se zarovnává pravou
                  hranou k TOMUTO sloupci — jen tak nepřepadne do sousedního stroje
                  a zároveň nezakryje levou hranu vlastní karty s chipy D/M/E/P.
                  Pravidlo i jeho odůvodnění žijí v `src/lib/plannerHoverTooltip.ts`.
                  Předchůdce `data-timeline-grid` na obalu mřížky zanikl: rozhodovat
                  se podle STŘEDU mřížky přestalo dávat smysl ve chvíli, kdy strana
                  bubliny přestala být volbou.
                  POZOR: komentář patří SEM, ne dovnitř `ContextMenuTrigger asChild` —
                  ten smí obalovat právě jeden prvek. */}
              <ContextMenu>
              <ContextMenuTrigger asChild>
              <div
                data-machine-col
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
                  // 150 ms stačí na `click`, který přijde hned po `mouseup`,
                  // a je pod prahem, kdy by uživatel stihl kliknout znovu.
                  if (Date.now() - gestureEndedAtRef.current > 150) onGridClickEmpty?.();
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
                        // Vyšší než drag stav BlockCard (Z_TIMELINE.blockDrag) — marker
                        // zůstává viditelný i během dragu jiného bloku.
                        zIndex: Z_TIMELINE.pasteMarker,
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
                  // Strop výšky = začátek dalšího bloku na stroji (blok se nesmí kreslit přes něj).
                  const nextStartMs = nextBlockStartMsById.get(block.id) ?? Infinity;
                  const maxRenderHeight = Number.isFinite(nextStartMs)
                    ? dateToY(new Date(nextStartMs), viewStart, slotHeight) - top
                    : Infinity;
                  // Týž predikát jako hlavičkové hledání a tiskařský OrderSearchSheet
                  // (`blockMatchesQuery` nefiltruje při prázdném dotazu, což je přesně
                  // původní chování `filter === "" || …`). Dokud si tohle místo drželo
                  // vlastní kopii, přidání pátého prohledávaného pole by rozešlo
                  // hledání (blok najde) od ztlumení v plánu (blok zůstane ztlumený).
                  const blockMatchesFilter = blockMatchesQuery(block, filterText);
                  const dimmed   = (!blockMatchesFilter) || !!isThisBlockDragging;
                  const selected = !isThisBlockDragging && block.id === selectedBlockId;
                  // Split skupina — O(1) lookup z předpočítané mapy
                  const splitSiblings = block.splitGroupId != null ? (splitGroupMap.get(block.splitGroupId) ?? []) : [];
                  const splitTotal = splitSiblings.length > 1 ? splitSiblings.length : 0;
                  const splitPart  = splitTotal > 0 ? splitSiblings.findIndex(b => b.id === block.id) + 1 : 0;
                  // Σ tiskových minut celé skupiny — pro chip „✂2/5 · 27h" a tooltip (bod 18 auditu)
                  const splitTotalMinutes = splitTotal > 0 ? splitGroupTotalPrintMinutes(splitSiblings) : 0;
                  // Nepotvrzená rezervace je vlastnost REZERVACE, ne jednotlivého bloku —
                  // ocas splitu nedědí reservationId, takže se musí odvodit ze skupiny.
                  const groupUnconfirmedReservation = hasUnconfirmedReservation(splitSiblings);
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
                      maxRenderHeight={maxRenderHeight}
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
                      groupUnconfirmedReservation={groupUnconfirmedReservation}
                      onSplitChipClick={onSplitChipClick}
                      calendarDrift={driftMap.get(block.id)}
                      shadeParity={shadeParityByBlockId.get(block.id)}
                      typeScale={typeScale}
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
                        pointerEvents: "none", zIndex: Z_TIMELINE.dragGhost,
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
                      zIndex: Z_TIMELINE.dragGhost,
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
                style={{ background: "#1c1c1e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: 4, minWidth: 180, zIndex: Z_OVERLAY.contextMenu }}
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
          zIndex: Z_OVERLAY.floating,
        }} />
      )}

      {/* Inline datepicker pro double-click na DATA/MAT/PANTONE badge */}
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
            // Nastavení termínu vypíná „skladem"/„vydáno" — nemá smysl mít oboje.
            const body: Record<string, unknown> = { [field]: dateStr };
            if (inlinePickerFlagFields) { body[inlinePickerFlagFields.inStock] = false; body[inlinePickerFlagFields.issued] = false; }
            try {
              const res = await fetch(`/api/blocks/${inlinePicker.blockId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const updated = await res.json();
              callbacksRef.current.onBlockUpdate(updated, true);
            } catch (err) {
              console.error("Inline date pick failed", err);
              callbacksRef.current.onError?.("Nepodařilo se uložit datum.");
            }
          }}
          sklademActive={!!inlinePickerFlagFields && !!inlinePickerBlock?.[inlinePickerFlagFields.inStock]}
          vydanoActive={!!inlinePickerFlagFields && !!inlinePickerBlock?.[inlinePickerFlagFields.issued]}
          onPickSkladem={inlinePickerFlagFields ? async () => {
            const current = blocks.find((b) => b.id === inlinePicker.blockId);
            const nextValue = !current?.[inlinePickerFlagFields.inStock];
            setInlinePicker(null);
            try {
              const res = await fetch(`/api/blocks/${inlinePicker.blockId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [inlinePickerFlagFields.inStock]: nextValue }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const updated = await res.json();
              callbacksRef.current.onBlockUpdate(updated, true);
            } catch (err) {
              console.error("Inline skladem failed", err);
              callbacksRef.current.onError?.("Nepodařilo se uložit.");
            }
          } : undefined}
          onPickVydano={inlinePickerFlagFields ? async () => {
            const current = blocks.find((b) => b.id === inlinePicker.blockId);
            const nextValue = !current?.[inlinePickerFlagFields.issued];
            setInlinePicker(null);
            try {
              const res = await fetch(`/api/blocks/${inlinePicker.blockId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [inlinePickerFlagFields.issued]: nextValue }),
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
