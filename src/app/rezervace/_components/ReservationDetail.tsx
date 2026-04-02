"use client";

import { useState } from "react";
import { Reservation } from "./RezervacePage";
import PlanningForm from "./PlanningForm";

const DATE_FMT = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: "Europe/Prague",
  day: "numeric",
  month: "long",
  year: "numeric",
});

interface Props {
  reservation: Reservation;
  currentUser: { id: number; username: string; role: string };
  onUpdated: () => void;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return DATE_FMT.format(new Date(iso));
  } catch { return iso; }
}

function fmtDatetime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const fieldRow = (label: string, value: React.ReactNode) => (
  <div key={label} style={{ display: "flex", gap: 12, fontSize: 13, alignItems: "baseline" }}>
    <span style={{ color: "var(--text-muted)", width: 160, flexShrink: 0 }}>{label}</span>
    <span style={{ fontWeight: 500 }}>{value}</span>
  </div>
);

export default function ReservationDetail({ reservation: r, currentUser, onUpdated }: Props) {
  const isPlanner = ["ADMIN", "PLANOVAT"].includes(currentUser.role);

  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function doAction(action: string, extra?: Record<string, unknown>) {
    setSubmitting(action);
    setError(null);
    try {
      const res = await fetch(`/api/reservations/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Chyba");
      }
      onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Chyba");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleDeleteAttachment(attachmentId: number) {
    try {
      await fetch(`/api/reservations/${r.id}/attachments/${attachmentId}`, { method: "DELETE" });
      onUpdated();
    } catch (err) {
      console.error("Delete attachment error", err);
    }
  }

  const sectionStyle: React.CSSProperties = {
    background: "var(--surface)",
    borderRadius: "0 0 10px 10px",
    border: "1px solid var(--border)",
    borderTop: "none",
    padding: 20,
    display: "grid",
    gap: 12,
  };

  const btnStyle = (color: string, disabled: boolean): React.CSSProperties => ({
    padding: "8px 16px",
    borderRadius: 8,
    border: "none",
    background: disabled ? "var(--surface-3)" : color,
    color: disabled ? "var(--text-muted)" : "#fff",
    fontFamily: "inherit",
    fontWeight: 600,
    fontSize: 13,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background 150ms ease-out",
  });

  return (
    <div style={sectionStyle}>
      {/* Základní info */}
      <div style={{ display: "grid", gap: 8 }}>
        {fieldRow("Firma", r.companyName)}
        {fieldRow("Nabídka ERP", r.erpOfferNumber)}
        {fieldRow("Termín expedice", fmtDate(r.requestedExpeditionDate))}
        {fieldRow("Termín dat", fmtDate(r.requestedDataDate))}
        {fieldRow("Obchodník", r.requestedByUsername)}
        {fieldRow("Vytvořeno", fmtDatetime(r.createdAt))}
        {r.requestText && fieldRow("Popis", <span style={{ whiteSpace: "pre-wrap" }}>{r.requestText}</span>)}
      </div>

      {/* Přílohy */}
      {r.attachments.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
            Přílohy
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {r.attachments.map((att) => (
              <div key={att.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--card)", borderRadius: 6, fontSize: 13, border: "1px solid var(--border)" }}>
                <a
                  href={`/api/reservations/${r.id}/attachments/${att.id}`}
                  download={att.originalName}
                  style={{ flex: 1, color: "#3b82f6", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  📎 {att.originalName}
                </a>
                <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap", fontSize: 12 }}>{formatBytes(att.sizeBytes)}</span>
                {(isPlanner || currentUser.id === att.uploadedByUserId) && ["SUBMITTED", "ACCEPTED"].includes(r.status) && (
                  <button
                    onClick={() => handleDeleteAttachment(att.id)}
                    style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 16, padding: "0 2px", lineHeight: 1 }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plánovací info — pokud existuje */}
      {r.plannerUsername && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Plánovač: <strong>{r.plannerUsername}</strong>
          {r.plannerDecisionReason && (
            <span style={{ display: "block", marginTop: 4, color: "var(--danger)" }}>
              Důvod zamítnutí: {r.plannerDecisionReason}
            </span>
          )}
        </div>
      )}

      {/* Naplánováno info */}
      {r.status === "SCHEDULED" && r.scheduledMachine && (
        <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
          Naplánováno na <strong>{r.scheduledMachine.replace("_", " ")}</strong>,{" "}
          {fmtDatetime(r.scheduledStartTime)} – {fmtDatetime(r.scheduledEndTime)}
          <a
            href={`/?highlight=${r.scheduledBlockId}`}
            style={{ marginLeft: 12, color: "#3b82f6", textDecoration: "none", fontSize: 12 }}
          >
            → Zobrazit v plánovači
          </a>
        </div>
      )}

      {/* Akce pro plánovače */}
      {isPlanner && (
        <div>
          {error && (
            <div style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, padding: "8px 12px", color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>
              {error}
            </div>
          )}

          {/* SUBMITTED → accept nebo reject */}
          {r.status === "SUBMITTED" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!showRejectInput && (
                <>
                  <button
                    onClick={() => doAction("accept")}
                    disabled={submitting === "accept"}
                    style={btnStyle("#10b981", submitting === "accept")}
                  >
                    {submitting === "accept" ? "Přijímám…" : "Přijmout"}
                  </button>
                  <button
                    onClick={() => setShowRejectInput(true)}
                    style={btnStyle("#dc2626", false)}
                  >
                    Nelze zařadit
                  </button>
                </>
              )}
              {showRejectInput && (
                <div style={{ display: "grid", gap: 8, width: "100%" }}>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Důvod zamítnutí…"
                    rows={2}
                    style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => doAction("reject", { reason: rejectReason })}
                      disabled={!rejectReason.trim() || submitting === "reject"}
                      style={btnStyle("#dc2626", !rejectReason.trim() || submitting === "reject")}
                    >
                      {submitting === "reject" ? "Zamítám…" : "Potvrdit zamítnutí"}
                    </button>
                    <button
                      onClick={() => { setShowRejectInput(false); setRejectReason(""); }}
                      style={{ ...btnStyle("var(--surface-2)", false), color: "var(--text-muted)" }}
                    >
                      Zrušit
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ACCEPTED → reject nebo planning form */}
          {r.status === "ACCEPTED" && (
            <div>
              {!showRejectInput && (
                <button
                  onClick={() => setShowRejectInput(true)}
                  style={{ ...btnStyle("#dc2626", false), marginBottom: 16 }}
                >
                  Nelze zařadit
                </button>
              )}
              {showRejectInput && (
                <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Důvod zamítnutí…"
                    rows={2}
                    style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => doAction("reject", { reason: rejectReason })}
                      disabled={!rejectReason.trim() || submitting === "reject"}
                      style={btnStyle("#dc2626", !rejectReason.trim() || submitting === "reject")}
                    >
                      {submitting === "reject" ? "Zamítám…" : "Potvrdit zamítnutí"}
                    </button>
                    <button
                      onClick={() => { setShowRejectInput(false); setRejectReason(""); }}
                      style={{ ...btnStyle("var(--surface-2)", false), color: "var(--text-muted)" }}
                    >
                      Zrušit
                    </button>
                  </div>
                </div>
              )}
              <PlanningForm reservation={r} onPrepared={onUpdated} />
            </div>
          )}

          {/* QUEUE_READY badge */}
          {r.status === "QUEUE_READY" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ background: "rgba(124,58,237,0.12)", color: "#7c3aed", padding: "6px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                ✓ Připraveno v frontě plánovače
              </div>
              <button
                onClick={() => doAction("notify")}
                disabled={submitting === "notify"}
                style={{ ...btnStyle("var(--surface-2)", submitting === "notify"), color: "var(--text-muted)", marginLeft: 8 }}
              >
                {submitting === "notify" ? "Odesílám…" : "Upozornit obchod"}
              </button>
            </div>
          )}

          {/* SCHEDULED — Upozornit obchod */}
          {r.status === "SCHEDULED" && (
            <button
              onClick={() => doAction("notify")}
              disabled={submitting === "notify"}
              style={btnStyle("var(--surface-2)", submitting === "notify")}
            >
              <span style={{ color: "var(--text-muted)" }}>{submitting === "notify" ? "Odesílám…" : "Upozornit obchod"}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
