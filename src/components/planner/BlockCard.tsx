"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { blockPrintMinutes, formatPrintHoursShort, type CalendarDriftInfo } from "@/lib/printTimeClient";
import { Z_OVERLAY, Z_TIMELINE } from "@/lib/zLayers";
import { BLOCK_STYLES, BLOCK_OVERDUE, BLOCK_PRINT_DONE, getBlockStyleKey, tint } from "@/lib/blockStyles";
import {
  civilDateToUTCMidnight,
  formatPragueDateShort,
  formatPragueDateTime,
  normalizeCivilDateInput,
  utcToPragueDateStr,
} from "@/lib/dateUtils";
import { badgeColorVar } from "@/lib/badgeColors";
import { formatProductionTypeChip, PRODUCTION_CHIP_COLORS } from "@/lib/productionTags";
import { BLOCK_VARIANTS, VARIANT_CONFIG, type BlockVariant } from "@/lib/blockVariants";
import { Lock, Clock, Hourglass } from "lucide-react";
import { SplitChip } from "@/components/SplitChip";
import { getSplitChipState } from "@/lib/splitHelpers";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";
import { type Block } from "@/app/_components/TimelineGrid";

// ─── BlockCard ─────────────────────────────────────────────────────────────────
// Vizuální config bloků žije v @/lib/blockStyles (sdílený s blockShades — audit #14/C5).

// ─── Pomocná funkce — bezpečný parse data z DB (ISO timestamp i date string) ──
function fmtDate(s: string | null | undefined): string {
  const normalized = normalizeCivilDateInput(s);
  if (!normalized) return "–";
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(civilDateToUTCMidnight(normalized));
}

// Zkrácený formát bez roku: "5.1."
function fmtDateShort(s: string | null | undefined): string {
  const normalized = normalizeCivilDateInput(s);
  if (!normalized) return "–";
  return formatPragueDateShort(civilDateToUTCMidnight(normalized));
}

function deadlineState(requiredDate: string | null | undefined, ok: boolean, now: Date, blockStartTime?: string | Date): "none" | "ok" | "warning" | "danger" | "earlyStart" {
  const dueDateStr = normalizeCivilDateInput(requiredDate);
  if (!dueDateStr) return "none";
  if (ok) return "ok";
  const todayDateStr = utcToPragueDateStr(now);
  // Blok startuje dříve než dorazí materiál/data
  if (blockStartTime) {
    const start = new Date(blockStartTime);
    if (!isNaN(start.getTime()) && utcToPragueDateStr(start) < dueDateStr) return "earlyStart";
  }
  if (todayDateStr === dueDateStr) return "warning";
  if (todayDateStr > dueDateStr) return "danger";
  return "none";
}

const FIELD_ACCENT = {
  DATA:     "color-mix(in oklab, #0ea5e9 78%, var(--text) 22%)",  // tyrkysová — data
  MATERIAL: "color-mix(in oklab, #22c55e 78%, var(--text) 22%)",  // zelená — materiál
  EXPEDICE: "color-mix(in oklab, #f97316 78%, var(--text) 22%)",  // oranžová — expedice
  PANTONE:  "color-mix(in oklab, #a855f7 78%, var(--text) 22%)",  // fialová — pantone
};

// Deadline barvy jako tokeny — použito v DateBadge
const DEADLINE_BG: Record<string, string> = {
  ok:         "color-mix(in oklab, var(--success) 85%, black 15%)",
  danger:     "color-mix(in oklab, var(--danger) 85%, black 15%)",
  warning:    "color-mix(in oklab, var(--warning) 75%, black 25%)",
  earlyStart: "color-mix(in oklab, #f97316 85%, black 15%)",
  issued:     "color-mix(in oklab, #3b82f6 85%, black 15%)",
  empty:      "rgba(0,0,0,0.45)",
  neutral:    "rgba(255,255,255,0.18)",
};
const DEADLINE_BORDER: Record<string, string> = {
  ok:         "color-mix(in oklab, var(--success) 70%, black 30%)",
  danger:     "color-mix(in oklab, var(--danger) 70%, black 30%)",
  warning:    "color-mix(in oklab, var(--warning) 60%, black 40%)",
  earlyStart: "color-mix(in oklab, #f97316 70%, black 30%)",
  issued:     "color-mix(in oklab, #3b82f6 70%, black 30%)",
  empty:      "rgba(255,255,255,0.55)",
  neutral:    "rgba(255,255,255,0.30)",
};

// ─── DateBadge — klikatelná kolonka s datem + toggle OK ───────────────────────
function DateBadge({
  label, dateStr, ok, warn, danger, earlyStart, accent, onToggle, onDoubleClick, statusLabel, overrideText, customBg, customBorder, customTextColor,
}: {
  label: string; dateStr: string | null; ok: boolean; warn: boolean; danger: boolean; earlyStart?: boolean; accent?: string; onToggle?: () => void; onDoubleClick?: (rect: DOMRect) => void; statusLabel?: string | null; overrideText?: string; customBg?: string; customBorder?: string; customTextColor?: string;
}) {
  const [loading, setLoading] = useState(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const empty = !dateStr && !overrideText;
  const fmt = dateStr ? fmtDate(dateStr) : (overrideText ?? "—");

  const neutralAccent = accent ?? "var(--text-muted)";
  const stateKey = empty ? "empty" : ok ? "ok" : danger ? "danger" : warn ? "warning" : earlyStart ? "earlyStart" : "neutral";
  const bg          = customBg ?? DEADLINE_BG[stateKey];
  const borderColor = customBorder ?? DEADLINE_BORDER[stateKey];
  const labelColor  = customTextColor ?? (empty ? "#fff" : "rgba(255,255,255,0.90)");
  const dateColor   = customTextColor ?? (empty ? "rgba(255,255,255,0.95)" : "#fff");

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (empty || loading || !onToggle) return;
    if (onDoubleClick) {
      // Odložit toggle — zruší se pokud přijde dblclick dřív než timeout
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(async () => {
        clickTimerRef.current = null;
        setLoading(true);
        onToggle();
        setLoading(false);
      }, 350);
    } else {
      setLoading(true);
      onToggle();
      setLoading(false);
    }
  }

  function handleDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    // Zruš případný čekající single-click toggle
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
    if (onDoubleClick) onDoubleClick(e.currentTarget.getBoundingClientRect());
  }

  return (
    <div
      onClick={handleClick}
      onDoubleClick={onDoubleClick ? handleDoubleClick : undefined}
      style={{
        display: "flex", flexDirection: "column", gap: 2,
        padding: "5px 9px 5px 8px", borderRadius: 5,
        background: bg,
        borderTop: `1px solid ${borderColor}`, borderRight: `1px solid ${borderColor}`, borderBottom: `1px solid ${borderColor}`,
        borderLeft: `2px solid ${neutralAccent}`,
        cursor: empty ? "default" : "pointer", flex: "0 0 auto",
        transition: "all 0.12s", opacity: loading ? 0.6 : 1,
        userSelect: "none",
      }}
    >
      <span style={{ fontSize: 8, fontWeight: 700, color: labelColor, lineHeight: 1, letterSpacing: "0.07em" }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: dateColor, lineHeight: 1 }}>{overrideText ?? (ok && statusLabel ? statusLabel : fmt)}</span>
        {!empty && (
          <span style={{ fontSize: 10, lineHeight: 1, color: empty ? "var(--text-muted)" : "rgba(255,255,255,0.80)" }}
                title={earlyStart ? "Start zakázky před dodáním" : undefined}>
            {ok ? "✓" : danger ? "‼" : warn ? "!" : earlyStart ? "⚠" : "·"}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── MiniChip — malý chip vpravo nahoře v bloku ───────────────────────────────
// Přepsání barvy textu pro konkrétní klíče (světlé → tmavý text, tmavé → světlý text)
// Všechny badge barvy mají pevný kontrastní text (bílý nebo černý)
const BADGE_TEXT_OVERRIDES: Record<string, string> = {
  blue:   "#111",
  green:  "#111",
  orange: "#111",
  red:    "#111",
  purple: "#111",
  cyan:   "#111",
  lime:   "#111",
  pink:   "#111",
  black:  "#fff",
};

function chipTextColor(colorKey: string | null | undefined): string | null {
  if (!colorKey) return null;
  return BADGE_TEXT_OVERRIDES[colorKey] ?? null;
}

function MiniChip({ label, accent, textColor }: { label: string; accent: string; textColor?: string }) {
  const tc = textColor ?? accent;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, color: tc, lineHeight: 1.5,
      background: tint(accent, 85), border: `1px solid ${tint(accent, 100)}`,
      borderRadius: 3, padding: "1px 5px", whiteSpace: "nowrap",
      display: "block",
    }}>
      {label}
    </span>
  );
}

// ─── ProductionChips — typový chip OBÁLKA / VNITŘKY / TA·série ─────────────────
// Fragment (bez wrapperu) — lze vložit do flex clusteru i absolutního kontejneru.
// V praxi je nastavené vždy jen jedno (OBÁLKA nebo VNITŘKY nebo TA); série se
// spojí za tiskové archy. abbreviated = zkrácené OB./VN. pro krátké bloky.
function ProductionChips({ obalka, vnitrky, tiskoveArchy, serie, abbreviated }: {
  obalka?: boolean; vnitrky?: boolean; tiskoveArchy?: string | null; serie?: string | null; abbreviated?: boolean;
}) {
  const typeChip = formatProductionTypeChip(tiskoveArchy, serie);
  if (!obalka && !vnitrky && !typeChip) return null;
  // clamp = na krátkých blocích (abbreviated) dlouhý TA·série chip zkrátit ellipsis,
  // aby nikdy nevytlačil číslo zakázky (nejdůležitější info na bloku).
  const pill = (bg: string, fg: string, text: string, clamp?: boolean) => (
    <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.04em", padding: "2px 6px", borderRadius: 5, background: bg, color: fg, lineHeight: 1, whiteSpace: "nowrap", flexShrink: clamp ? 1 : 0, ...(clamp ? { maxWidth: 132, overflow: "hidden", textOverflow: "ellipsis" } : {}) }}>{text}</span>
  );
  const C = PRODUCTION_CHIP_COLORS;
  return (
    <>
      {obalka && pill(C.obalka.bg, C.obalka.fg, abbreviated ? "OB." : "OBÁLKA")}
      {vnitrky && pill(C.vnitrky.bg, C.vnitrky.fg, abbreviated ? "VN." : "VNITŘKY")}
      {typeChip && pill(C.type.bg, C.type.fg, typeChip, abbreviated)}
    </>
  );
}

// ─── MaterialNoteAffordance ────────────────────────────────────────────────────
// Jen HoverCard pro pasivní náhled — ContextMenu je nyní na celém bloku (BlockCard).
// Musí být MIMO BlockCard — definice uvnitř by způsobila remount při každém renderu.
function MaterialNoteAffordance({
  children, block,
  indicatorSize = 5, indicatorTop = 2, indicatorRight = 2,
}: {
  children: React.ReactElement;
  block: Block;
  indicatorSize?: number;
  indicatorTop?: number;
  indicatorRight?: number;
}) {
  const hasNote = !!block.materialNote;

  // display:"flex" → children jsou vždy block-level flex items (žádný line-height strut)
  const inner = (
    <div style={{ position: "relative", display: "flex" }}>
      {children}
      {hasNote && (
        <span style={{ position: "absolute", top: indicatorTop, right: indicatorRight, width: indicatorSize, height: indicatorSize, borderRadius: "50%", background: "rgba(255,255,255,0.75)", pointerEvents: "none" }} />
      )}
    </div>
  );

  if (!hasNote) return inner;

  return (
    <HoverCard openDelay={400} closeDelay={100}>
      <HoverCardTrigger asChild>{inner}</HoverCardTrigger>
      <HoverCardContent
        side="right" align="start"
        style={{
          background: "rgba(28, 28, 30, 0.96)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 14,
          padding: "12px 14px",
          maxWidth: 240,
          zIndex: Z_OVERLAY.hoverCard,
          boxShadow: "0 8px 32px rgba(0,0,0,0.52), 0 2px 8px rgba(0,0,0,0.28)",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
        }}
      >
        <p style={{ margin: "0 0 7px", fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.32)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Poznámka MTZ
        </p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "rgba(255,255,255,0.88)", whiteSpace: "pre-wrap" }}>
          {block.materialNote}
        </p>
        {block.materialNoteByUsername && (
          <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.55)", flexShrink: 0 }}>
              {block.materialNoteByUsername[0]?.toUpperCase()}
            </div>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.42)" }}>
              {block.materialNoteByUsername}
            </span>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

// ─── BlockCard ─────────────────────────────────────────────────────────────────
export function BlockCard({
  block, top, height, maxRenderHeight, dimmed, selected, isDragging, isCopied, multiSelected, now,
  onClick, onDoubleClick, onMouseDown, onResizeMouseDown, onBlockUpdate, onError,
  canEdit, canEditData, canEditDataDate, canEditMat, onInlineDatePick, badgeColorMap,
  onBlockCopy, onBlockSplit, getSplitAt, isTiskar, onPrintComplete, onNotify, onBlockVariantChange,
  onExpeditionPublish, onExpeditionUnpublish,
  onDataChipDoubleClick,
  onOpenNotes,
  splitPart, splitTotal, splitTotalMinutes,
  splitPartner, onSplitChipClick,
  pauseOverlays, contentHeight,
  calendarDrift,
  shadeParity,
}: {
  block: Block;
  top: number;
  height: number;
  // Strop render výšky = začátek dalšího bloku na stroji (blok se nesmí kreslit přes něj).
  // Infinity = žádný další blok. Div použije min(clampedHeight, maxRenderHeight).
  maxRenderHeight?: number;
  dimmed: boolean;
  selected: boolean;
  isDragging: boolean;
  isCopied: boolean;
  multiSelected: boolean;
  now: Date;
  splitPart?: number;
  splitTotal?: number;
  // Σ tiskových minut všech členů split skupiny (bod 18 auditu) — 0/undefined = neukazovat
  splitTotalMinutes?: number;
  // Drift kalendáře (uložený end/start bloku nesedí na aktuální expanzi tiskových hodin) —
  // informační badge pro VŠECHNY role (viz níže), akce (banner „Přepočítat") je jen na stroji.
  calendarDrift?: CalendarDriftInfo | null;
  // Střídání odstínů — parita 0 (základní) / 1 (světlejší) pro odlišení sousedících
  // zakázek téže barvy; počítá rodič (computeShadeParity), undefined = neúčastní se.
  shadeParity?: 0 | 1;
  // Pauza (mimo provoz) uvnitř bloku, který zasahuje přes odstávku/nepracovní čas —
  // pixelové offsety (top/height) relativní k bloku, předpočítané v rodiči (má dateToY/viewStart/slotHeight).
  pauseOverlays?: { key: string; top: number; height: number }[];
  // Výška prvního print segmentu v px — když blok má segmenty, volba layout modu (MODE_FULL/…)
  // se řídí touto výškou místo clampedHeight, aby obsah nepropadl do pauzy. Beze změny pozice/výšky divu.
  contentHeight?: number;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onResizeMouseDown?: (e: React.MouseEvent) => void;
  onBlockUpdate: (b: Block, addToHistory?: boolean) => void;
  onError?: (msg: string) => void;
  canEdit?: boolean;
  canEditData?: boolean;
  canEditDataDate?: boolean;
  canEditMat?: boolean;
  onDataChipDoubleClick?: (blockId: number, rect: DOMRect) => void;
  onInlineDatePick?: (blockId: number, field: "data" | "material" | "pantone", currentValue: string, rect: DOMRect) => void;
  badgeColorMap?: Record<number, string | null>;
  onBlockCopy?: () => void;
  onBlockSplit?: (splitAt: Date) => void;
  getSplitAt?: (clientY: number) => Date;
  isTiskar?: boolean;
  onPrintComplete?: (blockId: number, completed: boolean) => Promise<void>;
  onNotify?: (blockId: number, orderNumber: string) => void;
  onBlockVariantChange?: (blockId: number, variant: BlockVariant) => void;
  onExpeditionPublish?:   (blockId: number) => Promise<void>;
  onExpeditionUnpublish?: (blockId: number) => Promise<void>;
  onOpenNotes?: (block: Block) => void;
  splitPartner?: Block | null;
  onSplitChipClick?: (partnerId: number) => void;
}) {
  const [resizeHovered, setResizeHovered] = useState(false);
  const [hovered, setHovered]             = useState(false);
  const [badgeHovered, setBadgeHovered]   = useState(false);
  const [printPending, setPrintPending]   = useState(false);
  const blockCardRef = useRef<HTMLDivElement>(null);
  const compactDataTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compactMatTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compactPanTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [noteOpen, setNoteOpen]   = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteRect, setNoteRect]   = useState<{ bottom: number; left: number } | null>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const splitAtRef      = useRef<Date | null>(null);
  const ctxMouseRef     = useRef<{ x: number; y: number } | null>(null);

  const isPrintDone   = block.printCompletedAt != null;
  const isPozastaveno = block.type === "ZAKAZKA" && block.blockVariant === "POZASTAVENO";
  const isUnconfirmedReservation = block.type === "REZERVACE" && block.reservationId != null && !block.reservationConfirmedAt;
  const isOverdue     = block.type === "ZAKAZKA" && new Date(block.endTime) < now && !isPrintDone && !isPozastaveno;
  // Deadline štítek — nezávislé na isOverdue (to je „konec bloku je v minulosti").
  // Tady srovnáváme civilní datum konce (Praha) s civilním datem deadlineExpedice:
  // string porovnání dateStr je DST-safe a přesně odpovídá „po deadline dni", i když
  // je blok ještě naplánovaný do budoucna (na rozdíl od isOverdue běží nezávisle na `now`).
  const isPastDeadline = block.type === "ZAKAZKA" && !!block.deadlineExpedice
    && utcToPragueDateStr(new Date(block.endTime)) > block.deadlineExpedice;
  const clampedHeight = Math.max(height, 20);
  // Layout mody se řídí výškou prvního print segmentu (obsah se má vejít do tiskové části,
  // ne propadnout do pauzy) — pro bloky bez segmentů (99 % plánu) je to prostě clampedHeight.
  const layoutHeight  = contentHeight ?? clampedHeight;

  const dataDeadlineState = deadlineState(block.dataRequiredDate, block.dataOk, now, block.startTime);
  const dataDisplayLabel = block.dataStatusLabel?.trim() || "";
  const dataCanToggle = false;
  const dataCanOpenCalendar    = !block.dataOk && !!canEditDataDate && !!onInlineDatePick;
  const dataCanOpenDtpPopover  = !!canEditData && !canEditDataDate && !!onDataChipDoubleClick;
  // materialInStock i materialIssued potlačují warning logiku materiálu
  const materialHandled = block.materialInStock || block.materialIssued;
  const materialDeadlineState = materialHandled
    ? "ok"
    : deadlineState(block.materialRequiredDate, block.materialOk, now, block.startTime);
  const pantoneDeadlineState = deadlineState(block.pantoneRequiredDate, block.pantoneOk, now, block.startTime);

  const s = isPrintDone
    ? BLOCK_PRINT_DONE
    : isPozastaveno
    ? BLOCK_STYLES["ZAKAZKA_POZASTAVENO"]
    : isOverdue
    ? BLOCK_OVERDUE
    : (BLOCK_STYLES[getBlockStyleKey(block.type, block.blockVariant)] ?? BLOCK_STYLES["ZAKAZKA"]);

  // Střídání odstínů — světlý/tmavý wash přes gradient, aby šla vidět hranice mezi
  // sousedícími zakázkami/rezervacemi téže barvy. Aplikuje se jen na plné barevné
  // stavy; dokončený tisk a bloky po termínu mají vlastní tlumený vzhled → beze změny.
  const shadeEligible = !isPrintDone && !isOverdue && shadeParity != null;
  const shadedBackground = shadeEligible
    ? shadeParity === 1
      ? `linear-gradient(rgba(255,255,255,0.30), rgba(255,255,255,0.30)), ${s.gradient}`
      : `linear-gradient(rgba(6,10,20,0.10), rgba(6,10,20,0.10)), ${s.gradient}`
    : s.gradient;

  // Badge accenty — custom barva z číselníku, fallback na dnešní chování per-field
  const dataKey    = block.dataStatusId     ? (badgeColorMap?.[block.dataStatusId]     ?? null) : null;
  const matKey     = block.materialStatusId ? (badgeColorMap?.[block.materialStatusId]  ?? null) : null;
  const barvyKey   = block.barvyStatusId    ? (badgeColorMap?.[block.barvyStatusId]     ?? null) : null;
  const lakKey     = block.lakStatusId      ? (badgeColorMap?.[block.lakStatusId]       ?? null) : null;
  const dataAccent    = (dataKey    ? badgeColorVar(dataKey)    : null) ?? s.accentBar;
  const matAccent     = (matKey     ? badgeColorVar(matKey)     : null) ?? s.textSub;
  const barvyAccent   = (barvyKey   ? badgeColorVar(barvyKey)   : null) ?? "var(--text-muted)";
  const lakAccent     = (lakKey     ? badgeColorVar(lakKey)     : null) ?? "var(--text-muted)";
  const dataText    = chipTextColor(dataKey);
  const matText     = chipTextColor(matKey);
  const barvyText   = chipTextColor(barvyKey);
  const lakText     = chipTextColor(lakKey);

  const hasNoteRow = Boolean(
    block.dataStatusLabel ||
    block.materialStatusLabel ||
    block.barvyStatusLabel ||
    block.lakStatusLabel ||
    block.specifikace
  );

  // Výškové mody (vzájemně se vylučují). Řídí se layoutHeight (výška prvního print segmentu,
  // pokud blok segmenty má) — u bloku s pauzou uprostřed se obsah vejde do tiskové části
  // a nepropadne do vizuální pauzy uprostřed bloku.
  const MODE_FULL    = layoutHeight >= 48;                              // plný layout (od ~1h při zoom=26)
  const MODE_COMPACT = !MODE_FULL && layoutHeight >= 44 && block.type !== "UDRZBA";
  const MODE_TINY    = !MODE_FULL && !MODE_COMPACT && layoutHeight >= 24; // micro tečky
  const MODE_MICRO_TEXT = !MODE_FULL && !MODE_COMPACT && !MODE_TINY && layoutHeight >= 14; // 14–23 px: sdílí TINY řádek (D/M/E chipy + číslo + popis)
  // Výškové prahy pro FULL mode
  const showDatesFull    = !isTiskar && MODE_FULL && layoutHeight >= 60 && block.type !== "UDRZBA"; // plný DateBadge řádek (≥60px)
  const showDatesCompact = !isTiskar && MODE_FULL && layoutHeight < 60  && block.type !== "UDRZBA"; // kompaktní chip řádek (48–59px)
  const showDates        = showDatesFull;
  const showSpec   = layoutHeight >= 80;  // 3. řádek — specifikace
  // Popis za číslem zakázky. Zobrazujeme v celém FULL módu (≥48px), ne až od 66px —
  // jinak bloky v pásmu 48–65px (typicky 2–2,5h při odzoomu) neukazovaly popis,
  // zatímco menší COMPACT/TINY bloky ho ukazují. Číslo zakázky výšku řádku určuje,
  // takže 1řádkový popis v tomto pásmu nestojí žádný prostor navíc.
  const showDesc   = MODE_FULL && layoutHeight >= 48;
  // Počet řádků popisu — v úzkém pásmu (48–65px) přesně 1 řádek (víc se nevejde vedle
  // datového řádku), od 66px roste s výškou bloku (13px/řádek).
  const descLineClamp = layoutHeight < 66 ? 1 : Math.max(2, Math.floor((layoutHeight - 55) / 13));

  const opacity = dimmed ? 0.12 : isDragging ? 0.72 : 1;
  const glow = s.glow;
  const shadow  = selected
    ? "0 0 0 1.5px #FFE600, 0 4px 16px rgba(0,0,0,0.6)"
    : multiSelected
      ? "0 0 0 3px rgba(255,230,0,0.4), 0 0 12px rgba(255,230,0,0.3), 0 4px 16px rgba(0,0,0,0.5)"
      : hovered && !isDragging
        ? `0 6px 24px rgba(0,0,0,0.55), 0 0 16px ${glow}, inset 0 1px 0 rgba(255,255,255,0.08)`
        : `0 2px 8px rgba(0,0,0,0.35), 0 0 10px ${glow}, inset 0 1px 0 rgba(255,255,255,0.05)`;

  async function toggleField(field: "dataOk" | "materialOk" | "pantoneOk", current: boolean) {
    try {
      const res = await fetch(`/api/blocks/${block.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !current }),
      });
      if (res.ok) onBlockUpdate(await res.json(), true);
    } catch (error) {
      console.error("Block field toggle failed", error);
      onError?.("Změnu sloupce se nepodařilo uložit.");
    }
  }

  function openNoteEditor(pos: { bottom: number; left: number } | null) {
    setNoteRect(pos);
    setNoteDraft(block.materialNote ?? "");
    setNoteOpen(true);
    setTimeout(() => noteTextareaRef.current?.focus(), 50);
  }

  async function saveNote() {
    setNoteSaving(true);
    try {
      const res = await fetch(`/api/blocks/${block.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialNote: noteDraft.trim() || null }),
      });
      if (res.ok) {
        onBlockUpdate(await res.json(), true);
        setNoteOpen(false);
      } else {
        onError?.("Poznámku se nepodařilo uložit.");
      }
    } catch (error) {
      console.error("Save note failed", error);
      onError?.("Poznámku se nepodařilo uložit.");
    } finally {
      setNoteSaving(false);
    }
  }

  async function clearNote() {
    try {
      const res = await fetch(`/api/blocks/${block.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialNote: null }),
      });
      if (res.ok) onBlockUpdate(await res.json(), true);
    } catch (error) {
      console.error("Clear note failed", error);
      onError?.("Poznámku se nepodařilo smazat.");
    }
  }

  const menuItemStyle: React.CSSProperties = { borderRadius: 7, padding: "6px 10px", fontSize: 13, color: "rgba(255,255,255,0.9)", cursor: "pointer" };
  const hasNote = !!block.materialNote;
  const tiskarNotes = block.notes ?? [];
  const hasTiskarNotes = tiskarNotes.length > 0;
  const showMenu = (canEdit && !block.locked) || canEditMat || hasNote || !!onOpenNotes;

  const showTooltip = block.type !== "UDRZBA" && !badgeHovered;

  const blockDiv = (
    <div
      ref={blockCardRef}
      data-block="true"
      data-planner-block-card="true"
      onMouseDown={(e) => { e.preventDefault(); if (!block.locked) onMouseDown?.(e); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
      style={{
        position: "absolute", top, height: Math.min(clampedHeight, maxRenderHeight ?? Infinity), left: 3,
        width: "calc(100% - 6px)",
        zIndex: isDragging ? Z_TIMELINE.blockDrag : resizeHovered ? Z_TIMELINE.blockResizeHover : hovered ? Z_TIMELINE.blockHover : Z_TIMELINE.blockBase,
        cursor: block.locked ? "default" : isDragging ? "grabbing" : "grab",
        opacity, borderRadius: 7,
        border: isCopied ? "1.5px dashed #3b82f6" : multiSelected ? "2.5px solid #FFE600" : block.locked ? "1.5px solid rgba(251,191,36,0.7)" : isUnconfirmedReservation ? "1.5px dashed rgba(168,85,247,0.7)" : `1px solid ${selected ? "#FFE600" : s.border}`,
        outline: isCopied ? "1px solid rgba(59,130,246,0.3)" : undefined,
        outlineOffset: isCopied ? "2px" : undefined,
        boxShadow: block.locked
          ? `${shadow}, 0 0 0 1px rgba(251,191,36,0.35)`
          : shadow,
        background: shadedBackground,
        display: "flex", flexDirection: "column",
        overflow: "hidden", userSelect: "none",
        transition: isDragging ? "none" : "box-shadow 0.15s",
        animationName: "blockEnter",
        animationDuration: "220ms",
        animationTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        animationFillMode: "backwards",
      }}
    >
      {/* Levý barevný pruh — iOS Calendar style / amber lock strip */}
      {block.locked ? (
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 22, background: "rgba(251,191,36,0.4)", borderRadius: "7px 0 0 7px", borderRight: "1px solid rgba(251,191,36,0.35)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Lock size={11} strokeWidth={2} color="rgba(251,191,36,1)" />
        </div>
      ) : isUnconfirmedReservation ? (
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 22, background: "rgba(168,85,247,0.35)", borderRadius: "7px 0 0 7px", borderRight: "1px solid rgba(168,85,247,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Hourglass size={11} strokeWidth={2} color="rgba(168,85,247,1)" />
        </div>
      ) : (
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: s.accentBar, opacity: isOverdue ? 0.4 : 1, borderRadius: "7px 0 0 7px", flexShrink: 0 }} />
      )}

      {/* Modrý selection overlay */}
      {multiSelected && <div style={{ position: "absolute", inset: 0, borderRadius: 6, background: "rgba(255,230,0,0.12)", pointerEvents: "none", zIndex: 1 }} />}

      {/* Deadline štítek — pravý horní roh (FULL/COMPACT plný text, TINY jen ⚠).
          Fixní pozice top:4/right:4 — když je zároveň přítomný 📝 badge tiskařských
          poznámek (stejný roh), ten se odsune níž (viz jeho `top` níž), aby nekolidovaly.
          zIndex 4 — nad content (2–3), pod drag/resize stavy (5–20) i paste marker (25).
          Pod MODE_TINY (layoutHeight < 24, „micro tečky") se nezobrazuje vůbec —
          na bloku bez jakéhokoliv textového obsahu by badge jen kolidoval s okrajem. */}
      {isPastDeadline && (MODE_FULL || MODE_COMPACT || MODE_TINY) && (
        <span
          title={`Po termínu expedice (${block.deadlineExpedice})`}
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            background: "#b91c1c",
            color: "#fff",
            fontSize: 9,
            fontWeight: 800,
            lineHeight: 1,
            borderRadius: 4,
            padding: "1px 5px",
            zIndex: 4,
            userSelect: "none",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {MODE_TINY ? "⚠" : "⚠ PO DEADLINE"}
        </span>
      )}

      {/* Drift kalendáře štítek — druhé patro stacku pravého horního rohu, pod deadline
          badge (etapa 6). Informační pro VŠECHNY role (i TISKAR/VIEWER) — akce
          „Přepočítat" je jen v banneru stroje / BlockDetail, gatované na ADMIN/PLANOVAT.
          Parita s deadline badge: TINY jen „⚠", pod TINY nic. */}
      {!!calendarDrift && (MODE_FULL || MODE_COMPACT || MODE_TINY) && (
        <span
          title={
            calendarDrift.reason === "END_MISMATCH" && calendarDrift.expectedEnd
              ? `Konec nesedí na aktuální kalendář (správně do ${formatPragueDateTime(calendarDrift.expectedEnd)})`
              : "Umístění bloku nesedí na aktuální kalendář"
          }
          style={{
            position: "absolute",
            top: isPastDeadline ? 22 : 4,
            right: 4,
            background: "#f59e0b",
            color: "#1f2937",
            fontSize: 9,
            fontWeight: 800,
            lineHeight: 1,
            borderRadius: 4,
            padding: "1px 5px",
            zIndex: 4,
            userSelect: "none",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {MODE_TINY ? "⚠" : "⚠ KALENDÁŘ"}
        </span>
      )}

      {/* Tiskařské poznámky — oranžový pruh nahoře přes celou šířku + badge v rohu */}
      {hasTiskarNotes && (
        <>
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 4,
              background: "#f59e0b",
              borderTopLeftRadius: 7,
              borderTopRightRadius: 7,
              pointerEvents: "none",
              zIndex: 3,
            }}
          />
          <span
            title={`Poznámek tiskaře: ${tiskarNotes.length}`}
            onClick={onOpenNotes ? (e) => { e.stopPropagation(); onOpenNotes(block); } : undefined}
            style={{
              position: "absolute",
              // Odsunuto níž o každý přítomný badge nad ním ve stejném rohu (deadline, drift).
              top: 7 + (isPastDeadline ? 18 : 0) + (calendarDrift ? 18 : 0),
              right: 4,
              background: "#f59e0b",
              color: "#1f2937",
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1,
              padding: "2px 6px",
              borderRadius: 4,
              boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
              cursor: onOpenNotes ? "pointer" : "default",
              zIndex: 4,
              userSelect: "none",
            }}
          >
            📝 {tiskarNotes.length}
          </span>
        </>
      )}


      {/* ── MODE_COMPACT: 2 řádky — [datumy horiz. + chips] / [číslo + popis] ── */}
      {MODE_COMPACT && (() => {
        const dStateKey = block.dataStatusId ? "ok" : !block.dataRequiredDate ? "empty" : dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
        const mStateKey = block.materialIssued ? "issued" : block.materialInStock ? "ok" : (!block.materialRequiredDate ? "empty" : materialDeadlineState === "none" ? "neutral" : materialDeadlineState);
        const eStateKey = !block.deadlineExpedice ? "empty" : "neutral";
        const pStateKey = !block.pantoneRequired && !block.pantoneRequiredDate && !block.pantoneOk ? "empty" : block.pantoneOk ? "ok" : !block.pantoneRequiredDate ? "warning" : pantoneDeadlineState === "none" ? "neutral" : pantoneDeadlineState;
        const dateChip = (stateKey: string, fieldAccent: string, clickable: boolean): React.CSSProperties => ({
          fontSize: 10, fontWeight: 600,
          color: stateKey === "empty" ? "#fff" : "rgba(255,255,255,0.90)",
          background: DEADLINE_BG[stateKey] ?? DEADLINE_BG.neutral,
          borderTop: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`, borderRight: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`, borderBottom: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`,
          borderLeft: `2px solid ${fieldAccent}`,
          borderRadius: 4, padding: "2px 6px 2px 5px",
          whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1,
          cursor: clickable ? "pointer" : "default",
          userSelect: "none",
        });
        const dIcon = dataDeadlineState === "ok" ? " ✓" : dataDeadlineState === "danger" ? " ✕" : dataDeadlineState === "warning" ? " !" : dataDeadlineState === "earlyStart" ? " ⚠" : "";
        const mIcon = materialDeadlineState === "ok" ? " ✓" : materialDeadlineState === "danger" ? " ✕" : materialDeadlineState === "warning" ? " !" : materialDeadlineState === "earlyStart" ? " ⚠" : "";
        const pIcon = pantoneDeadlineState === "ok" ? " ✓" : pantoneDeadlineState === "danger" ? " ✕" : pantoneDeadlineState === "warning" ? " !" : pantoneDeadlineState === "earlyStart" ? " ⚠" : "";
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 4, paddingTop: 0, paddingBottom: 0, paddingLeft: (block.locked || isUnconfirmedReservation) ? 28 : 8, paddingRight: hasTiskarNotes ? 44 : 8, flex: 1, overflow: "hidden", minHeight: 0 }}>
            {/* Levá část: datumy + separator + číslo + popis */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 1, minWidth: 0, overflow: "hidden", maxWidth: (block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) ? "58%" : undefined }}>
              {!isTiskar && <>
                <span style={{
                    ...dateChip(dStateKey, FIELD_ACCENT.DATA, dataCanToggle),
                    ...(block.dataStatusId && dataAccent !== s.accentBar ? { background: dataAccent, borderTop: `1px solid ${dataAccent}`, borderRight: `1px solid ${dataAccent}`, borderBottom: `1px solid ${dataAccent}`, color: dataText ?? "#fff" } : {}),
                  }} title={dataDeadlineState === "earlyStart" ? "Start zakázky před dodáním dat" : undefined}
                  onClick={dataCanToggle ? (e) => { e.stopPropagation(); if (dataCanOpenCalendar || dataCanOpenDtpPopover) { if (compactDataTimerRef.current) clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = setTimeout(() => { compactDataTimerRef.current = null; toggleField("dataOk", block.dataOk); }, 350); } else { toggleField("dataOk", block.dataOk); } } : undefined}
                  onDoubleClick={(dataCanOpenCalendar || dataCanOpenDtpPopover) ? (e) => {
                    e.stopPropagation();
                    if (compactDataTimerRef.current) { clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = null; }
                    if (dataCanOpenCalendar) {
                      onInlineDatePick!(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect());
                    } else if (dataCanOpenDtpPopover) {
                      onDataChipDoubleClick!(block.id, e.currentTarget.getBoundingClientRect());
                    }
                  } : undefined}>
                  {block.dataStatusId ? dataDisplayLabel : `D\u00a0${block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}`}
                </span>
                <MaterialNoteAffordance indicatorSize={4} indicatorTop={1} indicatorRight={1} block={block}>
                  <span style={dateChip(mStateKey, FIELD_ACCENT.MATERIAL, !!block.materialRequiredDate && !block.materialInStock && !block.materialIssued)} title={materialDeadlineState === "earlyStart" ? "Start zakázky před dodáním materiálu" : undefined}
                    onClick={block.materialRequiredDate && !block.materialInStock && !block.materialIssued ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactMatTimerRef.current) clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = setTimeout(() => { compactMatTimerRef.current = null; toggleField("materialOk", block.materialOk); }, 350); } else { toggleField("materialOk", block.materialOk); } } : undefined}
                    onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactMatTimerRef.current) { clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = null; } onInlineDatePick(block.id, "material", block.materialRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                    M&nbsp;{block.materialIssued ? "VYD." : block.materialInStock ? "SKLAD" : block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${mIcon}` : "—"}
                  </span>
                </MaterialNoteAffordance>
                <span style={dateChip(eStateKey, FIELD_ACCENT.EXPEDICE, false)}>
                  E&nbsp;{block.deadlineExpedice ? fmtDateShort(block.deadlineExpedice) : "—"}
                </span>
                {(block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk) && (
                  <span style={dateChip(pStateKey, FIELD_ACCENT.PANTONE, !!block.pantoneRequiredDate)} title={pantoneDeadlineState === "earlyStart" ? "Start zakázky před dodáním pantonu" : undefined}
                    onClick={block.pantoneRequiredDate ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactPanTimerRef.current) clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = setTimeout(() => { compactPanTimerRef.current = null; toggleField("pantoneOk", block.pantoneOk); }, 350); } else { toggleField("pantoneOk", block.pantoneOk); } } : undefined}
                    onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactPanTimerRef.current) { clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = null; } onInlineDatePick(block.id, "pantone", block.pantoneRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                    P&nbsp;{block.pantoneOk ? "OK" : block.pantoneRequiredDate ? `${fmtDateShort(block.pantoneRequiredDate)}${pIcon}` : "⚠"}
                  </span>
                )}
                <div style={{ width: 1, height: 12, background: "var(--border)", flexShrink: 0 }} />
              </>}
              <span style={{ fontSize: 11, fontWeight: 700, color: s.textPrimary, whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1 }}>
                {block.orderNumber}{block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.85 }}><Lock size={9} strokeWidth={2} /></span>}{isUnconfirmedReservation && !block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.85 }}><Hourglass size={9} strokeWidth={2} /></span>}
                {isPrintDone && <span style={{ marginLeft: 4, fontSize: 9, color: "#22c55e", fontWeight: 700 }}>✓</span>}
                {isOverdue && !isPrintDone && block.type === "ZAKAZKA" && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 4 }}><Clock size={11} strokeWidth={2.5} color="#f59e0b" /></span>}
              </span>
              {(block.description || block.specifikace) && (
                <span style={{ display: "flex", alignItems: "baseline", gap: 3, flex: 1, minWidth: 0, overflow: "hidden" }}>
                  {block.description && (
                    <span style={{ fontSize: 9, fontWeight: 400, color: s.textSub, opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1, flexShrink: 1 }}>
                      {block.description}
                    </span>
                  )}
                  {block.specifikace && (
                    <span style={{ fontSize: 9, fontStyle: "italic", color: "var(--text-muted)", opacity: 0.72, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1, flexShrink: 2, minWidth: 0 }}>
                      {block.description ? "· " : ""}{block.specifikace}
                    </span>
                  )}
                </span>
              )}
            </div>
            {/* Uprostřed: typový chip (OBÁLKA/VNITŘKY/TA·série), vystředěný spacery */}
            {(block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) && (
              <>
                <div style={{ flex: 1, minWidth: 6 }} />
                <ProductionChips obalka={block.obalka} vnitrky={block.vnitrky} tiskoveArchy={block.tiskoveArchy} serie={block.serie} abbreviated />
              </>
            )}
            <div style={{ flex: 1, minWidth: 6 }} />
            {/* Vpravo: status chipy + série marker + tiskař + split */}
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
              {(hasNoteRow || block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
                  {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={matAccent}   textColor={matText   ?? undefined} />}
                  {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent={barvyAccent} textColor={barvyText ?? undefined} />}
                  {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent={lakAccent}   textColor={lakText   ?? undefined} />}
                  {(block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                    <span style={{ fontSize: 8, opacity: 0.4, color: s.textSub, flexShrink: 0 }}>↻</span>
                  )}
                </div>
              )}
              {isTiskar && onPrintComplete && block.type === "ZAKAZKA" && (
                <button onClick={(e) => { e.stopPropagation(); setPrintPending(true); onPrintComplete(block.id, !isPrintDone).finally(() => setPrintPending(false)); }} disabled={printPending}
                  style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 5, border: "none", cursor: printPending ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", background: isPrintDone ? "rgba(100,116,139,0.3)" : "rgba(34,197,94,0.35)", color: isPrintDone ? "var(--text-muted)" : "#22c55e", opacity: printPending ? 0.5 : 1, transition: "all 0.12s ease-out", fontFamily: "inherit" }}
                  title={isPrintDone ? "Vrátit hotovo" : "Označit jako hotovo"}>
                  {printPending ? "·" : isPrintDone ? "↩" : "✓"}
                </button>
              )}
              {splitPartner && clampedHeight >= 32 && (() => {
                const { state, time } = getSplitChipState(splitPartner);
                return (
                  <SplitChip
                    partnerMachine={splitPartner.machine}
                    state={state}
                    time={time}
                    onClick={() => onSplitChipClick?.(splitPartner.id)}
                  />
                );
              })()}
            </div>
          </div>
        );
      })()}

      {/* ── MODE_TINY + MICRO_TEXT: jednořádkový layout — [D chip][M chip][E chip] · číslo · popis.
          Sdílený pro obě úzká pásma (14–43 px): chipy dodání dat/materiálu/expedice mají přednost,
          popis se uřízne elipsou, když nezbude místo. Půlhodinový blok v nadhledu (14–23 px) tak
          neztratí D/M/E chipy — dřív MICRO_TEXT ukazoval jen popis bez chipů. ── */}
      {(MODE_TINY || MODE_MICRO_TEXT) && (() => {
        const dStateKey = block.dataStatusId ? "ok" : !block.dataRequiredDate ? "empty" : dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
        const mStateKey = block.materialIssued ? "issued" : block.materialInStock ? "ok" : (!block.materialRequiredDate ? "empty" : materialDeadlineState === "none" ? "neutral" : materialDeadlineState);
        const eStateKey = !block.deadlineExpedice ? "empty" : "neutral";
        const chipStyle = (stateKey: string, fieldAccent: string, clickable: boolean): React.CSSProperties => ({
          fontSize: 9, fontWeight: 600,
          color: stateKey === "empty" ? "#fff" : "rgba(255,255,255,0.90)",
          background: DEADLINE_BG[stateKey] ?? DEADLINE_BG.neutral,
          borderTop: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`, borderRight: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`, borderBottom: `1px solid ${DEADLINE_BORDER[stateKey] ?? DEADLINE_BORDER.neutral}`,
          borderLeft: `2px solid ${fieldAccent}`,
          borderRadius: 3, padding: "1px 5px 1px 4px",
          whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1,
          cursor: clickable ? "pointer" : "default",
          userSelect: "none",
        });
        const dIcon = dataDeadlineState === "ok" ? " ✓" : dataDeadlineState === "danger" ? " ✕" : dataDeadlineState === "warning" ? " !" : dataDeadlineState === "earlyStart" ? " ⚠" : "";
        const mIcon = materialDeadlineState === "ok" ? " ✓" : materialDeadlineState === "danger" ? " ✕" : materialDeadlineState === "warning" ? " !" : materialDeadlineState === "earlyStart" ? " ⚠" : "";
        const pIcon = pantoneDeadlineState === "ok" ? " ✓" : pantoneDeadlineState === "danger" ? " ✕" : pantoneDeadlineState === "warning" ? " !" : pantoneDeadlineState === "earlyStart" ? " ⚠" : "";
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 4, paddingTop: 0, paddingBottom: 0, paddingLeft: (block.locked || isUnconfirmedReservation) ? 28 : 8, paddingRight: hasTiskarNotes ? 44 : 8, flex: 1, overflow: "hidden", minHeight: 0 }}>
            {/* Levá část: datum chips + číslo + popis */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 1, minWidth: 0, overflow: "hidden", maxWidth: (block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) ? "58%" : undefined }}>
              {!isTiskar && block.type !== "UDRZBA" && <>
                <span style={{
                    ...chipStyle(dStateKey, FIELD_ACCENT.DATA, dataCanToggle),
                    ...(block.dataStatusId && dataAccent !== s.accentBar ? { background: dataAccent, borderTop: `1px solid ${dataAccent}`, borderRight: `1px solid ${dataAccent}`, borderBottom: `1px solid ${dataAccent}`, color: dataText ?? "#fff" } : {}),
                  }} title={dataDeadlineState === "earlyStart" ? "Start zakázky před dodáním dat" : undefined}
                  onClick={dataCanToggle ? (e) => { e.stopPropagation(); if (dataCanOpenCalendar || dataCanOpenDtpPopover) { if (compactDataTimerRef.current) clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = setTimeout(() => { compactDataTimerRef.current = null; toggleField("dataOk", block.dataOk); }, 350); } else { toggleField("dataOk", block.dataOk); } } : undefined}
                  onDoubleClick={(dataCanOpenCalendar || dataCanOpenDtpPopover) ? (e) => {
                    e.stopPropagation();
                    if (compactDataTimerRef.current) { clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = null; }
                    if (dataCanOpenCalendar) {
                      onInlineDatePick!(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect());
                    } else if (dataCanOpenDtpPopover) {
                      onDataChipDoubleClick!(block.id, e.currentTarget.getBoundingClientRect());
                    }
                  } : undefined}>
                  {block.dataStatusId ? dataDisplayLabel : `D\u00a0${block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}`}
                </span>
                <MaterialNoteAffordance indicatorSize={4} indicatorTop={1} indicatorRight={1} block={block}>
                  <span style={chipStyle(mStateKey, FIELD_ACCENT.MATERIAL, !!block.materialRequiredDate && !block.materialInStock && !block.materialIssued)} title={materialDeadlineState === "earlyStart" ? "Start zakázky před dodáním materiálu" : undefined}
                    onClick={block.materialRequiredDate && !block.materialInStock && !block.materialIssued ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactMatTimerRef.current) clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = setTimeout(() => { compactMatTimerRef.current = null; toggleField("materialOk", block.materialOk); }, 350); } else { toggleField("materialOk", block.materialOk); } } : undefined}
                    onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactMatTimerRef.current) { clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = null; } onInlineDatePick(block.id, "material", block.materialRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                    M&nbsp;{block.materialIssued ? "VYD." : block.materialInStock ? "SKLAD" : block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${mIcon}` : "—"}
                  </span>
                </MaterialNoteAffordance>
                <span style={chipStyle(eStateKey, FIELD_ACCENT.EXPEDICE, false)}>
                  E&nbsp;{block.deadlineExpedice ? fmtDateShort(block.deadlineExpedice) : "—"}
                </span>
                {(block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk) && (() => {
                  const pStateKey = !block.pantoneRequired && !block.pantoneRequiredDate && !block.pantoneOk ? "empty" : block.pantoneOk ? "ok" : !block.pantoneRequiredDate ? "warning" : pantoneDeadlineState === "none" ? "neutral" : pantoneDeadlineState;
                  return (
                    <span style={chipStyle(pStateKey, FIELD_ACCENT.PANTONE, !!block.pantoneRequiredDate)} title={pantoneDeadlineState === "earlyStart" ? "Start zakázky před dodáním pantonu" : undefined}
                      onClick={block.pantoneRequiredDate ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactPanTimerRef.current) clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = setTimeout(() => { compactPanTimerRef.current = null; toggleField("pantoneOk", block.pantoneOk); }, 350); } else { toggleField("pantoneOk", block.pantoneOk); } } : undefined}
                      onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactPanTimerRef.current) { clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = null; } onInlineDatePick(block.id, "pantone", block.pantoneRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                      P&nbsp;{block.pantoneOk ? "OK" : block.pantoneRequiredDate ? `${fmtDateShort(block.pantoneRequiredDate)}${pIcon}` : "⚠"}
                    </span>
                  );
                })()}
                <div style={{ width: 1, height: 10, background: "var(--border)", flexShrink: 0 }} />
              </>}
              <span style={{ fontSize: 10, fontWeight: 700, color: s.textPrimary, whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1 }}>
                {block.orderNumber}{block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.85 }}><Lock size={8} strokeWidth={2} /></span>}{isUnconfirmedReservation && !block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.85 }}><Hourglass size={9} strokeWidth={2} /></span>}
              </span>
              {(block.description || block.specifikace) && (
                <span style={{ display: "flex", alignItems: "baseline", gap: 3, flex: 1, minWidth: 0, overflow: "hidden" }}>
                  {block.description && (
                    <span style={{ fontSize: 9, fontWeight: 400, color: s.textSub, opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1, flexShrink: 1 }}>
                      {block.description}
                    </span>
                  )}
                  {block.specifikace && (
                    <span style={{ fontSize: 9, fontStyle: "italic", color: "var(--text-muted)", opacity: 0.72, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1, flexShrink: 2, minWidth: 0 }}>
                      {block.description ? "· " : ""}{block.specifikace}
                    </span>
                  )}
                </span>
              )}
            </div>
            {/* Uprostřed: typový chip (OBÁLKA/VNITŘKY/TA·série), vystředěný spacery */}
            {(block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) && (
              <>
                <div style={{ flex: 1, minWidth: 6 }} />
                <ProductionChips obalka={block.obalka} vnitrky={block.vnitrky} tiskoveArchy={block.tiskoveArchy} serie={block.serie} abbreviated />
              </>
            )}
            <div style={{ flex: 1, minWidth: 6 }} />
            {/* Vpravo: status chipy + série marker + split marker + tiskař */}
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
              {(hasNoteRow || block.recurrenceType !== "NONE" || block.recurrenceParentId !== null || (splitTotal ?? 0) > 1) && (
                <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
                  {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={matAccent}   textColor={matText   ?? undefined} />}
                  {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent={barvyAccent} textColor={barvyText ?? undefined} />}
                  {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent={lakAccent}   textColor={lakText   ?? undefined} />}
                  {(block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                    <span style={{ fontSize: 8, opacity: 0.4, color: s.textSub, flexShrink: 0, lineHeight: 1 }}>↻</span>
                  )}
                  {(splitTotal ?? 0) > 1 && (
                    <span style={{ fontSize: 8, opacity: 0.55, color: s.textSub, flexShrink: 0, lineHeight: 1 }}>✂{splitPart}/{splitTotal}{(splitTotalMinutes ?? 0) > 0 ? ` · ${formatPrintHoursShort(splitTotalMinutes!)}` : ""}</span>
                  )}
                </div>
              )}
              {isTiskar && onPrintComplete && block.type === "ZAKAZKA" && (
                <button onClick={(e) => { e.stopPropagation(); setPrintPending(true); onPrintComplete(block.id, !isPrintDone).finally(() => setPrintPending(false)); }} disabled={printPending}
                  style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 5, border: "none", cursor: printPending ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", background: isPrintDone ? "rgba(100,116,139,0.3)" : "rgba(34,197,94,0.35)", color: isPrintDone ? "var(--text-muted)" : "#22c55e", opacity: printPending ? 0.5 : 1, transition: "all 0.12s ease-out", fontFamily: "inherit" }}
                  title={isPrintDone ? "Vrátit hotovo" : "Označit jako hotovo"}>
                  {printPending ? "·" : isPrintDone ? "↩" : "✓"}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Řádek 1: Číslo zakázky + popis + chips vpravo (FULL mode) ── */}
      {MODE_FULL && (
        <div style={{
          paddingTop: 5, paddingBottom: 3, paddingLeft: (block.locked || isUnconfirmedReservation) ? 28 : 9, paddingRight: hasTiskarNotes ? 44 : 9, display: "flex", alignItems: "flex-start",
          gap: 4, minWidth: 0, flexShrink: 0,
        }}>
          {/* Levá část: číslo + popis */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6, flex: 1, minWidth: 0, overflow: "hidden" }}>
            <span style={{
              fontSize: 12, fontWeight: 700, color: s.textPrimary,
              lineHeight: 1.2, flexShrink: 0, maxWidth: "60%",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {block.orderNumber}
              {block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 3, opacity: 0.85 }}><Lock size={9} strokeWidth={2} /></span>}{isUnconfirmedReservation && !block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.85 }}><Hourglass size={9} strokeWidth={2} /></span>}
            </span>
            {showDesc && block.description && (
              <span style={{
                fontSize: 10, fontWeight: 400, color: s.textSub, opacity: 0.75, lineHeight: 1.3,
                overflow: "hidden", display: "-webkit-box",
                WebkitLineClamp: descLineClamp, WebkitBoxOrient: "vertical",
                whiteSpace: "pre-wrap",
                flex: 1, minWidth: 0,
              }}>
                {block.description}
              </span>
            )}
          </div>
          {/* Pravá část: status chips + série + split */}
          {(hasNoteRow || block.recurrenceType !== "NONE" || block.recurrenceParentId !== null || (splitTotal ?? 0) > 1) && (
            <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
              {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={matAccent}   textColor={matText   ?? undefined} />}
              {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent={barvyAccent} textColor={barvyText ?? undefined} />}
              {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent={lakAccent}   textColor={lakText   ?? undefined} />}
              {(block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                <span style={{ fontSize: 8, opacity: 0.4, color: s.textSub }}>↻</span>
              )}
              {(splitTotal ?? 0) > 1 && (
                <span style={{ fontSize: 8, opacity: 0.55, color: s.textSub, flexShrink: 0, lineHeight: 1 }}>✂{splitPart}/{splitTotal}{(splitTotalMinutes ?? 0) > 0 ? ` · ${formatPrintHoursShort(splitTotalMinutes!)}` : ""}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Řádek 2: Klikatelné date badges (FULL mode) — vždy všechny 3 ── */}
      {showDates && block.type !== "UDRZBA" && (
        <div
          style={{ padding: "2px 7px 3px", display: "flex", gap: 5, flexWrap: "nowrap", flexShrink: 0, alignItems: "center" }}
          onMouseEnter={() => setBadgeHovered(true)}
          onMouseLeave={() => setBadgeHovered(false)}
        >
          <DateBadge
            label="DATA" dateStr={block.dataStatusId ? null : block.dataRequiredDate}
            overrideText={block.dataStatusId ? dataDisplayLabel : undefined}
            ok={block.dataStatusId ? true : dataDeadlineState === "ok"} warn={dataDeadlineState === "warning"} danger={dataDeadlineState === "danger"} earlyStart={dataDeadlineState === "earlyStart"}
            accent={FIELD_ACCENT.DATA}
            onToggle={undefined}
            onDoubleClick={(dataCanOpenCalendar || dataCanOpenDtpPopover) ? (rect) => {
              if (dataCanOpenCalendar) { onInlineDatePick?.(block.id, "data", block.dataRequiredDate ?? "", rect); }
              else if (dataCanOpenDtpPopover) { onDataChipDoubleClick?.(block.id, rect); }
            } : undefined}
            statusLabel={block.dataStatusLabel}
            customBg={block.dataStatusId && dataAccent !== s.accentBar ? dataAccent : undefined}
            customBorder={block.dataStatusId && dataAccent !== s.accentBar ? dataAccent : undefined}
            customTextColor={block.dataStatusId && dataAccent !== s.accentBar ? (dataText ?? "#fff") : undefined}
          />
          <MaterialNoteAffordance block={block}>
            <DateBadge
              label="MAT." dateStr={materialHandled ? null : block.materialRequiredDate}
              overrideText={block.materialIssued ? "VYDÁNO" : block.materialInStock ? "SKLADEM" : undefined}
              ok={materialHandled || materialDeadlineState === "ok"} warn={!materialHandled && materialDeadlineState === "warning"} danger={!materialHandled && materialDeadlineState === "danger"} earlyStart={!materialHandled && materialDeadlineState === "earlyStart"}
              accent={FIELD_ACCENT.MATERIAL}
              onToggle={materialHandled ? () => {} : () => toggleField("materialOk", block.materialOk)}
              onDoubleClick={canEditMat ? (rect) => onInlineDatePick?.(block.id, "material", block.materialRequiredDate ?? "", rect) : undefined}
              statusLabel={block.materialStatusLabel}
              customBg={block.materialIssued ? DEADLINE_BG.issued : undefined}
              customBorder={block.materialIssued ? DEADLINE_BORDER.issued : undefined}
            />
          </MaterialNoteAffordance>
          <DateBadge
            label="EXP." dateStr={block.deadlineExpedice}
            ok={false} warn={false} danger={false} accent={FIELD_ACCENT.EXPEDICE}
            onToggle={() => {}}
          />
          {(block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk) && (
            <DateBadge
              label="PAN." dateStr={block.pantoneOk ? null : block.pantoneRequiredDate}
              overrideText={block.pantoneOk ? "OK" : !block.pantoneRequiredDate ? "⚠" : undefined}
              ok={pantoneDeadlineState === "ok"} warn={pantoneDeadlineState === "warning" || (!block.pantoneRequiredDate && !block.pantoneOk && block.pantoneRequired)} danger={pantoneDeadlineState === "danger"} earlyStart={pantoneDeadlineState === "earlyStart"} accent={FIELD_ACCENT.PANTONE}
              onToggle={() => toggleField("pantoneOk", block.pantoneOk)}
              onDoubleClick={canEditMat ? (rect) => onInlineDatePick?.(block.id, "pantone", block.pantoneRequiredDate ?? "", rect) : undefined}
            />
          )}
        </div>
      )}

      {/* ── Řádek 2b: Kompaktní datum chipy (MODE_FULL, 48–59px — plný DateBadge se nevejde) ── */}
      {showDatesCompact && (() => {
        const dSK = block.dataStatusId ? "ok" : !block.dataRequiredDate ? "empty" : dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
        const mSK = block.materialIssued ? "issued" : block.materialInStock ? "ok" : (!block.materialRequiredDate ? "empty" : materialDeadlineState === "none" ? "neutral" : materialDeadlineState);
        const eSK = !block.deadlineExpedice ? "empty" : "neutral";
        const pSK = !block.pantoneRequired && !block.pantoneRequiredDate && !block.pantoneOk ? "empty" : block.pantoneOk ? "ok" : !block.pantoneRequiredDate ? "warning" : pantoneDeadlineState === "none" ? "neutral" : pantoneDeadlineState;
        const cs = (sk: string, fa: string, clickable: boolean): React.CSSProperties => ({
          fontSize: 9, fontWeight: 600,
          color: sk === "empty" ? "#fff" : "rgba(255,255,255,0.90)",
          background: DEADLINE_BG[sk] ?? DEADLINE_BG.neutral,
          borderTop: `1px solid ${DEADLINE_BORDER[sk] ?? DEADLINE_BORDER.neutral}`, borderRight: `1px solid ${DEADLINE_BORDER[sk] ?? DEADLINE_BORDER.neutral}`, borderBottom: `1px solid ${DEADLINE_BORDER[sk] ?? DEADLINE_BORDER.neutral}`,
          borderLeft: `2px solid ${fa}`,
          borderRadius: 3, padding: "1px 5px 1px 4px",
          whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1,
          cursor: clickable ? "pointer" : "default",
          userSelect: "none",
        });
        const dIcon = dataDeadlineState === "ok" ? " ✓" : dataDeadlineState === "danger" ? " ✕" : dataDeadlineState === "warning" ? " !" : dataDeadlineState === "earlyStart" ? " ⚠" : "";
        const mIcon = materialDeadlineState === "ok" ? " ✓" : materialDeadlineState === "danger" ? " ✕" : materialDeadlineState === "warning" ? " !" : materialDeadlineState === "earlyStart" ? " ⚠" : "";
        const pIcon = pantoneDeadlineState === "ok" ? " ✓" : pantoneDeadlineState === "danger" ? " ✕" : pantoneDeadlineState === "warning" ? " !" : pantoneDeadlineState === "earlyStart" ? " ⚠" : "";
        return (
          <div style={{ padding: "0 7px 3px", display: "flex", gap: 4, flexShrink: 0, overflow: "hidden", alignItems: "center" }}>
            <span style={{
                ...cs(dSK, FIELD_ACCENT.DATA, dataCanToggle),
                ...(block.dataStatusId && dataAccent !== s.accentBar ? { background: dataAccent, borderTop: `1px solid ${dataAccent}`, borderRight: `1px solid ${dataAccent}`, borderBottom: `1px solid ${dataAccent}`, color: dataText ?? "#fff" } : {}),
              }}
              onClick={dataCanToggle ? (e) => { e.stopPropagation(); if (dataCanOpenCalendar || dataCanOpenDtpPopover) { if (compactDataTimerRef.current) clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = setTimeout(() => { compactDataTimerRef.current = null; toggleField("dataOk", block.dataOk); }, 350); } else { toggleField("dataOk", block.dataOk); } } : undefined}
              onDoubleClick={(dataCanOpenCalendar || dataCanOpenDtpPopover) ? (e) => { e.stopPropagation(); if (compactDataTimerRef.current) { clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = null; } if (dataCanOpenCalendar) { onInlineDatePick(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } else if (dataCanOpenDtpPopover) { onDataChipDoubleClick?.(block.id, e.currentTarget.getBoundingClientRect()); } } : undefined}>
              {block.dataStatusId ? dataDisplayLabel : `D\u00a0${block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}`}
            </span>
            <MaterialNoteAffordance indicatorSize={4} indicatorTop={1} indicatorRight={1} block={block}>
              <span style={cs(mSK, FIELD_ACCENT.MATERIAL, !!block.materialRequiredDate && !block.materialInStock && !block.materialIssued)}
                onClick={block.materialRequiredDate && !block.materialInStock && !block.materialIssued ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactMatTimerRef.current) clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = setTimeout(() => { compactMatTimerRef.current = null; toggleField("materialOk", block.materialOk); }, 350); } else { toggleField("materialOk", block.materialOk); } } : undefined}
                onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactMatTimerRef.current) { clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = null; } onInlineDatePick(block.id, "material", block.materialRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                M&nbsp;{block.materialIssued ? "VYD." : block.materialInStock ? "SKLAD" : block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${mIcon}` : "—"}
              </span>
            </MaterialNoteAffordance>
            <span style={cs(eSK, FIELD_ACCENT.EXPEDICE, false)}>
              E&nbsp;{block.deadlineExpedice ? fmtDateShort(block.deadlineExpedice) : "—"}
            </span>
            {(block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk) && (
              <span style={cs(pSK, FIELD_ACCENT.PANTONE, !!block.pantoneRequiredDate)} title={pantoneDeadlineState === "earlyStart" ? "Start zakázky před dodáním pantonu" : undefined}
                onClick={block.pantoneRequiredDate ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactPanTimerRef.current) clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = setTimeout(() => { compactPanTimerRef.current = null; toggleField("pantoneOk", block.pantoneOk); }, 350); } else { toggleField("pantoneOk", block.pantoneOk); } } : undefined}
                onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactPanTimerRef.current) { clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = null; } onInlineDatePick(block.id, "pantone", block.pantoneRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                P&nbsp;{block.pantoneOk ? "OK" : block.pantoneRequiredDate ? `${fmtDateShort(block.pantoneRequiredDate)}${pIcon}` : "⚠"}
              </span>
            )}
          </div>
        );
      })()}

      {/* ── Řádek 3: Specifikace (celý text) ── */}
      {showSpec && block.specifikace && (
        <div style={{ padding: "0 9px 3px", flexShrink: 0, position: "relative", zIndex: 2 }}>
          <span style={{
            fontSize: 10, color: s.textSub, opacity: 0.82, lineHeight: 1.3,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}>
            {block.specifikace}
          </span>
        </div>
      )}


      {/* Hotovo tlačítko pro TISKAR (FULL mode) */}
      {isTiskar && onPrintComplete && block.type === "ZAKAZKA" && MODE_FULL && (
        <div style={{ padding: "2px 7px 5px", display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setPrintPending(true); onPrintComplete(block.id, !isPrintDone).finally(() => setPrintPending(false)); }}
            disabled={printPending}
            style={{
              padding: "3px 10px", borderRadius: 5, border: "none",
              cursor: printPending ? "not-allowed" : "pointer",
              fontSize: 11, fontWeight: 600, fontFamily: "inherit",
              transition: "all 0.12s ease-out",
              background: isPrintDone ? "rgba(100,116,139,0.25)" : "rgba(34,197,94,0.3)",
              color: isPrintDone ? "var(--text-muted)" : "#22c55e",
              opacity: printPending ? 0.5 : 1,
            }}
          >
            {printPending ? "…" : isPrintDone ? "Vrátit hotovo" : "Hotovo"}
          </button>
        </div>
      )}

      {/* SplitChip — jen pro TISKAR, MODE_FULL */}
      {MODE_FULL && splitPartner && clampedHeight >= 32 && (() => {
        const { state, time } = getSplitChipState(splitPartner);
        return (
          <SplitChip
            partnerMachine={splitPartner.machine}
            state={state}
            time={time}
            onClick={() => onSplitChipClick?.(splitPartner.id)}
          />
        );
      })()}

      {/* Výrobní štítky OBÁLKA/VNITŘKY — vpravo dole (FULL mode, je tam prostor).
          U TISKAŘE je spodní pruh obsazen tlačítkem Hotovo / SplitChipem → zvednout výš.
          Resize handle sedí v rohu (bottom:0 right:0, 20×20) — když je přítomný
          (blok není zamčený a nejsme v tiskařském režimu, kde je chip výš), odsuneme
          chip doleva o šířku handle (right:26), aby nezakrýval úchyt pro zkrácení/prodloužení. */}
      {MODE_FULL && (block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) && (
        <div style={{ position: "absolute", right: (!block.locked && !isTiskar) ? 26 : 6, bottom: isTiskar ? 32 : 4, display: "flex", gap: 5, zIndex: 4, pointerEvents: "none" }}>
          <ProductionChips obalka={block.obalka} vnitrky={block.vnitrky} tiskoveArchy={block.tiskoveArchy} serie={block.serie} />
        </div>
      )}

      {/* Resize handle — rohový iOS-style */}
      {!block.locked && (
        <div
          onMouseEnter={() => setResizeHovered(true)}
          onMouseLeave={() => setResizeHovered(false)}
          onMouseDown={(e) => { e.stopPropagation(); onResizeMouseDown?.(e); }}
          style={{
            position: "absolute", bottom: 0, right: 0,
            width: 20, height: 20,
            cursor: "ns-resize",
            display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
            padding: 4,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
            style={{ opacity: resizeHovered ? 1 : 0.28, transition: "opacity 0.15s ease-out", flexShrink: 0 }}
          >
            <line x1="2" y1="11" x2="11" y2="2" stroke={s.textPrimary} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="6" y1="11" x2="11" y2="6" stroke={s.textPrimary} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="10" y1="11" x2="11" y2="10" stroke={s.textPrimary} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}

      {/* ── Pauza (mimo provoz) uvnitř bloku — ztmavený „můstek" mezi print segmenty.
          Přerušované vodorovné okraje + červené šrafování odstávky (kreslí se NAD blokem,
          zIndex 2) dohromady vizuálně odliší od splitu (samostatné bloky s ✂ chipy).
          Levý accent bar bloku zůstává průběžný — drží identitu jedné zakázky. ── */}
      {pauseOverlays?.map((seg) => (
        <div key={seg.key} style={{
          position: "absolute", top: seg.top, height: seg.height, left: 0, right: 0,
          background: "rgba(10,15,28,0.55)",
          borderTop: "2px dashed rgba(148,163,184,0.7)",
          borderBottom: "2px dashed rgba(148,163,184,0.7)",
          pointerEvents: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {seg.height >= 40 && (
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: "rgba(203,213,225,0.85)", background: "rgba(2,6,23,0.6)", padding: "1px 8px", borderRadius: 6 }}>
              ⏸ PAUZA — mimo provoz
            </span>
          )}
        </div>
      ))}

      {/* ── Poznámka MTZ — inline editační popover. Portál do document.body (stejně
          jako hover tooltip níž): popover je position:fixed se zIndex 400, ale bez
          portálu zůstává uvězněný ve stacking contextu karty bloku (ta má
          position:absolute + zIndex), takže ho sousední <aside> panel (BlockDetail,
          zIndex 10) v layoutu překreslí a poznámka MTZ není celá vidět. Portál uvolní
          zIndex na úroveň body → popover se kreslí NAD panelem a je celý viditelný.
          Pozice se nemění: fixed + viewport souřadnice (clientX/Y), body je bez transform. ── */}
      {noteOpen && noteRect && typeof document !== "undefined" && createPortal(
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: noteRect.bottom + 6,
            left: Math.min(noteRect.left, window.innerWidth - 236),
            background: "#1c1c1e",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 12,
            padding: 12,
            width: 220,
            zIndex: Z_OVERLAY.notePopover,
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.45)", letterSpacing: 0.3 }}>
            POZNÁMKA MATERIÁL
          </p>
          <textarea
            ref={noteTextareaRef}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNote(); if (e.key === "Escape") setNoteOpen(false); }}
            rows={3}
            placeholder="Materiál skladem od…"
            style={{
              width: "100%", boxSizing: "border-box",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 8, padding: "7px 9px",
              fontSize: 13, lineHeight: 1.5,
              color: "rgba(255,255,255,0.9)",
              resize: "vertical",
              fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
            <button
              onClick={() => setNoteOpen(false)}
              style={{
                padding: "5px 12px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.14)",
                background: "transparent", color: "rgba(255,255,255,0.6)",
                fontSize: 12, fontWeight: 500, cursor: "pointer",
              }}
            >
              Zrušit
            </button>
            <button
              onClick={saveNote}
              disabled={noteSaving}
              style={{
                padding: "5px 12px", borderRadius: 7, border: "none",
                background: "#3b82f6", color: "#fff",
                fontSize: 12, fontWeight: 600, cursor: noteSaving ? "wait" : "pointer",
                opacity: noteSaving ? 0.7 : 1,
              }}
            >
              {noteSaving ? "Ukládám…" : "Uložit"}
            </button>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Indikátor specifikace — svislý proužek vpravo ── */}
      {block.specifikace && block.specifikace.length > 0 && !showSpec && (
        <div
          title="Obsahuje specifikaci"
          style={{
            position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)",
            width: 3, height: "55%", minHeight: 8, maxHeight: 22,
            borderRadius: 2, background: "rgba(251,191,36,0.8)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* ── Hover tooltip iOS-style pro malé bloky (< 60px) — portálovaný mimo stacking context ── */}
      {showTooltip && hovered && (() => {
        const rect = blockCardRef.current?.getBoundingClientRect();
        if (!rect || typeof document === "undefined") return null;
        const tooltipW = 240;
        const margin = 10;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Prefer right of block, fall back to left if not enough space
        const spaceRight = vw - rect.right - margin;
        const showRight = spaceRight >= tooltipW;
        const rawLeft = showRight ? rect.right + margin : rect.left - margin - tooltipW;
        // Clamp to viewport so tooltip never goes off-screen
        const left = Math.max(margin, Math.min(rawLeft, vw - tooltipW - margin));
        const top = Math.max(8, Math.min(rect.top, vh - 220));
        // Format time
        const startD = new Date(block.startTime);
        const endD   = new Date(block.endTime);
        const fmtTime = (d: Date) => d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
        const fmtDay  = (d: Date) => d.toLocaleDateString("cs-CZ", { day: "numeric", month: "short", timeZone: "Europe/Prague" });
        const sameDay = fmtDay(startD) === fmtDay(endD);
        const timeLabel = sameDay
          ? `${fmtDay(startD)}, ${fmtTime(startD)}–${fmtTime(endD)}`
          : `${fmtDay(startD)} ${fmtTime(startD)} – ${fmtDay(endD)} ${fmtTime(endD)}`;
        const machineLabel = block.machine === "XL_105" ? "XL 105" : "XL 106";
        const hasDateInfo = block.dataRequiredDate || block.materialRequiredDate || block.deadlineExpedice;
        // Řádek délky: ZAKAZKA s tiskovými minutami odlišnými od uplynulého času bloku
        // (pauza přes odstávku/mimo provoz uvnitř bloku) zobrazí tisk i celek zvlášť.
        const fmtHoursTip = (mins: number) => {
          const h = mins / 60;
          return h % 1 === 0 ? `${h} h` : `${h.toFixed(1)} h`;
        };
        const elapsedMinsTip = Math.round((endD.getTime() - startD.getTime()) / 60000);
        const pmTip = block.type === "ZAKAZKA" ? blockPrintMinutes(block) : null;
        const durationLabel = (pmTip != null && pmTip !== elapsedMinsTip)
          ? `Tisk: ${fmtHoursTip(pmTip)} · Celkem: ${fmtHoursTip(elapsedMinsTip)}`
          : `Délka: ${fmtHoursTip(elapsedMinsTip)}`;
        return createPortal(
          <div style={{
            position: "fixed",
            left,
            top,
            width: tooltipW,
            zIndex: Z_OVERLAY.floating,
            background: "rgba(28,28,30,0.88)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 14,
            padding: "12px 14px",
            pointerEvents: "none",
            boxShadow: "0 16px 48px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.25)",
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          }}>
            {/* Číslo zakázky + stroj */}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: block.description || block.specifikace ? 3 : 6 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.01em" }}>
                {block.orderNumber}
              </span>
              <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0, marginLeft: 8 }}>
                {machineLabel}
              </span>
            </div>
            {/* Popis */}
            {block.description && (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.4, marginBottom: block.specifikace ? 3 : 6 }}>
                {block.description}
              </div>
            )}
            {/* Specifikace */}
            {block.specifikace && (
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.42)", fontStyle: "italic", lineHeight: 1.35, marginBottom: 6 }}>
                {block.specifikace}
              </div>
            )}
            {/* Čas */}
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.4 }}>
              {timeLabel}
            </div>
            {/* Délka — tisk vs. celkový čas na ose, když se liší (blok obsahuje pauzu) */}
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.4 }}>
              {durationLabel}
            </div>
            {/* Σ tiskový čas celé split skupiny (bod 18 auditu) */}
            {(splitTotal ?? 0) > 1 && (splitTotalMinutes ?? 0) > 0 && (
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.4 }}>
                {`Skupina: Σ ${fmtHoursTip(splitTotalMinutes!)} (${splitTotal} částí)`}
              </div>
            )}
            {/* Termíny */}
            {hasDateInfo && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: 4 }}>
                {block.dataRequiredDate && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10 }}>
                    <span style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.03em" }}>DATA</span>
                    <span style={{ color: block.dataOk ? "#30d158" : "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums" }}>
                      {fmtDate(block.dataRequiredDate)}{block.dataOk ? " ✓" : ""}
                    </span>
                  </div>
                )}
                {block.materialRequiredDate && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10 }}>
                    <span style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.03em" }}>MATERIÁL</span>
                    <span style={{ color: block.materialOk ? "#30d158" : "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums" }}>
                      {fmtDate(block.materialRequiredDate)}{block.materialOk ? " ✓" : ""}
                    </span>
                  </div>
                )}
                {block.deadlineExpedice && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10 }}>
                    <span style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.03em" }}>EXPEDICE</span>
                    <span style={{ color: "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums" }}>
                      {fmtDate(block.deadlineExpedice)}
                    </span>
                  </div>
                )}
              </div>
            )}
            {/* Tiskařské poznámky — sekce v hoveru */}
            {tiskarNotes.length > 0 && (
              <div style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: "1px solid rgba(255,255,255,0.08)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "#f59e0b",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: 2,
                }}>
                  <span>📝 Poznámky tiskař</span>
                  <span style={{
                    background: "#f59e0b",
                    color: "#1f2937",
                    padding: "1px 5px",
                    borderRadius: 8,
                    fontSize: 9,
                    fontWeight: 700,
                  }}>{tiskarNotes.length}</span>
                </div>
                {tiskarNotes.slice(0, 3).map((n) => (
                  <div key={n.id} style={{ borderLeft: "2px solid #f59e0b", paddingLeft: 8 }}>
                    <div style={{
                      fontSize: 11,
                      color: "rgba(255,255,255,0.85)",
                      lineHeight: 1.45,
                      whiteSpace: "pre-wrap",
                    }}>{n.text}</div>
                    <div style={{
                      fontSize: 9,
                      color: "rgba(255,255,255,0.32)",
                      marginTop: 2,
                      letterSpacing: "0.02em",
                    }}>
                      {n.createdByUsername} · {new Date(n.createdAt).toLocaleString("cs-CZ", {
                        day: "numeric", month: "numeric",
                        hour: "2-digit", minute: "2-digit",
                        timeZone: "Europe/Prague",
                      })}
                      {n.updatedAt !== n.createdAt && " · upraveno"}
                    </div>
                  </div>
                ))}
                {tiskarNotes.length > 3 && (
                  <div style={{
                    fontSize: 10,
                    color: "#f59e0b",
                    textAlign: "center",
                    fontStyle: "italic",
                    marginTop: 4,
                  }}>
                    + {tiskarNotes.length - 3} dalších
                  </div>
                )}
              </div>
            )}
          </div>,
          document.body
        );
      })()}
    </div>
  );

  if (!showMenu) return blockDiv;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        onContextMenu={(e: React.MouseEvent) => {
          splitAtRef.current  = getSplitAt?.(e.clientY) ?? null;
          ctxMouseRef.current = { x: e.clientX, y: e.clientY };
        }}
      >
        {blockDiv}
      </ContextMenuTrigger>
      <ContextMenuContent
        style={{ background: "#1c1c1e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "4px", minWidth: 180, zIndex: Z_OVERLAY.contextMenu }}
        onClick={(e) => e.stopPropagation()}
      >
        {canEdit && !block.locked && block.type === "ZAKAZKA" && (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger style={menuItemStyle}>
                Stav zakázky
              </ContextMenuSubTrigger>
              <ContextMenuSubContent style={{ background: "#1c1c1e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: 4, minWidth: 160 }}>
                {BLOCK_VARIANTS.map((v) => (
                  <ContextMenuItem key={v} onClick={() => onBlockVariantChange?.(block.id, v)} style={menuItemStyle}>
                    {block.blockVariant === v ? "✓ " : "\u00a0\u00a0"}{VARIANT_CONFIG[v].label}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
          </>
        )}
        {canEdit && !block.locked && (
          <>
            <ContextMenuItem
              onClick={() => onBlockCopy?.()}
              style={menuItemStyle}
            >
              ⎘ Kopírovat
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => { if (splitAtRef.current) onBlockSplit?.(splitAtRef.current); }}
              style={menuItemStyle}
            >
              ✂ Rozdělit blok
            </ContextMenuItem>
          </>
        )}
        {canEdit && !block.locked && (canEditMat || hasNote) && <ContextMenuSeparator />}
        {canEditMat && (
          <ContextMenuItem
            onClick={() => {
              const pos = ctxMouseRef.current;
              openNoteEditor(pos ? { bottom: pos.y + 4, left: pos.x } : null);
            }}
            style={menuItemStyle}
          >
            {hasNote ? "Upravit poznámku MTZ" : "Přidat poznámku MTZ"}
          </ContextMenuItem>
        )}
        {hasNote && canEditMat && (
          <ContextMenuItem
            onClick={clearNote}
            style={{ ...menuItemStyle, color: "rgba(255,80,80,0.9)" }}
          >
            Smazat poznámku MTZ
          </ContextMenuItem>
        )}
        {!canEditMat && hasNote && (
          <ContextMenuItem disabled style={{ ...menuItemStyle, color: "rgba(255,255,255,0.4)" }}>
            📌 Poznámka MTZ existuje
          </ContextMenuItem>
        )}
        {onPrintComplete && block.type === "ZAKAZKA" && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => onPrintComplete(block.id, !isPrintDone)}
              style={isPrintDone ? { ...menuItemStyle, color: "rgba(255,120,80,0.9)" } : menuItemStyle}
            >
              {isPrintDone ? "↩ Vrátit hotovo" : "✓ Označit jako hotovo"}
            </ContextMenuItem>
          </>
        )}
        {onOpenNotes && block.type === "ZAKAZKA" && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => onOpenNotes(block)}
              style={{ ...menuItemStyle, color: "#fbbf24" }}
            >
              📝 Poznámka tiskaře{hasTiskarNotes ? ` (${tiskarNotes.length})` : ""}
            </ContextMenuItem>
          </>
        )}
        {canEdit && block.type === "ZAKAZKA" && onNotify && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => onNotify(block.id, block.orderNumber)}
              style={menuItemStyle}
            >
              📣 Upozornit MTZ + DTP
            </ContextMenuItem>
          </>
        )}
        {/* Expedice akce — jen pro ZAKAZKA blok, jen pro editory */}
        {canEdit && block.type === "ZAKAZKA" && (
          <>
            <ContextMenuSeparator />
            {!block.deadlineExpedice ? (
              <ContextMenuItem disabled style={{ ...menuItemStyle, color: "rgba(255,255,255,0.3)" }}>
                🚚 Nejdřív vyplň termín expedice
              </ContextMenuItem>
            ) : block.expeditionPublishedAt ? (
              <ContextMenuItem
                onClick={() => onExpeditionUnpublish?.(block.id)}
                style={{ ...menuItemStyle, color: "rgba(239,68,68,0.9)" }}
              >
                🚚 Odebrat z Expedice
              </ContextMenuItem>
            ) : (
              <ContextMenuItem
                onClick={() => onExpeditionPublish?.(block.id)}
                style={menuItemStyle}
              >
                🚚 Zaplánovat do Expedice
              </ContextMenuItem>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
