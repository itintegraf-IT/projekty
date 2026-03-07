"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import TimelineGrid, { dateToY, type Block, type CompanyDay } from "./TimelineGrid";
import { Input }     from "@/components/ui/input";
import { Textarea }  from "@/components/ui/textarea";
import { Label }     from "@/components/ui/label";
import { Button }    from "@/components/ui/button";
import { Switch }    from "@/components/ui/switch";
import { Badge }     from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

// ─── Typy ─────────────────────────────────────────────────────────────────────
type CodebookOption = {
  id: number;
  category: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  shortCode: string | null;
  isWarning: boolean;
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

// ─── Konstanty ────────────────────────────────────────────────────────────────
const TYPE_LABELS: Record<string, string> = {
  ZAKAZKA: "Zakázka",
  REZERVACE: "Rezervace",
  UDRZBA: "Údržba",
};

const TYPE_BUILDER_CONFIG = {
  ZAKAZKA:   { emoji: "📋", label: "Zakázka",        color: "#1a6bcc" },
  REZERVACE: { emoji: "📌", label: "Rezervace",       color: "#7c3aed" },
  UDRZBA:    { emoji: "🔧", label: "Údržba / Oprava", color: "#c0392b" },
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
        <circle cx="6.5" cy="6.5" r="5" stroke="#e2e8f0" strokeWidth="1.5"/>
        <line x1="4" y1="6.5" x2="9" y2="6.5" stroke="#e2e8f0" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="#e2e8f0" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>

      {/* track */}
      <div
        ref={trackRef}
        onMouseDown={(e) => { isDragging.current = true; document.body.style.cursor = "ew-resize"; applyPosition(e.clientX); }}
        style={{ position: "relative", width: 80, height: 20, display: "flex", alignItems: "center", cursor: "ew-resize", flexShrink: 0 }}
      >
        {/* bg track */}
        <div style={{ position: "absolute", inset: "0 0 0 0", margin: "auto", height: 2, borderRadius: 2, background: "rgba(255,255,255,0.1)" }} />
        {/* fill */}
        <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", height: 2, width: `${pct * 100}%`, borderRadius: 2, background: "rgba(255,255,255,0.55)", transition: isDragging.current ? undefined : "width 0.05s" }} />
        {/* thumb */}
        <div style={{
          position: "absolute",
          left: `calc(${pct * 100}% - 7px)`,
          top: "50%", transform: "translateY(-50%)",
          width: 14, height: 14, borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(0,0,0,0.2)",
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
        <circle cx="6.5" cy="6.5" r="5" stroke="#e2e8f0" strokeWidth="1.5"/>
        <line x1="4" y1="6.5" x2="9" y2="6.5" stroke="#e2e8f0" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="6.5" y1="4" x2="6.5" y2="9" stroke="#e2e8f0" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="#e2e8f0" strokeWidth="1.5" strokeLinecap="round"/>
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
function DatePickerField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        colorScheme: "dark",
        height: 32,
        width: "100%",
        borderRadius: 6,
        border: "1px solid rgb(51 65 85)",
        backgroundColor: "rgb(15 23 42)",
        color: value ? "#f1f5f9" : "#64748b",
        fontSize: 12,
        padding: "0 10px",
        outline: "none",
        boxSizing: "border-box",
      } as React.CSSProperties}
    />
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
}: {
  block: Block;
  onClose: () => void;
  onSave: (updated: Block) => void;
  allBlocks: Block[];
  onDeleteAll: (ids: number[]) => Promise<void>;
  onSaveAll: (ids: number[], payload: Record<string, unknown>) => Promise<void>;
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

  // Číselníky
  const [dataOpts, setDataOpts]         = useState<CodebookOption[]>([]);
  const [materialOpts, setMaterialOpts] = useState<CodebookOption[]>([]);
  const [barvyOpts, setBarvyOpts]       = useState<CodebookOption[]>([]);
  const [lakOpts, setLakOpts]           = useState<CodebookOption[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/codebook?category=DATA").then((r) => r.json()),
      fetch("/api/codebook?category=MATERIAL").then((r) => r.json()),
      fetch("/api/codebook?category=BARVY").then((r) => r.json()),
      fetch("/api/codebook?category=LAK").then((r) => r.json()),
    ]).then(([d, m, b, l]) => {
      setDataOpts(d);
      setMaterialOpts(m);
      setBarvyOpts(b);
      setLakOpts(l);
    });
  }, []);

  function resolveLabel(opts: CodebookOption[], id: string): string | null {
    return opts.find((o) => o.id.toString() === id)?.label ?? null;
  }

  const pendingSavePayload = useRef<Record<string, unknown> | null>(null);

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
    } catch {
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
  const SECTION = "fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#9ba8c0'";
  void SECTION;

  function SectionLabel({ children }: { children: React.ReactNode }) {
    return <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0", marginBottom: 8 }}>{children}</div>;
  }

  function ColLabel({ children }: { children: React.ReactNode }) {
    return <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#9ba8c0", marginBottom: 5 }}>{children}</div>;
  }

  function StatusSelect({ value, onChange, opts, placeholder }: {
    value: string;
    onChange: (v: string) => void;
    opts: CodebookOption[];
    placeholder: string;
  }) {
    return (
      <div style={{ position: "relative" }}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            appearance: "none", width: "100%", height: 40,
            background: "#181b22", border: "1px solid #1e2130", borderRadius: 10,
            color: value ? "#e8eaf0" : "#64748b", fontSize: 13, fontWeight: 600,
            padding: "0 40px 0 14px", cursor: "pointer", outline: "none",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "#3a5a9a")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "#1e2130")}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#1e2232")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#181b22")}
        >
          <option value="">— {placeholder} —</option>
          {opts.map((o) => (
            <option key={o.id} value={o.id.toString()}>
              {o.isWarning ? "⚠ " : ""}{o.label}
            </option>
          ))}
        </select>
        <svg viewBox="0 0 20 20" fill="none" stroke="#6b7280" strokeWidth="1.8"
          style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, pointerEvents: "none" }}>
          <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid rgb(30 41 59)" }}>
      {/* Hlavička */}
      <div style={{ padding: "10px 16px", background: "linear-gradient(135deg, #1a1d25 0%, #111318 100%)", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0" }}>Upravit záznam</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
            {block.orderNumber}
            {isInSeries && (
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#3b82f6", background: "rgba(59,130,246,0.14)", borderRadius: 4, padding: "1px 5px" }}>↻ Série</span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-xs text-slate-400">
          ← Zpět
        </Button>
      </div>

      {/* Obsah */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 16px 16px" }}>

        {error && (
          <div style={{ margin: "12px 0 0", borderRadius: 6, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", padding: "8px 12px", fontSize: 11, color: "#fca5a5" }}>
            {error}
          </div>
        )}

        {/* Typ */}
        <div style={{ marginTop: 14 }}>
          <SectionLabel>Typ záznamu</SectionLabel>
          <div style={{ display: "flex", gap: 6 }}>
            {(Object.entries(TYPE_BUILDER_CONFIG) as [string, typeof TYPE_BUILDER_CONFIG[keyof typeof TYPE_BUILDER_CONFIG]][]).map(([key, cfg]) => (
              <button key={key} type="button" onClick={() => setType(key)} style={{ flex: 1, padding: "7px 4px", borderRadius: 7, border: type === key ? `1px solid ${cfg.color}` : "1px solid rgba(255,255,255,0.08)", background: type === key ? `${cfg.color}22` : "rgba(255,255,255,0.02)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <span style={{ fontSize: 14 }}>{cfg.emoji}</span>
                <span style={{ fontSize: 9, fontWeight: 600, color: type === key ? cfg.color : "#9ba8c0", textAlign: "center" }}>{cfg.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Číslo zakázky + Popis — side by side */}
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block" }}>
              {type === "UDRZBA" ? "Název / označení" : "Číslo zakázky"} *
            </Label>
            <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} className="h-8 text-xs" />
          </div>
          <div>
            <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block" }}>Popis</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="text-xs resize-none" />
          </div>
        </div>

        {/* Délka tisku */}
        <div style={{ marginTop: 8 }}>
          <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block" }}>Délka tisku</Label>
          <div style={{ position: "relative" }}>
            <select
              value={String(durationHours)}
              onChange={(e) => setDurationHours(Number(e.target.value))}
              style={{
                appearance: "none", width: "100%", height: 32,
                background: "#181b22", border: "1px solid #1e2130", borderRadius: 10,
                color: "#e8eaf0", fontSize: 12, fontWeight: 600,
                padding: "0 32px 0 12px", cursor: "pointer", outline: "none",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#3a5a9a")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#1e2130")}
            >
              {DURATION_OPTIONS.map((opt) => (
                <option key={opt.hours} value={String(opt.hours)}>{opt.label}</option>
              ))}
            </select>
            <svg viewBox="0 0 20 20" fill="none" stroke="#6b7280" strokeWidth="1.8"
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
              <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {/* ── Výrobní sloupečky ── */}
        {type !== "UDRZBA" && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <SectionLabel>Výrobní sloupečky</SectionLabel>

            {/* Řádek 1: Datumy — DATA | MATERIÁL | EXPEDICE */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              <div>
                <ColLabel>DATA datum</ColLabel>
                <DatePickerField value={dataRequiredDate} onChange={setDataRequiredDate} placeholder="Datum dodání…" />
              </div>
              <div>
                <ColLabel>MATERIÁL datum</ColLabel>
                <DatePickerField value={materialRequiredDate} onChange={setMaterialRequiredDate} placeholder="Datum dodání…" />
              </div>
              <div>
                <ColLabel>EXPEDICE</ColLabel>
                <DatePickerField value={deadlineExpedice} onChange={setDeadlineExpedice} placeholder="Datum…" />
              </div>
            </div>

            {/* Řádek 2: Poznámky — DATA | MATERIÁL | BARVY | LAK */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 6 }}>
              {/* DATA */}
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <StatusSelect value={dataStatusId} onChange={setDataStatusId} opts={dataOpts} placeholder="DATA" />
                <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: dataOk ? "#4ade80" : "#9ba8c0", cursor: "pointer" }}>
                  <input type="checkbox" checked={dataOk} onChange={(e) => setDataOk(e.target.checked)} style={{ accentColor: "#4ade80" }} />
                  OK
                </label>
              </div>
              {/* MATERIÁL */}
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <StatusSelect value={materialStatusId} onChange={setMaterialStatusId} opts={materialOpts} placeholder="MAT." />
                <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: materialOk ? "#4ade80" : "#9ba8c0", cursor: "pointer" }}>
                  <input type="checkbox" checked={materialOk} onChange={(e) => setMaterialOk(e.target.checked)} style={{ accentColor: "#4ade80" }} />
                  OK
                </label>
              </div>
              {/* BARVY */}
              <StatusSelect value={barvyStatusId} onChange={setBarvyStatusId} opts={barvyOpts} placeholder="BARVY" />
              {/* LAK */}
              <StatusSelect value={lakStatusId} onChange={setLakStatusId} opts={lakOpts} placeholder="LAK" />
            </div>

            {/* SPECIFIKACE */}
            <div style={{ marginTop: 8 }}>
              <SectionLabel>Specifikace</SectionLabel>
              <Textarea value={specifikace} onChange={(e) => setSpecifikace(e.target.value)} rows={2} placeholder="Speciální požadavky…" className="text-xs resize-none" />
            </div>
          </div>
        )}

        {/* Zamčeno */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          <Switch checked={locked} onCheckedChange={setLocked} />
          <Label style={{ fontSize: 11, color: locked ? "#FFE600" : "#64748b", cursor: "pointer" }}>
            🔒 Zamčený blok
          </Label>
        </div>

        {/* Série — inline dialog */}
        {seriesConfirm ? (
          <div style={{ marginTop: 16, borderRadius: 8, border: "1px solid rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.08)", padding: "12px 14px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#93c5fd", marginBottom: 8 }}>
              {seriesConfirm === "save" ? "Uložit změny pro…" : "Smazat…"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button
                onClick={async () => {
                  if (seriesConfirm === "save" && pendingSavePayload.current) {
                    await doSave(pendingSavePayload.current);
                  } else if (seriesConfirm === "delete") {
                    await onDeleteAll([block.id]);
                    onClose();
                  }
                  setSeriesConfirm(null);
                }}
                style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.35)", borderRadius: 7, color: "#93c5fd", fontSize: 11, fontWeight: 600, padding: "7px 12px", cursor: "pointer", textAlign: "left" }}
              >
                Jen tuto instanci
              </button>
              <button
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
                style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.35)", borderRadius: 7, color: "#93c5fd", fontSize: 11, fontWeight: 600, padding: "7px 12px", cursor: "pointer", textAlign: "left" }}
              >
                {seriesConfirm === "delete"
                  ? `Tuto a následující (${getFollowingSeriesIds().length} bloků)`
                  : `Celou sérii (${getSeriesIds().length} bloků)`}
              </button>
              <button
                onClick={() => setSeriesConfirm(null)}
                style={{ background: "none", border: "none", color: "#64748b", fontSize: 11, padding: "4px 0", cursor: "pointer", textAlign: "left" }}
              >
                Zrušit
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Tlačítka */}
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <Button type="button" onClick={handleSave} disabled={saving} className="flex-1 bg-[#FFE600] text-[#111318] hover:bg-[#FFE600]/90 font-bold text-xs">
                {saving ? "Ukládám…" : "Uložit změny →"}
              </Button>
              <Button type="button" variant="ghost" onClick={onClose} className="text-slate-400 text-xs">
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
              style={{ marginTop: 8, width: "100%", background: "none", border: "none", color: "#475569", fontSize: 11, padding: "6px 0", cursor: "pointer", textAlign: "center", transition: "color 0.1s" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#f87171")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#475569")}
            >
              Smazat blok
            </button>
          </>
        )}

        {/* Barva náhledu */}
        <div style={{ marginTop: 12, borderRadius: 6, padding: "8px 10px", background: `${typeCfg?.color ?? "#334155"}14`, borderLeft: `3px solid ${typeCfg?.color ?? "#475569"}`, fontSize: 11, color: typeCfg?.color ?? "#64748b" }}>
          {typeCfg?.emoji} {typeCfg?.label}
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
  const typeCfg = TYPE_BUILDER_CONFIG[block.type as keyof typeof TYPE_BUILDER_CONFIG];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid rgb(30 41 59)" }}>
      {/* Hlavička */}
      <div className="px-4 py-3 border-b border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Detail bloku
          </div>
          <div className="mt-0.5 text-sm font-bold text-slate-100">{block.orderNumber}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-xs text-slate-400">
          ← Zpět
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
              style={{ fontSize: 10, background: `${typeCfg?.color ?? "#475569"}22`, color: typeCfg?.color ?? "#94a3b8", border: `1px solid ${typeCfg?.color ?? "#475569"}44` }}
            >
              {typeCfg?.emoji} {TYPE_LABELS[block.type] ?? block.type}
            </Badge>
          </div>
          <Row label="Začátek" value={formatDateTime(block.startTime)} />
          <Row label="Konec"   value={formatDateTime(block.endTime)} />
          <Row label="Délka"   value={durationHuman(block.startTime, block.endTime)} />
          {block.locked && <Row label="Stav" value="🔒 Zamčeno" />}
        </div>

        {block.description && (
          <>
            <Separator className="my-1 bg-slate-800" />
            <div className="rounded-md bg-slate-800/40 border border-slate-700/50 px-3 py-2">
              <div className="text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">Popis</div>
              <div className="text-slate-300 leading-relaxed">{block.description}</div>
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

// ─── ShutdownManager ──────────────────────────────────────────────────────────
function ShutdownManager({
  companyDays,
  onAdd,
  onDelete,
  onClose,
}: {
  companyDays: CompanyDay[];
  onAdd: (startDate: string, endDate: string, label: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onClose: () => void;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate]     = useState("");
  const [label, setLabel]         = useState("");
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState<number | null>(null);
  const [error, setError]         = useState<string | null>(null);

  async function handleAdd() {
    if (!startDate || !endDate || !label.trim()) { setError("Vyplňte všechna pole."); return; }
    if (endDate < startDate) { setError("Konec musí být po začátku."); return; }
    setSaving(true); setError(null);
    try {
      await onAdd(startDate, endDate, label.trim());
      setStartDate(""); setEndDate(""); setLabel("");
    } catch { setError("Chyba při ukládání."); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: number) {
    setDeleting(id);
    try { await onDelete(id); }
    catch { setError("Chyba při mazání."); }
    finally { setDeleting(null); }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid rgb(30 41 59)" }}>
      <div style={{ padding: "10px 16px", background: "linear-gradient(135deg, #1a1d25 0%, #111318 100%)", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0" }}>Firemní dny</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", marginTop: 2 }}>Odstávky a svátky</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-xs text-slate-400">← Zpět</Button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px" }}>
        {error && (
          <div style={{ marginBottom: 12, borderRadius: 6, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", padding: "8px 12px", fontSize: 11, color: "#fca5a5" }}>{error}</div>
        )}

        {/* Formulář */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0" }}>Přidat odstávku</div>
          <div>
            <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 4, display: "block" }}>Název</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Velikonoce, dovolená…" className="h-8 text-xs" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 4, display: "block" }}>Od</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 4, display: "block" }}>Do</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-8 text-xs" />
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
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0", marginBottom: 4 }}>
            Uložené ({companyDays.length})
          </div>
          {companyDays.length === 0 && (
            <div style={{ fontSize: 11, color: "#475569", textAlign: "center", padding: "12px 0" }}>Žádné záznamy</div>
          )}
          {companyDays.map((cd) => (
            <div key={cd.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#c4b5fd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cd.label}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                  {new Date(cd.startDate).toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric" })}
                  {cd.startDate.slice(0, 10) !== cd.endDate.slice(0, 10) && (
                    <> – {new Date(cd.endDate).toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric" })}</>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(cd.id)}
                disabled={deleting === cd.id}
                style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "#475569", fontSize: 16, padding: "0 4px", lineHeight: 1 }}
              >
                {deleting === cd.id ? "…" : "×"}
              </button>
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
        backgroundColor: hovered ? "rgb(59 130 246 / 0.4)" : "rgb(30 41 59)",
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

// ─── PlannerPage ──────────────────────────────────────────────────────────────
export default function PlannerPage({ initialBlocks, initialCompanyDays }: { initialBlocks: Block[]; initialCompanyDays: CompanyDay[] }) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [companyDays, setCompanyDays] = useState<CompanyDay[]>(initialCompanyDays);
  const [showShutdowns, setShowShutdowns] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Queue
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueIdRef = useRef(0);
  const [draggingQueueItem, setDraggingQueueItem] = useState<QueueItem | null>(null);

  // Timeline state
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [editingBlock, setEditingBlock]   = useState<Block | null>(null);
  const [copiedBlock, setCopiedBlock] = useState<Block | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<number>>(new Set());
  const [isCut, setIsCut] = useState(false);
  const [pasteTarget, setPasteTarget] = useState<{ machine: string; time: Date } | null>(null);
  const copiedBlockRef = useRef<Block | null>(null);
  const isCutRef = useRef(false);
  const pasteTargetRef = useRef<{ machine: string; time: Date } | null>(null);
  copiedBlockRef.current = copiedBlock;
  isCutRef.current = isCut;
  pasteTargetRef.current = pasteTarget;
  const [filterText, setFilterText] = useState("");
  const [jumpDate, setJumpDate]     = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

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
    }).catch(() => {/* číselník se nepodařilo načíst */});
  }, []);

  const viewStart = startOfDay(addDays(new Date(), -3));

  function handleScrollToNow() {
    const y = dateToY(new Date(), viewStart, slotHeight);
    scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
  }

  function handleJumpToDate(dateStr: string) {
    if (!dateStr) return;
    const d = new Date(dateStr + "T00:00:00");
    const y = dateToY(d, viewStart, slotHeight);
    scrollRef.current?.scrollTo({ top: Math.max(0, y - 100), behavior: "smooth" });
  }

  function handleBlockUpdate(updated: Block) {
    setBlocks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    setSelectedBlock((sel) => (sel?.id === updated.id ? updated : sel));
  }

  async function handleMultiBlockUpdate(updates: { id: number; startTime: Date; endTime: Date; machine: string }[]) {
    try {
      const results = await Promise.all(
        updates.map((u) =>
          fetch(`/api/blocks/${u.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startTime: u.startTime.toISOString(), endTime: u.endTime.toISOString(), machine: u.machine }),
          }).then((r) => r.json() as Promise<Block>)
        )
      );
      setBlocks((prev) => prev.map((b) => results.find((r) => r.id === b.id) ?? b));
    } catch { /* tiché selhání */ }
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
    } catch {
      setError("Chyba při mazání bloku.");
    }
  }

  async function handleDeleteAll(ids: number[]) {
    try {
      await Promise.all(ids.map((id) => fetch(`/api/blocks/${id}`, { method: "DELETE" })));
      setBlocks((prev) => prev.filter((b) => !ids.includes(b.id)));
      if (ids.includes(editingBlock?.id ?? -1)) setEditingBlock(null);
      if (ids.includes(selectedBlock?.id ?? -1)) setSelectedBlock(null);
    } catch {
      setError("Chyba při mazání série.");
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
    } catch {
      setError("Chyba při ukládání série.");
    }
  }

  async function handleAddCompanyDay(startDate: string, endDate: string, label: string) {
    const res = await fetch("/api/company-days", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, label }),
    });
    if (!res.ok) throw new Error("Chyba serveru");
    const created: CompanyDay = await res.json();
    setCompanyDays((prev) => [...prev, created].sort((a, b) => a.startDate.localeCompare(b.startDate)));
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

  async function handleQueueDrop(itemId: number, machine: string, startTime: Date) {
    const item = queue.find((q) => q.id === itemId);
    if (!item) return;
    const durationMs = item.durationHours * 60 * 60 * 1000;
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
      if (!res1.ok) throw new Error("Chyba serveru");
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
    } catch {
      setError("Chyba při vytváření bloku.");
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
    const newStart = target.time;
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
    } catch {
      setError("Chyba při vložení bloku.");
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
      if ((e.key === "Delete" || e.key === "Backspace") && selectedBlock) {
        e.preventDefault();
        handleDeleteBlock(selectedBlock.id);
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
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
    <main style={{ height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }} className="bg-slate-950 text-slate-100">
      {/* ── Header ── */}
      <header className="flex-shrink-0 border-b border-slate-800 bg-slate-900/80 backdrop-blur px-4 py-2 flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center font-black text-white">I</div>
          <div>
            <div className="text-xs font-semibold tracking-wide text-slate-100">INTEGRAF</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Výrobní plán</div>
          </div>
        </div>

        <div className="flex items-center gap-2 ml-4 flex-1">
          <Input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Hledat zakázku…"
            className="h-8 text-xs w-40 border-slate-700 bg-slate-800 placeholder:text-slate-600 focus-visible:border-yellow-400/50"
          />
          <Input
            type="date"
            value={jumpDate}
            onChange={(e) => { setJumpDate(e.target.value); handleJumpToDate(e.target.value); }}
            className="h-8 text-xs border-slate-700 bg-slate-800 focus-visible:border-yellow-400/50 w-auto"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleScrollToNow}
            className="h-8 text-xs border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
          >
            Dnes
          </Button>
          <ZoomSlider value={slotHeight} onChange={handleZoomChange} />
        </div>

        <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
          <Button
            variant={showShutdowns ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setShowShutdowns((s) => !s)}
            className="h-8 text-xs border-slate-700"
          >
            📅 Odstávky
          </Button>
          <span className="uppercase tracking-[0.18em]">Etapa 4</span>
          <span>{blocks.length} bloků</span>
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
            onMultiSelect={setSelectedBlockIds}
            onMultiBlockUpdate={handleMultiBlockUpdate}
          />
        </div>

        {/* Resize handle */}
        <ResizeHandle onMouseDown={() => {
          isResizing.current = true;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }} />

        {/* PRAVÁ ČÁST – detail nebo builder */}
        <aside style={{ width: asideWidth, flexShrink: 0, position: "relative", zIndex: 10, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {showShutdowns ? (
            <ShutdownManager
              companyDays={companyDays}
              onAdd={handleAddCompanyDay}
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
            />
          ) : selectedBlock ? (
            <BlockDetail block={selectedBlock} onClose={() => setSelectedBlock(null)} onDelete={handleDeleteBlock} />
          ) : (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "#111318", borderLeft: "1px solid rgba(255,255,255,0.06)" }}>

              {/* ── Builder Header ── */}
              <div style={{ padding: "12px 16px", background: "linear-gradient(135deg, #1a1d25 0%, #111318 100%)", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #e53e3e 0%, #dd6b20 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#fff", fontSize: 15, flexShrink: 0 }}>
                    J
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.2 }}>Job Builder</div>
                    <div style={{ fontSize: 9, color: "#9ba8c0", letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 2 }}>Integraf</div>
                  </div>
                </div>
              </div>

              {/* ── Formulář ── */}
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "0 16px", flex: 1 }}>

                  {/* Chybová hláška */}
                  {error && (
                    <div style={{ margin: "12px 0 0", borderRadius: 6, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", padding: "8px 12px", fontSize: 11, color: "#fca5a5" }}>
                      {error}
                      <button onClick={() => setError(null)} style={{ float: "right", background: "none", border: "none", color: "#fca5a5", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
                    </div>
                  )}

                  {/* ── Typ záznamu ── */}
                  <div style={{ paddingTop: 16, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0", marginBottom: 10 }}>
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
                            border: type === key ? `1px solid ${cfg.color}` : "1px solid rgba(255,255,255,0.08)",
                            background: type === key ? `${cfg.color}22` : "rgba(255,255,255,0.02)",
                            cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                            transition: "all 0.15s",
                          }}
                        >
                          <span style={{ fontSize: 16, lineHeight: 1 }}>{cfg.emoji}</span>
                          <span style={{ fontSize: 9, fontWeight: 600, color: type === key ? cfg.color : "#9ba8c0", letterSpacing: "0.04em", lineHeight: 1.3, textAlign: "center" }}>
                            {cfg.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Zakázka ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0" }}>
                      {type === "UDRZBA" ? "Popis" : "Zakázka"}
                    </div>

                    {/* Číslo zakázky + Délka tisku */}
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                      <div style={{ flex: "0 0 130px" }}>
                        <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block" }}>
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
                        <label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block", fontWeight: 500 }}>Délka tisku</label>
                        <div style={{ position: "relative" }}>
                          <select
                            value={String(durationHours)}
                            onChange={(e) => setDurationHours(Number(e.target.value))}
                            style={{
                              appearance: "none",
                              width: "100%",
                              height: 32,
                              background: "#181b22",
                              border: "1px solid #1e2130",
                              borderRadius: 10,
                              color: "#e8eaf0",
                              fontSize: 13,
                              fontWeight: 600,
                              padding: "0 36px 0 14px",
                              cursor: "pointer",
                              outline: "none",
                            }}
                            onFocus={(e) => (e.currentTarget.style.borderColor = "#3a5a9a")}
                            onBlur={(e) => (e.currentTarget.style.borderColor = "#1e2130")}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#1e2232")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "#181b22")}
                          >
                            {DURATION_OPTIONS.map((opt) => (
                              <option key={opt.hours} value={String(opt.hours)}>{opt.label}</option>
                            ))}
                          </select>
                          <svg
                            viewBox="0 0 20 20"
                            fill="none"
                            stroke="#6b7280"
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
                      <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block" }}>Popis</Label>
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
                    <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0" }}>Výrobní sloupečky</div>
                      {/* DATA — datum + dropdown v jednom řádku */}
                      <div>
                        <label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block", fontWeight: 500 }}>Data</label>
                        <div style={{ display: "flex", gap: 6 }}>
                          <input
                            type="date"
                            value={bDataRequiredDate}
                            onChange={(e) => setBDataRequiredDate(e.target.value)}
                            style={{
                              flex: "0 0 130px", height: 32, background: "#181b22",
                              border: "1px solid #1e2130", borderRadius: 10, color: bDataRequiredDate ? "#e8eaf0" : "#64748b",
                              fontSize: 12, padding: "0 10px", outline: "none", colorScheme: "dark",
                            }}
                            onFocus={(e) => (e.currentTarget.style.borderColor = "#3a5a9a")}
                            onBlur={(e) => (e.currentTarget.style.borderColor = "#1e2130")}
                          />
                          <div style={{ position: "relative", flex: 1 }}>
                            <select
                              value={bDataStatusId}
                              onChange={(e) => setBDataStatusId(e.target.value)}
                              style={{
                                appearance: "none", width: "100%", height: 32,
                                background: "#181b22", border: "1px solid #1e2130", borderRadius: 10,
                                color: bDataStatusId ? "#e8eaf0" : "#64748b", fontSize: 12, fontWeight: 600,
                                padding: "0 32px 0 12px", cursor: "pointer", outline: "none",
                              }}
                              onFocus={(e) => (e.currentTarget.style.borderColor = "#3a5a9a")}
                              onBlur={(e) => (e.currentTarget.style.borderColor = "#1e2130")}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "#1e2232")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "#181b22")}
                            >
                              <option value="">— info —</option>
                              {bDataOpts.map((o) => (
                                <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                              ))}
                            </select>
                            <svg viewBox="0 0 20 20" fill="none" stroke="#6b7280" strokeWidth="1.8"
                              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
                              <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        </div>
                      </div>

                      {/* Materiál — datum + dropdown v jednom řádku */}
                      <div>
                        <label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block", fontWeight: 500 }}>Materiál</label>
                        <div style={{ display: "flex", gap: 6 }}>
                          <input
                            type="date"
                            value={bMaterialRequiredDate}
                            onChange={(e) => setBMaterialRequiredDate(e.target.value)}
                            style={{
                              flex: "0 0 130px", height: 32, background: "#181b22",
                              border: "1px solid #1e2130", borderRadius: 10, color: bMaterialRequiredDate ? "#e8eaf0" : "#64748b",
                              fontSize: 12, padding: "0 10px", outline: "none", colorScheme: "dark",
                            }}
                            onFocus={(e) => (e.currentTarget.style.borderColor = "#3a5a9a")}
                            onBlur={(e) => (e.currentTarget.style.borderColor = "#1e2130")}
                          />
                          <div style={{ position: "relative", flex: 1 }}>
                            <select
                              value={bMaterialStatusId}
                              onChange={(e) => setBMaterialStatusId(e.target.value)}
                              style={{
                                appearance: "none", width: "100%", height: 32,
                                background: "#181b22", border: "1px solid #1e2130", borderRadius: 10,
                                color: bMaterialStatusId ? "#e8eaf0" : "#64748b", fontSize: 12, fontWeight: 600,
                                padding: "0 32px 0 12px", cursor: "pointer", outline: "none",
                              }}
                              onFocus={(e) => (e.currentTarget.style.borderColor = "#3a5a9a")}
                              onBlur={(e) => (e.currentTarget.style.borderColor = "#1e2130")}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "#1e2232")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "#181b22")}
                            >
                              <option value="">— info —</option>
                              {bMaterialOpts.map((o) => (
                                <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                              ))}
                            </select>
                            <svg viewBox="0 0 20 20" fill="none" stroke="#6b7280" strokeWidth="1.8"
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
                            <label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block", fontWeight: 500 }}>{label}</label>
                            <div style={{ position: "relative" }}>
                              <select
                                value={value}
                                onChange={(e) => setter(e.target.value)}
                                style={{
                                  appearance: "none", width: "100%", height: 32,
                                  background: "#181b22", border: "1px solid #1e2130", borderRadius: 10,
                                  color: value ? "#e8eaf0" : "#64748b", fontSize: 12, fontWeight: 600,
                                  padding: "0 32px 0 12px", cursor: "pointer", outline: "none",
                                }}
                                onFocus={(e) => (e.currentTarget.style.borderColor = "#3a5a9a")}
                                onBlur={(e) => (e.currentTarget.style.borderColor = "#1e2130")}
                                onMouseEnter={(e) => (e.currentTarget.style.background = "#1e2232")}
                                onMouseLeave={(e) => (e.currentTarget.style.background = "#181b22")}
                              >
                                <option value="">— nezadáno —</option>
                                {opts.map((o) => (
                                  <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                                ))}
                              </select>
                              <svg viewBox="0 0 20 20" fill="none" stroke="#6b7280" strokeWidth="1.8"
                                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
                                <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div>
                        <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block" }}>Specifikace</Label>
                        <Input value={bSpecifikace} onChange={(e) => setBSpecifikace(e.target.value)} placeholder="Volný text…" className="h-8 text-xs" />
                      </div>
                      <div>
                        <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block" }}>Termín expedice</Label>
                        <DatePickerField value={bDeadlineExpedice} onChange={setBDeadlineExpedice} placeholder="Datum expedice…" />
                      </div>
                    </div>
                  )}

                  {/* ── Opakování ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0", marginBottom: 10 }}>Opakování</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block", fontWeight: 500 }}>Interval</label>
                        <div style={{ position: "relative" }}>
                          <select
                            value={bRecurrenceType}
                            onChange={(e) => setBRecurrenceType(e.target.value)}
                            style={{
                              appearance: "none", width: "100%", height: 32,
                              background: "#181b22", border: "1px solid #1e2130", borderRadius: 10,
                              color: bRecurrenceType !== "NONE" ? "#3b82f6" : "#e8eaf0", fontSize: 12, fontWeight: 600,
                              padding: "0 32px 0 12px", cursor: "pointer", outline: "none",
                            }}
                            onFocus={(e) => (e.currentTarget.style.borderColor = "#3a5a9a")}
                            onBlur={(e) => (e.currentTarget.style.borderColor = "#1e2130")}
                          >
                            <option value="NONE">— bez opakování —</option>
                            <option value="DAILY">↻ Každý den</option>
                            <option value="WEEKLY">↻ Každý týden</option>
                            <option value="MONTHLY">↻ Každý měsíc</option>
                          </select>
                          <svg viewBox="0 0 20 20" fill="none" stroke="#6b7280" strokeWidth="1.8"
                            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
                            <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      </div>
                      {bRecurrenceType !== "NONE" && (
                        <div style={{ flex: "0 0 90px" }}>
                          <label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block", fontWeight: 500 }}>Počet bloků</label>
                          <input
                            type="number"
                            min={2}
                            max={52}
                            value={bRecurrenceCount}
                            onChange={(e) => setBRecurrenceCount(Math.max(2, Math.min(52, parseInt(e.target.value) || 2)))}
                            style={{
                              width: "100%", height: 32, background: "#181b22",
                              border: "1px solid #3b82f6", borderRadius: 10,
                              color: "#3b82f6", fontSize: 13, fontWeight: 700,
                              padding: "0 10px", outline: "none", textAlign: "center",
                            }}
                          />
                        </div>
                      )}
                    </div>
                    {bRecurrenceType !== "NONE" && (
                      <div style={{ fontSize: 10, color: "#3b82f6", marginTop: 6, opacity: 0.8 }}>
                        Vytvoří se {bRecurrenceCount} bloků · interval: {bRecurrenceType === "DAILY" ? "1 den" : bRecurrenceType === "WEEKLY" ? "7 dní" : "1 měsíc"}
                      </div>
                    )}
                  </div>

                  {/* ── Live náhled ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0", marginBottom: 8 }}>Náhled bloku</div>
                    <div style={{
                      borderRadius: 6, padding: "9px 11px",
                      background: `${typeConfig?.color ?? "#334155"}18`,
                      borderLeft: `3px solid ${typeConfig?.color ?? "#475569"}`,
                      border: `1px solid ${typeConfig?.color ?? "#475569"}33`,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.2 }}>
                        {orderNumber || <span style={{ color: "#475569", fontWeight: 400 }}>—</span>}
                      </div>
                      {description && (
                        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3, lineHeight: 1.4 }}>{description}</div>
                      )}
                      <div style={{ fontSize: 10, color: typeConfig?.color ?? "#64748b", marginTop: 5 }}>
                        {typeConfig?.emoji} {typeConfig?.label} · {formatDuration(durationHours)}
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
                    <div style={{ fontSize: 9, color: "#475569", textAlign: "center", marginTop: 6 }}>
                      Přetáhni kartu z fronty na timeline → stroj a čas
                    </div>
                  </div>
                </div>

                {/* ── Fronta ── */}
                {queue.length > 0 && (
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "#0d1017", padding: "12px 16px 16px", flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0" }}>Fronta</div>
                      <div style={{ minWidth: 18, height: 18, borderRadius: 9, background: "#FFE600", color: "#111318", fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
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
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = "copy";
                              e.dataTransfer.setData("text/plain", String(item.id));
                              setDraggingQueueItem(item);
                            }}
                            onDragEnd={() => setDraggingQueueItem(null)}
                            style={{
                              display: "flex", alignItems: "stretch",
                              background: "rgba(255,255,255,0.03)",
                              borderRadius: 6,
                              border: "1px solid rgba(255,255,255,0.07)",
                              overflow: "hidden",
                              cursor: "grab",
                            }}
                          >
                            {/* Barevný pruh vlevo */}
                            <div style={{ width: 3, background: itemCfg?.color ?? "#64748b", flexShrink: 0 }} />
                            {/* Obsah */}
                            <div style={{ flex: 1, padding: "7px 9px", minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: "#f1f5f9" }}>{item.orderNumber}</div>
                              <div style={{ fontSize: 10, color: "#9ba8c0", marginTop: 2 }}>
                                {itemCfg?.emoji} {itemCfg?.label} · {formatDuration(item.durationHours)}
                              </div>
                              {item.description && (
                                <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {item.description}
                                </div>
                              )}
                            </div>
                            {/* Smazat */}
                            <button
                              type="button"
                              onClick={() => setQueue((prev) => prev.filter((q) => q.id !== item.id))}
                              style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "#475569", fontSize: 16, padding: "0 10px", display: "flex", alignItems: "center", lineHeight: 1 }}
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
        </aside>
      </section>
    </main>
  );
}
