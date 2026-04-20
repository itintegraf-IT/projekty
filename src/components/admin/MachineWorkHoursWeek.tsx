"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SHIFTS, SHIFT_LABELS, fmtHHMM, defaultShiftMin, type ShiftType } from "@/lib/shifts";
import { weekStartFromDate, weekDatesFromStart, isoWeekNumber } from "@/lib/shiftRoster";
import { useSSE } from "@/hooks/useSSE";
import { ToastContainer, useToast } from "@/components/ToastContainer";
import { ShiftHoursPopover } from "@/components/admin/ShiftHoursPopover";
import { ShiftCascadeDialog, type ConflictingBlock } from "@/components/admin/ShiftCascadeDialog";

type WeekShiftsRow = {
  id?: number;
  machine: string;
  weekStart: string;
  dayOfWeek: number;
  isActive: boolean;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
  morningStartMin: number | null;
  morningEndMin: number | null;
  afternoonStartMin: number | null;
  afternoonEndMin: number | null;
  nightStartMin: number | null;
  nightEndMin: number | null;
};

const AMBER_TEXT = "#f59e0b";

function defaultShiftBounds(shift: ShiftType): { startMin: number; endMin: number } {
  return { startMin: defaultShiftMin(shift, "start"), endMin: defaultShiftMin(shift, "end") };
}

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

function isoDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const CZ_MONTHS = [
  "ledna", "února", "března", "dubna", "května", "června",
  "července", "srpna", "září", "října", "listopadu", "prosince",
];

function formatCzechDate(d: Date): string {
  return `${d.getUTCDate()}. ${CZ_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function emptyWeek(machine: string, weekStart: string): WeekShiftsRow[] {
  return Array.from({ length: 7 }, (_, dow) => ({
    machine,
    weekStart,
    dayOfWeek: dow,
    isActive: false,
    morningOn: false,
    afternoonOn: false,
    nightOn: false,
    morningStartMin: null,
    morningEndMin: null,
    afternoonStartMin: null,
    afternoonEndMin: null,
    nightStartMin: null,
    nightEndMin: null,
  }));
}

function shiftFlagKey(shift: ShiftType): "morningOn" | "afternoonOn" | "nightOn" {
  if (shift === "MORNING") return "morningOn";
  if (shift === "AFTERNOON") return "afternoonOn";
  return "nightOn";
}

function shiftStartKey(shift: ShiftType): "morningStartMin" | "afternoonStartMin" | "nightStartMin" {
  if (shift === "MORNING") return "morningStartMin";
  if (shift === "AFTERNOON") return "afternoonStartMin";
  return "nightStartMin";
}

function shiftEndKey(shift: ShiftType): "morningEndMin" | "afternoonEndMin" | "nightEndMin" {
  if (shift === "MORNING") return "morningEndMin";
  if (shift === "AFTERNOON") return "afternoonEndMin";
  return "nightEndMin";
}

function ShiftHoursLabel({
  shift,
  startMin,
  endMin,
  onEdit,
  onReset,
}: {
  shift: ShiftType;
  startMin: number | null;
  endMin: number | null;
  onEdit: (rect: DOMRect) => void;
  onReset: () => void;
}) {
  const def = defaultShiftBounds(shift);
  const effStart = startMin ?? def.startMin;
  const effEnd = endMin ?? def.endMin;
  const isOverride = startMin !== null || endMin !== null;
  const color = isOverride ? AMBER_TEXT : TEXT_SECONDARY;
  return (
    <div
      style={{
        marginTop: 4,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: FONT_STACK,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onEdit(rect);
        }}
        style={{
          background: "transparent",
          border: "none",
          color,
          fontSize: 10,
          fontWeight: isOverride ? 600 : 400,
          cursor: "pointer",
          padding: "1px 2px",
          fontFamily: FONT_STACK,
          textDecoration: "underline dotted",
          textUnderlineOffset: 2,
        }}
      >
        {fmtHHMM(effStart)}–{fmtHHMM(effEnd)}
      </button>
      {isOverride && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onReset();
          }}
          title="Vrátit na výchozí hodiny"
          style={{
            background: "transparent",
            border: "none",
            color: AMBER_TEXT,
            fontSize: 11,
            cursor: "pointer",
            padding: "0 2px",
            lineHeight: 1,
            fontFamily: FONT_STACK,
          }}
        >
          ↺
        </button>
      )}
    </div>
  );
}

export function MachineWorkHoursWeek() {
  const [weekStart, setWeekStart] = useState<Date>(() => weekStartFromDate(new Date()));
  const [rows, setRows] = useState<Record<string, WeekShiftsRow[]>>({});
  const [original, setOriginal] = useState<Record<string, WeekShiftsRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [popoverState, setPopoverState] = useState<{ machine: string; dow: number; shift: ShiftType; anchor: DOMRect } | null>(null);
  const [cascadeBlocks, setCascadeBlocks] = useState<ConflictingBlock[] | null>(null);
  const { toasts, showToast, dismissToast } = useToast();
  const savingRef = useRef(false);

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

  const currentWeekStart = useMemo(() => weekStartFromDate(new Date()), []);
  const isCurrentWeek = useMemo(() => isoDateStr(currentWeekStart) === weekStartStr, [currentWeekStart, weekStartStr]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/machine-week-shifts?weekStart=${weekStartStr}`);
      if (!res.ok) throw new Error("Chyba načtení pracovní doby");
      const data = (await res.json()) as WeekShiftsRow[];
      const byMachine: Record<string, WeekShiftsRow[]> = {};
      for (const machine of MACHINES) {
        const machineRows = data.filter((r) => r.machine === machine).sort((a, b) => a.dayOfWeek - b.dayOfWeek);
        byMachine[machine] = machineRows.length === 7 ? machineRows : emptyWeek(machine, weekStartStr);
      }
      setRows(byMachine);
      setOriginal(JSON.parse(JSON.stringify(byMachine)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba");
    } finally {
      setLoading(false);
    }
  }, [weekStartStr]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => JSON.stringify(rows) !== JSON.stringify(original), [rows, original]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useSSE({
    onEvent: (msg) => {
      if (msg.type !== "schedule:changed") return;
      if (savingRef.current) return;
      if (dirtyRef.current) {
        showToast("Pracovní doba byla upravena jiným uživatelem. Tvoje rozdělané změny zůstanou — uložení je přepíše.", "info");
        return;
      }
      void load();
    },
  });

  const saveOverride = (machine: string, dow: number, shift: ShiftType, startMin: number | null, endMin: number | null) => {
    setRows((prev) => {
      const machineRows = prev[machine] ?? emptyWeek(machine, weekStartStr);
      const startKey = shiftStartKey(shift);
      const endKey = shiftEndKey(shift);
      const next = machineRows.map((r) => {
        if (r.dayOfWeek !== dow) return r;
        return { ...r, [startKey]: startMin, [endKey]: endMin };
      });
      return { ...prev, [machine]: next };
    });
  };

  const resetOverride = (machine: string, dow: number, shift: ShiftType) => {
    saveOverride(machine, dow, shift, null, null);
  };

  const openEditor = (machine: string, dow: number, shift: ShiftType, rect: DOMRect) => {
    setPopoverState({ machine, dow, shift, anchor: rect });
  };

  const closeEditor = () => {
    setPopoverState(null);
  };

  const toggleShift = (machine: string, dow: number, shift: ShiftType) => {
    setRows((prev) => {
      const machineRows = prev[machine] ?? emptyWeek(machine, weekStartStr);
      const next = machineRows.map((r) => {
        if (r.dayOfWeek !== dow) return r;
        const key = shiftFlagKey(shift);
        const newVal = !r[key];
        const updated = { ...r, [key]: newVal };
        updated.isActive = updated.morningOn || updated.afternoonOn || updated.nightOn;
        return updated;
      });
      return { ...prev, [machine]: next };
    });
  };

  const submitSave = async (force: boolean): Promise<{ ok: boolean; cascade?: ConflictingBlock[] }> => {
    for (const machine of MACHINES) {
      const machineRows = rows[machine];
      if (!machineRows) continue;
      const url = force
        ? "/api/machine-week-shifts?force=1"
        : "/api/machine-week-shifts";
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machine,
          weekStart: weekStartStr,
          days: machineRows.map((r) => ({
            dayOfWeek: r.dayOfWeek,
            isActive: r.isActive,
            morningOn: r.morningOn,
            afternoonOn: r.afternoonOn,
            nightOn: r.nightOn,
            morningStartMin: r.morningStartMin,
            morningEndMin: r.morningEndMin,
            afternoonStartMin: r.afternoonStartMin,
            afternoonEndMin: r.afternoonEndMin,
            nightStartMin: r.nightStartMin,
            nightEndMin: r.nightEndMin,
          })),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          conflictingBlocks?: ConflictingBlock[];
        };
        if (res.status === 409 && body.error === "SHIFT_SHRINK_CASCADE" && Array.isArray(body.conflictingBlocks)) {
          return { ok: false, cascade: body.conflictingBlocks };
        }
        throw new Error(body.error ?? `Chyba ukládání (${machine})`);
      }
    }
    return { ok: true };
  };

  const runSave = async (force: boolean) => {
    setBusy(true);
    setError(null);
    savingRef.current = true;
    try {
      const result = await submitSave(force);
      if (!result.ok && result.cascade) {
        setCascadeBlocks(result.cascade);
        return;
      }
      await load();
      showToast("Pracovní doba uložena.", "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chyba ukládání";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setBusy(false);
      setTimeout(() => { savingRef.current = false; }, 500);
    }
  };

  const save = () => runSave(false);

  const confirmCascade = async () => {
    setCascadeBlocks(null);
    await runSave(true);
  };

  const cancelCascade = () => {
    setCascadeBlocks(null);
  };

  const copyFromPrev = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/machine-week-shifts?weekStart=${prevWeekStartStr}`);
      if (!res.ok) throw new Error("Chyba načtení předchozího týdne");
      const data = (await res.json()) as WeekShiftsRow[];
      const copied: Record<string, WeekShiftsRow[]> = {};
      for (const machine of MACHINES) {
        const machineRows = data.filter((r) => r.machine === machine).sort((a, b) => a.dayOfWeek - b.dayOfWeek);
        copied[machine] = (machineRows.length === 7 ? machineRows : emptyWeek(machine, weekStartStr)).map((r) => ({
          ...r,
          id: undefined,
          weekStart: weekStartStr,
        }));
      }
      setRows(copied);
      showToast(`Zkopírováno z ${prevKt}. KT — zkontroluj a ulož.`, "info");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chyba kopírování";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const navigateWeek = (delta: number) => {
    if (dirty && !confirm("Máš neuložené změny. Opravdu přepnout týden?")) return;
    const next = new Date(weekStart);
    next.setUTCDate(next.getUTCDate() + delta * 7);
    setWeekStart(weekStartFromDate(next));
  };

  const goToCurrentWeek = () => {
    if (isCurrentWeek) return;
    if (dirty && !confirm("Máš neuložené změny. Opravdu přepnout týden?")) return;
    setWeekStart(currentWeekStart);
  };

  const isShiftOn = (machine: string, dow: number, shift: ShiftType): boolean => {
    const row = rows[machine]?.find((r) => r.dayOfWeek === dow);
    if (!row || !row.isActive) return false;
    return row[shiftFlagKey(shift)];
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          PRACOVNÍ DOBA
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => navigateWeek(-1)} style={btnSecondary} disabled={busy}>
            ← Předchozí
          </button>
          <div style={{ fontWeight: 600, fontSize: 14, color: TEXT_PRIMARY, minWidth: 320, textAlign: "center" }}>
            {kt}. KT · {formatCzechDate(weekDates[0])} – {formatCzechDate(weekDates[6])}
          </div>
          <button onClick={() => navigateWeek(1)} style={btnSecondary} disabled={busy}>
            Další →
          </button>
          <button onClick={goToCurrentWeek} style={btnSecondary} disabled={busy || isCurrentWeek}>
            Dnes
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => void copyFromPrev()} style={btnSecondary} disabled={busy}>
            Zkopírovat z {prevKt}. KT
          </button>
          <button onClick={() => void save()} style={btnPrimary} disabled={busy || !dirty}>
            Uložit změny
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
                      padding: "10px 14px",
                      background: "var(--surface-2)",
                      color: TEXT_PRIMARY,
                      fontWeight: 600,
                      fontSize: 13,
                      letterSpacing: "0.02em",
                      borderTop: `1px solid ${SEPARATOR}`,
                      borderBottom: `1px solid ${SEPARATOR}`,
                    }}>
                      <span style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "var(--brand)",
                        marginRight: 10,
                        verticalAlign: "middle",
                      }} />
                      {MACHINE_LABELS[machine]}
                    </td>
                  </tr>
                  {SHIFTS.map((shift) => (
                    <tr key={`${machine}-${shift}`}>
                      <td style={{
                        padding: "8px 12px",
                        background: "var(--surface-2)",
                        borderBottom: `1px solid ${SEPARATOR}`,
                        fontWeight: 600,
                        fontSize: 12,
                        color: TEXT_PRIMARY,
                      }}>
                        {SHIFT_LABELS[shift]}
                      </td>
                      {weekDates.map((d) => {
                        const dow = d.getUTCDay();
                        const on = isShiftOn(machine, dow, shift);
                        const row = rows[machine]?.find((r) => r.dayOfWeek === dow);
                        const startKey = shiftStartKey(shift);
                        const endKey = shiftEndKey(shift);
                        const startMin = row ? row[startKey] : null;
                        const endMin = row ? row[endKey] : null;
                        return (
                          <td
                            key={`${machine}-${shift}-${isoDateStr(d)}`}
                            onClick={() => toggleShift(machine, dow, shift)}
                            style={{
                              padding: "10px 8px",
                              borderBottom: `1px solid ${SEPARATOR}`,
                              borderLeft: `1px solid ${SEPARATOR}`,
                              textAlign: "center",
                              cursor: "pointer",
                              background: on
                                ? "color-mix(in oklab, var(--success, #22c55e) 18%, transparent)"
                                : "transparent",
                              transition: "background 120ms",
                              userSelect: "none",
                            }}
                          >
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggleShift(machine, dow, shift)}
                                onClick={(e) => e.stopPropagation()}
                                style={{ cursor: "pointer", width: 16, height: 16 }}
                              />
                              {on && (
                                <ShiftHoursLabel
                                  shift={shift}
                                  startMin={startMin}
                                  endMin={endMin}
                                  onEdit={(rect) => openEditor(machine, dow, shift, rect)}
                                  onReset={() => resetOverride(machine, dow, shift)}
                                />
                              )}
                            </div>
                          </td>
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

      <div style={{
        marginTop: 14,
        padding: "12px 14px",
        background: "var(--surface)",
        border: `1px solid ${BORDER_SUBTLE}`,
        borderRadius: 10,
        fontSize: 12,
        lineHeight: 1.6,
        color: TEXT_SECONDARY,
        fontFamily: FONT_STACK,
      }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: TEXT_SECONDARY, marginBottom: 6 }}>
          Vysvětlivky
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div><strong style={{ color: TEXT_PRIMARY, fontWeight: 600 }}>Ranní</strong> · 6:00 – 14:00</div>
          <div><strong style={{ color: TEXT_PRIMARY, fontWeight: 600 }}>Odpolední</strong> · 14:00 – 22:00</div>
          <div>
            <strong style={{ color: TEXT_PRIMARY, fontWeight: 600 }}>Noční</strong> · 22:00 – 6:00 (přes půlnoc)
          </div>
          <div style={{ marginTop: 4, fontStyle: "italic" }}>
            Noční směna je vedena pod dnem, kdy začíná. Např. zaškrtnutí „Noční“ v <strong style={{ color: TEXT_PRIMARY, fontWeight: 600 }}>neděli</strong> znamená směnu od <strong style={{ color: TEXT_PRIMARY, fontWeight: 600 }}>ne 22:00 do po 6:00</strong>.
          </div>
        </div>
      </div>

      {popoverState && (() => {
        const row = rows[popoverState.machine]?.find((r) => r.dayOfWeek === popoverState.dow);
        const sKey = shiftStartKey(popoverState.shift);
        const eKey = shiftEndKey(popoverState.shift);
        const cs = row ? row[sKey] : null;
        const ce = row ? row[eKey] : null;
        return (
          <ShiftHoursPopover
            shift={popoverState.shift}
            anchor={popoverState.anchor}
            currentStartMin={cs}
            currentEndMin={ce}
            onSave={(startMin, endMin) => {
              saveOverride(popoverState.machine, popoverState.dow, popoverState.shift, startMin, endMin);
              closeEditor();
            }}
            onCancel={closeEditor}
          />
        );
      })()}

      {cascadeBlocks && (
        <ShiftCascadeDialog
          conflictingBlocks={cascadeBlocks}
          onCancel={cancelCascade}
          onConfirm={() => void confirmCascade()}
          busy={busy}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
