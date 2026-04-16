"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { utcToPragueDateStr } from "@/lib/dateUtils";

const MONTH_NAMES_CS = ["Leden","Únor","Březen","Duben","Květen","Červen","Červenec","Srpen","Září","Říjen","Listopad","Prosinec"];
const DAY_NAMES_CS   = ["Po","Út","St","Čt","Pá","So","Ne"];
const PRAGUE_DATE_FMT = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: "Europe/Prague",
  day: "numeric",
  month: "numeric",
});
const navBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 8, border: "none",
  background: "var(--surface-2)", color: "var(--text-muted)",
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", transition: "background 100ms ease-out",
};

function parseCivilDate(value: string): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const [year, month, day] = utcToPragueDateStr(parsed).split("-").map(Number);
  return { year, month, day };
}

function formatCivilDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return PRAGUE_DATE_FMT.format(parsed);
}

function datePartsToString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Přibližná výška kalendáře (header + dny + padding) v px — s rezervou
const CAL_HEIGHT = 345;
// Šířka kalendáře: 7 * 36 + 6 * 3 + 32 = 302px (border-box)
const CAL_WIDTH = 310;

export default function DatePickerField({
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => setMounted(true), []);

  const todayParts = parseCivilDate(utcToPragueDateStr(new Date())) ?? { year: 1970, month: 1, day: 1 };
  const selected = parseCivilDate(value);
  const [viewYear,  setViewYear]  = useState(() => selected?.year  ?? todayParts.year);
  const [viewMonth, setViewMonth] = useState(() => (selected?.month ?? todayParts.month) - 1);

  useEffect(() => {
    const parts = parseCivilDate(value);
    if (parts) {
      setViewYear(parts.year);
      setViewMonth(parts.month - 1);
    }
  }, [value]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  // Grid Po=0 … Ne=6
  const firstDow = (new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const displayLabel = selected ? formatCivilDate(value) : placeholder;

  const CELL = 36;
  const GAP  = 3;

  // Výpočet pozice kalendáře — vyhnutí se viewportu (jako DtpDataPopover)
  function openCalendar() {
    if (!triggerRef.current) { setOpen(true); return; }
    const rect = triggerRef.current.getBoundingClientRect();

    const spaceAbove = rect.top - 8;
    const spaceBelow = window.innerHeight - rect.bottom - 8;

    let top: number;
    if (spaceAbove >= CAL_HEIGHT) {
      // Dost místa nahoře → otevři nad triggerem
      top = rect.top - CAL_HEIGHT - 4;
    } else if (spaceBelow >= CAL_HEIGHT) {
      // Dost místa dole → otevři pod triggerem
      top = rect.bottom + 4;
    } else if (spaceAbove >= spaceBelow) {
      // Více místa nahoře → přimáčkni k horní hraně
      top = Math.max(8, rect.top - CAL_HEIGHT - 4);
    } else {
      // Více místa dole → přimáčkni ke spodní hraně
      top = Math.min(rect.bottom + 4, window.innerHeight - CAL_HEIGHT - 8);
    }

    // Horizontální pozice: zarovnání doleva, ale neklesne mimo viewport
    let left = rect.left;
    if (left + CAL_WIDTH > window.innerWidth - 8) {
      left = window.innerWidth - CAL_WIDTH - 8;
    }
    left = Math.max(8, left);

    setPos({ top, left });
    setOpen(true);
  }

  // Zavření při kliknutí mimo
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || calendarRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const triggerButton = (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => (open ? setOpen(false) : openCalendar())}
      aria-haspopup="dialog"
      aria-expanded={open}
      style={asButton ? {
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
        display: "flex", alignItems: "center", gap: 6,
        cursor: "pointer", outline: "none", boxSizing: "border-box",
        transition: "border-color 120ms ease-out",
      } as React.CSSProperties}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: asButton ? 0.6 : 0.4, flexShrink: 0 }}>
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      <span>{displayLabel}</span>
    </button>
  );

  const calendarPopup = open ? (
    <div
      ref={calendarRef}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        zIndex: 9999,
        background: "var(--surface)",
        borderRadius: 14,
        boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ width: 7 * CELL + 6 * GAP + 32, padding: "16px 16px 12px", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" }}>

        {/* Hlavička */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <button type="button" aria-label="Předchozí měsíc" onClick={prevMonth} style={navBtnStyle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em" }}>
            {MONTH_NAMES_CS[viewMonth]} {viewYear}
          </span>
          <button type="button" aria-label="Další měsíc" onClick={nextMonth} style={navBtnStyle}>
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
            const isSelected = !!selected && selected.day === day && selected.month - 1 === viewMonth && selected.year === viewYear;
            const isToday    = todayParts.day === day && todayParts.month - 1 === viewMonth && todayParts.year === viewYear;
            return (
              <button key={i}
                type="button"
                aria-label={`${day}. ${MONTH_NAMES_CS[viewMonth]} ${viewYear}${isToday ? ", dnes" : ""}`}
                onClick={() => { onChange(datePartsToString(viewYear, viewMonth + 1, day)); setOpen(false); }}
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
    </div>
  ) : null;

  if (!mounted) return triggerButton;

  return (
    <>
      {triggerButton}
      {calendarPopup && createPortal(calendarPopup, document.body)}
    </>
  );
}
