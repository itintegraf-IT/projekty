"use client";

import { useState, useRef } from "react";

export type Toast = { id: number; message: string; type: "success" | "error" | "info" };

const BORDER_COLOR = {
  success: "var(--success)",
  error: "var(--danger)",
  info: "var(--info)",
} as const;

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "color-mix(in oklab, var(--surface) 92%, transparent)",
            backdropFilter: "blur(12px)",
            borderTop: "1px solid var(--border)",
            borderRight: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
            borderLeft: `3px solid ${BORDER_COLOR[t.type]}`,
            borderRadius: 10,
            padding: "10px 14px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            minWidth: 220,
            maxWidth: 340,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
            fontSize: 13,
            color: "var(--text)",
            pointerEvents: "auto",
            animation: "toast-in 0.15s ease-out",
          }}
        >
          <span style={{ flex: 1, lineHeight: 1.4 }}>{t.message}</span>
          <button
            type="button"
            aria-label="Zavřít oznámení"
            onClick={() => onDismiss(t.id)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
              flexShrink: 0,
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ))}
    </div>
  );
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  function showToast(message: string, type: Toast["type"] = "info") {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    const tid = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timeoutsRef.current.delete(id);
    }, 4000);
    timeoutsRef.current.set(id, tid);
  }

  function dismissToast(id: number) {
    const tid = timeoutsRef.current.get(id);
    if (tid !== undefined) {
      clearTimeout(tid);
      timeoutsRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return { toasts, showToast, dismissToast };
}
