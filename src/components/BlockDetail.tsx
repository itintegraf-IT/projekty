"use client";

import { useEffect, useState } from "react";
import { Badge }     from "@/components/ui/badge";
import { Button }    from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { type Block } from "@/app/_components/TimelineGrid";
import { type AuditLogEntry } from "@/components/InfoPanel";
import { TYPE_LABELS, TYPE_BUILDER_CONFIG } from "@/lib/plannerTypes";
import { FIELD_LABELS, fmtAuditVal } from "@/lib/auditFormatters";
import { formatCivilDate, formatPragueDateTime, formatPragueDateShort, formatPragueTime } from "@/lib/dateUtils";

// ─── Lokální pomocné funkce ───────────────────────────────────────────────────
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatPragueDateTime(d);
}

function formatDate(iso: string | null): string {
  return formatCivilDate(iso);
}

function durationHuman(startIso: string, endIso: string): string {
  const mins = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h} hod`;
  return `${h} hod ${m} min`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] text-slate-500 w-16 flex-shrink-0">{label}</span>
      <span className="text-slate-300">{value}</span>
    </div>
  );
}

function DeadlineRow({ label, value, ok, date }: { label: string; value: string; ok: boolean; date?: string | null }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] text-slate-500 w-16 flex-shrink-0">{label}</span>
      <span className={value === "—" ? "text-slate-600" : ok ? "text-green-400" : "text-slate-300"}>
        {value}
        {ok && value !== "—" && <span className="ml-1 text-green-500">✓</span>}
        {date && <span className="ml-1 text-slate-500 text-[9px]">({date})</span>}
      </span>
    </div>
  );
}

// ─── BlockDetail ──────────────────────────────────────────────────────────────
export function BlockDetail({
  block,
  onClose,
  onDelete,
  canEdit,
  onBlockUpdate,
}: {
  block: Block;
  onClose: () => void;
  onDelete: (id: number) => void;
  canEdit?: boolean;
  onBlockUpdate?: (updated: Block) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [blockHistory, setBlockHistory] = useState<AuditLogEntry[]>([]);
  const typeCfg = TYPE_BUILDER_CONFIG[block.type as keyof typeof TYPE_BUILDER_CONFIG];

  useEffect(() => {
    fetch(`/api/blocks/${block.id}/audit`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: AuditLogEntry[]) => setBlockHistory(data))
      .catch(() => setBlockHistory([]));
  }, [block.id]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)" }}>
      {/* Hlavička */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{
          borderBottom: "1px solid var(--border)",
          background: "linear-gradient(135deg, color-mix(in oklab, var(--surface-2) 96%, transparent) 0%, var(--surface) 100%)",
        }}
      >
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Detail bloku
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-sm font-bold text-slate-100">{block.orderNumber}</span>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText([block.orderNumber, block.description].filter(Boolean).join(" – "))}
              title="Kopírovat číslo zakázky a popis"
              style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: "1px 3px", lineHeight: 1, transition: "color 120ms ease-out" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Kopírovat
            </button>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-xs text-slate-400">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="15 18 9 12 15 6"/></svg> Zpět
        </Button>
      </div>

      {/* Obsah */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} className="px-4 py-4 space-y-3 text-[11px]">
        <div className="space-y-1.5">
          <Row label="Stroj"   value={block.machine.replace("_", "\u00a0")} />
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] text-slate-500 w-16 flex-shrink-0">Typ</span>
            <Badge
              variant="secondary"
              style={{ fontSize: 10, background: `${typeCfg?.color ?? "var(--text-muted)"}22`, color: typeCfg?.color ?? "var(--text-muted)", border: `1px solid ${typeCfg?.color ?? "var(--text-muted)"}44` }}
            >
              {typeCfg && <typeCfg.icon size={10} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 3 }} />}{TYPE_LABELS[block.type] ?? block.type}
            </Badge>
          </div>
          <Row label="Začátek" value={formatDateTime(block.startTime)} />
          <Row label="Konec"   value={formatDateTime(block.endTime)} />
          <Row label="Délka"   value={durationHuman(block.startTime, block.endTime)} />
          {block.locked && <Row label="Stav" value="Zamčeno" />}
        </div>

        {block.description && (
          <>
            <Separator className="my-1 bg-slate-800" />
            <div className="rounded-md bg-slate-800/40 border border-slate-700/50 px-3 py-2">
              <div className="text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">Popis</div>
              <div className="text-slate-300 leading-relaxed" style={{ whiteSpace: "pre-wrap" }}>{block.description}</div>
            </div>
          </>
        )}

        {(block.dataStatusLabel || block.materialStatusLabel || block.barvyStatusLabel || block.lakStatusLabel || block.specifikace) && (
          <>
            <Separator className="my-1 bg-slate-800" />
            <div className="rounded-md bg-slate-800/40 border border-slate-700/50 px-3 py-2 space-y-1.5">
              <div className="text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">Výrobní sloupečky</div>
              {block.dataStatusLabel && (
                <DeadlineRow label="DATA" value={block.dataStatusLabel} ok={block.dataOk} date={block.dataRequiredDate ? formatDate(block.dataRequiredDate) : null} />
              )}
              {block.materialStatusLabel && (
                <DeadlineRow label="Materiál" value={block.materialStatusLabel} ok={block.materialOk} date={block.materialRequiredDate ? formatDate(block.materialRequiredDate) : null} />
              )}
              {block.barvyStatusLabel && <Row label="Barvy" value={block.barvyStatusLabel} />}
              {block.lakStatusLabel && <Row label="Lak" value={block.lakStatusLabel} />}
              {block.specifikace && <Row label="Spec" value={block.specifikace} />}
            </div>
          </>
        )}
        {block.deadlineExpedice && (
          <>
            <Separator className="my-1 bg-slate-800" />
            <div className="rounded-md bg-slate-800/40 border border-slate-700/50 px-3 py-2">
              <div className="text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">Termín</div>
              <Row label="Expedice" value={formatDate(block.deadlineExpedice)} />
            </div>
          </>
        )}

        {/* Expedice shortcut — jen pro ADMIN/PLANOVAT */}
        {canEdit && block.type === "ZAKAZKA" && (
          <div style={{ margin: "0 16px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Expediční plán</span>
            {!block.deadlineExpedice ? (
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontStyle: "italic" }}>
                Nejdřív vyplň termín expedice
              </span>
            ) : block.expeditionPublishedAt ? (
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/blocks/${block.id}/expedition`, {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "unpublish" }),
                    });
                    if (res.ok) {
                      const updated = await res.json();
                      onBlockUpdate?.(updated);
                    }
                  } catch { /* noop */ }
                }}
                style={{
                  fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 6,
                  background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
                  color: "#ef4444", cursor: "pointer", transition: "all 120ms ease-out",
                }}
              >
                Odebrat z Expedice
              </button>
            ) : (
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/blocks/${block.id}/expedition`, {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "publish" }),
                    });
                    if (res.ok) {
                      const updated = await res.json();
                      onBlockUpdate?.(updated);
                    }
                  } catch { /* noop */ }
                }}
                style={{
                  fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 6,
                  background: "rgba(59,130,246,0.14)", border: "1px solid rgba(59,130,246,0.28)",
                  color: "#3b82f6", cursor: "pointer", transition: "all 120ms ease-out",
                }}
              >
                Zaplánovat do Expedice
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tisk dokončen */}
      {block.printCompletedAt && (
        <div style={{ margin: "0 16px 12px", borderRadius: 8, border: "1px solid rgba(34,197,94,0.3)", overflow: "hidden", background: "rgba(34,197,94,0.06)" }}>
          <div style={{ padding: "7px 12px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "#22c55e", fontWeight: 700 }}>✓ Tisk dokončen</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)", flex: 1 }}>
              {formatPragueDateTime(new Date(block.printCompletedAt))}
              {block.printCompletedByUsername && ` — ${block.printCompletedByUsername}`}
            </span>
          </div>
        </div>
      )}

      {/* Historie změn */}
      {blockHistory.length > 0 && (
        <div style={{ margin: "0 16px 12px", borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ padding: "5px 10px", background: "var(--surface-2)", fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Historie změn
          </div>
          <div style={{ display: "flex", flexDirection: "column", maxHeight: 220, overflowY: "auto" }}>
            {blockHistory.map((log, i) => (
              <div key={log.id} style={{ padding: "5px 10px", borderTop: i > 0 ? "1px solid var(--border)" : undefined, display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ fontSize: 9, color: "var(--text-muted)", whiteSpace: "nowrap", paddingTop: 1, minWidth: 70 }}>
                  {formatPragueDateShort(new Date(log.createdAt))} {formatPragueTime(new Date(log.createdAt))}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", flex: 1 }}>
                  <span style={{ color: "var(--text)", fontWeight: 600 }}>{log.username}</span>
                  {log.action === "UPDATE" && log.field && (
                    <span> · {FIELD_LABELS[log.field] ?? log.field}: <span style={{ color: "var(--text)" }}>{fmtAuditVal(log.oldValue, log.field)} → {fmtAuditVal(log.newValue, log.field)}</span></span>
                  )}
                  {log.action === "CREATE" && <span style={{ color: "#22c55e" }}> · Přidána</span>}
                  {log.action === "DELETE" && <span style={{ color: "#ef4444" }}> · Smazána</span>}
                  {log.action === "EXPEDITION_PUBLISH" && <span style={{ color: "#22c55e" }}> · Zařazena do expedice</span>}
                  {log.action === "EXPEDITION_UNPUBLISH" && <span style={{ color: "#f59e0b" }}> · Odebrána z expedice</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Smazat */}
      <div className="px-4 py-3 border-t border-slate-800">
        {confirming ? (
          <div className="space-y-2">
            <p className="text-[10px] text-slate-400 text-center">Opravdu smazat blok?</p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => onDelete(block.id)}
                className="flex-1 text-xs"
              >
                Smazat
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirming(false)}
                className="flex-1 text-xs border-slate-700 text-slate-300"
              >
                Zrušit
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(true)}
            className="w-full text-xs text-slate-400 hover:text-red-300 hover:bg-red-500/10"
          >
            Smazat blok
          </Button>
        )}
      </div>
    </div>
  );
}
