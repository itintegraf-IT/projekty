"use client";

import { useRef, useState, useMemo } from "react";
import {
  addDaysToCivilDate,
  todayPragueDateStr,
  utcToPragueDateStr,
  BUSINESS_TIME_ZONE,
} from "@/lib/dateUtils";
import type { Block } from "@/app/_components/TimelineGrid";
import type { CodebookOption } from "@/lib/plannerTypes";
import { badgeColorVar } from "@/lib/badgeColors";

// ─── Konstanty ────────────────────────────────────────────────────────────────
const DTP_PANEL_MIN_W = 180;
const DTP_PANEL_MAX_W = 420;
const MACHINE_LABELS: Record<string, string> = { XL_105: "XL 105", XL_106: "XL 106" };

// ─── Typy ─────────────────────────────────────────────────────────────────────
type FilterValue = "all" | "none" | number; // number = dataStatusId

interface DtpPanelProps {
  blocks: Block[];
  dataOpts: CodebookOption[];
  onScrollToBlock: (block: Block) => void;
  width: number;
  onWidthChange: (w: number) => void;
  onWidthCommit?: (w: number) => void;
  onClose?: () => void;
}

// ─── Pomocné funkce ───────────────────────────────────────────────────────────

function formatCardDate(startTimeStr: string): { label: string; urgent: boolean } {
  const todayStr = todayPragueDateStr();
  const tomorrowStr = addDaysToCivilDate(todayStr, 1);
  const startDate = utcToPragueDateStr(new Date(startTimeStr));
  const d = new Date(startTimeStr);
  const timeLabel = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: BUSINESS_TIME_ZONE, hour: "2-digit", minute: "2-digit",
  }).format(d);

  if (startDate === todayStr) return { label: `dnes ${timeLabel}`, urgent: true };
  if (startDate === tomorrowStr) return { label: `zítra ${timeLabel}`, urgent: true };

  const dayLabel = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: BUSINESS_TIME_ZONE, weekday: "short", day: "numeric", month: "numeric",
  }).format(d);
  return { label: dayLabel, urgent: false };
}

function blockDurationLabel(block: Block): string {
  const ms = new Date(block.endTime).getTime() - new Date(block.startTime).getTime();
  const h = ms / 3_600_000;
  return h % 1 === 0 ? `${h} hod` : `${h.toFixed(1)} hod`;
}

// ─── DtpPanel ─────────────────────────────────────────────────────────────────
export function DtpPanel({
  blocks,
  dataOpts,
  onScrollToBlock,
  width,
  onWidthChange,
  onWidthCommit,
  onClose,
}: DtpPanelProps) {
  const [activeFilter, setActiveFilter] = useState<FilterValue>("all");

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
  const relevantBlocks = useMemo(() => {
    const now = Date.now();
    const todayStr = todayPragueDateStr();
    const horizon30 = addDaysToCivilDate(todayStr, 30);
    return blocks
      .filter((b) => {
        if (b.type !== "ZAKAZKA") return false;
        if (new Date(b.endTime).getTime() < now) return false;
        const startDate = utcToPragueDateStr(new Date(b.startTime));
        return startDate <= horizon30 || b.dataOk === false;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [blocks]);

  const filteredBlocks = relevantBlocks.filter((b) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "none") return b.dataStatusId === null;
    return b.dataStatusId === activeFilter;
  });

  // ── Render: seznam ──
  return (
    <aside style={{
      width, flexShrink: 0, position: "relative", zIndex: 10,
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
            {filteredBlocks.length} zakázek
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
            color: "var(--text-muted)", fontSize: 12, padding: "24px 0",
          }}>
            Žádné zakázky
          </div>
        )}
        {filteredBlocks.map((block) => (
          <BlockCard
            key={block.id}
            block={block}
            dataOpts={dataOpts}
            onScrollTo={() => onScrollToBlock(block)}
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
  block, dataOpts, onScrollTo,
}: {
  block: Block;
  dataOpts: CodebookOption[];
  onScrollTo: () => void;
}) {
  const { label: dateLabel, urgent } = useMemo(
    () => formatCardDate(block.startTime),
    [block.startTime]
  );
  const [hovered, setHovered] = useState(false);

  const chipAccent = useMemo(() => {
    if (!block.dataStatusId) return null;
    const opt = dataOpts.find((o) => o.id === block.dataStatusId);
    return badgeColorVar(opt?.badgeColor ?? null) ?? "var(--badge-blue)";
  }, [block.dataStatusId, dataOpts]);

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>
          {block.orderNumber}
        </span>
        <span style={{
          fontSize: 10, fontWeight: urgent ? 700 : 400,
          color: urgent ? "#f59e0b" : "var(--text-muted)",
        }}>
          {dateLabel}
        </span>
      </div>

      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5 }}>
        {MACHINE_LABELS[block.machine] ?? block.machine} · {blockDurationLabel(block)}
      </div>

      {block.dataStatusLabel ? (
        <span style={{
          display: "inline-block", padding: "2px 7px", borderRadius: 10,
          fontSize: 9, fontWeight: 700,
          color: `color-mix(in oklab, ${chipAccent ?? "var(--badge-blue)"} 70%, var(--text))`,
          background: `color-mix(in oklab, ${chipAccent ?? "var(--badge-blue)"} 30%, transparent)`,
          border: `1px solid ${chipAccent ?? "var(--badge-blue)"}`,
        }}>
          {block.dataStatusLabel}
        </span>
      ) : (
        <span style={{
          display: "inline-block", padding: "2px 7px", borderRadius: 10,
          fontSize: 9, fontWeight: 500, fontStyle: "italic",
          background: "transparent", color: "var(--text-muted)",
          border: "1px dashed var(--border)",
        }}>
          bez statusu
        </span>
      )}
    </div>
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
        width: 6, zIndex: 20, cursor: "col-resize",
        display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: hovered ? "rgb(59 130 246 / 0.4)" : "transparent",
        transition: "background-color 0.15s",
      }}
    />
  );
}
