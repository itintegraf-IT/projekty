"use client";

import { useEffect, useRef, useState } from "react";
import type { CodebookOption } from "@/lib/plannerTypes";
import { Z_OVERLAY } from "@/lib/zLayers";

interface Props {
  blockId: number;
  currentStatusId: number | null;
  dataOpts: CodebookOption[];
  anchorRect: DOMRect;
  onClose: () => void;
  onSave: (blockId: number, patch: { dataStatusId?: number | null; dataStatusLabel?: string | null; dataOk?: boolean }) => Promise<void>;
}

export function DtpDataPopover({ blockId, currentStatusId, dataOpts, anchorRect, onClose, onSave }: Props) {
  const [statusId, setStatusId] = useState<string>(currentStatusId?.toString() ?? "");
  const ref = useRef<HTMLDivElement>(null);
  const isDirtyRef = useRef(false);
  const statusIdRef = useRef(statusId);

  // Sleduj změny
  useEffect(() => {
    const changed = statusId !== (currentStatusId?.toString() ?? "");
    isDirtyRef.current = changed;
  }, [statusId, currentStatusId]);

  // Udržuj ref aktuální pro handleClose
  useEffect(() => {
    statusIdRef.current = statusId;
  }, [statusId]);

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
      const currentStatusId = statusIdRef.current;
      const selectedOpt = dataOpts.find((o) => o.id.toString() === currentStatusId);
      onSave(blockId, {
        dataStatusId: currentStatusId ? parseInt(currentStatusId, 10) : null,
        dataStatusLabel: selectedOpt?.label ?? null,
        dataOk: !!currentStatusId,
      });
    }
    onClose();
  }

  // Pozice: pod anchorRect, zarovnáno vlevo (position: fixed je relativní k viewportu, ne k dokumentu)
  const top = anchorRect.bottom + 4;
  const left = Math.max(4, Math.min(anchorRect.left, window.innerWidth - 210));

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top,
        left,
        zIndex: Z_OVERLAY.dataPopover,
        background: "var(--popover)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "12px 14px",
        width: 196,
        boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
      }}
    >
      {/* DATA status */}
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 5, fontWeight: 600, letterSpacing: "0.04em" }}>
        Status
      </div>
      <select
        value={statusId}
        onChange={(e) => setStatusId(e.target.value)}
        style={{
          width: "100%",
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          padding: "6px 10px",
          color: "var(--text)",
          fontSize: 13,
          cursor: "pointer",
          outline: "none",
        }}
      >
        <option value="">— bez statusu —</option>
        {dataOpts.filter((o) => o.isActive).map((o) => (
          <option key={o.id} value={o.id.toString()}>{o.label}</option>
        ))}
      </select>

      {/* Hint */}
      <div style={{ marginTop: 10, fontSize: 10, color: "color-mix(in oklab, var(--text) 25%, transparent)", textAlign: "center" }}>
        ukládá se automaticky při zavření
      </div>
    </div>
  );
}
