"use client";

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

export default function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      padding: 40,
      textAlign: "center",
    }}>
      <span style={{ fontSize: 22 }} aria-hidden="true">⚠</span>
      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: "5px 14px",
            fontSize: 12,
            borderRadius: 7,
            border: "1px solid var(--border)",
            background: "var(--surface-2)",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Zkusit znovu
        </button>
      )}
    </div>
  );
}
