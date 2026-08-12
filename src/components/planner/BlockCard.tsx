"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { blockPrintMinutes, formatPrintHoursShort, type CalendarDriftInfo } from "@/lib/printTimeClient";
import { isParkedDrift } from "@/lib/calendarDriftUi";
import { Z_OVERLAY, Z_TIMELINE } from "@/lib/zLayers";
import { BLOCK_STYLES, BLOCK_OVERDUE, BLOCK_PRINT_DONE, getBlockStyleKey, tint } from "@/lib/blockStyles";
import {
  civilDateToUTCMidnight,
  formatPragueDateShort,
  formatPragueDateTime,
  normalizeCivilDateInput,
} from "@/lib/dateUtils";
import { deadlineState, isPastExpeditionDeadline } from "@/lib/deadlineState";
import { badgeColorVar } from "@/lib/badgeColors";
import { formatProductionTypeChip, PRODUCTION_CHIP_COLORS } from "@/lib/productionTags";
import { BLOCK_VARIANTS, VARIANT_CONFIG, type BlockVariant } from "@/lib/blockVariants";
import { Lock, Clock, Hourglass } from "lucide-react";
import { SplitChip } from "@/components/SplitChip";
import { SpecBand, SpecChip } from "@/components/planner/SpecBand";
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
import { PrintDoneButton } from "@/components/planner/PrintDoneButton";
import { printDoneSize, isBlockRunningNow, splitChipFits, splitChipFitsInHeaderRow, specBandFits, descLineClampFor } from "@/lib/tiskarBlockView";
import { BlockDateChip, DEADLINE_BG, DEADLINE_BORDER, type DateChipState } from "@/components/planner/BlockDateChip";
import { DEFAULT_FONT_SCALE, plannerTypeScale, type PlannerTypeScale } from "@/lib/plannerTypography";

// Modulová konstanta, ne volání v default parametru — `plannerTypeScale(...)` by se
// jinak přepočítávalo při KAŽDÉM renderu karty (stejný vzor jako `tiskarBlockView.ts:10`).
const DEFAULT_TS = plannerTypeScale(DEFAULT_FONT_SCALE);

// ─── Stropy fontSize ve sdíleném jednořádkovém layoutu (MODE_TINY/MODE_MICRO_TEXT) ──
// `typeScale.*` roste se stupněm písma, ale `thresholds.micro` (spodní hranice tohoto
// layoutu) je 14 px pro VŠECHNY stupně — bez stropu by obsah, který v tomhle řádku má
// vlastní pevné odsazení/rámeček (chip D/M/E/P, SpecChip „S", MiniChip), na nejnižší
// kartě přerostl `layoutHeight`. Číslo a popis nemají žádné vlastní box-model navíc
// (jen text), proto mají vlastní, méně přísný faktor. POZOR: stropy počítají proti
// `layoutHeight`, ne proti `maxRenderHeight` (tím se div dál zkracuje, když na blok
// navazuje další na stejném stroji) — u řetězících se bloků bez mezery tedy garance
// nemusí platit, je to jen ochrana proti přerůstání VLASTNÍ výšky bloku.
//
// Chip/SpecChip/MiniChip: box = fontSize·lineHeight(1) + padding(2×1px) + border(2×1px)
// = fontSize + 4. Aby se vlezl i na nejnižší kartu (layoutHeight = 14 px), musí platit
// `fontSize + 4 ≤ layoutHeight`, tj. `fontSize ≤ layoutHeight · (1 − 4/layoutHeight)`;
// při layoutHeight = 14 to dá F ≤ 0,714. Voleno 0,65 pro rezervu.
const MICRO_CHIP_CAP_FACTOR = 0.65;
// Číslo/popis: čistý text bez vlastního box-modelu — 0,7 dává na M/14px 9,8px (dnešek
// 10, beze změny) a na XL/29px plnou velikost 16,3px (viz task-6-report.md).
const MICRO_TEXT_CAP_FACTOR = 0.7;

// Spodní podlaha pro `layoutHeight` (px) — pod ní se nevykreslí vůbec nic (ani tlačítko
// Hotovo, ani číslo zakázky), viz `thresholds.micro`. Platila dřív jen pro `height`
// (fyzická výška karty); `contentHeight` (výška prvního print segmentu u bloku přes
// odstávku) stejnou podlahu neměl a mohl klesnout na jednotky px (jeden slot 30 min
// při nízkém zoomu) — task 5c, rozhodnutí majitele 12. 8. 2026. POZOR: řídí jen
// rozhodování o layout modu a vnitřní content box (`contentBoxFlex`), NIKDY fyzickou
// geometrii divu (ta jde z `clampedHeight`/`maxRenderHeight`, viz komentář u `layoutHeight`).
const MIN_CARD_CONTENT_HEIGHT_PX = 20;

// ─── Ikony vedle čísla zakázky ───────────────────────────────────────────────
// Lock/Hourglass/zelená fajfka a Clock (upozornění po termínu) byly napevno 9, resp.
// 11 px — na M (`DEFAULT_TS.num` 13,5 px) to je poměr ~67 %, resp. ~81 % k číslu, ale
// na XL (17,7 px) by se stejná pevná velikost smrskla na ~51 %, resp. ~62 % a ikony by
// vedle vyrostlého čísla vypadaly zakrsle. Poměr je odvozený z DNEŠNÍCH hodnot na M,
// aby se na M nic vizuálně nezměnilo a na L/XL rostl se stupněm stejně jako číslo.
const NUM_ICON_RATIO_MINOR = 9 / DEFAULT_TS.num;
const NUM_ICON_RATIO_CLOCK = 11 / DEFAULT_TS.num;

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

const FIELD_ACCENT = {
  DATA:     "color-mix(in oklab, #0ea5e9 78%, var(--text) 22%)",  // tyrkysová — data
  MATERIAL: "color-mix(in oklab, #22c55e 78%, var(--text) 22%)",  // zelená — materiál
  EXPEDICE: "color-mix(in oklab, #f97316 78%, var(--text) 22%)",  // oranžová — expedice
  PANTONE:  "color-mix(in oklab, #a855f7 78%, var(--text) 22%)",  // fialová — pantone
};

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

function MiniChip({ label, accent, textColor, fontSize }: { label: string; accent: string; textColor?: string; fontSize: number }) {
  const tc = textColor ?? accent;
  return (
    <span style={{
      // lineHeight 1 (ne 1,5) — chip v řádku s pevnou výškou nepotřebuje řádkovací
      // rezervu; s 1,5 by si vynucoval nižší strop v MODE_TINY/MODE_MICRO_TEXT, než
      // dovoluje skutečná geometrie (viz MICRO_CHIP_CAP_FACTOR výš).
      fontSize, fontWeight: 700, color: tc, lineHeight: 1,
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
function ProductionChips({ obalka, vnitrky, tiskoveArchy, serie, abbreviated, fontSize }: {
  obalka?: boolean; vnitrky?: boolean; tiskoveArchy?: string | null; serie?: string | null; abbreviated?: boolean; fontSize: number;
}) {
  const typeChip = formatProductionTypeChip(tiskoveArchy, serie);
  if (!obalka && !vnitrky && !typeChip) return null;
  // clamp = na krátkých blocích (abbreviated) dlouhý TA·série chip zkrátit ellipsis,
  // aby nikdy nevytlačil číslo zakázky (nejdůležitější info na bloku).
  // maxWidth odvozený z fontSize (16.5× — při 8 px dá dnešních 132), ať roste
  // se stupněm písma stejně jako zbytek chipu.
  const pill = (bg: string, fg: string, text: string, clamp?: boolean) => (
    <span style={{ fontSize, fontWeight: 900, letterSpacing: "0.04em", padding: "2px 6px", borderRadius: 5, background: bg, color: fg, lineHeight: 1, whiteSpace: "nowrap", flexShrink: clamp ? 1 : 0, ...(clamp ? { maxWidth: fontSize * 16.5, overflow: "hidden", textOverflow: "ellipsis" } : {}) }}>{text}</span>
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
  onClick, onDoubleClick, onMouseDown, onResizeMouseDown, groupUnconfirmedReservation = false, onBlockUpdate, onError,
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
  typeScale = DEFAULT_TS,
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
  /** Stupeň písma. Nepovinný — bez něj se karta vykreslí ve výchozím stupni M
   * (jediný konzument je `TimelineGrid`, ale karta musí jít vykreslit i bez něj). */
  typeScale?: PlannerTypeScale;
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
  /** Některý člen split skupiny nese nepotvrzenou rezervaci (ocas nedědí `reservationId`). */
  groupUnconfirmedReservation?: boolean;
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
  // Zelené zvýraznění bloku, jehož tisk právě běží — jen u tiskaře, jen zakázky.
  // `now` tiká z TimelineGrid po 60 s, žádný vlastní časovač tu nevzniká.
  const isRunningNow = isTiskar === true
    && block.type === "ZAKAZKA"
    && isBlockRunningNow(block.startTime, block.endTime, now, isPrintDone);
  const isPozastaveno = block.type === "ZAKAZKA" && block.blockVariant === "POZASTAVENO";
  // Vazba na rezervaci (`reservationId`) sedí jen na jednom bloku skupiny — split
  // ocas ji nedědí. Bez `groupUnconfirmedReservation` by tak přišel o hodiny
  // i fialový rámeček a vypadal jako potvrzený (viz hasUnconfirmedReservation).
  const isUnconfirmedReservation = block.type === "REZERVACE"
    && ((block.reservationId != null && !block.reservationConfirmedAt) || groupUnconfirmedReservation);
  const isOverdue     = block.type === "ZAKAZKA" && new Date(block.endTime) < now && !isPrintDone && !isPozastaveno;
  // Deadline štítek — nezávislé na isOverdue (to je „konec bloku je v minulosti").
  // Termín expedice je okamžik 14:00 pražského času, ne celý den (viz deadlineState.ts);
  // běží nezávisle na `now`, takže hlásí i bloky naplánované do budoucna.
  const isPastDeadline = block.type === "ZAKAZKA"
    && isPastExpeditionDeadline(block.endTime, block.deadlineExpedice);
  // Odložení mimo pracovní dobu (vědomé i zbytkové) vs. skutečný drift kalendáře —
  // jeden štítek, dvě různá sdělení. Rozlišení je sdílené s detailem bloku a s pruhem
  // nad strojem (`calendarDriftUi.ts`), ať se ta tři místa nerozejdou.
  const isParked = !!calendarDrift && isParkedDrift(calendarDrift.reason);
  const clampedHeight = Math.max(height, MIN_CARD_CONTENT_HEIGHT_PX);
  // `contentHeight` dostává STEJNOU podlahu jako `height` výš — bez ní se pojistka proti
  // nevykreslení obejde přes bloky s pauzou (viz MIN_CARD_CONTENT_HEIGHT_PX výš).
  const clampedContentHeight = contentHeight != null ? Math.max(contentHeight, MIN_CARD_CONTENT_HEIGHT_PX) : undefined;
  // Layout mody se řídí výškou prvního print segmentu (obsah se má vejít do tiskové části,
  // ne propadnout do pauzy) — pro bloky bez segmentů (99 % plánu) je to prostě clampedHeight.
  const layoutHeight  = clampedContentHeight ?? clampedHeight;

  // Obsah úzkých layoutů (COMPACT / TINY / MICRO) je svisle vycentrovaný. U bloku
  // s pauzou by ho `flex: 1` roztáhl přes CELOU kartu a vycentroval do jejího středu
  // — tedy doprostřed šrafované pauzy. Reálný případ z produkčních dat: zakázka
  // 13. 8. 21:00 → 14. 8. 10:00 (5 h tisku ve 13 h) měla název ve 3:30 v noci.
  // `contentHeight` (výška PRVNÍHO tiskového úseku) se do té chvíle používala jen
  // na volbu layoutu, ne na jeho umístění — záměr „obsah nesmí propadnout do pauzy"
  // tak byl provedený z půlky. Bloky bez pauzy (99 % plánu) se chovají beze změny.
  const contentBoxFlex: React.CSSProperties = clampedContentHeight != null
    ? { height: clampedContentHeight, flexGrow: 0, flexShrink: 0 }
    : { flex: 1 };

  // Velikost tlačítka Hotovo (jen tiskařský režim) — pravidla v tiskarBlockView.ts
  const printDone = printDoneSize(layoutHeight, typeScale);
  const togglePrintDone = () => {
    if (!onPrintComplete) return;
    setPrintPending(true);
    onPrintComplete(block.id, !isPrintDone).finally(() => setPrintPending(false));
  };
  // Čtvercová varianta tlačítka Hotovo — sdílená pro MODE_COMPACT i MODE_TINY/MICRO
  const squareDoneButton = isTiskar && onPrintComplete && block.type === "ZAKAZKA" && printDone?.variant === "square" ? (
    <PrintDoneButton
      size={printDone}
      isDone={isPrintDone}
      completedAt={block.printCompletedAt}
      pending={printPending}
      onToggle={togglePrintDone}
    />
  ) : null;

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
  // pantoneInStock i pantoneIssued potlačují warning logiku pantonu — zrcadlo
  // materialHandled výš. Bez toho by pantone, který máme na skladě, dál svítil
  // červeně „po termínu".
  const pantoneHandled = block.pantoneInStock || block.pantoneIssued;
  const pantoneEffectiveState = pantoneHandled ? "ok" : pantoneDeadlineState;
  // Viditelnost čipu. Server sice při zapnutí SKLADEM/VYDÁNO nastaví i
  // pantoneRequired, ale příznaky sem patří jako pojistka proti neviditelnému
  // stavu zapsanému jinou cestou (import, ruční SQL, budoucí endpoint).
  const pantoneVisible = block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk || pantoneHandled;
  // Stavový klíč do DEADLINE_BG/DEADLINE_BORDER. Pořadí kopíruje materiál:
  // vydáno (modrá) > skladem (zelená) > prázdné > OK > bez termínu > deadline.
  const pantoneStateKey = block.pantoneIssued ? "issued"
    : block.pantoneInStock ? "ok"
    : !pantoneVisible ? "empty"
    : block.pantoneOk ? "ok"
    : !block.pantoneRequiredDate ? "warning"
    : pantoneDeadlineState === "none" ? "neutral" : pantoneDeadlineState;
  /** Text čipu. `icon` je „ ✓" / „ ✕" / „ !" / „ ⚠" podle deadline stavu, viz volající. */
  const pantoneChipText = (icon: string) =>
    block.pantoneIssued ? "VYD."
    : block.pantoneInStock ? "SKLAD"
    : block.pantoneOk ? "OK"
    : block.pantoneRequiredDate ? `${fmtDateShort(block.pantoneRequiredDate)}${icon}`
    : "⚠";

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
  const MODE_FULL    = layoutHeight >= typeScale.thresholds.full;        // plný layout (od ~1h při zoom=26)
  const MODE_COMPACT = !MODE_FULL && layoutHeight >= typeScale.thresholds.compact && block.type !== "UDRZBA";
  const MODE_TINY    = !MODE_FULL && !MODE_COMPACT && layoutHeight >= typeScale.thresholds.tiny; // micro tečky
  const MODE_MICRO_TEXT = !MODE_FULL && !MODE_COMPACT && !MODE_TINY && layoutHeight >= typeScale.thresholds.micro; // sdílí TINY řádek (D/M/E chipy + číslo + popis)
  // Výškové prahy pro FULL mode
  // Jeden jednořádkový chip pro celý plný layout. Do 8/2026 tu byly DVĚ podoby —
  // dvouřádkový popiskový badge od 60 px a kompaktní chip pod ním. Sloučeno: chip
  // nese stejnou informaci, vejde se do menší výšky a zbylé místo platí větší písmo.
  const showDates = !isTiskar && MODE_FULL && block.type !== "UDRZBA";
  // Pás specifikace (SpecBand). Práh v M zůstal historicky na `MODE_FULL` (≥46 px na M
  // při výchozím přiblížení) — dřív, na nezvětšeném písmu, plánovač spec na hodinové
  // zakázce neviděl vůbec. V tiskařském režimu má `showSpec` VLASTNÍ, přísnější práh
  // `typeScale.tiskarSpecMin` (obecně `typeScale.*`, dřív jen na M rovno 80 px): karta má
  // overflow:hidden a pás vykreslený před tlačítkem Hotovo by ho na nízké kartě vytlačil
  // pod ořez (regrese 3. 8. 2026) — tlačítko má přednost. Tiskaři pod `tiskarSpecMin`
  // zbývá svislý proužek, resp. značka „S" v jednořádkových režimech.
  const showSpec     = isTiskar ? layoutHeight >= typeScale.tiskarSpecMin : MODE_FULL;
  const specTwoLine  = layoutHeight >= typeScale.specTwoLine;   // pod tímto prahem se vejde jen jeden řádek s elipsou
  // Pás se smí vykreslit JEN celý — karta je flex column s overflow:hidden a SpecBand je
  // poslední v pořadí, takže cokoliv, na co nezbude místo, se ořízne odspodu (na XL by
  // z pásu zbyla jen vodorovná čárka). `specFitsBand` proto vyžaduje, aby po řádku
  // čísla+popisu a řádku datumů zbyla aspoň skutečná výška pásu — `rowHeights.spec2`,
  // když je pás dvouřádkový (`specTwoLine`), jinak `rowHeights.spec1`. Platí JEN pro
  // neplánovačskou (ne-tiskařskou) větev — tiskařská má vlastní, přísnější `tiskarSpecMin`
  // a nesmí se tímhle měnit (viz komentář výš, regrese 3. 8. 2026).
  //
  // POZOR — záruka „pás se nikdy nevykreslí uříznutý" platí jen pro jednořádkový popis
  // (`descLineClamp === 1`). Víceřádkový popis na vysoké kartě zvedne první řádek nad
  // `rowHeights.header`, což `specFitsBand` nepočítá — u téhle kombinace se pás výjimečně
  // oříznout MŮŽE (nález review, 8/2026). Dopočítat i tenhle případ by znamenalo přepsat
  // výpočet výšky prvního řádku, proto zůstává jako známá výjimka, ne oprava.
  const specFitsBand = layoutHeight >= typeScale.thresholds.full + (specTwoLine ? typeScale.rowHeights.spec2 : typeScale.rowHeights.spec1);
  // U tiskaře platí VLASTNÍ, přísnější kontrola (`specBandFits`, `tiskarBlockView.ts`):
  // pás nesmí vytlačit tlačítko Hotovo pod ořez (havárie 3. 8. 2026, tlačítko má
  // přednost před vším ostatním obsahem karty). Do task 5b (12. 8. 2026) tahle větev
  // kontrolu vejití ZÁMĚRNĚ obcházela (`isTiskar || specFitsBand`) — u ZAKÁZKY s
  // vyplněnou specifikací proto uměl být pruh „Hotovo" oříznutý (task-5b-brief.md, část B).
  const hasSpecBand  = showSpec && !!block.specifikace
    && (isTiskar ? specBandFits(layoutHeight, printDone, specTwoLine ? 2 : 1, typeScale) : specFitsBand);
  const specRows: 0 | 1 | 2 = hasSpecBand ? (specTwoLine ? 2 : 1) : 0;
  // SplitChip pro TISKAŘE, když se na spodní umístění (pod pásem specifikace/
  // tlačítkem Hotovo) nevejde — Task 6, fix „mizející pilulka" po zvětšení
  // SplitChipu s písmem. Řádek 1 nese jen neklikatelnou textovou značku
  // „✂1/2"; v tomhle pásmu ji nahradí klikatelná pilulka, pokud se tam prokazatelně
  // vejde (`splitChipFitsInHeaderRow`), jinak zůstává text — tlačítko Hotovo má
  // vždy přednost. Mimo tohle pásmo (spodní pilulka se vejde, nebo není co nahrazovat)
  // se nic nemění.
  const showSplitChipInHeader = MODE_FULL && !!splitPartner
    && !splitChipFits(layoutHeight, printDone, specRows, typeScale)
    && splitChipFitsInHeaderRow(layoutHeight, printDone, specRows, typeScale);
  // Značka „S" místo pásu — v jednořádkových režimech VŽDY (tam pás nemá kam jít), a nově
  // i v MODE_FULL, když `hasSpecBand` vyšlo false (nevejde se celý pás) — buď se ukáže
  // celý pás, nebo jen značka s textem v tooltipu, nikdy uříznutý zbytek pásu.
  const hasSpecChip  = !hasSpecBand && !!block.specifikace && (MODE_FULL || MODE_COMPACT || MODE_TINY || MODE_MICRO_TEXT);
  // Popis za číslem zakázky. Zobrazujeme v celém FULL módu (≥thresholds.full), ne až
  // od vyššího prahu — jinak bloky těsně nad thresholds.full (typicky 2–2,5h při
  // odzoomu) neukazovaly popis, zatímco menší COMPACT/TINY bloky ho ukazují. Číslo
  // zakázky výšku řádku určuje, takže 1řádkový popis v tomto pásmu nestojí žádný
  // prostor navíc. `layoutHeight >= typeScale.thresholds.full` je redundantní s
  // MODE_FULL (implikace platí vždy), ponecháno kvůli čitelnosti podmínky.
  const showDesc   = MODE_FULL && layoutHeight >= typeScale.thresholds.full;
  // Počet řádků popisu (`descLineClampFor`, `tiskarBlockView.ts` — jediné
  // místo, které vzorec počítá, ať jde pokrýt testem). U TISKAŘE s pásem
  // specifikace na kartě (`hasSpecBand`, spočítané VÝŠ, ať je závislost přímá,
  // ne oklikou) a jen pro `ZAKAZKA` (tlačítko Hotovo se kreslí jen pro ni)
  // ustupuje popis na 1 řádek bez ohledu na výšku karty — rozhodnutí majitele
  // (task 5d, 12. 8. 2026): tiskař potřebuje specifikaci a tlačítko Hotovo víc
  // než dlouhý popis. Ten zůstává dostupný v `title` (hover) a plný na
  // Monitoru u stroje (dvouřádkový, 24 px) — na dotykovém kiosku hover
  // nenastane, Monitor je tam skutečná záchrana, ne tooltip.
  const descLineClamp = descLineClampFor(layoutHeight, typeScale, { isTiskar, hasSpecBand, blockType: block.type });

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
          : isRunningNow
          ? `${shadow}, 0 0 0 2px var(--success)`
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
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: isRunningNow ? 5 : 3, background: isRunningNow ? "var(--success)" : s.accentBar, opacity: isOverdue ? 0.4 : 1, borderRadius: "7px 0 0 7px", flexShrink: 0 }} />
      )}

      {/* Modrý selection overlay */}
      {multiSelected && <div style={{ position: "absolute", inset: 0, borderRadius: 6, background: "rgba(255,230,0,0.12)", pointerEvents: "none", zIndex: 1 }} />}

      {/* Deadline štítek — pravý horní roh (FULL/COMPACT plný text, TINY jen ⚠).
          Fixní pozice top:4/right:4 — když je zároveň přítomný 📝 badge tiskařských
          poznámek (stejný roh), ten se odsune níž (viz jeho `top` níž), aby nekolidovaly.
          zIndex 4 — nad content (2–3), pod drag/resize stavy (5–20) i paste marker (25).
          Pod MODE_TINY (layoutHeight < typeScale.thresholds.tiny, „micro tečky") se nezobrazuje vůbec —
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
            fontSize: typeScale.badge,
            fontWeight: 800,
            lineHeight: 1,
            borderRadius: 4,
            padding: "1px 5px",
            zIndex: 4,
            userSelect: "none",
            // POZOR: `pointerEvents: "none"` tu být NESMÍ — vypnutý hit-test znamená,
            // že prvek nikdy nedostane hover, a tím pádem se NIKDY neukáže nativní
            // bublina z `title` výš. Štítek pak jen svítí a nevysvětlí proč.
            // Tažení bloku to nerozbije: kořenový `onMouseDown` karty necheckuje
            // `e.target` a gridové handlery se řídí `closest("[data-block]")`, což
            // ze štítku uvnitř karty najde blok stejně jako z karty samotné.
            whiteSpace: "nowrap",
          }}
        >
          {MODE_TINY ? "⚠" : "⚠ PO DEADLINE"}
        </span>
      )}

      {/* Drift kalendáře / odložení — druhé patro stacku pravého horního rohu, pod deadline
          badge (etapa 6). Informační pro VŠECHNY role (i TISKAR/VIEWER) — akce
          „Přepočítat" je jen v banneru stroje / BlockDetail, gatované na ADMIN/PLANOVAT.
          Parita s deadline badge: TINY jen piktogram, pod TINY nic. */}
      {!!calendarDrift && (MODE_FULL || MODE_COMPACT || MODE_TINY) && (
        <span
          title={
            calendarDrift.reason === "PARKED"
              ? calendarDrift.expectedEnd
                ? `Odložená mimo pracovní dobu — tiskne slitě, bez pauz směn. Po přepočtu by končila ${formatPragueDateTime(calendarDrift.expectedEnd)}.`
                // Expanze selhala — může za to nespustitelný začátek NEBO překročený
                // horizont plánování. Konkrétní příčinu tady nemáme, takže ji netvrdíme.
                : "Odložená mimo pracovní dobu — tiskne slitě, bez pauz směn. Konec podle kalendáře teď spočítat nejde."
              : calendarDrift.reason === "STALE_BYPASS"
                ? "Značená jako odložená mimo pracovní dobu, ale kalendáři odpovídá — značku zrušíš tlačítkem Přepočítat v detailu zakázky"
                : calendarDrift.reason === "END_MISMATCH" && calendarDrift.expectedEnd
                  ? `Konec nesedí na aktuální kalendář (správně do ${formatPragueDateTime(calendarDrift.expectedEnd)})`
                  : "Umístění bloku nesedí na aktuální kalendář"
          }
          style={{
            position: "absolute",
            top: isPastDeadline ? 22 : 4,
            right: 4,
            background: "#f59e0b",
            color: "#1f2937",
            fontSize: typeScale.badge,
            fontWeight: 800,
            lineHeight: 1,
            borderRadius: 4,
            padding: "1px 5px",
            zIndex: 4,
            userSelect: "none",
            // Bez hit-testu by se nikdy neukázala nápověda z `title` výš — a právě
            // ta je u téhle značky to podstatné: vysvětluje rozdíl mezi vědomým
            // odložením a skutečnou neshodou s kalendářem. Viz deadline štítek výš.
            whiteSpace: "nowrap",
          }}
        >
          {/* Odložení je stav, ne porucha — vlastní text i piktogram, ať plánovač nehledá
              chybu tam, kde žádná není. Zbytková značka (STALE_BYPASS) je pořád odložení,
              jen zrušitelné, takže nese týž štítek a liší se nápovědou. */}
          {isParked ? (MODE_TINY ? "⏸" : "⏸ ODLOŽENO") : MODE_TINY ? "⚠" : "⚠ KALENDÁŘ"}
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
              // Strop je nutný: tenhle badge se kreslí bezpodmínečně ve VŠECH
              // hustotách (podmínka `hasTiskarNotes` výš není vázaná na žádný
              // MODE_*), takže na nejnižší kartě (layoutHeight 14 px, box 14 px
              // posazený 7 px od horní hrany) přetéká už dnes. Bez stropu by
              // růst písma na L/XL přetečení jen zhoršil (viz MICRO_CHIP_CAP_FACTOR
              // výš — stejný princip jako u ostatních chipů vázaných na geometrii,
              // ne na hustotu).
              fontSize: Math.min(typeScale.noteBadge, layoutHeight * MICRO_CHIP_CAP_FACTOR),
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
        const dIcon = dataDeadlineState === "ok" ? " ✓" : dataDeadlineState === "danger" ? " ✕" : dataDeadlineState === "warning" ? " !" : dataDeadlineState === "earlyStart" ? " ⚠" : "";
        const mIcon = materialDeadlineState === "ok" ? " ✓" : materialDeadlineState === "danger" ? " ✕" : materialDeadlineState === "warning" ? " !" : materialDeadlineState === "earlyStart" ? " ⚠" : "";
        const pIcon = pantoneEffectiveState === "ok" ? " ✓" : pantoneEffectiveState === "danger" ? " ✕" : pantoneEffectiveState === "warning" ? " !" : pantoneEffectiveState === "earlyStart" ? " ⚠" : "";
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 4, paddingTop: 0, paddingBottom: 0, paddingLeft: (block.locked || isUnconfirmedReservation) ? 28 : 8, paddingRight: hasTiskarNotes ? 44 : 8, ...contentBoxFlex, overflow: "hidden", minHeight: 0 }}>
            {/* Levá část: datumy + separator + číslo + popis */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 1, minWidth: 0, overflow: "hidden", maxWidth: (block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) ? "58%" : undefined }}>
              {/* Na nízké kartě se pás specifikace nevejde — zbývá značka na začátku
                  řádku (flexShrink 0, takže ji popis nikdy nevytlačí) a text v tooltipu. */}
              {hasSpecChip && <SpecChip text={block.specifikace!} fontSize={typeScale.specChip} />}
              {!isTiskar && <>
                <BlockDateChip
                  text={block.dataStatusId ? dataDisplayLabel : `D ${block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}`}
                  state={dStateKey}
                  accent={FIELD_ACCENT.DATA}
                  fontSize={typeScale.chip}
                  title={dataDeadlineState === "earlyStart" ? "Start zakázky před dodáním dat" : undefined}
                  customBg={block.dataStatusId && dataAccent !== s.accentBar ? dataAccent : undefined}
                  customBorder={block.dataStatusId && dataAccent !== s.accentBar ? dataAccent : undefined}
                  customTextColor={block.dataStatusId && dataAccent !== s.accentBar ? (dataText ?? "#fff") : undefined}
                  onClick={dataCanToggle ? (e) => { e.stopPropagation(); if (dataCanOpenCalendar || dataCanOpenDtpPopover) { if (compactDataTimerRef.current) clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = setTimeout(() => { compactDataTimerRef.current = null; toggleField("dataOk", block.dataOk); }, 350); } else { toggleField("dataOk", block.dataOk); } } : undefined}
                  onDoubleClick={(dataCanOpenCalendar || dataCanOpenDtpPopover) ? (e) => {
                    e.stopPropagation();
                    if (compactDataTimerRef.current) { clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = null; }
                    if (dataCanOpenCalendar) {
                      onInlineDatePick!(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect());
                    } else if (dataCanOpenDtpPopover) {
                      onDataChipDoubleClick!(block.id, e.currentTarget.getBoundingClientRect());
                    }
                  } : undefined}
                />
                <MaterialNoteAffordance indicatorSize={4} indicatorTop={1} indicatorRight={1} block={block}>
                  <BlockDateChip
                    text={`M ${block.materialIssued ? "VYD." : block.materialInStock ? "SKLAD" : block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${mIcon}` : "—"}`}
                    state={mStateKey}
                    accent={FIELD_ACCENT.MATERIAL}
                    fontSize={typeScale.chip}
                    title={materialDeadlineState === "earlyStart" ? "Start zakázky před dodáním materiálu" : undefined}
                    onClick={block.materialRequiredDate && !block.materialInStock && !block.materialIssued ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactMatTimerRef.current) clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = setTimeout(() => { compactMatTimerRef.current = null; toggleField("materialOk", block.materialOk); }, 350); } else { toggleField("materialOk", block.materialOk); } } : undefined}
                    onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactMatTimerRef.current) { clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = null; } onInlineDatePick(block.id, "material", block.materialRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}
                  />
                </MaterialNoteAffordance>
                <BlockDateChip
                  text={`E ${block.deadlineExpedice ? fmtDateShort(block.deadlineExpedice) : "—"}`}
                  state={eStateKey}
                  accent={FIELD_ACCENT.EXPEDICE}
                  fontSize={typeScale.chip}
                />
                {pantoneVisible && (
                  <BlockDateChip
                    text={`P ${pantoneChipText(pIcon)}`}
                    state={pantoneStateKey}
                    accent={FIELD_ACCENT.PANTONE}
                    fontSize={typeScale.chip}
                    title={pantoneEffectiveState === "earlyStart" ? "Start zakázky před dodáním pantonu" : undefined}
                    onClick={block.pantoneRequiredDate && !pantoneHandled ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactPanTimerRef.current) clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = setTimeout(() => { compactPanTimerRef.current = null; toggleField("pantoneOk", block.pantoneOk); }, 350); } else { toggleField("pantoneOk", block.pantoneOk); } } : undefined}
                    onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactPanTimerRef.current) { clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = null; } onInlineDatePick(block.id, "pantone", block.pantoneRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}
                  />
                )}
                <div style={{ width: 1, height: 12, background: "var(--border)", flexShrink: 0 }} />
              </>}
              <span style={{ fontSize: typeScale.num * 0.92, fontWeight: 700, color: s.textPrimary, whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1 }}>
                {block.orderNumber}{block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.85 }}><Lock size={Math.round(typeScale.num * NUM_ICON_RATIO_MINOR)} strokeWidth={2} /></span>}{isUnconfirmedReservation && !block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.85 }}><Hourglass size={Math.round(typeScale.num * NUM_ICON_RATIO_MINOR)} strokeWidth={2} /></span>}
                {isPrintDone && <span style={{ marginLeft: 4, fontSize: typeScale.num * NUM_ICON_RATIO_MINOR, color: "#22c55e", fontWeight: 700 }}>✓</span>}
                {isOverdue && !isPrintDone && block.type === "ZAKAZKA" && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 4 }}><Clock size={Math.round(typeScale.num * NUM_ICON_RATIO_CLOCK)} strokeWidth={2.5} color="#f59e0b" /></span>}
              </span>
              {block.description && (
                <span style={{ display: "flex", alignItems: "baseline", gap: 3, flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <span style={{ fontSize: typeScale.desc * 0.9, fontWeight: 400, color: s.textSub, opacity: typeScale.descOpacityTiny, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1, flexShrink: 1 }}>
                    {block.description}
                  </span>
                </span>
              )}
            </div>
            {/* Uprostřed: typový chip (OBÁLKA/VNITŘKY/TA·série), vystředěný spacery */}
            {(block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) && (
              <>
                <div style={{ flex: 1, minWidth: 6 }} />
                <ProductionChips obalka={block.obalka} vnitrky={block.vnitrky} tiskoveArchy={block.tiskoveArchy} serie={block.serie} abbreviated fontSize={typeScale.production} />
              </>
            )}
            <div style={{ flex: 1, minWidth: 6 }} />
            {/* Vpravo: status chipy + série marker + tiskař + split */}
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
              {(hasNoteRow || block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
                  {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={matAccent}   textColor={matText   ?? undefined} fontSize={typeScale.mini} />}
                  {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent={barvyAccent} textColor={barvyText ?? undefined} fontSize={typeScale.mini} />}
                  {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent={lakAccent}   textColor={lakText   ?? undefined} fontSize={typeScale.mini} />}
                  {(block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                    <span style={{ fontSize: typeScale.mini * 0.9, opacity: 0.4, color: s.textSub, flexShrink: 0 }}>↻</span>
                  )}
                </div>
              )}
              {squareDoneButton}
              {splitPartner && clampedHeight >= 32 && (() => {
                const { state, time } = getSplitChipState(splitPartner);
                return (
                  <SplitChip
                    partnerMachine={splitPartner.machine}
                    state={state}
                    time={time}
                    onClick={() => onSplitChipClick?.(splitPartner.id)}
                    fontSize={typeScale.splitChip}
                  />
                );
              })()}
            </div>
          </div>
        );
      })()}

      {/* ── MODE_TINY + MICRO_TEXT: jednořádkový layout — [D chip][M chip][E chip] · číslo · popis.
          Sdílený pro obě úzká pásma (`thresholds.micro`–`thresholds.compact`, na M 14–43 px, roste
          se stupněm): chipy dodání dat/materiálu/expedice mají přednost, popis se uřízne elipsou,
          když nezbude místo. Půlhodinový blok v nadhledu (`thresholds.micro`–`thresholds.tiny`, na M
          14–21 px) tak neztratí D/M/E chipy — dřív MICRO_TEXT ukazoval jen popis bez chipů. ── */}
      {(MODE_TINY || MODE_MICRO_TEXT) && (() => {
        const dStateKey = block.dataStatusId ? "ok" : !block.dataRequiredDate ? "empty" : dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
        const mStateKey = block.materialIssued ? "issued" : block.materialInStock ? "ok" : (!block.materialRequiredDate ? "empty" : materialDeadlineState === "none" ? "neutral" : materialDeadlineState);
        const eStateKey = !block.deadlineExpedice ? "empty" : "neutral";
        // Všechny fontSize v tomhle sdíleném řádku, které mají VLASTNÍ pevné
        // odsazení/rámeček (chip, SpecChip „S", MiniChip), MUSÍ být stropované
        // `MICRO_CHIP_CAP_FACTOR` (odvození u definice konstanty výš v souboru) —
        // strop se NEODSTRAŇUJ, i kdyby vypadal "zbytečný".
        const chipStyle = (stateKey: DateChipState, fieldAccent: string, clickable: boolean): React.CSSProperties => ({
          fontSize: Math.min(typeScale.chip, layoutHeight * MICRO_CHIP_CAP_FACTOR), fontWeight: 600,
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
        const pIcon = pantoneEffectiveState === "ok" ? " ✓" : pantoneEffectiveState === "danger" ? " ✕" : pantoneEffectiveState === "warning" ? " !" : pantoneEffectiveState === "earlyStart" ? " ⚠" : "";
        // Číslo i všechno, co ho doprovází, musí vycházet ze STEJNÉ velikosti.
        // Jinak je v nejnižší hustotě ikona větší než číslo — při XL a kartě
        // 14 px vycházel zámek 12 px proti číslu 9,8 px.
        const tinyNum = Math.min(typeScale.num * 0.92, layoutHeight * MICRO_TEXT_CAP_FACTOR);
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 4, paddingTop: 0, paddingBottom: 0, paddingLeft: (block.locked || isUnconfirmedReservation) ? 28 : 8, paddingRight: hasTiskarNotes ? 44 : 8, ...contentBoxFlex, overflow: "hidden", minHeight: 0 }}>
            {/* Levá část: datum chips + číslo + popis */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 1, minWidth: 0, overflow: "hidden", maxWidth: (block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) ? "58%" : undefined }}>
              {/* Značka specifikace i tady — bez ní by karta v tomhle pásmu (`thresholds.micro`–
                  `thresholds.compact`) neukázala ani pás, ani „S", ani proužek (proužek je
                  potlačen hasSpecChip). */}
              {hasSpecChip && <SpecChip text={block.specifikace!} fontSize={Math.min(typeScale.specChip, layoutHeight * MICRO_CHIP_CAP_FACTOR)} />}
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
                {pantoneVisible && (
                  <span style={chipStyle(pantoneStateKey, FIELD_ACCENT.PANTONE, !!block.pantoneRequiredDate && !pantoneHandled)} title={pantoneEffectiveState === "earlyStart" ? "Start zakázky před dodáním pantonu" : undefined}
                    onClick={block.pantoneRequiredDate && !pantoneHandled ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactPanTimerRef.current) clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = setTimeout(() => { compactPanTimerRef.current = null; toggleField("pantoneOk", block.pantoneOk); }, 350); } else { toggleField("pantoneOk", block.pantoneOk); } } : undefined}
                    onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactPanTimerRef.current) { clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = null; } onInlineDatePick(block.id, "pantone", block.pantoneRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                    P&nbsp;{pantoneChipText(pIcon)}
                  </span>
                )}
                <div style={{ width: 1, height: 10, background: "var(--border)", flexShrink: 0 }} />
              </>}
              <span style={{ fontSize: tinyNum, fontWeight: 700, color: s.textPrimary, whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1 }}>
                {block.orderNumber}{block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.85 }}><Lock size={Math.round(tinyNum * NUM_ICON_RATIO_MINOR)} strokeWidth={2} /></span>}{isUnconfirmedReservation && !block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.85 }}><Hourglass size={Math.round(tinyNum * NUM_ICON_RATIO_MINOR)} strokeWidth={2} /></span>}
              </span>
              {block.description && (
                <span style={{ display: "flex", alignItems: "baseline", gap: 3, flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <span style={{ fontSize: Math.min(typeScale.desc * 0.9, layoutHeight * MICRO_TEXT_CAP_FACTOR), fontWeight: 400, color: s.textSub, opacity: typeScale.descOpacityTiny, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1, flexShrink: 1 }}>
                    {block.description}
                  </span>
                </span>
              )}
            </div>
            {/* Uprostřed: typový chip (OBÁLKA/VNITŘKY/TA·série), vystředěný spacery */}
            {(block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) && (
              <>
                <div style={{ flex: 1, minWidth: 6 }} />
                <ProductionChips obalka={block.obalka} vnitrky={block.vnitrky} tiskoveArchy={block.tiskoveArchy} serie={block.serie} abbreviated fontSize={typeScale.production} />
              </>
            )}
            <div style={{ flex: 1, minWidth: 6 }} />
            {/* Vpravo: status chipy + série marker + split marker + tiskař */}
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
              {(hasNoteRow || block.recurrenceType !== "NONE" || block.recurrenceParentId !== null || (splitTotal ?? 0) > 1) && (
                <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
                  {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={matAccent}   textColor={matText   ?? undefined} fontSize={Math.min(typeScale.mini, layoutHeight * MICRO_CHIP_CAP_FACTOR)} />}
                  {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent={barvyAccent} textColor={barvyText ?? undefined} fontSize={Math.min(typeScale.mini, layoutHeight * MICRO_CHIP_CAP_FACTOR)} />}
                  {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent={lakAccent}   textColor={lakText   ?? undefined} fontSize={Math.min(typeScale.mini, layoutHeight * MICRO_CHIP_CAP_FACTOR)} />}
                  {(block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                    <span style={{ fontSize: tinyNum * 0.9, opacity: 0.4, color: s.textSub, flexShrink: 0, lineHeight: 1 }}>↻</span>
                  )}
                  {(splitTotal ?? 0) > 1 && (
                    <span style={{ fontSize: tinyNum * 0.9, opacity: 0.55, color: s.textSub, flexShrink: 0, lineHeight: 1 }}>✂{splitPart}/{splitTotal}{(splitTotalMinutes ?? 0) > 0 ? ` · ${formatPrintHoursShort(splitTotalMinutes!)}` : ""}</span>
                  )}
                </div>
              )}
              {squareDoneButton}
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
          {/* Levá část: značka specifikace (je-li) + číslo + popis */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6, flex: 1, minWidth: 0, overflow: "hidden" }}>
            {/* Značka specifikace vlevo, stejně jako v COMPACT/TINY/MICRO_TEXT — dřív byla
                v pravém shluku a na kartách, kde padly do FULL layoutu (~1,5h zakázka),
                „S" najednou naskočilo vpravo, zatímco jinde je vlevo (nález 12.8.2026). */}
            {hasSpecChip && <SpecChip text={block.specifikace!} fontSize={typeScale.specChip} />}
            <span style={{
              fontSize: typeScale.num, fontWeight: 800, color: s.textPrimary,
              lineHeight: 1.2, flexShrink: 0, maxWidth: "60%",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {block.orderNumber}
              {block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 3, opacity: 0.85 }}><Lock size={Math.round(typeScale.num * NUM_ICON_RATIO_MINOR)} strokeWidth={2} /></span>}{isUnconfirmedReservation && !block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.85 }}><Hourglass size={Math.round(typeScale.num * NUM_ICON_RATIO_MINOR)} strokeWidth={2} /></span>}
            </span>
            {showDesc && block.description && (
              <span
                // title jen když je popis useknutý na 1 řádek (typicky tiskař s pásem
                // specifikace, task 5d) — nulový vliv na geometrii, ale bez něj plný text
                // na kartě nemá u myši žádného nosiče. Nespoléhat na tohle u tiskaře na
                // dotykovém kiosku (hover tam nenastane) — skutečná záchrana je Monitor.
                title={descLineClamp === 1 ? block.description : undefined}
                style={{
                  fontSize: typeScale.desc, fontWeight: 400, color: s.textSub, opacity: typeScale.descOpacity, lineHeight: 1.3,
                  overflow: "hidden", display: "-webkit-box",
                  WebkitLineClamp: descLineClamp, WebkitBoxOrient: "vertical",
                  whiteSpace: "pre-wrap",
                  flex: 1, minWidth: 0,
                }}>
                {block.description}
              </span>
            )}
          </div>
          {/* Pravá část: status chips + série + split. „S" se odsud přesunula vlevo (viz výš) —
              proto tenhle shluk NESMÍ dál vycházet z `hasNoteRow` (ten je true i jen díky
              `block.specifikace`, kterou už tenhle shluk nekreslí, a taky díky
              `dataStatusLabel`, který tu nikdy nebyl) — vlastní podmínka přesně podle toho,
              co se uvnitř skutečně vykresluje, jinak by tu po přesunu „S" mohl zůstat
              prázdný `<div>`. */}
          {(block.materialStatusLabel || block.barvyStatusLabel || block.lakStatusLabel || block.recurrenceType !== "NONE" || block.recurrenceParentId !== null || (splitTotal ?? 0) > 1) && (
            <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
              {block.materialStatusLabel && <MiniChip label={block.materialStatusLabel} accent={matAccent}   textColor={matText   ?? undefined} fontSize={typeScale.mini} />}
              {block.barvyStatusLabel    && <MiniChip label={block.barvyStatusLabel}    accent={barvyAccent} textColor={barvyText ?? undefined} fontSize={typeScale.mini} />}
              {block.lakStatusLabel      && <MiniChip label={block.lakStatusLabel}      accent={lakAccent}   textColor={lakText   ?? undefined} fontSize={typeScale.mini} />}
              {(block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) && (
                <span style={{ fontSize: typeScale.mini * 0.9, opacity: 0.4, color: s.textSub }}>↻</span>
              )}
              {(splitTotal ?? 0) > 1 && (
                showSplitChipInHeader ? (() => {
                  const { state, time } = getSplitChipState(splitPartner!);
                  return (
                    // marginTop:-6 ruší vestavěné odsazení SplitChipu (`SplitChip.tsx`) —
                    // v horizontálním shluku drobných chipů by jen zbytečně nafukovalo
                    // Řádek 1 a ubíralo místo tlačítku Hotovo pod ním (viz
                    // `splitChipFitsInHeaderRow`, `tiskarBlockView.ts`).
                    <span style={{ display: "inline-flex", marginTop: -6 }}>
                      <SplitChip
                        partnerMachine={splitPartner!.machine}
                        state={state}
                        time={time}
                        onClick={() => onSplitChipClick?.(splitPartner!.id)}
                        fontSize={typeScale.splitChip}
                      />
                    </span>
                  );
                })() : (
                  <span style={{ fontSize: typeScale.mini * 0.9, opacity: 0.55, color: s.textSub, flexShrink: 0, lineHeight: 1 }}>✂{splitPart}/{splitTotal}{(splitTotalMinutes ?? 0) > 0 ? ` · ${formatPrintHoursShort(splitTotalMinutes!)}` : ""}</span>
                )
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Řádek 2: Datumové chipy (MODE_FULL) — vždy všechny, jednořádkové ── */}
      {showDates && (() => {
        const dSK: DateChipState = block.dataStatusId ? "ok" : !block.dataRequiredDate ? "empty" : dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
        const mSK: DateChipState = block.materialIssued ? "issued" : block.materialInStock ? "ok" : (!block.materialRequiredDate ? "empty" : materialDeadlineState === "none" ? "neutral" : materialDeadlineState);
        const eSK: DateChipState = !block.deadlineExpedice ? "empty" : "neutral";
        const dIcon = dataDeadlineState === "ok" ? " ✓" : dataDeadlineState === "danger" ? " ✕" : dataDeadlineState === "warning" ? " !" : dataDeadlineState === "earlyStart" ? " ⚠" : "";
        const mIcon = materialDeadlineState === "ok" ? " ✓" : materialDeadlineState === "danger" ? " ✕" : materialDeadlineState === "warning" ? " !" : materialDeadlineState === "earlyStart" ? " ⚠" : "";
        const pIcon = pantoneEffectiveState === "ok" ? " ✓" : pantoneEffectiveState === "danger" ? " ✕" : pantoneEffectiveState === "warning" ? " !" : pantoneEffectiveState === "earlyStart" ? " ⚠" : "";
        return (
          <div
            style={{ padding: "2px 7px 3px", display: "flex", gap: 5, flexWrap: "nowrap", flexShrink: 0, alignItems: "center", overflow: "hidden" }}
            onMouseEnter={() => setBadgeHovered(true)}
            onMouseLeave={() => setBadgeHovered(false)}
          >
            <BlockDateChip
              text={block.dataStatusId ? dataDisplayLabel : `D ${block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}`}
              state={dSK}
              accent={FIELD_ACCENT.DATA}
              fontSize={typeScale.chip}
              title={dataDeadlineState === "earlyStart" ? "Start zakázky před dodáním dat" : undefined}
              customBg={block.dataStatusId && dataAccent !== s.accentBar ? dataAccent : undefined}
              customBorder={block.dataStatusId && dataAccent !== s.accentBar ? dataAccent : undefined}
              customTextColor={block.dataStatusId && dataAccent !== s.accentBar ? (dataText ?? "#fff") : undefined}
              onDoubleClick={(dataCanOpenCalendar || dataCanOpenDtpPopover) ? (e) => {
                e.stopPropagation();
                if (dataCanOpenCalendar) { onInlineDatePick?.(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); }
                else if (dataCanOpenDtpPopover) { onDataChipDoubleClick?.(block.id, e.currentTarget.getBoundingClientRect()); }
              } : undefined}
            />
            <MaterialNoteAffordance block={block}>
              <BlockDateChip
                text={`M ${block.materialIssued ? "VYD." : block.materialInStock ? "SKLAD" : block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${mIcon}` : "—"}`}
                state={mSK}
                accent={FIELD_ACCENT.MATERIAL}
                fontSize={typeScale.chip}
                title={materialDeadlineState === "earlyStart" ? "Start zakázky před dodáním materiálu" : undefined}
                onClick={block.materialRequiredDate && !block.materialInStock && !block.materialIssued ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactMatTimerRef.current) clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = setTimeout(() => { compactMatTimerRef.current = null; toggleField("materialOk", block.materialOk); }, 350); } else { toggleField("materialOk", block.materialOk); } } : undefined}
                onDoubleClick={canEditMat ? (e) => { e.stopPropagation(); if (compactMatTimerRef.current) { clearTimeout(compactMatTimerRef.current); compactMatTimerRef.current = null; } onInlineDatePick?.(block.id, "material", block.materialRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}
              />
            </MaterialNoteAffordance>
            <BlockDateChip
              text={`E ${block.deadlineExpedice ? fmtDateShort(block.deadlineExpedice) : "—"}`}
              state={eSK}
              accent={FIELD_ACCENT.EXPEDICE}
              fontSize={typeScale.chip}
            />
            {pantoneVisible && (
              <BlockDateChip
                text={`P ${pantoneChipText(pIcon)}`}
                state={pantoneStateKey as DateChipState}
                accent={FIELD_ACCENT.PANTONE}
                fontSize={typeScale.chip}
                title={pantoneEffectiveState === "earlyStart" ? "Start zakázky před dodáním pantonu" : undefined}
                customBg={block.pantoneIssued ? DEADLINE_BG.issued : undefined}
                customBorder={block.pantoneIssued ? DEADLINE_BORDER.issued : undefined}
                onClick={pantoneHandled ? undefined : (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactPanTimerRef.current) clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = setTimeout(() => { compactPanTimerRef.current = null; toggleField("pantoneOk", block.pantoneOk); }, 350); } else { toggleField("pantoneOk", block.pantoneOk); } }}
                onDoubleClick={canEditMat ? (e) => { e.stopPropagation(); if (compactPanTimerRef.current) { clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = null; } onInlineDatePick?.(block.id, "pantone", block.pantoneRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}
              />
            )}
          </div>
        );
      })()}

      {/* ── Řádek 3: Specifikace — zvýrazněný amber pás ── */}
      {hasSpecBand && <SpecBand text={block.specifikace!} twoLine={specTwoLine} fontSize={typeScale.spec} />}


      {/* Hotovo tlačítko pro TISKAR (FULL mode) — pruh přes celou šířku karty.
          MUSÍ zůstat PŘED SplitChipem: karta má overflow:hidden, takže prvek
          vykreslený dřív má přednost. Opačné pořadí propadlo tlačítko pod ořez
          u hodinových bloků se split partnerem (regrese zachycená 3. 8. 2026). */}
      {isTiskar && onPrintComplete && block.type === "ZAKAZKA" && MODE_FULL && printDone?.variant === "bar" && (
        <div style={{ padding: "2px 7px 5px", flexShrink: 0 }}>
          <PrintDoneButton
            size={printDone}
            isDone={isPrintDone}
            completedAt={block.printCompletedAt}
            pending={printPending}
            onToggle={togglePrintDone}
          />
        </div>
      )}

      {/* SplitChip — jen pro TISKAR, MODE_FULL. Zobrazí se jen když na něj po
          tlačítku Hotovo zbylo místo, ať v kartě nevisí useknutý proužek. */}
      {MODE_FULL && splitPartner && splitChipFits(layoutHeight, printDone, specRows, typeScale) && (() => {
        const { state, time } = getSplitChipState(splitPartner);
        return (
          <SplitChip
            partnerMachine={splitPartner.machine}
            state={state}
            time={time}
            onClick={() => onSplitChipClick?.(splitPartner.id)}
            fontSize={typeScale.splitChip}
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
          <ProductionChips obalka={block.obalka} vnitrky={block.vnitrky} tiskoveArchy={block.tiskoveArchy} serie={block.serie} fontSize={typeScale.production} />
        </div>
      )}

      {/* Resize handle — rohový iOS-style */}
      {!block.locked && !isTiskar && (
        <div
          onMouseEnter={() => setResizeHovered(true)}
          onMouseLeave={() => setResizeHovered(false)}
          onMouseDown={(e) => { e.stopPropagation(); onResizeMouseDown?.(e); }}
          style={{
            position: "absolute", bottom: 0, right: 0,
            width: 20, height: 20,
            // zIndex 5 = nad VŠEMI karta-interními vrstvami (obsah 2–3, chipy 4).
            // Bez něj ho překryl amber pás specifikace (SpecBand, zIndex 2), který
            // jako poslední prvek toku sahá až do pravého dolního rohu — pozicovaný
            // prvek se z-indexem se kreslí nad prvkem se `zIndex: auto` bez ohledu
            // na pořadí v DOM, takže pás spolkl mousedown a úchyt přestal fungovat
            // (regrese ze zvýraznění specifikace, 8/2026).
            zIndex: 5,
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
          {/* Bez stropu záměrně — kreslí se JEN v segmentu vysokém aspoň 40 px
              (podmínka `seg.height >= 40` níž), takže i na XL má vždycky dost
              místa. Nedoplňovat MICRO_CHIP_CAP_FACTOR strop, jaký má badge
              poznámek výš — tam ho vyžaduje geometrie, tady žádná mez chybí. */}
          {seg.height >= 40 && (
            <span style={{ fontSize: typeScale.pauseLabel, fontWeight: 700, letterSpacing: 1, color: "rgba(203,213,225,0.85)", background: "rgba(2,6,23,0.6)", padding: "1px 8px", borderRadius: 6 }}>
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

      {/* ── Indikátor specifikace — svislý proužek vpravo. Poslední záchrana pro
             karty, kde není ani pás, ani řádek chipů se značkou „S": micro tečky
             pod 14 px a tiskařský režim pod 80 px (tam má přednost Hotovo). ── */}
      {block.specifikace && !hasSpecBand && !hasSpecChip && (
        <div
          title="Obsahuje specifikaci"
          style={{
            position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)",
            width: 3, height: "55%", minHeight: 8, maxHeight: 22,
            borderRadius: 2, background: "rgba(251,191,36,0.8)",
            // Bez hit-testu se nápověda „Obsahuje specifikaci" nikdy neukáže. Právě
            // tady na ní záleží nejvíc: tenhle proužek je poslední záchrana na
            // kartách, kde se text specifikace ani zkráceně nevejde, takže bublina
            // je jediná cesta, jak se plánovač doví, že tam nějaká je.
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
