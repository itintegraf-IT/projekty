"use client";

import { useState } from "react";

type Block = {
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

const TYPE_LABELS: Record<string, string> = {
  ZAKAZKA: "Zakázka",
  REZERVACE: "Rezervace",
  UDRZBA: "Údržba",
};

const TYPE_COLORS: Record<string, string> = {
  ZAKAZKA: "bg-blue-500/20 border-blue-500/40 text-blue-300",
  REZERVACE: "bg-purple-500/20 border-purple-500/40 text-purple-300",
  UDRZBA: "bg-red-500/20 border-red-500/40 text-red-300",
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

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PlannerPage({ initialBlocks }: { initialBlocks: Block[] }) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [orderNumber, setOrderNumber] = useState("");
  const [machine, setMachine] = useState("XL_105");
  const [type, setType] = useState("ZAKAZKA");
  const [durationHours, setDurationHours] = useState(1);
  const [startDatetime, setStartDatetime] = useState("");
  const [description, setDescription] = useState("");
  const [deadlineData, setDeadlineData] = useState("");
  const [deadlineMaterial, setDeadlineMaterial] = useState("");
  const [deadlineExpedice, setDeadlineExpedice] = useState("");

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
    <main className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-4 py-3 flex items-center gap-4">
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
        <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-400">
          <span className="uppercase tracking-[0.18em]">Etapa 1</span>
          <span className="text-slate-500">Skeleton · {blocks.length} bloků</span>
        </div>
      </header>

      <section className="flex flex-1 min-h-0">
        {/* LEVÁ ČÁST – seznam bloků */}
        <div className="flex-1 border-r border-slate-800 bg-slate-950/60 flex flex-col min-w-0">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <div className="font-semibold tracking-wide uppercase">
              Timeline — {blocks.length} bloků
            </div>
            <div className="text-[10px] text-slate-600">Vizuální grid přijde v Etapě 2</div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {blocks.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-xs text-slate-500">
                  Žádné bloky. Vytvoř první blok pomocí formuláře vpravo.
                </p>
              </div>
            ) : (
              blocks.map((block) => (
                <div
                  key={block.id}
                  className={`rounded-md border px-3 py-2 text-[11px] ${TYPE_COLORS[block.type] ?? "bg-slate-800 border-slate-700 text-slate-300"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-100">{block.orderNumber}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-slate-800/60 text-slate-400">
                      {block.machine.replace("_", "\u00a0")}
                    </span>
                    <span className="text-[10px] opacity-70">
                      {TYPE_LABELS[block.type] ?? block.type}
                    </span>
                    {block.locked && (
                      <span className="text-[10px] text-yellow-400 ml-auto" title="Zamčeno">
                        🔒
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-slate-400 text-[10px]">
                    {formatDateTime(block.startTime)} → {formatDateTime(block.endTime)}
                  </div>
                  {block.description && (
                    <div className="mt-1 text-slate-500 text-[10px] truncate">
                      {block.description}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* PRAVÁ ČÁST – builder formulář */}
        <aside className="w-[320px] lg:w-[360px] bg-slate-950">
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
        </aside>
      </section>
    </main>
  );
}
