"use client";

import { useEffect, useRef, useState } from "react";
import TimelineGrid, { dateToY, type Block, type CompanyDay } from "./TimelineGrid";
import { Input }     from "@/components/ui/input";
import { Textarea }  from "@/components/ui/textarea";
import { Label }     from "@/components/ui/label";
import { Button }    from "@/components/ui/button";
import { Switch }    from "@/components/ui/switch";
import { Badge }     from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  materialStatusId: number | null;
  materialStatusLabel: string | null;
  barvyStatusId: number | null;
  barvyStatusLabel: string | null;
  lakStatusId: number | null;
  lakStatusLabel: string | null;
  specifikace: string;
  deadlineExpedice: string;
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

// ─── BlockEdit ────────────────────────────────────────────────────────────────
function BlockEdit({
  block,
  onClose,
  onSave,
}: {
  block: Block;
  onClose: () => void;
  onSave: (updated: Block) => void;
}) {
  const [orderNumber, setOrderNumber] = useState(block.orderNumber);
  const [type, setType]               = useState(block.type);
  const [description, setDescription] = useState(block.description ?? "");
  const [locked, setLocked]           = useState(block.locked);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);

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
  const [pantoneExpectedDate, setPantoneExpectedDate] = useState(
    block.pantoneExpectedDate ? new Date(block.pantoneExpectedDate).toISOString().slice(0, 10) : ""
  );

  // BARVY
  const [barvyStatusId, setBarvyStatusId] = useState<string>(block.barvyStatusId?.toString() ?? "");

  // LAK
  const [lakStatusId, setLakStatusId] = useState<string>(block.lakStatusId?.toString() ?? "");

  // SPECIFIKACE
  const [specifikace, setSpecifikace] = useState(block.specifikace ?? "");

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

  async function handleSave() {
    if (!orderNumber.trim()) { setError("Vyplňte číslo zakázky."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/blocks/${block.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
          pantoneExpectedDate: pantoneExpectedDate || null,
          barvyStatusId: barvyStatusId ? parseInt(barvyStatusId) : null,
          barvyStatusLabel: barvyStatusId ? resolveLabel(barvyOpts, barvyStatusId) : null,
          lakStatusId: lakStatusId ? parseInt(lakStatusId) : null,
          lakStatusLabel: lakStatusId ? resolveLabel(lakOpts, lakStatusId) : null,
          specifikace: specifikace.trim() || null,
        }),
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

  const typeCfg = TYPE_BUILDER_CONFIG[type as keyof typeof TYPE_BUILDER_CONFIG];
  const SECTION = "fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#9ba8c0'";
  void SECTION;

  function SectionLabel({ children }: { children: React.ReactNode }) {
    return <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0", marginBottom: 8 }}>{children}</div>;
  }

  function StatusSelect({ value, onChange, opts, placeholder }: {
    value: string;
    onChange: (v: string) => void;
    opts: CodebookOption[];
    placeholder: string;
  }) {
    return (
      <Select value={value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
        <SelectTrigger className="h-8 text-xs w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__" className="text-xs text-slate-400">— nezadáno —</SelectItem>
          {opts.map((o) => (
            <SelectItem key={o.id} value={o.id.toString()} className="text-xs">
              {o.isWarning ? "⚠ " : ""}{o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid rgb(30 41 59)" }}>
      {/* Hlavička */}
      <div style={{ padding: "10px 16px", background: "linear-gradient(135deg, #1a1d25 0%, #111318 100%)", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0" }}>Upravit záznam</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", marginTop: 2 }}>{block.orderNumber}</div>
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

        {/* Info (read-only) */}
        <div style={{ marginTop: 14, padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", fontSize: 10, color: "#64748b", display: "flex", gap: 16 }}>
          <span>{block.machine.replace("_", "\u00a0")}</span>
          <span>{new Date(block.startTime).toLocaleString("cs-CZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} – {new Date(block.endTime).toLocaleString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>

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

        {/* Číslo zakázky */}
        <div style={{ marginTop: 12 }}>
          <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block" }}>
            {type === "UDRZBA" ? "Název / označení" : "Číslo zakázky"} *
          </Label>
          <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} className="h-8 text-xs" />
        </div>

        {/* Popis */}
        <div style={{ marginTop: 10 }}>
          <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block" }}>Popis</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="text-xs resize-none" />
        </div>

        {/* ── Výrobní sloupečky ── */}
        {type !== "UDRZBA" && (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <SectionLabel>Výrobní sloupečky</SectionLabel>

            {/* DATA */}
            <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 6, padding: "10px", border: "1px solid rgba(255,255,255,0.05)" }}>
              <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 6, display: "block" }}>DATA</Label>
              <StatusSelect value={dataStatusId} onChange={setDataStatusId} opts={dataOpts} placeholder="Status dat…" />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <div style={{ flex: 1 }}>
                  <Label style={{ fontSize: 9, color: "#64748b", marginBottom: 3, display: "block" }}>Datum (nepovinný)</Label>
                  <Input type="date" value={dataRequiredDate} onChange={(e) => setDataRequiredDate(e.target.value)} className="h-7 text-xs" />
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: dataOk ? "#4ade80" : "#9ba8c0", cursor: "pointer", marginTop: 16, flexShrink: 0 }}>
                  <input type="checkbox" checked={dataOk} onChange={(e) => setDataOk(e.target.checked)} style={{ accentColor: "#4ade80" }} />
                  OK
                </label>
              </div>
            </div>

            {/* MATERIÁL */}
            <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 6, padding: "10px", border: "1px solid rgba(255,255,255,0.05)" }}>
              <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 6, display: "block" }}>MATERIÁL</Label>
              <StatusSelect value={materialStatusId} onChange={setMaterialStatusId} opts={materialOpts} placeholder="Status materiálu…" />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <div style={{ flex: 1 }}>
                  <Label style={{ fontSize: 9, color: "#64748b", marginBottom: 3, display: "block" }}>Datum (nepovinný)</Label>
                  <Input type="date" value={materialRequiredDate} onChange={(e) => setMaterialRequiredDate(e.target.value)} className="h-7 text-xs" />
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: materialOk ? "#4ade80" : "#9ba8c0", cursor: "pointer", marginTop: 16, flexShrink: 0 }}>
                  <input type="checkbox" checked={materialOk} onChange={(e) => setMaterialOk(e.target.checked)} style={{ accentColor: "#4ade80" }} />
                  OK
                </label>
              </div>
              <div style={{ marginTop: 6 }}>
                <Label style={{ fontSize: 9, color: "#64748b", marginBottom: 3, display: "block" }}>Pantone — očekávané dodání</Label>
                <Input type="date" value={pantoneExpectedDate} onChange={(e) => setPantoneExpectedDate(e.target.value)} className="h-7 text-xs" />
              </div>
            </div>

            {/* BARVY */}
            <div>
              <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 6, display: "block" }}>BARVY</Label>
              <StatusSelect value={barvyStatusId} onChange={setBarvyStatusId} opts={barvyOpts} placeholder="Typ barev…" />
            </div>

            {/* LAK */}
            <div>
              <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 6, display: "block" }}>LAK</Label>
              <StatusSelect value={lakStatusId} onChange={setLakStatusId} opts={lakOpts} placeholder="Typ laku…" />
            </div>

            {/* SPECIFIKACE */}
            <div>
              <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block" }}>SPECIFIKACE</Label>
              <Textarea value={specifikace} onChange={(e) => setSpecifikace(e.target.value)} rows={2} placeholder="Speciální požadavky…" className="text-xs resize-none" />
            </div>

            {/* Expedice */}
            <div>
              <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 4, display: "block" }}>Termín expedice</Label>
              <Input type="date" value={deadlineExpedice} onChange={(e) => setDeadlineExpedice(e.target.value)} className="h-8 text-xs" />
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

        {/* Tlačítka */}
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <Button type="button" onClick={handleSave} disabled={saving} className="flex-1 bg-[#FFE600] text-[#111318] hover:bg-[#FFE600]/90 font-bold text-xs">
            {saving ? "Ukládám…" : "Uložit změny →"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} className="text-slate-400 text-xs">
            Zrušit
          </Button>
        </div>

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
  const [bMaterialStatusId, setBMaterialStatusId] = useState<string>("");
  const [bBarvyStatusId, setBBarvyStatusId]       = useState<string>("");
  const [bLakStatusId, setBLakStatusId]           = useState<string>("");
  const [bSpecifikace, setBSpecifikace]           = useState("");

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
  const [filterText, setFilterText] = useState("");
  const [jumpDate, setJumpDate]     = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const viewStart = startOfDay(addDays(new Date(), -3));

  function handleScrollToNow() {
    const y = dateToY(new Date(), viewStart);
    scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
  }

  function handleJumpToDate(dateStr: string) {
    if (!dateStr) return;
    const d = new Date(dateStr + "T00:00:00");
    const y = dateToY(d, viewStart);
    scrollRef.current?.scrollTo({ top: Math.max(0, y - 100), behavior: "smooth" });
  }

  function handleBlockUpdate(updated: Block) {
    setBlocks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    setSelectedBlock((sel) => (sel?.id === updated.id ? updated : sel));
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
    setQueue((prev) => [
      ...prev,
      {
        id: ++queueIdRef.current,
        orderNumber: orderNumber.trim(),
        type,
        durationHours,
        description: description.trim(),
        deadlineData,
        deadlineMaterial,
        deadlineExpedice,
      },
    ]);
    setOrderNumber("");
    setDescription("");
    setDeadlineData("");
    setDeadlineMaterial("");
    setDeadlineExpedice("");
  }

  async function handleQueueDrop(itemId: number, machine: string, startTime: Date) {
    const item = queue.find((q) => q.id === itemId);
    if (!item) return;
    const endTime = new Date(startTime.getTime() + item.durationHours * 60 * 60 * 1000);
    try {
      const res = await fetch("/api/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber: item.orderNumber,
          machine,
          type: item.type,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          description: item.description || null,
          deadlineData: item.deadlineData || null,
          deadlineMaterial: item.deadlineMaterial || null,
          deadlineExpedice: item.deadlineExpedice || null,
        }),
      });
      if (!res.ok) throw new Error("Chyba serveru");
      const newBlock: Block = await res.json();
      handleBlockCreate(newBlock);
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
            onBlockClick={setSelectedBlock}
            onBlockUpdate={handleBlockUpdate}
            onBlockCreate={handleBlockCreate}
            scrollRef={scrollRef}
            queueDragItem={draggingQueueItem}
            onQueueDrop={handleQueueDrop}
            onBlockDoubleClick={handleBlockDoubleClick}
            companyDays={companyDays}
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

                    {/* Číslo zakázky */}
                    <div>
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

                    {/* Délka tisku */}
                    <div>
                      <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block" }}>Délka tisku</Label>
                      <select
                        value={durationHours}
                        onChange={(e) => setDurationHours(Number(e.target.value))}
                        className="h-8 w-full rounded-md border border-input bg-transparent px-3 text-xs text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        {DURATION_OPTIONS.map((opt) => (
                          <option key={opt.hours} value={opt.hours}>{opt.label}</option>
                        ))}
                      </select>
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

                  {/* ── Termíny (skryté pro Údržbu) ── */}
                  {type !== "UDRZBA" && (
                    <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0" }}>Termíny</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div>
                          <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block" }}>DATA</Label>
                          <Input type="date" value={deadlineData} onChange={(e) => setDeadlineData(e.target.value)} className="h-8 text-xs" />
                        </div>
                        <div>
                          <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block" }}>Materiál</Label>
                          <Input type="date" value={deadlineMaterial} onChange={(e) => setDeadlineMaterial(e.target.value)} className="h-8 text-xs" />
                        </div>
                      </div>
                      <div>
                        <Label style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5, display: "block" }}>Expedice</Label>
                        <Input type="date" value={deadlineExpedice} onChange={(e) => setDeadlineExpedice(e.target.value)} className="h-8 text-xs" />
                      </div>
                    </div>
                  )}

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
