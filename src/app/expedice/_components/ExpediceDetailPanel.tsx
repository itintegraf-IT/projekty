"use client";
import React from "react";
import type { ExpediceItem } from "@/lib/expediceTypes";

const CS_MONTHS_SHORT = ["led","úno","bře","dub","kvě","čvn","čvc","srp","zář","říj","lis","pro"];

function formatDateCs(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  return `${d.getUTCDate()}. ${CS_MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const SOURCE_LABEL = {
  block: "Tiskový plán",
  manual: "Ruční položka",
} as const;

const KIND_LABELS: Record<string, string> = {
  PLANNED_JOB: "Tiskový blok",
  MANUAL_JOB: "Ruční zakázka",
  INTERNAL_TRANSFER: "Interní závoz",
};

interface ExpediceDetailPanelProps {
  item: ExpediceItem;
  onEdit: () => void;
  onUnpublish: () => Promise<void>;
}

export function ExpediceDetailPanel({ item, onEdit, onUnpublish }: ExpediceDetailPanelProps) {
  const isBlock  = item.sourceType === "block";
  const isManual = item.sourceType === "manual";

  const [confirmUnpublish, setConfirmUnpublish] = React.useState(false);
  const [unpublishing, setUnpublishing] = React.useState(false);
  const [unpublishError, setUnpublishError] = React.useState<string | null>(null);

  async function handleConfirmUnpublish() {
    setUnpublishing(true);
    setUnpublishError(null);
    try {
      await onUnpublish();
      setConfirmUnpublish(false);
    } catch (e: unknown) {
      setUnpublishError(e instanceof Error ? e.message : "Chyba");
    } finally {
      setUnpublishing(false);
    }
  }

  const date = isBlock
    ? ("deadlineExpedice" in item ? item.deadlineExpedice : null)
    : ("date" in item ? item.date : null);

  const sectionLabel: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
    color: "var(--text-muted)", textTransform: "uppercase",
    marginBottom: 4,
  };

  const fieldValue: React.CSSProperties = {
    fontSize: 12, color: "var(--text)", lineHeight: 1.5,
  };

  const fieldEmpty: React.CSSProperties = {
    fontSize: 12, color: "rgba(255,255,255,0.25)", fontStyle: "italic",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Typ / zdroj */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
            padding: "2px 7px", borderRadius: 5,
            background: isBlock ? "rgba(59,130,246,0.15)" : "rgba(34,197,94,0.15)",
            color: isBlock ? "#3b82f6" : "#22c55e",
          }}>
            {SOURCE_LABEL[item.sourceType]}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
            padding: "2px 7px", borderRadius: 5,
            background: "rgba(255,255,255,0.06)", color: "var(--text-muted)",
          }}>
            {KIND_LABELS[item.itemKind] ?? item.itemKind}
          </span>
          {isBlock && (
            <span style={{
              fontSize: 10, padding: "2px 7px", borderRadius: 5,
              background: "rgba(34,197,94,0.1)", color: "#22c55e",
            }}>
              V expedici
            </span>
          )}
          {isManual && !date && (
            <span style={{
              fontSize: 10, padding: "2px 7px", borderRadius: 5,
              background: "rgba(255,255,255,0.06)", color: "var(--text-muted)",
            }}>
              Ve frontě
            </span>
          )}
        </div>

        {/* Číslo zakázky */}
        {item.orderNumber && (
          <div>
            <div style={sectionLabel}>Číslo zakázky</div>
            <div style={fieldValue}>{item.orderNumber}</div>
          </div>
        )}

        {/* Popis */}
        <div>
          <div style={sectionLabel}>Popis</div>
          {item.description
            ? <div style={fieldValue}>{item.description}</div>
            : <div style={fieldEmpty}>—</div>
          }
        </div>

        {/* Datum expedice / stav */}
        <div>
          <div style={sectionLabel}>{isManual && !date ? "Stav" : "Datum expedice"}</div>
          {date
            ? <div style={fieldValue}>{formatDateCs(date)}</div>
            : <div style={fieldEmpty}>Ve frontě — přetáhni na den v timeline</div>
          }
        </div>

        {/* Stroj (jen pro block) */}
        {isBlock && "machine" in item && item.machine && (
          <div>
            <div style={sectionLabel}>Stroj</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {item.machine.replace(/_/g, " ")}
            </div>
          </div>
        )}

        {/* Poznámka */}
        <div>
          <div style={sectionLabel}>Poznámka</div>
          {item.expediceNote
            ? <div style={{ ...fieldValue, whiteSpace: "pre-wrap" }}>{item.expediceNote}</div>
            : <div style={fieldEmpty}>—</div>
          }
        </div>

        {/* Doprava */}
        <div>
          <div style={sectionLabel}>Doprava / destinace</div>
          {item.doprava
            ? <div style={fieldValue}>{item.doprava}</div>
            : <div style={fieldEmpty}>—</div>
          }
        </div>
      </div>

      {/* Confirm unpublish overlay */}
      {isBlock && confirmUnpublish && (
        <div style={{
          flexShrink: 0, padding: "12px 16px",
          background: "rgba(239,68,68,0.08)",
          borderBottom: "1px solid rgba(239,68,68,0.2)",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
            Odebrat zakázku z expedice?
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Zakázka zůstane v tiskovém plánu, ale zmizí z expedice.
          </div>
          {unpublishError && (
            <div style={{ fontSize: 11, color: "#ef4444" }}>{unpublishError}</div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setConfirmUnpublish(false)}
              style={{
                flex: 1, padding: "6px 0", borderRadius: 7, fontSize: 11,
                fontWeight: 600, cursor: "pointer",
                background: "var(--surface-2)", border: "1px solid var(--border)",
                color: "var(--text)", transition: "all 120ms ease-out",
              }}
            >
              Zpět
            </button>
            <button
              onClick={handleConfirmUnpublish}
              disabled={unpublishing}
              style={{
                flex: 1, padding: "6px 0", borderRadius: 7, fontSize: 11,
                fontWeight: 600, cursor: unpublishing ? "default" : "pointer",
                background: "rgba(239,68,68,0.18)", border: "1px solid rgba(239,68,68,0.35)",
                color: unpublishing ? "rgba(239,68,68,0.5)" : "#ef4444",
                transition: "all 120ms ease-out",
              }}
            >
              {unpublishing ? "Odebírám..." : "Odebrat"}
            </button>
          </div>
        </div>
      )}

      {/* Sticky footer */}
      <div style={{
        flexShrink: 0, padding: "12px 16px",
        borderTop: "1px solid var(--border)",
        display: "flex", flexDirection: "column", gap: 8,
      }}>
        <button
          onClick={onEdit}
          style={{
            width: "100%", padding: "7px 16px", borderRadius: 8,
            background: "rgba(59,130,246,0.14)",
            border: "1px solid rgba(59,130,246,0.28)",
            color: "#3b82f6",
            fontSize: 12, fontWeight: 600, cursor: "pointer",
            transition: "all 120ms ease-out",
          }}
        >
          Upravit
        </button>

        {isBlock && (
          <button
            onClick={() => setConfirmUnpublish(true)}
            disabled={confirmUnpublish || unpublishing}
            style={{
              width: "100%", padding: "7px 16px", borderRadius: 8,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              color: (confirmUnpublish || unpublishing) ? "rgba(239,68,68,0.4)" : "#ef4444",
              fontSize: 12, fontWeight: 500,
              cursor: (confirmUnpublish || unpublishing) ? "default" : "pointer",
              transition: "all 120ms ease-out",
            }}
          >
            Odebrat z expedice
          </button>
        )}
      </div>
    </div>
  );
}
