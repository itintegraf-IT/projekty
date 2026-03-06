"use client";

import { useEffect, useRef, useState } from "react";

// ─── Konstanty ────────────────────────────────────────────────────────────────
const SLOT_HEIGHT = 26;         // px na 30 min (1 hod = 52 px)
const DATE_COL_W = 44;          // šířka sloupce s datem (px)
const HEADER_HEIGHT = 33;       // výška sticky headeru (px) — pro sticky label uvnitř dne
const TIME_COL_W = 72;          // šířka sloupce s časy (px)
const VIEW_DAYS_BACK = 3;
const VIEW_DAYS_AHEAD = 30;
const TOTAL_DAYS = VIEW_DAYS_BACK + VIEW_DAYS_AHEAD + 1;
const TOTAL_SLOTS = TOTAL_DAYS * 48;
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
  onBlockUpdate: (updatedBlock: Block) => void;
  onBlockCreate: (newBlock: Block) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  queueDragItem?: { id: number; durationHours: number; type: string } | null;
  onQueueDrop?: (itemId: number, machine: string, startTime: Date) => void;
  onBlockDoubleClick?: (block: Block) => void;
  companyDays?: CompanyDay[];
  slotHeight?: number;
  copiedBlockId?: number | null;
  onGridClick?: (machine: string, time: Date) => void;
  onBlockCopy?: (block: Block) => void;
  selectedBlockIds?: Set<number>;
  onMultiSelect?: (ids: Set<number>) => void;
  onMultiBlockUpdate?: (updates: { id: number; startTime: Date; endTime: Date; machine: string }[]) => void;
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

// XL_105: 2 směny (6–14, 14–22), noční neprovozuje → noční overlay ZAP
// XL_106: 3 směny = 24h provoz → noční overlay VYP, žádné tintování
const MACHINES_WITH_NIGHT_OFF = new Set(["XL_105"]);

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
    gradient:    "linear-gradient(150deg, #0f2744 0%, #081729 100%)",
    border:      "rgba(37,99,235,0.55)",
    accentBar:   "#3b82f6",
    leftBg:      "rgba(37,99,235,0.14)",
    textPrimary: "#dbeafe",
    textSub:     "#93c5fd",
  },
  REZERVACE: {
    gradient:    "linear-gradient(150deg, #1e0a40 0%, #0d0522 100%)",
    border:      "rgba(124,58,237,0.55)",
    accentBar:   "#8b5cf6",
    leftBg:      "rgba(124,58,237,0.14)",
    textPrimary: "#ede9fe",
    textSub:     "#c4b5fd",
  },
  UDRZBA: {
    gradient:    "linear-gradient(150deg, #3b0808 0%, #1b0404 100%)",
    border:      "rgba(220,38,38,0.55)",
    accentBar:   "#ef4444",
    leftBg:      "rgba(220,38,38,0.14)",
    textPrimary: "#fee2e2",
    textSub:     "#fca5a5",
  },
};
const BLOCK_OVERDUE = {
  gradient:    "linear-gradient(150deg, #18191f 0%, #0d0f14 100%)",
  border:      "rgba(71,85,105,0.35)",
  accentBar:   "#334155",
  leftBg:      "rgba(71,85,105,0.08)",
  textPrimary: "#475569",
  textSub:     "#334155",
};
const BLOCK_DEFAULT = {
  gradient:    "linear-gradient(150deg, #1e2433 0%, #111720 100%)",
  border:      "rgba(71,85,105,0.4)",
  accentBar:   "#64748b",
  leftBg:      "rgba(71,85,105,0.12)",
  textPrimary: "#94a3b8",
  textSub:     "#64748b",
};

// ─── Pomocná funkce — bezpečný parse data z DB (ISO timestamp i date string) ──
function fmtDate(s: string | null | undefined): string {
  if (!s) return "–";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// ─── DateBadge — klikatelná kolonka s datem + toggle OK ───────────────────────
function DateBadge({
  label, dateStr, ok, warn, onToggle,
}: {
  label: string; dateStr: string; ok: boolean; warn: boolean; onToggle: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const fmt = fmtDate(dateStr);

  const bg          = ok ? "rgba(74,222,128,0.12)" : warn ? "rgba(251,191,36,0.12)" : "rgba(255,255,255,0.05)";
  const borderColor = ok ? "rgba(74,222,128,0.35)"  : warn ? "rgba(251,191,36,0.35)"  : "rgba(255,255,255,0.08)";
  const labelColor  = ok ? "#4ade80" : warn ? "#fbbf24" : "#64748b";
  const dateColor   = ok ? "#4ade80" : warn ? "#fbbf24" : "#94a3b8";

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    onToggle();
    setLoading(false);
  }

  return (
    <div
      onClick={handleClick}
      style={{
        display: "flex", flexDirection: "column", gap: 2,
        padding: "4px 7px", borderRadius: 5,
        background: bg, border: `1px solid ${borderColor}`,
        cursor: "pointer", flex: "1 1 0", minWidth: 0,
        transition: "all 0.12s", opacity: loading ? 0.6 : 1,
      }}
    >
      <span style={{ fontSize: 8, fontWeight: 700, color: labelColor, lineHeight: 1, letterSpacing: "0.06em" }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: dateColor, lineHeight: 1 }}>{fmt}</span>
        <span style={{ fontSize: 10, lineHeight: 1, color: ok ? "#4ade80" : warn ? "#fbbf24" : "#334155" }}>
          {ok ? "✓" : warn ? "!" : "·"}
        </span>
      </div>
    </div>
  );
}

// ─── StatusNote — poznámka ze selectu ─────────────────────────────────────────
function StatusNote({ label, accent }: { label: string; accent: string }) {
  return (
    <span style={{
      fontSize: 8.5, fontWeight: 600, color: accent, lineHeight: 1,
      background: `${accent}18`, border: `1px solid ${accent}30`,
      borderRadius: 4, padding: "2px 6px", whiteSpace: "nowrap",
      overflow: "hidden", textOverflow: "ellipsis", maxWidth: 110,
      display: "inline-block",
    }}>
      {label.length > 14 ? label.slice(0, 14) + "…" : label}
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
  onMouseDown: (e: React.MouseEvent) => void;
  onResizeMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onBlockUpdate: (b: Block) => void;
}) {
  const [resizeHovered, setResizeHovered] = useState(false);
  const [hovered, setHovered]             = useState(false);

  const isOverdue    = block.type !== "UDRZBA" && new Date(block.endTime) < now;
  const clampedHeight = Math.max(height, 20);

  const dataNotReady     = !!block.dataRequiredDate && !block.dataOk && now > new Date(block.dataRequiredDate);
  const materialNotReady = !!block.materialRequiredDate && !block.materialOk && now > new Date(block.materialRequiredDate);

  const s = isOverdue ? BLOCK_OVERDUE : (BLOCK_STYLES[block.type] ?? BLOCK_DEFAULT);

  // Výškové prahy
  const showDates  = clampedHeight >= 62;   // 2. řádek — date badges
  const showNotes  = clampedHeight >= 100;  // 3. řádek — status labels
  const showSpec   = clampedHeight >= 80;   // specifikace (vlastní řádek)
  const showDesc   = clampedHeight >= 40;   // popis za číslem zakázky

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

  const hasDateRow = (block.dataRequiredDate || block.materialRequiredDate || block.deadlineExpedice);
  const hasNoteRow = (block.dataStatusLabel || block.materialStatusLabel || block.barvyStatusLabel || block.lakStatusLabel || block.specifikace);

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
      }}
    >
      {/* Barevný akcent nahoře (2px) */}
      <div style={{ height: 2, flexShrink: 0, background: s.accentBar, opacity: isOverdue ? 0.35 : 0.8 }} />

      {/* ── Řádek 1: Číslo zakázky + popis ── */}
      <div style={{
        padding: "5px 9px 3px", display: "flex", alignItems: "baseline",
        gap: 6, minWidth: 0, flexShrink: 0,
      }}>
        <span style={{
          fontSize: 12, fontWeight: 700, color: s.textPrimary,
          lineHeight: 1.2, flexShrink: 0, maxWidth: "50%",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {block.orderNumber}
          {block.locked && <span style={{ marginLeft: 3, fontSize: 9, opacity: 0.6 }}>🔒</span>}
        </span>
        {showDesc && block.description && (
          <span style={{
            fontSize: 10, color: s.textSub, opacity: 0.8, lineHeight: 1.2,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
          }}>
            {block.description}
          </span>
        )}
      </div>

      {/* ── Řádek 2: Klikatelné date badges ── */}
      {showDates && hasDateRow && (
        <div style={{
          padding: "2px 7px 3px", display: "flex", gap: 5, flexWrap: "nowrap",
          flexShrink: 0,
        }}>
          {block.dataRequiredDate && (
            <DateBadge
              label="DATA" dateStr={block.dataRequiredDate}
              ok={block.dataOk} warn={dataNotReady}
              onToggle={() => toggleField("dataOk", block.dataOk)}
            />
          )}
          {block.materialRequiredDate && (
            <DateBadge
              label="MAT." dateStr={block.materialRequiredDate}
              ok={block.materialOk} warn={materialNotReady}
              onToggle={() => toggleField("materialOk", block.materialOk)}
            />
          )}
          {block.deadlineExpedice && (
            <div style={{
              display: "flex", flexDirection: "column", gap: 2,
              padding: "4px 7px", borderRadius: 5,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
              flex: "1 1 0", minWidth: 0,
            }}>
              <span style={{ fontSize: 8, fontWeight: 700, color: "#64748b", lineHeight: 1, letterSpacing: "0.06em" }}>EXP.</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", lineHeight: 1 }}>
                {fmtDate(block.deadlineExpedice)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Řádek 3: Specifikace (celý text) ── */}
      {showSpec && block.specifikace && (
        <div style={{ padding: "0 9px 3px", flexShrink: 0 }}>
          <span style={{
            fontSize: 9, color: "#94a3b8", lineHeight: 1.3,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}>
            {block.specifikace}
          </span>
        </div>
      )}

      {/* ── Řádek 4: Poznámky ze selectů ── */}
      {showNotes && hasNoteRow && (
        <div style={{
          padding: "1px 7px 4px", display: "flex", gap: 4, flexWrap: "wrap",
          flexShrink: 0, overflow: "hidden",
        }}>
          {block.dataStatusLabel    && <StatusNote label={block.dataStatusLabel}     accent={s.accentBar} />}
          {block.materialStatusLabel && <StatusNote label={block.materialStatusLabel} accent={s.textSub} />}
          {block.barvyStatusLabel    && <StatusNote label={block.barvyStatusLabel}    accent="#94a3b8" />}
          {block.lakStatusLabel      && <StatusNote label={block.lakStatusLabel}      accent="#94a3b8" />}
        </div>
      )}

      {/* Resize handle */}
      {!block.locked && (
        <div
          onMouseEnter={() => setResizeHovered(true)}
          onMouseLeave={() => setResizeHovered(false)}
          onMouseDown={(e) => { e.stopPropagation(); onResizeMouseDown(e); }}
          style={{
            position: "absolute", bottom: 0, left: 0, right: 0, height: 8,
            cursor: "ns-resize", display: "flex", alignItems: "flex-end", justifyContent: "center",
          }}
        >
          <div style={{
            width: "100%", height: 2,
            background: resizeHovered ? "rgba(96,165,250,0.7)" : "transparent",
            transition: "background 0.15s",
          }} />
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
  copiedBlockId,
  onGridClick,
  onBlockCopy,
  selectedBlockIds,
  onMultiSelect,
  onMultiBlockUpdate,
}: TimelineGridProps) {
  const dayHeight   = slotHeight * 48;
  const totalHeight = TOTAL_DAYS * dayHeight;

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
  const callbacksRef    = useRef({ onBlockUpdate, onBlockCreate, onMultiSelect, onMultiBlockUpdate });
  const lassoRef        = useRef<{ startClientX: number; startClientY: number; active: boolean } | null>(null);
  const lassoRectRef    = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const blocksRef       = useRef(blocks);
  const selectedBlockIdsRef = useRef(selectedBlockIds ?? new Set<number>());

  useEffect(() => { slotHeightRef.current = slotHeight; }, [slotHeight]);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  useEffect(() => { selectedBlockIdsRef.current = selectedBlockIds ?? new Set<number>(); }, [selectedBlockIds]);

  useEffect(() => {
    callbacksRef.current = { onBlockUpdate, onBlockCreate, onMultiSelect, onMultiBlockUpdate };
  }, [onBlockUpdate, onBlockCreate, onMultiSelect, onMultiBlockUpdate]);

  useEffect(() => {
    const start = startOfDay(addDays(new Date(), -VIEW_DAYS_BACK));
    setViewStart(start);
    viewStartRef.current = start;
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Scroll na aktuální čas po mountu
  useEffect(() => {
    if (!viewStart || !scrollRef.current) return;
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
          callbacksRef.current.onBlockUpdate(updated);
        } catch { /* blok zůstane nezměněn */ }
      } else if (ds.type === "resize") {
        const originalTop    = dateToY(ds.originalStart, vs, sh);
        const originalHeight = dateToY(ds.originalEnd, vs, sh) - originalTop;
        const newHeightRaw   = Math.max(sh, originalHeight + deltaY);
        const finalEnd       = snapToSlot(yToDate(originalTop + newHeightRaw, vs, sh));
        const minEnd         = new Date(ds.originalStart.getTime() + SLOT_MS);
        try {
          const res     = await fetch(`/api/blocks/${ds.blockId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endTime: finalEnd >= minEnd ? finalEnd.toISOString() : minEnd.toISOString() }) });
          const updated: Block = await res.json();
          callbacksRef.current.onBlockUpdate(updated);
        } catch { /* blok zůstane nezměněn */ }
      } else if (ds.type === "multi-move") {
        const deltaMs    = Math.round((deltaY / sh) * 30 * 60 * 1000 / SLOT_MS) * SLOT_MS;
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
      const selBlocks = blocksRef.current.filter(b => ids.has(b.id));
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
    <div style={{ position: "sticky", top: 0, zIndex: 30, display: "flex", flexShrink: 0, backgroundColor: "rgb(15 23 42)", borderBottom: "1px solid rgb(51 65 85)" }}>
      {/* datum placeholder */}
      <div style={{ width: DATE_COL_W, flexShrink: 0, borderRight: "1px solid rgb(30 41 59)" }} />
      {/* čas placeholder */}
      <div style={{ width: TIME_COL_W, flexShrink: 0, borderRight: "1px solid rgb(30 41 59)", display: "flex", alignItems: "center", padding: "0 8px" }}>
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: "rgb(71 85 105)", textTransform: "uppercase" }}>ČAS</span>
      </div>
      {MACHINES.map((machine, idx) => (
        <div
          key={machine}
          style={{ flex: 1, padding: "8px 12px", borderRight: idx === 0 ? "1px solid rgb(30 41 59)" : undefined }}
          className="text-xs font-bold text-slate-200"
        >
          {machine.replace("_", "\u00a0")}
        </div>
      ))}
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
    for (let i = 0; i < TOTAL_DAYS; i++) years.add(addDays(viewStart, i).getFullYear());
    const s = new Set<string>();
    years.forEach((y) => czechHolidaySet(y).forEach((d) => s.add(d)));
    return s;
  })();

  type HalfHourMark = { y: number; label: string; isFullHour: boolean; isLabel: boolean };
  const halfHourMarkers: HalfHourMark[] = [];
  // Kolik slotů (po 30 min) přeskočit mezi viditelnými štítky
  const labelStep = slotHeight >= 14 ? 1 : slotHeight >= 7 ? 2 : slotHeight >= 4 ? 4 : 8;

  const nightOverlays: { top: number; height: number; key: string }[] = [];

  for (let di = 0; di < TOTAL_DAYS; di++) {
    const day      = addDays(viewStart, di);
    const dayY     = di * dayHeight;
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
    const isToday  = isSameDay(day, todayDate);
    const dateStr  = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const isHoliday = holidays.has(dateStr);
    const companyDayMatch = companyDays?.find((cd) => dateStr >= cd.startDate.slice(0, 10) && dateStr <= cd.endDate.slice(0, 10));
    days.push({ date: day, y: dayY, isWeekend, isToday, isHoliday, isCompanyDay: !!companyDayMatch, companyDayLabel: companyDayMatch?.label });
    nightOverlays.push({ top: dayY,                                height: WORK_START_H * 2 * slotHeight, key: `ns-${di}` });
    nightOverlays.push({ top: dayY + WORK_END_H * 2 * slotHeight, height: (24 - WORK_END_H) * 2 * slotHeight, key: `ne-${di}` });
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

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        <div style={{ height: totalHeight, display: "flex" }}>

          {/* ── Datum sloupec ─────────────────────────────────────────────── */}
          <div style={{ width: DATE_COL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 10, borderRight: "1px solid rgb(30 41 59)", backgroundColor: "rgb(7 11 22)" }}>
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
                  <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.05em", lineHeight: 1, color: d.isToday ? "#7dd3fc" : d.isHoliday ? "#fca5a5" : d.isCompanyDay ? "#c4b5fd" : d.isWeekend ? "#fb923c" : "#94a3b8" }}>
                    {DAY_ABBR[d.date.getDay()]}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, lineHeight: 1, color: d.isToday ? "#38bdf8" : d.isHoliday ? "#f87171" : d.isCompanyDay ? "#a78bfa" : d.isWeekend ? "#f97316" : "#e2e8f0" }}>
                    {d.date.getDate()}
                  </span>
                  <span style={{ fontSize: 8, fontWeight: 600, lineHeight: 1, color: d.isToday ? "#7dd3fc" : d.isHoliday ? "#fca5a5" : d.isCompanyDay ? "#c4b5fd" : d.isWeekend ? "#fb923c" : "#64748b" }}>
                    {MONTH_ABBR[d.date.getMonth()]}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* ── Čas sloupec ───────────────────────────────────────────────── */}
          <div style={{ width: TIME_COL_W, flexShrink: 0, position: "relative", zIndex: 9, borderRight: "1px solid rgb(30 41 59)", backgroundColor: "rgb(7 11 22)" }}>
            {/* Firemní den overlay */}
            {days.map((d) =>
              d.isCompanyDay ? (
                <div key={`ct-${d.y}`} style={{ position: "absolute", top: d.y, height: dayHeight, left: 0, right: 0, backgroundColor: "rgba(139,92,246,0.18)", pointerEvents: "none" }} />
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
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 8,
                }}
              >
                <span style={{ fontSize: 9, lineHeight: 1, color: m.isFullHour ? "rgb(100 116 139)" : "rgb(51 65 85)", fontWeight: m.isFullHour ? 500 : 400 }}>
                  {m.label}
                </span>
              </div>
            ))}
          </div>

          {/* ── Strojové sloupce ──────────────────────────────────────────── */}
          {MACHINES.map((machine, colIdx) => {
            const machineBlocks = blocks.filter((b) => b.machine === machine);

            return (
              <div
                key={machine}
                ref={(el) => { colRefs.current[colIdx] = el; }}
                style={{ flex: 1, position: "relative", overflow: "hidden", minWidth: 0, borderRight: colIdx === 0 ? "1px solid rgb(30 41 59)" : undefined }}
                onDragOver={(e) => {
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
                }}
                onDragLeave={(e) => {
                  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                    setQueueDropPreview(null);
                  }
                }}
                onDrop={(e) => {
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
                }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  if ((e.target as HTMLElement).closest("[data-block]")) return;
                  if (dragStateRef.current) return;
                  lassoRef.current = { startClientX: e.clientX, startClientY: e.clientY, active: false };
                  e.preventDefault();
                }}
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

                {/* Víkendové pozadí */}
                {days.map((d) =>
                  d.isWeekend && !d.isToday ? (
                    <div key={d.y} style={{ position: "absolute", top: d.y, height: dayHeight, left: 0, right: 0, backgroundColor: "rgba(20,16,12,0.35)", pointerEvents: "none" }} />
                  ) : null
                )}

                {/* Svátek overlay */}
                {days.map((d) =>
                  d.isHoliday && !d.isToday ? (
                    <div key={`h-${d.y}`} style={{ position: "absolute", top: d.y, height: dayHeight, left: 0, right: 0, backgroundColor: "rgba(239,68,68,0.06)", pointerEvents: "none" }} />
                  ) : null
                )}

                {/* Firemní den overlay */}
                {days.map((d) =>
                  d.isCompanyDay ? (
                    <div key={`c-${d.y}`} style={{ position: "absolute", top: d.y, height: dayHeight, left: 0, right: 0, backgroundColor: "rgba(139,92,246,0.18)", pointerEvents: "none" }} />
                  ) : null
                )}

                {/* Noční overlay — jen pro stroje bez nočního provozu */}
                {MACHINES_WITH_NIGHT_OFF.has(machine) && nightOverlays.map((n) => (
                  <div key={n.key} style={{ position: "absolute", top: n.top, height: n.height, left: 0, right: 0, backgroundColor: "rgba(2,6,23,0.4)", pointerEvents: "none" }} />
                ))}

                {/* Denní oddělovače */}
                {days.map((d) => (
                  <div key={d.y} style={{ position: "absolute", top: d.y, left: 0, right: 0, height: 1, backgroundColor: "rgba(51,65,85,0.7)" }} />
                ))}

                {/* Hodinové čáry */}
                {halfHourMarkers.filter((m) => m.isLabel && m.isFullHour).map((m) => (
                  <div key={m.y} style={{ position: "absolute", top: m.y, left: 0, right: 0, height: 1, backgroundColor: "rgba(30,41,59,0.7)" }} />
                ))}

                {/* Půlhodinové čáry */}
                {halfHourMarkers.filter((m) => m.isLabel && !m.isFullHour).map((m) => (
                  <div key={m.y} style={{ position: "absolute", top: m.y, left: 0, right: 0, height: 1, backgroundColor: "rgba(30,41,59,0.35)" }} />
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
                      onClick={() => { if (!dragDidMove.current) onBlockClick(block); }}
                      onDoubleClick={() => onBlockDoubleClick?.(block)}
                      onMouseDown={(e) => handleBlockMouseDown(block, e)}
                      onResizeMouseDown={(e) => handleResizeMouseDown(block, e)}
                      onContextMenu={(e) => handleBlockContextMenu(block, e)}
                      onBlockUpdate={callbacksRef.current.onBlockUpdate}
                    />
                  );
                })}

                {/* Landing zóny ostatních bloků při multi-move (odvozeno z dragPreview + selectedBlockIds) */}
                {isMultiDrag && dragPreview!.machine === machine && blocks
                  .filter(b => selectedBlockIds!.has(b.id) && b.id !== dragPreview!.blockId)
                  .map(b => {
                    const colorMap: Record<string, string> = { ZAKAZKA: "#1a6bcc", REZERVACE: "#7c3aed", UDRZBA: "#c0392b" };
                    const color = colorMap[b.type] ?? "#475569";
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
                  const colorMap: Record<string, string> = { ZAKAZKA: "#1a6bcc", REZERVACE: "#7c3aed", UDRZBA: "#c0392b" };
                  const color = colorMap[draggedBlock.type] ?? "#475569";
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
