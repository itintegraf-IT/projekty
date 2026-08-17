"use client";

import { useEffect } from "react";
import { Z_OVERLAY } from "@/lib/zLayers";
import { FONT_STACK, btnDanger } from "@/lib/uiStyles";
import { cascadeDialogTitle, CASCADE_REASON_LABELS, longerBlocksSentence } from "@/lib/cascadeDialogText";
import type { DriftedBlock } from "@/lib/calendarDrift.server";

export type CascadeBlock = {
  id: number;
  orderNumber: string;
  description: string | null;
  startTime: string; // ISO
  endTime: string;   // ISO
  reason: DriftedBlock["reason"];
};

function formatDT(iso: string): string {
  try {
    return new Date(iso).toLocaleString("cs-CZ", {
      timeZone: "Europe/Prague",
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatRange(startIso: string, endIso: string): string {
  return `${formatDT(startIso)}–${formatDT(endIso)}`;
}

export function ShiftCascadeDialog({
  machine,
  conflictingBlocks,
  longerCount,
  onCancel,
  onConfirm,
  busy,
}: {
  machine: string;
  conflictingBlocks: CascadeBlock[];
  longerCount: number;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  // Vzor z ConfirmDialog.tsx:43-50 — Escape zavírá dialog stejně jako klik mimo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const longerSentence = longerBlocksSentence(longerCount);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: Z_OVERLAY.dialogCascade,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT_STACK,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--danger)",
          borderRadius: 12,
          width: "min(680px, 92vw)",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 16px 40px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--danger)" }}>
            {cascadeDialogTitle(machine, conflictingBlocks.length)}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Následující bloky dnes leží v pracovní době stroje a po uložení v ní ležet přestanou.
            Změnu můžeš zrušit a bloky nejdřív přeplánovat, nebo uložit přesto — zůstanou v plánu,
            jen dostanou značku „nesedí na kalendář“.
          </div>
        </div>

        <div style={{ padding: "10px 18px", overflow: "auto", flex: 1 }}>
          <table
            style={{
              width: "100%",
              tableLayout: "fixed",
              borderCollapse: "collapse",
              fontSize: 12,
            }}
          >
            <colgroup>
              <col style={{ width: "16%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "26%" }} />
              <col style={{ width: "34%" }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                  Zakázka
                </th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                  Popis
                </th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                  Od–Do
                </th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                  Proč nesedí
                </th>
              </tr>
            </thead>
            <tbody>
              {conflictingBlocks.map((b) => (
                <tr key={b.id}>
                  <td style={{ padding: "6px 8px", borderBottom: "1px solid color-mix(in oklab, var(--border) 60%, transparent)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={b.orderNumber}>
                    {b.orderNumber}
                  </td>
                  <td
                    style={{ padding: "6px 8px", borderBottom: "1px solid color-mix(in oklab, var(--border) 60%, transparent)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={b.description ?? undefined}
                  >
                    {b.description ?? "—"}
                  </td>
                  <td style={{ padding: "6px 8px", borderBottom: "1px solid color-mix(in oklab, var(--border) 60%, transparent)", whiteSpace: "nowrap" }}>
                    {formatRange(b.startTime, b.endTime)}
                  </td>
                  <td style={{ padding: "6px 8px", borderBottom: "1px solid color-mix(in oklab, var(--border) 60%, transparent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={CASCADE_REASON_LABELS[b.reason]}>
                    {CASCADE_REASON_LABELS[b.reason]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {longerSentence && (
          <div
            style={{
              padding: "0 18px 10px",
              fontSize: 12,
              color: "var(--text-muted)",
              lineHeight: 1.5,
            }}
          >
            {longerSentence}
          </div>
        )}

        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            disabled={busy}
            autoFocus
            onClick={onCancel}
            style={{
              background: "var(--surface-2)",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "7px 14px",
              fontSize: 13,
              cursor: busy ? "not-allowed" : "pointer",
              fontFamily: FONT_STACK,
              opacity: busy ? 0.6 : 1,
            }}
          >
            Zrušit změnu
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            style={{
              ...btnDanger,
              padding: "7px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            Uložit i přesto
          </button>
        </div>
      </div>
    </div>
  );
}
