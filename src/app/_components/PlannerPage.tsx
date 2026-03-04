"use client";

import { useEffect, useRef, useState } from "react";
import TimelineGrid, { dateToY, type Block } from "./TimelineGrid";

// ─── Typy ─────────────────────────────────────────────────────────────────────
type QueueItem = {
  id: number;
  orderNumber: string;
  type: string;
  machine: string;
  durationHours: number;
  description: string;
};

// ─── Konstanty ────────────────────────────────────────────────────────────────
const TYPE_LABELS: Record<string, string> = {
  ZAKAZKA: "Zakázka",
  REZERVACE: "Rezervace",
  UDRZBA: "Údržba",
};

const TYPE_BUILDER_CONFIG = {
  ZAKAZKA: { emoji: "📋", label: "Zakázka", color: "#1a6bcc" },
  REZERVACE: { emoji: "📌", label: "Rezervace", color: "#7c3aed" },
  UDRZBA: { emoji: "🔧", label: "Údržba / Oprava", color: "#c0392b" },
} as const;

// 0:30 … 24:00 v 30minutových krocích
const DURATION_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const totalMinutes = (i + 1) * 30;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return { label: `${h}:${m.toString().padStart(2, "0")}`, hours: totalMinutes / 60 };
});

// ─── Styly ────────────────────────────────────────────────────────────────────
const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  padding: "7px 10px",
  fontSize: 11,
  color: "#e2e8f0",
  outline: "none",
  boxSizing: "border-box",
};

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
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
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
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200 transition-colors px-3 py-1.5 rounded-md border border-slate-700 hover:bg-slate-800 hover:border-slate-600"
        >
          <span>←</span>
          <span>Zpět</span>
        </button>
      </div>

      {/* Obsah */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} className="px-4 py-4 space-y-3 text-[11px]">
        {/* Základní info */}
        <div className="space-y-1.5">
          <Row label="Stroj" value={block.machine.replace("_", "\u00a0")} />
          <Row label="Typ" value={TYPE_LABELS[block.type] ?? block.type} />
          <Row label="Začátek" value={formatDateTime(block.startTime)} />
          <Row label="Konec" value={formatDateTime(block.endTime)} />
          <Row label="Délka" value={durationHuman(block.startTime, block.endTime)} />
          {block.locked && <Row label="Stav" value="🔒 Zamčeno" />}
        </div>

        {/* Popis */}
        {block.description && (
          <div className="rounded-md bg-slate-800/40 border border-slate-700/50 px-3 py-2">
            <div className="text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">
              Popis
            </div>
            <div className="text-slate-300 leading-relaxed">{block.description}</div>
          </div>
        )}

        {/* Termíny */}
        <div className="rounded-md bg-slate-800/40 border border-slate-700/50 px-3 py-2 space-y-1.5">
          <div className="text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">
            Termíny
          </div>
          <DeadlineRow
            label="DATA"
            value={formatDate(block.deadlineData)}
            ok={block.deadlineDataOk}
          />
          <DeadlineRow
            label="Materiál"
            value={formatDate(block.deadlineMaterial)}
            ok={block.deadlineMaterialOk}
          />
          <DeadlineRow
            label="Expedice"
            value={formatDate(block.deadlineExpedice)}
            ok={false}
          />
        </div>
      </div>

      {/* Smazat */}
      <div className="px-4 py-3 border-t border-slate-800">
        {confirming ? (
          <div className="space-y-2">
            <p className="text-[10px] text-slate-400 text-center">Opravdu smazat blok?</p>
            <div className="flex gap-2">
              <button
                onClick={() => onDelete(block.id)}
                className="flex-1 rounded-md bg-red-500/30 border border-red-500/50 text-red-300 text-[11px] font-semibold py-1.5 hover:bg-red-500/40 transition-colors"
              >
                Smazat
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 text-[11px] py-1.5 hover:bg-slate-700 transition-colors"
              >
                Zrušit
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="w-full rounded-md bg-slate-800 border border-slate-700 text-slate-400 hover:text-red-300 hover:border-red-500/50 text-[11px] py-1.5 transition-colors"
          >
            Smazat blok
          </button>
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

function DeadlineRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] text-slate-500 w-16 flex-shrink-0">{label}</span>
      <span className={value === "—" ? "text-slate-600" : ok ? "text-green-400" : "text-slate-300"}>
        {value}
        {ok && value !== "—" && <span className="ml-1 text-green-500">✓</span>}
      </span>
    </div>
  );
}

// ─── ResizeHandle ─────────────────────────────────────────────────────────────
function ResizeHandle({ onMouseDown }: { onMouseDown: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 8,
        flexShrink: 0,
        position: "relative",
        zIndex: 20,
        cursor: "col-resize",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: hovered ? "rgb(59 130 246 / 0.4)" : "rgb(30 41 59)",
        transition: "background-color 0.15s",
      }}
    >
      {hovered && (
        <div style={{ color: "rgb(148 163 184)", fontSize: 10, lineHeight: 1, userSelect: "none", pointerEvents: "none", display: "flex", gap: 1 }}>
          <span>⇐</span>
          <span>⇒</span>
        </div>
      )}
    </div>
  );
}

// ─── PlannerPage ──────────────────────────────────────────────────────────────
export default function PlannerPage({ initialBlocks }: { initialBlocks: Block[] }) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Builder form fields
  const [orderNumber, setOrderNumber] = useState("");
  const [machine, setMachine] = useState("XL_105");
  const [type, setType] = useState("ZAKAZKA");
  const [durationHours, setDurationHours] = useState(1);
  const [startDatetime, setStartDatetime] = useState("");
  const [description, setDescription] = useState("");
  const [deadlineData, setDeadlineData] = useState("");
  const [deadlineMaterial, setDeadlineMaterial] = useState("");
  const [deadlineExpedice, setDeadlineExpedice] = useState("");

  // Queue
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueIdRef = useRef(0);

  // Timeline state
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [filterText, setFilterText] = useState("");
  const [jumpDate, setJumpDate] = useState("");
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

  function handleAddToQueue() {
    if (!orderNumber.trim()) return;
    setQueue((prev) => [
      ...prev,
      {
        id: ++queueIdRef.current,
        orderNumber: orderNumber.trim(),
        type,
        machine,
        durationHours,
        description: description.trim(),
      },
    ]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!orderNumber.trim()) {
      setError("Vyplňte číslo zakázky.");
      return;
    }
    if (!startDatetime) {
      setError("Vyplňte datum a čas začátku.");
      return;
    }

    const startTime = new Date(startDatetime);
    const endTime = new Date(startTime.getTime() + durationHours * 60 * 60 * 1000);

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber: orderNumber.trim(),
          machine,
          type,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          description: description.trim() || null,
          deadlineData: deadlineData || null,
          deadlineMaterial: deadlineMaterial || null,
          deadlineExpedice: deadlineExpedice || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Neznámá chyba");
      }

      const newBlock: Block = await response.json();
      setBlocks((prev) =>
        [...prev, newBlock].sort(
          (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        )
      );

      const y = dateToY(new Date(newBlock.startTime), viewStart);
      scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });

      setSuccessMsg(`Blok ${newBlock.orderNumber} uložen.`);
      setOrderNumber("");
      setDescription("");
      setStartDatetime("");
      setDeadlineData("");
      setDeadlineMaterial("");
      setDeadlineExpedice("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chyba při ukládání bloku");
    } finally {
      setIsSubmitting(false);
    }
  }

  const typeConfig = TYPE_BUILDER_CONFIG[type as keyof typeof TYPE_BUILDER_CONFIG];

  return (
    <main style={{ height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }} className="bg-slate-950 text-slate-100">
      {/* ── Header ── */}
      <header className="flex-shrink-0 border-b border-slate-800 bg-slate-900/80 backdrop-blur px-4 py-2 flex items-center gap-4">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center font-black text-white">
            I
          </div>
          <div>
            <div className="text-xs font-semibold tracking-wide text-slate-100">INTEGRAF</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
              Výrobní plán
            </div>
          </div>
        </div>

        {/* Filtrační lišta */}
        <div className="flex items-center gap-2 ml-4 flex-1">
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Hledat zakázku…"
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-yellow-400/50 w-40"
          />
          <input
            type="date"
            value={jumpDate}
            onChange={(e) => {
              setJumpDate(e.target.value);
              handleJumpToDate(e.target.value);
            }}
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-yellow-400/50"
          />
          <button
            onClick={handleScrollToNow}
            className="rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-[11px] text-slate-300 transition-colors"
          >
            Dnes
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
          <span className="uppercase tracking-[0.18em]">Etapa 3</span>
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
          {selectedBlock ? (
            <BlockDetail
              block={selectedBlock}
              onClose={() => setSelectedBlock(null)}
              onDelete={handleDeleteBlock}
            />
          ) : (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "#111318", borderLeft: "1px solid rgba(255,255,255,0.06)" }}>

              {/* ── Builder Header ── */}
              <div style={{
                padding: "12px 16px",
                background: "linear-gradient(135deg, #1a1d25 0%, #111318 100%)",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                flexShrink: 0,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: "linear-gradient(135deg, #e53e3e 0%, #dd6b20 100%)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 900, color: "#fff", fontSize: 15, flexShrink: 0,
                  }}>
                    J
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.2 }}>Job Builder</div>
                    <div style={{ fontSize: 9, color: "#9ba8c0", letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 2 }}>Integraf</div>
                  </div>
                </div>
              </div>

              {/* ── Formulář ── */}
              <form
                onSubmit={handleSubmit}
                style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}
              >
                <div style={{ padding: "0 16px", flex: 1 }}>

                  {/* Chybové hlášky */}
                  {error && (
                    <div style={{ margin: "12px 0 0", borderRadius: 6, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", padding: "8px 12px", fontSize: 11, color: "#fca5a5" }}>
                      {error}
                    </div>
                  )}
                  {successMsg && (
                    <div style={{ margin: "12px 0 0", borderRadius: 6, background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)", padding: "8px 12px", fontSize: 11, color: "#86efac" }}>
                      {successMsg}
                    </div>
                  )}

                  {/* ── Sekce: Typ záznamu ── */}
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
                            flex: 1,
                            padding: "8px 4px",
                            borderRadius: 7,
                            border: type === key ? `1px solid ${cfg.color}` : "1px solid rgba(255,255,255,0.08)",
                            background: type === key ? `${cfg.color}22` : "rgba(255,255,255,0.02)",
                            cursor: "pointer",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 4,
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

                  {/* ── Sekce: Zakázka ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0" }}>
                      {type === "UDRZBA" ? "Popis" : "Zakázka"}
                    </div>

                    {/* Číslo zakázky */}
                    <div>
                      <div style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5 }}>
                        {type === "UDRZBA" ? "Název / označení" : "Číslo zakázky"} *
                      </div>
                      <input
                        value={orderNumber}
                        onChange={(e) => setOrderNumber(e.target.value)}
                        placeholder={type === "UDRZBA" ? "Čištění hlavy…" : "17001"}
                        style={INPUT_STYLE}
                      />
                    </div>

                    {/* Stroj + Délka tisku */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5 }}>Stroj</div>
                        <select
                          value={machine}
                          onChange={(e) => setMachine(e.target.value)}
                          style={INPUT_STYLE}
                        >
                          <option value="XL_105">XL 105</option>
                          <option value="XL_106">XL 106</option>
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5 }}>Délka tisku</div>
                        <select
                          value={durationHours}
                          onChange={(e) => setDurationHours(Number(e.target.value))}
                          style={INPUT_STYLE}
                        >
                          {DURATION_OPTIONS.map((opt) => (
                            <option key={opt.hours} value={opt.hours}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Datum a čas začátku */}
                    <div>
                      <div style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5 }}>Datum a čas začátku *</div>
                      <input
                        type="datetime-local"
                        value={startDatetime}
                        onChange={(e) => setStartDatetime(e.target.value)}
                        style={INPUT_STYLE}
                      />
                    </div>

                    {/* Popis */}
                    <div>
                      <div style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5 }}>Popis</div>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={2}
                        placeholder="Firma – produkt – počet tisků…"
                        style={{ ...INPUT_STYLE, resize: "none" }}
                      />
                    </div>
                  </div>

                  {/* ── Sekce: Termíny (skryté pro Údržbu) ── */}
                  {type !== "UDRZBA" && (
                    <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0" }}>
                        Termíny
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5 }}>DATA</div>
                          <input
                            type="date"
                            value={deadlineData}
                            onChange={(e) => setDeadlineData(e.target.value)}
                            style={INPUT_STYLE}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5 }}>Materiál</div>
                          <input
                            type="date"
                            value={deadlineMaterial}
                            onChange={(e) => setDeadlineMaterial(e.target.value)}
                            style={INPUT_STYLE}
                          />
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: "#9ba8c0", marginBottom: 5 }}>Expedice</div>
                        <input
                          type="date"
                          value={deadlineExpedice}
                          onChange={(e) => setDeadlineExpedice(e.target.value)}
                          style={INPUT_STYLE}
                        />
                      </div>
                    </div>
                  )}

                  {/* ── Live náhled ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0", marginBottom: 8 }}>
                      Náhled bloku
                    </div>
                    <div style={{
                      borderRadius: 6,
                      padding: "9px 11px",
                      background: `${typeConfig?.color ?? "#334155"}18`,
                      borderLeft: `3px solid ${typeConfig?.color ?? "#475569"}`,
                      border: `1px solid ${typeConfig?.color ?? "#475569"}33`,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.2 }}>
                        {orderNumber || <span style={{ color: "#475569", fontWeight: 400 }}>—</span>}
                      </div>
                      {description && (
                        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3, lineHeight: 1.4 }}>
                          {description}
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: typeConfig?.color ?? "#64748b", marginTop: 5 }}>
                        {typeConfig?.emoji} {typeConfig?.label} · {formatDuration(durationHours)}
                      </div>
                    </div>
                  </div>

                  {/* ── Akce ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                    {/* Přidat do fronty */}
                    <button
                      type="button"
                      onClick={handleAddToQueue}
                      disabled={!orderNumber.trim()}
                      style={{
                        width: "100%",
                        borderRadius: 7,
                        border: "1px solid rgba(255,230,0,0.35)",
                        background: "rgba(255,230,0,0.06)",
                        color: orderNumber.trim() ? "#FFE600" : "#64748b",
                        fontWeight: 600,
                        padding: "8px 0",
                        fontSize: 11,
                        cursor: orderNumber.trim() ? "pointer" : "not-allowed",
                        transition: "all 0.15s",
                        letterSpacing: "0.04em",
                      }}
                    >
                      ＋ Přidat do fronty
                    </button>

                    {/* Uložit blok */}
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      style={{
                        width: "100%",
                        borderRadius: 7,
                        border: "none",
                        background: isSubmitting ? "rgba(255,230,0,0.35)" : "#FFE600",
                        color: "#111318",
                        fontWeight: 700,
                        padding: "9px 0",
                        fontSize: 12,
                        cursor: isSubmitting ? "not-allowed" : "pointer",
                        transition: "all 0.15s",
                        letterSpacing: "0.03em",
                      }}
                    >
                      {isSubmitting ? "Ukládám…" : "Uložit blok →"}
                    </button>
                  </div>
                </div>

                {/* ── Fronta ── */}
                {queue.length > 0 && (
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "#0d1017", padding: "12px 16px 16px", flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ba8c0" }}>
                        Fronta
                      </div>
                      <div style={{
                        minWidth: 18, height: 18, borderRadius: 9,
                        background: "#FFE600", color: "#111318",
                        fontSize: 9, fontWeight: 800,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        padding: "0 5px",
                      }}>
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
                            style={{
                              display: "flex",
                              alignItems: "stretch",
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
                              <div style={{ fontSize: 12, fontWeight: 600, color: "#f1f5f9" }}>
                                {item.orderNumber}
                              </div>
                              <div style={{ fontSize: 10, color: "#9ba8c0", marginTop: 2 }}>
                                {itemCfg?.emoji} {item.machine.replace("_", "\u00a0")} · {formatDuration(item.durationHours)}
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
                              style={{
                                flexShrink: 0,
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                color: "#475569",
                                fontSize: 16,
                                padding: "0 10px",
                                display: "flex",
                                alignItems: "center",
                                lineHeight: 1,
                              }}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </form>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
