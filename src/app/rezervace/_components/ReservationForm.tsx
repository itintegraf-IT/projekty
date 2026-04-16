"use client";

import { useState, useRef } from "react";
import DatePickerField from "@/app/_components/DatePickerField";

interface Props {
  currentUser: { id: number; username: string; role: string };
  onCreated: () => void;
}

const MAX_FILES = 5;
const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ReservationForm({ onCreated }: Props) {
  const [companyName, setCompanyName] = useState("");
  const [erpOfferNumber, setErpOfferNumber] = useState("");
  const [requestedExpeditionDate, setRequestedExpeditionDate] = useState("");
  const [requestedDataDate, setRequestedDataDate] = useState("");
  const [requestText, setRequestText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCode, setSuccessCode] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dataAfterExpedition =
    requestedDataDate && requestedExpeditionDate && requestedDataDate > requestedExpeditionDate;

  function handleFileAdd(newFiles: FileList | null) {
    if (!newFiles) return;
    const arr = Array.from(newFiles);
    const valid: File[] = [];
    for (const f of arr) {
      if (!ALLOWED_MIME_TYPES.includes(f.type)) {
        setError(`Nepodporovaný typ: ${f.name}`);
        return;
      }
      if (f.size > MAX_SIZE_BYTES) {
        setError(`Soubor příliš velký (max 10 MB): ${f.name}`);
        return;
      }
    }
    setError(null);
    const combined = [...files, ...arr].slice(0, MAX_FILES);
    setFiles(combined);
    valid.push(...arr);
  }

  function handleRemoveFile(idx: number) {
    setFiles(files.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName || !erpOfferNumber) {
      setError("Vyplňte název firmy a nabídku Cicero");
      return;
    }
    if (!requestedExpeditionDate && !requestedDataDate) {
      setError("Vyplňte alespoň jeden termín (expedice nebo dat)");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // 1. Vytvořit rezervaci
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          erpOfferNumber,
          requestedExpeditionDate: requestedExpeditionDate || undefined,
          requestedDataDate: requestedDataDate || undefined,
          requestText: requestText || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Chyba při vytváření");
      }
      const reservation = await res.json();

      // 2. Nahrát přílohy
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch(`/api/reservations/${reservation.id}/attachments`, { method: "POST", body: fd });
        if (!r.ok) {
          const d = await r.json();
          console.error(`Upload ${file.name} selhal:`, d.error);
        }
      }

      setSuccessCode(reservation.code);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Chyba");
    } finally {
      setSubmitting(false);
    }
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
    fontSize: 12,
    fontWeight: 500,
    color: "var(--text-muted)",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };

  if (successCode) {
    return (
      <div style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 32,
        textAlign: "center",
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Žádost odeslána</div>
        <div style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 24 }}>
          Vaše rezervace byla přijata s kódem{" "}
          <span style={{ fontWeight: 700, color: "#7c3aed", fontSize: 16 }}>{successCode}</span>
        </div>
        <button
          onClick={onCreated}
          style={{
            padding: "10px 24px",
            borderRadius: 8,
            border: "none",
            background: "#7c3aed",
            color: "#fff",
            fontFamily: "inherit",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Zobrazit v Moje aktivní →
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 20 }}>
      {/* Firma + ERP */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label style={labelStyle}>Název firmy *</label>
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Název zákazníka"
            style={inputStyle}
            required
          />
        </div>
        <div>
          <label style={labelStyle}>Nabídka Cicero *</label>
          <input
            value={erpOfferNumber}
            onChange={(e) => setErpOfferNumber(e.target.value)}
            placeholder="N-26-12345"
            style={inputStyle}
            required
          />
        </div>
      </div>

      {/* Termíny */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label style={labelStyle}>Požadovaný termín expedice</label>
          <DatePickerField
            value={requestedExpeditionDate}
            onChange={setRequestedExpeditionDate}
            placeholder="Vyberte datum…"
            asButton
          />
        </div>
        <div>
          <label style={labelStyle}>Požadovaný termín dat</label>
          <DatePickerField
            value={requestedDataDate}
            onChange={setRequestedDataDate}
            placeholder="Vyberte datum…"
            asButton
          />
          {dataAfterExpedition && (
            <div style={{ fontSize: 12, color: "var(--warning)", marginTop: 4 }}>
              ⚠ Termín dat je po termínu expedice
            </div>
          )}
        </div>
      </div>

      {!requestedExpeditionDate && !requestedDataDate && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 0" }}>
          Vyplňte alespoň jeden termín (expedice nebo dat).
        </div>
      )}

      {/* Popis zakázky */}
      <div>
        <label style={labelStyle}>Popis zakázky</label>
        <textarea
          value={requestText}
          onChange={(e) => setRequestText(e.target.value)}
          placeholder="Specifikace, poznámky, požadavky…"
          rows={4}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </div>

      {/* Přílohy */}
      <div>
        <label style={labelStyle}>Přílohy (max {MAX_FILES}, max 10 MB)</label>
        <div
          style={{
            border: "1.5px dashed var(--border)",
            borderRadius: 8,
            padding: "20px 16px",
            textAlign: "center",
            cursor: "pointer",
            background: "var(--surface)",
            color: "var(--text-muted)",
            fontSize: 13,
          }}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFileAdd(e.dataTransfer.files); }}
        >
          Přetáhněte soubory nebo klikněte pro výběr
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
            style={{ display: "none" }}
            onChange={(e) => handleFileAdd(e.target.files)}
          />
        </div>
        {files.length > 0 && (
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            {files.map((f, i) => (
              <div key={i} style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                background: "var(--surface-2)",
                borderRadius: 6,
                fontSize: 13,
              }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.name}
                </span>
                <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{formatBytes(f.size)}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(i)}
                  style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 16, padding: "0 4px", lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, padding: "10px 14px", color: "var(--danger)", fontSize: 13 }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        style={{
          padding: "11px 24px",
          borderRadius: 8,
          border: "none",
          background: submitting ? "var(--surface-3)" : "#7c3aed",
          color: submitting ? "var(--text-muted)" : "#fff",
          fontFamily: "inherit",
          fontWeight: 600,
          fontSize: 14,
          cursor: submitting ? "not-allowed" : "pointer",
          alignSelf: "flex-start",
          transition: "background 150ms ease-out",
        }}
      >
        {submitting ? "Odesílám…" : "Odeslat žádost"}
      </button>
    </form>
  );
}
