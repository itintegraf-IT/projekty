"use client";

import { useEffect, useState } from "react";

// ─── Konstanty ────────────────────────────────────────────────────────────────
const SLOT_HEIGHT = 24; // px na 30 min (1 hod = 48 px)
const TIME_COL_W = 64; // šířka sloupce s časy (px)
const VIEW_DAYS_BACK = 3;
const VIEW_DAYS_AHEAD = 30;
const TOTAL_DAYS = VIEW_DAYS_BACK + VIEW_DAYS_AHEAD + 1;
const TOTAL_SLOTS = TOTAL_DAYS * 48; // 48 slotů/den (každých 30 min)
const TOTAL_HEIGHT = TOTAL_SLOTS * SLOT_HEIGHT;
const WORK_START_H = 6; // pracovní hodiny začínají v 06:00
const WORK_END_H = 22; // pracovní hodiny končí v 22:00
const MACHINES = ["XL_105", "XL_106"] as const;

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

interface TimelineGridProps {
  blocks: Block[];
  filterText: string;
  selectedBlockId: number | null;
  onBlockClick: (block: Block) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

// ─── Barvy dle typu ────────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  ZAKAZKA: { bg: "bg-blue-500/25", border: "border-blue-500/50", text: "text-blue-200" },
  REZERVACE: { bg: "bg-purple-500/25", border: "border-purple-500/50", text: "text-purple-200" },
  UDRZBA: { bg: "bg-red-500/25", border: "border-red-500/50", text: "text-red-200" },
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

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function formatDateLabel(d: Date): string {
  const days = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
  const dayName = days[d.getDay()];
  return `${dayName} ${d.getDate()}.${d.getMonth() + 1}.`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ─── BlockCard ─────────────────────────────────────────────────────────────────
function BlockCard({
  block,
  top,
  height,
  dimmed,
  selected,
  onClick,
}: {
  block: Block;
  top: number;
  height: number;
  dimmed: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const colors = TYPE_COLORS[block.type] ?? DEFAULT_COLORS;
  const showTimes = height >= 44;
  const showDesc = height >= 72 && block.description;

  return (
    <div
      onClick={onClick}
      style={{
        position: "absolute",
        top,
        height: Math.max(height, 20),
        left: 3,
        right: 3,
      }}
      className={[
        "rounded border cursor-pointer select-none overflow-hidden transition-opacity",
        colors.bg,
        selected ? "border-yellow-400 ring-1 ring-yellow-400/50" : colors.border,
        dimmed ? "opacity-20" : "opacity-100 hover:brightness-110",
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
    </div>
  );
}

// ─── TimelineGrid ──────────────────────────────────────────────────────────────
export default function TimelineGrid({
  blocks,
  filterText,
  selectedBlockId,
  onBlockClick,
  scrollRef,
}: TimelineGridProps) {
  // Vše závislé na čase se inicializuje až na klientu (vyhnutí hydration mismatch)
  const [viewStart, setViewStart] = useState<Date | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const start = startOfDay(addDays(new Date(), -VIEW_DAYS_BACK));
    setViewStart(start);
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

  // Sticky header (renderuje se i na serveru — je stabilní, neobsahuje datum)
  const header = (
    <div className="sticky top-0 z-30 flex bg-slate-900 border-b border-slate-700 flex-shrink-0">
      <div
        style={{ width: TIME_COL_W, flexShrink: 0 }}
        className="py-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 border-r border-slate-700"
      >
        ČAS
      </div>
      {MACHINES.map((machine, idx) => (
        <div
          key={machine}
          className={`flex-1 py-2 px-3 text-xs font-bold text-slate-200 ${idx === 0 ? "border-r border-slate-700" : ""}`}
        >
          {machine.replace("_", "\u00a0")}
        </div>
      ))}
    </div>
  );

  // Před hydration renderujeme jen header (bez dat závislých na new Date())
  if (!viewStart) {
    return (
      <div className="flex flex-col h-full min-h-0">
        {header}
        <div className="flex-1" />
      </div>
    );
  }

  // Po hydration: plný render s daty
  const hourMarkers: { y: number; label: string }[] = [];
  const dayBoundaries: { y: number; label: string; isWeekend: boolean }[] = [];
  const nightOverlays: { top: number; height: number; key: string }[] = [];

  for (let di = 0; di < TOTAL_DAYS; di++) {
    const day = addDays(viewStart, di);
    const dayY = di * 48 * SLOT_HEIGHT;
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;

    dayBoundaries.push({ y: dayY, label: formatDateLabel(day), isWeekend });

    nightOverlays.push({
      top: dayY,
      height: WORK_START_H * 2 * SLOT_HEIGHT,
      key: `night-start-${di}`,
    });
    nightOverlays.push({
      top: dayY + WORK_END_H * 2 * SLOT_HEIGHT,
      height: (24 - WORK_END_H) * 2 * SLOT_HEIGHT,
      key: `night-end-${di}`,
    });

    for (let h = 0; h < 24; h++) {
      hourMarkers.push({
        y: dayY + h * 2 * SLOT_HEIGHT,
        label: formatHour(h),
      });
    }
  }

  const currentTimeY = now ? dateToY(now, viewStart) : null;
  const filter = filterText.trim().toLowerCase();

  return (
    <div className="flex flex-col h-full min-h-0">
      {header}

      {/* Scrollovatelné tělo */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        <div style={{ height: TOTAL_HEIGHT }} className="flex">

          {/* Sloupec s časy */}
          <div
            style={{ width: TIME_COL_W, flexShrink: 0 }}
            className="relative border-r border-slate-800"
          >
            {dayBoundaries.map((d) => (
              <div
                key={d.y}
                style={{ position: "absolute", top: d.y + 2, left: 0, right: 0 }}
                className={`px-1.5 text-[9px] font-semibold leading-tight ${d.isWeekend ? "text-slate-400" : "text-slate-500"}`}
              >
                {d.label}
              </div>
            ))}
            {hourMarkers.map((h) => (
              <div
                key={h.y}
                style={{ position: "absolute", top: h.y - 7, left: 0, right: 0 }}
                className="px-1.5 text-[9px] text-slate-600 leading-none"
              >
                {h.label}
              </div>
            ))}
          </div>

          {/* Strojové sloupce */}
          {MACHINES.map((machine, colIdx) => {
            const machineBlocks = blocks.filter((b) => b.machine === machine);

            return (
              <div
                key={machine}
                className={`flex-1 relative ${colIdx === 0 ? "border-r border-slate-800" : ""}`}
              >
                {/* Víkendové pozadí */}
                {dayBoundaries.map((d) =>
                  d.isWeekend ? (
                    <div
                      key={d.y}
                      style={{
                        position: "absolute",
                        top: d.y,
                        height: 48 * SLOT_HEIGHT,
                        left: 0,
                        right: 0,
                      }}
                      className="bg-slate-800/20"
                    />
                  ) : null
                )}

                {/* Noční overlay */}
                {nightOverlays.map((n) => (
                  <div
                    key={n.key}
                    style={{ position: "absolute", top: n.top, height: n.height, left: 0, right: 0 }}
                    className="bg-slate-900/40"
                  />
                ))}

                {/* Denní oddělovače */}
                {dayBoundaries.map((d) => (
                  <div
                    key={d.y}
                    style={{ position: "absolute", top: d.y, left: 0, right: 0, height: 1 }}
                    className="bg-slate-700/60"
                  />
                ))}

                {/* Hodinové čáry */}
                {hourMarkers.map((h) => (
                  <div
                    key={h.y}
                    style={{ position: "absolute", top: h.y, left: 0, right: 0, height: 1 }}
                    className="bg-slate-800/60"
                  />
                ))}

                {/* Půlhodinové čáry */}
                {hourMarkers.map((h) => (
                  <div
                    key={`half-${h.y}`}
                    style={{ position: "absolute", top: h.y + SLOT_HEIGHT, left: 0, right: 0, height: 1 }}
                    className="bg-slate-800/30"
                  />
                ))}

                {/* Aktuální čas (jen pokud je known) */}
                {currentTimeY !== null && (
                  <div
                    style={{ position: "absolute", top: currentTimeY, left: 0, right: 0, zIndex: 10 }}
                    className="border-t-2 border-red-500 pointer-events-none"
                  >
                    {colIdx === 0 && (
                      <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-red-500" />
                    )}
                  </div>
                )}

                {/* Bloky */}
                {machineBlocks.map((block) => {
                  const top = dateToY(new Date(block.startTime), viewStart);
                  const height =
                    dateToY(new Date(block.endTime), viewStart) - top;
                  const dimmed = filter !== "" && !block.orderNumber.toLowerCase().includes(filter);
                  const selected = block.id === selectedBlockId;

                  return (
                    <BlockCard
                      key={block.id}
                      block={block}
                      top={top}
                      height={height}
                      dimmed={dimmed}
                      selected={selected}
                      onClick={() => onBlockClick(block)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
