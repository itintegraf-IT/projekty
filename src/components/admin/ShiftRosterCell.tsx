"use client";

import { useState } from "react";
import type { ShiftType } from "@/lib/shifts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Printer } from "./PrinterCodebook";
import type { ShiftAssignment } from "./ShiftRoster";

type Props = {
  machine: string;
  date: Date;
  shift: ShiftType;
  enabled: boolean;
  assignments: ShiftAssignment[];
  printers: Printer[];
  onChange: () => void | Promise<void>;
};

const FONT_STACK = "-apple-system, BlinkMacSystemFont, sans-serif";
const SEPARATOR = "color-mix(in oklab, var(--border) 70%, transparent)";
const TEXT_PRIMARY = "var(--text)";
const TEXT_SECONDARY = "var(--text-muted)";

const EMPTY_BG = "color-mix(in oklab, var(--warning, #f59e0b) 10%, transparent)";
const FILLED_BG = "color-mix(in oklab, var(--success, #22c55e) 8%, transparent)";
const DISABLED_STRIPE =
  "repeating-linear-gradient(45deg, var(--surface-2) 0 6px, transparent 6px 12px)";

function isoDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function ShiftRosterCell({ machine, date, shift, enabled, assignments, printers, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dateStr = isoDateStr(date);
  const isEmpty = enabled && assignments.length === 0;

  const assign = async (printerId: number) => {
    setBusy(true);
    try {
      const res = await fetch("/api/shift-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machine, date: dateStr, shift, printerId, note: null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        alert(body.error ?? "Chyba při přiřazení.");
        return;
      }
      setOpen(false);
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/shift-assignments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        alert(body.error ?? "Chyba při odebrání.");
        return;
      }
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) {
    return (
      <td
        title="Směna je vypnutá v pracovní době"
        style={{
          background: DISABLED_STRIPE,
          borderLeft: `1px solid ${SEPARATOR}`,
          borderBottom: `1px solid ${SEPARATOR}`,
          cursor: "not-allowed",
          minHeight: 56,
          verticalAlign: "top",
        }}
      />
    );
  }

  const available = printers.filter(
    (p) => p.isActive && !assignments.some((a) => a.printerId === p.id)
  );

  return (
    <td
      style={{
        padding: 0,
        background: isEmpty ? EMPTY_BG : FILLED_BG,
        borderLeft: `1px solid ${SEPARATOR}`,
        borderBottom: `1px solid ${SEPARATOR}`,
        verticalAlign: "top",
        minWidth: 110,
      }}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen(true);
              }
            }}
            style={{
              display: "block",
              width: "100%",
              minHeight: 56,
              padding: "6px 8px",
              textAlign: "left",
              background: "transparent",
              cursor: "pointer",
              fontFamily: FONT_STACK,
              color: TEXT_PRIMARY,
              outline: "none",
            }}
            title={isEmpty ? "Chybí obsazení — kliknutím přiřadíš tiskaře" : "Kliknutím upravit přiřazení"}
          >
            {isEmpty ? (
              <div style={{ color: "var(--warning, #f59e0b)", fontStyle: "italic", fontSize: 12 }}>
                prázdné
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {assignments.map((a) => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    <span style={{ color: TEXT_PRIMARY, fontWeight: 500 }}>{a.printer.name}</span>
                    {a.note && (
                      <span style={{ color: TEXT_SECONDARY, fontSize: 11 }}>({a.note})</span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void remove(a.id);
                      }}
                      disabled={busy}
                      title="Odebrat"
                      style={{
                        marginLeft: "auto",
                        padding: "0 6px",
                        background: "transparent",
                        color: "var(--danger)",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 14,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          side="bottom"
          className="w-56 p-0 border-0"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
            padding: 6,
          }}
        >
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: TEXT_SECONDARY,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            padding: "6px 8px 4px",
          }}>
            Přidat tiskaře
          </div>
          {available.length === 0 ? (
            <div style={{ padding: "8px 10px", fontSize: 12, color: TEXT_SECONDARY }}>
              Žádní další tiskaři
            </div>
          ) : (
            available.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void assign(p.id)}
                disabled={busy}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 10px",
                  background: "transparent",
                  color: TEXT_PRIMARY,
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                  fontFamily: FONT_STACK,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                {p.name}
              </button>
            ))
          )}
        </PopoverContent>
      </Popover>
    </td>
  );
}
