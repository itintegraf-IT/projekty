"use client";

interface LoadingSpinnerProps {
  label?: string;
  size?: number;
}

export default function LoadingSpinner({ label = "Načítám…", size = 20 }: LoadingSpinnerProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 40 }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        style={{ animation: "spin 0.7s linear infinite", flexShrink: 0 }}
      >
        <circle cx="10" cy="10" r="8" stroke="var(--border)" strokeWidth="2.5" />
        <path d="M10 2a8 8 0 0 1 8 8" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </svg>
      {label && (
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{label}</span>
      )}
    </div>
  );
}
