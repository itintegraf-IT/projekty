"use client";

import { pragueOf } from "@/lib/dateUtils";

type Props = {
  partnerMachine: string;
  state: "waiting" | "done";
  time: Date;
  onClick: () => void;
};

export function SplitChip({ partnerMachine, state, time, onClick }: Props) {
  const dotColor   = state === "done" ? "var(--success, #34c759)" : "var(--warning, #ff9500)";
  const haloColor  = state === "done" ? "rgba(52,199,89,0.18)"    : "rgba(255,149,0,0.18)";
  const statusLabel = state === "done" ? "hotovo" : "čeká";
  const { hour: h, minute: m } = pragueOf(time);
  const timeStr = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;

  return (
    <button
      onClick={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        marginTop: 6,
        padding: "3px 8px 3px 6px",
        background: "rgba(255,255,255,0.65)",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        color: "#1c1c1e",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        cursor: "pointer",
        lineHeight: 1.1,
        whiteSpace: "nowrap",
      }}
      title={`Druhá část běží na ${partnerMachine} — ${statusLabel} ${timeStr}`}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dotColor,
          boxShadow: `0 0 0 3px ${haloColor}`,
          flexShrink: 0,
        }}
      />
      <span style={{ opacity: 0.6 }}>→</span>
      <span style={{ fontWeight: 700 }}>{partnerMachine}</span>
      <span style={{ opacity: 0.5 }}>·</span>
      <span>{statusLabel} {timeStr}</span>
    </button>
  );
}
