"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { snapGroupDelta } from "@/lib/workingTime";

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
  createdAt: string;
  updatedAt: string;
};

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
  onError?: (msg: string) => void;
  workingTimeLock?: boolean;
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
  leftBg: string; textPrimary: string; textSub: string;
}> = {
  ZAKAZKA: {
    gradient:    "linear-gradient(150deg, color-mix(in oklab, #3b82f6 18%, var(--surface)) 0%, color-mix(in oklab, #2563eb 12%, var(--surface)) 100%)",
    border:      "color-mix(in oklab, #3b82f6 45%, var(--border))",
    accentBar:   "#3b82f6",
    leftBg:      "color-mix(in oklab, #3b82f6 14%, transparent)",
    textPrimary: "var(--text)",
    textSub:     "color-mix(in oklab, var(--text) 68%, #3b82f6)",
  },
  REZERVACE: {
    gradient:    "linear-gradient(150deg, color-mix(in oklab, #8b5cf6 18%, var(--surface)) 0%, color-mix(in oklab, #7c3aed 12%, var(--surface)) 100%)",
    border:      "color-mix(in oklab, #8b5cf6 48%, var(--border))",
    accentBar:   "#8b5cf6",
    leftBg:      "color-mix(in oklab, #8b5cf6 14%, transparent)",
    textPrimary: "var(--text)",
    textSub:     "color-mix(in oklab, var(--text) 68%, #8b5cf6)",
  },
  UDRZBA: {
    gradient:    "linear-gradient(150deg, color-mix(in oklab, #22c55e 18%, var(--surface)) 0%, color-mix(in oklab, #16a34a 12%, var(--surface)) 100%)",
    border:      "color-mix(in oklab, #22c55e 44%, var(--border))",
    accentBar:   "#22c55e",
    leftBg:      "color-mix(in oklab, #22c55e 14%, transparent)",
    textPrimary: "var(--text)",
    textSub:     "color-mix(in oklab, var(--text) 68%, #16a34a)",
  },
};
const BLOCK_OVERDUE = {
  gradient:    "linear-gradient(150deg, color-mix(in oklab, var(--surface-2) 86%, var(--text-muted)) 0%, color-mix(in oklab, var(--surface) 92%, color-mix(in oklab, var(--text-muted) 85%, #334155)) 100%)",
  border:      "color-mix(in oklab, var(--text-muted) 38%, var(--border))",
  accentBar:   "var(--text-muted)",
  leftBg:      "color-mix(in oklab, var(--text-muted) 10%, transparent)",
  textPrimary: "var(--text-muted)",
  textSub:     "color-mix(in oklab, var(--text-muted) 80%, color-mix(in oklab, var(--text-muted) 85%, #334155))",
};
const BLOCK_DEFAULT = {
  gradient:    "linear-gradient(150deg, var(--surface-2) 0%, var(--surface) 100%)",
  border:      "var(--border)",
  accentBar:   "color-mix(in oklab, var(--text-muted) 70%, var(--text-muted))",
  leftBg:      "color-mix(in oklab, var(--border) 45%, transparent)",
  textPrimary: "var(--text)",
  textSub:     "var(--text-muted)",
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

function deadlineState(requiredDate: string | null | undefined, ok: boolean, now: Date): "none" | "ok" | "warning" | "danger" {
  if (!requiredDate) return "none";
  if (ok) return "ok";
  const due = new Date(requiredDate);
  if (isNaN(due.getTime())) return "none";
  if (isSameDay(due, now)) return "warning";
  if (startOfDay(now).getTime() > startOfDay(due).getTime()) return "danger";
  return "none";
}

function tint(color: string, percent: number): string {
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`;
}

const FIELD_ACCENT = {
  DATA: "color-mix(in oklab, #0ea5e9 78%, var(--text) 22%)",
  MATERIAL: "color-mix(in oklab, #0ea5e9 78%, var(--text) 22%)",
  EXPEDICE: "color-mix(in oklab, #0ea5e9 78%, var(--text) 22%)",
};



// ─── DateBadge — klikatelná kolonka s datem + toggle OK ───────────────────────
function DateBadge({
  label, dateStr, ok, warn, danger, accent, onToggle,
}: {
  label: string; dateStr: string | null; ok: boolean; warn: boolean; danger: boolean; accent?: string; onToggle: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const empty = !dateStr;
  const fmt = dateStr ? fmtDate(dateStr) : "—";

  const successStrong = "color-mix(in oklab, var(--success) 85%, var(--text) 15%)";
  const warningStrong = "color-mix(in oklab, var(--warning) 78%, var(--text) 22%)";
  const dangerStrong = "color-mix(in oklab, var(--danger) 80%, var(--text) 20%)";
  const neutralAccent = accent ?? "var(--text-muted)";
  const bg          = empty ? "color-mix(in oklab, var(--surface) 96%, transparent)" : ok ? tint(successStrong, 16) : danger ? tint(dangerStrong, 16) : warn ? tint(warningStrong, 18) : tint(neutralAccent, 14);
  const borderColor = empty ? "var(--border)" : ok ? tint(successStrong, 45)  : danger ? tint(dangerStrong, 56)  : warn ? tint(warningStrong, 52)  : tint(neutralAccent, 38);
  const labelColor  = empty ? "var(--text-muted)" : ok ? successStrong : danger ? dangerStrong : warn ? warningStrong : neutralAccent;
  const dateColor   = empty ? "var(--text-muted)" : ok ? successStrong : danger ? dangerStrong : warn ? warningStrong : neutralAccent;

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (empty || loading) return;
    setLoading(true);
    onToggle();
    setLoading(false);
  }

  return (
    <div
      onClick={handleClick}
      style={{
        display: "flex", flexDirection: "column", gap: 2,
        padding: "5px 9px", borderRadius: 5,
        background: bg, border: `1px solid ${borderColor}`,
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
          <span style={{ fontSize: 10, lineHeight: 1, color: ok ? successStrong : danger ? dangerStrong : warn ? warningStrong : "var(--text-muted)" }}>
            {ok ? "✓" : danger ? "‼" : warn ? "!" : "·"}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── MiniChip — malý chip vpravo nahoře v bloku ───────────────────────────────
function MiniChip({ label, accent }: { label: string; accent: string }) {
  return (
    <span style={{
      fontSize: 7, fontWeight: 700, color: accent, lineHeight: 1.5,
      background: tint(accent, 14), border: `1px solid ${tint(accent, 28)}`,
      borderRadius: 3, padding: "1px 4px", whiteSpace: "nowrap",
      overflow: "hidden", textOverflow: "ellipsis", maxWidth: 56,
      display: "block",
    }}>
      {label.length > 10 ? label.slice(0, 10) + "…" : label}
    </span>
  );
}

// ─── BlockCard ─────────────────────────────────────────────────────────────────
function BlockCard({
  block, top, height, dimmed, selected, isDragging, isCopied, multiSelected, now,
  onClick, onDoubleClick, onMouseDown, onResizeMouseDown, onContextMenu, onBlockUpdate,
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
  onClick: () => void;
  onDoubleClick: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onResizeMouseDown?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onBlockUpdate: (b: Block) => void;
}) {
  const [resizeHovered, setResizeHovered] = useState(false);
  const [hovered, setHovered]             = useState(false);

  const isOverdue    = block.type !== "UDRZBA" && new Date(block.endTime) < now;
  const clampedHeight = Math.max(height, 20);

  const dataDeadlineState = deadlineState(block.dataRequiredDate, block.dataOk, now);
  const materialDeadlineState = deadlineState(block.materialRequiredDate, block.materialOk, now);

  const s = isOverdue ? BLOCK_OVERDUE : (BLOCK_STYLES[block.type] ?? BLOCK_DEFAULT);

  const hasNoteRow = (block.dataStatusLabel || block.materialStatusLabel || block.barvyStatusLabel || block.lakStatusLabel || block.specifikace);

  // Výškové mody (vzájemně se vylučují)
  const MODE_FULL    = clampedHeight >= 70;                              // plný layout
  const MODE_COMPACT = !MODE_FULL && clampedHeight >= 44 && block.type !== "UDRZBA";
  const MODE_TINY    = !MODE_FULL && !MODE_COMPACT && clampedHeight >= 24; // micro tečky
  // Výškové prahy pro FULL mode
  const showDates  = MODE_FULL;           // 2. řádek — date badges
  const showSpec   = clampedHeight >= 70;  // 3. řádek — specifikace (od FULL modu)
  const showDesc   = MODE_FULL && clampedHeight >= 44; // popis za číslem zakázky

  const opacity = dimmed ? 0.12 : isDragging ? 0.72 : 1;
  const shadow  = selected
    ? "0 0 0 1.5px #FFE600, 0 4px 16px rgba(0,0,0,0.6)"
    : multiSelected
      ? "0 0 0 2px rgba(59,130,246,0.7), 0 4px 16px rgba(0,0,0,0.5)"
      : hovered && !isDragging
        ? "0 6px 20px rgba(0,0,0,0.55)"
        : "0 2px 8px rgba(0,0,0,0.4)";

  async function toggleField(field: "dataOk" | "materialOk", current: boolean) {
    try {
      const res = await fetch(`/api/blocks/${block.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !current }),
      });
      if (res.ok) onBlockUpdate(await res.json());
    } catch { /* tiché selhání */ }
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
      {/* Barevný akcent nahoře (2px) */}
      <div style={{ height: 2, flexShrink: 0, background: s.accentBar, opacity: isOverdue ? 0.35 : 0.8 }} />


      {/* ── MODE_COMPACT: 2 řádky — [datumy horiz. + chips] / [číslo + popis] ── */}
      {MODE_COMPACT && (() => {
        const successStrong = "color-mix(in oklab, var(--success) 85%, var(--text) 15%)";
        const warningStrong = "color-mix(in oklab, var(--warning) 78%, var(--text) 22%)";
        const dangerStrong = "color-mix(in oklab, var(--danger) 80%, var(--text) 20%)";
        const dClr = dataDeadlineState === "ok" ? successStrong : dataDeadlineState === "danger" ? dangerStrong : dataDeadlineState === "warning" ? warningStrong : FIELD_ACCENT.DATA;
        const mClr = materialDeadlineState === "ok" ? successStrong : materialDeadlineState === "danger" ? dangerStrong : materialDeadlineState === "warning" ? warningStrong : FIELD_ACCENT.MATERIAL;
        const eClr = FIELD_ACCENT.EXPEDICE;
        const dateChip = (clr: string): React.CSSProperties => ({
          fontSize: 10, fontWeight: 600, color: clr,
          background: tint(clr, 14), border: `1px solid ${tint(clr, 36)}`,
          borderRadius: 4, padding: "2px 6px",
          whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1, cursor: "pointer",
        });
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 8px", flex: 1, overflow: "hidden", minHeight: 0 }}>
            {/* Levá část: datumy + separator + číslo + popis */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, overflow: "hidden" }}>
              <span style={dateChip(dClr)} onClick={block.dataRequiredDate ? (e) => { e.stopPropagation(); toggleField("dataOk", block.dataOk); } : undefined}>
                D&nbsp;{block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dataDeadlineState === "ok" ? " ✓" : dataDeadlineState === "danger" ? " ‼" : dataDeadlineState === "warning" ? " !" : ""}` : "—"}
              </span>
              <span style={dateChip(mClr)} onClick={block.materialRequiredDate ? (e) => { e.stopPropagation(); toggleField("materialOk", block.materialOk); } : undefined}>
                M&nbsp;{block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${materialDeadlineState === "ok" ? " ✓" : materialDeadlineState === "danger" ? " ‼" : materialDeadlineState === "warning" ? " !" : ""}` : "—"}
              </span>
              <span style={{ ...dateChip(eClr), cursor: "default" }}>
                E&nbsp;{block.deadlineExpedice ? fmtDateShort(block.deadlineExpedice) : "—"}
              </span>
              <div style={{ width: 1, height: 12, background: "var(--border)", flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: s.textPrimary, whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1 }}>
                {block.orderNumber}{block.locked && <span style={{ marginLeft: 2, fontSize: 9, opacity: 0.6 }}>🔒</span>}
              </span>
              {(block.description || block.specifikace) && (
                <span style={{ display: "flex", alignItems: "baseline", gap: 3, flex: 1, minWidth: 0, overflow: "hidden" }}>
                  {block.description && (
                    <span style={{ fontSize: 9, fontWeight: 400, color: s.textSub, opacity: 0.58, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1, flexShrink: 1 }}>
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
              <div style={{ display: "flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
                {block.dataStatusLabel     && <MiniChip label={block.dataStatusLabel}     accent={s.accentBar} />}
                {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={s.textSub} />}
                {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent="var(--text-muted)" />}
                {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent="var(--text-muted)" />}
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
        const successStrong = "color-mix(in oklab, var(--success) 85%, var(--text) 15%)";
        const warningStrong = "color-mix(in oklab, var(--warning) 78%, var(--text) 22%)";
        const dangerStrong = "color-mix(in oklab, var(--danger) 80%, var(--text) 20%)";
        const dClr = dataDeadlineState === "ok" ? successStrong : dataDeadlineState === "danger" ? dangerStrong : dataDeadlineState === "warning" ? warningStrong : FIELD_ACCENT.DATA;
        const mClr = materialDeadlineState === "ok" ? successStrong : materialDeadlineState === "danger" ? dangerStrong : materialDeadlineState === "warning" ? warningStrong : FIELD_ACCENT.MATERIAL;
        const eClr = FIELD_ACCENT.EXPEDICE;
        const chipStyle = (clr: string): React.CSSProperties => ({
          fontSize: 9, fontWeight: 600, color: clr,
          background: tint(clr, 14), border: `1px solid ${tint(clr, 36)}`,
          borderRadius: 3, padding: "1px 5px",
          whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1,
        });
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 8px", flex: 1, overflow: "hidden", minHeight: 0 }}>
            {/* Levá část: datum chips + číslo + popis */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, overflow: "hidden" }}>
              {block.type !== "UDRZBA" && <>
                <span style={chipStyle(dClr)} onClick={block.dataRequiredDate ? (e) => { e.stopPropagation(); toggleField("dataOk", block.dataOk); } : undefined}>
                  D&nbsp;{block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dataDeadlineState === "ok" ? " ✓" : dataDeadlineState === "danger" ? " ‼" : dataDeadlineState === "warning" ? " !" : ""}` : "—"}
                </span>
                <span style={chipStyle(mClr)} onClick={block.materialRequiredDate ? (e) => { e.stopPropagation(); toggleField("materialOk", block.materialOk); } : undefined}>
                  M&nbsp;{block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${materialDeadlineState === "ok" ? " ✓" : materialDeadlineState === "danger" ? " ‼" : materialDeadlineState === "warning" ? " !" : ""}` : "—"}
                </span>
                <span style={{ ...chipStyle(eClr), cursor: "default" }}>
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
                    <span style={{ fontSize: 9, fontWeight: 400, color: s.textSub, opacity: 0.58, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1, flexShrink: 1 }}>
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
              <div style={{ display: "flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
                {block.dataStatusLabel     && <MiniChip label={block.dataStatusLabel}     accent={s.accentBar} />}
                {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={s.textSub} />}
                {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent="var(--text-muted)" />}
                {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent="var(--text-muted)" />}
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
          padding: "5px 9px 3px", display: "flex", alignItems: "center",
          gap: 4, minWidth: 0, flexShrink: 0,
        }}>
          {/* Levá část: číslo + popis */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flex: 1, minWidth: 0, overflow: "hidden" }}>
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
                fontSize: 10, fontWeight: 400, color: s.textSub, opacity: 0.62, lineHeight: 1.2,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
              }}>
                {block.description}
              </span>
            )}
          </div>
          {/* Pravá část: status chips + série */}
          {(hasNoteRow || block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
            <div style={{ display: "flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
              {block.dataStatusLabel     && <MiniChip label={block.dataStatusLabel}     accent={s.accentBar} />}
              {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={s.textSub} />}
              {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent="var(--text-muted)" />}
              {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent="var(--text-muted)" />}
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
            ok={dataDeadlineState === "ok"} warn={dataDeadlineState === "warning"} danger={dataDeadlineState === "danger"}
            accent={FIELD_ACCENT.DATA}
            onToggle={() => toggleField("dataOk", block.dataOk)}
          />
          <DateBadge
            label="MAT." dateStr={block.materialRequiredDate}
            ok={materialDeadlineState === "ok"} warn={materialDeadlineState === "warning"} danger={materialDeadlineState === "danger"}
            accent={FIELD_ACCENT.MATERIAL}
            onToggle={() => toggleField("materialOk", block.materialOk)}
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
  onError,
  workingTimeLock = true,
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
      const deltaX = e.clientX - ds.startClientX;
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
        const newStart    = snapToSlot(yToDate(originalTop + deltaY, vs, sh));
        const duration    = ds.originalEnd.getTime() - ds.originalStart.getTime();
        const newEnd      = new Date(newStart.getTime() + duration);
        const newMachine  = clientXToMachine(e.clientX);
        try {
          const res     = await fetch(`/api/blocks/${ds.blockId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startTime: newStart.toISOString(), endTime: newEnd.toISOString(), machine: newMachine }) });
          const updated: Block = await res.json();
          callbacksRef.current.onBlockUpdate(updated, true);
        } catch { callbacksRef.current.onError?.("Blok se nepodařilo přesunout."); }
      } else if (ds.type === "resize") {
        const originalTop    = dateToY(ds.originalStart, vs, sh);
        const originalHeight = dateToY(ds.originalEnd, vs, sh) - originalTop;
        const newHeightRaw   = Math.max(sh, originalHeight + deltaY);
        const finalEnd       = snapToSlot(yToDate(originalTop + newHeightRaw, vs, sh));
        const minEnd         = new Date(ds.originalStart.getTime() + SLOT_MS);
        try {
          const res     = await fetch(`/api/blocks/${ds.blockId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endTime: finalEnd >= minEnd ? finalEnd.toISOString() : minEnd.toISOString() }) });
          const updated: Block = await res.json();
          callbacksRef.current.onBlockUpdate(updated, true);
        } catch { callbacksRef.current.onError?.("Blok se nepodařilo změnit."); }
      } else if (ds.type === "multi-move") {
        let deltaMs = Math.round((deltaY / sh) * 30 * 60 * 1000 / SLOT_MS) * SLOT_MS;
        if (workingTimeLockRef.current) {
          const { deltaMs: snapped, wasSnapped } = snapGroupDelta(ds.blocks, deltaMs);
          deltaMs = snapped;
          if (wasSnapped) callbacksRef.current.onError?.("Bloky přeskočeny přes víkend/noc");
        }
        const newMachine = clientXToMachine(e.clientX);
        const updates    = ds.blocks.map(b => ({
          id:        b.id,
          machine:   newMachine,
          startTime: new Date(b.originalStart.getTime() + deltaMs),
          endTime:   new Date(b.originalEnd.getTime()   + deltaMs),
        }));
        callbacksRef.current.onMultiBlockUpdate?.(updates);
      }
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
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
    } catch { /* chyba při dělení */ }
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
        idx > 0 ? <div key={`hgap-${idx}`} style={{ width: MACHINE_GAP_W, flexShrink: 0, borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)", backgroundColor: "var(--surface-2)" }} /> : null,
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

  const blockedOverlays: Record<string, { top: number; height: number; key: string }[]> = { XL_105: [], XL_106: [] };

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
    // XL_105: Sat+Sun = full day, all other days = two night strips (00-06, 22-24)
    if (dow === 6 || dow === 0) {
      blockedOverlays.XL_105.push({ top: dayY, height: dayHeight, key: `b105-we-${di}` });
    } else {
      blockedOverlays.XL_105.push({ top: dayY, height: WORK_START_H * 2 * slotHeight, key: `b105-ns-${di}` });
      blockedOverlays.XL_105.push({ top: dayY + WORK_END_H * 2 * slotHeight, height: (24 - WORK_END_H) * 2 * slotHeight, key: `b105-ne-${di}` });
    }
    // XL_106: Fri night (22-24), Sat = full day, Sun = 00-22:00; Mon-Thu = nothing
    if (dow === 6) {
      blockedOverlays.XL_106.push({ top: dayY, height: dayHeight, key: `b106-sat-${di}` });
    } else if (dow === 0) {
      blockedOverlays.XL_106.push({ top: dayY, height: WORK_END_H * 2 * slotHeight, key: `b106-sun-${di}` });
    } else if (dow === 5) {
      blockedOverlays.XL_106.push({ top: dayY + WORK_END_H * 2 * slotHeight, height: (24 - WORK_END_H) * 2 * slotHeight, key: `b106-fri-${di}` });
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
            {/* Firemní den overlay */}
            {days.map((d) =>
              d.isCompanyDay ? (
                <div key={`ct-${d.y}`} style={{ position: "absolute", top: d.y, height: dayHeight, left: 0, right: 0, backgroundColor: "rgba(220,38,38,0.22)", backgroundImage: "repeating-linear-gradient(-45deg, rgba(185,28,28,0.45) 0px, rgba(185,28,28,0.45) 4px, transparent 4px, transparent 9px)", pointerEvents: "none" }} />
              ) : null
            )}
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
                    style={{ width: MACHINE_GAP_W, flexShrink: 0, borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)", backgroundColor: "var(--surface-2)", userSelect: "none", cursor: "crosshair" }}
                    onMouseDown={canEdit ? (e) => {
                      if (e.button !== 0) return;
                      if (dragStateRef.current) return;
                      lassoRef.current = { startClientX: e.clientX, startClientY: e.clientY, active: false };
                      e.preventDefault();
                    } : undefined}
                  />
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

                {/* Firemní den overlay (červená — plánovaná odstávka) */}
                {days.map((d) =>
                  d.isCompanyDay ? (
                    <div key={`c-${d.y}`} style={{ position: "absolute", top: d.y, height: dayHeight, left: 0, right: 0, backgroundColor: "rgba(220,38,38,0.22)", backgroundImage: "repeating-linear-gradient(-45deg, rgba(185,28,28,0.45) 0px, rgba(185,28,28,0.45) 4px, transparent 4px, transparent 9px)", pointerEvents: "none" }} />
                  ) : null
                )}

                {/* Blokované časy — víkendy + noční XL_105 (červená) */}
                {blockedOverlays[machine]?.map((n) => (
                  <div key={n.key} style={{ position: "absolute", top: n.top, height: n.height, left: 0, right: 0, backgroundColor: "rgba(220,38,38,0.18)", backgroundImage: "repeating-linear-gradient(-45deg, rgba(185,28,28,0.38) 0px, rgba(185,28,28,0.38) 4px, transparent 4px, transparent 9px)", pointerEvents: "none" }} />
                ))}

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
                  const dimmed   = (filter !== "" && !block.orderNumber.toLowerCase().includes(filter)) || !!isThisBlockDragging;
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
                    />
                  );
                })}

                {/* Landing zóny ostatních bloků při multi-move (odvozeno z dragPreview + selectedBlockIds) */}
                {isMultiDrag && dragPreview!.machine === machine && blocks
                  .filter(b => selectedBlockIds!.has(b.id) && b.id !== dragPreview!.blockId)
                  .map(b => {
                    const colorMap: Record<string, string> = { ZAKAZKA: "#1a6bcc", REZERVACE: "#7c3aed", UDRZBA: "#16a34a" };
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
                  const colorMap: Record<string, string> = { ZAKAZKA: "#1a6bcc", REZERVACE: "#7c3aed", UDRZBA: "#16a34a" };
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
