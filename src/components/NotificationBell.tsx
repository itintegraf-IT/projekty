"use client";

export function NotificationBell({ count, active, onClick, title }: {
  count: number;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={onClick}
        title={title ?? "Upozornění a aktivita"}
        style={{
          width: 28, height: 28, borderRadius: 8,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: active ? "rgba(59,130,246,0.14)" : "var(--surface-2)",
          border: `1px solid ${active ? "rgba(59,130,246,0.35)" : "var(--border)"}`,
          color: active ? "#3b82f6" : "var(--text-muted)",
          cursor: "pointer", transition: "all 120ms ease-out", padding: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
      </button>
      {count > 0 && (
        <span style={{
          position: "absolute", top: -3, right: -3,
          width: 14, height: 14, borderRadius: "50%",
          background: "#ef4444", color: "#fff",
          fontSize: 8, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>{count > 9 ? "9+" : count}</span>
      )}
    </div>
  );
}
