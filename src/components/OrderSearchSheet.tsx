"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Block } from "@/app/_components/TimelineGrid";
import { blockMatchesQuery } from "@/lib/orderSearch";

type Props = {
  open: boolean;
  allBlocks: Block[];
  onSelect: (block: Block) => void;
  onClose: () => void;
};

export function OrderSearchSheet({ open, allBlocks, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const q = query.trim();
  const results = q
    ? allBlocks
        .filter((b) => blockMatchesQuery(b, q))
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        .slice(0, 20)
    : [];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(2px)",
        zIndex: 100,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          borderRadius: "16px 16px 0 0",
          width: "min(480px, 100%)",
          maxHeight: "60vh",
          padding: "14px 16px 20px",
          boxShadow: "0 -8px 32px rgba(0,0,0,0.15)",
          animation: "search-slide-up 250ms ease-out",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            width: 36,
            height: 4,
            background: "color-mix(in oklab, var(--text) 18%, transparent)",
            borderRadius: 2,
            margin: "0 auto 12px",
          }}
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Číslo zakázky…"
          style={{
            fontSize: 16,
            padding: 14,
            border: "1px solid var(--border)",
            borderRadius: 12,
            background: "var(--surface-2, #f7f7f9)",
            color: "var(--text)",
            outline: "none",
          }}
        />
        <div style={{ flex: 1, overflowY: "auto", marginTop: 12 }}>
          {q && results.length === 0 && (
            <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              Zakázka {query} nebyla nalezena.
            </div>
          )}
          {results.map((b) => (
            <button
              key={b.id}
              onClick={(e) => {
                if (e.button !== 0) return;
                onSelect(b);
              }}
              style={{
                all: "unset",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                borderRadius: 10,
                marginBottom: 4,
                cursor: "pointer",
                fontSize: 13,
                background: "transparent",
                transition: "background 120ms ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in oklab, var(--text) 5%, transparent)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 700 }}>{b.orderNumber}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {b.description ?? ""}
                </span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "3px 8px",
                  borderRadius: 6,
                  background: "color-mix(in oklab, var(--text) 6%, transparent)",
                }}
              >
                {b.machine}
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          style={{
            all: "unset",
            textAlign: "center",
            padding: "10px 0 0",
            color: "var(--text-muted)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Zavřít
        </button>
      </div>
      <style>{`
        @keyframes search-slide-up {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>,
    document.body
  );
}
