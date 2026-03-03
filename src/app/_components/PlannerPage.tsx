"use client";

import { useRef, useState } from "react";
import TimelineGrid, { dateToY, type Block } from "./TimelineGrid";

// ─── Konstanty ────────────────────────────────────────────────────────────────
const TYPE_LABELS: Record<string, string> = {
  ZAKAZKA: "Zakázka",
  REZERVACE: "Rezervace",
  UDRZBA: "Údržba",
};

const DURATION_OPTIONS = [
  { label: "0,5 hod", hours: 0.5 },
  { label: "1 hod", hours: 1 },
  { label: "1,5 hod", hours: 1.5 },
  { label: "2 hod", hours: 2 },
  { label: "2,5 hod", hours: 2.5 },
  { label: "3 hod", hours: 3 },
  { label: "4 hod", hours: 4 },
  { label: "5 hod", hours: 5 },
  { label: "6 hod", hours: 6 },
  { label: "8 hod", hours: 8 },
];

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
    <div className="h-full flex flex-col border-l border-slate-800">
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
          className="text-[11px] text-slate-400 hover:text-slate-200 transition-colors px-2 py-1 rounded hover:bg-slate-800"
        >
          ← Zpět
        </button>
      </div>

      {/* Obsah */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 text-[11px]">
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

  // Timeline state
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [filterText, setFilterText] = useState("");
  const [jumpDate, setJumpDate] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

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

      // Scroll na datum nového bloku
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

  return (
    <main className="h-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
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
          <span className="uppercase tracking-[0.18em]">Etapa 2</span>
          <span>{blocks.length} bloků</span>
        </div>
      </header>

      {/* ── Tělo ── */}
      <section className="flex flex-1 min-h-0">
        {/* LEVÁ ČÁST – timeline grid */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <TimelineGrid
            blocks={blocks}
            filterText={filterText}
            selectedBlockId={selectedBlock?.id ?? null}
            onBlockClick={setSelectedBlock}
            scrollRef={scrollRef}
          />
        </div>

        {/* PRAVÁ ČÁST – detail nebo builder */}
        <aside className="w-[320px] lg:w-[360px] flex-shrink-0 bg-slate-950">
          {selectedBlock ? (
            <BlockDetail
              block={selectedBlock}
              onClose={() => setSelectedBlock(null)}
              onDelete={handleDeleteBlock}
            />
          ) : (
            <div className="h-full flex flex-col border-l border-slate-800">
              <div className="px-4 py-3 border-b border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Job builder
                </div>
                <div className="mt-1 text-[11px] text-slate-300">
                  Vytvoř nový blok → ulož do databáze → zobraz na timeline.
                </div>
              </div>

              <form
                onSubmit={handleSubmit}
                className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-[11px]"
              >
                {error && (
                  <div className="rounded-md bg-red-500/20 border border-red-500/40 px-3 py-2 text-red-300 text-[10px]">
                    {error}
                  </div>
                )}
                {successMsg && (
                  <div className="rounded-md bg-green-500/20 border border-green-500/40 px-3 py-2 text-green-300 text-[10px]">
                    {successMsg}
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-semibold tracking-wide text-slate-400 mb-1">
                    Číslo zakázky *
                  </label>
                  <input
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-yellow-400/50"
                    placeholder="17001"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold tracking-wide text-slate-400 mb-1">
                      Stroj
                    </label>
                    <select
                      value={machine}
                      onChange={(e) => setMachine(e.target.value)}
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-yellow-400/50"
                    >
                      <option value="XL_105">XL 105</option>
                      <option value="XL_106">XL 106</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold tracking-wide text-slate-400 mb-1">
                      Typ bloku
                    </label>
                    <select
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-yellow-400/50"
                    >
                      <option value="ZAKAZKA">Zakázka</option>
                      <option value="REZERVACE">Rezervace</option>
                      <option value="UDRZBA">Údržba</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold tracking-wide text-slate-400 mb-1">
                    Datum a čas začátku *
                  </label>
                  <input
                    type="datetime-local"
                    value={startDatetime}
                    onChange={(e) => setStartDatetime(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-yellow-400/50"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold tracking-wide text-slate-400 mb-1">
                    Délka (30 min sloty)
                  </label>
                  <select
                    value={durationHours}
                    onChange={(e) => setDurationHours(Number(e.target.value))}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-yellow-400/50"
                  >
                    {DURATION_OPTIONS.map((opt) => (
                      <option key={opt.hours} value={opt.hours}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold tracking-wide text-slate-400 mb-1">
                    Popis zakázky
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-600 resize-none focus:outline-none focus:border-yellow-400/50"
                    placeholder="Firma – produkt – počet tisků…"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold tracking-wide text-slate-400 mb-1">
                      DATA
                    </label>
                    <input
                      type="date"
                      value={deadlineData}
                      onChange={(e) => setDeadlineData(e.target.value)}
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-yellow-400/50"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold tracking-wide text-slate-400 mb-1">
                      Materiál
                    </label>
                    <input
                      type="date"
                      value={deadlineMaterial}
                      onChange={(e) => setDeadlineMaterial(e.target.value)}
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-yellow-400/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold tracking-wide text-slate-400 mb-1">
                    Expedice
                  </label>
                  <input
                    type="date"
                    value={deadlineExpedice}
                    onChange={(e) => setDeadlineExpedice(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-yellow-400/50"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full rounded-md bg-yellow-400 hover:bg-yellow-300 disabled:bg-yellow-400/40 text-black font-semibold py-2 text-[11px] transition-colors disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? "Ukládám…" : "Uložit blok"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
