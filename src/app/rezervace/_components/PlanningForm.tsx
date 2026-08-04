"use client";

import { useState, useEffect } from "react";
import DatePickerField from "@/app/_components/DatePickerField";
import { Reservation } from "./RezervacePage";
import { DURATION_OPTIONS } from "@/lib/plannerTypes";
import { NativeSelect } from "@/components/NativeSelect";
import { ProductionTagsRow } from "@/components/planner/ProductionTagsRow";
import { parseProductionTags, serializeProductionTags } from "@/lib/productionTags";

interface Props {
  reservation: Reservation;
  onPrepared: () => void;
}

interface CodebookOption {
  id: number;
  label: string;
  isWarning: boolean;
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  color: "var(--text-muted)",
  marginBottom: 5,
  display: "block",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

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
  // Výrobní štítky — v planningPayload uložené stejným tvarem jako na Blocku
  // (JSON string u archů/série), aby existoval jediný formát napříč pipeline.
  const [obalka, setObalka] = useState<boolean>(Boolean(existing?.obalka));
  const [vnitrky, setVnitrky] = useState<boolean>(Boolean(existing?.vnitrky));
  const [tiskoveArchy, setTiskoveArchy] = useState<string[]>(
    parseProductionTags(existing?.tiskoveArchy as string | null | undefined)
  );
  const [serie, setSerie] = useState<string[]>(
    parseProductionTags(existing?.serie as string | null | undefined)
  );

  const [dataOpts, setDataOpts] = useState<CodebookOption[]>([]);
  const [materialOpts, setMaterialOpts] = useState<CodebookOption[]>([]);
  const [barvyOpts, setBarvyOpts] = useState<CodebookOption[]>([]);
  const [lakOpts, setLakOpts] = useState<CodebookOption[]>([]);
  const [tiskoveArchyOpts, setTiskoveArchyOpts] = useState<string[]>([]);
  const [serieOpts, setSerieOpts] = useState<string[]>([]);

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

  // Číselníky multi-selectů (TA/série) — stejný vzor jako BlockEdit; prázdný
  // seznam při chybě znamená jen dropdown bez voleb, ne rozbitý formulář.
  useEffect(() => {
    Promise.all([
      fetch("/api/codebook?category=TISKOVY_ARCH").then((r) => r.json()),
      fetch("/api/codebook?category=SERIE").then((r) => r.json()),
    ]).then(([ta, se]) => {
      setTiskoveArchyOpts((ta as Array<{ label: string }>).map((o) => o.label));
      setSerieOpts((se as Array<{ label: string }>).map((o) => o.label));
    }).catch(() => { /* prázdný seznam = dropdown ukáže hint */ });
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
        obalka,
        vnitrky,
        tiskoveArchy: serializeProductionTags(tiskoveArchy),
        serie: serializeProductionTags(serie),
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
            <NativeSelect value={String(durationHours)} onChange={(v) => setDurationHours(Number(v))} hover>
              {DURATION_OPTIONS.map((opt) => (
                <option key={opt.hours} value={String(opt.hours)}>{opt.label}</option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <label style={labelStyle}>Tiskový stroj</label>
            <NativeSelect value={machine} onChange={setMachine} mutedWhenEmpty hover>
              <option value="">— neurčeno —</option>
              <option value="XL_105">XL 105</option>
              <option value="XL_106">XL 106</option>
            </NativeSelect>
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
              <NativeSelect value={dataStatusId} onChange={setDataStatusId} mutedWhenEmpty hover>
                <option value="">— info —</option>
                {dataOpts.map((o) => (
                  <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                ))}
              </NativeSelect>
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
              <NativeSelect value={materialStatusId} onChange={setMaterialStatusId} mutedWhenEmpty hover>
                <option value="">— info —</option>
                {materialOpts.map((o) => (
                  <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                ))}
              </NativeSelect>
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
            <NativeSelect value={barvyStatusId} onChange={setBarvyStatusId} mutedWhenEmpty hover>
              <option value="">— nezadáno —</option>
              {barvyOpts.map((o) => (
                <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
              ))}
            </NativeSelect>
          </div>
          {/* Lak */}
          <div>
            <label style={labelStyle}>Lak</label>
            <NativeSelect value={lakStatusId} onChange={setLakStatusId} mutedWhenEmpty hover>
              <option value="">— nezadáno —</option>
              {lakOpts.map((o) => (
                <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
              ))}
            </NativeSelect>
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

      {/* ── Výrobní štítky ── */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <div style={sectionLabel}>Výrobní štítky</div>
        <ProductionTagsRow
          obalka={obalka}
          onObalkaChange={setObalka}
          vnitrky={vnitrky}
          onVnitrkyChange={setVnitrky}
          tiskoveArchy={tiskoveArchy}
          onTiskoveArchyChange={setTiskoveArchy}
          tiskoveArchyOpts={tiskoveArchyOpts}
          serie={serie}
          onSerieChange={setSerie}
          serieOpts={serieOpts}
        />
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
