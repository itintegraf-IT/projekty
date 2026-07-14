"use client";

import { useState } from "react";
import { Z_LAYOUT } from "@/lib/zLayers";

export function ResizeHandle({ onMouseDown }: { onMouseDown: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseDown={(e) => { e.preventDefault(); onMouseDown(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 8, flexShrink: 0, position: "relative", zIndex: Z_LAYOUT.panelDivider,
        cursor: "col-resize", display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: hovered ? "rgb(59 130 246 / 0.4)" : "var(--border)",
        transition: "background-color 0.15s",
      }}
    >
      {hovered && (
        <div style={{ color: "rgb(148 163 184)", fontSize: 10, lineHeight: 1, userSelect: "none", pointerEvents: "none", display: "flex", gap: 1 }}>
          <span>⇐</span><span>⇒</span>
        </div>
      )}
    </div>
  );
}
