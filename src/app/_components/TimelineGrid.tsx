"use client";

import { useEffect, useRef, useState } from "react";

// ─── Konstanty ────────────────────────────────────────────────────────────────
const SLOT_HEIGHT = 26;         // px na 30 min (1 hod = 52 px)
const DATE_COL_W = 44;          // šířka sloupce s datem (px)
const TIME_COL_W = 72;          // šířka sloupce s časy (px)
const VIEW_DAYS_BACK = 3;
const VIEW_DAYS_AHEAD = 30;
const TOTAL_DAYS = VIEW_DAYS_BACK + VIEW_DAYS_AHEAD + 1;
const TOTAL_SLOTS = TOTAL_DAYS * 48;
const TOTAL_HEIGHT = TOTAL_SLOTS * SLOT_HEIGHT;
const DAY_HEIGHT = 48 * SLOT_HEIGHT; // 1248 px
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
  deadlineData: string | null;
  deadlineMaterial: string | null;
  deadlineExpedice: string | null;
  deadlineDataOk: boolean;
  deadlineMaterialOk: boolean;
  recurrenceType: string;
  createdAt: string;
  updatedAt: string;
};

type DragInternalState = {
  type: "move" | "resize";
  blockId: number;
  originalMachine: string;
  startClientY: number;
  startClientX: number;
  originalStart: Date;
  originalEnd: Date;
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
}

type QueueDropPreview = {
  machine: string;
  top: number;
  height: number;
  jobType: string;
} | null;

// ─── Barvy dle typu ────────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  ZAKAZKA:  { bg: "bg-blue-500/25",   border: "border-blue-500/50",   text: "text-blue-200" },
  REZERVACE: { bg: "bg-purple-500/25", border: "border-purple-500/50", text: "text-purple-200" },
  UDRZBA:   { bg: "bg-red-500/25",    border: "border-red-500/50",    text: "text-red-200" },
};
const DEFAULT_COLORS = { bg: "bg-slate-700/30", border: "border-slate-600/50", text: "text-slate-300" };

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

export function dateToY(date: Date, viewStart: Date): number {
  const diffMs = date.getTime() - viewStart.getTime();
  return (diffMs / 60000 / 30) * SLOT_HEIGHT;
}

function yToDate(y: number, viewStart: Date): Date {
  const minutes = (y / SLOT_HEIGHT) * 30;
  return new Date(viewStart.getTime() + minutes * 60000);
}

function snapToSlot(date: Date): Date {
  const ms = date.getTime();
  return new Date(Math.round(ms / SLOT_MS) * SLOT_MS);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
function BlockCard({
  block, top, height, dimmed, selected, isDragging,
  onClick, onMouseDown, onResizeMouseDown, onContextMenu,
}: {
  block: Block;
  top: number;
  height: number;
  dimmed: boolean;
  selected: boolean;
  isDragging: boolean;
  onClick: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onResizeMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [resizeHovered, setResizeHovered] = useState(false);
  const colors = TYPE_COLORS[block.type] ?? DEFAULT_COLORS;
  const clampedHeight = Math.max(height, 20);
  const showTimes = clampedHeight >= 44;
  const showDesc = clampedHeight >= 72 && block.description;

  return (
    <div
      onMouseDown={block.locked ? undefined : onMouseDown}
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{
        position: "absolute",
        top,
        height: clampedHeight,
        left: 3,
        width: "calc(100% - 6px)",
        zIndex: isDragging ? 20 : resizeHovered ? 15 : 1,
        cursor: block.locked ? "default" : isDragging ? "grabbing" : "grab",
      }}
      className={[
        "rounded border select-none overflow-hidden",
        colors.bg,
        selected ? "border-yellow-400 ring-1 ring-yellow-400/50" : colors.border,
        dimmed ? "opacity-20" : isDragging ? "opacity-70 shadow-2xl" : "opacity-100 hover:brightness-110",
      ].join(" ")}
    >
      <div className={`px-1.5 py-0.5 text-[10px] font-bold leading-tight truncate ${colors.text}`}>
        {block.orderNumber}
        {block.locked && <span className="ml-1 opacity-80">🔒</span>}
      </div>
      {showTimes && (
        <div className={`px-1.5 text-[9px] opacity-70 leading-tight ${colors.text}`}>
          {formatTime(block.startTime)}–{formatTime(block.endTime)}
        </div>
      )}
      {showDesc && (
        <div className={`px-1.5 text-[9px] opacity-60 leading-tight truncate ${colors.text}`}>
          {block.description}
        </div>
      )}
      {!block.locked && (
        <div
          onMouseEnter={() => setResizeHovered(true)}
          onMouseLeave={() => setResizeHovered(false)}
          onMouseDown={(e) => { e.stopPropagation(); onResizeMouseDown(e); }}
          style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 10, cursor: "ns-resize" }}
          className="flex items-end justify-center"
        >
          <div
            style={{ width: "100%", height: 2, transition: "background-color 0.15s" }}
            className={resizeHovered ? "bg-blue-400/80" : "bg-white/0"}
          />
        </div>
      )}
    </div>
  );
}

// ─── TimelineGrid ──────────────────────────────────────────────────────────────
export default function TimelineGrid({
  blocks, filterText, selectedBlockId,
  onBlockClick, onBlockUpdate, onBlockCreate, scrollRef,
  queueDragItem, onQueueDrop,
}: TimelineGridProps) {
  const [viewStart, setViewStart] = useState<Date | null>(null);
  const [now, setNow]             = useState<Date | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [queueDropPreview, setQueueDropPreview] = useState<QueueDropPreview>(null);

  const dragStateRef  = useRef<DragInternalState | null>(null);
  const dragDidMove   = useRef(false);
  const viewStartRef  = useRef<Date | null>(null);
  const colRefs       = useRef<(HTMLDivElement | null)[]>([null, null]);
  const callbacksRef  = useRef({ onBlockUpdate, onBlockCreate });

  useEffect(() => {
    callbacksRef.current = { onBlockUpdate, onBlockCreate };
  }, [onBlockUpdate, onBlockCreate]);

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
      const ds = dragStateRef.current;
      const vs = viewStartRef.current;
      if (!ds || !vs) return;

      const deltaY = e.clientY - ds.startClientY;
      const deltaX = e.clientX - ds.startClientX;
      if (Math.abs(deltaY) + Math.abs(deltaX) > DRAG_THRESHOLD) dragDidMove.current = true;

      if (ds.type === "move") {
        const originalTop    = dateToY(ds.originalStart, vs);
        const originalHeight = dateToY(ds.originalEnd, vs) - originalTop;
        const newMachine     = clientXToMachine(e.clientX);
        setDragPreview({ blockId: ds.blockId, top: originalTop + deltaY, height: originalHeight, machine: newMachine });
      } else {
        const originalTop    = dateToY(ds.originalStart, vs);
        const originalHeight = dateToY(ds.originalEnd, vs) - originalTop;
        const newHeight      = Math.max(SLOT_HEIGHT, originalHeight + deltaY);
        setDragPreview({ blockId: ds.blockId, top: originalTop, height: newHeight, machine: ds.originalMachine });
      }
    }

    async function onMouseUp(e: MouseEvent) {
      const ds = dragStateRef.current;
      const vs = viewStartRef.current;
      if (!ds || !vs) return;

      const moved = dragDidMove.current;
      dragStateRef.current = null;
      dragDidMove.current  = false;
      setDragPreview(null);
      if (!moved) return;

      const deltaY = e.clientY - ds.startClientY;

      if (ds.type === "move") {
        const originalTop = dateToY(ds.originalStart, vs);
        const newStart    = snapToSlot(yToDate(originalTop + deltaY, vs));
        const duration    = ds.originalEnd.getTime() - ds.originalStart.getTime();
        const newEnd      = new Date(newStart.getTime() + duration);
        const newMachine  = clientXToMachine(e.clientX);
        try {
          const res     = await fetch(`/api/blocks/${ds.blockId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startTime: newStart.toISOString(), endTime: newEnd.toISOString(), machine: newMachine }) });
          const updated: Block = await res.json();
          callbacksRef.current.onBlockUpdate(updated);
        } catch { /* blok zůstane nezměněn */ }
      } else {
        const originalTop    = dateToY(ds.originalStart, vs);
        const originalHeight = dateToY(ds.originalEnd, vs) - originalTop;
        const newHeightRaw   = Math.max(SLOT_HEIGHT, originalHeight + deltaY);
        const finalEnd       = snapToSlot(yToDate(originalTop + newHeightRaw, vs));
        const minEnd         = new Date(ds.originalStart.getTime() + SLOT_MS);
        try {
          const res     = await fetch(`/api/blocks/${ds.blockId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endTime: finalEnd >= minEnd ? finalEnd.toISOString() : minEnd.toISOString() }) });
          const updated: Block = await res.json();
          callbacksRef.current.onBlockUpdate(updated);
        } catch { /* blok zůstane nezměněn */ }
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
    dragStateRef.current = { type: "move", blockId: block.id, originalMachine: block.machine, startClientY: e.clientY, startClientX: e.clientX, originalStart: new Date(block.startTime), originalEnd: new Date(block.endTime) };
    dragDidMove.current  = false;
    const top    = dateToY(new Date(block.startTime), vs);
    const height = dateToY(new Date(block.endTime), vs) - top;
    setDragPreview({ blockId: block.id, top, height, machine: block.machine });
  }

  function handleResizeMouseDown(block: Block, e: React.MouseEvent) {
    if (block.locked) return;
    e.preventDefault();
    const vs = viewStartRef.current;
    if (!vs) return;
    dragStateRef.current = { type: "resize", blockId: block.id, originalMachine: block.machine, startClientY: e.clientY, startClientX: e.clientX, originalStart: new Date(block.startTime), originalEnd: new Date(block.endTime) };
    dragDidMove.current  = false;
    const top    = dateToY(new Date(block.startTime), vs);
    const height = dateToY(new Date(block.endTime), vs) - top;
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
      const res2 = await fetch("/api/blocks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderNumber: block.orderNumber, machine: block.machine, type: block.type, startTime: splitAt.toISOString(), endTime: block.endTime, description: block.description, deadlineData: block.deadlineData, deadlineMaterial: block.deadlineMaterial, deadlineExpedice: block.deadlineExpedice }) });
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

  type DayInfo = { date: Date; y: number; isWeekend: boolean; isToday: boolean };
  const days: DayInfo[] = [];

  type HalfHourMark = { y: number; label: string; isFullHour: boolean };
  const halfHourMarkers: HalfHourMark[] = [];

  const nightOverlays: { top: number; height: number; key: string }[] = [];

  for (let di = 0; di < TOTAL_DAYS; di++) {
    const day      = addDays(viewStart, di);
    const dayY     = di * DAY_HEIGHT;
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
    const isToday  = isSameDay(day, todayDate);
    days.push({ date: day, y: dayY, isWeekend, isToday });
    nightOverlays.push({ top: dayY,                            height: WORK_START_H * 2 * SLOT_HEIGHT, key: `ns-${di}` });
    nightOverlays.push({ top: dayY + WORK_END_H * 2 * SLOT_HEIGHT, height: (24 - WORK_END_H) * 2 * SLOT_HEIGHT, key: `ne-${di}` });
    for (let s = 0; s < 48; s++) {
      const h = Math.floor(s / 2);
      const m = s % 2 === 0 ? "00" : "30";
      halfHourMarkers.push({ y: dayY + s * SLOT_HEIGHT, label: `${String(h).padStart(2, "0")}:${m}`, isFullHour: m === "00" });
    }
  }

  const currentTimeY = now ? dateToY(now, viewStart) : null;
  const filter       = filterText.trim().toLowerCase();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, cursor: dragPreview ? "grabbing" : "default" }}>
      {header}

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        <div style={{ height: TOTAL_HEIGHT, display: "flex" }}>

          {/* ── Datum sloupec ─────────────────────────────────────────────── */}
          <div style={{ width: DATE_COL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 10, borderRight: "1px solid rgb(30 41 59)", backgroundColor: "rgb(7 11 22)" }}>
            {days.map((d) => (
              <div
                key={d.y}
                style={{
                  position: "absolute",
                  top: d.y,
                  height: DAY_HEIGHT,
                  left: 0,
                  right: 0,
                  borderLeft: d.isToday
                    ? "3px solid #2484f5"
                    : d.isWeekend
                    ? "3px solid #fb923c"
                    : "3px solid transparent",
                  backgroundColor: d.isToday
                    ? "rgba(36,132,245,0.07)"
                    : d.isWeekend
                    ? "rgba(251,146,60,0.04)"
                    : "transparent",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  paddingTop: 8,
                  gap: 2,
                }}
              >
                <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: "0.04em", lineHeight: 1, color: d.isToday ? "#93c5fd" : d.isWeekend ? "#fdba74" : "rgb(71 85 105)" }}>
                  {DAY_ABBR[d.date.getDay()]}
                </span>
                <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1, color: d.isToday ? "#3b82f6" : d.isWeekend ? "#fb923c" : "rgb(100 116 139)" }}>
                  {d.date.getDate()}
                </span>
                <span style={{ fontSize: 8, fontWeight: 500, lineHeight: 1, color: d.isToday ? "#93c5fd" : d.isWeekend ? "#fdba74" : "rgb(51 65 85)" }}>
                  {MONTH_ABBR[d.date.getMonth()]}
                </span>
              </div>
            ))}
          </div>

          {/* ── Čas sloupec ───────────────────────────────────────────────── */}
          <div style={{ width: TIME_COL_W, flexShrink: 0, position: "relative", zIndex: 9, borderRight: "1px solid rgb(30 41 59)", backgroundColor: "rgb(7 11 22)" }}>
            {halfHourMarkers.map((m) => (
              <div
                key={m.y}
                style={{
                  position: "absolute",
                  top: m.y,
                  left: 0,
                  right: 0,
                  height: SLOT_HEIGHT,
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
                  const snappedStart = snapToSlot(yToDate(timelineY, vs));
                  const snappedY = dateToY(snappedStart, vs);
                  const height = queueDragItem.durationHours * 2 * SLOT_HEIGHT;
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
              >
                {/* Dnešní pozadí */}
                {days.map((d) =>
                  d.isToday ? (
                    <div key={d.y} style={{ position: "absolute", top: d.y, height: DAY_HEIGHT, left: 0, right: 0, backgroundColor: "rgba(36,132,245,0.04)", pointerEvents: "none" }} />
                  ) : null
                )}

                {/* Víkendové pozadí */}
                {days.map((d) =>
                  d.isWeekend && !d.isToday ? (
                    <div key={d.y} style={{ position: "absolute", top: d.y, height: DAY_HEIGHT, left: 0, right: 0, backgroundColor: "rgba(20,16,12,0.35)", pointerEvents: "none" }} />
                  ) : null
                )}

                {/* Noční overlay */}
                {nightOverlays.map((n) => (
                  <div key={n.key} style={{ position: "absolute", top: n.top, height: n.height, left: 0, right: 0, backgroundColor: "rgba(2,6,23,0.4)", pointerEvents: "none" }} />
                ))}

                {/* Denní oddělovače */}
                {days.map((d) => (
                  <div key={d.y} style={{ position: "absolute", top: d.y, left: 0, right: 0, height: 1, backgroundColor: "rgba(51,65,85,0.7)" }} />
                ))}

                {/* Hodinové čáry */}
                {halfHourMarkers.filter((m) => m.isFullHour).map((m) => (
                  <div key={m.y} style={{ position: "absolute", top: m.y, left: 0, right: 0, height: 1, backgroundColor: "rgba(30,41,59,0.7)" }} />
                ))}

                {/* Půlhodinové čáry */}
                {halfHourMarkers.filter((m) => !m.isFullHour).map((m) => (
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
                  const isThisBlockDragging = dragPreview?.blockId === block.id;
                  if (isThisBlockDragging && dragPreview && dragPreview.machine !== machine) return null;

                  const top    = isThisBlockDragging && dragPreview ? dragPreview.top    : dateToY(new Date(block.startTime), viewStart);
                  const height = isThisBlockDragging && dragPreview ? dragPreview.height : dateToY(new Date(block.endTime), viewStart) - dateToY(new Date(block.startTime), viewStart);
                  const dimmed   = filter !== "" && !block.orderNumber.toLowerCase().includes(filter);
                  const selected = block.id === selectedBlockId;

                  return (
                    <BlockCard
                      key={block.id}
                      block={block}
                      top={top}
                      height={height}
                      dimmed={dimmed}
                      selected={selected}
                      isDragging={!!isThisBlockDragging}
                      onClick={() => { if (!dragDidMove.current) onBlockClick(block); }}
                      onMouseDown={(e) => handleBlockMouseDown(block, e)}
                      onResizeMouseDown={(e) => handleResizeMouseDown(block, e)}
                      onContextMenu={(e) => handleBlockContextMenu(block, e)}
                    />
                  );
                })}

                {/* Náhled při přetahování z fronty */}
                {queueDropPreview && queueDropPreview.machine === machine && (
                  <div style={{
                    position: "absolute",
                    top: queueDropPreview.top,
                    height: Math.max(queueDropPreview.height, SLOT_HEIGHT),
                    left: 3,
                    width: "calc(100% - 6px)",
                    borderRadius: 4,
                    backgroundColor: "rgba(36,132,245,0.18)",
                    border: "2px dashed rgba(36,132,245,0.6)",
                    pointerEvents: "none",
                    zIndex: 15,
                  }} />
                )}

                {/* Blok táhnutý DO tohoto sloupce z jiného stroje */}
                {(() => {
                  if (!dragPreview || dragPreview.machine !== machine) return null;
                  const dragged = blocks.find((b) => b.id === dragPreview.blockId);
                  if (!dragged || dragged.machine === machine) return null;
                  return (
                    <BlockCard
                      key={`drag-into-${dragged.id}`}
                      block={dragged}
                      top={dragPreview.top}
                      height={dragPreview.height}
                      dimmed={false}
                      selected={false}
                      isDragging={true}
                      onClick={() => {}}
                      onMouseDown={() => {}}
                      onResizeMouseDown={() => {}}
                      onContextMenu={() => {}}
                    />
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>

      {/* Kontextové menu */}
      {contextMenu && (
        <div
          style={{ position: "fixed", top: contextMenu.y, left: contextMenu.x, zIndex: 1000 }}
          className="bg-slate-800 border border-slate-600 rounded-md shadow-2xl text-[11px] overflow-hidden"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button onClick={handleSplitBlock} className="block w-full text-left px-4 py-2.5 text-slate-200 hover:bg-slate-700 transition-colors">
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
