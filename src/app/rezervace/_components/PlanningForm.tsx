"use client";

import { useState, useEffect } from "react";
import DatePickerField from "@/app/_components/DatePickerField";
import { Reservation } from "./RezervacePage";

interface Props {
  reservation: Reservation;
  onPrepared: () => void;
}

interface CodebookOption {
  id: number;
  label: string;
  isWarning: boolean;
}

const DURATION_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const totalMinutes = (i + 1) * 30;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return { label: `${h}:${m.toString().padStart(2, "0")}`, hours: totalMinutes / 60 };
});

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  color: "var(--text-muted)",
  marginBottom: 5,
  display: "block",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const selectStyle: React.CSSProperties = {
  appearance: "none",
  width: "100%",
  height: 32,
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--text)",
  fontSize: 12,
  fontWeight: 600,
  padding: "0 32px 0 12px",
  cursor: "pointer",
  outline: "none",
  fontFamily: "inherit",
};

const chevron = (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    color="var(--text-muted)"
    style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}
  >
    <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function SelectWrap({ children }: { children: React.ReactNode }) {
  return <div style={{ position: "relative" }}>{children}{chevron}</div>;
}

export default function PlanningForm({ reservation, onPrepared }: Props) {
  const existing = reservation.planningPayload as Record<string, unknown> | null;

  const [machine, setMachine] = useState<string>(
    (existing?.machine as string | undefined) ?? ""
  );
  const [description, setDescription] = useState<string>(
    (existing?.description as string | undefined) ?? reservation.companyName
  );
  const [durationHours, setDurationHours] = useState<number>(
    existing?.durationHours !== undefined ? Number(existing.durationHours) : 1
  );
  const [deadlineExpedice, setDeadlineExpedice] = useState<string>(
    (existing?.deadlineExpedice as string | undefined) ??
    (reservation.requestedExpeditionDate ? reservation.requestedExpeditionDate.slice(0, 10) : "")
  );
  const [dataRequiredDate, setDataRequiredDate] = useState<string>(
    (existing?.dataRequiredDate as string | undefined) ??
    (reservation.requestedDataDate ? reservation.requestedDataDate.slice(0, 10) : "")
  );
  const [dataStatusId, setDataStatusId] = useState<string>(
    existing?.dataStatusId !== undefined && existing.dataStatusId !== null
      ? String(existing.dataStatusId) : ""
  );
  const [materialRequiredDate, setMaterialRequiredDate] = useState<string>(
    (existing?.materialRequiredDate as string | undefined) ?? ""
  );
  const [materialInStock, setMaterialInStock] = useState<boolean>(
    Boolean(existing?.materialInStock)
  );
  const [materialStatusId, setMaterialStatusId] = useState<string>(
    existing?.materialStatusId !== undefined && existing.materialStatusId !== null
      ? String(existing.materialStatusId) : ""
  );
  const [pantoneRequiredDate, setPantoneRequiredDate] = useState<string>(
    (existing?.pantoneRequiredDate as string | undefined) ?? ""
  );
  const [pantoneOk, setPantoneOk] = useState<boolean>(Boolean(existing?.pantoneOk));
  const [pantoneRequired, setPantoneRequired] = useState<boolean>(Boolean(existing?.pantoneRequired));
  const [barvyStatusId, setBarvyStatusId] = useState<string>(
    existing?.barvyStatusId !== undefined && existing.barvyStatusId !== null
      ? String(existing.barvyStatusId) : ""
  );
  const [lakStatusId, setLakStatusId] = useState<string>(
    existing?.lakStatusId !== undefined && existing.lakStatusId !== null
      ? String(existing.lakStatusId) : ""
  );
  const [specifikace, setSpecifikace] = useState<string>(
    (existing?.specifikace as string | undefined) ?? ""
  );

  const [dataOpts, setDataOpts] = useState<CodebookOption[]>([]);
  const [materialOpts, setMaterialOpts] = useState<CodebookOption[]>([]);
  const [barvyOpts, setBarvyOpts] = useState<CodebookOption[]>([]);
  const [lakOpts, setLakOpts] = useState<CodebookOption[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/codebook?category=DATA").then((r) => r.json()),
      fetch("/api/codebook?category=MATERIAL").then((r) => r.json()),
      fetch("/api/codebook?category=BARVY").then((r) => r.json()),
      fetch("/api/codebook?category=LAK").then((r) => r.json()),
    ]).then(([data, material, barvy, lak]) => {
      setDataOpts(data);
      setMaterialOpts(material);
      setBarvyOpts(barvy);
      setLakOpts(lak);
    }).catch(console.error);
  }, []);

  function resolveLabel(opts: CodebookOption[], id: string): string | null {
    const found = opts.find((o) => String(o.id) === id);
    return found ? found.label : null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!durationHours || durationHours <= 0) {
      setError("Délka tisku musí být kladné číslo");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        machine: machine || null,
        description,
        durationHours,
        deadlineExpedice: deadlineExpedice || null,
        dataRequiredDate: dataRequiredDate || null,
        dataStatusId: dataStatusId ? parseInt(dataStatusId) : null,
        dataStatusLabel: dataStatusId ? resolveLabel(dataOpts, dataStatusId) : null,
        materialRequiredDate: materialInStock ? null : (materialRequiredDate || null),
        materialInStock,
        materialStatusId: materialStatusId ? parseInt(materialStatusId) : null,
        materialStatusLabel: materialStatusId ? resolveLabel(materialOpts, materialStatusId) : null,
        pantoneRequiredDate: pantoneRequired ? (pantoneRequiredDate || null) : null,
        pantoneOk,
        pantoneRequired,
        barvyStatusId: barvyStatusId ? parseInt(barvyStatusId) : null,
        barvyStatusLabel: barvyStatusId ? resolveLabel(barvyOpts, barvyStatusId) : null,
        lakStatusId: lakStatusId ? parseInt(lakStatusId) : null,
        lakStatusLabel: lakStatusId ? resolveLabel(lakOpts, lakStatusId) : null,
        specifikace: specifikace || null,
      };
      const res = await fetch(`/api/reservations/${reservation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare", planningPayload: payload }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Chyba");
      }
      onPrepared();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Chyba");
    } finally {
      setSubmitting(false);
    }
  }

  const sectionLabel: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, letterSpacing: "0.18em",
    textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10,
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 20, marginTop: 16 }}>

      {/* ── Základní parametry ── */}
      <div>
        <div style={sectionLabel}>Základní parametry</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>Popis zakázky</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{
                width: "100%", padding: "8px 12px", borderRadius: 8,
                border: "1px solid var(--border)", background: "var(--card)",
                color: "var(--foreground)", fontSize: 13, fontFamily: "inherit",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label style={labelStyle}>Délka tisku</label>
            <SelectWrap>
              <select
                value={String(durationHours)}
                onChange={(e) => setDurationHours(Number(e.target.value))}
                style={selectStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
              >
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.hours} value={String(opt.hours)}>{opt.label}</option>
                ))}
              </select>
            </SelectWrap>
          </div>
          <div>
            <label style={labelStyle}>Tiskový stroj</label>
            <SelectWrap>
              <select
                value={machine}
                onChange={(e) => setMachine(e.target.value)}
                style={{ ...selectStyle, color: machine ? "var(--text)" : "var(--text-muted)" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
              >
                <option value="">— neurčeno —</option>
                <option value="XL_105">XL 105</option>
                <option value="XL_106">XL 106</option>
              </select>
            </SelectWrap>
          </div>
        </div>
      </div>

      {/* ── Výrobní sloupečky ── */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, display: "grid", gap: 12 }}>
        <div style={sectionLabel}>Výrobní sloupečky</div>

        {/* DATA */}
        <div>
          <label style={labelStyle}>Data</label>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: "0 0 140px" }}>
              <DatePickerField value={dataRequiredDate} onChange={setDataRequiredDate} placeholder="Datum dodání…" asButton />
            </div>
            <div style={{ flex: 1 }}>
              <SelectWrap>
                <select
                  value={dataStatusId}
                  onChange={(e) => setDataStatusId(e.target.value)}
                  style={{ ...selectStyle, color: dataStatusId ? "var(--text)" : "var(--text-muted)" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                >
                  <option value="">— info —</option>
                  {dataOpts.map((o) => (
                    <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                  ))}
                </select>
              </SelectWrap>
            </div>
          </div>
        </div>

        {/* MATERIÁL */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Materiál</label>
            <label style={{
              display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600,
              color: materialInStock ? "#10b981" : "var(--text-muted)", cursor: "pointer",
            }}>
              <div
                onClick={() => { setMaterialInStock(!materialInStock); if (!materialInStock) setMaterialRequiredDate(""); }}
                style={{
                  width: 32, height: 18, borderRadius: 9,
                  background: materialInStock ? "#10b981" : "var(--surface-3)",
                  cursor: "pointer", position: "relative", transition: "background 150ms ease-out", flexShrink: 0,
                }}
              >
                <div style={{
                  position: "absolute", top: 2, left: materialInStock ? 15 : 2, width: 14, height: 14,
                  borderRadius: "50%", background: "#fff", transition: "left 150ms ease-out",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }} />
              </div>
              SKLADEM
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, opacity: materialInStock ? 0.4 : 1, pointerEvents: materialInStock ? "none" : "auto" }}>
            <div style={{ flex: "0 0 140px" }}>
              <DatePickerField value={materialInStock ? "" : materialRequiredDate} onChange={setMaterialRequiredDate} placeholder="Datum dodání…" asButton />
            </div>
            <div style={{ flex: 1 }}>
              <SelectWrap>
                <select
                  value={materialStatusId}
                  onChange={(e) => setMaterialStatusId(e.target.value)}
                  style={{ ...selectStyle, color: materialStatusId ? "var(--text)" : "var(--text-muted)" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                >
                  <option value="">— info —</option>
                  {materialOpts.map((o) => (
                    <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                  ))}
                </select>
              </SelectWrap>
            </div>
          </div>
        </div>

        {/* PANTONE + BARVY + LAK */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {/* Pantone */}
          <div>
            <label style={labelStyle}>Pantone</label>
            <DatePickerField value={pantoneRequiredDate} onChange={(v) => { setPantoneRequiredDate(v); if (v) setPantoneRequired(true); }} placeholder="Datum…" asButton />
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6 }}>
              <button type="button" onClick={() => {
                const next = !pantoneRequired;
                setPantoneRequired(next);
                if (!next) { setPantoneRequiredDate(""); setPantoneOk(false); }
              }} style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 5, border: pantoneRequired ? "1px solid rgba(168,85,247,0.5)" : "1px solid var(--border)", background: pantoneRequired ? "rgba(168,85,247,0.15)" : "transparent", color: pantoneRequired ? "#a855f7" : "var(--text-muted)", cursor: "pointer", transition: "all 100ms" }}>
                {pantoneRequired ? "⚠ POTŘEBA" : "POTŘEBA"}
              </button>
              <label style={{
                display: "flex", alignItems: "center", gap: 4,
                fontSize: 10, fontWeight: 600, cursor: "pointer", letterSpacing: "0.04em",
                color: pantoneOk ? "var(--success)" : "var(--text-muted)",
              }}>
                <div style={{
                  width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                  background: pantoneOk ? "var(--success)" : "transparent",
                  border: pantoneOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 120ms ease-out",
                }}
                  onClick={() => setPantoneOk(!pantoneOk)}
                >
                  {pantoneOk && (
                    <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                      <path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                OK
              </label>
            </div>
          </div>
          {/* Barvy */}
          <div>
            <label style={labelStyle}>Barvy</label>
            <SelectWrap>
              <select
                value={barvyStatusId}
                onChange={(e) => setBarvyStatusId(e.target.value)}
                style={{ ...selectStyle, color: barvyStatusId ? "var(--text)" : "var(--text-muted)" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
              >
                <option value="">— nezadáno —</option>
                {barvyOpts.map((o) => (
                  <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                ))}
              </select>
            </SelectWrap>
          </div>
          {/* Lak */}
          <div>
            <label style={labelStyle}>Lak</label>
            <SelectWrap>
              <select
                value={lakStatusId}
                onChange={(e) => setLakStatusId(e.target.value)}
                style={{ ...selectStyle, color: lakStatusId ? "var(--text)" : "var(--text-muted)" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
              >
                <option value="">— nezadáno —</option>
                {lakOpts.map((o) => (
                  <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                ))}
              </select>
            </SelectWrap>
          </div>
        </div>
      </div>

      {/* ── Termín expedice ── */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <div style={sectionLabel}>Expedice</div>
        <div style={{ maxWidth: 200 }}>
          <label style={labelStyle}>Termín expedice</label>
          <DatePickerField value={deadlineExpedice} onChange={setDeadlineExpedice} asButton />
        </div>
      </div>

      {/* ── Poznámky ── */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <div style={sectionLabel}>Poznámky</div>
        <textarea
          value={specifikace}
          onChange={(e) => setSpecifikace(e.target.value)}
          rows={2}
          style={{
            width: "100%", padding: "8px 12px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--card)",
            color: "var(--foreground)", fontSize: 13, fontFamily: "inherit",
            outline: "none", boxSizing: "border-box", resize: "vertical",
          }}
          placeholder="Technické poznámky…"
        />
      </div>

      {error && (
        <div style={{
          background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)",
          borderRadius: 8, padding: "8px 12px", color: "var(--danger)", fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        style={{
          padding: "9px 20px", borderRadius: 8, border: "none",
          background: submitting ? "var(--surface-3)" : "#7c3aed",
          color: submitting ? "var(--text-muted)" : "#fff",
          fontFamily: "inherit", fontWeight: 600, fontSize: 13,
          cursor: submitting ? "not-allowed" : "pointer",
          alignSelf: "flex-start", transition: "background 150ms ease-out",
        }}
      >
        {submitting ? "Ukládám…" : "Připravit do fronty plánovače"}
      </button>
    </form>
  );
}
