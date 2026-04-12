"use client";
import React, { useState } from "react";
import type { ExpediceCandidate } from "@/lib/expediceTypes";

const CS_MONTHS_SHORT = ["led","úno","bře","dub","kvě","čvn","čvc","srp","zář","říj","lis","pro"];

function formatDateCs(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  return `${d.getUTCDate()}. ${CS_MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

interface ExpediceAsideProps {
  candidates: ExpediceCandidate[];
  onPublish: (blockId: number) => Promise<void>;
  width?: number;
}

export function ExpediceAside({ candidates, onPublish, width = 320 }: ExpediceAsideProps) {
  return (
    <aside style={{
      width,
      flexShrink: 0,
      borderLeft: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      {/* Sekce: Kandidáti */}
      <div style={{
        padding: "14px 16px 10px",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
          color: "var(--text-muted)", textTransform: "uppercase",
        }}>
          Kandidáti z tiskového plánu
        </div>
        {candidates.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
            {candidates.length} {candidates.length === 1 ? "zakázka čeká" : candidates.length < 5 ? "zakázky čekají" : "zakázek čeká"}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
        {candidates.length === 0 ? (
          <div style={{
            fontSize: 12, color: "var(--text-muted)",
            padding: "16px 4px", lineHeight: 1.5,
          }}>
            Žádní kandidáti — všechny zakázky s termínem expedice jsou zaplánované.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {candidates.map((c) => (
              <CandidateCard key={c.id} candidate={c} onPublish={onPublish} />
            ))}
          </div>
        )}
      </div>

      {/* Sekce: Fronta — placeholder pro Etapu C */}
      <div style={{
        borderTop: "1px solid var(--border)",
        padding: "12px 16px",
        flexShrink: 0,
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
          color: "var(--text-muted)", textTransform: "uppercase",
          marginBottom: 6,
        }}>
          Fronta k naplánování
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontStyle: "italic" }}>
          Builder a fronta — Etapa C
        </div>
      </div>
    </aside>
  );
}

// ─── CandidateCard ────────────────────────────────────────────────────────────

function CandidateCard({
  candidate,
  onPublish,
}: {
  candidate: ExpediceCandidate;
  onPublish: (id: number) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error,   setError  ] = useState<string | null>(null);

  async function handlePublish() {
    setLoading(true);
    setError(null);
    try {
      await onPublish(candidate.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Chyba");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      padding: "8px 10px", borderRadius: 8,
      background: "var(--surface-2)",
      border: "1px solid rgba(255,255,255,0.07)",
      display: "flex", flexDirection: "column", gap: 5,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: "var(--text)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {candidate.orderNumber}
          </div>
          {candidate.description && (
            <div style={{
              fontSize: 10, color: "var(--text-muted)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {candidate.description}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10, color: "rgba(249,115,22,0.85)", fontWeight: 500 }}>
          {formatDateCs(candidate.deadlineExpedice)}
          <span style={{ marginLeft: 4, color: "var(--text-muted)" }}>
            · {candidate.machine.replace("_", " ")}
          </span>
        </div>
        <button
          onClick={handlePublish}
          disabled={loading}
          style={{
            fontSize: 10, fontWeight: 600, letterSpacing: "0.03em",
            padding: "3px 10px", borderRadius: 6,
            background: loading ? "rgba(59,130,246,0.07)" : "rgba(59,130,246,0.16)",
            border: "1px solid rgba(59,130,246,0.28)",
            color: loading ? "rgba(59,130,246,0.5)" : "#3b82f6",
            cursor: loading ? "default" : "pointer",
            transition: "all 120ms ease-out",
          }}
        >
          {loading ? "..." : "Zaplánovat"}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 10, color: "#ef4444" }}>{error}</div>
      )}
    </div>
  );
}
