"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import TimelineGrid, { dateToY, type Block, type CompanyDay } from "./TimelineGrid";
import { snapGroupDelta, snapToNextValidStart } from "@/lib/workingTime";
import type { MachineWorkHours } from "@/lib/machineWorkHours";
import type { MachineScheduleException } from "@/lib/machineScheduleException";
import { Input }     from "@/components/ui/input";
import { Textarea }  from "@/components/ui/textarea";
import { Label }     from "@/components/ui/label";
import { Button }    from "@/components/ui/button";
import { Switch }    from "@/components/ui/switch";
import { Badge }     from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Lock, Unlock, ClipboardList, Pin, Wrench, CalendarDays } from "lucide-react";
import ThemeToggle from "./ThemeToggle";

// ─── Typy ─────────────────────────────────────────────────────────────────────
type AuditLogEntry = {
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

type CodebookOption = {
  id: number;
  category: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  shortCode: string | null;
  isWarning: boolean;
  badgeColor: string | null;
};

type QueueItem = {
  id: number;
  orderNumber: string;
  type: string;
  durationHours: number;
  description: string;
  dataStatusId: number | null;
  dataStatusLabel: string | null;
  dataRequiredDate: string | null;
  materialStatusId: number | null;
  materialStatusLabel: string | null;
  materialRequiredDate: string | null;
  barvyStatusId: number | null;
  barvyStatusLabel: string | null;
  lakStatusId: number | null;
  lakStatusLabel: string | null;
  specifikace: string;
  deadlineExpedice: string;
  recurrenceType: string;
  recurrenceCount: number;
};

type PushSuggestion = {
  chain: Block[];
  shiftMs: number;
  blockedByLock: boolean;
  lockedBlock: Block | null;
};

type Toast = { id: number; message: string; type: "success" | "error" | "info" };

type HistoryEntry = { undo: () => Promise<void>; redo: () => Promise<void> };

// ─── Push chain helper ────────────────────────────────────────────────────────
const CHAIN_GAP_MS = 30 * 60 * 1000; // 30 min = stále "navazující"

// ─── Konstanty ────────────────────────────────────────────────────────────────
const TYPE_LABELS: Record<string, string> = {
  ZAKAZKA: "Zakázka",
  REZERVACE: "Rezervace",
  UDRZBA: "Údržba",
};

const TYPE_BUILDER_CONFIG = {
  ZAKAZKA:   { icon: ClipboardList, label: "Zakázka",        color: "#1a6bcc" },
  REZERVACE: { icon: Pin,           label: "Rezervace",       color: "#7c3aed" },
  UDRZBA:    { icon: Wrench,        label: "Údržba / Oprava", color: "#c0392b" },
} as const;

// ─── ZoomSlider ───────────────────────────────────────────────────────────────
function ZoomSlider({ value, onChange, min = 3, max = 26 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const pct = (value - min) / (max - min);

  const applyPosition = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const { left, width } = el.getBoundingClientRect();
    const raw = (clientX - left) / width;
    const clamped = Math.min(1, Math.max(0, raw));
    onChange(Math.round(min + clamped * (max - min)));
  }, [min, max, onChange]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) { if (isDragging.current) applyPosition(e.clientX); }
    function onMouseUp()  { isDragging.current = false; document.body.style.cursor = ""; }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };
  }, [applyPosition]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {/* ikona odzoomu — klikatelná */}
      <svg
        width="12" height="12" viewBox="0 0 16 16" fill="none"
        onClick={() => onChange(Math.max(min, value - 1))}
        style={{ flexShrink: 0, opacity: value <= min ? 0.2 : 0.5, cursor: value <= min ? "default" : "pointer", transition: "opacity 0.15s" }}
      >
        <circle cx="6.5" cy="6.5" r="5" stroke="var(--text-muted)" strokeWidth="1.5"/>
        <line x1="4" y1="6.5" x2="9" y2="6.5" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>

      {/* track */}
      <div
        ref={trackRef}
        onMouseDown={(e) => { isDragging.current = true; document.body.style.cursor = "ew-resize"; applyPosition(e.clientX); }}
        style={{ position: "relative", width: 80, height: 20, display: "flex", alignItems: "center", cursor: "ew-resize", flexShrink: 0 }}
      >
        {/* bg track */}
        <div style={{ position: "absolute", inset: "0 0 0 0", margin: "auto", height: 2, borderRadius: 2, background: "color-mix(in oklab, var(--border) 90%, transparent)" }} />
        {/* fill */}
        <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", height: 2, width: `${pct * 100}%`, borderRadius: 2, background: "color-mix(in oklab, var(--text) 65%, transparent)", transition: isDragging.current ? undefined : "width 0.05s" }} />
        {/* thumb */}
        <div style={{
          position: "absolute",
          left: `calc(${pct * 100}% - 7px)`,
          top: "50%", transform: "translateY(-50%)",
          width: 14, height: 14, borderRadius: "50%",
          background: "var(--text)",
          boxShadow: "0 1px 4px color-mix(in oklab, var(--text) 25%, transparent), 0 0 0 0.5px color-mix(in oklab, var(--text) 15%, transparent)",
          transition: isDragging.current ? undefined : "left 0.05s",
          flexShrink: 0,
        }} />
      </div>

      {/* ikona přiblížení — klikatelná */}
      <svg
        width="14" height="14" viewBox="0 0 16 16" fill="none"
        onClick={() => onChange(Math.min(max, value + 1))}
        style={{ flexShrink: 0, opacity: value >= max ? 0.2 : 0.5, cursor: value >= max ? "default" : "pointer", transition: "opacity 0.15s" }}
      >
        <circle cx="6.5" cy="6.5" r="5" stroke="var(--text-muted)" strokeWidth="1.5"/>
        <line x1="4" y1="6.5" x2="9" y2="6.5" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="6.5" y1="4" x2="6.5" y2="9" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </div>
  );
}

// 0:30 … 24:00 v 30minutových krocích
const DURATION_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const totalMinutes = (i + 1) * 30;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return { label: `${h}:${m.toString().padStart(2, "0")}`, hours: totalMinutes / 60 };
});

// ─── Pomocné funkce ───────────────────────────────────────────────────────────
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

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("cs-CZ", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("cs-CZ", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function durationHuman(startIso: string, endIso: string): string {
  const mins = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h} hod`;
  return `${h} hod ${m} min`;
}

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h} hod`;
  return `${h}:${m.toString().padStart(2, "0")} hod`;
}

// NOTE etapa 8: pro role bez přístupu k builderu stačí nevyrenderovat handle + aside
// — timeline s flex-1 se automaticky roztáhne na celou šířku

// ─── DatePickerField ──────────────────────────────────────────────────────────
const MONTH_NAMES_CS = ["Leden","Únor","Březen","Duben","Květen","Červen","Červenec","Srpen","Září","Říjen","Listopad","Prosinec"];
const DAY_NAMES_CS   = ["Po","Út","St","Čt","Pá","So","Ne"];
const navBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 8, border: "none",
  background: "var(--surface-2)", color: "var(--text-muted)",
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", transition: "background 100ms ease-out",
};

function DatePickerField({
  value,
  onChange,
  placeholder = "Vyberte datum…",
  asButton = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  asButton?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const today = new Date();
  const selected = value ? new Date(value + "T00:00:00") : undefined;
  const [viewYear,  setViewYear]  = useState(() => selected?.getFullYear()  ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => selected?.getMonth()     ?? today.getMonth());

  function toStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  // Grid Po=0 … Ne=6
  const firstDow = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const displayLabel = selected
    ? selected.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" })
    : placeholder;

  const CELL = 36;
  const GAP  = 3;

  const triggerBtn = (onClick?: () => void) => (
    <button onClick={onClick} style={asButton ? {
      height: 32, borderRadius: 6,
      border: "1px solid var(--border)", background: "transparent",
      color: "var(--text)", fontSize: 11, padding: "0 10px",
      display: "flex", alignItems: "center", gap: 5,
      cursor: "pointer", outline: "none", whiteSpace: "nowrap",
      transition: "background 120ms ease-out",
    } as React.CSSProperties : {
      height: 32, width: "100%", borderRadius: 6,
      border: "1px solid var(--border)", background: "var(--surface-2)",
      color: selected ? "var(--text)" : "var(--text-muted)",
      fontSize: 12, padding: "0 10px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      cursor: "pointer", outline: "none", boxSizing: "border-box",
      transition: "border-color 120ms ease-out",
    } as React.CSSProperties}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: asButton ? 0.6 : 0.4, flexShrink: 0 }}>
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      <span>{displayLabel}</span>
    </button>
  );

  if (!mounted) return triggerBtn();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {triggerBtn()}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0 border-0" style={{ background: "var(--surface)", borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.35)" }}>
        <div style={{ width: 7 * CELL + 6 * GAP + 32, padding: "16px 16px 12px", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" }}>

          {/* Hlavička */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <button onClick={prevMonth} style={navBtnStyle}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em" }}>
              {MONTH_NAMES_CS[viewMonth]} {viewYear}
            </span>
            <button onClick={nextMonth} style={navBtnStyle}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>

          {/* Zkratky dnů */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${CELL}px)`, gap: GAP, marginBottom: 4 }}>
            {DAY_NAMES_CS.map(d => (
              <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 500, color: "var(--text-muted)", paddingBottom: 4 }}>{d}</div>
            ))}
          </div>

          {/* Dny */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${CELL}px)`, gap: GAP }}>
            {cells.map((day, i) => {
              if (!day) return <div key={i} style={{ width: CELL, height: CELL }} />;
              const isSelected = !!selected && selected.getDate() === day && selected.getMonth() === viewMonth && selected.getFullYear() === viewYear;
              const isToday    = today.getDate() === day && today.getMonth() === viewMonth && today.getFullYear() === viewYear;
              return (
                <button key={i}
                  onClick={() => { onChange(toStr(new Date(viewYear, viewMonth, day))); setOpen(false); }}
                  style={{
                    width: CELL, height: CELL, borderRadius: "50%",
                    background: isSelected ? "#3b82f6" : isToday && !isSelected ? "rgba(59,130,246,0.15)" : "transparent",
                    color: isSelected ? "#fff" : isToday ? "#3b82f6" : "var(--text)",
                    border: isToday ? "1.5px solid #3b82f6" : "1.5px solid transparent",
                    fontSize: 13, fontWeight: isSelected || isToday ? 700 : 400,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "background 100ms ease-out",
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── BlockEdit ────────────────────────────────────────────────────────────────
function BlockEdit({
  block,
  onClose,
  onSave,
  allBlocks,
  onDeleteAll,
  onSaveAll,
  canEdit = true,
  canEditData = true,
  canEditMat = true,
  dataOpts: dataOptsProp,
  materialOpts: materialOptsProp,
  barvyOpts: barvyOptsProp,
  lakOpts: lakOptsProp,
}: {
  block: Block;
  onClose: () => void;
  onSave: (updated: Block) => void;
  allBlocks: Block[];
  onDeleteAll: (ids: number[]) => Promise<void>;
  onSaveAll: (ids: number[], payload: Record<string, unknown>) => Promise<void>;
  canEdit?: boolean;
  canEditData?: boolean;
  canEditMat?: boolean;
  dataOpts?: CodebookOption[];
  materialOpts?: CodebookOption[];
  barvyOpts?: CodebookOption[];
  lakOpts?: CodebookOption[];
}) {
  const [orderNumber, setOrderNumber] = useState(block.orderNumber);
  const [type, setType]               = useState(block.type);
  const [description, setDescription] = useState(block.description ?? "");
  const [locked, setLocked]           = useState(block.locked);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Délka tisku
  const currentDurationHours = (new Date(block.endTime).getTime() - new Date(block.startTime).getTime()) / 3600000;
  const [durationHours, setDurationHours] = useState(currentDurationHours);

  // Termín expedice
  const [deadlineExpedice, setDeadlineExpedice] = useState(
    block.deadlineExpedice ? new Date(block.deadlineExpedice).toISOString().slice(0, 10) : ""
  );

  // DATA
  const [dataStatusId, setDataStatusId]         = useState<string>(block.dataStatusId?.toString() ?? "");
  const [dataRequiredDate, setDataRequiredDate] = useState(
    block.dataRequiredDate ? new Date(block.dataRequiredDate).toISOString().slice(0, 10) : ""
  );
  const [dataOk, setDataOk] = useState(block.dataOk);

  // MATERIÁL
  const [materialStatusId, setMaterialStatusId]         = useState<string>(block.materialStatusId?.toString() ?? "");
  const [materialRequiredDate, setMaterialRequiredDate] = useState(
    block.materialRequiredDate ? new Date(block.materialRequiredDate).toISOString().slice(0, 10) : ""
  );
  const [materialOk, setMaterialOk]             = useState(block.materialOk);
  // BARVY
  const [barvyStatusId, setBarvyStatusId] = useState<string>(block.barvyStatusId?.toString() ?? "");

  // LAK
  const [lakStatusId, setLakStatusId] = useState<string>(block.lakStatusId?.toString() ?? "");

  // SPECIFIKACE
  const [specifikace, setSpecifikace] = useState(block.specifikace ?? "");

  // SÉRIE — potvrzovací dialog
  const [seriesConfirm, setSeriesConfirm] = useState<"save" | "delete" | null>(null);

  const isInSeries = block.recurrenceType !== "NONE" || block.recurrenceParentId !== null;

  function getSeriesIds(): number[] {
    const rootId = block.recurrenceParentId ?? block.id;
    return allBlocks
      .filter((b) => b.id === rootId || b.recurrenceParentId === rootId)
      .map((b) => b.id);
  }

  function getFollowingSeriesIds(): number[] {
    const rootId = block.recurrenceParentId ?? block.id;
    const blockStart = new Date(block.startTime).getTime();
    return allBlocks
      .filter((b) => (b.id === rootId || b.recurrenceParentId === rootId) && new Date(b.startTime).getTime() >= blockStart)
      .map((b) => b.id);
  }

  // Číselníky — preferujeme props z PlannerPage (single source of truth), fallback na vlastní fetch
  const [dataOptsLocal, setDataOptsLocal]         = useState<CodebookOption[]>([]);
  const [materialOptsLocal, setMaterialOptsLocal] = useState<CodebookOption[]>([]);
  const [barvyOptsLocal, setBarvyOptsLocal]       = useState<CodebookOption[]>([]);
  const [lakOptsLocal, setLakOptsLocal]           = useState<CodebookOption[]>([]);

  const dataOpts     = dataOptsProp     ?? dataOptsLocal;
  const materialOpts = materialOptsProp ?? materialOptsLocal;
  const barvyOpts    = barvyOptsProp    ?? barvyOptsLocal;
  const lakOpts      = lakOptsProp      ?? lakOptsLocal;

  useEffect(() => {
    if (dataOptsProp) return; // props dodány — přeskočíme vlastní fetch
    Promise.all([
      fetch("/api/codebook?category=DATA").then((r) => r.json()),
      fetch("/api/codebook?category=MATERIAL").then((r) => r.json()),
      fetch("/api/codebook?category=BARVY").then((r) => r.json()),
      fetch("/api/codebook?category=LAK").then((r) => r.json()),
    ]).then(([d, m, b, l]) => {
      setDataOptsLocal(d);
      setMaterialOptsLocal(m);
      setBarvyOptsLocal(b);
      setLakOptsLocal(l);
    });
  }, [dataOptsProp]);


  function resolveLabel(opts: CodebookOption[], id: string): string | null {
    return opts.find((o) => o.id.toString() === id)?.label ?? null;
  }

  const pendingSavePayload = useRef<Record<string, unknown> | null>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.max(32, el.scrollHeight) + "px";
  }, []);

  function buildPayload(): Record<string, unknown> {
    return {
      orderNumber: orderNumber.trim(),
      type,
      description: description.trim() || null,
      locked,
      deadlineExpedice: deadlineExpedice || null,
      dataStatusId: dataStatusId ? parseInt(dataStatusId) : null,
      dataStatusLabel: dataStatusId ? resolveLabel(dataOpts, dataStatusId) : null,
      dataRequiredDate: dataRequiredDate || null,
      dataOk,
      materialStatusId: materialStatusId ? parseInt(materialStatusId) : null,
      materialStatusLabel: materialStatusId ? resolveLabel(materialOpts, materialStatusId) : null,
      materialRequiredDate: materialRequiredDate || null,
      materialOk,
      barvyStatusId: barvyStatusId ? parseInt(barvyStatusId) : null,
      barvyStatusLabel: barvyStatusId ? resolveLabel(barvyOpts, barvyStatusId) : null,
      lakStatusId: lakStatusId ? parseInt(lakStatusId) : null,
      lakStatusLabel: lakStatusId ? resolveLabel(lakOpts, lakStatusId) : null,
      specifikace: specifikace.trim() || null,
      endTime: new Date(new Date(block.startTime).getTime() + durationHours * 3600000).toISOString(),
    };
  }

  async function doSave(payload: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/blocks/${block.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Chyba serveru");
      const updated: Block = await res.json();
      onSave(updated);
    } catch (error) {
      console.error("Block save failed", error);
      setError("Chyba při ukládání.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!orderNumber.trim()) { setError("Vyplňte číslo zakázky."); return; }
    const payload = buildPayload();
    if (isInSeries) {
      pendingSavePayload.current = payload;
      setSeriesConfirm("save");
    } else {
      await doSave(payload);
    }
  }

  const typeCfg = TYPE_BUILDER_CONFIG[type as keyof typeof TYPE_BUILDER_CONFIG];
  const SECTION = "fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: 'var(--text-muted)'";
  void SECTION;

  function SectionLabel({ children }: { children: React.ReactNode }) {
    return <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>{children}</div>;
  }

  function ColLabel({ children }: { children: React.ReactNode }) {
    return <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 5 }}>{children}</div>;
  }

  function StatusSelect({ value, onChange, opts }: {
    value: string;
    onChange: (v: string) => void;
    opts: CodebookOption[];
  }) {
    return (
      <div style={{ position: "relative" }}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            appearance: "none", width: "100%", height: 34,
            background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8,
            color: value ? "var(--text)" : "var(--text-muted)", fontSize: 11, fontWeight: 600,
            padding: "0 26px 0 10px", cursor: "pointer", outline: "none",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
        >
          <option value="">—</option>
          {opts.map((o) => (
            <option key={o.id} value={o.id.toString()}>
              {o.isWarning ? "⚠ " : ""}{o.label}
            </option>
          ))}
        </select>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"
          color="var(--text-muted)"
          style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
          <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)" }}>
      {/* Hlavička */}
      <div style={{ padding: "10px 16px", background: "linear-gradient(135deg, color-mix(in oklab, var(--surface-2) 95%, transparent) 0%, var(--surface) 100%)", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Upravit záznam</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
            {block.orderNumber}
            {isInSeries && (
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent)", background: "color-mix(in oklab, var(--accent) 14%, transparent)", borderRadius: 4, padding: "1px 5px" }}>↻ Série</span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-xs text-slate-400">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="15 18 9 12 15 6"/></svg> Zpět
        </Button>
      </div>

      {/* Obsah */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 16px 16px" }}>

        {error && (
          <div style={{ margin: "12px 0 0", borderRadius: 6, background: "color-mix(in oklab, var(--danger) 15%, transparent)", border: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)", padding: "8px 12px", fontSize: 11, color: "var(--danger)" }}>
            {error}
          </div>
        )}

        {/* Hlavní pole — disabled pro MTZ/DTP/VIEWER */}
        <div style={{ opacity: !canEdit ? 0.45 : 1, pointerEvents: !canEdit ? "none" : "auto" }}>

        {/* Typ */}
        <div style={{ marginTop: 14 }}>
          <SectionLabel>Typ záznamu</SectionLabel>
          <div style={{ display: "flex", gap: 6 }}>
            {(Object.entries(TYPE_BUILDER_CONFIG) as [string, typeof TYPE_BUILDER_CONFIG[keyof typeof TYPE_BUILDER_CONFIG]][]).map(([key, cfg]) => (
              <button key={key} type="button" onClick={() => setType(key)} style={{ flex: 1, padding: "7px 4px", borderRadius: 7, border: type === key ? `1px solid ${cfg.color}` : "1px solid var(--border)", background: type === key ? `${cfg.color}22` : "var(--surface-2)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <cfg.icon size={14} strokeWidth={1.5} color={type === key ? cfg.color : "var(--text-muted)"} />
                <span style={{ fontSize: 9, fontWeight: 600, color: type === key ? cfg.color : "var(--text-muted)", textAlign: "center" }}>{cfg.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Číslo zakázky + Popis — side by side */}
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block" }}>
              {type === "UDRZBA" ? "Název / označení" : "Číslo zakázky"} *
            </Label>
            <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} className="h-8 text-xs" />
          </div>
          <div>
            <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block" }}>Popis</Label>
            <textarea
              ref={descRef}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = Math.max(32, e.currentTarget.scrollHeight) + "px";
              }}
              placeholder="Volitelný popis…"
              rows={1}
              style={{
                width: "100%", minHeight: 32, resize: "none", overflow: "hidden",
                background: "var(--surface-2)", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text)", fontSize: 12, lineHeight: "1.5",
                padding: "6px 10px", outline: "none", fontFamily: "inherit",
                transition: "border-color 120ms ease-out",
                boxSizing: "border-box",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
            />
          </div>
        </div>

        {/* Délka tisku */}
        <div style={{ marginTop: 8 }}>
          <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block" }}>Délka tisku</Label>
          <div style={{ position: "relative" }}>
            <select
              value={String(durationHours)}
              onChange={(e) => setDurationHours(Number(e.target.value))}
              style={{
                appearance: "none", width: "100%", height: 32,
                background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10,
                color: "var(--text)", fontSize: 12, fontWeight: 600,
                padding: "0 32px 0 12px", cursor: "pointer", outline: "none",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
            >
              {DURATION_OPTIONS.map((opt) => (
                <option key={opt.hours} value={String(opt.hours)}>{opt.label}</option>
              ))}
            </select>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"
              color="var(--text-muted)"
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
              <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {/* ── Výrobní sloupečky ── */}
        {type !== "UDRZBA" && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
            <SectionLabel>Výrobní sloupečky</SectionLabel>

            {/* Řádek 1: Datumy + OK — DATA | MATERIÁL | EXPEDICE */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              <div style={{ opacity: !canEditData ? 0.45 : 1, pointerEvents: !canEditData ? "none" : "auto" }}>
                <ColLabel>DATA</ColLabel>
                <DatePickerField value={dataRequiredDate} onChange={setDataRequiredDate} placeholder="Datum" />
                <label style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5, fontSize: 10, fontWeight: 600, color: dataOk ? "var(--success)" : "var(--text-muted)", cursor: "pointer", letterSpacing: "0.04em" }}>
                  <div style={{
                    width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                    background: dataOk ? "var(--success)" : "transparent",
                    border: dataOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 120ms ease-out",
                  }}>
                    {dataOk && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <input type="checkbox" checked={dataOk} onChange={(e) => setDataOk(e.target.checked)} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                  OK
                </label>
              </div>
              <div style={{ opacity: !canEditMat ? 0.45 : 1, pointerEvents: !canEditMat ? "none" : "auto" }}>
                <ColLabel>Materiál</ColLabel>
                <DatePickerField value={materialRequiredDate} onChange={setMaterialRequiredDate} placeholder="Datum" />
                <label style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5, fontSize: 10, fontWeight: 600, color: materialOk ? "var(--success)" : "var(--text-muted)", cursor: "pointer", letterSpacing: "0.04em" }}>
                  <div style={{
                    width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                    background: materialOk ? "var(--success)" : "transparent",
                    border: materialOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 120ms ease-out",
                  }}>
                    {materialOk && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <input type="checkbox" checked={materialOk} onChange={(e) => setMaterialOk(e.target.checked)} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                  OK
                </label>
              </div>
              <div style={{ opacity: !canEdit ? 0.45 : 1, pointerEvents: !canEdit ? "none" : "auto" }}>
                <ColLabel>Expedice</ColLabel>
                <DatePickerField value={deadlineExpedice} onChange={setDeadlineExpedice} placeholder="Datum" />
              </div>
            </div>

            {/* Řádek 2: Stavy — DATA | MATERIÁL | BARVY | LAK */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 10 }}>
              {/* DATA */}
              <div style={{ opacity: !canEditData ? 0.45 : 1, pointerEvents: !canEditData ? "none" : "auto" }}>
                <ColLabel>DATA</ColLabel>
                <StatusSelect value={dataStatusId} onChange={setDataStatusId} opts={dataOpts} />
              </div>
              {/* MATERIÁL */}
              <div style={{ opacity: !canEditMat ? 0.45 : 1, pointerEvents: !canEditMat ? "none" : "auto" }}>
                <ColLabel>Materiál</ColLabel>
                <StatusSelect value={materialStatusId} onChange={setMaterialStatusId} opts={materialOpts} />
              </div>
              {/* BARVY */}
              <div style={{ opacity: !canEdit ? 0.45 : 1, pointerEvents: !canEdit ? "none" : "auto" }}>
                <ColLabel>Barvy</ColLabel>
                <StatusSelect value={barvyStatusId} onChange={setBarvyStatusId} opts={barvyOpts} />
              </div>
              {/* LAK */}
              <div style={{ opacity: !canEdit ? 0.45 : 1, pointerEvents: !canEdit ? "none" : "auto" }}>
                <ColLabel>Lak</ColLabel>
                <StatusSelect value={lakStatusId} onChange={setLakStatusId} opts={lakOpts} />
              </div>
            </div>

            {/* SPECIFIKACE */}
            <div style={{ marginTop: 8, opacity: !canEdit ? 0.45 : 1, pointerEvents: !canEdit ? "none" : "auto" }}>
              <SectionLabel>Specifikace</SectionLabel>
              <Textarea value={specifikace} onChange={(e) => setSpecifikace(e.target.value)} rows={2} placeholder="Speciální požadavky…" className="text-xs resize-none" />
            </div>
          </div>
        )}

        {/* Zamčeno */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          <Switch checked={locked} onCheckedChange={setLocked} />
          <Label style={{ fontSize: 11, color: locked ? "var(--brand)" : "var(--text-muted)", cursor: "pointer" }}>
            <Lock size={11} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }} />Zamčený blok
          </Label>
        </div>

        </div>{/* close: Hlavní pole disabled wrapper */}

        {/* Série — inline dialog */}
        {seriesConfirm ? (
          <div style={{ marginTop: 16, borderRadius: 8, border: "1px solid color-mix(in oklab, var(--accent) 30%, transparent)", background: "color-mix(in oklab, var(--accent) 8%, transparent)", padding: "12px 14px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 8 }}>
              {seriesConfirm === "save" ? "Uložit změny pro…" : "Smazat…"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button
                disabled={saving}
                onClick={async () => {
                  if (seriesConfirm === "save" && pendingSavePayload.current) {
                    await doSave(pendingSavePayload.current);
                  } else if (seriesConfirm === "delete") {
                    await onDeleteAll([block.id]);
                    onClose();
                  }
                  setSeriesConfirm(null);
                }}
                style={{ background: "color-mix(in oklab, var(--accent) 15%, transparent)", border: "1px solid color-mix(in oklab, var(--accent) 35%, transparent)", borderRadius: 7, color: "var(--accent)", fontSize: 11, fontWeight: 600, padding: "7px 12px", cursor: saving ? "default" : "pointer", opacity: saving ? 0.65 : 1, textAlign: "left" }}
              >
                Jen tuto instanci
              </button>
              <button
                disabled={saving}
                onClick={async () => {
                  if (seriesConfirm === "save" && pendingSavePayload.current) {
                    const ids = getSeriesIds();
                    await onSaveAll(ids, pendingSavePayload.current);
                    onClose();
                  } else if (seriesConfirm === "delete") {
                    const ids = getFollowingSeriesIds();
                    await onDeleteAll(ids);
                    onClose();
                  }
                  setSeriesConfirm(null);
                }}
                style={{ background: "color-mix(in oklab, var(--accent) 15%, transparent)", border: "1px solid color-mix(in oklab, var(--accent) 35%, transparent)", borderRadius: 7, color: "var(--accent)", fontSize: 11, fontWeight: 600, padding: "7px 12px", cursor: saving ? "default" : "pointer", opacity: saving ? 0.65 : 1, textAlign: "left" }}
              >
                {seriesConfirm === "delete"
                  ? `Tuto a následující (${getFollowingSeriesIds().length} bloků)`
                  : `Celou sérii (${getSeriesIds().length} bloků)`}
              </button>
              <button
                disabled={saving}
                onClick={() => setSeriesConfirm(null)}
                style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 11, padding: "4px 0", cursor: saving ? "default" : "pointer", opacity: saving ? 0.65 : 1, textAlign: "left" }}
              >
                Zrušit
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Tlačítka */}
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={{
                  flex: 1,
                  height: 32,
                  borderRadius: 8,
                  border: "1px solid color-mix(in oklab, var(--brand) 80%, var(--text) 20%)",
                  background: "linear-gradient(135deg, color-mix(in oklab, var(--brand) 90%, white 10%) 0%, var(--brand) 100%)",
                  color: "var(--brand-contrast)",
                  fontWeight: 800,
                  fontSize: 11,
                  letterSpacing: "0.01em",
                  cursor: saving ? "default" : "pointer",
                  opacity: saving ? 0.7 : 1,
                  boxShadow: "0 2px 8px color-mix(in oklab, var(--brand) 28%, transparent)",
                  transition: "filter 120ms ease-out, transform 120ms ease-out, box-shadow 120ms ease-out",
                }}
                onMouseEnter={(e) => { if (!saving) (e.currentTarget as HTMLButtonElement).style.filter = "brightness(0.96)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.filter = "none"; }}
              >
                {saving ? "Ukládám…" : <><span>Uložit změny</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></>}
              </button>
              <Button type="button" variant="ghost" onClick={onClose} disabled={saving} className="text-slate-400 text-xs">
                Zrušit
              </Button>
            </div>

            {/* Smazat */}
            <button
              type="button"
              onClick={() => {
                if (isInSeries) {
                  setSeriesConfirm("delete");
                } else {
                  onDeleteAll([block.id]).then(onClose);
                }
              }}
              style={{ marginTop: 8, width: "100%", background: "none", border: "none", color: "var(--text-muted)", fontSize: 11, padding: "6px 0", cursor: "pointer", textAlign: "center", transition: "color 0.1s" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
            >
              Smazat blok
            </button>
          </>
        )}

        {/* Barva náhledu */}
        <div style={{ marginTop: 12, borderRadius: 6, padding: "8px 10px", background: `${typeCfg?.color ?? "#334155"}14`, borderLeft: `3px solid ${typeCfg?.color ?? "var(--text-muted)"}`, fontSize: 11, color: typeCfg?.color ?? "var(--text-muted)" }}>
          {typeCfg && <typeCfg.icon size={11} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }} />}{typeCfg?.label}
        </div>
      </div>
    </div>
  );
}

// ─── BlockDetail ──────────────────────────────────────────────────────────────
function BlockDetail({
  block,
  onClose,
  onDelete,
}: {
  block: Block;
  onClose: () => void;
  onDelete: (id: number) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [blockHistory, setBlockHistory] = useState<AuditLogEntry[]>([]);
  const typeCfg = TYPE_BUILDER_CONFIG[block.type as keyof typeof TYPE_BUILDER_CONFIG];

  useEffect(() => {
    fetch(`/api/blocks/${block.id}/audit`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: AuditLogEntry[]) => setBlockHistory(data))
      .catch(() => setBlockHistory([]));
  }, [block.id]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)" }}>
      {/* Hlavička */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{
          borderBottom: "1px solid var(--border)",
          background: "linear-gradient(135deg, color-mix(in oklab, var(--surface-2) 96%, transparent) 0%, var(--surface) 100%)",
        }}
      >
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Detail bloku
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-sm font-bold text-slate-100">{block.orderNumber}</span>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText([block.orderNumber, block.description].filter(Boolean).join(" – "))}
              title="Kopírovat číslo zakázky a popis"
              style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: "1px 3px", lineHeight: 1, transition: "color 120ms ease-out" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Kopírovat
            </button>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-xs text-slate-400">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="15 18 9 12 15 6"/></svg> Zpět
        </Button>
      </div>

      {/* Obsah */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} className="px-4 py-4 space-y-3 text-[11px]">
        <div className="space-y-1.5">
          <Row label="Stroj"   value={block.machine.replace("_", "\u00a0")} />
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] text-slate-500 w-16 flex-shrink-0">Typ</span>
            <Badge
              variant="secondary"
              style={{ fontSize: 10, background: `${typeCfg?.color ?? "var(--text-muted)"}22`, color: typeCfg?.color ?? "var(--text-muted)", border: `1px solid ${typeCfg?.color ?? "var(--text-muted)"}44` }}
            >
              {typeCfg && <typeCfg.icon size={10} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 3 }} />}{TYPE_LABELS[block.type] ?? block.type}
            </Badge>
          </div>
          <Row label="Začátek" value={formatDateTime(block.startTime)} />
          <Row label="Konec"   value={formatDateTime(block.endTime)} />
          <Row label="Délka"   value={durationHuman(block.startTime, block.endTime)} />
          {block.locked && <Row label="Stav" value="Zamčeno" />}
        </div>

        {block.description && (
          <>
            <Separator className="my-1 bg-slate-800" />
            <div className="rounded-md bg-slate-800/40 border border-slate-700/50 px-3 py-2">
              <div className="text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">Popis</div>
              <div className="text-slate-300 leading-relaxed" style={{ whiteSpace: "pre-wrap" }}>{block.description}</div>
            </div>
          </>
        )}

        {(block.dataStatusLabel || block.materialStatusLabel || block.barvyStatusLabel || block.lakStatusLabel || block.specifikace) && (
          <>
            <Separator className="my-1 bg-slate-800" />
            <div className="rounded-md bg-slate-800/40 border border-slate-700/50 px-3 py-2 space-y-1.5">
              <div className="text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">Výrobní sloupečky</div>
              {block.dataStatusLabel && (
                <DeadlineRow label="DATA" value={block.dataStatusLabel} ok={block.dataOk} date={block.dataRequiredDate ? formatDate(block.dataRequiredDate) : null} />
              )}
              {block.materialStatusLabel && (
                <DeadlineRow label="Materiál" value={block.materialStatusLabel} ok={block.materialOk} date={block.materialRequiredDate ? formatDate(block.materialRequiredDate) : null} />
              )}
              {block.barvyStatusLabel && <Row label="Barvy" value={block.barvyStatusLabel} />}
              {block.lakStatusLabel && <Row label="Lak" value={block.lakStatusLabel} />}
              {block.specifikace && <Row label="Spec" value={block.specifikace} />}
            </div>
          </>
        )}
        {block.deadlineExpedice && (
          <>
            <Separator className="my-1 bg-slate-800" />
            <div className="rounded-md bg-slate-800/40 border border-slate-700/50 px-3 py-2">
              <div className="text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">Termín</div>
              <Row label="Expedice" value={formatDate(block.deadlineExpedice)} />
            </div>
          </>
        )}
      </div>

      {/* Tisk dokončen */}
      {block.printCompletedAt && (
        <div style={{ margin: "0 16px 12px", borderRadius: 8, border: "1px solid rgba(34,197,94,0.3)", overflow: "hidden", background: "rgba(34,197,94,0.06)" }}>
          <div style={{ padding: "7px 12px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "#22c55e", fontWeight: 700 }}>✓ Tisk dokončen</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)", flex: 1 }}>
              {new Date(block.printCompletedAt).toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "2-digit" })}
              {" "}
              {new Date(block.printCompletedAt).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}
              {block.printCompletedByUsername && ` — ${block.printCompletedByUsername}`}
            </span>
          </div>
        </div>
      )}

      {/* Historie změn */}
      {blockHistory.length > 0 && (
        <div style={{ margin: "0 16px 12px", borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ padding: "5px 10px", background: "var(--surface-2)", fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Historie změn
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {blockHistory.map((log, i) => (
              <div key={log.id} style={{ padding: "5px 10px", borderTop: i > 0 ? "1px solid var(--border)" : undefined, display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ fontSize: 9, color: "var(--text-muted)", whiteSpace: "nowrap", paddingTop: 1, minWidth: 70 }}>
                  {new Date(log.createdAt).toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit" })} {new Date(log.createdAt).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", flex: 1 }}>
                  <span style={{ color: "var(--text)", fontWeight: 600 }}>{log.username}</span>
                  {log.action === "UPDATE" && log.field && (
                    <span> · {FIELD_LABELS[log.field] ?? log.field}: <span style={{ color: "var(--text)" }}>{fmtAuditVal(log.oldValue, log.field)} → {fmtAuditVal(log.newValue, log.field)}</span></span>
                  )}
                  {log.action === "CREATE" && <span style={{ color: "#22c55e" }}> · Přidána</span>}
                  {log.action === "DELETE" && <span style={{ color: "#ef4444" }}> · Smazána</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Smazat */}
      <div className="px-4 py-3 border-t border-slate-800">
        {confirming ? (
          <div className="space-y-2">
            <p className="text-[10px] text-slate-400 text-center">Opravdu smazat blok?</p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => onDelete(block.id)}
                className="flex-1 text-xs"
              >
                Smazat
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirming(false)}
                className="flex-1 text-xs border-slate-700 text-slate-300"
              >
                Zrušit
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(true)}
            className="w-full text-xs text-slate-400 hover:text-red-300 hover:bg-red-500/10"
          >
            Smazat blok
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] text-slate-500 w-16 flex-shrink-0">{label}</span>
      <span className="text-slate-300">{value}</span>
    </div>
  );
}

function DeadlineRow({ label, value, ok, date }: { label: string; value: string; ok: boolean; date?: string | null }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] text-slate-500 w-16 flex-shrink-0">{label}</span>
      <span className={value === "—" ? "text-slate-600" : ok ? "text-green-400" : "text-slate-300"}>
        {value}
        {ok && value !== "—" && <span className="ml-1 text-green-500">✓</span>}
        {date && <span className="ml-1 text-slate-500 text-[9px]">({date})</span>}
      </span>
    </div>
  );
}

// ─── InfoPanel ────────────────────────────────────────────────────────────────
const FIELD_LABELS: Record<string, string> = {
  dataStatusLabel: "DATA stav",
  dataRequiredDate: "DATA datum",
  dataOk: "DATA OK",
  materialStatusLabel: "Materiál stav",
  materialRequiredDate: "Materiál datum",
  materialOk: "Materiál OK",
  deadlineExpedice: "Expedice termín",
};

function fmtAuditVal(val: string | null, field: string | null) {
  if (!val || val === "null") return "—";
  if (field === "dataOk" || field === "materialOk") return val === "true" ? "✓ OK" : "✗ Ne";
  if (val.includes("T") && val.includes("Z")) {
    try { return new Date(val).toLocaleDateString("cs-CZ"); } catch { return val; }
  }
  return val;
}

function InfoPanel({ logs, onClose, onJumpToBlock }: { logs: AuditLogEntry[]; onClose: () => void; onJumpToBlock: (orderNumber: string) => void }) {
  function fmtDatetime(iso: string) {
    const d = new Date(iso);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
    return isToday ? time : d.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit" }) + " " + time;
  }
  function fmtVal(val: string | null, field: string | null) {
    return fmtAuditVal(val, field);
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--surface)", borderLeft: "1px solid var(--border)" }}>
      <div style={{ padding: "10px 16px", background: "linear-gradient(135deg, color-mix(in oklab, var(--surface-2) 95%, transparent) 0%, var(--surface) 100%)", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Posledních 3 dny</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginTop: 2 }}>DTP + MTZ aktivita</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-xs text-slate-400"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="15 18 9 12 15 6"/></svg> Zpět</Button>
      </div>
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
                      onClick={() => { onClose(); onJumpToBlock(log.orderNumber!); }}
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ShutdownManager ──────────────────────────────────────────────────────────
type EditState = { label: string; startDate: string; endDate: string; startHour: number; endHour: number; machine: "both" | "XL_105" | "XL_106" };

function machineBadgeStyle(m?: string | null): React.CSSProperties {
  return {
    flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", borderRadius: 4, padding: "1px 5px",
    background: !m ? "rgba(139,92,246,0.2)" : m === "XL_105" ? "rgba(59,130,246,0.2)" : "rgba(34,197,94,0.2)",
    color: !m ? "#c4b5fd" : m === "XL_105" ? "#93c5fd" : "#86efac",
    border: `1px solid ${!m ? "rgba(139,92,246,0.3)" : m === "XL_105" ? "rgba(59,130,246,0.3)" : "rgba(34,197,94,0.3)"}`,
  };
}

function MachinePicker({ value, onChange }: { value: "both" | "XL_105" | "XL_106"; onChange: (v: "both" | "XL_105" | "XL_106") => void }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {(["both", "XL_105", "XL_106"] as const).map((opt) => {
        const lbl = opt === "both" ? "Oba stroje" : opt === "XL_105" ? "XL 105" : "XL 106";
        const active = value === opt;
        return (
          <button key={opt} type="button" onClick={() => onChange(opt)} style={{
            flex: 1, height: 28, borderRadius: 6, fontSize: 11, fontWeight: active ? 700 : 500,
            border: active ? "1px solid rgba(139,92,246,0.5)" : "1px solid var(--border)",
            background: active ? "rgba(139,92,246,0.15)" : "var(--surface-2)",
            color: active ? "#c4b5fd" : "var(--text-muted)",
            cursor: "pointer", transition: "all 0.12s ease-out",
          }}>{lbl}</button>
        );
      })}
    </div>
  );
}

function ShutdownManager({
  companyDays,
  onAdd,
  onUpdate,
  onDelete,
  onClose,
}: {
  companyDays: CompanyDay[];
  onAdd: (startDate: string, endDate: string, label: string, machine: string | null) => Promise<void>;
  onUpdate: (id: number, startDate: string, endDate: string, label: string, machine: string | null) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onClose: () => void;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate]     = useState("");
  const [startHour, setStartHour] = useState(0);
  const [endHour, setEndHour]     = useState(23);
  const [label, setLabel]         = useState("");
  const [machine, setMachine]     = useState<"both" | "XL_105" | "XL_106">("both");
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState<number | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const hourSelectStyle: React.CSSProperties = {
    height: 32, borderRadius: 6, border: "1px solid var(--border)",
    background: "var(--surface-2)", color: "var(--text)", fontSize: 11,
    padding: "0 6px", cursor: "pointer", width: "100%",
  };

  function startEdit(cd: CompanyDay) {
    const s = new Date(cd.startDate);
    const e = new Date(cd.endDate);
    setEditingId(cd.id);
    setEditState({
      label: cd.label,
      startDate: cd.startDate.slice(0, 10),
      endDate: cd.endDate.slice(0, 10),
      startHour: s.getHours(),
      endHour: e.getHours(),
      machine: !cd.machine ? "both" : cd.machine === "XL_105" ? "XL_105" : "XL_106",
    });
  }

  function cancelEdit() { setEditingId(null); setEditState(null); }

  async function handleAdd() {
    if (!startDate || !endDate || !label.trim()) { setError("Vyplňte všechna pole."); return; }
    const startISO = `${startDate}T${String(startHour).padStart(2, "0")}:00:00`;
    const endISO   = `${endDate}T${String(endHour).padStart(2, "0")}:59:59`;
    if (endISO < startISO) { setError("Konec musí být po začátku."); return; }
    setSaving(true); setError(null);
    try {
      await onAdd(startISO, endISO, label.trim(), machine === "both" ? null : machine);
      setStartDate(""); setEndDate(""); setLabel(""); setStartHour(0); setEndHour(23); setMachine("both");
    } catch (error) {
      console.error("Company day save failed", error);
      setError("Chyba při ukládání.");
    }
    finally { setSaving(false); }
  }

  async function handleSaveEdit(id: number) {
    if (!editState) return;
    if (!editState.startDate || !editState.endDate || !editState.label.trim()) { setError("Vyplňte všechna pole."); return; }
    const startISO = `${editState.startDate}T${String(editState.startHour).padStart(2, "0")}:00:00`;
    const endISO   = `${editState.endDate}T${String(editState.endHour).padStart(2, "0")}:59:59`;
    if (endISO < startISO) { setError("Konec musí být po začátku."); return; }
    setEditSaving(true); setError(null);
    try {
      await onUpdate(id, startISO, endISO, editState.label.trim(), editState.machine === "both" ? null : editState.machine);
      cancelEdit();
    } catch (err) {
      console.error("Company day update failed", err);
      setError("Chyba při ukládání.");
    }
    finally { setEditSaving(false); }
  }

  async function handleDelete(id: number) {
    setDeleting(id);
    try { await onDelete(id); }
    catch (error) {
      console.error("Company day delete failed", error);
      setError("Chyba při mazání.");
    }
    finally { setDeleting(null); }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)" }}>
      <div style={{ padding: "10px 16px", background: "linear-gradient(135deg, color-mix(in oklab, var(--surface-2) 95%, transparent) 0%, var(--surface) 100%)", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Firemní dny</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginTop: 2 }}>Odstávky a svátky</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-xs text-slate-400"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="15 18 9 12 15 6"/></svg> Zpět</Button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px" }}>
        {error && (
          <div style={{ marginBottom: 12, borderRadius: 6, background: "color-mix(in oklab, var(--danger) 15%, transparent)", border: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)", padding: "8px 12px", fontSize: 11, color: "var(--danger)" }}>{error}</div>
        )}

        {/* Formulář */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Přidat odstávku</div>
          <div>
            <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Název</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Velikonoce, dovolená…" className="h-8 text-xs" />
          </div>
          <div>
            <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Stroj</Label>
            <MachinePicker value={machine} onChange={setMachine} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto", gap: 6, alignItems: "end" }}>
            <div>
              <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Od (datum)</Label>
              <DatePickerField value={startDate} onChange={setStartDate} placeholder="Od…" />
            </div>
            <div>
              <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Hod.</Label>
              <select value={startHour} onChange={(e) => setStartHour(Number(e.target.value))} style={hourSelectStyle}>
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                ))}
              </select>
            </div>
            <div>
              <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Do (datum)</Label>
              <DatePickerField value={endDate} onChange={setEndDate} placeholder="Do…" />
            </div>
            <div>
              <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Hod.</Label>
              <select value={endHour} onChange={(e) => setEndHour(Number(e.target.value))} style={hourSelectStyle}>
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, "0")}:59</option>
                ))}
              </select>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={handleAdd}
            disabled={saving || !label.trim() || !startDate || !endDate}
            className="w-full text-xs font-semibold border border-purple-400/35 bg-purple-400/[0.06] text-purple-400 hover:bg-purple-400/[0.12] hover:text-purple-400 disabled:text-slate-600 disabled:border-slate-700 disabled:bg-transparent"
          >
            {saving ? "Ukládám…" : "＋ Přidat"}
          </Button>
        </div>

        <Separator className="my-1 bg-slate-800" />

        {/* Seznam */}
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>
            Uložené ({companyDays.length})
          </div>
          {companyDays.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: "12px 0" }}>Žádné záznamy</div>
          )}
          {companyDays.map((cd) => (
            <div key={cd.id} style={{ background: editingId === cd.id ? "rgba(139,92,246,0.1)" : "rgba(139,92,246,0.06)", border: `1px solid ${editingId === cd.id ? "rgba(139,92,246,0.35)" : "rgba(139,92,246,0.15)"}`, borderRadius: 8, overflow: "hidden" }}>
              {/* Řádek s názvem */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#c4b5fd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{cd.label}</div>
                    <span style={machineBadgeStyle(cd.machine)}>
                      {!cd.machine ? "OBA" : cd.machine === "XL_105" ? "XL 105" : "XL 106"}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {(() => {
                      const s = new Date(cd.startDate);
                      const e = new Date(cd.endDate);
                      const sDate = s.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric" });
                      const eDate = e.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric" });
                      const sHour = s.getHours(); const eHour = e.getHours();
                      const wholeDay = sHour === 0 && eHour === 23;
                      const sTime = wholeDay ? "" : ` ${String(sHour).padStart(2, "0")}:00`;
                      const eTime = wholeDay ? "" : ` ${String(eHour).padStart(2, "0")}:59`;
                      const sameDateStr = cd.startDate.slice(0, 10) === cd.endDate.slice(0, 10);
                      return sameDateStr ? `${sDate}${sTime}${eTime && sTime !== eTime ? ` – ${eTime.trim()}` : ""}` : `${sDate}${sTime} – ${eDate}${eTime}`;
                    })()}
                  </div>
                </div>
                {/* Tlačítka */}
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => editingId === cd.id ? cancelEdit() : startEdit(cd)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: editingId === cd.id ? "#c4b5fd" : "var(--text-muted)", fontSize: 13, padding: "0 4px", lineHeight: 1 }}
                    title={editingId === cd.id ? "Zrušit editaci" : "Upravit"}
                  >
                    {editingId === cd.id ? "✕" : "✎"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(cd.id)}
                    disabled={deleting === cd.id}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 16, padding: "0 4px", lineHeight: 1 }}
                    title="Smazat"
                  >
                    {deleting === cd.id ? "…" : "×"}
                  </button>
                </div>
              </div>

              {/* Inline editační formulář */}
              {editingId === cd.id && editState && (
                <div style={{ borderTop: "1px solid rgba(139,92,246,0.2)", padding: "10px 10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div>
                    <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Název</Label>
                    <Input value={editState.label} onChange={(e) => setEditState((s) => s && ({ ...s, label: e.target.value }))} className="h-8 text-xs" />
                  </div>
                  <div>
                    <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Stroj</Label>
                    <MachinePicker value={editState.machine} onChange={(v) => setEditState((s) => s && ({ ...s, machine: v }))} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto", gap: 6, alignItems: "end" }}>
                    <div>
                      <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Od</Label>
                      <DatePickerField value={editState.startDate} onChange={(v) => setEditState((s) => s && ({ ...s, startDate: v }))} placeholder="Od…" />
                    </div>
                    <div>
                      <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Hod.</Label>
                      <select value={editState.startHour} onChange={(e) => setEditState((s) => s && ({ ...s, startHour: Number(e.target.value) }))} style={hourSelectStyle}>
                        {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}
                      </select>
                    </div>
                    <div>
                      <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Do</Label>
                      <DatePickerField value={editState.endDate} onChange={(v) => setEditState((s) => s && ({ ...s, endDate: v }))} placeholder="Do…" />
                    </div>
                    <div>
                      <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Hod.</Label>
                      <select value={editState.endHour} onChange={(e) => setEditState((s) => s && ({ ...s, endHour: Number(e.target.value) }))} style={hourSelectStyle}>
                        {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:59</option>)}
                      </select>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleSaveEdit(cd.id)}
                    disabled={editSaving || !editState.label.trim() || !editState.startDate || !editState.endDate}
                    className="w-full text-xs font-semibold border border-purple-400/35 bg-purple-400/[0.06] text-purple-400 hover:bg-purple-400/[0.12] hover:text-purple-400 disabled:text-slate-600 disabled:border-slate-700 disabled:bg-transparent"
                  >
                    {editSaving ? "Ukládám…" : "Uložit změny"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ResizeHandle ─────────────────────────────────────────────────────────────
function ResizeHandle({ onMouseDown }: { onMouseDown: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseDown={(e) => { e.preventDefault(); onMouseDown(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 8, flexShrink: 0, position: "relative", zIndex: 20,
        cursor: "col-resize", display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: hovered ? "rgb(59 130 246 / 0.4)" : "var(--border)",
        transition: "background-color 0.15s",
      }}
    >
      {hovered && (
        <div style={{ color: "rgb(148 163 184)", fontSize: 10, lineHeight: 1, userSelect: "none", pointerEvents: "none", display: "flex", gap: 1 }}>
          <span>⇐</span><span>⇒</span>
        </div>
      )}
    </div>
  );
}

// ─── ToastContainer ──────────────────────────────────────────────────────────
function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  const borderColor = { success: "var(--success)", error: "var(--danger)", info: "var(--info)" };
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "color-mix(in oklab, var(--surface) 92%, transparent)", backdropFilter: "blur(12px)",
          borderTop: "1px solid var(--border)",
          borderRight: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          borderLeft: `3px solid ${borderColor[t.type]}`,
          borderRadius: 10, padding: "10px 14px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          minWidth: 220, maxWidth: 340,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
          fontSize: 13, color: "var(--text)",
          pointerEvents: "auto",
          animation: "toast-in 0.15s ease-out",
        }}>
          <span style={{ flex: 1, lineHeight: 1.4 }}>{t.message}</span>
          <button onClick={() => onDismiss(t.id)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
        </div>
      ))}
    </div>
  );
}

// ─── PlannerPage ──────────────────────────────────────────────────────────────
export default function PlannerPage({ initialBlocks, initialCompanyDays, initialMachineWorkHours, initialMachineExceptions, currentUser }: { initialBlocks: Block[]; initialCompanyDays: CompanyDay[]; initialMachineWorkHours: MachineWorkHours[]; initialMachineExceptions: MachineScheduleException[]; currentUser: { id: number; username: string; role: string } }) {
  // Role-based permissions
  const canEdit     = ["ADMIN", "PLANOVAT"].includes(currentUser.role);
  const canEditData = canEdit || currentUser.role === "DTP";
  const canEditMat  = canEdit || currentUser.role === "MTZ";

  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [companyDays, setCompanyDays] = useState<CompanyDay[]>(initialCompanyDays);
  const [machineWorkHours, setMachineWorkHours] = useState<MachineWorkHours[]>(initialMachineWorkHours);
  const [machineExceptions, setMachineExceptions] = useState<MachineScheduleException[]>(initialMachineExceptions);
  const [showShutdowns, setShowShutdowns] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [todayAuditLogs, setTodayAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditNewCount, setAuditNewCount] = useState(0);

  // ── Toast systém ──
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  function showToast(message: string, type: Toast["type"] = "info") {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }

  // ── Undo/Redo ──
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [workingTimeLock, setWorkingTimeLock] = useState(true);
  const workingTimeLockRef = useRef(true);
  workingTimeLockRef.current = workingTimeLock;
  const MAX_HISTORY = 30;

  // Builder form fields
  const [orderNumber, setOrderNumber]     = useState("");
  const [type, setType]                   = useState("ZAKAZKA");
  const [durationHours, setDurationHours] = useState(1);
  const [description, setDescription]     = useState("");
  const [bDeadlineExpedice, setBDeadlineExpedice] = useState("");
  const [bDataStatusId, setBDataStatusId]         = useState<string>("");
  const [bDataRequiredDate, setBDataRequiredDate] = useState<string>("");
  const [bMaterialStatusId, setBMaterialStatusId]         = useState<string>("");
  const [bMaterialRequiredDate, setBMaterialRequiredDate] = useState<string>("");
  const [bBarvyStatusId, setBBarvyStatusId]       = useState<string>("");
  const [bLakStatusId, setBLakStatusId]           = useState<string>("");
  const [bSpecifikace, setBSpecifikace]           = useState("");
  const [bRecurrenceType, setBRecurrenceType]     = useState("NONE");
  const [bRecurrenceCount, setBRecurrenceCount]   = useState(2);

  // Číselníky pro builder
  const [bDataOpts, setBDataOpts]         = useState<CodebookOption[]>([]);
  const [bMaterialOpts, setBMaterialOpts] = useState<CodebookOption[]>([]);
  const [bBarvyOpts, setBBarvyOpts]       = useState<CodebookOption[]>([]);
  const [bLakOpts, setBLakOpts]           = useState<CodebookOption[]>([]);

  // Lookup mapa badgeColor pro TimelineGrid — jen id → barva, fallback null = zachovat per-field výchozí
  const badgeColorMap: Record<number, string | null> = Object.fromEntries(
    [...bDataOpts, ...bMaterialOpts, ...bBarvyOpts, ...bLakOpts]
      .map((o) => [o.id, o.badgeColor])
  );

  // Queue
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueIdRef = useRef(0);
  const [draggingQueueItem, setDraggingQueueItem] = useState<QueueItem | null>(null);

  // Timeline state
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [editingBlock, setEditingBlock]   = useState<Block | null>(null);
  const [copiedBlock, setCopiedBlock] = useState<Block | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<number>>(new Set());
  const [lassoHintSeen, setLassoHintSeen] = useState(false);
  useEffect(() => {
    if (localStorage.getItem("integraf-lasso-hint-seen") === "true") setLassoHintSeen(true);
  }, []);
  const dismissLassoHint = useCallback(() => {
    setLassoHintSeen(true);
    localStorage.setItem("integraf-lasso-hint-seen", "true");
  }, []);
  const [pushSuggestion, setPushSuggestion] = useState<PushSuggestion | null>(null);
  const blocksRef = useRef<Block[]>([]);
  blocksRef.current = blocks;
  const selectedBlockIdsRef = useRef<Set<number>>(new Set());
  selectedBlockIdsRef.current = selectedBlockIds;
  const [isCut, setIsCut] = useState(false);
  const [pasteTarget, setPasteTarget] = useState<{ machine: string; time: Date } | null>(null);
  const copiedBlockRef = useRef<Block | null>(null);
  const isCutRef = useRef(false);
  const pasteTargetRef = useRef<{ machine: string; time: Date } | null>(null);
  copiedBlockRef.current = copiedBlock;
  isCutRef.current = isCut;
  pasteTargetRef.current = pasteTarget;
  const clipboardGroupRef = useRef<Block[]>([]);
  const isGroupCutRef = useRef(false);
  const [filterText, setFilterText] = useState("");
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [searchNoMore, setSearchNoMore] = useState(false);
  const [jumpDate, setJumpDate]     = useState("");
  const [reportDate, setReportDate] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setHeaderScrolled(el.scrollTop > 20);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  const [daysAhead, setDaysAhead] = useState(60);
  const [daysBack, setDaysBack]   = useState(3);

  // Zoom — kotva pro scroll při změně zoomu
  const [slotHeight, setSlotHeight] = useState(26);
  const zoomAnchorMs = useRef<number | null>(null); // ms od epochy = datum středu viewportu

  function handleZoomChange(newHeight: number) {
    const el = scrollRef.current;
    if (el) {
      const centerY = el.scrollTop + el.clientHeight / 2;
      // yToDate inline: viewStart + (y / slotHeight * 30 min)
      const anchorDate = new Date(viewStart.getTime() + (centerY / slotHeight) * 30 * 60000);
      zoomAnchorMs.current = anchorDate.getTime();
    }
    setSlotHeight(newHeight);
  }

  useLayoutEffect(() => {
    const anchorMs = zoomAnchorMs.current;
    const el = scrollRef.current;
    if (anchorMs === null || !el) return;
    const newY = dateToY(new Date(anchorMs), viewStart, slotHeight);
    el.scrollTop = newY - el.clientHeight / 2;
    zoomAnchorMs.current = null;
  }, [slotHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resizable aside
  const [asideWidth, setAsideWidth] = useState(320);
  const isResizing = useRef(false);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current) return;
      const newWidth = window.innerWidth - e.clientX;
      setAsideWidth(Math.min(600, Math.max(200, newWidth)));
    }
    function onMouseUp() {
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Načtení číselníků pro builder
  useEffect(() => {
    Promise.all([
      fetch("/api/codebook?category=DATA").then((r) => r.json()),
      fetch("/api/codebook?category=MATERIAL").then((r) => r.json()),
      fetch("/api/codebook?category=BARVY").then((r) => r.json()),
      fetch("/api/codebook?category=LAK").then((r) => r.json()),
    ]).then(([d, m, b, l]) => {
      setBDataOpts(d);
      setBMaterialOpts(m);
      setBBarvyOpts(b);
      setBLakOpts(l);
    }).catch((error) => {
      console.error("Codebooks load failed", error);
      showToast("Nepodařilo se načíst číselníky.", "error");
    });
  }, []);

  // Načtení dnešních audit logů (jen pro ADMIN + PLANOVAT)
  const fetchTodayAudit = useCallback(() => {
    if (!["ADMIN", "PLANOVAT"].includes(currentUser.role)) return;
    fetch("/api/audit/today")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: AuditLogEntry[]) => {
        setTodayAuditLogs(data);
        const lastSeen = localStorage.getItem("auditLastSeen");
        const lastSeenTime = lastSeen ? new Date(lastSeen).getTime() : 0;
        const newCount = data.filter((l) => new Date(l.createdAt).getTime() > lastSeenTime).length;
        setAuditNewCount(newCount);
      })
      .catch(() => { /* zachovat poslední validní data a count — neměnit stav */ });
  }, [currentUser.role]);

  useEffect(() => {
    fetchTodayAudit();
    const interval = setInterval(fetchTodayAudit, 60_000);
    return () => clearInterval(interval);
  }, [fetchTodayAudit]);

  // Polling bloků každých 30 s — merge jen printCompleted* pole
  useEffect(() => {
    const pollBlocks = async () => {
      try {
        const res = await fetch("/api/blocks");
        if (!res.ok) return;
        const fresh: Block[] = await res.json();
        const mergePrintCompleted = (b: Block): Block => {
          const f = fresh.find((x) => x.id === b.id);
          if (!f) return b;
          return {
            ...b,
            printCompletedAt: f.printCompletedAt,
            printCompletedByUserId: f.printCompletedByUserId,
            printCompletedByUsername: f.printCompletedByUsername,
          };
        };
        setBlocks((prev) => prev.map(mergePrintCompleted));
        setSelectedBlock((sel) => sel ? mergePrintCompleted(sel) : null);
        setEditingBlock((eb) => eb ? mergePrintCompleted(eb) : null);
      } catch {
        // tiché selhání — zachovat aktuální stav
      }
    };
    const t = setInterval(pollBlocks, 30_000);
    return () => clearInterval(t);
  }, []);

  function handleOpenInfoPanel() {
    setShowInfoPanel(true);
    fetchTodayAudit();
    localStorage.setItem("auditLastSeen", new Date().toISOString());
    setAuditNewCount(0);
  }

  function handleJumpToBlock(orderNumber: string) {
    setShowInfoPanel(false);
    setFilterText(orderNumber);
    const match = blocks.find((b) => b.orderNumber === orderNumber);
    if (match) setSelectedBlock(match);
  }

  const viewStart = startOfDay(addDays(new Date(), -daysBack));

  // "Přejít na" blok mimo rozsah — ref pro čekající scroll po změně daysBack
  const pendingScrollMs = useRef<number | null>(null);
  useLayoutEffect(() => {
    const target = pendingScrollMs.current;
    if (target === null) return;
    pendingScrollMs.current = null;
    const newViewStart = startOfDay(addDays(new Date(), -daysBack));
    const y = dateToY(new Date(target), newViewStart, slotHeight);
    scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
  }, [daysBack]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleJumpToOutOfRange(block: Block) {
    const blockDate = startOfDay(new Date(block.startTime));
    const today = startOfDay(new Date());
    const diffDays = Math.round((today.getTime() - blockDate.getTime()) / (24 * 60 * 60 * 1000));
    pendingScrollMs.current = new Date(block.startTime).getTime();
    setDaysBack(Math.max(3, diffDays + 5));
  }

  // Bloky mimo rozsah (v minulosti) odpovídající aktuálnímu hledání
  const outOfRangeBlocks = filterText.trim()
    ? blocks
        .filter(b => {
          const q = filterText.trim().toLowerCase();
          const matches = [b.orderNumber, b.description, b.specifikace].some(f => f?.toLowerCase().includes(q));
          return matches && new Date(b.startTime) < viewStart;
        })
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    : [];
  const nearestOutOfRange = outOfRangeBlocks[0] ?? null;

  // Všechny bloky odpovídající hledání, seřazené podle startTime
  const searchMatches = filterText.trim()
    ? blocks
        .filter(b => {
          const q = filterText.trim().toLowerCase();
          return [b.orderNumber, b.description, b.specifikace].some(f => f?.toLowerCase().includes(q));
        })
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    : [];

  function handleSearchEnter() {
    if (!filterText.trim()) return;
    if (searchMatches.length === 0) {
      setSearchNoMore(true);
      setTimeout(() => setSearchNoMore(false), 2500);
      return;
    }
    const idx = searchMatchIndex % searchMatches.length;
    const block = searchMatches[idx];
    const isOutOfRange = new Date(block.startTime) < viewStart;
    if (isOutOfRange) {
      handleJumpToOutOfRange(block);
    } else {
      const y = dateToY(new Date(block.startTime), viewStart, slotHeight);
      scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
      setSelectedBlock(block);
    }
    const nextIdx = searchMatchIndex + 1;
    if (nextIdx >= searchMatches.length) {
      setSearchMatchIndex(0);
      setSearchNoMore(true);
      setTimeout(() => setSearchNoMore(false), 2500);
    } else {
      setSearchMatchIndex(nextIdx);
      setSearchNoMore(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function handleScrollToNow() {
    const y = dateToY(new Date(), viewStart, slotHeight);
    scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
  }

  function handleJumpToDate(dateStr: string) {
    if (!dateStr) return;
    const d = new Date(dateStr + "T00:00:00");
    const today = startOfDay(new Date());
    const diffDays = Math.round((today.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays > daysBack) {
      // Datum je před aktuálním viewStart — nejdřív rozšíř rozsah, pak scrollni
      pendingScrollMs.current = d.getTime();
      setDaysBack(diffDays + 3);
    } else {
      const y = dateToY(d, viewStart, slotHeight);
      scrollRef.current?.scrollTo({ top: Math.max(0, y - 100), behavior: "smooth" });
    }
  }

  // Automaticky vyřeší jakýkoli překryv po přesunu/resize bloku:
  //  1. Překryv dozadu (přesunutý blok narazí na předchozí) → snap dopředu
  //  2. Překryv dopředu → auto-push navazující bloky
  // excludeIds = bloky které mají být při kontrole přeskočeny (přesouvané bloky ve skupině)
  async function autoResolveOverlap(movedBlock: Block, excludeIds: Set<number> = new Set([movedBlock.id]), prevBlock?: Block) {
    const duration = new Date(movedBlock.endTime).getTime() - new Date(movedBlock.startTime).getTime();
    const otherBlocks = blocksRef.current.filter(b => !excludeIds.has(b.id));
    const sameMachine = otherBlocks
      .filter(b => b.machine === movedBlock.machine)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    let current = movedBlock;

    // Helper: vrátit blok zpět na původní pozici
    async function revertMovedBlock() {
      const orig = prevBlock ?? movedBlock;
      try {
        const res = await fetch(`/api/blocks/${current.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startTime: new Date(orig.startTime).toISOString(), endTime: new Date(orig.endTime).toISOString(), machine: orig.machine }),
        });
        if (res.ok) {
          const reverted = await res.json() as Block;
          setBlocks(prev => prev.map(b => b.id === reverted.id ? reverted : b));
          setSelectedBlock(sel => sel?.id === reverted.id ? reverted : sel);
        }
      } catch (error) {
        console.error("Revert moved block failed", error);
        showToast("Nepodařilo se vrátit blok na původní pozici.", "error");
      }
    }

    // ── Krok 1: Překryv dozadu ────────────────────────────────────────────────
    const ms = new Date(current.startTime).getTime();
    const preceding = sameMachine.find(b =>
      new Date(b.startTime).getTime() < ms && new Date(b.endTime).getTime() > ms
    );
    if (preceding) {
      const newStart = new Date(preceding.endTime).getTime();
      try {
        const res = await fetch(`/api/blocks/${current.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startTime: new Date(newStart).toISOString(), endTime: new Date(newStart + duration).toISOString() }),
        });
        if (res.ok) {
          current = await res.json() as Block;
          setBlocks(prev => prev.map(b => b.id === current.id ? current : b));
        }
      } catch (error) {
        console.error("Backward overlap correction failed", error);
        showToast("Nepodařilo se opravit překryv bloku.", "error");
      }
    }

    // ── Krok 2: Překryv dopředu → auto-push ──────────────────────────────────
    const curEnd   = new Date(current.endTime).getTime();
    const curStart = new Date(current.startTime).getTime();
    const firstFollowing = sameMachine.find(b =>
      new Date(b.startTime).getTime() >= curStart && new Date(b.startTime).getTime() < curEnd
    );
    if (!firstFollowing) return;

    const shiftMs = curEnd - new Date(firstFollowing.startTime).getTime();
    if (shiftMs <= 0) return;

    if (firstFollowing.locked) {
      await revertMovedBlock();
      setPushSuggestion({ chain: [], shiftMs, blockedByLock: true, lockedBlock: firstFollowing });
      return;
    }

    const chain: Block[] = [firstFollowing];
    let blockedByLocked = false;
    let lockedBlockRef: Block | null = null;
    for (let i = 0; i < 200; i++) {
      const cursor = chain[chain.length - 1];
      const cursorEnd = new Date(cursor.endTime).getTime();
      const next = sameMachine.find(b =>
        !chain.find(c => c.id === b.id) &&
        new Date(b.startTime).getTime() >= cursorEnd - 60_000 &&
        new Date(b.startTime).getTime() <= cursorEnd + CHAIN_GAP_MS
      );
      if (!next) break;
      if (next.locked) {
        const availableRoom = new Date(next.startTime).getTime() - new Date(cursor.endTime).getTime();
        if (availableRoom >= shiftMs) {
          // Dost místa před zamknutým blokem — chain posuneme, zamknutý zůstane
          break;
        }
        // Nedost místa — vrátit přesunutý blok zpět
        blockedByLocked = true;
        lockedBlockRef = next;
        break;
      }
      chain.push(next);
    }

    // Zkontrolovat, zda posunutý chain nepřekryje locked blok mimo chain gap
    if (!blockedByLocked) {
      const lockedOnMachine = sameMachine.filter(b => b.locked && !chain.find(c => c.id === b.id));
      for (const b of chain) {
        const newStart = new Date(b.startTime).getTime() + shiftMs;
        const newEnd   = new Date(b.endTime).getTime()   + shiftMs;
        const hit = lockedOnMachine.find(l =>
          new Date(l.startTime).getTime() < newEnd && new Date(l.endTime).getTime() > newStart
        );
        if (hit) {
          blockedByLocked = true;
          lockedBlockRef = hit;
          break;
        }
      }
    }

    if (blockedByLocked) {
      await revertMovedBlock();
      setPushSuggestion({ chain, shiftMs, blockedByLock: true, lockedBlock: lockedBlockRef });
      return;
    }

    if (chain.length === 0) return;

    // Pokud je zamknutý pracovní čas, snapneme push chain přes blokované časy
    let effectiveShiftMs = shiftMs;
    if (workingTimeLockRef.current) {
      const { deltaMs } = snapGroupDelta(
        chain.map(b => ({ machine: b.machine, originalStart: new Date(b.startTime), originalEnd: new Date(b.endTime) })),
        shiftMs,
        machineWorkHours,
        machineExceptions
      );
      effectiveShiftMs = deltaMs;
    }

    try {
      const results = await Promise.all(
        chain.map(b => {
          const newStart = new Date(new Date(b.startTime).getTime() + effectiveShiftMs);
          const newEnd   = new Date(new Date(b.endTime).getTime()   + effectiveShiftMs);
          return fetch(`/api/blocks/${b.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startTime: newStart.toISOString(), endTime: newEnd.toISOString() }),
          }).then(r => r.json() as Promise<Block>);
        })
      );
      setBlocks(prev => prev.map(b => (results as Block[]).find(r => r.id === b.id) ?? b));
      // Pokud snap přeskočil víkend/noc a zvětšil posun, chain mohl přistát na bloku,
      // který nebyl v původním chainu — rekurzivně vyřešit překryv posledního bloku chainu
      if (effectiveShiftMs > shiftMs) {
        const allExcluded = new Set([...Array.from(excludeIds), ...chain.map(b => b.id)]);
        const lastResult = (results as Block[])[results.length - 1];
        if (lastResult) void autoResolveOverlap(lastResult, allExcluded);
      }
    } catch (error) {
      console.error("Auto-push chain update failed", error);
      showToast("Nepodařilo se automaticky posunout navazující bloky.", "error");
    }
  }

  function handleBlockUpdate(updated: Block, addToHistory = false) {
    const prev = blocksRef.current.find(b => b.id === updated.id);
    setBlocks((arr) => arr.map((b) => (b.id === updated.id ? updated : b)));
    setSelectedBlock((sel) => (sel?.id === updated.id ? updated : sel));
    if (prev) {
      const timeOrMachineChanged =
        new Date(prev.startTime).getTime() !== new Date(updated.startTime).getTime() ||
        new Date(prev.endTime).getTime()   !== new Date(updated.endTime).getTime()   ||
        prev.machine !== updated.machine;
      if (timeOrMachineChanged) {
        void autoResolveOverlap(updated, new Set([updated.id]), prev);
        if (addToHistory) {
          const prevSnap = { startTime: prev.startTime, endTime: prev.endTime, machine: prev.machine };
          const nextSnap = { startTime: updated.startTime, endTime: updated.endTime, machine: updated.machine };
          undoStack.current.push({
            undo: async () => {
              const res = await fetch(`/api/blocks/${updated.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prevSnap) });
              if (res.ok) { const b: Block = await res.json(); setBlocks(arr => arr.map(x => x.id === b.id ? b : x)); setSelectedBlock(sel => sel?.id === b.id ? b : sel); }
            },
            redo: async () => {
              const res = await fetch(`/api/blocks/${updated.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextSnap) });
              if (res.ok) { const b: Block = await res.json(); setBlocks(arr => arr.map(x => x.id === b.id ? b : x)); setSelectedBlock(sel => sel?.id === b.id ? b : sel); }
            },
          });
          if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
          redoStack.current = [];
          setCanUndo(true);
          setCanRedo(false);
        }
      }
    }
  }

  async function handleMultiBlockUpdate(updates: { id: number; startTime: Date; endTime: Date; machine: string }[]) {
    const originals = new Map(updates.map(u => [u.id, blocksRef.current.find(b => b.id === u.id)]));
    try {
      const batchRes = await fetch("/api/blocks/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: updates.map((u) => ({
            id: u.id,
            startTime: u.startTime.toISOString(),
            endTime: u.endTime.toISOString(),
            machine: u.machine,
          })),
        }),
      });
      if (!batchRes.ok) {
        const err = await batchRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Chyba serveru");
      }
      const results: Block[] = await batchRes.json();
      setBlocks((prev) => prev.map((b) => results.find((r) => r.id === b.id) ?? b));

      const prevSnaps = updates.map(u => { const o = originals.get(u.id); return o ? { id: u.id, startTime: o.startTime, endTime: o.endTime, machine: o.machine } : null; }).filter(Boolean) as { id: number; startTime: string; endTime: string; machine: string }[];
      const nextSnaps = updates.map(u => ({ id: u.id, startTime: u.startTime.toISOString(), endTime: u.endTime.toISOString(), machine: u.machine }));
      if (prevSnaps.length > 0) {
        undoStack.current.push({
          undo: async () => {
            const r = await fetch("/api/blocks/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates: prevSnaps }) });
            if (!r.ok) { const err = await r.json().catch(() => ({})) as { error?: string }; throw new Error(err.error ?? "Chyba serveru"); }
            const res: Block[] = await r.json(); setBlocks(prev => prev.map(b => res.find(x => x.id === b.id) ?? b));
          },
          redo: async () => {
            const r = await fetch("/api/blocks/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates: nextSnaps }) });
            if (!r.ok) { const err = await r.json().catch(() => ({})) as { error?: string }; throw new Error(err.error ?? "Chyba serveru"); }
            const res: Block[] = await r.json(); setBlocks(prev => prev.map(b => res.find(x => x.id === b.id) ?? b));
          },
        });
        if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
        redoStack.current = [];
        setCanUndo(true);
        setCanRedo(false);
      }

      const excludeIds = new Set(updates.map(u => u.id));
      for (const moved of results) {
        await autoResolveOverlap(moved, excludeIds, originals.get(moved.id));
      }
    } catch (error) {
      console.error("Multi-block update failed", error);
      showToast("Hromadný posun se nepodařilo uložit.", "error");
    }
  }

  function handleBlockCreate(newBlock: Block) {
    setBlocks((prev) =>
      [...prev, newBlock].sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      )
    );
  }

  async function handleDeleteBlock(id: number) {
    try {
      const res = await fetch(`/api/blocks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Chyba serveru");
      setBlocks((prev) => prev.filter((b) => b.id !== id));
      setSelectedBlock(null);
    } catch (error) {
      console.error("Block delete failed", error);
      showToast("Chyba při mazání bloku.", "error");
    }
  }

  async function handleDeleteAll(ids: number[]) {
    try {
      await Promise.all(ids.map((id) => fetch(`/api/blocks/${id}`, { method: "DELETE" })));
      setBlocks((prev) => prev.filter((b) => !ids.includes(b.id)));
      if (ids.includes(editingBlock?.id ?? -1)) setEditingBlock(null);
      if (ids.includes(selectedBlock?.id ?? -1)) setSelectedBlock(null);
    } catch (error) {
      console.error("Series delete failed", error);
      showToast("Chyba při mazání série.", "error");
    }
  }

  async function handleSaveAll(ids: number[], payload: Record<string, unknown>) {
    try {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/blocks/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }).then((r) => r.json())
        )
      );
      setBlocks((prev) =>
        prev.map((b) => {
          const updated = (results as Block[]).find((r) => r.id === b.id);
          return updated ?? b;
        })
      );
      if (editingBlock && ids.includes(editingBlock.id)) {
        const updatedEditing = (results as Block[]).find((r) => r.id === editingBlock.id);
        if (updatedEditing) setEditingBlock(updatedEditing);
      }
    } catch (error) {
      console.error("Series save failed", error);
      showToast("Chyba při ukládání série.", "error");
    }
  }

  async function handleAddCompanyDay(startDate: string, endDate: string, label: string, machine: string | null) {
    const res = await fetch("/api/company-days", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, label, machine }),
    });
    if (!res.ok) throw new Error("Chyba serveru");
    const created: CompanyDay = await res.json();
    setCompanyDays((prev) => [...prev, created].sort((a, b) => a.startDate.localeCompare(b.startDate)));
  }

  async function handleUpdateCompanyDay(id: number, startDate: string, endDate: string, label: string, machine: string | null) {
    const res = await fetch(`/api/company-days/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, label, machine }),
    });
    if (!res.ok) throw new Error("Chyba serveru");
    const updated: CompanyDay = await res.json();
    setCompanyDays((prev) => prev.map((d) => d.id === id ? updated : d).sort((a, b) => a.startDate.localeCompare(b.startDate)));
  }

  async function handleDeleteCompanyDay(id: number) {
    const res = await fetch(`/api/company-days/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Chyba serveru");
    setCompanyDays((prev) => prev.filter((d) => d.id !== id));
  }

  function handleAddToQueue() {
    if (!orderNumber.trim()) return;
    const findLabel = (opts: CodebookOption[], id: string) =>
      opts.find((o) => String(o.id) === id)?.label ?? null;
    setQueue((prev) => [
      ...prev,
      {
        id: ++queueIdRef.current,
        orderNumber: orderNumber.trim(),
        type,
        durationHours,
        description: description.trim(),
        dataStatusId: bDataStatusId ? Number(bDataStatusId) : null,
        dataStatusLabel: findLabel(bDataOpts, bDataStatusId),
        dataRequiredDate: bDataRequiredDate || null,
        materialStatusId: bMaterialStatusId ? Number(bMaterialStatusId) : null,
        materialStatusLabel: findLabel(bMaterialOpts, bMaterialStatusId),
        materialRequiredDate: bMaterialRequiredDate || null,
        barvyStatusId: bBarvyStatusId ? Number(bBarvyStatusId) : null,
        barvyStatusLabel: findLabel(bBarvyOpts, bBarvyStatusId),
        lakStatusId: bLakStatusId ? Number(bLakStatusId) : null,
        lakStatusLabel: findLabel(bLakOpts, bLakStatusId),
        specifikace: bSpecifikace,
        deadlineExpedice: bDeadlineExpedice,
        recurrenceType: bRecurrenceType,
        recurrenceCount: bRecurrenceType !== "NONE" ? bRecurrenceCount : 1,
      },
    ]);
    setOrderNumber("");
    setDescription("");
    setBDataStatusId("");
    setBDataRequiredDate("");
    setBMaterialStatusId("");
    setBMaterialRequiredDate("");
    setBBarvyStatusId("");
    setBLakStatusId("");
    setBSpecifikace("");
    setBDeadlineExpedice("");
    setBRecurrenceType("NONE");
    setBRecurrenceCount(2);
  }

  function addRecurrenceInterval(date: Date, type: string): Date {
    const d = new Date(date);
    if (type === "DAILY") d.setDate(d.getDate() + 1);
    else if (type === "WEEKLY") d.setDate(d.getDate() + 7);
    else if (type === "MONTHLY") d.setMonth(d.getMonth() + 1);
    return d;
  }

  async function handleExceptionUpsert(machine: string, date: Date, startHour: number, endHour: number, isActive: boolean) {
    try {
      const res = await fetch("/api/machine-exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Datum posíláme jako YYYY-MM-DD lokálního (CZ) kalendářního dne — bez UTC posunu
        body: JSON.stringify({ machine, date: `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`, startHour, endHour, isActive }),
      });
      if (!res.ok) { showToast("Nepodařilo se uložit výjimku.", "error"); return; }
      const exc: MachineScheduleException = await res.json();
      setMachineExceptions((prev) => {
        const filtered = prev.filter((e) => !(e.machine === exc.machine && e.date.slice(0, 10) === exc.date.slice(0, 10)));
        return [...filtered, exc];
      });
    } catch {
      showToast("Chyba při ukládání výjimky.", "error");
    }
  }

  async function handleExceptionDelete(id: number) {
    try {
      const res = await fetch(`/api/machine-exceptions/${id}`, { method: "DELETE" });
      if (!res.ok) { showToast("Nepodařilo se smazat výjimku.", "error"); return; }
      setMachineExceptions((prev) => prev.filter((e) => e.id !== id));
    } catch {
      showToast("Chyba při mazání výjimky.", "error");
    }
  }

  async function handleQueueDrop(itemId: number, machine: string, rawStartTime: Date) {
    const item = queue.find((q) => q.id === itemId);
    if (!item) return;
    const durationMs = item.durationHours * 60 * 60 * 1000;
    // Snap na pracovní dobu pokud je zamknutý pracovní čas
    const startTime = workingTimeLockRef.current
      ? snapToNextValidStart(machine, rawStartTime, durationMs, machineWorkHours, machineExceptions)
      : rawStartTime;
    const rType = item.recurrenceType ?? "NONE";
    const rCount = rType !== "NONE" ? Math.max(1, item.recurrenceCount ?? 1) : 1;

    const baseBody = {
      orderNumber: item.orderNumber,
      machine,
      type: item.type,
      description: item.description || null,
      dataStatusId: item.dataStatusId,
      dataStatusLabel: item.dataStatusLabel,
      dataRequiredDate: item.dataRequiredDate || null,
      materialStatusId: item.materialStatusId,
      materialStatusLabel: item.materialStatusLabel,
      materialRequiredDate: item.materialRequiredDate || null,
      barvyStatusId: item.barvyStatusId,
      barvyStatusLabel: item.barvyStatusLabel,
      lakStatusId: item.lakStatusId,
      lakStatusLabel: item.lakStatusLabel,
      specifikace: item.specifikace || null,
      deadlineExpedice: item.deadlineExpedice || null,
      recurrenceType: rType,
    };

    try {
      // Vytvořit první (rodičovský) blok
      const firstEnd = new Date(startTime.getTime() + durationMs);
      const res1 = await fetch("/api/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...baseBody, startTime: startTime.toISOString(), endTime: firstEnd.toISOString() }),
      });
      if (!res1.ok) {
        const err = await res1.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Chyba serveru");
      }
      const parentBlock: Block = await res1.json();
      handleBlockCreate(parentBlock);

      // Vytvořit children bloky (pokud opakování > 1)
      if (rType !== "NONE" && rCount > 1) {
        let curStart = addRecurrenceInterval(startTime, rType);
        for (let i = 1; i < rCount; i++) {
          const curEnd = new Date(curStart.getTime() + durationMs);
          const res = await fetch("/api/blocks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...baseBody,
              startTime: curStart.toISOString(),
              endTime: curEnd.toISOString(),
              recurrenceParentId: parentBlock.id,
            }),
          });
          if (res.ok) {
            const childBlock: Block = await res.json();
            handleBlockCreate(childBlock);
          }
          curStart = addRecurrenceInterval(curStart, rType);
        }
      }

      setQueue((prev) => prev.filter((q) => q.id !== itemId));
      setDraggingQueueItem(null);
      const y = dateToY(startTime, viewStart);
      scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
    } catch (error) {
      console.error("Queue drop block creation failed", error);
      showToast("Chyba při vytváření bloku.", "error");
    }
  }

  function handleBlockDoubleClick(block: Block) {
    setSelectedBlock(null);
    setEditingBlock(block);
  }

  async function handlePaste() {
    const src = copiedBlockRef.current;
    const target = pasteTargetRef.current;
    if (!src || !target) return;
    const durationMs = new Date(src.endTime).getTime() - new Date(src.startTime).getTime();
    const rawStart = target.time;
    const newStart = workingTimeLockRef.current
      ? snapToNextValidStart(target.machine, rawStart, durationMs, machineWorkHours, machineExceptions)
      : rawStart;
    const newEnd = new Date(newStart.getTime() + durationMs);
    try {
      const res = await fetch("/api/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber: src.orderNumber,
          machine: target.machine,
          type: src.type,
          startTime: newStart.toISOString(),
          endTime: newEnd.toISOString(),
          description: src.description,
          locked: false,
          deadlineExpedice: src.deadlineExpedice,
          dataStatusId: src.dataStatusId,
          dataStatusLabel: src.dataStatusLabel,
          dataRequiredDate: src.dataRequiredDate,
          dataOk: src.dataOk,
          materialStatusId: src.materialStatusId,
          materialStatusLabel: src.materialStatusLabel,
          materialRequiredDate: src.materialRequiredDate,
          materialOk: src.materialOk,
          barvyStatusId: src.barvyStatusId,
          barvyStatusLabel: src.barvyStatusLabel,
          lakStatusId: src.lakStatusId,
          lakStatusLabel: src.lakStatusLabel,
          specifikace: src.specifikace,
        }),
      });
      if (!res.ok) throw new Error();
      const newBlock: Block = await res.json();
      handleBlockCreate(newBlock);
      if (isCutRef.current) {
        await fetch(`/api/blocks/${src.id}`, { method: "DELETE" });
        setBlocks((prev) => prev.filter((b) => b.id !== src.id));
        setSelectedBlock((sel) => (sel?.id === src.id ? null : sel));
        setCopiedBlock(null);
        setIsCut(false);
      }
    } catch (error) {
      console.error("Block paste failed", error);
      showToast("Chyba při vložení bloku.", "error");
    }
  }

  async function handleGroupPaste() {
    const group = clipboardGroupRef.current;
    const target = pasteTargetRef.current;
    if (!group.length || !target) return;
    // Anchor = nejstarší startTime ve skupině
    const anchorMs = Math.min(...group.map((b) => new Date(b.startTime).getTime()));
    const pasteMs = target.time.getTime();

    // POST všechny bloky sekvenčně — při prvním selhání se zastaví a žádný lokální stav se nezmění
    const created: Block[] = [];
    try {
      for (const src of group) {
        const offsetMs = new Date(src.startTime).getTime() - anchorMs;
        const durationMs = new Date(src.endTime).getTime() - new Date(src.startTime).getTime();
        const newStart = new Date(pasteMs + offsetMs);
        const newEnd = new Date(newStart.getTime() + durationMs);
        const res = await fetch("/api/blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderNumber: src.orderNumber, machine: target.machine, type: src.type,
            startTime: newStart.toISOString(), endTime: newEnd.toISOString(),
            description: src.description, locked: false,
            deadlineExpedice: src.deadlineExpedice,
            dataStatusId: src.dataStatusId, dataStatusLabel: src.dataStatusLabel, dataRequiredDate: src.dataRequiredDate, dataOk: src.dataOk,
            materialStatusId: src.materialStatusId, materialStatusLabel: src.materialStatusLabel, materialRequiredDate: src.materialRequiredDate, materialOk: src.materialOk,
            barvyStatusId: src.barvyStatusId, barvyStatusLabel: src.barvyStatusLabel,
            lakStatusId: src.lakStatusId, lakStatusLabel: src.lakStatusLabel,
            specifikace: src.specifikace,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        created.push(await res.json() as Block);
      }
    } catch (err) {
      console.error("Group paste failed", err);
      // Rollback: smaž bloky, které se stihly vytvořit před selháním
      if (created.length > 0) {
        const rollbackResults = await Promise.allSettled(
          created.map((b) => fetch(`/api/blocks/${b.id}`, { method: "DELETE" }).then((r) => {
            if (!r.ok) throw new Error(`Rollback DELETE ${b.id} HTTP ${r.status}`);
          }))
        );
        const rollbackFailed = rollbackResults.filter((r) => r.status === "rejected");
        if (rollbackFailed.length > 0) {
          console.error("Group paste rollback partial failure", rollbackFailed);
          // allSettled zachovává pořadí — blok na indexu i odpovídá rollbackResults[i]
          const survivingBlocks = created.filter((_, i) => rollbackResults[i].status === "rejected");
          survivingBlocks.forEach((b) => handleBlockCreate(b));
          showToast(`Chyba vložení — ${survivingBlocks.length} blok(ů) zůstal(y) v DB. Zkontroluj timeline.`, "error");
          return;
        }
      }
      showToast("Chyba při vložení skupiny — žádné bloky nebyly přidány.", "error");
      return;
    }

    // Všechny POST proběhly úspěšně — přidej do lokálního stavu
    created.forEach((b) => handleBlockCreate(b));

    if (isGroupCutRef.current) {
      // DELETE originálů — kontroluj .ok, sb er selhání
      const deleteResults = await Promise.allSettled(
        group.map((src) => fetch(`/api/blocks/${src.id}`, { method: "DELETE" }).then((r) => {
          if (!r.ok) throw new Error(`DELETE ${src.id} HTTP ${r.status}`);
        }))
      );
      const failedDeletes = deleteResults.filter((r) => r.status === "rejected");
      if (failedDeletes.length > 0) {
        console.error("Group cut: some DELETEs failed", failedDeletes);
        showToast("Bloky byly zkopírovány, ale původní se nepodařilo smazat.", "error");
      } else {
        setBlocks((prev) => prev.filter((b) => !group.some((g) => g.id === b.id)));
        setSelectedBlockIds(new Set());
        clipboardGroupRef.current = [];
        isGroupCutRef.current = false;
      }
    }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        setSelectedBlockIds(new Set());
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedBlockIdsRef.current.size > 0) {
        e.preventDefault();
        const ids = [...selectedBlockIdsRef.current];
        setSelectedBlockIds(new Set());
        handleDeleteAll(ids);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedBlock) {
        e.preventDefault();
        handleDeleteBlock(selectedBlock.id);
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const entry = undoStack.current.pop();
        if (entry) {
          entry.undo()
            .then(() => { redoStack.current.push(entry); setCanUndo(undoStack.current.length > 0); setCanRedo(true); showToast("Vráceno zpět", "info"); })
            .catch((err: unknown) => { undoStack.current.push(entry); setCanUndo(true); console.error("Undo failed", err); showToast("Vrácení zpět selhalo.", "error"); });
        }
        return;
      }
      if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        const entry = redoStack.current.pop();
        if (entry) {
          entry.redo()
            .then(() => { undoStack.current.push(entry); setCanUndo(true); setCanRedo(redoStack.current.length > 0); showToast("Znovu provedeno", "info"); })
            .catch((err: unknown) => { redoStack.current.push(entry); setCanRedo(true); console.error("Redo failed", err); showToast("Znovu provedení selhalo.", "error"); });
        }
        return;
      }
      // Priorita: skupinové operace, pokud je vybráno více bloků lasem
      if (e.key === "c" && selectedBlockIdsRef.current.size > 0) {
        e.preventDefault();
        clipboardGroupRef.current = blocksRef.current.filter((b) => selectedBlockIdsRef.current.has(b.id));
        isGroupCutRef.current = false;
        return;
      }
      if (e.key === "x" && selectedBlockIdsRef.current.size > 0) {
        e.preventDefault();
        clipboardGroupRef.current = blocksRef.current.filter((b) => selectedBlockIdsRef.current.has(b.id));
        isGroupCutRef.current = true;
        return;
      }
      if (e.key === "v" && clipboardGroupRef.current.length > 0 && pasteTargetRef.current) {
        e.preventDefault();
        void handleGroupPaste();
        return;
      }
      // Fallback: jednoblokové operace
      if (e.key === "c" && selectedBlock) {
        e.preventDefault();
        setCopiedBlock(selectedBlock);
        setIsCut(false);
      }
      if (e.key === "x" && selectedBlock) {
        e.preventDefault();
        setCopiedBlock(selectedBlock);
        setIsCut(true);
      }
      if (e.key === "v" && copiedBlockRef.current && pasteTargetRef.current) {
        e.preventDefault();
        handlePaste();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedBlock]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeConfig = TYPE_BUILDER_CONFIG[type as keyof typeof TYPE_BUILDER_CONFIG];

  return (
    <main style={{ height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }} className="bg-background text-foreground">
      {/* ── Header ── */}
      <header className="flex-shrink-0 px-4 py-2 flex items-center gap-4" style={{
          borderBottom: `1px solid ${headerScrolled ? "color-mix(in oklab, var(--border) 100%, transparent)" : "color-mix(in oklab, var(--border) 70%, transparent)"}`,
          background: headerScrolled ? "color-mix(in oklab, var(--surface) 95%, transparent)" : "color-mix(in oklab, var(--surface) 72%, transparent)",
          backdropFilter: headerScrolled ? "blur(24px) saturate(180%)" : "blur(8px)",
          transition: "background 250ms ease-out, backdrop-filter 250ms ease-out, border-color 250ms ease-out",
        }}>
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Integraf" style={{ height: 28, width: "auto", objectFit: "contain", flexShrink: 0 }} />
          <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0 }} />
          <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>Výrobní plán</div>
        </div>

        <div className="flex items-center gap-2 ml-4 flex-1">
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <Input
              type="text"
              value={filterText}
              onChange={(e) => { setFilterText(e.target.value); setSearchMatchIndex(0); setSearchNoMore(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleSearchEnter(); }
                if (e.key === "Escape") { setFilterText(""); setSelectedBlock(null); setSearchMatchIndex(0); setSearchNoMore(false); }
              }}
              placeholder="Hledat zakázku…"
              className="h-8 text-xs w-40 theme-transition-fast"
              style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)", paddingRight: filterText ? 22 : undefined }}
            />
            {filterText && (
              <button
                onClick={() => { setFilterText(""); setSelectedBlock(null); setSearchMatchIndex(0); setSearchNoMore(false); }}
                style={{ position: "absolute", right: 6, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0, lineHeight: 1, fontSize: 14, display: "flex", alignItems: "center" }}
                title="Zrušit filtr (Esc)"
              >
                ×
              </button>
            )}
          </div>
          {filterText && (
            <span style={{ fontSize: 11, whiteSpace: "nowrap", color: searchNoMore ? "#f59e0b" : "var(--text-muted)" }}>
              {searchNoMore
                ? "Žádný další výsledek"
                : searchMatches.length > 0
                  ? searchMatchIndex === 0
                    ? `${searchMatches.length} shod — Enter`
                    : `${searchMatchIndex} / ${searchMatches.length}`
                  : "Žádná shoda"}
            </span>
          )}
          <div style={{ width: 150 }}>
            <DatePickerField
              value={jumpDate}
              onChange={(v) => { setJumpDate(v); if (v) handleJumpToDate(v); }}
              placeholder="Přejít na datum…"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleScrollToNow}
            className="h-8 text-xs theme-transition-fast"
            style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }}
          >
            Dnes
          </Button>
          <ZoomSlider value={slotHeight} onChange={handleZoomChange} />
          <div
            role="group"
            aria-label="Rozsah plánování ve dnech"
            style={{
              display: "flex",
              gap: 2,
              padding: 2,
              borderRadius: 999,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              boxShadow: "inset 0 1px 0 color-mix(in oklab, var(--text) 8%, transparent)",
            }}
          >
            {[30, 60, 90].map(d => (
              <button
                key={d}
                type="button"
                aria-pressed={daysAhead === d}
                onClick={() => setDaysAhead(d)}
                style={{
                  minWidth: 36,
                  height: 24,
                  padding: "0 8px",
                  fontSize: 11,
                  fontWeight: daysAhead === d ? 700 : 600,
                  borderRadius: 999,
                  background: daysAhead === d ? "var(--brand)" : "transparent",
                  border: daysAhead === d ? "1px solid color-mix(in oklab, var(--brand) 75%, var(--text))" : "1px solid transparent",
                  color: daysAhead === d ? "var(--brand-contrast)" : "var(--text-muted)",
                  cursor: "pointer",
                  lineHeight: 1,
                  transition: "all 140ms ease-out",
                  boxShadow: daysAhead === d ? "0 2px 8px color-mix(in oklab, var(--text) 20%, transparent)" : "none",
                }}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {canEdit && (
            <div style={{ display: "flex", gap: 2 }}>
              <button
                onClick={() => { const entry = undoStack.current.pop(); if (entry) entry.undo().then(() => { redoStack.current.push(entry); setCanUndo(undoStack.current.length > 0); setCanRedo(true); showToast("Vráceno zpět", "info"); }).catch((err: unknown) => { undoStack.current.push(entry); setCanUndo(true); console.error("Undo failed", err); showToast("Vrácení zpět selhalo.", "error"); }); }}
                disabled={!canUndo}
                title="Vrátit zpět (Ctrl+Z)"
                style={{ padding: "2px 7px", fontSize: 13, borderRadius: 5, background: "transparent", border: `1px solid ${canUndo ? "var(--border)" : "color-mix(in oklab, var(--border) 50%, transparent)"}`, color: canUndo ? "var(--text-muted)" : "color-mix(in oklab, var(--text-muted) 45%, transparent)", cursor: canUndo ? "pointer" : "default", transition: "all 120ms ease-out", lineHeight: 1.4 }}
              >↩</button>
              <button
                onClick={() => { const entry = redoStack.current.pop(); if (entry) entry.redo().then(() => { undoStack.current.push(entry); setCanUndo(true); setCanRedo(redoStack.current.length > 0); showToast("Znovu provedeno", "info"); }).catch((err: unknown) => { redoStack.current.push(entry); setCanRedo(true); console.error("Redo failed", err); showToast("Znovu provedení selhalo.", "error"); }); }}
                disabled={!canRedo}
                title="Znovu provést (Ctrl+Shift+Z)"
                style={{ padding: "2px 7px", fontSize: 13, borderRadius: 5, background: "transparent", border: `1px solid ${canRedo ? "var(--border)" : "color-mix(in oklab, var(--border) 50%, transparent)"}`, color: canRedo ? "var(--text-muted)" : "color-mix(in oklab, var(--text-muted) 45%, transparent)", cursor: canRedo ? "pointer" : "default", transition: "all 120ms ease-out", lineHeight: 1.4 }}
              >↪</button>
              <button
                onClick={() => setWorkingTimeLock(p => !p)}
                title={workingTimeLock ? "Víkendy/noc blokovány — klik pro flexibilní mód" : "Flexibilní mód — klik pro zamknutí"}
                style={{
                  marginLeft: 4, padding: "2px 8px", fontSize: 13, borderRadius: 5, lineHeight: 1.4,
                  background: workingTimeLock ? "rgba(251,146,60,0.10)" : "var(--surface-2)",
                  border: `1px solid ${workingTimeLock ? "rgba(251,146,60,0.30)" : "var(--border)"}`,
                  color: workingTimeLock ? "#fb923c" : "var(--text-muted)",
                  cursor: "pointer", transition: "all 120ms ease-out",
                }}
              >{workingTimeLock ? <Lock size={14} strokeWidth={1.5} /> : <Unlock size={14} strokeWidth={1.5} />}</button>
            </div>
          )}
          {canEdit && (
            <Button
              variant={showShutdowns ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowShutdowns((s) => !s)}
              className="h-8 text-xs border-slate-700"
            >
              <CalendarDays size={12} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 5 }} />Odstávky
            </Button>
          )}
          <DatePickerField
            value={reportDate}
            onChange={(v) => {
              setReportDate("");
              window.open(`/report/daily?date=${v}`, "_blank");
            }}
            placeholder="Tisknout den"
            asButton
          />
          <span>{blocks.length} bloků</span>
          <span style={{ width: 1, height: 16, background: "var(--border)" }} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {currentUser.username}
            <span style={{
              marginLeft: 6, fontSize: 10, color: "var(--text-muted)",
              background: "var(--surface-2)", borderRadius: 4, padding: "1px 5px",
            }}>
              {currentUser.role}
            </span>
          </span>
          {currentUser.role === "ADMIN" && (
            <a
              href="/admin"
              style={{
                padding: "3px 10px", fontSize: 11, borderRadius: 6,
                background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.35)",
                color: "#3b82f6", cursor: "pointer", textDecoration: "none",
                whiteSpace: "nowrap", transition: "all 120ms ease-out",
              }}
            >
              Správa
            </a>
          )}
          <ThemeToggle />
          {["ADMIN", "PLANOVAT"].includes(currentUser.role) && (
            <div style={{ position: "relative" }}>
              <button
                onClick={handleOpenInfoPanel}
                title="Aktivita DTP a MTZ za poslední 3 dny"
                style={{
                  width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
                  background: showInfoPanel ? "rgba(59,130,246,0.14)" : "transparent",
                  border: `1px solid ${showInfoPanel ? "rgba(59,130,246,0.35)" : "var(--border)"}`,
                  color: showInfoPanel ? "#3b82f6" : "var(--text-muted)",
                  cursor: "pointer", transition: "all 120ms ease-out", padding: 0,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
              </button>
              {auditNewCount > 0 && (
                <span style={{
                  position: "absolute", top: -3, right: -3,
                  width: 14, height: 14, borderRadius: "50%",
                  background: "#ef4444", color: "#fff",
                  fontSize: 8, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  pointerEvents: "none",
                }}>
                  {auditNewCount > 9 ? "9+" : auditNewCount}
                </span>
              )}
            </div>
          )}
          {/* Lasso badge — počet vybraných bloků nebo hint pro nové uživatele */}
          {canEdit && selectedBlockIds.size > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 10px", borderRadius: 8,
              background: "color-mix(in oklab, var(--accent) 12%, var(--surface))",
              border: "1px solid color-mix(in oklab, var(--accent) 35%, var(--border))",
              color: "var(--accent)", fontSize: 12, whiteSpace: "nowrap",
            }}>
              <span style={{ fontWeight: 600 }}>Vybráno {selectedBlockIds.size} {selectedBlockIds.size === 1 ? "blok" : selectedBlockIds.size < 5 ? "bloky" : "bloků"}</span>
              <button
                onClick={() => setSelectedBlockIds(new Set())}
                style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: "0 2px", fontSize: 14, lineHeight: 1, opacity: 0.7, display: "flex", alignItems: "center" }}
              >×</button>
            </div>
          )}
          {canEdit && !lassoHintSeen && selectedBlockIds.size === 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "4px 10px", borderRadius: 8,
              background: "color-mix(in oklab, var(--surface-2) 80%, transparent)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap",
            }}>
              <span style={{ fontSize: 10, background: "color-mix(in oklab, var(--accent) 15%, var(--surface))", borderRadius: 4, padding: "1px 5px", fontFamily: "monospace", color: "var(--accent)" }}>⌥ Alt</span>
              <span>+ tah = výběr více bloků</span>
              <button
                onClick={dismissLassoHint}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "0 2px", fontSize: 14, lineHeight: 1, opacity: 0.6, display: "flex", alignItems: "center" }}
              >×</button>
            </div>
          )}
          <button
            onClick={handleLogout}
            style={{
              padding: "3px 10px", fontSize: 11, borderRadius: 6,
              background: "transparent", border: "1px solid var(--border)",
              color: "var(--text-muted)", cursor: "pointer", transition: "all 120ms ease-out",
            }}
          >
            Odhlásit
          </button>
        </div>
      </header>

      {/* ── Tělo ── */}
      <section style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* LEVÁ ČÁST – timeline grid */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", position: "relative", zIndex: 0 }}>
          <TimelineGrid
            blocks={blocks}
            filterText={filterText}
            selectedBlockId={selectedBlock?.id ?? null}
            onBlockClick={(block) => { setSelectedBlockIds(new Set()); setSelectedBlock(block); }}
            onBlockUpdate={handleBlockUpdate}
            onBlockCreate={handleBlockCreate}
            scrollRef={scrollRef}
            queueDragItem={draggingQueueItem}
            onQueueDrop={handleQueueDrop}
            onBlockDoubleClick={handleBlockDoubleClick}
            companyDays={companyDays}
            slotHeight={slotHeight}
            copiedBlockId={copiedBlock?.id ?? null}
            onGridClick={(machine, time) => setPasteTarget({ machine, time })}
            onBlockCopy={(block) => { setCopiedBlock(block); setIsCut(false); }}
            selectedBlockIds={selectedBlockIds}
            onMultiSelect={(ids) => { setSelectedBlockIds(ids); if (ids.size > 0) dismissLassoHint(); }}
            onMultiBlockUpdate={handleMultiBlockUpdate}
            daysAhead={daysAhead}
            daysBack={daysBack}
            canEdit={canEdit}
            canEditData={canEditData}
            canEditMat={canEditMat}
            onError={(msg) => showToast(msg, "error")}
            workingTimeLock={workingTimeLock}
            badgeColorMap={badgeColorMap}
            machineWorkHours={machineWorkHours}
            machineExceptions={machineExceptions}
            onExceptionUpsert={canEdit ? handleExceptionUpsert : undefined}
            onExceptionDelete={canEdit ? handleExceptionDelete : undefined}
          />
        </div>

        {/* Resize handle + aside — skryté pro non-editors (NOTE etapa 8) */}
        {canEdit && <ResizeHandle onMouseDown={() => {
          isResizing.current = true;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }} />}

        {/* PRAVÁ ČÁST – detail nebo builder */}
        {canEdit && <aside style={{ width: asideWidth, flexShrink: 0, position: "relative", zIndex: 10, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {showInfoPanel ? (
            <InfoPanel
              logs={todayAuditLogs}
              onClose={() => setShowInfoPanel(false)}
              onJumpToBlock={handleJumpToBlock}
            />
          ) : showShutdowns ? (
            <ShutdownManager
              companyDays={companyDays}
              onAdd={handleAddCompanyDay}
              onUpdate={handleUpdateCompanyDay}
              onDelete={handleDeleteCompanyDay}
              onClose={() => setShowShutdowns(false)}
            />
          ) : editingBlock ? (
            <BlockEdit
              key={editingBlock.id}
              block={editingBlock}
              onClose={() => setEditingBlock(null)}
              onSave={(updated) => { handleBlockUpdate(updated); setEditingBlock(null); }}
              allBlocks={blocks}
              onDeleteAll={handleDeleteAll}
              onSaveAll={handleSaveAll}
              canEdit={canEdit}
              canEditData={canEditData}
              canEditMat={canEditMat}
              dataOpts={bDataOpts}
              materialOpts={bMaterialOpts}
              barvyOpts={bBarvyOpts}
              lakOpts={bLakOpts}
            />
          ) : selectedBlock ? (
            <BlockDetail block={selectedBlock} onClose={() => setSelectedBlock(null)} onDelete={handleDeleteBlock} />
          ) : (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--surface)", borderLeft: "1px solid var(--border)" }}>

              {/* ── Builder Header ── */}
              <div style={{ padding: "12px 16px", background: "linear-gradient(135deg, color-mix(in oklab, var(--surface-2) 95%, transparent) 0%, var(--surface) 100%)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #e53e3e 0%, #dd6b20 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#fff", fontSize: 15, flexShrink: 0 }}>
                    J
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>Job Builder</div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 2 }}>Integraf</div>
                  </div>
                </div>
              </div>

              {/* ── Formulář ── */}
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "0 16px", flex: 1 }}>

                  {/* ── Typ záznamu ── */}
                  <div style={{ paddingTop: 16, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>
                      Typ záznamu
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {(Object.entries(TYPE_BUILDER_CONFIG) as [string, typeof TYPE_BUILDER_CONFIG[keyof typeof TYPE_BUILDER_CONFIG]][]).map(([key, cfg]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setType(key)}
                          style={{
                            flex: 1, padding: "8px 4px", borderRadius: 7,
                            border: type === key ? `1px solid ${cfg.color}` : "1px solid var(--border)",
                            background: type === key ? `${cfg.color}22` : "var(--surface-2)",
                            cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                            transition: "all 0.15s",
                          }}
                        >
                          <cfg.icon size={16} strokeWidth={1.5} color={type === key ? cfg.color : "var(--text-muted)"} />
                          <span style={{ fontSize: 9, fontWeight: 600, color: type === key ? cfg.color : "var(--text-muted)", letterSpacing: "0.04em", lineHeight: 1.3, textAlign: "center" }}>
                            {cfg.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Zakázka ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                      {type === "UDRZBA" ? "Popis" : "Zakázka"}
                    </div>

                    {/* Číslo zakázky + Délka tisku */}
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                      <div style={{ flex: "0 0 130px" }}>
                        <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block" }}>
                          {type === "UDRZBA" ? "Název / označení" : "Číslo zakázky"} *
                        </Label>
                        <Input
                          value={orderNumber}
                          onChange={(e) => setOrderNumber(e.target.value)}
                          placeholder={type === "UDRZBA" ? "Čištění hlavy…" : "17001"}
                          className="h-8 text-xs"
                        />
                      </div>

                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Délka tisku</label>
                        <div style={{ position: "relative" }}>
                          <select
                            value={String(durationHours)}
                            onChange={(e) => setDurationHours(Number(e.target.value))}
                            style={{
                              appearance: "none",
                              width: "100%",
                              height: 32,
                              background: "var(--surface-2)",
                              border: "1px solid var(--border)",
                              borderRadius: 10,
                              color: "var(--text)",
                              fontSize: 13,
                              fontWeight: 600,
                              padding: "0 36px 0 14px",
                              cursor: "pointer",
                              outline: "none",
                            }}
                            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                          >
                            {DURATION_OPTIONS.map((opt) => (
                              <option key={opt.hours} value={String(opt.hours)}>{opt.label}</option>
                            ))}
                          </select>
                          <svg
                            viewBox="0 0 20 20"
                            fill="none"
                            stroke="currentColor"
                            color="var(--text-muted)"
                            strokeWidth="1.8"
                            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, pointerEvents: "none" }}
                          >
                            <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* Popis */}
                    <div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                        <Label style={{ fontSize: 10, color: "var(--text-muted)" }}>Popis</Label>
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(description)}
                          title="Kopírovat popis"
                          style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: "0 2px", lineHeight: 1, transition: "color 120ms ease-out" }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                          Kopírovat
                        </button>
                      </div>
                      <Textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={2}
                        placeholder="Firma – produkt – počet tisků…"
                        className="text-xs resize-none"
                      />
                    </div>
                  </div>

                  {/* ── Výrobní sloupečky (skryté pro Údržbu) ── */}
                  {type !== "UDRZBA" && (
                    <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Výrobní sloupečky</div>
                      {/* DATA — datum + dropdown v jednom řádku */}
                      <div>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Data</label>
                        <div style={{ display: "flex", gap: 6 }}>
                          <div style={{ flex: "0 0 130px" }}>
                            <DatePickerField value={bDataRequiredDate} onChange={setBDataRequiredDate} placeholder="Datum dodání…" />
                          </div>
                          <div style={{ position: "relative", flex: 1 }}>
                            <select
                              value={bDataStatusId}
                              onChange={(e) => setBDataStatusId(e.target.value)}
                              style={{
                                appearance: "none", width: "100%", height: 32,
                                background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10,
                                color: bDataStatusId ? "var(--text)" : "var(--text-muted)", fontSize: 12, fontWeight: 600,
                                padding: "0 32px 0 12px", cursor: "pointer", outline: "none",
                              }}
                              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                            >
                              <option value="">— info —</option>
                              {bDataOpts.map((o) => (
                                <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                              ))}
                            </select>
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" color="var(--text-muted)"
                              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
                              <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        </div>
                      </div>

                      {/* Materiál — datum + dropdown v jednom řádku */}
                      <div>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Materiál</label>
                        <div style={{ display: "flex", gap: 6 }}>
                          <div style={{ flex: "0 0 130px" }}>
                            <DatePickerField value={bMaterialRequiredDate} onChange={setBMaterialRequiredDate} placeholder="Datum dodání…" />
                          </div>
                          <div style={{ position: "relative", flex: 1 }}>
                            <select
                              value={bMaterialStatusId}
                              onChange={(e) => setBMaterialStatusId(e.target.value)}
                              style={{
                                appearance: "none", width: "100%", height: 32,
                                background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10,
                                color: bMaterialStatusId ? "var(--text)" : "var(--text-muted)", fontSize: 12, fontWeight: 600,
                                padding: "0 32px 0 12px", cursor: "pointer", outline: "none",
                              }}
                              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                            >
                              <option value="">— info —</option>
                              {bMaterialOpts.map((o) => (
                                <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                              ))}
                            </select>
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" color="var(--text-muted)"
                              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
                              <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        </div>
                      </div>

                      {/* Barvy, Lak — 2×2 grid */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {([
                          { label: "Barvy",   value: bBarvyStatusId,    setter: setBBarvyStatusId,    opts: bBarvyOpts },
                          { label: "Lak",     value: bLakStatusId,      setter: setBLakStatusId,      opts: bLakOpts },
                        ] as { label: string; value: string; setter: (v: string) => void; opts: CodebookOption[] }[]).map(({ label, value, setter, opts }) => (
                          <div key={label}>
                            <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>{label}</label>
                            <div style={{ position: "relative" }}>
                              <select
                                value={value}
                                onChange={(e) => setter(e.target.value)}
                                style={{
                                  appearance: "none", width: "100%", height: 32,
                                  background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10,
                                  color: value ? "var(--text)" : "var(--text-muted)", fontSize: 12, fontWeight: 600,
                                  padding: "0 32px 0 12px", cursor: "pointer", outline: "none",
                                }}
                                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                              >
                                <option value="">— nezadáno —</option>
                                {opts.map((o) => (
                                  <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                                ))}
                              </select>
                              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" color="var(--text-muted)"
                                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
                                <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div>
                        <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block" }}>Specifikace</Label>
                        <Input value={bSpecifikace} onChange={(e) => setBSpecifikace(e.target.value)} placeholder="Volný text…" className="h-8 text-xs" />
                      </div>
                      <div>
                        <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block" }}>Termín expedice</Label>
                        <DatePickerField value={bDeadlineExpedice} onChange={setBDeadlineExpedice} placeholder="Datum expedice…" />
                      </div>
                    </div>
                  )}

                  {/* ── Opakování ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>Opakování</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Interval</label>
                        <div style={{ position: "relative" }}>
                          <select
                            value={bRecurrenceType}
                            onChange={(e) => setBRecurrenceType(e.target.value)}
                            style={{
                              appearance: "none", width: "100%", height: 32,
                              background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10,
                              color: bRecurrenceType !== "NONE" ? "var(--accent)" : "var(--text)", fontSize: 12, fontWeight: 600,
                              padding: "0 32px 0 12px", cursor: "pointer", outline: "none",
                            }}
                            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                          >
                            <option value="NONE">— bez opakování —</option>
                            <option value="DAILY">↻ Každý den</option>
                            <option value="WEEKLY">↻ Každý týden</option>
                            <option value="MONTHLY">↻ Každý měsíc</option>
                          </select>
                          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" color="var(--text-muted)"
                            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
                            <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      </div>
                      {bRecurrenceType !== "NONE" && (
                        <div style={{ flex: "0 0 90px" }}>
                          <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Počet bloků</label>
                          <input
                            type="number"
                            min={2}
                            max={52}
                            value={bRecurrenceCount}
                            onChange={(e) => setBRecurrenceCount(Math.max(2, Math.min(52, parseInt(e.target.value) || 2)))}
                            style={{
                              width: "100%", height: 32, background: "var(--surface-2)",
                              border: "1px solid var(--accent)", borderRadius: 10,
                              color: "var(--accent)", fontSize: 13, fontWeight: 700,
                              padding: "0 10px", outline: "none", textAlign: "center",
                            }}
                          />
                        </div>
                      )}
                    </div>
                    {bRecurrenceType !== "NONE" && (
                      <div style={{ fontSize: 10, color: "var(--accent)", marginTop: 6, opacity: 0.8 }}>
                        Vytvoří se {bRecurrenceCount} bloků · interval: {bRecurrenceType === "DAILY" ? "1 den" : bRecurrenceType === "WEEKLY" ? "7 dní" : "1 měsíc"}
                      </div>
                    )}
                  </div>

                  {/* ── Live náhled ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Náhled bloku</div>
                    <div style={{
                      borderRadius: 6, padding: "9px 11px",
                      background: `${typeConfig?.color ?? "#334155"}18`,
                      borderTop: `1px solid ${typeConfig?.color ?? "var(--text-muted)"}33`,
                      borderRight: `1px solid ${typeConfig?.color ?? "var(--text-muted)"}33`,
                      borderBottom: `1px solid ${typeConfig?.color ?? "var(--text-muted)"}33`,
                      borderLeft: `3px solid ${typeConfig?.color ?? "var(--text-muted)"}`,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>
                        {orderNumber || <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>—</span>}
                      </div>
                      {description && (
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>{description}</div>
                      )}
                      <div style={{ fontSize: 10, color: typeConfig?.color ?? "var(--text-muted)", marginTop: 5 }}>
                        {typeConfig && <typeConfig.icon size={10} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 3 }} />}{typeConfig?.label} · {formatDuration(durationHours)}
                      </div>
                    </div>
                  </div>

                  {/* ── Přidat do fronty ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 16 }}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleAddToQueue}
                      disabled={!orderNumber.trim()}
                      className="w-full text-xs font-semibold border border-yellow-400/35 bg-yellow-400/[0.06] text-yellow-400 hover:bg-yellow-400/[0.12] hover:text-yellow-400 disabled:text-slate-600 disabled:border-slate-700 disabled:bg-transparent"
                    >
                      ＋ Přidat do fronty
                    </Button>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", textAlign: "center", marginTop: 6 }}>
                      Přetáhni kartu z fronty na timeline → stroj a čas
                    </div>
                  </div>
                </div>

                {/* ── Fronta ── */}
                {queue.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", background: "var(--surface-2)", padding: "12px 16px 16px", flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Fronta</div>
                      <div style={{ minWidth: 18, height: 18, borderRadius: 9, background: "var(--brand)", color: "var(--brand-contrast)", fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
                        {queue.length}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {queue.map((item) => {
                        const itemCfg = TYPE_BUILDER_CONFIG[item.type as keyof typeof TYPE_BUILDER_CONFIG];
                        return (
                          <div
                            key={item.id}
                            draggable
                            className="pressable-card"
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = "copy";
                              e.dataTransfer.setData("text/plain", String(item.id));
                              setDraggingQueueItem(item);
                            }}
                            onDragEnd={() => setDraggingQueueItem(null)}
                            style={{
                              display: "flex", alignItems: "stretch",
                              background: "var(--surface)",
                              borderRadius: 6,
                              border: "1px solid var(--border)",
                              overflow: "hidden",
                              cursor: "grab",
                            }}
                          >
                            {/* Barevný pruh vlevo */}
                            <div style={{ width: 3, background: itemCfg?.color ?? "var(--text-muted)", flexShrink: 0 }} />
                            {/* Obsah */}
                            <div style={{ flex: 1, padding: "7px 9px", minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{item.orderNumber}</div>
                              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                                {itemCfg && <itemCfg.icon size={10} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 3 }} />}{itemCfg?.label} · {formatDuration(item.durationHours)}
                              </div>
                              {item.description && (
                                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {item.description}
                                </div>
                              )}
                            </div>
                            {/* Smazat */}
                            <button
                              type="button"
                              onClick={() => setQueue((prev) => prev.filter((q) => q.id !== item.id))}
                              style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 16, padding: "0 10px", display: "flex", alignItems: "center", lineHeight: 1 }}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>}
      </section>

      {/* ── Push chain notifikace ── */}
      {pushSuggestion?.blockedByLock && (
        <div style={{
          position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
          background: "var(--surface)", border: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)",
          borderRadius: 12, padding: "10px 16px",
          display: "flex", alignItems: "center", gap: 12,
          zIndex: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
          whiteSpace: "nowrap",
        }}>
          <span style={{ fontSize: 11, color: "var(--danger)" }}>
            <Lock size={11} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }} />Blok vrácen — v cestě je zamknutý blok
            {pushSuggestion.lockedBlock && <b> {pushSuggestion.lockedBlock.orderNumber}</b>}
          </span>
          <button
            onClick={() => setPushSuggestion(null)}
            style={{ fontSize: 11, color: "var(--text)", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}
          >
            OK
          </button>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />

    </main>
  );
}
