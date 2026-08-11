"use client";

import { useEffect, useState } from "react";
import { Badge }     from "@/components/ui/badge";
import { Button }    from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { type Block } from "@/app/_components/TimelineGrid";
import { type BlockHistoryEntry } from "@/lib/blockHistory";
import { TYPE_LABELS, TYPE_BUILDER_CONFIG } from "@/lib/plannerTypes";
import { FIELD_LABELS, fmtAuditVal, classifyUndoRedoField } from "@/lib/auditFormatters";
import { formatCivilDate, formatPragueDateTime, formatPragueDateShort, formatPragueTime } from "@/lib/dateUtils";
import DatePickerField from "@/app/_components/DatePickerField";
import { getSplitChipState } from "@/lib/splitHelpers";
import { copyTextToClipboard } from "@/lib/clipboardCopy";
import { formatProductionTags, PRODUCTION_CHIP_COLORS } from "@/lib/productionTags";
import { blockPrintMinutes, formatPrintHoursShort, splitGroupTotalPrintMinutes, type CalendarDriftInfo } from "@/lib/printTimeClient";
import { isParkedDrift } from "@/lib/calendarDriftUi";

// ─── Lokální pomocné funkce ───────────────────────────────────────────────────
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatPragueDateTime(d);
}

function formatDate(iso: string | null): string {
  return formatCivilDate(iso);
}

function minsToHuman(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h} hod`;
  return `${h} hod ${m} min`;
}

/**
 * Řádek „Délka" v detailu bloku: ZAKAZKA s tiskovými minutami odlišnými od
 * uplynulého času bloku (blok obsahuje pauzu přes odstávku/mimo provoz) zobrazí
 * obojí — kolik reálně tiskne stroj a kolik trvá blok na časové ose celkem.
 * Jinak (rovnají se, nebo ne-ZAKAZKA) zůstává dnešní jednoduchý text.
 */
function blockLengthLabel(block: Block): string {
  const elapsedMins = Math.round((new Date(block.endTime).getTime() - new Date(block.startTime).getTime()) / 60000);
  if (block.type !== "ZAKAZKA") return minsToHuman(elapsedMins);
  const pm = blockPrintMinutes(block);
  if (pm === elapsedMins) return minsToHuman(elapsedMins);
  return `${minsToHuman(pm)} tisku (${minsToHuman(elapsedMins)} celkem)`;
}

/** Nadpis drift sekce podle `reason` (Task 6, etapa 7) — místo jednoho fixního textu
 * pro všechny případy, které `blockCalendarDrift`/`detectCalendarDrift` mohou vrátit.
 * `Record` nad unionem je záměrný: nový důvod nejde přidat bez doplnění titulku. */
const DRIFT_TITLES: Record<CalendarDriftInfo["reason"], string> = {
  END_MISMATCH: "Blok nesedí na kalendář",
  START_NOT_RUNNABLE: "Start bloku je mimo provoz stroje",
  HORIZON_EXCEEDED: "Blok nejde podle kalendáře dopočítat",
  PARKED: "Odložená mimo pracovní dobu",
  STALE_BYPASS: 'Zbytková značka „odložené mimo pracovní dobu“',
};

/** Druhý řádek pod nadpisem — u odložených vysvětluje, co udělá „Přepočítat". */
const DRIFT_HINTS: Partial<Record<CalendarDriftInfo["reason"], string>> = {
  PARKED: "Tiskne slitě, bez pauz směn. Přepočítat ji vrátí do kalendáře pracovní doby.",
  STALE_BYPASS: "Geometrie kalendáři odpovídá. Přepočítat jen zruší značku, plánem nehne.",
};

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
  allBlocks,
  calendarDrift,
  onReflow,
}: {
  block: Block;
  onClose: () => void;
  onDelete: (id: number, rejectionReason?: string) => void;
  canEdit?: boolean;
  onBlockUpdate?: (updated: Block) => void;
  allBlocks?: Block[];
  /** Drift kalendáře (etapa 6) — spočítáno v PlannerPage (má weekShifts/companyDays ve state). */
  calendarDrift?: CalendarDriftInfo | null;
  /** POST [id]/reflow — jen ADMIN/PLANOVAT (PlannerPage předává undefined pro ostatní role). */
  onReflow?: (blockId: number) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [detailRejectionReason, setDetailRejectionReason] = useState("");
  const [reflowing, setReflowing] = useState(false);
  // Sloučená osa AuditLog + BlockRevision. VLASTNÍ typ, ne `AuditLogEntry`:
  // ten má v repu dvě nezávislé definice pro jiné endpointy (viz blockHistory.ts).
  const [blockHistory, setBlockHistory] = useState<BlockHistoryEntry[]>([]);
  const [reservation, setReservation] = useState<{
    id: number;
    code: string;
    status: string;
    companyName: string;
    requestedExpeditionDate: string | null;
    requestedDataDate: string | null;
    requestedByUsername: string;
    counterProposedExpeditionDate: string | null;
    counterProposedByUsername: string | null;
  } | null>(null);
  const [resLoading, setResLoading] = useState(false);
  const [resAction, setResAction] = useState<string | null>(null);
  const [resError, setResError] = useState<string | null>(null);
  const [showCounterForm, setShowCounterForm] = useState(false);
  const [counterExpDate, setCounterExpDate] = useState("");
  const [counterDataDate, setCounterDataDate] = useState("");
  const [counterReason, setCounterReason] = useState("");
  const typeCfg = TYPE_BUILDER_CONFIG[block.type as keyof typeof TYPE_BUILDER_CONFIG];

  useEffect(() => {
    fetch(`/api/blocks/${block.id}/audit`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: BlockHistoryEntry[]) => setBlockHistory(data))
      .catch(() => setBlockHistory([]));
  }, [block.id]);

  useEffect(() => {
    if (!block.reservationId) { setReservation(null); return; }
    setResLoading(true);
    fetch(`/api/reservations/${block.reservationId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setReservation(data))
      .catch(() => setReservation(null))
      .finally(() => setResLoading(false));
  }, [block.reservationId]);

  async function handleResAction(action: string, extra?: Record<string, unknown>) {
    if (!reservation) return;
    setResAction(action);
    setResError(null);
    try {
      const res = await fetch(`/api/reservations/${reservation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Chyba");
      }
      const updated = await res.json();
      setReservation(updated);
      setShowCounterForm(false);
      setCounterExpDate("");
      setCounterDataDate("");
      setCounterReason("");
      // Aktualizovat blok v PlannerPage — SSE neposílá event zpět autorovi změny
      if ((action === "confirm" || action === "accept-counter") && updated.confirmedAt && onBlockUpdate) {
        onBlockUpdate({ ...block, reservationConfirmedAt: updated.confirmedAt });
      }
    } catch (err: unknown) {
      setResError(err instanceof Error ? err.message : "Chyba");
    } finally {
      setResAction(null);
    }
  }

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
              onClick={() => void copyTextToClipboard([block.orderNumber, block.description].filter(Boolean).join(" – "))}
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
          <Row label="Délka"   value={blockLengthLabel(block)} />
          {/* Σ tiskový čas celé split skupiny (bod 18 auditu) */}
          {block.splitGroupId != null && allBlocks && (() => {
            const siblings = allBlocks.filter(
              (b) => b.splitGroupId === block.splitGroupId
            );
            if (siblings.length < 2) return null;
            return (
              <Row
                label="Skupina"
                value={`${formatPrintHoursShort(splitGroupTotalPrintMinutes(siblings))} tisku celkem (${siblings.length} částí)`}
              />
            );
          })()}
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

        {(block.dataStatusLabel || block.materialStatusLabel || block.barvyStatusLabel || block.lakStatusLabel || block.specifikace || block.materialInStock || block.materialIssued || block.pantoneInStock || block.pantoneIssued || block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) && (
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
              {(block.materialInStock || block.materialIssued) && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] text-slate-500 w-16 flex-shrink-0">Sklad</span>
                  <span className={block.materialIssued ? "text-blue-400 font-semibold" : "text-green-400 font-semibold"}>
                    {block.materialIssued ? "Vydáno ➜" : "Skladem ✓"}
                  </span>
                </div>
              )}
              {(block.pantoneInStock || block.pantoneIssued) && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] text-slate-500 w-16 flex-shrink-0">Pantone</span>
                  <span className={block.pantoneIssued ? "text-blue-400 font-semibold" : "text-green-400 font-semibold"}>
                    {block.pantoneIssued ? "Vydáno ➜" : "Skladem ✓"}
                  </span>
                </div>
              )}
              {block.barvyStatusLabel && <Row label="Barvy" value={block.barvyStatusLabel} />}
              {block.lakStatusLabel && <Row label="Lak" value={block.lakStatusLabel} />}
              {block.specifikace && <Row label="Spec" value={block.specifikace} />}
              {(block.obalka || block.vnitrky) && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] text-slate-500 w-16 flex-shrink-0">Typ tisku</span>
                  <span className="flex gap-1.5">
                    {block.obalka && <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded" style={{ background: PRODUCTION_CHIP_COLORS.obalka.bg, color: PRODUCTION_CHIP_COLORS.obalka.fg }}>OBÁLKA</span>}
                    {block.vnitrky && <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded" style={{ background: PRODUCTION_CHIP_COLORS.vnitrky.bg, color: PRODUCTION_CHIP_COLORS.vnitrky.fg }}>VNITŘKY</span>}
                  </span>
                </div>
              )}
              {/* Detail záměrně verbose — plné labely přes formatProductionTags (ne compactTagChip
                  jako chip na bloku); tady je prostor a chceme jednoznačnost. */}
              {block.tiskoveArchy && <Row label="Tiskové archy" value={formatProductionTags(block.tiskoveArchy)} />}
              {block.serie && <Row label="Série" value={formatProductionTags(block.serie)} />}
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

        {/* Drift kalendáře (etapa 6) — uložený start/end bloku nesedí na aktuální
            kalendář pracovní doby/odstávek. Informace pro všechny role; tlačítko
            „Přepočítat" jen když volající předá onReflow (PlannerPage gatuje na
            ADMIN/PLANOVAT stejně jako ostatní editační akce v tomto komponentu). */}
        {calendarDrift && (
          <>
            <Separator className="my-1 bg-slate-800" />
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 space-y-1.5">
              {/* Piktogram se řídí týmž rozlišením jako štítek na kartě: odložení je stav
                  (⏸), drift kalendáře porucha (⚠). Jinak by karta a detail téže zakázky
                  říkaly každý něco jiného. */}
              <div className="text-[10px] font-semibold text-amber-400 flex items-center gap-1">
                {isParkedDrift(calendarDrift.reason) ? "⏸" : "⚠"} {DRIFT_TITLES[calendarDrift.reason]}
              </div>
              {calendarDrift.reason === "END_MISMATCH" && calendarDrift.expectedEnd && (
                <div className="text-slate-400">
                  (správně do {formatPragueDateTime(calendarDrift.expectedEnd)})
                </div>
              )}
              {DRIFT_HINTS[calendarDrift.reason] && (
                <div className="text-slate-400">{DRIFT_HINTS[calendarDrift.reason]}</div>
              )}
              {calendarDrift.reason === "PARKED" && calendarDrift.expectedEnd && (
                <div className="text-slate-400">
                  (po přepočtu do {formatPragueDateTime(calendarDrift.expectedEnd)})
                </div>
              )}
              {onReflow && (
                <button
                  onClick={async () => {
                    setReflowing(true);
                    try {
                      await onReflow(block.id);
                    } finally {
                      setReflowing(false);
                    }
                  }}
                  disabled={reflowing}
                  style={{
                    fontSize: 10, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "none",
                    background: "#f59e0b", color: "#1f2937",
                    cursor: reflowing ? "not-allowed" : "pointer", opacity: reflowing ? 0.6 : 1,
                  }}
                >
                  {reflowing ? "Přepočítávám…" : "Přepočítat"}
                </button>
              )}
            </div>
          </>
        )}

        {/* Druhá část splitu — informačně pro všechny role */}
        {(() => {
          if (!allBlocks || block.splitGroupId == null) return null;
          const partner = allBlocks.find(
            (b) =>
              b.id !== block.id &&
              b.splitGroupId === block.splitGroupId &&
              b.machine !== block.machine
          );
          if (!partner) return null;
          const { state, time } = getSplitChipState(partner);
          const timeStr = formatPragueDateTime(time);
          return (
            <>
              <Separator className="my-1 bg-slate-800" />
              <div style={{ borderRadius: 12, background: "var(--surface-2)", padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--text-muted)", marginBottom: 6 }}>
                  Druhá část
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>Stroj</span>
                  <span style={{ fontWeight: 600 }}>{partner.machine.replace("_", " ")}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>Stav</span>
                  <span style={{ fontWeight: 600, color: state === "done" ? "var(--success, #34c759)" : "var(--warning, #ff9500)" }}>
                    {state === "done" ? "Hotovo" : "Čeká"}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>{state === "done" ? "Vytištěno" : "Plán"}</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{timeStr}</span>
                </div>
                {state === "done" && partner.printCompletedByUsername && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span>Tiskl</span>
                    <span style={{ fontWeight: 600 }}>{partner.printCompletedByUsername}</span>
                  </div>
                )}
              </div>
            </>
          );
        })()}

        {/* Rezervace — zobrazit jen pokud blok má reservationId */}
        {block.reservationId && reservation && (
          <>
            <Separator className="my-1 bg-slate-800" />
            <div style={{ borderRadius: 8, border: "1px solid rgba(124,58,237,0.2)", background: "rgba(124,58,237,0.06)", padding: "10px 12px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#c084fc", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                Rezervace {reservation.code}
              </div>
              <div style={{ display: "grid", gap: 4, fontSize: 11, marginBottom: 10 }}>
                <div><span style={{ color: "var(--text-muted)", display: "inline-block", width: 100 }}>Firma:</span> <span style={{ color: "var(--text)" }}>{reservation.companyName}</span></div>
                {reservation.requestedExpeditionDate && (
                  <div><span style={{ color: "var(--text-muted)", display: "inline-block", width: 100 }}>Termín expedice:</span> <span style={{ color: "var(--text)", fontWeight: 600 }}>{formatDate(reservation.requestedExpeditionDate)}</span></div>
                )}
                {reservation.requestedDataDate && (
                  <div><span style={{ color: "var(--text-muted)", display: "inline-block", width: 100 }}>Termín dat:</span> <span style={{ color: "var(--text)", fontWeight: 600 }}>{formatDate(reservation.requestedDataDate)}</span></div>
                )}
                <div><span style={{ color: "var(--text-muted)", display: "inline-block", width: 100 }}>Obchodník:</span> {reservation.requestedByUsername}</div>
                <div>
                  <span style={{ color: "var(--text-muted)", display: "inline-block", width: 100 }}>Stav:</span>
                  {reservation.status === "SCHEDULED" && <span style={{ color: "#f59e0b", fontWeight: 600 }}>Naplánováno</span>}
                  {reservation.status === "CONFIRMED" && <span style={{ color: "#10b981", fontWeight: 600 }}>Potvrzeno</span>}
                  {reservation.status === "COUNTER_PROPOSED" && <span style={{ color: "#f59e0b", fontWeight: 600 }}>Čeká na obchodníka</span>}
                  {reservation.status === "REJECTED" && <span style={{ color: "#dc2626", fontWeight: 600 }}>Zamítnuto</span>}
                  {reservation.status === "WITHDRAWN" && <span style={{ color: "#dc2626", fontWeight: 600 }}>Staženo</span>}
                </div>
              </div>

              {resError && (
                <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 8, padding: "4px 8px", background: "rgba(239,68,68,0.08)", borderRadius: 6 }}>
                  {resError}
                </div>
              )}

              {/* Akce pro SCHEDULED */}
              {canEdit && reservation.status === "SCHEDULED" && !showCounterForm && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => handleResAction("confirm")}
                    disabled={resAction === "confirm"}
                    style={{ fontSize: 10, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "none", background: "#10b981", color: "#fff", cursor: resAction === "confirm" ? "not-allowed" : "pointer", opacity: resAction === "confirm" ? 0.6 : 1 }}
                  >
                    {resAction === "confirm" ? "Potvrzuji…" : "Potvrdit termín"}
                  </button>
                  <button
                    onClick={() => setShowCounterForm(true)}
                    style={{ fontSize: 10, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "none", background: "#f59e0b", color: "#fff", cursor: "pointer" }}
                  >
                    Navrhnout jiný
                  </button>
                </div>
              )}

              {/* Inline formulář protinávrhu */}
              {canEdit && reservation.status === "SCHEDULED" && showCounterForm && (
                <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>Nový termín expedice</div>
                    <DatePickerField value={counterExpDate} onChange={setCounterExpDate} placeholder="Vyberte datum…" asButton />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>Nový termín dat <span style={{ color: "var(--text-muted)", fontSize: 9 }}>(volitelné)</span></div>
                    <DatePickerField value={counterDataDate} onChange={setCounterDataDate} placeholder="Vyberte datum…" asButton />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>Důvod *</div>
                    <textarea
                      value={counterReason}
                      onChange={(e) => setCounterReason(e.target.value)}
                      placeholder="Kapacita knihárny obsazená do…"
                      rows={2}
                      style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 11, fontFamily: "inherit", resize: "vertical" }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => handleResAction("counter-propose", {
                        counterExpeditionDate: counterExpDate || undefined,
                        counterDataDate: counterDataDate || undefined,
                        reason: counterReason,
                      })}
                      disabled={(!counterExpDate && !counterDataDate) || !counterReason.trim() || resAction === "counter-propose"}
                      style={{
                        fontSize: 10, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "none",
                        background: (!counterExpDate && !counterDataDate) || !counterReason.trim() ? "var(--surface-3)" : "#f59e0b",
                        color: (!counterExpDate && !counterDataDate) || !counterReason.trim() ? "var(--text-muted)" : "#fff",
                        cursor: (!counterExpDate && !counterDataDate) || !counterReason.trim() ? "not-allowed" : "pointer",
                      }}
                    >
                      {resAction === "counter-propose" ? "Odesílám…" : "Odeslat protinávrh"}
                    </button>
                    <button
                      onClick={() => { setShowCounterForm(false); setCounterExpDate(""); setCounterDataDate(""); setCounterReason(""); }}
                      style={{ fontSize: 10, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
                    >
                      Zrušit
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        {block.reservationId && resLoading && (
          <>
            <Separator className="my-1 bg-slate-800" />
            <div style={{ fontSize: 10, color: "var(--text-muted)", padding: 8 }}>Načítám rezervaci…</div>
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
            {blockHistory.map((log, i) => {
              // Revizní řádek: co se SKUTEČNĚ změnilo v databázi (přesun, natažení,
              // zamčení, popis) — tedy to, o čem `AuditLog` mlčí. Rozvržení je
              // schválně TOTOŽNÉ s auditním řádkem níž: je to jedna časová osa,
              // ne dva seznamy. Popisek děje se bere z `label`, NIKDY z `action`
              // (ten neodliší směr a u přeřazení v expedici není z čeho odvozovat).
              if (log.source === "revision") {
                return (
                  <div key={`r${log.id}`} style={{ padding: "5px 10px", borderTop: i > 0 ? "1px solid var(--border)" : undefined, display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", whiteSpace: "nowrap", paddingTop: 1, minWidth: 70 }}>
                      {formatPragueDateShort(new Date(log.createdAt))} {formatPragueTime(new Date(log.createdAt))}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", flex: 1 }}>
                      <span style={{ color: "var(--text)", fontWeight: 600 }}>{log.username}</span>
                      {/* Změna, která se sem jen promítla z jiného bloku (dnes výhradně
                          sdílené pole rozdělené zakázky). Text i barva jsou schválně
                          TOTOŽNÉ s auditním řádkem SPLIT_PROPAGATE o kus níž — jinak by
                          táž věc měla v jednom panelu dvě různé podoby. */}
                      {log.propagated && (
                        <span style={{ color: "var(--info)" }}> · ↔ Převzato z rozdělené zakázky</span>
                      )}
                      {log.lines.map((line, j) => (
                        <span key={j} style={{ color: "var(--text)" }}> · {line}</span>
                      ))}
                    </div>
                  </div>
                );
              }
              // Fix round 1 (review): klasifikace se počítá jednou za řádek, ať ji obě
              // podmínky níž (span vs. seznam polí) čtou konzistentně ze stejného zdroje.
              // Konzistentní s InfoPanel.tsx — obě místa musí ukazovat totéž.
              const undoRedo = log.action === "UNDO" || log.action === "REDO"
                ? classifyUndoRedoField(log.field, log.newValue)
                : null;
              return (
              <div key={log.id} style={{ padding: "5px 10px", borderTop: i > 0 ? "1px solid var(--border)" : undefined, display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ fontSize: 9, color: "var(--text-muted)", whiteSpace: "nowrap", paddingTop: 1, minWidth: 70 }}>
                  {formatPragueDateShort(new Date(log.createdAt))} {formatPragueTime(new Date(log.createdAt))}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", flex: 1 }}>
                  <span style={{ color: "var(--text)", fontWeight: 600 }}>{log.username}</span>
                  {log.action === "UPDATE" && log.field && (
                    <span> · {FIELD_LABELS[log.field] ?? log.field}: <span style={{ color: "var(--text)" }}>{fmtAuditVal(log.oldValue, log.field)} → {fmtAuditVal(log.newValue, log.field)}</span></span>
                  )}
                  {/* Propagace sdíleného pole ze split skupiny — odlišeno od UPDATE, protože
                      šlo o jeden zásah na jiném bloku, který se sem jen automaticky promítl
                      (ne nezávislou editaci tohoto bloku). Konzistentní s InfoPanel.tsx. */}
                  {log.action === "SPLIT_PROPAGATE" && log.field && (
                    <span> · <span style={{ color: "var(--info)" }}>↔ Převzato z rozdělené zakázky</span> · {FIELD_LABELS[log.field] ?? log.field}: <span style={{ color: "var(--text)" }}>{fmtAuditVal(log.oldValue, log.field)} → {fmtAuditVal(log.newValue, log.field)}</span></span>
                  )}
                  {log.action === "CREATE" && <span style={{ color: "#22c55e" }}> · Přidána</span>}
                  {log.action === "DELETE" && <span style={{ color: "#ef4444" }}> · Smazána</span>}
                  {log.action === "EXPEDITION_PUBLISH" && <span style={{ color: "#22c55e" }}> · Zařazena do expedice</span>}
                  {log.action === "EXPEDITION_UNPUBLISH" && <span style={{ color: "#f59e0b" }}> · Odebrána z expedice</span>}
                  {/* Potvrzení/vrácení tisku. Tenhle panel je (na rozdíl od InfoPanel.tsx)
                      neuměl a řádek se vykreslil PRÁZDNÝ — jen jméno a čas. Doplněno
                      v Tasku 12: mapa pokrytí `auditCoverage.ts` u PRINT_* revizi
                      ZÁMĚRNĚ potlačuje s odůvodněním „pokrývá ji auditní řádek", takže
                      bez téhle větve by potvrzení tisku z osy zmizelo úplně. Texty jsou
                      shodné s InfoPanel.tsx, barvy přes tokeny (hex vedle je starší kód). */}
                  {log.action === "PRINT_COMPLETE" && <span style={{ color: "var(--success)" }}> · ✓ Tisk dokončen</span>}
                  {log.action === "PRINT_UNDO" && <span style={{ color: "var(--warning)" }}> · Vráceno hotovo</span>}
                  {log.action === "PRINT_RESET" && <span style={{ color: "var(--text-muted)" }}> · Reset potvrzení (přeplánováno)</span>}
                  {log.action === "AUTO_SHIFT" && log.oldValue && log.newValue && (
                    <span style={{ color: "#f59e0b" }}> · Automaticky posunuto: <span style={{ color: "var(--text)" }}>{fmtAuditVal(log.oldValue, "startTime")} → {fmtAuditVal(log.newValue, "startTime")}</span></span>
                  )}
                  {log.action === "AUTO_REFLOW" && log.oldValue && log.newValue && (
                    <span style={{ color: "#f59e0b" }}> · ⟳ přepočet dle kalendáře: <span style={{ color: "var(--text)" }}>{fmtAuditVal(log.oldValue, "startTime")} → {fmtAuditVal(log.newValue, "startTime")}</span></span>
                  )}
                  {undoRedo && (
                    <span style={{ color: "var(--text-muted)" }}>
                      {" "}· {log.action === "UNDO" ? "↶ vráceno zpět" : "↷ znovu provedeno"}
                      {/* I2 (go/no-go audit 5. 8. 2026), rozšířeno fix round 1: "fields" značí
                          čistě obchodní obnovu (oldValue/newValue nejsou span, ale seznam klíčů
                          — NESMÍ se vykreslit jako šipka mezi časy, falešný dojem přesunu, který
                          se nekonal). "mixed" (fix round 1) obnovilo POZICI I business pole
                          zároveň v jednom kroku — ukáže OBOJÍ, jinak by smíšená editace (dnes
                          nejběžnější případ, viz mergeAnchorPositionIfChanged) o vrácených
                          polích mlčela stejně, jako to dřív dělala vždy. */}
                      {undoRedo.kind !== "fields" && log.oldValue && log.newValue && (
                        <span style={{ color: "var(--text)" }}>: {fmtAuditVal(log.oldValue, "startTime")} → {fmtAuditVal(log.newValue, "startTime")}</span>
                      )}
                      {undoRedo.kind !== "position" && undoRedo.keys.length > 0 && (
                        <span style={{ color: "var(--text)" }}>{undoRedo.kind === "mixed" ? " · " : ": "}obnoveno {undoRedo.keys.map((k) => FIELD_LABELS[k] ?? k).join(", ")}</span>
                      )}
                    </span>
                  )}
                  {log.action === "NOTE_CREATE" && log.newValue && (
                    <span> · <span style={{ color: "#f59e0b" }}>📝 Přidána poznámka tiskaře:</span> <span style={{ color: "var(--text)" }}>{log.newValue}</span></span>
                  )}
                  {log.action === "NOTE_UPDATE" && (
                    <span> · <span style={{ color: "#f59e0b" }}>📝 Upravena poznámka:</span> <span style={{ color: "var(--text)" }}>{log.oldValue ?? ""} → {log.newValue ?? ""}</span></span>
                  )}
                  {log.action === "NOTE_DELETE" && (
                    <span> · <span style={{ color: "#ef4444" }}>📝 Smazána poznámka:</span> <span style={{ color: "var(--text-muted)" }}>{log.oldValue ?? ""}</span></span>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Smazat */}
      <div className="px-4 py-3 border-t border-slate-800">
        {confirming ? (
          <div className="space-y-2">
            <p className="text-[10px] text-slate-400 text-center">Opravdu smazat blok?</p>
            {block.reservationId && (
              <>
                <p className="text-[10px] text-purple-400 text-center">Propojená rezervace bude zamítnuta</p>
                <input
                  type="text"
                  placeholder="Důvod zamítnutí (nepovinné)"
                  value={detailRejectionReason}
                  onChange={(e) => setDetailRejectionReason(e.target.value)}
                  autoFocus
                  className="w-full px-2 py-1 text-xs rounded border border-purple-500/30 bg-purple-500/10 text-slate-200 outline-none"
                />
              </>
            )}
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => { onDelete(block.id, detailRejectionReason || undefined); setDetailRejectionReason(""); }}
                className="flex-1 text-xs"
              >
                Smazat
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setConfirming(false); setDetailRejectionReason(""); }}
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
