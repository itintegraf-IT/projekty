"use client";

import React, { useState } from "react";
import { type CompanyDay } from "@/app/_components/TimelineGrid";
import { utcToPragueDateStr, utcToPragueHour, pragueToUTC } from "@/lib/dateUtils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import DatePickerField from "@/app/_components/DatePickerField";

type EditState = { label: string; startDate: string; endDate: string; startHour: number; endHour: number; machine: "both" | "XL_105" | "XL_106" };

export function machineBadgeStyle(m?: string | null): React.CSSProperties {
  return {
    flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", borderRadius: 4, padding: "1px 5px",
    background: !m ? "rgba(139,92,246,0.55)" : m === "XL_105" ? "rgba(37,99,235,0.65)" : "rgba(22,163,74,0.65)",
    color: !m ? "#f3e8ff" : m === "XL_105" ? "#dbeafe" : "#dcfce7",
    border: `1px solid ${!m ? "rgba(167,139,250,0.5)" : m === "XL_105" ? "rgba(96,165,250,0.5)" : "rgba(74,222,128,0.5)"}`,
  };
}

function MachinePicker({ value, onChange }: { value: "both" | "XL_105" | "XL_106"; onChange: (v: "both" | "XL_105" | "XL_106") => void }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {(["both", "XL_105", "XL_106"] as const).map((opt) => {
        const lbl = opt === "both" ? "Oba stroje" : opt === "XL_105" ? "XL 105" : "XL 106";
        const active = value === opt;
        return (
          <button key={opt} type="button" onClick={() => onChange(opt)} style={{
            flex: 1, height: 28, borderRadius: 6, fontSize: 11, fontWeight: active ? 700 : 500,
            border: active ? "1px solid rgba(139,92,246,0.5)" : "1px solid var(--border)",
            background: active ? "rgba(139,92,246,0.15)" : "var(--surface-2)",
            color: active ? "#c4b5fd" : "var(--text-muted)",
            cursor: "pointer", transition: "all 0.12s ease-out",
          }}>{lbl}</button>
        );
      })}
    </div>
  );
}

export function ShutdownManager({
  companyDays,
  onAdd,
  onUpdate,
  onDelete,
  onClose,
}: {
  companyDays: CompanyDay[];
  onAdd: (startDate: string, endDate: string, label: string, machine: string | null) => Promise<void>;
  onUpdate: (id: number, startDate: string, endDate: string, label: string, machine: string | null) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onClose: () => void;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate]     = useState("");
  const [startHour, setStartHour] = useState(0);
  const [endHour, setEndHour]     = useState(23);
  const [label, setLabel]         = useState("");
  const [machine, setMachine]     = useState<"both" | "XL_105" | "XL_106">("both");
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState<number | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const hourSelectStyle: React.CSSProperties = {
    height: 32, borderRadius: 6, border: "1px solid var(--border)",
    background: "var(--surface-2)", color: "var(--text)", fontSize: 11,
    padding: "0 6px", cursor: "pointer", width: "100%",
  };

  function startEdit(cd: CompanyDay) {
    const s = new Date(cd.startDate);
    const e = new Date(cd.endDate);
    setEditingId(cd.id);
    setEditState({
      label: cd.label,
      startDate: utcToPragueDateStr(s),
      endDate: utcToPragueDateStr(e),
      startHour: utcToPragueHour(s),
      endHour: utcToPragueHour(e),
      machine: !cd.machine ? "both" : cd.machine === "XL_105" ? "XL_105" : "XL_106",
    });
  }

  function cancelEdit() { setEditingId(null); setEditState(null); }

  async function handleAdd() {
    if (!startDate || !endDate || !label.trim()) { setError("Vyplňte všechna pole."); return; }
    const startUTC = pragueToUTC(startDate, startHour, 0);
    const endUTC   = pragueToUTC(endDate, endHour, 59);
    if (endUTC <= startUTC) { setError("Konec musí být po začátku."); return; }
    setSaving(true); setError(null);
    try {
      await onAdd(startUTC.toISOString(), endUTC.toISOString(), label.trim(), machine === "both" ? null : machine);
      setStartDate(""); setEndDate(""); setLabel(""); setStartHour(0); setEndHour(23); setMachine("both");
    } catch (error) {
      console.error("Company day save failed", error);
      setError("Chyba při ukládání.");
    }
    finally { setSaving(false); }
  }

  async function handleSaveEdit(id: number) {
    if (!editState) return;
    if (!editState.startDate || !editState.endDate || !editState.label.trim()) { setError("Vyplňte všechna pole."); return; }
    const startUTC = pragueToUTC(editState.startDate, editState.startHour, 0);
    const endUTC   = pragueToUTC(editState.endDate, editState.endHour, 59);
    if (endUTC <= startUTC) { setError("Konec musí být po začátku."); return; }
    setEditSaving(true); setError(null);
    try {
      await onUpdate(id, startUTC.toISOString(), endUTC.toISOString(), editState.label.trim(), editState.machine === "both" ? null : editState.machine);
      cancelEdit();
    } catch (err) {
      console.error("Company day update failed", err);
      setError("Chyba při ukládání.");
    }
    finally { setEditSaving(false); }
  }

  async function handleDelete(id: number) {
    setDeleting(id);
    try { await onDelete(id); }
    catch (error) {
      console.error("Company day delete failed", error);
      setError("Chyba při mazání.");
    }
    finally { setDeleting(null); }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)" }}>
      <div style={{ padding: "10px 16px", background: "linear-gradient(135deg, color-mix(in oklab, var(--surface-2) 95%, transparent) 0%, var(--surface) 100%)", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Firemní dny</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginTop: 2 }}>Odstávky a svátky</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-xs text-slate-400"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="15 18 9 12 15 6"/></svg> Zpět</Button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px" }}>
        {error && (
          <div style={{ marginBottom: 12, borderRadius: 6, background: "color-mix(in oklab, var(--danger) 15%, transparent)", border: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)", padding: "8px 12px", fontSize: 11, color: "var(--danger)" }}>{error}</div>
        )}

        {/* Formulář */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Přidat odstávku</div>
          <div>
            <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Název</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Velikonoce, dovolená…" className="h-8 text-xs" />
          </div>
          <div>
            <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Stroj</Label>
            <MachinePicker value={machine} onChange={setMachine} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto", gap: 6, alignItems: "end" }}>
            <div>
              <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Od (datum)</Label>
              <DatePickerField value={startDate} onChange={setStartDate} placeholder="Od…" />
            </div>
            <div>
              <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Hod.</Label>
              <select value={startHour} onChange={(e) => setStartHour(Number(e.target.value))} style={hourSelectStyle}>
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                ))}
              </select>
            </div>
            <div>
              <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Do (datum)</Label>
              <DatePickerField value={endDate} onChange={setEndDate} placeholder="Do…" />
            </div>
            <div>
              <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Hod.</Label>
              <select value={endHour} onChange={(e) => setEndHour(Number(e.target.value))} style={hourSelectStyle}>
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, "0")}:59</option>
                ))}
              </select>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={handleAdd}
            disabled={saving || !label.trim() || !startDate || !endDate}
            className="w-full text-xs font-semibold border border-purple-400/35 bg-purple-400/[0.06] text-purple-400 hover:bg-purple-400/[0.12] hover:text-purple-400 disabled:text-slate-600 disabled:border-slate-700 disabled:bg-transparent"
          >
            {saving ? "Ukládám…" : "＋ Přidat"}
          </Button>
        </div>

        <Separator className="my-1 bg-slate-800" />

        {/* Seznam */}
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>
            Uložené ({companyDays.length})
          </div>
          {companyDays.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: "12px 0" }}>Žádné záznamy</div>
          )}
          {companyDays.map((cd) => (
            <div key={cd.id} style={{ background: editingId === cd.id ? "rgba(139,92,246,0.1)" : "rgba(139,92,246,0.06)", border: `1px solid ${editingId === cd.id ? "rgba(139,92,246,0.35)" : "rgba(139,92,246,0.15)"}`, borderRadius: 8, overflow: "hidden" }}>
              {/* Řádek s názvem */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#c4b5fd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{cd.label}</div>
                    <span style={machineBadgeStyle(cd.machine)}>
                      {!cd.machine ? "OBA" : cd.machine === "XL_105" ? "XL 105" : "XL 106"}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {(() => {
                      const tz = "Europe/Prague";
                      const s = new Date(cd.startDate);
                      const e = new Date(cd.endDate);
                      const sDate = s.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz });
                      const eDate = e.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz });
                      const sHour = utcToPragueHour(s); const eHour = utcToPragueHour(e);
                      const wholeDay = sHour === 0 && eHour === 23;
                      const sTime = wholeDay ? "" : ` ${String(sHour).padStart(2, "0")}:00`;
                      const eTime = wholeDay ? "" : ` ${String(eHour).padStart(2, "0")}:59`;
                      const sDateStr = utcToPragueDateStr(s);
                      const eDateStr = utcToPragueDateStr(e);
                      const sameDateStr = sDateStr === eDateStr;
                      return sameDateStr ? `${sDate}${sTime}${eTime && sTime !== eTime ? ` – ${eTime.trim()}` : ""}` : `${sDate}${sTime} – ${eDate}${eTime}`;
                    })()}
                  </div>
                </div>
                {/* Tlačítka */}
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => editingId === cd.id ? cancelEdit() : startEdit(cd)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: editingId === cd.id ? "#c4b5fd" : "var(--text-muted)", fontSize: 13, padding: "0 4px", lineHeight: 1 }}
                    title={editingId === cd.id ? "Zrušit editaci" : "Upravit"}
                  >
                    {editingId === cd.id ? "✕" : "✎"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(cd.id)}
                    disabled={deleting === cd.id}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 16, padding: "0 4px", lineHeight: 1 }}
                    title="Smazat"
                  >
                    {deleting === cd.id ? "…" : "×"}
                  </button>
                </div>
              </div>

              {/* Inline editační formulář */}
              {editingId === cd.id && editState && (
                <div style={{ borderTop: "1px solid rgba(139,92,246,0.2)", padding: "10px 10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div>
                    <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Název</Label>
                    <Input value={editState.label} onChange={(e) => setEditState((s) => s && ({ ...s, label: e.target.value }))} className="h-8 text-xs" />
                  </div>
                  <div>
                    <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Stroj</Label>
                    <MachinePicker value={editState.machine} onChange={(v) => setEditState((s) => s && ({ ...s, machine: v }))} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto", gap: 6, alignItems: "end" }}>
                    <div>
                      <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Od</Label>
                      <DatePickerField value={editState.startDate} onChange={(v) => setEditState((s) => s && ({ ...s, startDate: v }))} placeholder="Od…" />
                    </div>
                    <div>
                      <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Hod.</Label>
                      <select value={editState.startHour} onChange={(e) => setEditState((s) => s && ({ ...s, startHour: Number(e.target.value) }))} style={hourSelectStyle}>
                        {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}
                      </select>
                    </div>
                    <div>
                      <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Do</Label>
                      <DatePickerField value={editState.endDate} onChange={(v) => setEditState((s) => s && ({ ...s, endDate: v }))} placeholder="Do…" />
                    </div>
                    <div>
                      <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Hod.</Label>
                      <select value={editState.endHour} onChange={(e) => setEditState((s) => s && ({ ...s, endHour: Number(e.target.value) }))} style={hourSelectStyle}>
                        {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:59</option>)}
                      </select>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleSaveEdit(cd.id)}
                    disabled={editSaving || !editState.label.trim() || !editState.startDate || !editState.endDate}
                    className="w-full text-xs font-semibold border border-purple-400/35 bg-purple-400/[0.06] text-purple-400 hover:bg-purple-400/[0.12] hover:text-purple-400 disabled:text-slate-600 disabled:border-slate-700 disabled:bg-transparent"
                  >
                    {editSaving ? "Ukládám…" : "Uložit změny"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
