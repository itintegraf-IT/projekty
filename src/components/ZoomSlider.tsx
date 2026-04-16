"use client";

import { useCallback, useEffect, useRef } from "react";

interface ZoomSliderProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}

export function ZoomSlider({ value, onChange, min = 3, max = 26 }: ZoomSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const pct = (value - min) / (max - min);

  const applyPosition = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const { left, width } = el.getBoundingClientRect();
    const raw = (clientX - left) / width;
    const clamped = Math.min(1, Math.max(0, raw));
    onChange(Math.round(min + clamped * (max - min)));
  }, [min, max, onChange]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) { if (isDragging.current) applyPosition(e.clientX); }
    function onMouseUp()  { isDragging.current = false; document.body.style.cursor = ""; }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };
  }, [applyPosition]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {/* ikona odzoomu — klikatelná */}
      <svg
        width="12" height="12" viewBox="0 0 16 16" fill="none"
        onClick={() => onChange(Math.max(min, value - 1))}
        style={{ flexShrink: 0, opacity: value <= min ? 0.2 : 0.5, cursor: value <= min ? "default" : "pointer", transition: "opacity 0.15s" }}
      >
        <circle cx="6.5" cy="6.5" r="5" stroke="var(--text-muted)" strokeWidth="1.5"/>
        <line x1="4" y1="6.5" x2="9" y2="6.5" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>

      {/* track */}
      <div
        ref={trackRef}
        onMouseDown={(e) => { isDragging.current = true; document.body.style.cursor = "ew-resize"; applyPosition(e.clientX); }}
        style={{ position: "relative", width: 80, height: 20, display: "flex", alignItems: "center", cursor: "ew-resize", flexShrink: 0 }}
      >
        {/* bg track */}
        <div style={{ position: "absolute", inset: "0 0 0 0", margin: "auto", height: 2, borderRadius: 2, background: "color-mix(in oklab, var(--border) 90%, transparent)" }} />
        {/* fill */}
        <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", height: 2, width: `${pct * 100}%`, borderRadius: 2, background: "color-mix(in oklab, var(--text) 65%, transparent)", transition: isDragging.current ? undefined : "width 0.05s" }} />
        {/* thumb */}
        <div style={{
          position: "absolute",
          left: `calc(${pct * 100}% - 7px)`,
          top: "50%", transform: "translateY(-50%)",
          width: 14, height: 14, borderRadius: "50%",
          background: "var(--text)",
          boxShadow: "0 1px 4px color-mix(in oklab, var(--text) 25%, transparent), 0 0 0 0.5px color-mix(in oklab, var(--text) 15%, transparent)",
          transition: isDragging.current ? undefined : "left 0.05s",
          flexShrink: 0,
        }} />
      </div>

      {/* ikona přiblížení — klikatelná */}
      <svg
        width="14" height="14" viewBox="0 0 16 16" fill="none"
        onClick={() => onChange(Math.min(max, value + 1))}
        style={{ flexShrink: 0, opacity: value >= max ? 0.2 : 0.5, cursor: value >= max ? "default" : "pointer", transition: "opacity 0.15s" }}
      >
        <circle cx="6.5" cy="6.5" r="5" stroke="var(--text-muted)" strokeWidth="1.5"/>
        <line x1="4" y1="6.5" x2="9" y2="6.5" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="6.5" y1="4" x2="6.5" y2="9" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </div>
  );
}
