"use client";

import { useEffect, useRef, useState } from "react";
import type { CodebookOption } from "@/lib/plannerTypes";

interface Props {
  blockId: number;
  currentStatusId: number | null;
  currentOk: boolean;
  dataOpts: CodebookOption[];
  anchorRect: DOMRect;
  onClose: () => void;
  onSave: (blockId: number, patch: { dataStatusId?: number | null; dataStatusLabel?: string | null; dataOk?: boolean }) => Promise<void>;
}

export function DtpDataPopover({ blockId, currentStatusId, currentOk, dataOpts, anchorRect, onClose, onSave }: Props) {
  const [statusId, setStatusId] = useState<string>(currentStatusId?.toString() ?? "");
  const [ok, setOk] = useState(currentOk);
  const ref = useRef<HTMLDivElement>(null);
  const isDirtyRef = useRef(false);

  // Sleduj změny
  useEffect(() => {
    const changed = statusId !== (currentStatusId?.toString() ?? "") || ok !== currentOk;
    isDirtyRef.current = changed;
  }, [statusId, ok, currentStatusId, currentOk]);

  // Zavření klikem mimo
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handleClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleClose() {
    if (isDirtyRef.current) {
      const selectedOpt = dataOpts.find((o) => o.id.toString() === statusId);
      onSave(blockId, {
        dataStatusId: statusId ? parseInt(statusId) : null,
        dataStatusLabel: selectedOpt?.label ?? null,
        dataOk: ok,
      });
    }
    onClose();
  }

  // Pozice: pod anchorRect, zarovnáno vlevo
  const top = anchorRect.bottom + window.scrollY + 4;
  const left = Math.min(anchorRect.left + window.scrollX, window.innerWidth - 210);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top,
        left,
        zIndex: 600,
        background: "#1c1c1e",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 12,
        padding: "12px 14px",
        width: 196,
        boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
      }}
    >
      {/* DATA status */}
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 5, fontWeight: 600, letterSpacing: "0.04em" }}>
        Status
      </div>
      <select
        value={statusId}
        onChange={(e) => setStatusId(e.target.value)}
        style={{
          width: "100%",
          background: "#2c2c2e",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 7,
          padding: "6px 10px",
          color: "#e2e8f0",
          fontSize: 13,
          marginBottom: 10,
          cursor: "pointer",
          outline: "none",
        }}
      >
        <option value="">— bez statusu —</option>
        {dataOpts.filter((o) => o.isActive).map((o) => (
          <option key={o.id} value={o.id.toString()}>{o.label}</option>
        ))}
      </select>

      {/* Oddělovač */}
      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", marginBottom: 10 }} />

      {/* dataOk toggle */}
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <div
          onClick={() => setOk((v) => !v)}
          style={{
            width: 36,
            height: 20,
            background: ok ? "#22c55e" : "#3a3a3c",
            borderRadius: 10,
            position: "relative",
            flexShrink: 0,
            transition: "background 150ms ease-out",
            cursor: "pointer",
          }}
        >
          <div style={{
            width: 16,
            height: 16,
            background: "white",
            borderRadius: "50%",
            position: "absolute",
            top: 2,
            left: ok ? 18 : 2,
            transition: "left 150ms ease-out",
            boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
          }} />
        </div>
        <span style={{ fontSize: 13, color: ok ? "#4ade80" : "rgba(255,255,255,0.6)", fontWeight: 500, transition: "color 150ms" }}>
          data.ok
        </span>
      </label>

      {/* Hint */}
      <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.2)", textAlign: "center" }}>
        ukládá se automaticky při zavření
      </div>
    </div>
  );
}
