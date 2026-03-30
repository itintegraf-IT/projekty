"use client";

import { Reservation } from "./RezervacePage";

interface Props {
  reservation: Reservation;
  currentUser: { id: number; username: string; role: string };
  isSelected: boolean;
  onSelect: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Nová",
  ACCEPTED: "Přijata",
  QUEUE_READY: "Připravena",
  SCHEDULED: "Naplánována",
  REJECTED: "Zamítnuta",
};

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  SUBMITTED: { bg: "rgba(59,130,246,0.12)", text: "#3b82f6" },
  ACCEPTED: { bg: "rgba(16,185,129,0.12)", text: "#10b981" },
  QUEUE_READY: { bg: "rgba(124,58,237,0.12)", text: "#7c3aed" },
  SCHEDULED: { bg: "rgba(16,185,129,0.12)", text: "#059669" },
  REJECTED: { bg: "rgba(220,38,38,0.12)", text: "#dc2626" },
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function ReservationList({ reservation: r, currentUser, isSelected, onSelect }: Props) {
  const isPlanner = ["ADMIN", "PLANOVAT"].includes(currentUser.role);
  const statusStyle = STATUS_COLOR[r.status] ?? { bg: "var(--surface-2)", text: "var(--text-muted)" };

  return (
    <div
      className="pressable-card"
      onClick={onSelect}
      style={{
        background: "var(--card)",
        border: `1px solid ${isSelected ? "#7c3aed" : "var(--border)"}`,
        borderRadius: 10,
        padding: "12px 16px",
        cursor: "pointer",
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        transition: "border-color 150ms ease-out",
        borderLeft: `3px solid #7c3aed`,
      }}
    >
      {/* Kód */}
      <div style={{
        flexShrink: 0,
        background: "rgba(124,58,237,0.12)",
        color: "#7c3aed",
        fontWeight: 700,
        fontSize: 13,
        padding: "4px 8px",
        borderRadius: 6,
        letterSpacing: "0.03em",
        alignSelf: "flex-start",
        marginTop: 2,
      }}>
        {r.code || "…"}
      </div>

      {/* Obsah */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.companyName}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {r.erpOfferNumber}
          </span>
          {/* Stav badge */}
          <span style={{
            background: statusStyle.bg,
            color: statusStyle.text,
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 7px",
            borderRadius: 5,
            letterSpacing: "0.03em",
            marginLeft: "auto",
            flexShrink: 0,
          }}>
            {STATUS_LABEL[r.status] ?? r.status}
          </span>
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Expedice: <strong>{fmtDate(r.requestedExpeditionDate)}</strong>
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Data: <strong>{fmtDate(r.requestedDataDate)}</strong>
          </span>
          {isPlanner && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Obchodník: <strong>{r.requestedByUsername}</strong>
            </span>
          )}
          <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
            {fmtDate(r.createdAt)}
          </span>
        </div>
        {r.attachments.length > 0 && (
          <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)" }}>
            📎 {r.attachments.length} {r.attachments.length === 1 ? "příloha" : "přílohy"}
          </div>
        )}
      </div>

      {/* Rozbalení indikátor */}
      <div style={{ color: "var(--text-muted)", fontSize: 14, alignSelf: "center", transform: isSelected ? "rotate(180deg)" : "none", transition: "transform 150ms ease-out" }}>
        ▾
      </div>
    </div>
  );
}
