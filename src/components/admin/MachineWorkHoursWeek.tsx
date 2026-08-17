"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SHIFTS, SHIFT_LABELS, fmtHHMM, defaultShiftMin, type ShiftType } from "@/lib/shifts";
import { MACHINES, MACHINE_LABELS } from "@/lib/machines";
import { FONT_STACK, btnPrimary, btnSecondary } from "@/lib/uiStyles";
import { weekStartFromDate, weekDatesFromStart, isoWeekNumber } from "@/lib/shiftRoster";
import { useSSE } from "@/hooks/useSSE";
import { ToastContainer, useToast } from "@/components/ToastContainer";
import { ShiftHoursPopover } from "@/components/admin/ShiftHoursPopover";
import { ShiftCascadeDialog, type CascadeBlock } from "@/components/admin/ShiftCascadeDialog";

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

const DAY_LABELS = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];

const SEPARATOR = "color-mix(in oklab, var(--border) 70%, transparent)";
const TEXT_PRIMARY = "var(--text)";
const TEXT_SECONDARY = "var(--text-muted)";
const BORDER_SUBTLE = "var(--border)";

// btnPrimary/btnSecondary → src/lib/uiStyles.ts (audit #43; padding sjednocen 14→16px)

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
  const [cascadeBlocks, setCascadeBlocks] = useState<CascadeBlock[] | null>(null);
  const [cascadeMachine, setCascadeMachine] = useState<string | null>(null);
  const [cascadeLongerCount, setCascadeLongerCount] = useState(0);
  const { toasts, showToast, dismissToast } = useToast();
  const savingRef = useRef(false);
  // Snímek `rows` pořízený na startu operace uložení (viz `runSave`). Kaskádové
  // potvrzení i navazující kroky bez force jedou nad TÍMTO snímkem, ne nad živým
  // `rows` — jinak by ho mezitím přepsal `load()` volaný při otevření dialogu
  // a klik na „Uložit i přesto" by odeslal starou, needitovanou podobu směn.
  const saveSnapshotRef = useRef<Record<string, WeekShiftsRow[]>>({});

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

  type SaveResult =
    | { ok: true; longerCount: number }
    | { ok: false; cascade: CascadeBlock[]; longerCount: number; machine: string };

  const submitSave = async (
    snapshot: Record<string, WeekShiftsRow[]>,
    force: boolean,
    onlyMachine?: string,
  ): Promise<SaveResult> => {
    // Bez `onlyMachine` jde o kompletní uložení (všechny stroje); s ním jde o
    // adresné force-potvrzení JEN stroje z dialogu — force se nesmí rozlít na
    // stroje, jejichž konflikty nikdo neviděl (proto se tu netočí přes MACHINES).
    const targets: readonly string[] = onlyMachine ? [onlyMachine] : MACHINES;
    let longerCount = 0;
    for (const machine of targets) {
      const machineRows = snapshot[machine];
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
          machine?: string;
          conflictingBlocks?: CascadeBlock[];
          longerBlocks?: CascadeBlock[];
        };
        if (res.status === 409 && body.error === "SHIFT_SHRINK_CASCADE" && Array.isArray(body.conflictingBlocks)) {
          // M5 (fix round finální recenze): `longerCount` z LOOPU (stroje uložené PŘED
          // tímhle 409) se jinak zahodí — sečíst i je, jinak závěrečný toast po potvrzení
          // kaskády podhodnotí počet zakázek s prodlouženým koncem.
          return {
            ok: false,
            cascade: body.conflictingBlocks,
            longerCount: longerCount + (Array.isArray(body.longerBlocks) ? body.longerBlocks.length : 0),
            machine: body.machine ?? machine,
          };
        }
        throw new Error(body.error ?? `Chyba ukládání (${machine})`);
      }
      // Úspěch: 200 tělo je od Fix round 1 obálka `{ rows, longerBlocks }` (dřív holé
      // pole řádků) — `rows` tady nepotřebujeme (lokální stav se dotáhne přes `load()`
      // na konci celé operace), ale `longerBlocks` je jediný způsob, jak se dozvědět
      // o blocích, kterým se tímto uložením konec PRODLOUŽIL (nevystěhovaly se, takže
      // 409 nenastala — bez čtení úspěšného těla by o nich uživatel nevěděl vůbec).
      const body = (await res.json().catch(() => null)) as { longerBlocks?: CascadeBlock[] } | null;
      if (Array.isArray(body?.longerBlocks)) longerCount += body.longerBlocks.length;
    }
    return { ok: true, longerCount };
  };

  const runSave = async (force: boolean, onlyMachine?: string) => {
    setBusy(true);
    setError(null);
    savingRef.current = true;
    try {
      // Snímek se bere jen na startu nové operace (bez `onlyMachine`) — kaskádové
      // potvrzení i navazující kroky ho pak sdílí, viz komentář u `saveSnapshotRef`.
      if (!onlyMachine) saveSnapshotRef.current = rows;
      const snapshot = saveSnapshotRef.current;
      const result = await submitSave(snapshot, force, onlyMachine);
      if (!result.ok) {
        setCascadeBlocks(result.cascade);
        setCascadeMachine(result.machine);
        setCascadeLongerCount(result.longerCount);
        // ÚMYSLNĚ ŽÁDNÝ `load()` tady — přepsal by živé `rows` serverovou (starou)
        // hodnotou PŘESNĚ pro stroj, který uživatel právě edituje a jehož editaci
        // dialog ukazuje. Po „Zrušit změnu" by tak rozeditovaná změna, která kaskádu
        // vyvolala, ze stránky beze stopy zmizela. `original` je pro tenhle flow jen
        // kosmetický `dirty` flag (žádný payload se z něj neskládá) a sám se dorovná
        // finálním `await load()` po dokončení CELÉ sekvence uložení (Fix round 1).
        return;
      }
      let longerCount = result.longerCount;
      if (onlyMachine) {
        // Právě force-uložený stroj byl jediný, na kterém uživatel kaskádu VIDĚL
        // a potvrdil. Zbylé stroje za ním v pořadí ještě nebyly vůbec zkoušeny —
        // pokračují BEZ force, ať se jejich případná kaskáda ukáže taky (dialog se
        // objeví podruhé, pravdivě, se svým názvem stroje).
        const idx = MACHINES.findIndex((m) => m === onlyMachine);
        const remaining = idx >= 0 ? MACHINES.slice(idx + 1) : [];
        for (const machine of remaining) {
          const next = await submitSave(snapshot, false, machine);
          if (!next.ok) {
            setCascadeBlocks(next.cascade);
            setCascadeMachine(next.machine);
            setCascadeLongerCount(next.longerCount);
            // Stejný důvod jako výš — žádný `load()`.
            return;
          }
          longerCount += next.longerCount;
        }
      }
      await load();
      showToast("Pracovní doba uložena.", "success");
      if (longerCount > 0) {
        // Neblokující upozornění na latentní detonátor (viz `longerBlocksSentence`
        // v `cascadeDialogText.ts`) — týká se i uložení, které NEvyvolalo dialog
        // (čisté zkrácení bez vystěhování bloku), takže se sem musí dostat i mimo
        // kaskádovou větev výše.
        showToast(
          `U ${longerCount} zakázek se prodloužil spočítaný konec — jejich příští úprava odsune navazující zakázky. Zkontroluj je v plánu.`,
          "info",
        );
      }
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
    const machine = cascadeMachine;
    setCascadeBlocks(null);
    setCascadeMachine(null);
    setCascadeLongerCount(0);
    if (!machine) return;
    await runSave(true, machine);
  };

  const cancelCascade = () => {
    setCascadeBlocks(null);
    setCascadeMachine(null);
    setCascadeLongerCount(0);
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

      {cascadeBlocks && cascadeMachine && (
        <ShiftCascadeDialog
          machine={cascadeMachine}
          conflictingBlocks={cascadeBlocks}
          longerCount={cascadeLongerCount}
          onCancel={cancelCascade}
          onConfirm={() => void confirmCascade()}
          busy={busy}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
