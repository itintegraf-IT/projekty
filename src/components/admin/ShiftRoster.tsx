"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { SHIFTS, SHIFT_LABELS, type ShiftType } from "@/lib/shifts";
import { weekStartFromDate, weekDatesFromStart, isoWeekNumber } from "@/lib/shiftRoster";
import { ShiftRosterCell } from "./ShiftRosterCell";
import type { Printer } from "./PrinterCodebook";

export type ShiftAssignment = {
  id: number;
  machine: string;
  date: string;
  shift: ShiftType;
  printerId: number;
  printer: Printer;
  note: string | null;
  sortOrder: number;
  publishedAt: string | null;
};

type DayScheduleRow = {
  dayOfWeek: number;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
  isActive: boolean;
};

type TemplateResponse = {
  id: number;
  machine: string;
  isDefault: boolean;
  days: DayScheduleRow[];
};

const MACHINES = ["XL_105", "XL_106"] as const;
const MACHINE_LABELS: Record<string, string> = { XL_105: "XL 105", XL_106: "XL 106" };
const DAY_LABELS = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];

const FONT_STACK = "-apple-system, BlinkMacSystemFont, sans-serif";
const SEPARATOR = "color-mix(in oklab, var(--border) 70%, transparent)";
const TEXT_PRIMARY = "var(--text)";
const TEXT_SECONDARY = "var(--text-muted)";
const BORDER_SUBTLE = "var(--border)";

const btnSecondary: React.CSSProperties = {
  background: "var(--surface-2)",
  color: TEXT_SECONDARY,
  border: `1px solid ${BORDER_SUBTLE}`,
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 13,
  cursor: "pointer",
  fontFamily: FONT_STACK,
  whiteSpace: "nowrap",
};

const btnPrimary: React.CSSProperties = {
  background: "var(--brand)",
  color: "var(--brand-contrast)",
  border: "none",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: FONT_STACK,
  whiteSpace: "nowrap",
};

const btnSuccess: React.CSSProperties = {
  background: "color-mix(in oklab, var(--success, #22c55e) 90%, transparent)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: FONT_STACK,
  whiteSpace: "nowrap",
};

function isoDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function ShiftRoster() {
  const [weekStart, setWeekStart] = useState<Date>(() => weekStartFromDate(new Date()));
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [scheduleRows, setScheduleRows] = useState<Record<string, DayScheduleRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const weekDates = useMemo(() => weekDatesFromStart(weekStart), [weekStart]);
  const weekStartStr = useMemo(() => isoDateStr(weekStart), [weekStart]);
  const kt = useMemo(() => isoWeekNumber(weekStart), [weekStart]);

  const prevWeekStart = useMemo(() => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() - 7);
    return d;
  }, [weekStart]);
  const prevWeekStartStr = useMemo(() => isoDateStr(prevWeekStart), [prevWeekStart]);
  const prevKt = useMemo(() => isoWeekNumber(prevWeekStart), [prevWeekStart]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [assignRes, printerRes, scheduleRes] = await Promise.all([
        fetch(`/api/shift-assignments?weekStart=${weekStartStr}`),
        fetch("/api/printers"),
        fetch("/api/machine-shifts"),
      ]);
      if (!assignRes.ok) throw new Error("Chyba načtení přiřazení");
      if (!printerRes.ok) throw new Error("Chyba načtení tiskařů");
      if (!scheduleRes.ok) throw new Error("Chyba načtení pracovní doby");

      const assignData = (await assignRes.json()) as ShiftAssignment[];
      const printerData = (await printerRes.json()) as Printer[];
      const scheduleData = (await scheduleRes.json()) as TemplateResponse[];

      const byMachine: Record<string, DayScheduleRow[]> = {};
      for (const t of scheduleData) {
        if (!t.isDefault) continue;
        byMachine[t.machine] = t.days;
      }

      setAssignments(assignData);
      setPrinters(printerData);
      setScheduleRows(byMachine);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba");
    } finally {
      setLoading(false);
    }
  }, [weekStartStr]);

  useEffect(() => {
    void load();
  }, [load]);

  const shiftEnabled = (machine: string, date: Date, shift: ShiftType): boolean => {
    const dayOfWeek = date.getUTCDay();
    const row = scheduleRows[machine]?.find((r) => r.dayOfWeek === dayOfWeek);
    if (!row || !row.isActive) return false;
    return shift === "MORNING" ? row.morningOn : shift === "AFTERNOON" ? row.afternoonOn : row.nightOn;
  };

  const cellAssignments = (machine: string, date: Date, shift: ShiftType): ShiftAssignment[] => {
    const dateStr = isoDateStr(date);
    return assignments.filter(
      (a) => a.machine === machine && a.shift === shift && a.date.slice(0, 10) === dateStr
    );
  };

  const navigateWeek = (delta: number) => {
    const next = new Date(weekStart);
    next.setUTCDate(next.getUTCDate() + delta * 7);
    setWeekStart(weekStartFromDate(next));
  };

  const copyFromPrev = async () => {
    setBusy(true);
    try {
      let res = await fetch("/api/shift-assignments/copy-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromWeekStart: prevWeekStartStr, toWeekStart: weekStartStr }),
      });
      if (res.status === 409) {
        const body = (await res.json()) as { existingCount?: number; error?: string };
        const cnt = body.existingCount ?? 0;
        if (!confirm(`Cílový týden už má ${cnt} přiřazení. Přepsat?`)) return;
        res = await fetch("/api/shift-assignments/copy-week", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromWeekStart: prevWeekStartStr, toWeekStart: weekStartStr, overwrite: true }),
        });
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        alert(body.error ?? "Chyba při kopírování.");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/shift-assignments/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: weekStartStr }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        alert(body.error ?? "Chyba při publikaci.");
        return;
      }
      const data = (await res.json()) as { published: number };
      alert(`Publikováno ${data.published} přiřazení.`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          ROZPIS SMĚN
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => navigateWeek(-1)} style={btnSecondary} disabled={busy}>
            ← Předchozí
          </button>
          <div style={{ fontWeight: 600, fontSize: 14, color: TEXT_PRIMARY, minWidth: 220, textAlign: "center" }}>
            {kt}. KT · {isoDateStr(weekDates[0])} – {isoDateStr(weekDates[6])}
          </div>
          <button onClick={() => navigateWeek(1)} style={btnSecondary} disabled={busy}>
            Další →
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => void copyFromPrev()} style={btnSecondary} disabled={busy}>
            📋 Zkopírovat z {prevKt}. KT
          </button>
          <button onClick={() => void publish()} style={btnPrimary} disabled={busy}>
            ✓ Publikovat
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          background: "color-mix(in oklab, var(--danger) 10%, transparent)",
          border: "1px solid color-mix(in oklab, var(--danger) 25%, transparent)",
          color: "var(--danger)",
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 13,
          marginBottom: 12,
        }}>
          {error}
        </div>
      )}

      <div style={{
        background: "var(--surface)",
        border: `1px solid ${BORDER_SUBTLE}`,
        borderRadius: 12,
        overflow: "auto",
      }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: TEXT_SECONDARY, fontSize: 13 }}>Načítám…</div>
        ) : (
          <table style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            fontFamily: FONT_STACK,
            color: TEXT_PRIMARY,
            minWidth: 860,
          }}>
            <thead>
              <tr>
                <th style={{
                  padding: "10px 12px",
                  textAlign: "left",
                  borderBottom: `1px solid ${SEPARATOR}`,
                  background: "var(--surface-2)",
                  width: 140,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: TEXT_SECONDARY,
                  fontWeight: 600,
                }}>
                  Stroj / Směna
                </th>
                {weekDates.map((d) => {
                  const dow = d.getUTCDay();
                  const isWeekend = dow === 0 || dow === 6;
                  return (
                    <th
                      key={isoDateStr(d)}
                      style={{
                        padding: "10px 8px",
                        borderBottom: `1px solid ${SEPARATOR}`,
                        borderLeft: `1px solid ${SEPARATOR}`,
                        background: isWeekend ? "var(--surface-3, var(--surface-2))" : "var(--surface-2)",
                        color: isWeekend ? TEXT_SECONDARY : TEXT_PRIMARY,
                        fontSize: 12,
                        fontWeight: 600,
                        textAlign: "center",
                      }}
                    >
                      <div>{DAY_LABELS[dow]}</div>
                      <div style={{ fontSize: 11, fontWeight: 400, color: TEXT_SECONDARY }}>
                        {d.getUTCDate()}.{d.getUTCMonth() + 1}.
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {MACHINES.map((machine) => (
                <Fragment key={machine}>
                  <tr>
                    <td colSpan={8} style={{
                      padding: "8px 12px",
                      background: "color-mix(in oklab, var(--brand) 10%, transparent)",
                      color: "var(--brand)",
                      fontWeight: 600,
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      borderTop: `1px solid ${SEPARATOR}`,
                      borderBottom: `1px solid ${SEPARATOR}`,
                    }}>
                      🖨 {MACHINE_LABELS[machine]}
                    </td>
                  </tr>
                  {SHIFTS.map((shift, shiftIdx) => (
                    <tr key={`${machine}-${shift}`}>
                      <td style={{
                        padding: "8px 12px",
                        background: "var(--surface-2)",
                        borderBottom: shiftIdx === SHIFTS.length - 1 ? `1px solid ${SEPARATOR}` : `1px solid ${SEPARATOR}`,
                        fontWeight: 600,
                        fontSize: 12,
                        color: TEXT_PRIMARY,
                      }}>
                        {SHIFT_LABELS[shift]}
                      </td>
                      {weekDates.map((d) => {
                        const enabled = shiftEnabled(machine, d, shift);
                        const items = cellAssignments(machine, d, shift);
                        return (
                          <ShiftRosterCell
                            key={`${machine}-${shift}-${isoDateStr(d)}`}
                            machine={machine}
                            date={d}
                            shift={shift}
                            enabled={enabled}
                            assignments={items}
                            printers={printers}
                            onChange={load}
                          />
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
