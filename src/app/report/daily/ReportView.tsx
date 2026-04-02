"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { addDaysToCivilDate, pragueToUTC } from "@/lib/dateUtils";

// ─── typy ───────────────────────────────────────────────────────────────────

interface Block {
  id: number;
  orderNumber: string;
  machine: string;
  startTime: string;
  endTime: string;
  type: string;
  description: string | null;
  specifikace: string | null;
  locked: boolean;
  deadlineExpedice: string | null;
}

// ─── konstanty ───────────────────────────────────────────────────────────────

const PRAGUE_TZ = "Europe/Prague";
const PRAGUE_TIME_FMT = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: PRAGUE_TZ,
  hour: "2-digit",
  minute: "2-digit",
});
const PRAGUE_REPORT_DATE_FMT = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: PRAGUE_TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const PRAGUE_PRINTED_AT_FMT = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: PRAGUE_TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const TYPE_LABELS: Record<string, string> = {
  ZAKAZKA:  "zakázka",
  REZERVACE: "rezervace",
  UDRZBA:   "údržba",
};

const TYPE_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  ZAKAZKA:  { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  REZERVACE: { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
  UDRZBA:   { bg: "#f3f4f6", color: "#374151", border: "#d1d5db" },
};

interface Shift {
  label: string;
  startH: number; // hodina začátku (v rámci dne nebo další den)
  endH: number;   // hodina konce
  nextDay?: boolean; // noční směna přesahuje půlnoc
}

const SHIFTS_105: Shift[] = [
  { label: "Ranní směna",      startH: 6,  endH: 14 },
  { label: "Odpolední směna",  startH: 14, endH: 22 },
];

const SHIFTS_106: Shift[] = [
  { label: "Ranní směna",      startH: 6,  endH: 14 },
  { label: "Odpolední směna",  startH: 14, endH: 22 },
  { label: "Noční směna",      startH: 22, endH: 30, nextDay: true }, // endH 30 = +1d 06:00
];

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  return PRAGUE_TIME_FMT.format(new Date(iso));
}

function fmtDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const hours = ms / 3_600_000;
  if (hours === Math.floor(hours)) return `${hours}h`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${m}min`;
}

function blockOverlapsShift(block: Block, shiftStart: Date, shiftEnd: Date): boolean {
  const bs = new Date(block.startTime).getTime();
  const be = new Date(block.endTime).getTime();
  return bs < shiftEnd.getTime() && be > shiftStart.getTime();
}

function getShiftBounds(dateStr: string, shift: Shift): { start: Date; end: Date } {
  const start = pragueToUTC(dateStr, shift.startH, 0);
  const endH = shift.nextDay ? shift.endH - 24 : shift.endH;
  const endDateStr = shift.nextDay ? addDaysToCivilDate(dateStr, 1) : dateStr;
  const end = pragueToUTC(endDateStr, endH, 0);
  return { start, end };
}

// ─── komponenta ──────────────────────────────────────────────────────────────

export default function ReportView() {
  const searchParams = useSearchParams();
  const dateParam = searchParams.get("date") ?? "";

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dateParam) {
      setError("Chybí parametr date.");
      setLoading(false);
      return;
    }
    fetch(`/api/report/daily?date=${dateParam}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Block[]) => {
        setBlocks(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [dateParam]);

  // Automatický tisk po načtení dat
  useEffect(() => {
    if (!loading && !error) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [loading, error]);

  if (loading) {
    return (
      <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", padding: 40, color: "#6b7280" }}>
        Načítám data…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", padding: 40, color: "#ef4444" }}>
        Chyba: {error}
      </div>
    );
  }

  // ── hlavička ──
  const reportDate = pragueToUTC(dateParam, 12, 0);
  const dateLabelRaw = PRAGUE_REPORT_DATE_FMT.format(reportDate);
  const dateLabel = dateLabelRaw.charAt(0).toUpperCase() + dateLabelRaw.slice(1);
  const printedAt = PRAGUE_PRINTED_AT_FMT.format(new Date());

  const xl105 = blocks.filter((b) => b.machine === "XL_105");
  const xl106 = blocks.filter((b) => b.machine === "XL_106");

  return (
    <>
      {/* ── CSS pro tisk ── */}
      <style>{`
        @page { size: A4 landscape; margin: 12mm 14mm; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        * { box-sizing: border-box; }
        body { margin: 0; background: #fff; }
      `}</style>

      <div style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Helvetica, Arial, sans-serif",
        fontSize: 11,
        color: "#111",
        background: "#fff",
        padding: "0 0 8px",
        minHeight: "100vh",
      }}>

        {/* ── Tlačítko tisknout (jen na obrazovce) ── */}
        <div className="no-print" style={{
          position: "fixed", top: 12, right: 16, zIndex: 100,
          display: "flex", gap: 8,
        }}>
          <button
            onClick={() => window.print()}
            style={{
              background: "#3b82f6", color: "#fff", border: "none",
              borderRadius: 8, padding: "7px 16px", fontSize: 13,
              fontWeight: 600, cursor: "pointer",
            }}
          >
            Tisknout / Uložit PDF
          </button>
          <button
            onClick={() => window.close()}
            style={{
              background: "#f3f4f6", color: "#374151", border: "none",
              borderRadius: 8, padding: "7px 14px", fontSize: 13,
              fontWeight: 500, cursor: "pointer",
            }}
          >
            Zavřít
          </button>
        </div>

        {/* ── Hlavička ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: "2px solid #111", paddingBottom: 10, marginBottom: 14,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/logo.png" alt="Integraf" style={{ height: 32, width: "auto", objectFit: "contain" }} />
          </div>

          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Výrobní plán</div>
            <div style={{ fontSize: 13, color: "#374151", marginTop: 1 }}>{dateLabel}</div>
          </div>

          <div style={{ textAlign: "right", fontSize: 9, color: "#9ca3af" }}>
            <div>Tisk: {printedAt}</div>
            <div style={{ marginTop: 2 }}>Celkem bloků: <strong style={{ color: "#111" }}>{blocks.length}</strong></div>
          </div>
        </div>

        {/* ── Dvě strojové sekce ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <MachineSection label="XL 105" blocks={xl105} shifts={SHIFTS_105} dateStr={dateParam} />
          <MachineSection label="XL 106" blocks={xl106} shifts={SHIFTS_106} dateStr={dateParam} />
        </div>
      </div>
    </>
  );
}

// ─── sekce stroje ─────────────────────────────────────────────────────────────

function MachineSection({
  label, blocks, shifts, dateStr,
}: {
  label: string;
  blocks: Block[];
  shifts: Shift[];
  dateStr: string;
}) {
  return (
    <div>
      {/* Název stroje */}
      <div style={{
        background: "#111", color: "#fff", borderRadius: "7px 7px 0 0",
        padding: "6px 12px", fontWeight: 700, fontSize: 13, letterSpacing: "0.04em",
      }}>
        {label}
      </div>

      <div style={{ border: "1px solid #e5e7eb", borderTop: "none", borderRadius: "0 0 7px 7px", overflow: "hidden" }}>
        {shifts.map((shift, si) => {
          const { start: shiftStart, end: shiftEnd } = getShiftBounds(dateStr, shift);
          const shiftBlocks = blocks.filter((b) => blockOverlapsShift(b, shiftStart, shiftEnd));

          return (
            <div key={si} style={{ borderBottom: si < shifts.length - 1 ? "1px solid #e5e7eb" : "none" }}>
              {/* Směna header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "#f9fafb", padding: "5px 10px",
                borderBottom: "1px solid #e5e7eb",
              }}>
                <span style={{ fontWeight: 600, fontSize: 10, color: "#374151", letterSpacing: "0.03em" }}>
                  {shift.label}
                </span>
                <span style={{ fontSize: 9, color: "#9ca3af" }}>
                  {String(shift.startH).padStart(2, "0")}:00 – {String(shift.nextDay ? shift.endH - 24 : shift.endH).padStart(2, "0")}:00
                  {shift.nextDay && " (+1d)"}
                </span>
              </div>

              {/* Bloky */}
              {shiftBlocks.length === 0 ? (
                <div style={{ padding: "6px 10px", fontSize: 9, color: "#9ca3af", fontStyle: "italic" }}>
                  žádné bloky
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <tbody>
                    {shiftBlocks.map((block, bi) => (
                      <BlockRow key={block.id} block={block} isEven={bi % 2 === 0} />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── řádek bloku ─────────────────────────────────────────────────────────────

function BlockRow({ block, isEven }: { block: Block; isEven: boolean }) {
  const typeStyle = TYPE_COLORS[block.type] ?? TYPE_COLORS.ZAKAZKA;

  return (
    <tr style={{ background: isEven ? "#fff" : "#fafafa" }}>
      {/* Čas */}
      <td style={{
        padding: "5px 8px 5px 10px", whiteSpace: "nowrap",
        color: "#374151", fontVariantNumeric: "tabular-nums", fontSize: 10,
        width: 90, borderBottom: "1px solid #f3f4f6",
      }}>
        {fmtTime(block.startTime)} – {fmtTime(block.endTime)}
      </td>

      {/* Délka */}
      <td style={{
        padding: "5px 6px", whiteSpace: "nowrap",
        color: "#6b7280", fontSize: 9,
        width: 44, borderBottom: "1px solid #f3f4f6",
      }}>
        {fmtDuration(block.startTime, block.endTime)}
      </td>

      {/* Číslo zakázky */}
      <td style={{
        padding: "5px 6px", fontWeight: 700, fontSize: 11,
        width: "auto", borderBottom: "1px solid #f3f4f6",
        maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {block.orderNumber}
      </td>

      {/* Typ badge */}
      <td style={{ padding: "5px 6px", width: 64, borderBottom: "1px solid #f3f4f6" }}>
        <span style={{
          display: "inline-block",
          background: typeStyle.bg, color: typeStyle.color,
          border: `1px solid ${typeStyle.border}`,
          borderRadius: 4, padding: "1px 5px",
          fontSize: 8, fontWeight: 600, whiteSpace: "nowrap", letterSpacing: "0.02em",
        }}>
          {TYPE_LABELS[block.type] ?? block.type}
        </span>
      </td>

      {/* Popis + specifikace */}
      <td style={{
        padding: "5px 10px 5px 6px", borderBottom: "1px solid #f3f4f6",
        color: "#374151", fontSize: 10, lineHeight: 1.4,
      }}>
        {block.description && (
          <span>{block.description}</span>
        )}
        {block.description && block.specifikace && (
          <span style={{ color: "#9ca3af", margin: "0 4px" }}>·</span>
        )}
        {block.specifikace && (
          <span style={{ color: "#6b7280", fontStyle: "italic", fontSize: 9 }}>
            {block.specifikace}
          </span>
        )}
      </td>
    </tr>
  );
}
