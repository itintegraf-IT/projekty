"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Multi-select popover s checkbox seznamem. iOS-like, ladí s appkou (CSS tokeny).
 * Hodnoty = labely (string). Click-outside zavře. Trigger ukazuje souhrn vybraných.
 */
export function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder = "— vyber —",
  disabled = false,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(opt: string) {
    if (selected.includes(opt)) onChange(selected.filter((s) => s !== opt));
    else onChange([...options].filter((o) => selected.includes(o) || o === opt));
  }

  const summary = selected.length > 0 ? selected.join(", ") : placeholder;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", height: 34, borderRadius: 8,
          background: "var(--surface-2)", border: `1px solid ${open ? "var(--ring)" : "var(--border)"}`,
          color: selected.length > 0 ? "var(--text)" : "var(--text-muted)",
          fontSize: 11, fontWeight: 600, padding: "0 26px 0 10px", cursor: disabled ? "default" : "pointer",
          outline: "none", textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          position: "relative",
        }}
      >
        {summary}
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" color="var(--text-muted)"
          style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
          <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: "absolute", zIndex: 50, top: 38, left: 0, minWidth: "100%",
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
          padding: 5, boxShadow: "0 18px 40px rgba(0,0,0,0.45)", maxHeight: 240, overflowY: "auto",
        }}>
          {options.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "8px 10px" }}>Žádné položky (přidej v adminu).</div>
          ) : (
            options.map((opt) => {
              const isSel = selected.includes(opt);
              return (
                <div key={opt} onClick={() => toggle(opt)} style={{
                  display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", borderRadius: 7,
                  fontSize: 12, fontWeight: 600, color: "var(--text)", cursor: "pointer",
                  background: isSel ? "color-mix(in oklab, var(--accent-blue, #3b82f6) 22%, transparent)" : "transparent",
                }}>
                  <span style={{
                    width: 16, height: 16, borderRadius: 5, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    background: isSel ? "#3b82f6" : "transparent", border: isSel ? "1.5px solid #3b82f6" : "1.5px solid var(--border)",
                  }}>
                    {isSel && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </span>
                  {opt}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
