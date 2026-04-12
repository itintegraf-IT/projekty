"use client";
import React, { useState } from "react";
import type { ExpediceCandidate, ExpediceItem, ExpediceManualItem } from "@/lib/expediceTypes";
import { ExpediceBuilderPanel } from "./ExpediceBuilderPanel";
import { ExpediceQueuePanel } from "./ExpediceQueuePanel";
import { ExpediceDetailPanel } from "./ExpediceDetailPanel";
import { ExpediceEditorPanel } from "./ExpediceEditorPanel";

const CS_MONTHS_SHORT = ["led","úno","bře","dub","kvě","čvn","čvc","srp","zář","říj","lis","pro"];
function formatDateCs(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  return `${d.getUTCDate()}. ${CS_MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export type AsidePanelMode = "builder" | "detail" | "edit";

interface ExpediceAsideProps {
  panelMode: AsidePanelMode;
  selectedItem: ExpediceItem | null;
  candidates: ExpediceCandidate[];
  queueItems: ExpediceManualItem[];
  selectedKey: string | null;
  isDirty: boolean;
  width?: number;
  onPublish: (blockId: number) => Promise<void>;
  onUnpublish: (blockId: number) => Promise<void>;
  onSwitchToEdit: () => void;
  onSwitchToDetail: () => void;
  onSwitchToBuilder: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onDeleted: () => void;
  onSelectQueueItem: (item: ExpediceManualItem) => void;
  // Drag & drop
  draggedItem?: ExpediceItem | null;
  onDragStartItem?: (item: ExpediceItem) => void;
  onDragEndItem?: () => void;
  onDropOnQueue?: () => void;
}

export function ExpediceAside({
  panelMode,
  selectedItem,
  candidates,
  queueItems,
  selectedKey,
  isDirty,
  width = 320,
  onPublish,
  onUnpublish,
  onSwitchToEdit,
  onSwitchToDetail,
  onSwitchToBuilder,
  onDirtyChange,
  onSaved,
  onDeleted,
  onSelectQueueItem,
  draggedItem,
  onDragStartItem,
  onDragEndItem,
  onDropOnQueue,
}: ExpediceAsideProps) {

  // Dirty guard: pokud je dirty a uživatel klikne "Zrušit" nebo přepíná, nabídneme potvrzení
  const [showDirtyGuard, setShowDirtyGuard] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  function guardedAction(action: () => void) {
    if (isDirty) {
      setPendingAction(() => action);
      setShowDirtyGuard(true);
    } else {
      action();
    }
  }

  function handleCancelEdit() {
    guardedAction(onSwitchToDetail);
  }

  function handleCancelToBuilder() {
    guardedAction(onSwitchToBuilder);
  }

  function confirmDiscard() {
    setShowDirtyGuard(false);
    onDirtyChange(false);
    pendingAction?.();
    setPendingAction(null);
  }

  function cancelDiscard() {
    setShowDirtyGuard(false);
    setPendingAction(null);
  }

  // Titulek panelu dle stavu
  const title =
    panelMode === "edit" ? "Upravit"
    : panelMode === "detail" ? "Detail"
    : "Expedice";

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
      {/* Panel header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "0 16px", height: 40, flexShrink: 0,
        borderBottom: "1px solid var(--border)",
      }}>
        {/* Zpět tlačítko v detail/edit stavu */}
        {(panelMode === "detail" || panelMode === "edit") && (
          <button
            onClick={panelMode === "edit" ? handleCancelEdit : handleCancelToBuilder}
            style={{
              background: "transparent", border: "none", padding: 0,
              cursor: "pointer", color: "var(--text-muted)",
              fontSize: 11, display: "flex", alignItems: "center", gap: 3,
              transition: "color 120ms ease-out",
            }}
          >
            ← Zpět
          </button>
        )}
        <span style={{
          fontSize: 12, fontWeight: 600, color: "var(--text)",
          flex: panelMode === "builder" ? 1 : undefined,
        }}>
          {title}
        </span>
        {panelMode === "detail" && selectedItem && (
          <button
            onClick={onSwitchToEdit}
            style={{
              marginLeft: "auto", background: "transparent", border: "none",
              padding: "3px 10px", borderRadius: 6, cursor: "pointer",
              fontSize: 11, fontWeight: 500, color: "#3b82f6",
              transition: "all 120ms ease-out",
            }}
          >
            Upravit
          </button>
        )}
      </div>

      {/* Dirty guard overlay */}
      {showDirtyGuard && (
        <div style={{
          flexShrink: 0, padding: "12px 16px",
          background: "rgba(234,179,8,0.07)",
          borderBottom: "1px solid rgba(234,179,8,0.2)",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
            Zahodit změny?
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Máš neuložené změny. Přejít bez uložení?
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={cancelDiscard}
              autoFocus
              style={{
                flex: 1, padding: "6px 0", borderRadius: 7, fontSize: 11,
                fontWeight: 600, cursor: "pointer",
                background: "rgba(59,130,246,0.14)", border: "1px solid rgba(59,130,246,0.28)",
                color: "#3b82f6", transition: "all 120ms ease-out",
              }}
            >
              Pokračovat v editaci
            </button>
            <button
              onClick={confirmDiscard}
              style={{
                flex: 1, padding: "6px 0", borderRadius: 7, fontSize: 11,
                fontWeight: 500, cursor: "pointer",
                background: "var(--surface-2)", border: "1px solid var(--border)",
                color: "var(--text-muted)", transition: "all 120ms ease-out",
              }}
            >
              Zahodit
            </button>
          </div>
        </div>
      )}

      {/* ─── Panely ─────────────────────────────────────────────────────────────── */}

      {/* DETAIL */}
      {panelMode === "detail" && selectedItem && (
        <ExpediceDetailPanel
          item={selectedItem}
          onEdit={onSwitchToEdit}
          onUnpublish={async () => {
            if (selectedItem.sourceType !== "block") return;
            await onUnpublish(selectedItem.id);
          }}
        />
      )}

      {/* EDIT */}
      {panelMode === "edit" && selectedItem && (
        <ExpediceEditorPanel
          item={selectedItem}
          onCancel={handleCancelEdit}
          onSaved={onSaved}
          onDeleted={onDeleted}
          onDirtyChange={onDirtyChange}
        />
      )}

      {/* BUILDER + CANDIDATES + QUEUE */}
      {panelMode === "builder" && (
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>

          {/* Builder */}
          <div style={{ flexShrink: 0 }}>
            <SectionHeader label="Nová položka" />
            <ExpediceBuilderPanel onCreated={onSaved} />
          </div>

          {/* Kandidáti */}
          <div style={{ flexShrink: 0, borderTop: "1px solid var(--border)" }}>
            <SectionHeader
              label="Kandidáti z tiskového plánu"
              count={candidates.length}
              countSuffix={candidates.length === 1 ? "čeká" : candidates.length < 5 ? "čekají" : "čeká"}
            />
            <div style={{ padding: "0 12px 10px" }}>
              {candidates.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "10px 4px", lineHeight: 1.5 }}>
                  Žádní kandidáti — všechny zakázky jsou zaplánované.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {candidates.map((c) => (
                    <CandidateCard key={c.id} candidate={c} onPublish={onPublish} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Fronta */}
          <div style={{ flexShrink: 0, borderTop: "1px solid var(--border)" }}>
            <SectionHeader
              label="Fronta k naplánování"
              count={queueItems.length}
              countSuffix={queueItems.length === 1 ? "položka" : queueItems.length < 5 ? "položky" : "položek"}
            />
            <div style={{ padding: "0 12px 16px" }}>
              <ExpediceQueuePanel
                items={queueItems}
                selectedKey={selectedKey}
                onSelectItem={onSelectQueueItem}
                draggedItem={draggedItem}
                onDragStartItem={onDragStartItem}
                onDragEndItem={onDragEndItem}
                onDropOnQueue={onDropOnQueue}
              />
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SectionHeader({ label, count, countSuffix }: {
  label: string;
  count?: number;
  countSuffix?: string;
}) {
  return (
    <div style={{ padding: "12px 16px 8px" }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
        color: "var(--text-muted)", textTransform: "uppercase",
      }}>
        {label}
      </div>
      {count !== undefined && count > 0 && countSuffix && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          {count} {countSuffix}
        </div>
      )}
    </div>
  );
}

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

      {(candidate.expediceNote || candidate.doprava) && (
        <div style={{
          fontSize: 10, color: "rgba(255,255,255,0.38)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {[candidate.expediceNote, candidate.doprava].filter(Boolean).join(" · ")}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10, color: "rgba(249,115,22,0.85)", fontWeight: 500 }}>
          {formatDateCs(candidate.deadlineExpedice)}
          <span style={{ marginLeft: 4, color: "var(--text-muted)" }}>
            · {candidate.machine.replace(/_/g, " ")}
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
