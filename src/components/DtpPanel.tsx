"use client";

import { useRef, useState, useMemo } from "react";
import {
  addDaysToCivilDate,
  todayPragueDateStr,
  utcToPragueDateStr,
  BUSINESS_TIME_ZONE,
} from "@/lib/dateUtils";
import type { Block } from "@/app/_components/TimelineGrid";
import { Z_LAYOUT } from "@/lib/zLayers";
import type { CodebookOption } from "@/lib/plannerTypes";
import { selectDtpOverviewBlocks, type DtpStatusFilter } from "@/lib/dtpOverview";
import { badgeColorVar } from "@/lib/badgeColors";
import { formatProductionTypeChip, PRODUCTION_CHIP_COLORS } from "@/lib/productionTags";
import { blockPrintMinutes } from "@/lib/printTimeClient";
import { machineLabel } from "@/lib/machines";
import { SearchField } from "@/components/SearchField";

// ─── Sdílené typy ─────────────────────────────────────────────────────────────
type OnStatusChange = (
  blockId: number,
  patch: { dataStatusId: number | null; dataStatusLabel: string | null; dataOk: boolean }
) => Promise<void>;

// ─── Konstanty ────────────────────────────────────────────────────────────────
const DTP_PANEL_MIN_W = 180;
const DTP_PANEL_MAX_W = 420;

// ─── Typy ─────────────────────────────────────────────────────────────────────

interface DtpPanelProps {
  blocks: Block[];
  dataOpts: CodebookOption[];
  onScrollToBlock: (block: Block) => void;
  onStatusChange: OnStatusChange;
  width: number;
  onWidthChange: (w: number) => void;
  onWidthCommit?: (w: number) => void;
  onClose?: () => void;
}

// ─── Pomocné funkce ───────────────────────────────────────────────────────────

function formatCardDate(startTimeStr: string, allowUrgent = true): { label: string; urgent: boolean } {
  const todayStr = todayPragueDateStr();
  const tomorrowStr = addDaysToCivilDate(todayStr, 1);
  const startDate = utcToPragueDateStr(new Date(startTimeStr));
  const d = new Date(startTimeStr);
  const timeLabel = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: BUSINESS_TIME_ZONE, hour: "2-digit", minute: "2-digit",
  }).format(d);

  if (startDate === todayStr) return { label: `dnes ${timeLabel}`, urgent: allowUrgent };
  if (startDate === tomorrowStr) return { label: `zítra ${timeLabel}`, urgent: allowUrgent };

  const dayLabel = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: BUSINESS_TIME_ZONE, weekday: "short", day: "numeric", month: "numeric",
  }).format(d);
  return { label: dayLabel, urgent: false };
}

function fmtHours(mins: number): string {
  const h = mins / 60;
  return h % 1 === 0 ? `${h} hod` : `${h.toFixed(1)} hod`;
}

/**
 * ZAKAZKA s tiskovými minutami odlišnými od uplynulého času bloku (pauza přes
 * odstávku/mimo provoz uvnitř bloku) zobrazí obojí — tisk i celkovou délku na
 * časové ose. Jinak (rovnají se, nebo ne-ZAKAZKA) zůstává dnešní jednoduchý text.
 */
function blockDurationLabel(block: Block): string {
  const elapsedMins = Math.round((new Date(block.endTime).getTime() - new Date(block.startTime).getTime()) / 60000);
  if (block.type !== "ZAKAZKA") return fmtHours(elapsedMins);
  const pm = blockPrintMinutes(block);
  if (pm === elapsedMins) return fmtHours(elapsedMins);
  return `Tisk ${fmtHours(pm)} · celkem ${fmtHours(elapsedMins)}`;
}

// ─── DtpPanel ─────────────────────────────────────────────────────────────────
export function DtpPanel({
  blocks,
  dataOpts,
  onScrollToBlock,
  onStatusChange,
  width,
  onWidthChange,
  onWidthCommit,
  onClose,
}: DtpPanelProps) {
  const [activeFilter, setActiveFilter] = useState<DtpStatusFilter>("all");
  const [query, setQuery] = useState("");

  // ── Resize ──
  const dragStartX = useRef<number>(0);
  const dragStartWidth = useRef<number>(width);

  function handleResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMouseMove(ev: MouseEvent) {
      const delta = dragStartX.current - ev.clientX;
      const newW = Math.min(DTP_PANEL_MAX_W, Math.max(DTP_PANEL_MIN_W, dragStartWidth.current + delta));
      onWidthChange(newW);
    }
    function onMouseUp(ev: MouseEvent) {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      const delta = dragStartX.current - ev.clientX;
      const finalW = Math.min(DTP_PANEL_MAX_W, Math.max(DTP_PANEL_MIN_W, dragStartWidth.current + delta));
      onWidthCommit?.(finalW); // uložit preferenci až po ukončení resize
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  // ── Data ──
  // `now` se přepočítá jen se změnou `blocks`/`query`/`activeFilter` (stejně jako
  // to dělal původní Date.now() uvnitř memoizace). Vědomý kompromis, ne opomenutí:
  // dokud do panelu nepřijde nová verze plánu, `now` ZAMRZNE — štítek „mimo přehled"
  // ani příznak urgentnosti („dnes"/„zítra") tedy přes noc samy nezestárnou. Panel
  // se ale v provozu překresluje s každou změnou plánu, takže se to prakticky
  // neprojeví; tikající `now` by sem přitáhlo vlastní interval kvůli dvěma štítkům.
  const searching = query.trim().length > 0;
  const { filteredBlocks, outsideIds } = useMemo(() => {
    // `outsideIds` (zakázky, které by ve frontě bez hledání nebyly — skončené
    // nebo za horizontem; dostanou štítek) počítá rovnou výběr. Panel si je dřív
    // dopočítával druhým průchodem přes `isInDtpDefaultList`, čímž se `Intl`
    // formátování dne provedlo na každý výsledek podruhé.
    const { list, outsideIds } = selectDtpOverviewBlocks({
      blocks, query, statusFilter: activeFilter, now: new Date(),
    });
    return { filteredBlocks: list, outsideIds };
  }, [blocks, query, activeFilter]);

  // ── Render: seznam ──
  return (
    <aside style={{
      width, flexShrink: 0, position: "relative", zIndex: Z_LAYOUT.sidePanel,
      display: "flex", flexDirection: "column",
      background: "var(--surface)", borderLeft: "1px solid var(--border)",
      overflow: "hidden",
    }}>
      <ResizeHandle onMouseDown={handleResizeMouseDown} />

      {/* Header */}
      <div style={{
        padding: "10px 12px", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0, background: "var(--surface-2)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 24, height: 24, borderRadius: 6,
            background: "linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 11, fontWeight: 900, flexShrink: 0,
          }}>D</div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>DTP přehled</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 10, color: "var(--text-muted)",
            background: "var(--surface)", border: "1px solid var(--border)",
            padding: "1px 6px", borderRadius: 4,
          }}>
            {/* Při hledání je to počet VÝSLEDKŮ, ne velikost fronty — bez rozlišení
                by badge u jedné shody hlásil „1 zakázek", zatímco ve frontě jich
                čeká čtyřicet. */}
            {searching ? `nalezeno ${filteredBlocks.length}` : `${filteredBlocks.length} zakázek`}
          </span>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                width: 20, height: 20, borderRadius: 4,
                background: "none", border: "none",
                color: "var(--text-muted)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, lineHeight: 1,
              }}
            >×</button>
          )}
        </div>
      </div>

      {/* Hledání zakázky — při zadaném dotazu panel vědomě opouští 30denní okno */}
      {/* Bez `position: relative` — křížek si pozicuje SearchField vůči vlastnímu
          obalu, ne vůči tomuhle divu (dřív byl `right: 16` kompenzací za padding). */}
      <div style={{
        padding: "7px 10px", borderBottom: "1px solid var(--border)",
        flexShrink: 0, display: "flex", alignItems: "center",
      }}>
        <SearchField
          size="sm"
          value={query}
          onChange={setQuery}
          onClear={() => setQuery("")}
          ariaLabel="Hledat zakázku v DTP přehledu"
        />
      </div>

      {/* Filter chips */}
      <div style={{
        padding: "7px 10px", borderBottom: "1px solid var(--border)",
        display: "flex", gap: 4, flexWrap: "wrap", flexShrink: 0,
      }}>
        <FilterChip
          label="Vše"
          active={activeFilter === "all"}
          onClick={() => setActiveFilter("all")}
        />
        {dataOpts.filter((o) => o.isActive).map((opt) => (
          <FilterChip
            key={opt.id}
            label={opt.label}
            active={activeFilter === opt.id}
            onClick={() => setActiveFilter(activeFilter === opt.id ? "all" : opt.id)}
          />
        ))}
        <FilterChip
          label="bez statusu"
          active={activeFilter === "none"}
          onClick={() => setActiveFilter(activeFilter === "none" ? "all" : "none")}
          dashed
        />
      </div>

      {/* Zakázky */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px", display: "flex", flexDirection: "column", gap: 5 }}>
        {filteredBlocks.length === 0 && (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            textAlign: "center", color: "var(--text-muted)", fontSize: 12, padding: "24px 8px",
          }}>
            {/* Dotaz a filtrační chip se ANDují (`selectDtpOverviewBlocks`), takže
                „nenalezena" by u zapnutého chipu lhalo: zakázka existuje, jen má jiný
                status. Hláška proto rozlišuje a rovnou říká, co s tím. */}
            {!searching
              ? "Žádné zakázky"
              : activeFilter === "all"
              ? `Zakázka „${query.trim()}“ nenalezena.`
              : `Zakázka „${query.trim()}“ v tomto filtru není — zkus „Vše“.`}
          </div>
        )}
        {filteredBlocks.map((block) => (
          <BlockCard
            key={block.id}
            block={block}
            dataOpts={dataOpts}
            outsideDefaultList={outsideIds.has(block.id)}
            onScrollTo={() => onScrollToBlock(block)}
            onStatusChange={onStatusChange}
          />
        ))}
      </div>
    </aside>
  );
}

// ─── FilterChip ───────────────────────────────────────────────────────────────
function FilterChip({
  label, active, onClick, dashed = false,
}: {
  label: string; active: boolean; onClick: () => void; dashed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 9px", borderRadius: 12, fontSize: 10, fontWeight: active ? 700 : 500,
        cursor: "pointer", transition: "all 100ms ease-out", lineHeight: 1.4,
        background: active ? "#2563eb" : "transparent",
        color: active ? "#fff" : "var(--text-muted)",
        border: active
          ? "1px solid #2563eb"
          : dashed
            ? "1px dashed var(--border)"
            : "1px solid var(--border)",
      }}
    >
      {label}
    </button>
  );
}

// ─── BlockCard ────────────────────────────────────────────────────────────────
function BlockCard({
  block, dataOpts, outsideDefaultList, onScrollTo, onStatusChange,
}: {
  block: Block;
  dataOpts: CodebookOption[];
  /** Zakázka nalezená hledáním, která do běžné fronty přehledu nepatří. */
  outsideDefaultList: boolean;
  onScrollTo: () => void;
  onStatusChange: OnStatusChange;
}) {
  // U zakázky mimo běžnou frontu se datum nebarví jako urgentní — „dnes" u
  // dávno dotištěné zakázky by volalo po akci, která už nedává smysl.
  const { label: dateLabel, urgent } = useMemo(
    () => formatCardDate(block.startTime, !outsideDefaultList),
    [block.startTime, outsideDefaultList]
  );
  const [hovered, setHovered] = useState(false);
  const isPrintDone = block.printCompletedAt != null;
  const typeChip = formatProductionTypeChip(block.tiskoveArchy, block.serie);

  function handleClick() {
    onScrollTo();
  }

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "var(--surface-2)", borderRadius: 5, padding: "7px 9px",
        border: `1px solid ${hovered ? "rgba(59,130,246,0.5)" : "var(--border)"}`,
        cursor: "pointer", transition: "border-color 100ms ease-out",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6, marginBottom: 3 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>
          {block.orderNumber}
        </span>
        <span style={{
          fontSize: 10, fontWeight: urgent ? 700 : 400,
          color: urgent ? "#f59e0b" : "var(--text-muted)",
          whiteSpace: "nowrap",
        }}>
          {dateLabel}
        </span>
      </div>

      {/* Hledání od 13. 8. 2026 vytáhne do panelu i UŽ VYTIŠTĚNÉ zakázky — dřív
          to nemělo jak nastat, fronta končila u `endTime < now`. Status chip
          zůstává editovatelný (DTP legitimně doplňuje, co se zapomnělo —
          rozhodnutí majitele), ale karta musí dát najevo, že jde o historii,
          ať se do ní nekliká omylem. */}
      {outsideDefaultList && (
        <div style={{
          display: "inline-block", marginBottom: 4,
          fontSize: 9, fontWeight: 600, letterSpacing: "0.03em",
          padding: "1px 6px", borderRadius: 4,
          border: `1px dashed ${isPrintDone ? "var(--success)" : "var(--border)"}`,
          color: isPrintDone ? "var(--success)" : "var(--text-muted)",
        }}>
          {isPrintDone ? "✓ vytištěno · mimo přehled" : "mimo přehled"}
        </div>
      )}

      {block.description && (
        <div style={{
          fontSize: 10, color: "var(--text)", opacity: 0.82, lineHeight: 1.3, marginBottom: 4,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          overflow: "hidden", wordBreak: "break-word",
        }}>
          {block.description}
        </div>
      )}

      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5 }}>
        {machineLabel(block.machine)} · {blockDurationLabel(block)}
      </div>

      {(block.obalka || block.vnitrky || typeChip) && (
        <div style={{ display: "flex", gap: 5, marginBottom: 6, flexWrap: "wrap" }}>
          {block.obalka && <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 6, background: PRODUCTION_CHIP_COLORS.obalka.bg, color: PRODUCTION_CHIP_COLORS.obalka.fg, lineHeight: 1 }}>OBÁLKA</span>}
          {block.vnitrky && <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 6, background: PRODUCTION_CHIP_COLORS.vnitrky.bg, color: PRODUCTION_CHIP_COLORS.vnitrky.fg, lineHeight: 1 }}>VNITŘKY</span>}
          {typeChip && <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 6, background: PRODUCTION_CHIP_COLORS.type.bg, color: PRODUCTION_CHIP_COLORS.type.fg, lineHeight: 1 }}>{typeChip}</span>}
        </div>
      )}

      <StatusChipSelect
        block={block}
        dataOpts={dataOpts}
        onChange={(statusIdStr) => {
          const statusId = statusIdStr ? parseInt(statusIdStr, 10) : null;
          const selectedOpt = dataOpts.find((o) => o.id === statusId);
          void onStatusChange(block.id, {
            dataStatusId: statusId,
            dataStatusLabel: selectedOpt?.label ?? null,
            dataOk: statusId !== null,
          });
        }}
      />
    </div>
  );
}

// ─── StatusChipSelect ────────────────────────────────────────────────────────
function StatusChipSelect({
  block, dataOpts, onChange,
}: {
  block: Block;
  dataOpts: CodebookOption[];
  onChange: (statusIdStr: string) => void;
}) {
  const chipAccent = useMemo(() => {
    if (!block.dataStatusId) return null;
    const opt = dataOpts.find((o) => o.id === block.dataStatusId);
    return badgeColorVar(opt?.badgeColor ?? null) ?? "var(--badge-blue)";
  }, [block.dataStatusId, dataOpts]);

  const hasStatus = !!block.dataStatusId;
  const accent = chipAccent ?? "var(--badge-blue)";

  // SVG šipka jako background-image (data URI). Native <select> jinak vykreslí OS šipku.
  const arrowSvg = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6' fill='none' stroke='%23${
    hasStatus ? "9ca3af" : "6b7280"
  }' stroke-width='1.5'><path d='M1 1l4 4 4-4' stroke-linecap='round'/></svg>")`;

  return (
    <select
      aria-label={`Status zakázky ${block.orderNumber}`}
      value={block.dataStatusId?.toString() ?? ""}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      style={{
        appearance: "none",
        WebkitAppearance: "none",
        MozAppearance: "none",
        padding: "2px 18px 2px 7px",
        borderRadius: 10,
        fontSize: 9,
        fontWeight: hasStatus ? 700 : 500,
        fontStyle: hasStatus ? "normal" : "italic",
        color: hasStatus
          ? `color-mix(in oklab, ${accent} 70%, var(--text))`
          : "var(--text-muted)",
        backgroundColor: hasStatus
          ? `color-mix(in oklab, ${accent} 30%, transparent)`
          : "transparent",
        border: hasStatus
          ? `1px solid ${accent}`
          : "1px dashed var(--border)",
        cursor: "pointer",
        outline: "none",
        backgroundImage: arrowSvg,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 5px center",
        backgroundSize: "8px 5px",
        lineHeight: 1.4,
        maxWidth: "100%",
      } as React.CSSProperties}
    >
      <option value="">— bez statusu —</option>
      {dataOpts.filter((o) => o.isActive).map((opt) => (
        <option key={opt.id} value={opt.id.toString()}>
          {opt.isWarning ? "⚠ " : ""}{opt.label}
        </option>
      ))}
    </select>
  );
}

// ─── ResizeHandle (levý okraj panelu) ────────────────────────────────────────
function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute", left: 0, top: 0, bottom: 0,
        width: 6, zIndex: Z_LAYOUT.panelDivider, cursor: "col-resize",
        display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: hovered ? "rgb(59 130 246 / 0.4)" : "transparent",
        transition: "background-color 0.15s",
      }}
    />
  );
}
