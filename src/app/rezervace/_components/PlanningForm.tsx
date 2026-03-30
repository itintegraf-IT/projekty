"use client";

import { useState } from "react";
import DatePickerField from "@/app/_components/DatePickerField";
import { Reservation } from "./RezervacePage";

interface Props {
  reservation: Reservation;
  onPrepared: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--card)",
  color: "var(--foreground)",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--text-muted)",
  marginBottom: 5,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

export default function PlanningForm({ reservation, onPrepared }: Props) {
  const existing = reservation.planningPayload as Record<string, unknown> | null;

  const [description, setDescription] = useState<string>(
    (existing?.description as string | undefined) ?? reservation.companyName
  );
  const [durationHours, setDurationHours] = useState<string>(
    existing?.durationHours !== undefined ? String(existing.durationHours) : ""
  );
  const [deadlineExpedice, setDeadlineExpedice] = useState<string>(
    (existing?.deadlineExpedice as string | undefined) ??
    reservation.requestedExpeditionDate.slice(0, 10)
  );
  const [dataRequiredDate, setDataRequiredDate] = useState<string>(
    (existing?.dataRequiredDate as string | undefined) ??
    reservation.requestedDataDate.slice(0, 10)
  );
  const [materialRequiredDate, setMaterialRequiredDate] = useState<string>(
    (existing?.materialRequiredDate as string | undefined) ?? ""
  );
  const [materialInStock, setMaterialInStock] = useState<boolean>(
    Boolean(existing?.materialInStock)
  );
  const [pantoneRequiredDate, setPantoneRequiredDate] = useState<string>(
    (existing?.pantoneRequiredDate as string | undefined) ?? ""
  );
  const [pantoneOk, setPantoneOk] = useState<boolean>(Boolean(existing?.pantoneOk));
  const [specifikace, setSpecifikace] = useState<string>(
    (existing?.specifikace as string | undefined) ?? ""
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const dur = parseFloat(durationHours);
    if (!durationHours || isNaN(dur) || dur <= 0) {
      setError("Délka tisku musí být kladné číslo");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        description,
        durationHours: dur,
        deadlineExpedice: deadlineExpedice || null,
        dataRequiredDate: dataRequiredDate || null,
        materialRequiredDate: materialInStock ? null : (materialRequiredDate || null),
        materialInStock,
        pantoneRequiredDate: pantoneRequiredDate || null,
        pantoneOk,
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

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16, marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: -4 }}>
        Plánovací parametry
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Popis zakázky</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Délka tisku (hodiny) *</label>
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={durationHours}
            onChange={(e) => setDurationHours(e.target.value)}
            placeholder="napr. 3"
            style={inputStyle}
            required
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Termín expedice</label>
          <DatePickerField value={deadlineExpedice} onChange={setDeadlineExpedice} asButton />
        </div>
        <div>
          <label style={labelStyle}>Termín dat</label>
          <DatePickerField value={dataRequiredDate} onChange={setDataRequiredDate} asButton />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "end" }}>
        <div>
          <label style={labelStyle}>Termín materiálu</label>
          <DatePickerField
            value={materialInStock ? "" : materialRequiredDate}
            onChange={setMaterialRequiredDate}
            asButton
          />
        </div>
        <div style={{ paddingBottom: 2 }}>
          <label style={{ ...labelStyle, whiteSpace: "nowrap" }}>Sklad</label>
          <div
            onClick={() => setMaterialInStock(!materialInStock)}
            style={{
              width: 40, height: 24, borderRadius: 12,
              background: materialInStock ? "#10b981" : "var(--surface-3)",
              cursor: "pointer", position: "relative", transition: "background 150ms ease-out",
            }}
          >
            <div style={{
              position: "absolute", top: 3, left: materialInStock ? 19 : 3, width: 18, height: 18,
              borderRadius: "50%", background: "#fff", transition: "left 150ms ease-out",
              boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
            }} />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Termín Pantone</label>
          <DatePickerField value={pantoneRequiredDate} onChange={setPantoneRequiredDate} asButton />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          onClick={() => setPantoneOk(!pantoneOk)}
          style={{
            width: 40, height: 24, borderRadius: 12,
            background: pantoneOk ? "#10b981" : "var(--surface-3)",
            cursor: "pointer", position: "relative", transition: "background 150ms ease-out",
          }}
        >
          <div style={{
            position: "absolute", top: 3, left: pantoneOk ? 19 : 3, width: 18, height: 18,
            borderRadius: "50%", background: "#fff", transition: "left 150ms ease-out",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          }} />
        </div>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Pantone OK</span>
      </div>

      <div>
        <label style={labelStyle}>Specifikace</label>
        <textarea
          value={specifikace}
          onChange={(e) => setSpecifikace(e.target.value)}
          rows={2}
          style={{ ...inputStyle, resize: "vertical" }}
          placeholder="Technické poznámky…"
        />
      </div>

      {error && (
        <div style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, padding: "8px 12px", color: "var(--danger)", fontSize: 13 }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        style={{
          padding: "9px 20px",
          borderRadius: 8,
          border: "none",
          background: submitting ? "var(--surface-3)" : "#7c3aed",
          color: submitting ? "var(--text-muted)" : "#fff",
          fontFamily: "inherit",
          fontWeight: 600,
          fontSize: 13,
          cursor: submitting ? "not-allowed" : "pointer",
          alignSelf: "flex-start",
          transition: "background 150ms ease-out",
        }}
      >
        {submitting ? "Ukládám…" : "Připravit do fronty plánovače"}
      </button>
    </form>
  );
}
