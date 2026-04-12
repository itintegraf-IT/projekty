"use client";
import React, { useState, useEffect, useRef } from "react";
import type { ExpediceItem } from "@/lib/expediceTypes";

type Kind = "MANUAL_JOB" | "INTERNAL_TRANSFER";

const KIND_LABELS: Record<Kind, string> = {
  MANUAL_JOB: "Ruční zakázka",
  INTERNAL_TRANSFER: "Interní závoz",
};

const CS_MONTHS_SHORT = ["led","úno","bře","dub","kvě","čvn","čvc","srp","zář","říj","lis","pro"];
function formatDateCs(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  return `${d.getUTCDate()}. ${CS_MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

interface ExpediceEditorPanelProps {
  item: ExpediceItem;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

export function ExpediceEditorPanel({
  item, onCancel, onSaved, onDeleted, onDirtyChange,
}: ExpediceEditorPanelProps) {
  const isBlock  = item.sourceType === "block";

  // ─── State pro blokový editor (jen expediceNote + doprava) ──────────────────
  const [expediceNote, setExpediceNote] = useState(item.expediceNote ?? "");
  const [doprava,      setDoprava     ] = useState(item.doprava      ?? "");

  // ─── State pro editor ruční položky ─────────────────────────────────────────
  const [kind,        setKind       ] = useState<Kind>(
    item.sourceType === "manual" ? (item.itemKind as Kind) : "MANUAL_JOB"
  );
  const [orderNumber, setOrderNumber] = useState(item.orderNumber ?? "");
  const [description, setDescription] = useState(item.description ?? "");

  // ─── Společné ───────────────────────────────────────────────────────────────
  const [saving,  setSaving ] = useState(false);
  const [error,   setError  ] = useState<string | null>(null);

  // Confirm smazání / odebrat z expedice
  const [confirmAction, setConfirmAction] = useState<"delete" | "unpublish" | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Dirty tracking — porovnat s původními hodnotami
  const dirty = isBlock
    ? (expediceNote !== (item.expediceNote ?? "") || doprava !== (item.doprava ?? ""))
    : (
        kind !== (item.itemKind as Kind) ||
        orderNumber !== (item.orderNumber ?? "") ||
        description !== (item.description ?? "") ||
        expediceNote !== (item.expediceNote ?? "") ||
        doprava !== (item.doprava ?? "")
      );

  // Oznámit parent při změně dirty stavu
  const prevDirtyRef = useRef(false);
  useEffect(() => {
    if (prevDirtyRef.current !== dirty) {
      prevDirtyRef.current = dirty;
      onDirtyChange(dirty);
    }
  }, [dirty, onDirtyChange]);

  // Focusnout confirm tlačítko při zobrazení confirmu
  useEffect(() => {
    if (confirmAction) {
      confirmBtnRef.current?.focus();
    }
  }, [confirmAction]);

  // Keyboard handler pro confirm dialog (Enter = potvrdit, Esc = zrušit)
  useEffect(() => {
    if (!confirmAction) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirmAction();
      } else if (e.key === "Escape") {
        setConfirmAction(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmAction]);

  // Keyboard handler pro uložení formuláře (Enter mimo textarea = uložit)
  useEffect(() => {
    if (confirmAction) return; // confirm dialog má přednost
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA") return; // v textarea Enter přidá řádek
      if (tag === "BUTTON") return;   // tlačítka mají vlastní handler
      if (!dirty || saving) return;
      e.preventDefault();
      handleSave();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmAction, dirty, saving]);

  async function handleSave() {
    if (!isBlock) {
      if (!orderNumber.trim() && !description.trim()) {
        setError("Vyplň alespoň číslo zakázky nebo popis");
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      let res: Response;
      if (isBlock) {
        res = await fetch(`/api/blocks/${item.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expediceNote: expediceNote.trim() || null,
            doprava: doprava.trim() || null,
          }),
        });
      } else {
        res = await fetch(`/api/expedice/manual-items/${item.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            orderNumber: orderNumber.trim() || null,
            description: description.trim() || null,
            expediceNote: expediceNote.trim() || null,
            doprava: doprava.trim() || null,
          }),
        });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Chyba serveru");
      }
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Chyba při ukládání");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmAction() {
    if (!confirmAction) return;
    setSaving(true);
    setError(null);
    setConfirmAction(null);
    try {
      if (confirmAction === "delete") {
        const res = await fetch(`/api/expedice/manual-items/${item.id}`, { method: "DELETE" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? "Chyba při mazání");
        }
        onDeleted();
      } else if (confirmAction === "unpublish") {
        const res = await fetch(`/api/blocks/${item.id}/expedition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "unpublish" }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? "Chyba při odebrání");
        }
        onDeleted(); // reuse: odebrat = zmizí z pohledu
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Chyba");
    } finally {
      setSaving(false);
    }
  }

  async function handleReturnToQueue() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/expedice/manual-items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Chyba serveru");
      }
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Chyba");
    } finally {
      setSaving(false);
    }
  }

  const manualItem = item.sourceType === "manual" ? item : null;
  const isScheduled = manualItem && "date" in manualItem && manualItem.date !== null;

  const sectionLabel: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
    color: "var(--text-muted)", textTransform: "uppercase",
    marginBottom: 4,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "7px 10px", borderRadius: 7,
    background: "var(--surface-2)", border: "1px solid rgba(255,255,255,0.1)",
    color: "var(--text)", fontSize: 12, outline: "none",
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    boxSizing: "border-box",
    transition: "border-color 120ms ease-out, box-shadow 120ms ease-out",
  };

  return (
    <>
    <style>{`
      .expedice-input:focus {
        border-color: rgba(59,130,246,0.6) !important;
        box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
      }
    `}</style>
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* Inline confirm dialog */}
      {confirmAction && (
        <div style={{
          flexShrink: 0, padding: "12px 16px",
          background: "rgba(239,68,68,0.08)",
          borderBottom: "1px solid rgba(239,68,68,0.2)",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
            {confirmAction === "delete"
              ? "Smazat tuto položku?"
              : "Odebrat zakázku z expedice?"
            }
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {confirmAction === "delete"
              ? "Položka bude trvale smazána."
              : "Zakázka zůstane v tiskovém plánu, ale zmizí z expedice."
            }
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setConfirmAction(null)}
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
              ref={confirmBtnRef}
              onClick={handleConfirmAction}
              autoFocus
              style={{
                flex: 1, padding: "6px 0", borderRadius: 7, fontSize: 11,
                fontWeight: 600, cursor: "pointer",
                background: "rgba(239,68,68,0.18)", border: "1px solid rgba(239,68,68,0.35)",
                color: "#ef4444", transition: "all 120ms ease-out",
              }}
            >
              {confirmAction === "delete" ? "Smazat" : "Odebrat"}
            </button>
          </div>
        </div>
      )}

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Blokový editor: jen expediceNote + doprava + info o datu */}
        {isBlock && (
          <>
            <div style={{
              fontSize: 11, color: "var(--text-muted)", background: "var(--surface-2)",
              border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "8px 12px",
              lineHeight: 1.5,
            }}>
              <span style={{ fontWeight: 600, color: "var(--text)" }}>
                {"deadlineExpedice" in item && item.deadlineExpedice
                  ? formatDateCs(item.deadlineExpedice)
                  : "—"
                }
              </span>
              {"machine" in item && item.machine && (
                <span style={{ color: "rgba(255,255,255,0.35)", marginLeft: 6 }}>
                  · {item.machine.replace(/_/g, " ")}
                </span>
              )}
              <div style={{ marginTop: 4, fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                Datum expedice měň přetažením v timeline
              </div>
            </div>

            {item.orderNumber && (
              <div>
                <div style={sectionLabel}>Zakázka</div>
                <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>
                  {item.orderNumber}
                  {item.description && (
                    <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 6 }}>
                      {item.description}
                    </span>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Ruční editor: kind + orderNumber + description */}
        {!isBlock && (
          <>
            <div>
              <div style={sectionLabel}>Typ položky</div>
              <div style={{ display: "flex", gap: 6 }}>
                {(["MANUAL_JOB", "INTERNAL_TRANSFER"] as Kind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    style={{
                      flex: 1, padding: "6px 8px", borderRadius: 7, fontSize: 11,
                      fontWeight: 500, cursor: "pointer", border: "none",
                      background: kind === k ? "rgba(59,130,246,0.18)" : "var(--surface-2)",
                      color: kind === k ? "#3b82f6" : "var(--text-muted)",
                      outline: kind === k ? "1px solid rgba(59,130,246,0.35)" : "1px solid rgba(255,255,255,0.08)",
                      transition: "all 120ms ease-out",
                    }}
                  >
                    {KIND_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={sectionLabel}>Číslo zakázky</div>
              <input
                type="text"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                placeholder={kind === "INTERNAL_TRANSFER" ? "Volitelné" : "Např. 17521"}
                className="expedice-input"
                style={inputStyle}
              />
            </div>

            <div>
              <div style={sectionLabel}>Popis</div>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Název nebo popis zakázky"
                className="expedice-input"
                style={inputStyle}
              />
            </div>
          </>
        )}

        {/* Společné pole: expediceNote */}
        <div>
          <div style={sectionLabel}>Poznámka</div>
          <textarea
            value={expediceNote}
            onChange={(e) => setExpediceNote(e.target.value)}
            placeholder="Interní poznámka pro expedici"
            rows={2}
            className="expedice-input"
            style={{ ...inputStyle, resize: "vertical", minHeight: 52 }}
          />
        </div>

        {/* Společné pole: doprava */}
        <div>
          <div style={sectionLabel}>Doprava / destinace</div>
          <input
            type="text"
            value={doprava}
            onChange={(e) => setDoprava(e.target.value)}
            placeholder="Kam / jak"
            className="expedice-input"
            style={inputStyle}
          />
        </div>

        {/* Vrátit do fronty (jen pro naplánovanou ruční položku) */}
        {isScheduled && (
          <div>
            <button
              onClick={handleReturnToQueue}
              disabled={saving}
              style={{
                width: "100%", padding: "7px 0", borderRadius: 7, fontSize: 11,
                fontWeight: 500, cursor: saving ? "default" : "pointer",
                background: "var(--surface-2)", border: "1px solid rgba(255,255,255,0.1)",
                color: "var(--text-muted)", transition: "all 120ms ease-out",
              }}
            >
              Vrátit do fronty
            </button>
          </div>
        )}
      </div>

      {/* Sticky footer */}
      <div style={{
        flexShrink: 0, padding: "12px 16px",
        borderTop: "1px solid var(--border)",
        display: "flex", flexDirection: "column", gap: 8,
      }}>
        {error && (
          <div style={{ fontSize: 11, color: "#ef4444" }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onCancel}
            disabled={saving}
            style={{
              flex: 1, padding: "7px 0", borderRadius: 8, fontSize: 12,
              fontWeight: 500, cursor: saving ? "default" : "pointer",
              background: "var(--surface-2)", border: "1px solid var(--border)",
              color: "var(--text-muted)", transition: "all 120ms ease-out",
            }}
          >
            Zrušit
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            style={{
              flex: 1, padding: "7px 0", borderRadius: 8, fontSize: 12,
              fontWeight: 600, cursor: (saving || !dirty) ? "default" : "pointer",
              background: dirty ? "rgba(59,130,246,0.16)" : "rgba(59,130,246,0.06)",
              border: "1px solid rgba(59,130,246,0.28)",
              color: dirty ? "#3b82f6" : "rgba(59,130,246,0.4)",
              transition: "all 120ms ease-out",
            }}
          >
            {saving ? "Ukládám..." : "Uložit"}
          </button>
        </div>

        {/* Destruktivní akce */}
        <button
          onClick={() => setConfirmAction(isBlock ? "unpublish" : "delete")}
          disabled={saving}
          style={{
            width: "100%", padding: "6px 0", borderRadius: 8, fontSize: 11,
            fontWeight: 500, cursor: saving ? "default" : "pointer",
            background: "transparent", border: "1px solid rgba(239,68,68,0.18)",
            color: saving ? "rgba(239,68,68,0.3)" : "rgba(239,68,68,0.75)",
            transition: "all 120ms ease-out",
          }}
        >
          {isBlock ? "Odebrat z expedice" : "Smazat položku"}
        </button>
      </div>
    </div>
    </>
  );
}
