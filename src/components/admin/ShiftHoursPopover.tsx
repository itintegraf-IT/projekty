"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SHIFT_LABELS, SHIFT_EDIT_RANGES, fmtHHMM, defaultShiftMin, type ShiftType } from "@/lib/shifts";

const FONT_STACK = "-apple-system, BlinkMacSystemFont, sans-serif";
const AMBER_BG = "#d97706";

function rangeOptions(range: readonly [number, number]): number[] {
  const out: number[] = [];
  for (let m = range[0]; m <= range[1]; m += 30) out.push(m);
  return out;
}

function defaultShiftBounds(shift: ShiftType): { startMin: number; endMin: number } {
  return { startMin: defaultShiftMin(shift, "start"), endMin: defaultShiftMin(shift, "end") };
}

export function ShiftHoursPopover({
  shift,
  anchor,
  currentStartMin,
  currentEndMin,
  onSave,
  onCancel,
}: {
  shift: ShiftType;
  anchor: DOMRect;
  currentStartMin: number | null;
  currentEndMin: number | null;
  onSave: (startMin: number | null, endMin: number | null) => void;
  onCancel: () => void;
}) {
  const def = defaultShiftBounds(shift);
  const [startMin, setStartMin] = useState<number>(currentStartMin ?? def.startMin);
  const [endMin, setEndMin] = useState<number>(currentEndMin ?? def.endMin);
  const [err, setErr] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const range = SHIFT_EDIT_RANGES[shift];
  const startOpts = useMemo(() => rangeOptions(range.start), [range]);
  const endOpts = useMemo(() => rangeOptions(range.end), [range]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onCancel]);

  const handleSave = () => {
    // Sanity: MORNING/AFTERNOON start < end. NIGHT cross midnight — skip.
    if (shift !== "NIGHT" && startMin >= endMin) {
      setErr("Začátek musí být před koncem.");
      return;
    }
    const finalStart = startMin === def.startMin ? null : startMin;
    const finalEnd = endMin === def.endMin ? null : endMin;
    onSave(finalStart, finalEnd);
  };

  const resetToDefault = () => {
    setStartMin(def.startMin);
    setEndMin(def.endMin);
    setErr(null);
  };

  // Position: prefer below, but clamp to viewport.
  const POP_WIDTH = 260;
  const POP_HEIGHT_APPROX = 200;
  let top = anchor.bottom + 4;
  let left = anchor.left;
  if (typeof window !== "undefined") {
    if (left + POP_WIDTH > window.innerWidth - 8) left = window.innerWidth - POP_WIDTH - 8;
    if (left < 8) left = 8;
    if (top + POP_HEIGHT_APPROX > window.innerHeight - 8) {
      top = Math.max(8, anchor.top - POP_HEIGHT_APPROX - 4);
    }
  }

  const selectStyle: React.CSSProperties = {
    background: "var(--surface-2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "5px 8px",
    fontSize: 13,
    fontFamily: FONT_STACK,
    cursor: "pointer",
    flex: 1,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 4,
  };

  return (
    <div
      ref={wrapperRef}
      style={{
        position: "fixed",
        top,
        left,
        width: POP_WIDTH,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
        padding: 12,
        zIndex: 1000,
        fontFamily: FONT_STACK,
        color: "var(--text)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{SHIFT_LABELS[shift]} — hodiny</div>
        <button
          type="button"
          onClick={resetToDefault}
          title="Nastavit výchozí"
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
            borderRadius: 6,
            fontSize: 11,
            padding: "2px 8px",
            cursor: "pointer",
            fontFamily: FONT_STACK,
          }}
        >
          Výchozí
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={labelStyle}>Začátek</div>
          <select
            value={startMin}
            onChange={(e) => { setStartMin(Number(e.target.value)); setErr(null); }}
            style={selectStyle}
          >
            {startOpts.map((m) => (
              <option key={m} value={m}>{fmtHHMM(m)}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div style={labelStyle}>Konec</div>
          <select
            value={endMin}
            onChange={(e) => { setEndMin(Number(e.target.value)); setErr(null); }}
            style={selectStyle}
          >
            {endOpts.map((m) => (
              <option key={m} value={m}>{fmtHHMM(m)}</option>
            ))}
          </select>
        </div>
      </div>

      {err && (
        <div style={{
          background: "color-mix(in oklab, var(--danger) 12%, transparent)",
          color: "var(--danger)",
          border: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)",
          borderRadius: 6,
          padding: "4px 8px",
          fontSize: 11,
          marginBottom: 8,
        }}>
          {err}
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
        Výchozí: {fmtHHMM(def.startMin)}–{fmtHHMM(def.endMin)}
        {shift === "NIGHT" && " (přes půlnoc)"}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: "var(--surface-2)",
            color: "var(--text-muted)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "5px 12px",
            fontSize: 12,
            cursor: "pointer",
            fontFamily: FONT_STACK,
          }}
        >
          Zrušit
        </button>
        <button
          type="button"
          onClick={handleSave}
          style={{
            background: AMBER_BG,
            color: "white",
            border: "none",
            borderRadius: 6,
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: FONT_STACK,
          }}
        >
          Uložit
        </button>
      </div>
    </div>
  );
}
