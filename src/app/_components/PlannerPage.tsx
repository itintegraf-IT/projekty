"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import TimelineGrid, { dateToY, type Block, type CompanyDay, type SplitDoneInfo } from "./TimelineGrid";
import { RESERVATION_FLIP_VARIANT, type BlockVariant } from "@/lib/blockVariants";
import {
  addDaysToCivilDate,
  diffCivilDateDays,
  normalizeCivilDateInput,
  pragueOf,
  pragueToUTC,
  todayPragueDateStr,
  utcToPragueDateStr,
} from "@/lib/dateUtils";
import { snapToNextValidStartWithTemplates } from "@/lib/workingTime";
import { Z_LAYOUT } from "@/lib/zLayers";
import { computePasteTargetFromBlock, computePasteTargetFromGroup } from "@/lib/pasteTarget";
import { blockCalendarDrift, blockPrintMinutes, companyDayIntervalsFor } from "@/lib/printTimeClient";
import { blockToCreatePayload } from "@/lib/blockPayload";
import { snapStartToNextRunnableSlot, usesTiskoveHodiny, typeUsesTiskoveHodiny } from "@/lib/printTime";
import { serializeProductionTags } from "@/lib/productionTags";
import { useUndoManager } from "./useUndoManager";
import type { BlockSnapshot, EditSnapshot, UndoEffects } from "@/lib/undo/types";
import { buildMoveCommand, buildMultiEditCommand, buildCreateCommand, buildDeleteCommand, buildMoveOrResizeCommand, buildReflowCommand, buildSplitCommand } from "@/lib/undo/commands";
import { UNDO_MAX_OPS } from "@/lib/undo/limits";
import { blockToRestoreFields } from "@/lib/undo/restoreFields";
import { buildSplitEditTargetsWithShifted, buildPassiveSiblingTargets, mergePositionIntoTargets, mergeAnchorPositionIfChanged, pickShiftedSplitSiblings } from "@/lib/undo/splitSiblingFields";
import { accumulateShifted, excludeShiftedTargeted, type ShiftedSnapshots } from "@/lib/undo/shiftedBatch";
import { SPLIT_SHARED_FIELDS } from "@/lib/splitSharedFields";
import { weekStartStrFromDateStr, type MachineWeekShiftsRow, type ShiftDayPayload } from "@/lib/machineWeekShifts";
import { ShiftCascadeDialog, type CascadeBlock } from "@/components/admin/ShiftCascadeDialog";
import { SearchField } from "@/components/SearchField";
import { Label }     from "@/components/ui/label";
import { Button }    from "@/components/ui/button";
import { Lock, Unlock } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import DatePickerField from "./DatePickerField";
import { ToastContainer, useToast } from "@/components/ToastContainer";
import { isShortcut } from "@/lib/keyboardShortcuts";
import { ZoomSlider } from "@/components/ZoomSlider";
import { useNotifications } from "@/hooks/useNotifications";
import { NotificationBell } from "@/components/NotificationBell";
import { UndoRedoButtons } from "@/components/UndoRedoButtons";
import { NotificationsPanel, type NotifTab } from "@/components/NotificationsPanel";
import { BlockNotesDialog } from "@/components/BlockNotesDialog";
import type { SerializedBlockNote } from "@/lib/blockNoteSerialization";
import type { NoteRole } from "@/lib/blockNotePermissions";
import { MonitorView } from "@/components/monitor/MonitorView";
import { viewDaysBack, viewDaysAhead } from "@/lib/tiskarViewRange";
import { BlockDetail } from "@/components/BlockDetail";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ShutdownManager } from "@/components/planner/ShutdownManager";
import { JobBuilderPanel } from "@/components/planner/JobBuilderPanel";
import { ResizeHandle } from "@/components/planner/ResizeHandle";
import { BlockEdit } from "@/components/BlockEdit";
import { DtpPanel } from "@/components/DtpPanel";
import { DtpDataPopover } from "@/components/DtpDataPopover";
import { TiskarMachineToggle } from "@/components/TiskarMachineToggle";
import { OrderSearchSheet } from "@/components/OrderSearchSheet";
import { blockMatchesQuery } from "@/lib/orderSearch";
import { useSSE, type SSEMessage } from "@/hooks/useSSE";
import { useJobBuilder, type ReservationQueueItem } from "@/hooks/useJobBuilder";
import { FontScaleSwitch } from "@/components/planner/FontScaleSwitch";
import {
  DEFAULT_FONT_SCALE,
  FONT_SCALE_STORAGE_KEY,
  effectiveSlotHeight,
  isPlannerFontScale,
  plannerTypeScale,
  type PlannerFontScale,
} from "@/lib/plannerTypography";
import { reflowMachineToast, reflowBlockToast } from "@/lib/reflowToastText";
import { fetchWithCascadeConfirm, askOncePerGesture, isCascadeDeclined, type CascadePayload } from "@/lib/cascadeConfirmClient";
import { cascadeConfirmMessage } from "@/lib/cascadeLimit";

// NOTE etapa 8: pro role bez přístupu k builderu stačí nevyrenderovat handle + aside
// — timeline s flex-1 se automaticky roztáhne na celou šířku

// Interní signál pro throw/catch uvnitř try bloků, které mají sdílenou rollback
// logiku pro chybu i pro zamítnutí kaskády (group paste) — odlišuje "uživatel
// řekl Zrušit" (mlčíme) od skutečné chyby (toast), aniž by se duplikoval kód rollbacku.
const CASCADE_DECLINED_SIGNAL = Symbol("cascadeDeclinedInPlannerPage");

// Pole sledovaná pro undo/redo editace formulářem (BlockEdit.buildPayload) + DTP/MTZ single-field.
const EDIT_TRACKED_FIELDS = [
  "orderNumber","type","blockVariant","jobPresetId","description","locked","deadlineExpedice",
  "dataStatusId","dataStatusLabel","dataRequiredDate","dataOk","materialStatusId","materialStatusLabel",
  "materialRequiredDate","materialOk","materialNote","materialInStock","materialIssued","materialPartiallyIssued","pantoneRequired",
  "pantoneRequiredDate","pantoneOk","pantoneInStock","pantoneIssued","barvyStatusId","barvyStatusLabel","lakStatusId","lakStatusLabel",
  "specifikace","obalka","vnitrky","tiskoveArchy","serie",
] as const;

// Výchozí/maximální výška slotu (px, surové `slotHeight` PŘED `effectiveSlotHeight`
// — viz `plannerTypography.ts`) — dřív magické číslo `26` na třech místech
// (`useState` init + horní mez dvou clampů zoomu). Je to i produkčně viditelná
// hodnota: `gridSlotHeight` na ni pevně drží TISKAŘE bez zoom slideru (task 5c,
// review 12. 8. 2026), takže „výchozí" tu znamená totéž co „jediná hodnota, kterou
// kdy tiskař uvidí" — ne jen dočasný stav před načtením preference.
const DEFAULT_SLOT_HEIGHT = 26;

// POST tělo pro vložení kopie bloku (single i group paste) — jedna cesta, aby se
// request flagy nerozešly mezi handlePasteWithTarget a handleGroupPasteWithTarget.
function buildPasteBody(src: Block, machine: string, newStart: Date, newEnd: Date, bypass: boolean) {
  return {
    ...blockToCreatePayload(src, {
      machine,
      startTime: newStart.toISOString(),
      endTime: newEnd.toISOString(),
      locked: false,
    }),
    bypassScheduleValidation: bypass,
    resolveChain: true,
  };
}

// ─── PlannerPage ──────────────────────────────────────────────────────────────
export default function PlannerPage({ initialBlocks, initialCompanyDays, initialMachineWeekShifts, currentUser, initialQueueReservations = [], initialFilterText }: { initialBlocks: Block[]; initialCompanyDays: CompanyDay[]; initialMachineWeekShifts: MachineWeekShiftsRow[]; currentUser: { id: number; username: string; role: string; assignedMachine?: string | null }; initialQueueReservations?: ReservationQueueItem[]; initialFilterText?: string }) {
  // Role-based permissions
  const canEdit         = ["ADMIN", "PLANOVAT"].includes(currentUser.role);
  const canEditData     = canEdit || currentUser.role === "DTP";
  const canEditDataDate = canEdit;
  const canEditMat      = canEdit || currentUser.role === "MTZ";
  const isTiskar    = currentUser.role === "TISKAR";
  const canSeeNotes = canEdit || isTiskar;

  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [notesDialogBlockId, setNotesDialogBlockId] = useState<number | null>(null);
  const [companyDays, setCompanyDays] = useState<CompanyDay[]>(initialCompanyDays);
  const [machineWeekShifts, setMachineWeekShifts] = useState<MachineWeekShiftsRow[]>(initialMachineWeekShifts);
  // Dark mode detekce — projekt přepíná theme přes .dark třídu na html elementu
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains("dark"));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  const [plannerCascade, setPlannerCascade] = useState<{
    conflicts: CascadeBlock[];
    longerCount: number;
    pendingPayload: { machine: string; weekStart: string; days: ShiftDayPayload[] };
  } | null>(null);
  const [showShutdowns, setShowShutdowns] = useState(false);
  const notif = useNotifications(currentUser.role);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [notifTab, setNotifTab] = useState<NotifTab>("inbox");

  // ── Toast systém ──
  const { toasts, showToast, dismissToast } = useToast();

  const [workingTimeLock, setWorkingTimeLock] = useState(true);
  const workingTimeLockRef = useRef(true);
  workingTimeLockRef.current = workingTimeLock;

  // ── Peek panel (TISKAR) ──
  // TISKAR: aktuálně zobrazený stroj (default = vlastní). Přepíná se v hlavičce
  // přes TiskarMachineToggle nebo automaticky po kliku na SplitChip / výběru v hledání.
  const [viewMachine, setViewMachine] = useState<string>(currentUser.assignedMachine ?? "XL_105");
  const [searchSheetOpen, setSearchSheetOpen] = useState(false);
  // TISKAR: Monitor je domovská obrazovka, plán je za tlačítkem „Celý plán →".
  // Záměrně asymetrické — nejde o dvojici rovnocenných záložek.
  const [tiskarView, setTiskarView] = useState<"monitor" | "plan">("monitor");
  // Jednorázový příkaz pro Monitor — „vytáhni tuhle zakázku na velkou kartu".
  // Monitor si ho po zpracování sám vynuluje přes onFocusHandled.
  const [monitorFocusId, setMonitorFocusId] = useState<number | null>(null);

  // ── Job Builder (tvorba zakázek/série/fronty) — vlastní hook ──
  // handleBlockCreate je hoisted function (níže) → lze ji předat sem jako onBlockCreated.
  const jb = useJobBuilder({ showToast, onBlockCreated: handleBlockCreate, blocks, companyDays, machineWeekShifts, initialQueueReservations });
  // Destrukturováno pro koordinátorský kód, který zůstává v PlannerPage
  // (handleQueueDrop, delete cesty, props do TimelineGrid/BlockEdit/DtpPanel/…).
  const {
    bDataOpts, bMaterialOpts, bBarvyOpts, bLakOpts,
    jobPresets,
    badgeColorMap,
    queue, setQueue,
    draggingQueueItem, setDraggingQueueItem,
    reservationQueue, setReservationQueue,
    addRecurrenceInterval,
  } = jb;

  // Timeline state
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [keyDeletePending, setKeyDeletePending] = useState(false);
  // Blok vybraný přes menu "🗑 Odstranit" — na rozdíl od keyDeletePending
  // NENÍ vázaný na selectedBlock (uživatel může pravým tlačítkem kliknout na
  // jiný blok, než má aktuálně otevřený v detailu). Obě cesty sytí jediný
  // ConfirmDialog níž přes `pendingDeleteBlock`.
  const [menuDeleteBlock, setMenuDeleteBlock] = useState<Block | null>(null);
  const [deleteRejectionReason, setDeleteRejectionReason] = useState("");
  const [multiDeletePending, setMultiDeletePending] = useState(false);
  // Smazání zamčeného/vytištěného bloku vrátil server s requiresForce —
  // vyžádané druhé potvrzení (audit DATA-03).
  const [forceDeleteConfirm, setForceDeleteConfirm] = useState<{ block: Block; rejectionReason?: string; message: string } | null>(null);
  // Totéž pro hromadné mazání — souhrnné potvrzení chráněných bloků.
  const [multiForceDelete, setMultiForceDelete] = useState<{ ids: number[] } | null>(null);
  // Potvrzení velké kaskády autoposunu (server 409 CASCADE_CONFIRM) — promise-resolver
  // čeká na odpověď z dialogu, viz askCascade níž.
  const [cascadeAsk, setCascadeAsk] = useState<{ payload: CascadePayload; resolve: (ok: boolean) => void } | null>(null);
  const [editingBlock, setEditingBlock]   = useState<Block | null>(null);
  const [copiedBlock, setCopiedBlock] = useState<Block | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<number>>(new Set());
  const blocksRef = useRef<Block[]>([]);
  blocksRef.current = blocks;

  // ── Undo effects (reálná implementace injektovaná do command builderů) ──
  const undoEffectsRef = useRef<UndoEffects>(null as unknown as UndoEffects);
  undoEffectsRef.current = {
    applyUndo: async (req) => {
      const r = await fetch("/api/blocks/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as { error?: string; code?: string };
        const err = new Error(e.error ?? "Chyba serveru");
        // `.code` (např. "CONFLICT" = někdo blok mezitím změnil) se sem přilepí a
        // useUndoManager.ts ho čte (`isStale`) — CONFLICT dostane stejné zacházení
        // jako StaleUndoError, hláška z `e.error` doputuje do toastu.
        (err as Error & { code?: string }).code = e.code;
        throw err;
      }
      return r.json();
    },
    addToState: (list) => setBlocks((prev) => {
      const byId = new Map(list.map((b) => [b.id, b]));
      const merged = prev.map((b) => byId.get(b.id) ?? b);
      for (const b of list) if (!prev.some((p) => p.id === b.id)) merged.push(b);
      return merged.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }),
    removeFromState: (ids) => setBlocks((prev) => prev.filter((b) => !ids.includes(b.id))),
    getLiveBlock: (id) => blocksRef.current.find((b) => b.id === id),
  };
  const { record: recordUndo, undo: undoMgr, redo: redoMgr, canUndo: canUndoMgr, canRedo: canRedoMgr } = useUndoManager(undoEffectsRef, showToast);

  const selectedBlockIdsRef = useRef<Set<number>>(new Set());
  selectedBlockIdsRef.current = selectedBlockIds;
  const selectedBlockRef = useRef<Block | null>(null);
  selectedBlockRef.current = selectedBlock;
  const menuDeleteBlockRef = useRef<Block | null>(null);
  menuDeleteBlockRef.current = menuDeleteBlock;
  const editingBlockIdsRef = useRef<Set<number>>(new Set());
  const [sseOffline, setSseOffline] = useState(false);

  useEffect(() => {
    editingBlockIdsRef.current.clear();
    if (editingBlock) {
      editingBlockIdsRef.current.add(editingBlock.id);
    }
  }, [editingBlock]);
  const [isCut, setIsCut] = useState(false);
  const [pasteTarget, setPasteTarget] = useState<{ machine: string; time: Date } | null>(null);
  const copiedBlockRef = useRef<Block | null>(null);
  const isCutRef = useRef(false);
  const pasteTargetRef = useRef<{ machine: string; time: Date } | null>(null);
  copiedBlockRef.current = copiedBlock;
  isCutRef.current = isCut;
  pasteTargetRef.current = pasteTarget;
  const clipboardGroupRef = useRef<Block[]>([]);
  const isGroupCutRef = useRef(false);
  // In-flight guard cut-přesunu — druhé Ctrl+V během běžícího PUT/batch by vystřelilo
  // duplicitní mutaci (2 undo záznamy, souběžné chain-push transakce).
  const cutMoveInFlightRef = useRef(false);
  const [filterText, setFilterText] = useState(initialFilterText ?? "");
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  // Ref pro deep link highlight — zajistí že goToMatch(0) proběhne jen jednou po prvním načtení bloků
  const highlightExecuted = useRef(!initialFilterText);
  const [jumpDate, setJumpDate]     = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setHeaderScrolled(el.scrollTop > 20);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const [daysAhead, setDaysAhead] = useState(60);
  const [daysBack, setDaysBack]   = useState(3);

  // Zoom — kotva pro scroll při změně zoomu
  const [slotHeight, setSlotHeight] = useState<number>(DEFAULT_SLOT_HEIGHT);
  useEffect(() => {
    // TISKAR nemá zoom slider (viz `{!isTiskar && <ZoomSlider …>}` níž) — nemá tedy
    // jak zoom vrátit, kdyby zdědil malou hodnotu ze zařízení. `gridSlotHeight` níž
    // (JEDINÝ vynucovací bod) ho drží na `DEFAULT_SLOT_HEIGHT` bez ohledu na to, co
    // tenhle stav drží — tenhle guard je tu navíc jen proto, aby `slotHeight` u
    // TISKARE zůstal interně konzistentní s tím, co se reálně vykresluje (žádná
    // matoucí hodnota v DevTools), ne proto, že by byl sám o sobě nutný k opravě
    // pasti (task 5c, rozhodnutí majitele 12. 8. 2026 + review) — jednosměrná past
    // nahlášená z produkce (kiosk terminál).
    if (isTiskar) return;
    const z = localStorage.getItem("ig-planner-zoom");
    if (z) setSlotHeight(Math.max(3, Math.min(DEFAULT_SLOT_HEIGHT, Number(z))));
  }, [isTiskar]);

  // Velikost písma — vázaná na ZAŘÍZENÍ, ne na uživatele (viz FontScaleSwitch).
  // Stav se inicializuje na výchozí a localStorage se čte až v useEffect níž:
  // čtení v lazy inicializátoru useState by znamenalo, že server vyrenderuje
  // jinou velikost než klient, a vznikla by chyba hydratace. Krátké přeblesknutí
  // výchozí velikosti při načtení je stejné chování, jaké má dnes zoom.
  const [fontScale, setFontScale] = useState<PlannerFontScale>(DEFAULT_FONT_SCALE);
  useEffect(() => {
    const stored = localStorage.getItem(FONT_SCALE_STORAGE_KEY);
    if (isPlannerFontScale(stored)) setFontScale(stored);
  }, []);
  function handleFontScaleChange(next: PlannerFontScale) {
    captureScrollAnchor();
    setFontScale(next);
    localStorage.setItem(FONT_SCALE_STORAGE_KEY, next);
  }
  const typeScale = useMemo(() => plannerTypeScale(fontScale), [fontScale]);
  // Mřížka roste jen zčásti. VŠECHNA geometrie používá tuhle hodnotu; surový
  // `slotHeight` zůstává jen pro slider a pro uloženou preferenci `zoom`.
  //
  // JEDINÝ vynucovací bod pravidla „TISKAR nemá zoom slider, tedy zoom nedědí" (task 5c
  // review, 12. 8. 2026): dřív ho drželo souběžně TŘI nezávislých hlídačů čtení/zápisu
  // `slotHeight` (localStorage efekt, server-preference efekt, save-preference efekt) —
  // budoucí zdroj zoomu (kolečko myši, „vejít se do dne", kioskový URL parametr), který
  // by zavolal `setSlotHeight` bez vědomí o TISKAŘI, by past tiše vrátil. Ternárka tady
  // je odolná vůči TOMUHLE i budoucím zdrojům současně — nezáleží, ODKUD `slotHeight`
  // dostal špatnou hodnotu, `gridSlotHeight` (jediné, co geometrie/BlockCard skutečně
  // čte) ji pro TISKAŘE vždycky přepíše na `DEFAULT_SLOT_HEIGHT`. Tři efekty výš/níž
  // zůstávají jako druhá, nezávislá vrstva (state hygiena — `slotHeight` u TISKARE
  // reálně zůstává 26, ne jen jeho vykreslení), ne jako jediná obrana.
  const gridSlotHeight = useMemo(
    () => effectiveSlotHeight(isTiskar ? DEFAULT_SLOT_HEIGHT : slotHeight, typeScale),
    [slotHeight, typeScale, isTiskar]
  );

  // Ref pro debounced ukládání preferencí na server
  const prefsSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Cleanup debounce timerů při unmountu komponenty
  useEffect(() => {
    return () => {
      Object.values(prefsSaveTimers.current).forEach(clearTimeout);
    };
  }, []);

  function savePreference(key: string, value: string) {
    // Okamžitě do localStorage (optimistický cache)
    localStorage.setItem(`ig-planner-${key}`, value);
    // Debounced uložení na server
    clearTimeout(prefsSaveTimers.current[key]);
    prefsSaveTimers.current[key] = setTimeout(() => {
      fetch("/api/me/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      }).catch(() => {}); // tiché selhání — localStorage fallback zůstane
    }, 500);
  }

  const zoomAnchorMs = useRef<number | null>(null); // ms od epochy = datum středu viewportu

  // Zachytí datum, na které aktuálně ukazuje střed viewportu, do zoomAnchorMs — MUSÍ se
  // zavolat na začátku každého handleru, který mění gridSlotHeight (zoom slider i stupeň
  // písma — effectiveSlotHeight se odvozuje z obou), jinak useLayoutEffect níž proběhne
  // s prázdnou kotvou a scrollTop v pixelech začne po přepočtu znamenat jiný čas —
  // uživateli ujede pohled (nahlášeno 12.8.2026 u přepínače velikosti písma, kde tahle
  // kotva chyběla úplně).
  function captureScrollAnchor() {
    const el = scrollRef.current;
    if (!el) return;
    const centerY = el.scrollTop + el.clientHeight / 2;
    // yToDate inline: viewStart + (y / gridSlotHeight * 30 min)
    const anchorDate = new Date(viewStart.getTime() + (centerY / gridSlotHeight) * 30 * 60000);
    zoomAnchorMs.current = anchorDate.getTime();
  }

  function handleZoomChange(newHeight: number) {
    captureScrollAnchor();
    setSlotHeight(newHeight);
  }

  useLayoutEffect(() => {
    const anchorMs = zoomAnchorMs.current;
    const el = scrollRef.current;
    if (anchorMs === null || !el) return;
    const newY = dateToY(new Date(anchorMs), viewStart, gridSlotHeight);
    el.scrollTop = newY - el.clientHeight / 2;
    zoomAnchorMs.current = null;
  }, [gridSlotHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Načtení preferencí po mount — nejprve z localStorage (lazy initializers), pak přepíše server
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setFilterText(q);

    // Načtení preferencí ze serveru — přepíše localStorage pokud server má novější data
    fetch("/api/me/preferences")
      .then((r) => r.json())
      .then((prefs: Record<string, string>) => {
        // TISKAR: stejná past jako u localStorage výš — účtová preference by mohla
        // zdědit malý zoom od jiné role na tomtéž zařízení a tiskař ho nemá jak vrátit.
        // Guard tu navíc brání ZÁPISU do (sdíleného, kioskového) `localStorage` —
        // bez něj by se poškozená serverová preference mohla otisknout do zařízení
        // a odsud dál nakazit i JINOU roli, která se na stejném kiosku přihlásí příště.
        if (prefs["zoom"] && !isTiskar) {
          const v = Math.max(3, Math.min(DEFAULT_SLOT_HEIGHT, Number(prefs["zoom"])));
          setSlotHeight(v);
          localStorage.setItem("ig-planner-zoom", String(v));
        }
        if (prefs["aside-width"]) {
          const v = Math.max(200, Math.min(600, Number(prefs["aside-width"])));
          setAsideWidth(v);
          localStorage.setItem("ig-planner-aside-width", String(v));
        }
        if (prefs["dtp-panel-width"]) {
          const v = parseInt(prefs["dtp-panel-width"], 10);
          if (!isNaN(v)) {
            setDtpPanelWidth(v);
            localStorage.setItem("ig-planner-dtp-panel-width", String(v));
          }
        }
      })
      .catch(() => {}); // tiché selhání — localStorage hodnoty z lazy initializerů zůstanou
  }, [isTiskar]);

  // TISKAR zoom nemění (žádný slider), takže by tenhle efekt jen opakovaně zapisoval
  // výchozí hodnotu zpátky do localStorage i na server preferenci — beze smyslu,
  // navíc by to při každém mountu volalo API. Viz past popsaná u efektů výš.
  useEffect(() => { if (!isTiskar) savePreference("zoom", String(slotHeight)); }, [slotHeight, isTiskar]);

  // Resizable aside
  const [asideWidth, setAsideWidth] = useState<number>(320);
  const asideWidthRef = useRef<number>(asideWidth);
  useEffect(() => { asideWidthRef.current = asideWidth; }, [asideWidth]);
  useEffect(() => {
    const w = localStorage.getItem("ig-planner-aside-width");
    if (w) setAsideWidth(Math.max(200, Math.min(600, Number(w))));
  }, []);
  const isResizing = useRef(false);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current) return;
      const newWidth = window.innerWidth - e.clientX;
      setAsideWidth(Math.min(600, Math.max(200, newWidth)));
    }
    function onMouseUp() {
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      savePreference("aside-width", String(asideWidthRef.current)); // uložit až po resize
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // ── DTP Panel state ──
  const [dtpPanelWidth, setDtpPanelWidth] = useState<number>(260);
  useEffect(() => {
    const w = localStorage.getItem("ig-planner-dtp-panel-width");
    if (w) setDtpPanelWidth(parseInt(w, 10));
  }, []);
  const [showDtpPanel, setShowDtpPanel] = useState<boolean>(
    () => currentUser.role === "DTP"
  );

  const [dtpPopover, setDtpPopover] = useState<{
    blockId: number;
    statusId: number | null;
    rect: DOMRect;
  } | null>(null);

  // dtp-panel-width se ukládá pouze při onWidthCommit (mouseUp), ne při každém mousemove

  // Refresh MachineWeekShifts při návratu do okna —
  // zajišťuje, že klientský snap používá aktuální data i po změně v jiné relaci
  const refetchWeekShifts = useCallback(async () => {
    try {
      const res = await fetch("/api/machine-week-shifts");
      if (res.ok) setMachineWeekShifts(await res.json());
    } catch (e) { console.debug("[schedule refresh]", e); }
  }, []);

  useEffect(() => {
    window.addEventListener("focus", refetchWeekShifts);
    window.addEventListener("machineScheduleUpdated", refetchWeekShifts);
    return () => {
      window.removeEventListener("focus", refetchWeekShifts);
      window.removeEventListener("machineScheduleUpdated", refetchWeekShifts);
    };
  }, [refetchWeekShifts]);

  // ── Shift-edge handle commit (Sprint F) ─────────────────────────────────
  const updateShiftBounds = useCallback(
    async (
      machine: string,
      date: Date,
      shift: "MORNING" | "AFTERNOON" | "NIGHT",
      edge: "start" | "end",
      newMin: number | null,
      joint: boolean = false,
    ) => {
      const { dateStr, dayOfWeek } = pragueOf(date);
      const weekStart = weekStartStrFromDateStr(dateStr);
      const current = machineWeekShifts.filter((r) => r.machine === machine && r.weekStart === weekStart);
      const byDow = new Map(current.map((r) => [r.dayOfWeek, r]));
      const fieldName = (s: "MORNING" | "AFTERNOON" | "NIGHT", ed: "start" | "end") => {
        const prefix = s === "MORNING" ? "morning" : s === "AFTERNOON" ? "afternoon" : "night";
        return ed === "start" ? `${prefix}StartMin` : `${prefix}EndMin`;
      };
      const days: ShiftDayPayload[] = [];
      for (let dow = 0; dow < 7; dow++) {
        const r = byDow.get(dow);
        const base: ShiftDayPayload = {
          dayOfWeek: dow,
          isActive: r?.isActive ?? false,
          morningOn: r?.morningOn ?? false,
          afternoonOn: r?.afternoonOn ?? false,
          nightOn: r?.nightOn ?? false,
          morningStartMin: r?.morningStartMin ?? null,
          morningEndMin: r?.morningEndMin ?? null,
          afternoonStartMin: r?.afternoonStartMin ?? null,
          afternoonEndMin: r?.afternoonEndMin ?? null,
          nightStartMin: r?.nightStartMin ?? null,
          nightEndMin: r?.nightEndMin ?? null,
        };
        if (dow === dayOfWeek) {
          (base as unknown as Record<string, number | null>)[fieldName(shift, edge)] = newMin;
          if (joint) {
            // MORNING end shared with AFTERNOON start — update both
            if (shift === "MORNING" && edge === "end") base.afternoonStartMin = newMin;
            if (shift === "AFTERNOON" && edge === "start") base.morningEndMin = newMin;
          }
        }
        days.push(base);
      }
      const payload = { machine, weekStart, days };
      try {
        const res = await fetch("/api/machine-week-shifts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.status === 409) {
          const data = await res.json().catch(() => ({}));
          if (data?.error === "SHIFT_SHRINK_CASCADE" && Array.isArray(data.conflictingBlocks)) {
            setPlannerCascade({
              conflicts: data.conflictingBlocks,
              longerCount: Array.isArray(data.longerBlocks) ? data.longerBlocks.length : 0,
              pendingPayload: payload,
            });
            return;
          }
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          showToast(body.error ?? "Chyba úpravy pracovní doby", "error");
          return;
        }
        // Server vrací obálku { rows, longerBlocks } (Fix round 1) — rows pro tento
        // week+machine zmergujeme do state, longerBlocks jen informuje o blocích,
        // kterým se konec PRODLOUŽIL (nevystěhovaly se, takže 409 nenastala).
        const body = (await res.json().catch(() => null)) as
          | { rows?: MachineWeekShiftsRow[]; longerBlocks?: CascadeBlock[] }
          | null;
        if (body?.rows && Array.isArray(body.rows)) {
          const updatedRows = body.rows;
          setMachineWeekShifts((prev) => {
            const without = prev.filter((r) => !(r.machine === machine && r.weekStart === weekStart));
            return [...without, ...updatedRows];
          });
        }
        if (Array.isArray(body?.longerBlocks) && body.longerBlocks.length > 0) {
          showToast(
            `U ${body.longerBlocks.length} zakázek se prodloužil spočítaný konec — jejich příští úprava odsune navazující zakázky. Zkontroluj je v plánu.`,
            "info",
          );
        }
      } catch (err) {
        console.error("[updateShiftBounds] failed", err);
        showToast("Chyba úpravy pracovní doby", "error");
      }
    },
    [machineWeekShifts, refetchWeekShifts, showToast],
  );

  // Sdílený merge serverových bloků do lokálního state — vzor SSE `block:batch-updated`
  // (viz handleSSEEvent níže). Používá se jak pro SSE listener, tak pro lokální aplikaci
  // response z reflow fetchů (mutující klient SSE událost sám od sebe nedostane — server
  // ji záměrně nedoručuje původci, viz `src/app/api/events/route.ts`). NIKDY nepřidává
  // bloky (jen map přes prev, žádný concat) — ochrana proti fantomu smazaného bloku.
  // editingBlockIdsRef guard chrání rozeditovaný blok. setSelectedBlock sync je KRITICKÝ:
  // BlockDetail počítá calendarDrift ze selectedBlock, bez tohoto řádku by drift sekce
  // v otevřeném detailu po přepočtu nezmizela.
  const applyServerBlocks = useCallback((serverBlocks: Block[]) => {
    const serverMap = new Map(serverBlocks.map((b) => [b.id, b]));
    setBlocks((prev) =>
      prev.map((b) => {
        if (editingBlockIdsRef.current.has(b.id)) return b;
        return serverMap.get(b.id) ?? b;
      })
    );
    setSelectedBlock((sel) => (sel ? (serverMap.get(sel.id) ?? sel) : sel));
  }, []);

  // ── SSE real-time sync ─────────────────────────────────────────────────
  const handleSSEEvent = useCallback((msg: SSEMessage) => {
    const { type, payload } = msg;

    if (type === "block:updated" || type === "block:print-completed" || type === "block:expedition-changed") {
      const serverBlock = payload.block as Block;
      if (!serverBlock?.id) return;

      // Ochrana editovaných / dragovaných bloků
      if (editingBlockIdsRef.current.has(serverBlock.id)) {
        showToast(`Blok ${serverBlock.orderNumber ?? serverBlock.id} byl změněn jiným uživatelem.`, "info");
        return;
      }

      setBlocks((prev) => prev.map((b) => b.id === serverBlock.id ? serverBlock : b));
      setSelectedBlock((sel) => sel?.id === serverBlock.id ? serverBlock : sel);
    }

    if (type === "block:created") {
      const serverBlock = payload.block as Block;
      if (!serverBlock?.id) return;
      setBlocks((prev) => {
        if (prev.some((b) => b.id === serverBlock.id)) return prev;
        return [...prev, serverBlock];
      });
    }

    if (type === "block:deleted") {
      const blockId = payload.blockId as number;
      setBlocks((prev) => prev.filter((b) => b.id !== blockId));
      setSelectedBlock((sel) => sel?.id === blockId ? null : sel);
      // Vyčistit multi-select, pokud obsahoval smazaný blok
      setSelectedBlockIds((prev) => {
        if (!prev.has(blockId)) return prev;
        const next = new Set(prev);
        next.delete(blockId);
        return next;
      });
      // Vyčistit clipboard, pokud zdrojový blok byl smazán (jinak by paste vytvořil fantom)
      if (copiedBlockRef.current?.id === blockId) {
        setCopiedBlock(null);
        setIsCut(false);
        setPasteTarget(null);
        showToast("Zkopírovaný blok byl smazán, clipboard vyčištěn.", "info");
      }
      if (clipboardGroupRef.current.some((b) => b.id === blockId)) {
        const remaining = clipboardGroupRef.current.filter((b) => b.id !== blockId);
        clipboardGroupRef.current = remaining;
        if (remaining.length === 0) {
          setPasteTarget(null);
          isGroupCutRef.current = false;
          showToast("Všechny bloky ze skupiny byly smazány, clipboard vyčištěn.", "info");
        } else {
          const newTarget = computePasteTargetFromGroup(remaining);
          if (newTarget) setPasteTarget(newTarget);
          showToast(`Ze skupiny byl smazán blok, zbývá ${remaining.length}.`, "info");
        }
      }
    }

    if (type === "block:batch-updated") {
      const serverBlocks = payload.blocks as Block[];
      if (!Array.isArray(serverBlocks)) return;
      applyServerBlocks(serverBlocks);
    }

    if (type === "block:note-created") {
      const blockId = payload.blockId as number;
      const note = payload.note as SerializedBlockNote;
      if (!blockId || !note) return;
      setBlocks((prev) => prev.map((b) =>
        b.id === blockId
          ? { ...b, notes: [note, ...(b.notes ?? []).filter((n) => n.id !== note.id)] }
          : b
      ));
    }

    if (type === "block:note-updated") {
      const blockId = payload.blockId as number;
      const note = payload.note as SerializedBlockNote;
      if (!blockId || !note) return;
      setBlocks((prev) => prev.map((b) =>
        b.id === blockId
          ? { ...b, notes: (b.notes ?? []).map((n) => n.id === note.id ? note : n) }
          : b
      ));
    }

    if (type === "block:note-deleted") {
      const blockId = payload.blockId as number;
      const noteId = payload.noteId as number;
      if (!blockId || !noteId) return;
      setBlocks((prev) => prev.map((b) =>
        b.id === blockId ? { ...b, notes: (b.notes ?? []).filter((n) => n.id !== noteId) } : b
      ));
    }

    if (type === "schedule:changed") {
      // Refresh MachineWeekShifts
      fetch("/api/machine-week-shifts")
        .then((r) => r.ok ? r.json() : null)
        .then((shifts) => { if (shifts) setMachineWeekShifts(shifts); })
        .catch(() => {});
      // Refresh CompanyDays — company-days mutace (POST/PUT/DELETE) taky emitují schedule:changed,
      // bez tohoto refetche zůstávají u ostatních klientů stale companyDays → drift štítky lžou do reloadu.
      fetch("/api/company-days")
        .then((r) => r.ok ? r.json() : null)
        .then((days) => { if (days) setCompanyDays(days); })
        .catch(() => {});
    }
  }, [showToast, applyServerBlocks]);

  const handleSSEReconnect = useCallback(() => {
    // Po reconnectu: full fetch bloků. Na rozdíl od pollBlocks (5min fallback merge nad prev,
    // který nikdy nic neodstraňuje) je fresh tady AUTORITATIVNÍ seznam — během výpadku SSE
    // mohl klient zmeškat block:deleted eventy, takže bloky chybějící ve fresh MUSÍ zmizet,
    // jinak by v UI zůstaly navždy jako duchové (proto se staví nad freshBlocks.map, ne
    // prev.map jako pollBlocks). editingBlockIdsRef guard chrání OBSAH rozeditovaného bloku
    // stejně jako pollBlocks's mergeFromServer (lokální rozpracovaná verze se nepřepíše server
    // verzí) — pokud je ale blok smazaný na serveru (chybí ve fresh), guard existenci nezachrání,
    // stejně jako to řeší SSE block:deleted handler výše (zavře selectedBlock/editingBlock).
    fetch("/api/blocks")
      .then((r) => r.ok ? r.json() : null)
      .then((freshBlocks: Block[] | null) => {
        if (!freshBlocks) return;
        const freshById = new Map(freshBlocks.map((block) => [block.id, block]));
        setBlocks((prev) => {
          const prevById = new Map(prev.map((block) => [block.id, block]));
          return freshBlocks.map((f) => {
            if (editingBlockIdsRef.current.has(f.id)) return prevById.get(f.id) ?? f;
            return f;
          });
        });
        setSelectedBlock((sel) => {
          if (!sel) return sel;
          if (editingBlockIdsRef.current.has(sel.id) && freshById.has(sel.id)) return sel;
          return freshById.get(sel.id) ?? null;
        });
        setEditingBlock((eb) => {
          if (!eb) return eb;
          if (editingBlockIdsRef.current.has(eb.id) && freshById.has(eb.id)) return eb;
          return freshById.get(eb.id) ?? null;
        });
      })
      .catch(() => {});
  }, []);

  const { getSecondsSinceLastHeartbeat } = useSSE({
    onEvent: handleSSEEvent,
    onReconnect: handleSSEReconnect,
  });

  // Offline banner — check heartbeat každých 10s
  useEffect(() => {
    const interval = setInterval(() => {
      const seconds = getSecondsSinceLastHeartbeat();
      setSseOffline(seconds > 60);
    }, 10_000);
    return () => clearInterval(interval);
  }, [getSecondsSinceLastHeartbeat]);

  // Polling bloků každých 300 s (5 min fallback) — full merge s ochranou editovaných bloků
  useEffect(() => {
    const pollBlocks = async () => {
      try {
        const res = await fetch("/api/blocks");
        if (!res.ok) return;
        const fresh: Block[] = await res.json();
        const freshById = new Map(fresh.map((block) => [block.id, block]));
        const mergeFromServer = (b: Block): Block => {
          const f = freshById.get(b.id);
          if (!f) return b;
          // Chránit editované bloky
          if (editingBlockIdsRef.current.has(b.id)) return b;
          // Porovnat updatedAt — pokud server novější, nahradit
          if (f.updatedAt !== b.updatedAt) return f;
          return b;
        };
        setBlocks((prev) => {
          let changed = false;
          const next = prev.map((block) => {
            const merged = mergeFromServer(block);
            if (merged !== block) changed = true;
            return merged;
          });
          return changed ? next : prev;
        });
        setSelectedBlock((sel) => sel ? mergeFromServer(sel) : null);
        setEditingBlock((eb) => eb ? mergeFromServer(eb) : null);
      } catch {
        // tiché selhání — zachovat aktuální stav
      }
    };
    const t = setInterval(pollBlocks, 300_000);
    return () => clearInterval(t);
  }, []);

  // Potvrzení / vrácení tisku (pro roli TISKAR z BlockCard)
  async function handlePrintComplete(blockId: number, completed: boolean) {
    const optimistic = (b: Block): Block =>
      b.id === blockId
        ? { ...b, printCompletedAt: completed ? new Date().toISOString() : null, printCompletedByUserId: completed ? currentUser.id : null, printCompletedByUsername: completed ? currentUser.username : null }
        : b;
    setBlocks((prev) => prev.map(optimistic));
    setSelectedBlock((sel) => sel ? optimistic(sel) : null);
    try {
      const res = await fetch(`/api/blocks/${blockId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
      });
      if (!res.ok) {
        // revert — znovu načíst + říct uživateli proč (dřív tichý revert)
        const err = await res.json().catch(() => ({})) as { error?: string };
        showToast(err.error ?? "Potvrzení tisku se nepodařilo uložit.", "error");
        // .catch: selhání refetche nesmí propadnout do vnějšího catch a vyvolat
        // druhý toast + druhý fetch (review F4 #7).
        const r = await fetch("/api/blocks").catch(() => null);
        if (r?.ok) { const fresh: Block[] = await r.json(); setBlocks(fresh); }
      } else {
        const updated: Block = await res.json();
        setBlocks((prev) => prev.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)));
      }
    } catch (e) {
      console.error("Print complete failed", e);
      showToast("Potvrzení tisku se nepodařilo uložit.", "error");
      // Revert i při síťové výjimce — jinak UI ukazuje potvrzený tisk,
      // který v DB není, až do dalšího pollu (audit REL-05).
      try {
        const r = await fetch("/api/blocks");
        if (r.ok) { const fresh: Block[] = await r.json(); setBlocks(fresh); }
      } catch { /* offline — srovná SSE reconnect / poll */ }
    }
  }

  function handleNotifTabChange(tab: NotifTab) {
    setNotifTab(tab);
    if (tab === "activity") {
      notif.fetchAudit();
      notif.markAuditSeen();
    }
  }

  function openNotifPanel() {
    setShowNotifPanel(true);
    setNotifTab("inbox");
    notif.fetchNotifications();
  }

  function handleJumpToBlock(orderNumber: string) {
    setShowNotifPanel(false);
    setFilterText(orderNumber);
    const match = blocks.find((b) => b.orderNumber === orderNumber);
    if (match) setSelectedBlock(match);
  }

  function handleDtpScrollToBlock(block: Block) {
    const blockTime = new Date(block.startTime);
    if (blockTime < viewStart) {
      // Blok je před viewStart — rozšíř daysBack a scrollni po re-renderu
      const diffDays = diffCivilDateDays(utcToPragueDateStr(blockTime), todayPragueDateStr());
      pendingScrollMs.current = blockTime.getTime();
      pendingSelectBlock.current = block;
      setDaysBack(Math.max(3, diffDays + 5));
    } else {
      const diffDays = diffCivilDateDays(utcToPragueDateStr(blockTime), todayPragueDateStr());
      if (diffDays < -daysAhead) {
        // Blok je za viewEnd — rozšíř daysAhead a scrollni po re-renderu
        pendingScrollMs.current = blockTime.getTime();
        pendingSelectBlock.current = block;
        setDaysAhead(-diffDays + 5);
      } else {
        // Blok je v aktuálním rozsahu — scrollni přímo
        const y = dateToY(blockTime, viewStart, gridSlotHeight);
        scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
        setSelectedBlock(block);
      }
    }
  }

  async function handleCreateNote(blockId: number, text: string) {
    const r = await fetch(`/api/blocks/${blockId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      showToast(j.error ?? "Nepodařilo se uložit poznámku", "error");
      return;
    }
    const note = (await r.json()) as SerializedBlockNote;
    setBlocks((prev) => prev.map((b) =>
      b.id === blockId ? { ...b, notes: [note, ...(b.notes ?? [])] } : b
    ));
  }

  async function handleUpdateNote(blockId: number, noteId: number, text: string) {
    const r = await fetch(`/api/blocks/${blockId}/notes/${noteId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      showToast(j.error ?? "Nepodařilo se upravit poznámku", "error");
      return;
    }
    const note = (await r.json()) as SerializedBlockNote;
    setBlocks((prev) => prev.map((b) =>
      b.id === blockId
        ? { ...b, notes: (b.notes ?? []).map((n) => n.id === noteId ? note : n) }
        : b
    ));
  }

  async function handleDeleteNote(blockId: number, noteId: number) {
    const r = await fetch(`/api/blocks/${blockId}/notes/${noteId}`, { method: "DELETE" });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      showToast(j.error ?? "Nepodařilo se smazat poznámku", "error");
      return;
    }
    setBlocks((prev) => prev.map((b) =>
      b.id === blockId
        ? { ...b, notes: (b.notes ?? []).filter((n) => n.id !== noteId) }
        : b
    ));
  }

  async function handleNotify(blockId: number, orderNumber: string) {
    const r = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockId, blockOrderNumber: orderNumber }),
    });
    if (r.ok) showToast("Upozornění odesláno pro MTZ + DTP", "success");
    else showToast("Chyba při odesílání upozornění", "error");
  }

  async function handleMarkRead(notifId: number) {
    const ok = await notif.markRead(notifId);
    if (!ok) showToast("Nepodařilo se označit jako přečtené", "error");
  }

  const effectiveDaysBack = viewDaysBack(isTiskar, daysBack);
  const viewStart = pragueToUTC(addDaysToCivilDate(todayPragueDateStr(), -effectiveDaysBack), 0, 0);

  // "Přejít na" blok mimo rozsah — ref pro čekající scroll + výběr bloku po změně daysBack/daysAhead
  const pendingScrollMs = useRef<number | null>(null);
  const pendingSelectBlock = useRef<Block | null>(null);
  useLayoutEffect(() => {
    const target = pendingScrollMs.current;
    if (target === null) return;
    pendingScrollMs.current = null;
    // effectiveDaysBack (ne "holý" daysBack) — u TISKAŘE je pevný
    // (TISKAR_DAYS_BACK) bez ohledu na daysBack state, přesně jako viewStart
    // výš; jinak by se cíl scrollu počítal vůči jinému řádku 0, než jaký ve
    // skutečnosti kreslí TimelineGrid.
    const newViewStart = pragueToUTC(addDaysToCivilDate(todayPragueDateStr(), -effectiveDaysBack), 0, 0);
    const y = dateToY(new Date(target), newViewStart, gridSlotHeight);
    scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
    if (pendingSelectBlock.current) {
      setSelectedBlock(pendingSelectBlock.current);
      pendingSelectBlock.current = null;
    }
    // tiskarView v deps: přechod z Monitoru (kde TimelineGrid není mountnutá,
    // scrollRef.current je null) do plánu musí doscrollovat AŽ PO mountu,
    // ne synchronně v handleru — batchovaný setTiskarView("plan") by scroll
    // jinak tiše zahodil (nález I3/I4).
  }, [daysBack, daysAhead, tiskarView]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleJumpToOutOfRange(block: Block) {
    const diffDays = diffCivilDateDays(utcToPragueDateStr(new Date(block.startTime)), todayPragueDateStr());
    pendingScrollMs.current = new Date(block.startTime).getTime();
    setDaysBack(Math.max(3, diffDays + 5));
  }

  // Skok do PLÁNU na konkrétní blok: přepne pohled, případně stroj, vybere blok
  // a doscrolluje na něj (přes odložený mechanismus handleJumpToOutOfRange výše).
  //
  // Volající v `onSelect` u OrderSearchSheet (review 13. 8. 2026, nález 2):
  // vždy ne-ZAKAZKA (rezervace a údržba z vyhledávání — tiskař je neodklepává,
  // `resolveSelectedBlock` je na kartu nepustí) a ZAKAZKA JEN tehdy, když je
  // tiskař už v plánu a blok leží v zobrazeném rozsahu (`staysInVisiblePlan`) —
  // tam funguje, protože TimelineGrid blok reálně vykreslí. Mimo tenhle případ
  // ZAKAZKA míří na velkou kartu Monitoru: tiskař má rozsah plánu napevno
  // 1 den zpět, TimelineGrid blok mimo rozsah vůbec nevykreslí a BlockDetail
  // je za canEdit — skok sem by byl slepá ulička.
  function jumpToBlockFromMonitor(block: Block) {
    setTiskarView("plan");
    if (block.machine !== viewMachine) setViewMachine(block.machine);
    setSelectedBlock(block);
    if (new Date(block.startTime) < viewStart) {
      handleJumpToOutOfRange(block);
    } else if (scrollRef.current) {
      // Timeline je už namontovaná (voláno z už otevřeného plánu, ne z Monitoru)
      // — tiskarView zůstává "plan" beze změny, takže by se pendingScrollMs efekt
      // vůbec nespustil. Scrollujeme rovnou, jako to dělal původní kód, a
      // pendingScrollMs pro jistotu vynulujeme, ať ho efekt nezpracuje podruhé.
      pendingScrollMs.current = null;
      const y = dateToY(new Date(block.startTime), viewStart, gridSlotHeight);
      scrollRef.current.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
    } else {
      // Voláno z Monitoru — timeline se teprve mountuje, doscrolluje ji
      // useLayoutEffect výš, jakmile naskočí tiskarView === "plan".
      pendingScrollMs.current = new Date(block.startTime).getTime();
    }
  }

  const handleSplitChipClick = useCallback((partnerId: number) => {
    const partner = blocks.find(b => b.id === partnerId);
    if (!partner) return;
    // Přepne tiskaři viewMachine na partner.machine — TimelineGrid se přerenderuje
    // na druhý stroj a vybere partnera. Scroll position scrollRefu se zachovává.
    setViewMachine(partner.machine);
    setSelectedBlock(partner);
    if (new Date(partner.startTime) < viewStart) {
      handleJumpToOutOfRange(partner);
    } else {
      const y = dateToY(new Date(partner.startTime), viewStart, gridSlotHeight);
      scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
    }
  }, [blocks, viewStart, gridSlotHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Všechny bloky odpovídající hledání, seřazené podle startTime
  const searchMatches = filterText.trim()
    ? blocks
        .filter(b => blockMatchesQuery(b, filterText))
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    : [];

  function goToMatch(idx: number) {
    const block = searchMatches[idx];
    const blockTime = new Date(block.startTime);
    if (blockTime < viewStart) {
      // Blok je v historii za viewStart — rozšíř daysBack, blok se vybere po re-renderu
      pendingSelectBlock.current = block;
      handleJumpToOutOfRange(block);
    } else {
      const diffDays = diffCivilDateDays(utcToPragueDateStr(blockTime), todayPragueDateStr());
      if (diffDays < -daysAhead) {
        // Blok je v budoucnosti za viewEnd — rozšíř daysAhead, blok se vybere po re-renderu
        pendingScrollMs.current = blockTime.getTime();
        pendingSelectBlock.current = block;
        setDaysAhead(-diffDays + 5);
      } else {
        const y = dateToY(blockTime, viewStart, gridSlotHeight);
        scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
        setSelectedBlock(block);
      }
    }
  }

  // Deep link /?highlight=X — auto-otevřít první shodu po inicializaci
  useEffect(() => {
    if (highlightExecuted.current || searchMatches.length === 0) return;
    highlightExecuted.current = true;
    goToMatch(0);
  // goToMatch závisí na searchMatches — spustit jakmile jsou k dispozici
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchMatches]);

  // Zrušení hledání — jediné místo pravdy. Volá se z křížku v poli, z Esc
  // (jak z pole přes `SearchField`, tak z globální obsluhy kláves) a z kliknutí
  // kamkoliv do mřížky plánu (`onPlanClick`).
  //
  // ZRUŠENÍ VÝBĚRU BLOKU SEM NEPATŘÍ a nepřidávat ho zpátky. Od chvíle, kdy se
  // spouštěč rozšířil z „klik do prázdna" na „klik KAMKOLIV do mřížky, i na blok"
  // (13. 8. 2026), by `setSelectedBlock(null)` zabilo výběr, který o krok dřív
  // vyrobil `onBlockClick` téhož kliku — obě aktualizace jsou v jednom Reactím
  // dávkování a vyhrála by ta pozdější. Detail bloku pak nešel otevřít VŮBEC
  // (nasazeno na produkci 13.–17. 8. 2026, nahlásil Vojta).
  // Deselekt si dnes dělá každý spouštěč sám, protože každý ho chce jinak:
  // `onGridClickEmpty` (klik do prázdna) ano, Esc („zruš vše") ano, křížek
  // v hledacím poli NE — ten má vyčistit dotaz, ne zavřít otevřenou zakázku.
  function clearSearch() {
    setFilterText("");
    setSearchMatchIndex(0);
  }

  function goToNextMatch() {
    if (!filterText.trim() || searchMatches.length === 0) return;
    const N = searchMatches.length;
    const idx = searchMatchIndex % N;
    goToMatch(idx);
    setSearchMatchIndex(idx + 1);
  }

  function goToPrevMatch() {
    if (!filterText.trim() || searchMatches.length === 0) return;
    const N = searchMatches.length;
    const idx = searchMatchIndex === 0 ? N - 1 : (searchMatchIndex - 2 + N) % N;
    goToMatch(idx);
    setSearchMatchIndex(idx + 1);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function handleScrollToNow() {
    const y = dateToY(new Date(), viewStart, gridSlotHeight);
    scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
  }

  function handleJumpToDate(dateStr: string) {
    const normalized = normalizeCivilDateInput(dateStr);
    if (!normalized) return;
    const d = pragueToUTC(normalized, 0, 0);
    const diffDays = diffCivilDateDays(normalized, todayPragueDateStr());
    if (diffDays > daysBack) {
      // Datum je před aktuálním viewStart — rozšíř historii, pak scrollni
      pendingScrollMs.current = d.getTime();
      setDaysBack(diffDays + 3);
    } else if (diffDays < -daysAhead) {
      // Datum je za aktuálním viewEnd — rozšíř budoucnost, pak scrollni
      pendingScrollMs.current = d.getTime();
      setDaysAhead(-diffDays + 3);
    } else {
      const y = dateToY(d, viewStart, gridSlotHeight);
      scrollRef.current?.scrollTo({ top: Math.max(0, y - 100), behavior: "smooth" });
    }
  }

  // Automaticky vyřeší jakýkoli překryv po přesunu/resize bloku:
  //  1. Překryv dozadu (přesunutý blok narazí na předchozí) → snap dopředu
  //  2. Překryv dopředu → auto-push navazující bloky
  // excludeIds = bloky které mají být při kontrole přeskočeny (přesouvané bloky ve skupině)
  async function handleBlockUpdate(updated: Block, addToHistory = false) {
    if (typeof updated.id !== "number") return; // Guard against API error responses
    // PUT s resolveChain vrací v poli `shifted` navazující bloky odsunuté serverem (chain push).
    const shifted = ((updated as Block & { shifted?: Block[] }).shifted ?? []).filter((s) => typeof s.id === "number");
    // #9/#12: serveroví split sourozenci po propagaci shared fields (nesou čerstvý updatedAt).
    const siblings = ((updated as Block & { siblings?: Block[] }).siblings ?? []).filter((s) => typeof s.id === "number");
    const cleanUpdated = { ...updated } as Block & { shifted?: Block[]; siblings?: Block[] };
    delete cleanUpdated.shifted;
    delete cleanUpdated.siblings;

    const prev = blocksRef.current.find(b => b.id === updated.id);
    // Staré pozice posunutých bloků pro undo — sebrat PŘED aplikací do stavu.
    const shiftedOld = shifted
      .map((s) => blocksRef.current.find((b) => b.id === s.id))
      .filter((b): b is Block => b != null);
    // Sourozenci ze split skupiny PŘED aplikací odpovědi — undo je musí vrátit
    // adresně, protože atomický endpoint SPLIT_SHARED_FIELDS nepropaguje. `siblingsOld`
    // je filtrovaný na to, co reálně existuje v blocksRef.current (server může poslat
    // sourozence, který klient lokálně nemá) — `buildSplitEditTargets` níž si sám
    // spočítá průnik se `siblings`, takže tahle případná asymetrie nikdy nerozjede
    // beforeTargets/afterTargets na různou délku (review Tasku 7, nález M3).
    const siblingsOld = siblings
      .map((s) => blocksRef.current.find((b) => b.id === s.id))
      .filter((b): b is Block => b != null);

    setBlocks((arr) => arr.map((b) => {
      if (b.id === cleanUpdated.id) return cleanUpdated;
      const sh = shifted.find((s) => s.id === b.id);
      return sh ?? b;
    }));
    setSelectedBlock((sel) => {
      if (!sel) return sel;
      if (sel.id === cleanUpdated.id) return cleanUpdated;
      return shifted.find((s) => s.id === sel.id) ?? sel;
    });
    // Chain push mohl odsunout PRÁVĚ EDITOVANÝ blok — bez převzetí z `shifted`
    // by v panelu zůstal starý updatedAt (falešný 409 „uložil jiný uživatel"
    // a ztráta rozepsané editace) i starý startTime (chybný dopočet endTime
    // u ne-ZAKAZKA bloků). Review F4 #1.
    setEditingBlock((eb) => {
      if (!eb) return eb;
      if (eb.id === cleanUpdated.id) return cleanUpdated;
      return shifted.find((s) => s.id === eb.id) ?? eb;
    });
    // Odsunutí navazujících bloků nesmí proběhnout tiše (od 31. 7. 2026 se
    // odsouvají i rezervace a údržba — rozsah může být větší, než uživatel čeká).
    if (shifted.length > 0) {
      showToast(`Posunuto ${shifted.length} navazujících bloků — zkontroluj timeline.`, "info");
    }
    // Lokální propagace sdílených polí do split sourozenců
    if (cleanUpdated.splitGroupId != null) {
      const patch: Partial<Block> = {};
      for (const f of SPLIT_SHARED_FIELDS) {
        (patch as Record<string, unknown>)[f] = (cleanUpdated as Record<string, unknown>)[f];
      }
      // Pokud se type mění na non-ZAKAZKA, normalizovat blockVariant na STANDARD
      if (patch.type && patch.type !== "ZAKAZKA") patch.blockVariant = "STANDARD";
      setBlocks(prev => prev.map(b =>
        b.id !== cleanUpdated.id &&
        b.splitGroupId === cleanUpdated.splitGroupId
          ? { ...b, ...patch }
          : b
      ));
    }
    // #9/#12: serveroví sourozenci jsou autoritativní (nesou čerstvý updatedAt) — aplikovat PO
    // lokální patch-propagaci, aby další split sourozence neposlal stale expectedUpdatedAt (409).
    if (siblings.length > 0) {
      setBlocks((arr) => arr.map((b) => siblings.find((s) => s.id === b.id) ?? b));
      setSelectedBlock((sel) => (sel ? siblings.find((s) => s.id === sel.id) ?? sel : sel));
    }
    if (prev && addToHistory) {
      // printMinutes i scheduleBypassed v obou snapshotech: endpoint nic nederivuje, takže
      // poziční zápis (mutationCmd, nebo sloučená kotva u polní editace níž) je posílá na
      // server doslova — bez nich by po undo/redo zůstal blok se spanem neodpovídajícím
      // tiskovým minutám, nebo s bypass příznakem nesedícím na vrácenou geometrii
      // (Task 6, Step 3b + fix round 1).
      const prevSnap = { id: prev.id, startTime: prev.startTime as string, endTime: prev.endTime as string, machine: prev.machine, updatedAt: (prev as Block).updatedAt, printMinutes: (prev as Block).printMinutes ?? null, scheduleBypassed: (prev as Block).scheduleBypassed ?? false };
      const updatedSnap = { id: cleanUpdated.id, startTime: cleanUpdated.startTime as string, endTime: cleanUpdated.endTime as string, machine: cleanUpdated.machine, updatedAt: cleanUpdated.updatedAt, printMinutes: cleanUpdated.printMinutes ?? null, scheduleBypassed: cleanUpdated.scheduleBypassed ?? false };
      // JEDNA uživatelova akce = JEDEN krok historie (etapa A, atomické undo — oprava dvojího
      // zápisu). Dřív se sem zapisovaly DVA nezávislé kroky (mutationCmd + buildMultiEditCommand
      // níž), oba nesoucí TYTÉŽ odsunuté sousedy (chain push) — první Ctrl+Z jim zvedl
      // updatedAt, druhý na ně narazil se zastaralým snapshotem a shodil StaleUndoError, i když
      // ve skutečnosti krok historie rozbil náš vlastní první Ctrl+Z. changedFields se proto
      // počítá PŘED mutationCmd: když se změnila i business pole, mutationCmd se vůbec
      // nezapisuje — pozice kotvy se slije přímo do jejího cíle (mergeAnchorPositionIfChanged
      // níž), takže zbyde jediný krok historie.
      const changedFields = EDIT_TRACKED_FIELDS.filter(
        (f) => JSON.stringify((prev as Record<string, unknown>)[f]) !== JSON.stringify((cleanUpdated as Record<string, unknown>)[f]),
      );
      if (changedFields.length > 0) {
        const toSnap = (b: Block): BlockSnapshot => ({ id: b.id, startTime: b.startTime as string, endTime: b.endTime as string, machine: b.machine, updatedAt: b.updatedAt, printMinutes: b.printMinutes ?? null, scheduleBypassed: b.scheduleBypassed ?? false });
        const shiftedBefore = shiftedOld.map(toSnap);
        const shiftedAfter = shifted.map(toSnap);
        // C1c (go/no-go audit 5. 8. 2026): chain push vyloučí odsunutého split sourozence ze
        // `siblings` (server, [id]/route.ts — „Vyloučit sourozence, kteří už jsou v shifted",
        // aby neposlal dvojitou SSE událost pro týž blok). buildSplitEditTargets by ho tak
        // nikdy neviděl a nedostal by SPLIT_SHARED_FIELDS — hledat ho MUSÍME i mezi `shifted`:
        // server ho tam pošle už s hodnotami PO propagaci (refetch běží až po ní, v jedné
        // transakci). Typický spouštěč: editace typu na split hlavě → re-expanze → ocas
        // odsunut → ocas mimo `siblings` → Ctrl+Z vrátí hlavě typ, ocas zůstane překlopený.
        const shiftedSplitSiblingIds = new Set(
          shifted.filter((s) => s.splitGroupId != null && s.splitGroupId === cleanUpdated.splitGroupId).map((s) => s.id),
        );
        // C-1 (kontrola po etapě 5. 8. 2026): NE toSnap — buildSplitEditTargetsWithShifted
        // uvnitř čte sdílená pole (např. `type`) přímo ze snapshotu (pickShared). BlockSnapshot
        // má jen 7 pozičních klíčů, takže sourozenec z toSnap by na `src["type"]` vrátil
        // undefined a JSON.stringify by ho na cestě k serveru tiše vyhodil z payloadu — split
        // skupina by se tiše rozešla. Plný blok s normalizovanou nullabilitou (stejný vzor jako
        // toSnap, jen bez ořezání na 7 klíčů).
        const toFullSnap = (b: Block) => ({
          ...b,
          startTime: b.startTime as string, endTime: b.endTime as string,
          printMinutes: b.printMinutes ?? null, scheduleBypassed: b.scheduleBypassed ?? false,
        });
        const shiftedSplitSiblingsOld = shiftedOld.filter((o) => shiftedSplitSiblingIds.has(o.id)).map(toFullSnap);
        const shiftedSplitSiblingsNew = shifted.filter((s) => shiftedSplitSiblingIds.has(s.id)).map(toFullSnap);
        // Sourozenci jako ADRESNÉ cíle (ne propagace) — atomický endpoint SPLIT_SHARED_FIELDS
        // nepropaguje, takže bez nich by po Ctrl+Z zůstali se změněnou hodnotou (regrese
        // proti staré propagační cestě). buildSplitEditTargets jim ale pošle jen průnik
        // changedFields ∩ SPLIT_SHARED_FIELDS — ne celý changedFields (review I1): server
        // na sourozence propaguje jen sdílená pole, zbytek EDIT_TRACKED_FIELDS (locked,
        // materialNote, materialIssued, obalka, vnitrky, tiskoveArchy, serie) se jich netýká.
        const { beforeTargets: rawBeforeTargets, afterTargets: rawAfterTargets, absorbedShiftedIds } = buildSplitEditTargetsWithShifted({
          changedFields, sharedFields: SPLIT_SHARED_FIELDS,
          before: prev, after: cleanUpdated, siblingsOld, siblingsNew: siblings,
          shiftedSplitSiblingsOld, shiftedSplitSiblingsNew,
        });
        // Kotva nese pozici PŘÍMO ve svém cíli, pokud se reálně změnila — mergeAnchorPositionIfChanged
        // uvnitř gatuje na skutečný diff prevSnap/updatedSnap, takže čistě polní editace (beze
        // změny pozice) nedostane do fields žádný poziční klíč (jinak by ji undoApply.server.ts,
        // `touchesPosition`, vykreslil jako poziční audit řádek místo výpisu polí).
        const { beforeTargets, afterTargets } = mergeAnchorPositionIfChanged({
          beforeTargets: rawBeforeTargets, afterTargets: rawAfterTargets, prev: prevSnap, updated: updatedSnap,
        });
        // Pohlcený soused nese pozici UVNITŘ beforeTargets/afterTargets (sdílené pole i pozice
        // v jednom cíli) — musí zmizet z prostého pozičního seznamu, jinak by stejné id bloku
        // bylo ve DVOU cílech JEDNÉ dávky a sanitizeUndoOps by celý krok odmítl (400).
        const shiftedBeforeFinal = absorbedShiftedIds.size === 0 ? shiftedBefore : shiftedBefore.filter((s) => !absorbedShiftedIds.has(s.id));
        const shiftedAfterFinal = absorbedShiftedIds.size === 0 ? shiftedAfter : shiftedAfter.filter((s) => !absorbedShiftedIds.has(s.id));
        recordUndo(buildMultiEditCommand("Úprava bloku", beforeTargets, afterTargets, shiftedBeforeFinal, shiftedAfterFinal));
      } else {
        // Beze změny business polí — chování beze změny (poziční krok samostatně).
        const shiftedBeforeMove = shiftedOld.map((o) => ({ id: o.id, startTime: o.startTime as string, endTime: o.endTime as string, machine: o.machine, updatedAt: o.updatedAt, printMinutes: o.printMinutes ?? null, scheduleBypassed: o.scheduleBypassed ?? false }));
        const shiftedAfterMove = shifted.map((s) => ({ id: s.id, startTime: s.startTime as string, endTime: s.endTime as string, machine: s.machine, updatedAt: s.updatedAt, printMinutes: s.printMinutes ?? null, scheduleBypassed: s.scheduleBypassed ?? false }));
        const mutationCmd = buildMoveOrResizeCommand(prevSnap, updatedSnap, shiftedBeforeMove, shiftedAfterMove);
        if (mutationCmd) recordUndo(mutationCmd);
      }
    }
  }

  /**
   * Otevře potvrzení velké kaskády a počká na odpověď. Fokus je na „Zrušit"
   * (`autoFocusConfirm={false}` + `autoFocusCancel` na `ConfirmDialog` níž) —
   * stejné rozhodnutí jako u dialogu zkrácení směn: potvrzovací tlačítko
   * u destruktivní akce nesmí být pod Enterem.
   */
  const askCascade = useCallback(
    (payload: CascadePayload) => new Promise<boolean>((resolve) => setCascadeAsk({ payload, resolve })),
    [],
  );

  /**
   * Překlopení celé rezervace na zakázku (připomínka plánovače, 8/2026).
   *
   * Rezervace bývá rozpuštěná do víc bloků (OBÁLKA na XL 105, VNITŘKY na
   * XL 106) a plánovač je dřív musel překlápět po jednom. Editovaný blok
   * dostane plný payload z formuláře, sourozenci jen minimum
   * (`orderNumber`/`type`/`blockVariant`) — jinak by se jim přepsal vlastní
   * popis, termíny a štítky hodnotami z anchoru.
   *
   * Sourozenec, kterého server překlopil sám (split skupina, SPLIT_SHARED_FIELDS),
   * se přeskočí. Celá akce je JEDEN krok historie, takže Ctrl+Z vrátí všechny.
   */
  // Vrací třístavovou hodnotu, ne boolean — "declined" (uživatel kaskádu zamítl)
  // NENÍ totéž jako "failed" (skutečná chyba). BlockEdit.tsx (runFlip) na "failed"
  // reaguje červenou hláškou v panelu; "declined" a "ok" ne (viz komentář u
  // volajícího místa a bod 6 finálního review — mlčíme jen tehdy, když se
  // opravdu nic nestalo, jinak ozve neutrální info toast, viz níž).
  async function handleFlipReservation(
    anchorId: number,
    anchorPayload: Record<string, unknown>,
    siblingIds: number[],
  ): Promise<"ok" | "declined" | "failed"> {
    // endTime je součástí snapshotu záměrně: překlopení na ZAKAZKA přepne blok
    // na model tiskových hodin a server ho může re-expandovat přes pauzy směn.
    // Bez endTime by Ctrl+Z vrátil typ, ale nechal prodlouženou délku.
    const flipFields = (b: Block) => ({
      type: b.type, orderNumber: b.orderNumber, blockVariant: b.blockVariant, endTime: b.endTime,
    });
    const flipShiftBefore: BlockSnapshot[] = [];
    const flipShiftAfter: BlockSnapshot[] = [];
    const before: EditSnapshot[] = [];
    const after: EditSnapshot[] = [];

    const snapshotBefore = (id: number) => {
      const live = blocksRef.current.find((b) => b.id === id);
      if (live) before.push({ id, updatedAt: live.updatedAt, fields: flipFields(live) });
    };
    snapshotBefore(anchorId);
    siblingIds.forEach(snapshotBefore);

    // C1b (go/no-go audit 5. 8. 2026): split sourozenci kotvy (nebo explicitních
    // sourozenců), o které jsme si NEŘEKLI (typicky volba „jen tento blok" —
    // siblingIds = []). Server je PŘESTO propaguje přes SPLIT_SHARED_FIELDS
    // (updateMany nad CELOU splitGroupId, ne jen nad kotvou/explicitními
    // sourozenci) — bez adresního zápisu do undo kroku by Ctrl+Z vrátil jen
    // kotvu a tihle by zůstali překlopení. Zachytit jejich PŘEDCHOZÍ stav TEĎ,
    // než cokoliv začne mutovat (blocksRef se mění uvnitř putFlip).
    const explicitIds = new Set([anchorId, ...siblingIds]);
    const watchedGroupIds = new Set(
      [anchorId, ...siblingIds]
        .map((id) => blocksRef.current.find((b) => b.id === id)?.splitGroupId)
        .filter((gid): gid is number => gid != null),
    );
    const passiveOldById = new Map(
      watchedGroupIds.size > 0
        ? blocksRef.current
            .filter((b) => b.splitGroupId != null && watchedGroupIds.has(b.splitGroupId) && !explicitIds.has(b.id))
            .map((b) => [b.id, b] as const)
        : [],
    );
    /**
     * Post-propagační stav pasivních sourozenců. MUSÍ pocházet z odpovědi serveru,
     * NE z `blocksRef.current`: ten se uvnitř téhle funkce neaktualizuje, protože
     * `handleBlockUpdate` volá jen `setBlocks` a ref se přepisuje až při dalším
     * renderu (ř. 159). Diff proti němu proto nikdy nic nenašel a Ctrl+Z vracel
     * jen kotvu — pasivní sourozenec zůstal překlopený (nahlásil Vojta 6. 8. 2026).
     *
     * Sbírá se ze DVOU polí odpovědi: `siblings` nese propagované sourozence,
     * `shifted` ty, které chain push zároveň odsunul — server je ze `siblings`
     * záměrně vylučuje, aby neposlal dvojitou SSE událost.
     */
    const passiveLiveById = new Map<number, Block>();
    /**
     * VŠICHNI split sourozenci nahlášení KTERÝMKOLI putFlipem (`siblings`/
     * `shifted` z odpovědi) — na rozdíl od `passiveLiveById` bez ohledu na to,
     * jestli jsou v `explicitIds`. Slouží k detekci „tenhle explicitní
     * sourozenec (siblingIds) byl už propagací překlopený" v cyklu níž (bug B,
     * review 6. 8. 2026): cyklus dřív četl `blocksRef.current`, který se uvnitř
     * téhle funkce nikdy needatuje (`handleBlockUpdate` volá jen setBlocks, ref
     * se přepíše až při dalším renderu) — podmínka proto nikdy neplatila a na
     * už propagovaného sourozence se posílal zbytečný PUT navíc.
     */
    const reportedSiblingById = new Map<number, Block>();

    // Překlopení rezervace je JEDNO gesto uživatele, i když volá putFlip pro kotvu
    // a pak pro každého sourozence zvlášť — po prvním potvrzení kaskády se další
    // volání téhle dávky už neptají (askOncePerGesture, sdílené s group paste
    // a uložením série).
    const askOnce = askOncePerGesture(askCascade);
    // Vrací `null`, když uživatel kaskádu ZAMÍTL — volající to musí odlišit od
    // úspěchu a mlčky dávku ukončit (žádný toast, žádná chyba, viz isCascadeDeclined).
    const putFlip = async (id: number, body: Record<string, unknown>, lock?: string): Promise<Block | null> => {
      // Optimistic lock jen u kotvy (parita s doSave, audit REL-02). Sourozenci
      // ho mít nesmí: kotvin PUT jim serverovou propagací bumpne verzi a lock
      // by je shodil na vlastní 409.
      const res = await fetchWithCascadeConfirm(
        `/api/blocks/${id}`,
        "PUT",
        { ...body, resolveChain: true, ...(lock ? { expectedUpdatedAt: lock } : {}) },
        askOnce,
      );
      if (isCascadeDeclined(res)) return null;
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Chyba při překlopení bloku ${id}`);
      }
      const updated: Block = await res.json();
      // Autoritativní post-propagační stav pasivních sourozenců (viz passiveLiveById).
      // Poslední zápis vyhrává: u dávky víc putFlipů je konečná pravda ta z posledního.
      for (const p of [
        ...((updated as Block & { siblings?: Block[] }).siblings ?? []),
        ...((updated as Block & { shifted?: Block[] }).shifted ?? []),
      ]) {
        if (passiveOldById.has(p.id)) passiveLiveById.set(p.id, p);
        reportedSiblingById.set(p.id, p);
      }
      // Snapshot odsunutých MUSÍ vzniknout před handleBlockUpdate (staré pozice
      // jsou jen v blocksRef). Týž soused může figurovat u víc bloků dávky —
      // první „před" je předdávková pozice, poslední „po" ta konečná.
      const sh = snapshotShiftedFromResponse(updated);
      sh.before.forEach((b, i) => {
        const known = flipShiftBefore.findIndex((x) => x.id === b.id);
        if (known === -1) { flipShiftBefore.push(b); flipShiftAfter.push(sh.after[i]); }
        else flipShiftAfter[known] = sh.after[i];
      });
      handleBlockUpdate(updated); // bez addToHistory — historii zapisujeme jednu za celek
      after.push({ id, updatedAt: updated.updatedAt, fields: flipFields(updated) });
      // Server propaguje sdílená pole na split sourozence (SPLIT_SHARED_FIELDS)
      // a bumpne jim verzi — i bloku, který jsme zapsali dřív. Bez téhle
      // re-synchronizace by undo padlo na guard se zastaralou verzí, přestože
      // nikdo cizí nic nezměnil.
      for (const sib of (updated as Block & { siblings?: Block[] }).siblings ?? []) {
        const known = after.find((x) => x.id === sib.id);
        if (known) { known.updatedAt = sib.updatedAt; known.fields = flipFields(sib); }
      }
      return updated;
    };

    /**
     * Zapíše historii za to, co se REÁLNĚ změnilo. Volá se i po chybě uprostřed
     * dávky — bez toho by po částečném selhání zůstaly už překlopené bloky
     * v plánu bez možnosti vrátit je Ctrl+Z.
     *
     * Vrací počet PASIVNÍCH sourozenců, které propagace opravdu změnila —
     * toast po úspěchu z něj (spolu s kotvou a explicitními sourozenci) skládá
     * SKUTEČNÝ počet překlopených bloků (bug A, review 6. 8. 2026).
     */
    const recordFlipUndo = (): number => {
      const changed = before.filter((b) => {
        const a = after.find((x) => x.id === b.id);
        return a && JSON.stringify(a.fields) !== JSON.stringify(b.fields);
      });
      // C1b (go/no-go audit 5. 8. 2026): sourozenci propagovaní serverem, o které
      // jsme si NEŘEKLI (nejsou v explicitIds/before) — diff AŽ TEĎ, proti
      // aktuálnímu (post-propagace) blocksRef.current, protože teprve teď je
      // vidět, co server doopravdy změnil. buildPassiveSiblingTargets pošle jen
      // SPLIT_SHARED_FIELDS podmnožinu (ne celý flipFields) — propagace nikdy
      // nemění endTime, na rozdíl od kotvy/explicitního sourozence, který jde
      // přes vlastní putFlip.
      const passivePairs = [...passiveOldById]
        .map(([id, old]) => {
          const live = passiveLiveById.get(id);
          return live ? { old: old as unknown as Record<string, unknown> & { id: number; updatedAt: string }, live: live as unknown as Record<string, unknown> & { id: number; updatedAt: string } } : null;
        })
        .filter((p): p is NonNullable<typeof p> => p != null);
      const passive = buildPassiveSiblingTargets(SPLIT_SHARED_FIELDS, passivePairs);
      // I-1 (kontrola po etapě 5. 8. 2026): pasivní soused, kterého flip ZÁROVEŇ
      // odsunul chain push (typicky re-expanze kotvy přes tiskové hodiny), by jinak
      // ztratil pozici — filtr níž vyřadí flipShiftBefore/After položky, které jsou
      // teď v `changed` (aby stejné id nebylo ve DVOU cílech jedné dávky), ale
      // buildPassiveSiblingTargets nese jen SPLIT_SHARED_FIELDS (bez startTime/
      // endTime/machine). Stejný vzor jako C-1: slít pozici PŘÍMO do fields
      // pasivního cíle (mergePositionIntoTargets), ať cíl nese obojí.
      const shiftBeforeById = new Map(flipShiftBefore.map((s) => [s.id, s]));
      const shiftAfterById = new Map(flipShiftAfter.map((s) => [s.id, s]));
      changed.push(...mergePositionIntoTargets(passive.beforeTargets, shiftBeforeById));
      after.push(...mergePositionIntoTargets(passive.afterTargets, shiftAfterById));
      const passiveChangedCount = passive.afterTargets.length;
      if (changed.length === 0) return passiveChangedCount;
      recordUndo(buildMultiEditCommand(
        changed.length > 1 ? "Překlopení rezervace" : "Překlopení na zakázku",
        changed,
        changed.map((b) => after.find((x) => x.id === b.id)!),
        flipShiftBefore.filter((x) => !changed.some((c) => c.id === x.id)),
        flipShiftAfter.filter((_, i) => !changed.some((c) => c.id === flipShiftBefore[i].id)),
      ));
      return passiveChangedCount;
    };

    try {
      const anchorLock = blocksRef.current.find((b) => b.id === anchorId)?.updatedAt;
      const updatedAnchor = await putFlip(anchorId, anchorPayload, anchorLock);
      // Zamítnutí u úplně PRVNÍHO požadavku dávky — nic se ještě nestihlo
      // uložit, takže je to skutečně tiché "nic se nestalo".
      if (!updatedAnchor) return "declined";
      const targetOrderNumber = updatedAnchor.orderNumber;

      for (const id of siblingIds) {
        const live = blocksRef.current.find((b) => b.id === id);
        if (!live) continue;
        // Split sourozenec už překlopený serverovou propagací (SPLIT_SHARED_FIELDS
        // z putFlipu kotvy nebo předchozího sourozence v týhle dávce) → další PUT
        // je zbytečný. Čte se z odpovědi serveru (reportedSiblingById), NE z
        // `blocksRef.current` (bug B, viz komentář u deklarace výš) — ten by tuhle
        // podmínku nikdy nesplnil.
        const already = reportedSiblingById.get(id);
        if (already && already.type === "ZAKAZKA" && already.orderNumber === targetOrderNumber) {
          after.push({ id, updatedAt: already.updatedAt, fields: flipFields(already) });
          continue;
        }
        const flippedSibling = await putFlip(id, {
          orderNumber: targetOrderNumber,
          type: "ZAKAZKA",
          blockVariant: RESERVATION_FLIP_VARIANT,
        });
        if (!flippedSibling) {
          // Zamítnutí uprostřed dávky — na rozdíl od zamítnutí kotvy tady
          // NĚCO už prošlo (min. kotva), takže ticho by lhalo. Zapsat historii
          // toho, co se stihlo, a ozvat se neutrálním info toastem (bod 6
          // finálního review) — ne chybou, jen stavem.
          recordFlipUndo();
          const done = after.length;
          showToast(
            `Autoposun zrušen — provedeno ${done} z ${1 + siblingIds.length} bloků, zbytek beze změny (Ctrl+Z vrátí).`,
            "info",
          );
          return "declined";
        }
      }

      const passiveChangedCount = recordFlipUndo();
      setEditingBlock(null); // parita s onSave — po úspěšném uložení panel zavíráme
      // Skutečný počet = kotva + explicitní sourozenci (siblingIds) + pasivní
      // sourozenci, které server stejně propagoval (split partneři, o které
      // jsme si neřekli). Bez posledního členu by toast u „jen tento blok"
      // nad rozdělenou zakázkou lhal stejně jako dřív ten dialog — nahlásil
      // Vojta z reálného testování, 8/2026 (bug A, review 6. 8. 2026).
      const flipped = 1 + siblingIds.length + passiveChangedCount;
      showToast(
        flipped > 1
          ? `Rezervace překlopena na zakázku (${flipped} ${flipped < 5 ? "bloky" : "bloků"}).`
          : "Rezervace překlopena na zakázku.",
        "success",
      );
      return "ok";
    } catch (error) {
      console.error("Reservation flip failed", error);
      recordFlipUndo(); // co prošlo, musí jít vrátit
      const done = after.length;
      showToast(
        done > 0
          ? `Překlopeno ${done} z ${1 + siblingIds.length} bloků, pak nastala chyba: ${error instanceof Error ? error.message : "neznámá chyba"}`
          : (error instanceof Error ? error.message : "Chyba při překlopení rezervace."),
        "error",
      );
      return "failed";
    }
  }

  // Vrací true při úspěchu — volající (group cut) podle toho rozhodne, zda vyčistit clipboard.
  async function handleMultiBlockUpdate(updates: { id: number; startTime: Date; endTime: Date; machine: string }[]): Promise<boolean> {
    const originals = new Map(updates.map(u => [u.id, blocksRef.current.find(b => b.id === u.id)]));
    try {
      const batchRes = await fetchWithCascadeConfirm(
        "/api/blocks/batch",
        "POST",
        {
          updates: updates.map((u) => ({
            id: u.id,
            startTime: u.startTime.toISOString(),
            endTime: u.endTime.toISOString(),
            machine: u.machine,
          })),
          bypassScheduleValidation: !workingTimeLockRef.current,
          resolveChain: true,
        },
        askCascade,
      );
      if (isCascadeDeclined(batchRes)) return false; // uživatel kaskádu zamítl — nic se nestalo, mlčíme
      if (!batchRes.ok) {
        const err = await batchRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Chyba serveru");
      }
      // Batch vrací přesunuté lasso bloky + navazující odsunuté serverem (chain push).
      const results: Block[] = await batchRes.json();
      const updateIds = new Set(updates.map((u) => u.id));
      const shiftedResults = results.filter((r) => !updateIds.has(r.id));
      // Staré pozice posunutých navazujících bloků (pro undo) — PŘED aplikací do stavu.
      const shiftedOld = shiftedResults
        .map((r) => blocksRef.current.find((b) => b.id === r.id))
        .filter((b): b is Block => b != null);

      const newBlocks = blocksRef.current.map((b) => results.find((r) => r.id === b.id) ?? b);
      blocksRef.current = newBlocks;
      setBlocks(newBlocks);
      // Stejná hláška jako u jednotlivého přesunu a vytvoření bloku — batch odsouvá
      // od 31. 7. 2026 i rezervace a údržbu, a to se nesmí stát potichu.
      if (shiftedResults.length > 0) {
        showToast(`Posunuto ${shiftedResults.length} navazujících bloků — zkontroluj timeline.`, "info");
      }

      // scheduleBypassed se při MOVE mění jen u přímo tažených bloků (updates) — server ho
      // pro ně přepočítává podle nové pozice (batch/route.ts:160). Chain-pushem odsunutí
      // sousedé (shiftedOld/shiftedResults) ho nemění: chainPushGeometry (overlapResolver.server.ts)
      // jim scheduleBypassed jen PŘENÁŠÍ ze stávající hodnoty (nepřepočítává) — bypassovaný
      // blok navíc chain push vůbec neposouvá (je to zeď), takže se u posunutého souseda
      // nemůže změnit. printMinutes je při MOVE invariant u všech bloků v dávce.
      // BlockSnapshot má obě pole POVINNÁ (Task 7 Step 0) — i sousedé je proto musí nést;
      // jde ale o no-op zápis skutečné (nezměněné) hodnoty, navíc chráněný expectedUpdatedAt
      // zámkem proti mezitímní cizí změně, takže to nic neriskuje.
      const prevSnaps = [
        ...(updates
          .map((u) => { const o = originals.get(u.id); return o ? { id: u.id, startTime: o.startTime as string, endTime: o.endTime as string, machine: o.machine, printMinutes: o.printMinutes ?? null, scheduleBypassed: o.scheduleBypassed ?? false } : null; })
          .filter(Boolean) as { id: number; startTime: string; endTime: string; machine: string; printMinutes: number | null; scheduleBypassed: boolean }[]),
        ...shiftedOld.map((o) => ({ id: o.id, startTime: o.startTime as string, endTime: o.endTime as string, machine: o.machine, printMinutes: o.printMinutes ?? null, scheduleBypassed: o.scheduleBypassed ?? false })),
      ];
      const nextSnaps = [
        ...updates.map((u) => { const res = results.find((r) => r.id === u.id); return { id: u.id, startTime: u.startTime.toISOString(), endTime: u.endTime.toISOString(), machine: u.machine, printMinutes: res?.printMinutes ?? null, scheduleBypassed: res?.scheduleBypassed ?? false }; }),
        ...shiftedResults.map((s) => ({ id: s.id, startTime: s.startTime as string, endTime: s.endTime as string, machine: s.machine, printMinutes: s.printMinutes ?? null, scheduleBypassed: s.scheduleBypassed ?? false })),
      ];
      if (prevSnaps.length > 0) {
        const beforeUpd = new Map<number, string>([
          ...updates.map((u) => [u.id, originals.get(u.id)!.updatedAt] as const),
          ...shiftedOld.map((o) => [o.id, o.updatedAt] as const),
        ]);
        const afterUpd = new Map<number, string>(results.map((r) => [r.id, r.updatedAt] as const));
        recordUndo(buildMoveCommand(
          "Hromadný přesun",
          prevSnaps.map((s) => ({ ...s, updatedAt: beforeUpd.get(s.id) ?? "" })),
          nextSnaps.map((s) => ({ ...s, updatedAt: afterUpd.get(s.id) ?? "" })),
        ));
      }
      return true;
    } catch (error) {
      console.error("Multi-block update failed", error);
      showToast(error instanceof Error ? error.message : "Hromadný posun se nepodařilo uložit.", "error");
      return false;
    }
  }

  /**
   * Staré a nové pozice bloků, které při vytvoření odsunul serverový chain push.
   *
   * MUSÍ se volat PŘED `handleBlockCreate` — staré pozice existují jen
   * v `blocksRef`, odpověď serveru je nemá (vrací odsunuté bloky už s novými
   * časy). Bez toho vrátil Ctrl+Z jen vložený blok a odsunuté zakázky zůstaly
   * přesunuté (připomínka plánovače, 8/2026).
   */
  function snapshotShiftedFromResponse(resp: Block & { shifted?: Block[] }): {
    before: BlockSnapshot[];
    after: BlockSnapshot[];
  } {
    const snap = (b: Block): BlockSnapshot => ({
      id: b.id, startTime: b.startTime as string, endTime: b.endTime as string,
      machine: b.machine, updatedAt: b.updatedAt,
      printMinutes: b.printMinutes ?? null, scheduleBypassed: b.scheduleBypassed ?? false,
    });
    const shifted = (resp.shifted ?? []).filter((s) => typeof s.id === "number");
    const before: BlockSnapshot[] = [];
    const after: BlockSnapshot[] = [];
    for (const s of shifted) {
      const live = blocksRef.current.find((b) => b.id === s.id);
      if (!live) continue; // blok mimo klientský stav — undo by ho stejně neuměl vrátit
      before.push(snap(live));
      after.push(snap(s));
    }
    return { before, after };
  }

  function handleBlockCreate(newBlock: Block) {
    // POST s resolveChain vrací v poli `shifted` navazující bloky odsunuté serverem.
    const shifted = ((newBlock as Block & { shifted?: Block[] }).shifted ?? []).filter((s) => typeof s.id === "number");
    const cleanNew = { ...newBlock } as Block & { shifted?: Block[] };
    delete cleanNew.shifted;
    setBlocks((prev) => {
      const withShifted = shifted.length > 0
        ? prev.map((b) => shifted.find((s) => s.id === b.id) ?? b)
        : prev;
      return [...withShifted, cleanNew].sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );
    });
    // Odsunutí navazujících bloků nesmí proběhnout tiše — od 31. 7. 2026 se
    // odsouvají i rezervace a údržba, takže rozsah může být větší, než uživatel čeká.
    if (shifted.length > 0) {
      showToast(`Posunuto ${shifted.length} navazujících bloků — zkontroluj timeline.`, "info");
    }
  }

  function handleDataChipDoubleClick(blockId: number, rect: DOMRect) {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;
    setDtpPopover({
      blockId,
      statusId: block.dataStatusId ?? null,
      rect,
    });
  }

  async function handleDtpDataStatusChange(
    blockId: number,
    patch: { dataStatusId?: number | null; dataStatusLabel?: string | null; dataOk?: boolean }
  ) {
    try {
      const res = await fetch(`/api/blocks/${blockId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? "Chyba při ukládání.", "error");
        return;
      }
      const updated: Block = await res.json();
      handleBlockUpdate(updated, true);
    } catch {
      showToast("Chyba při ukládání.", "error");
    }
  }

  // Undo pro CREATE (paste/group paste/queue-drop) jen pro samostatné, ne-rezervační bloky —
  // parita s guardem u DELETE undo výše (REZERVACE a série mají komplexní vztahy, undo se pro ně nezaznamenává).
  const canUndoCreated = (b: Block) =>
    b.reservationId == null && b.recurrenceType === "NONE" && b.recurrenceParentId == null;

  /** @returns true = blok skutečně smazán; false = čeká se na force potvrzení. */
  async function deleteSingleBlockWithUndo(block: Block, rejectionReason?: string, force = false): Promise<boolean> {
    const fetchOpts: RequestInit = { method: "DELETE" };
    const deleteBody: Record<string, unknown> = {};
    if (block.reservationId && rejectionReason !== undefined) {
      deleteBody.reason = rejectionReason;
    }
    if (force) deleteBody.force = true;
    if (Object.keys(deleteBody).length > 0) {
      fetchOpts.headers = { "Content-Type": "application/json" };
      fetchOpts.body = JSON.stringify(deleteBody);
    }
    const res = await fetch(`/api/blocks/${block.id}`, fetchOpts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string; requiresForce?: boolean };
      // Zamčený/vytištěný blok — server chce explicitní potvrzení (audit DATA-03).
      if (err.requiresForce) {
        setForceDeleteConfirm({ block, rejectionReason, message: err.error ?? "Blok je chráněný — smazání vyžaduje potvrzení." });
        return false;
      }
      throw new Error(err.error ?? "Chyba serveru");
    }

    setBlocks((prev) => prev.filter((b) => b.id !== block.id));
    setSelectedBlock(null);
    setEditingBlock(null);

    // Pokud byl blok spojen s rezervací — server ji zamítl (REJECTED);
    // odstraníme ji z fialové fronty
    if (block.reservationId) {
      setReservationQueue((prev) => prev.filter((q) => q.id !== `r_${block.reservationId}`));
      // REZERVACE bloky přeskakujeme undo — vztah rezervace↔blok je komplexní
      return true;
    }

    // Série/rezervace z undo vynecháváme (komplexní vztahy); split část ale ANO —
    // payload nese splitGroupId, takže se blok undo-obnovou vrátí do skupiny (3/3).
    if (block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) return true;

    // blockToRestoreFields (allowlist 43 sloupců, undo vrací doslova) vč. pantone/
    // materialInStock/materialIssued/splitGroupId (audit #2). B2: splitGroupId je FK na
    // stabilní SplitGroup.id (přežije smazání kteréhokoli člena, vč. kořene) → posílá se
    // bezpodmínečně, root i leaf se vrátí do skupiny (N/N). Endpoint obnoví blok pod
    // PŮVODNÍM id (žádný remap) — historie v AuditLogu zůstává navázaná.
    // Known-limit (cross-client): pokud jiný klient mezitím smaže zbytek skupiny, obnovený
    // blok je osamocený člen ✂1/1 (neškodné, ne FK crash) — viz CLAUDE.md.
    const fields = blockToRestoreFields(block);

    // `createdAt` mimo `fields` — server ho použije jen při vzkříšení, aby si
    // obnovený blok podržel původní datum vzniku (id se zachovává taky).
    recordUndo(buildDeleteCommand("Smazání bloku", [{ id: block.id, updatedAt: block.updatedAt, fields, createdAt: block.createdAt }]));
    return true;
  }

  async function handleDeleteBlock(id: number, rejectionReason?: string) {
    const block = blocks.find((b) => b.id === id);
    if (!block) return;
    try {
      await deleteSingleBlockWithUndo(block, rejectionReason);
    } catch (error) {
      console.error("Block delete failed", error);
      showToast("Chyba při mazání bloku.", "error");
    }
  }

  /** Dokončí hromadné mazání chráněných (zamčených/vytištěných) bloků s force. */
  async function forceDeleteMany(ids: number[]) {
    try {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/blocks/${id}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ force: true }),
          })
            .then((r) => ({ id, ok: r.ok }))
            .catch(() => ({ id, ok: false }))
        )
      );
      const done = results.filter((r) => r.ok).map((r) => r.id);
      const failed = results.length - done.length;
      if (done.length > 0) {
        setBlocks((prev) => prev.filter((b) => !done.includes(b.id)));
        if (done.includes(editingBlock?.id ?? -1)) setEditingBlock(null);
        if (done.includes(selectedBlock?.id ?? -1)) setSelectedBlock(null);
        showToast(`Smazáno ${done.length} chráněných bloků (bez možnosti vrátit).`, "info");
      }
      if (failed > 0) showToast(`${failed} blok${failed > 1 ? "y" : ""} se nepodařilo smazat.`, "error");
    } catch (error) {
      console.error("Force multi delete failed", error);
      showToast("Chyba při mazání bloků.", "error");
    }
  }

  /** @returns true = mazání proběhlo; false = čeká se na force potvrzení nebo selhalo. */
  async function handleDeleteAll(ids: number[]): Promise<boolean> {
    // Single delete — s undo podporou
    if (ids.length === 1) {
      const block = blocks.find((b) => b.id === ids[0]);
      if (block) {
        try {
          return await deleteSingleBlockWithUndo(block);
        } catch (error) {
          console.error("Block delete failed", error);
          showToast("Chyba při mazání bloku.", "error");
          return false;
        }
      }
    }

    // Multi delete — standalone i split části dostanou undo (payload nese splitGroupId,
    // část se vrátí do skupiny); série zůstávají mimo undo (komplexní vztahy).
    const toDelete = blocksRef.current.filter((b) => ids.includes(b.id));
    const standalone = toDelete.filter(
      (b) => b.recurrenceType === "NONE" && b.recurrenceParentId === null
    );
    const complex = toDelete.filter((b) => !standalone.some((s) => s.id === b.id));
    // Smazat vše — zachytit které DELETE uspěly (na serveru ne jen síťově).
    // Zamčené / vytištěné bloky vrací 409 requiresForce — ty se nesmí ztratit
    // v anonymním „N bloků se nepodařilo smazat" (review F4 #2): posbírají se
    // a nabídnou v jednom souhrnném potvrzení.
    const deleteOnce = async (idList: number[], force: boolean) => {
      const results = await Promise.all(
        idList.map((id) =>
          fetch(`/api/blocks/${id}`, {
            method: "DELETE",
            ...(force
              ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) }
              : {}),
          })
            .then(async (r) => {
              if (r.ok) return { id, ok: true, needsForce: false };
              const err = await r.json().catch(() => ({})) as { requiresForce?: boolean };
              return { id, ok: false, needsForce: err.requiresForce === true };
            })
            .catch(() => ({ id, ok: false, needsForce: false }))
        )
      );
      return results;
    };

    let deletedIds: number[];
    let protectedIds: number[] = [];
    try {
      const responses = await deleteOnce(ids, false);
      deletedIds = responses.filter((r) => r.ok).map((r) => r.id);
      protectedIds = responses.filter((r) => !r.ok && r.needsForce).map((r) => r.id);
      const otherFails = responses.filter((r) => !r.ok && !r.needsForce).length;
      if (otherFails > 0) {
        showToast(`${otherFails} blok${otherFails > 1 ? "y" : ""} se nepodařilo smazat.`, "error");
      }
      if (protectedIds.length > 0) {
        setMultiForceDelete({ ids: protectedIds });
      }
    } catch (error) {
      console.error("Multi delete failed", error);
      showToast("Chyba při mazání bloků.", "error");
      return false;
    }
    if (deletedIds.length === 0) return false;
    setBlocks((prev) => prev.filter((b) => !deletedIds.includes(b.id)));
    if (deletedIds.includes(editingBlock?.id ?? -1)) setEditingBlock(null);
    if (deletedIds.includes(selectedBlock?.id ?? -1)) setSelectedBlock(null);
    const deletedComplex = complex.filter((b) => deletedIds.includes(b.id));
    if (deletedComplex.length > 0) showToast("Bloky série smazány bez možnosti vrátit.", "info");

    // Undo jen pro standalone bloky, které byly skutečně smazány
    const deletedStandalone = standalone.filter((b) => deletedIds.includes(b.id));
    if (deletedStandalone.length === 0) return protectedIds.length === 0;

    // blockToRestoreFields vč. pantone/materialInStock/materialIssued/splitGroupId (audit #2).
    // B2: splitGroupId přežije deleci (FK na stabilní SplitGroup.id) → posílat vždy; každá
    // smazaná část se vrátí do své skupiny (i když se maže root + listy najednou). Endpoint
    // obnoví bloky pod PŮVODNÍMI id (žádný remap).
    recordUndo(buildDeleteCommand("Smazání bloků", deletedStandalone.map((b) => ({ id: b.id, updatedAt: b.updatedAt, fields: blockToRestoreFields(b), createdAt: b.createdAt }))));
    return protectedIds.length === 0;
  }

  async function handleSaveAll(ids: number[], payload: Record<string, unknown>): Promise<boolean> {
    const saveBefore: EditSnapshot[] = [];
    const saveAfter: EditSnapshot[] = [];
    // Odsunutí sousedé (chain push) napříč VŠEMI PUTy dávky — accumulateShifted řeší
    // dedup, když týž soused dostane víc PUTů (viz komentář u snapshotu ve smyčce níž).
    let saveShifted: ShiftedSnapshots = { before: [], after: [] };
    // Split sourozenci pohlcení do saveBefore/saveAfter (sdílené pole + pozice v jednom
    // cíli přes buildSplitEditTargetsWithShifted, C-1 vzor) napříč CELOU dávkou — musí
    // zmizet z pozičního seznamu odsunutých, jinak by stejné id bylo ve DVOU cílech
    // (sanitizeUndoOps 400). Deklarace TADY (ne uvnitř try/smyčky), protože ji čte
    // recordSaveAllUndo, definovaná níž ve stejném scope.
    const absorbedShiftedIdsAll = new Set<number>();
    /**
     * Zapíše historii za bloky, které se reálně uložily. Volá se i z catch —
     * když PUT spadne u třetího z pěti, první dva už v DB změněné jsou
     * a bez tohohle by je Ctrl+Z nevrátil (stejný vzor jako u překlopení).
     */
    const recordSaveAllUndo = () => {
      if (saveBefore.length === 0) return;
      // Odsunutý soused, který je ZÁROVEŇ vlastním cílem dávky (jiný člen téže série
      // ho odsunul chain pushem, NEBO split sourozenec pohlcený sdíleným cílem výš),
      // musí zmizet z odsunutých: sanitizeUndoOps odmítne dávku, kde je stejné id
      // ve dvou cílech (400), a celý krok historie (ne jen odsunutí) by spadl.
      const shifted = excludeShiftedTargeted(
        saveShifted,
        new Set([...saveBefore.map((t) => t.id), ...absorbedShiftedIdsAll]),
      );
      recordUndo(buildMultiEditCommand(
        saveBefore.length > 1 ? "Hromadná úprava" : "Úprava bloku",
        saveBefore, saveAfter,
        shifted.before, shifted.after,
      ));
    };
    // Hromadné uložení (série / split skupina) je JEDNO gesto uživatele, i když
    // PUTuje N bloků ve smyčce — po prvním potvrzení kaskády se další bloky dávky
    // už neptají (askOncePerGesture, sdílené s překlopením rezervace a group paste).
    const askOnce = askOncePerGesture(askCascade);
    try {
      // Pokud payload obsahuje endTime, spočítat durationMs a aplikovat per-block
      const hasEndTime = payload.endTime !== undefined;
      let durationMs = 0;
      if (hasEndTime && editingBlock) {
        durationMs = new Date(payload.endTime as string).getTime() - new Date(editingBlock.startTime).getTime();
      }

      const results: Block[] = [];
      // Undo hromadného uložení (série / split skupina). Do 8/2026 tahle cesta
      // nezapisovala do historie vůbec — Ctrl+Z po „Uložit vše" nevrátil nic.
      // Sleduje se týž seznam polí jako u editace jednoho bloku.
      //
      // Snapshot PŘED smyčkou, VŠECH bloků (ne jen `ids`): PUT jednoho bloku může přes
      // SPLIT_SHARED_FIELDS propagovat změnu na sourozence a chain pushem odsunout split
      // sourozence MIMO `ids` (typicky TAIL — split mu nekopíruje recurrenceParentId,
      // takže se do `ids` „Celou sérii" nikdy nedostane, viz split/route.ts). Po prvním
      // kole už `blocksRef.current` nedrží spolehlivě PŮVODNÍ hodnoty ŽÁDNÉHO bloku:
      // `blocksRef.current = blocks` běží přímo v render těle komponenty (ne v efektu),
      // takže React re-render se může stihnout mezi dvěma `await fetch` KDYKOLI — čtení
      // „živého" blocksRef.current uprostřed smyčky je nedeterministické. Na tuhle past
      // se v této větvi naletělo dvakrát — všechny „staré" hodnoty ve smyčce níž se proto
      // čtou VÝHRADNĚ odsud, nikdy přímo z blocksRef.current.
      const prevById = new Map(blocksRef.current.map((b) => [b.id, b] as const));
      // toFullSnap je definovaný TADY (ne uvnitř smyčky) — stejný jednorázový normalizér
      // jako v handleBlockUpdate: plný blok s normalizovanou nullabilitou, NE BlockSnapshot
      // (ten má jen 7 pozičních klíčů — sdílené pole jako `type` by na sourozenci vyšlo
      // jako undefined a JSON.stringify by ho na cestě k serveru tiše vyhodilo z payloadu).
      const toFullSnap = (b: Block) => ({
        ...b,
        startTime: b.startTime as string, endTime: b.endTime as string,
        printMinutes: b.printMinutes ?? null, scheduleBypassed: b.scheduleBypassed ?? false,
      });
      for (const id of ids) {
        let blockPayload = payload;
        if (hasEndTime) {
          const currentBlock = blocksRef.current.find(b => b.id === id);
          if (currentBlock) {
            const blockEndTime = new Date(new Date(currentBlock.startTime).getTime() + durationMs).toISOString();
            blockPayload = { ...payload, endTime: blockEndTime };
          }
        }
        const res = await fetchWithCascadeConfirm(
          `/api/blocks/${id}`,
          "PUT",
          { ...blockPayload, resolveChain: true },
          askOnce,
        );
        if (isCascadeDeclined(res)) {
          // Uživatel kaskádu zamítl uprostřed dávky — zapsat, co se stihlo
          // uložit. Ticho platí jen pro jednopožadavkovou cestu ("nic se
          // nestalo") — tady se něco stalo (výsledek == results.length bloků
          // už je v DB uložených), takže se ozve neutrální info toast, ne
          // chyba (finální review, bod 6). Panel se ZÁMĚRNĚ nezavírá (na
          // rozdíl od úspěšné větve níž) — plánovač musí vidět, že dávka
          // není kompletní.
          recordSaveAllUndo();
          const done = results.length;
          if (done > 0) {
            showToast(
              `Autoposun zrušen — uloženo ${done} z ${ids.length} bloků, zbytek beze změny (Ctrl+Z vrátí).`,
              "info",
            );
          }
          return false;
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? `Chyba při ukládání bloku ${id}`);
        }
        const updated = (await res.json()) as Block & { siblings?: Block[]; shifted?: Block[] };
        const prev = prevById.get(id);
        if (prev) {
          // endTime/printMinutes/scheduleBypassed schválně lokálně, ne v globálním
          // EDIT_TRACKED_FIELDS — ten používá i handleBlockUpdate, kde délku řeší
          // buildMoveOrResizeCommand, a vznikl by dvojí zápis do historie.
          //
          // printMinutes MUSÍ být mezi nimi: BlockEdit u ZAKAZKY posílá délku jako
          // `printMinutes` (ne endTime) a server z ní end dopočítá. Atomický endpoint
          // ale nederivuje nic — bez printMinutes ve snapshotu vrátil Ctrl+Z jen
          // endTime a v bloku zůstala nová tisková délka. Vznikl tím rozpor
          // span ≠ printMinutes, plánovač dostal výkřičník „přeplánovat" a reflow
          // blok podle uložených printMinutes zase natáhl — undo vypadalo, že
          // nefunguje (nahlásil Vojta 7. 8. 2026).
          const trackedHere = [...EDIT_TRACKED_FIELDS, "endTime", "printMinutes", "scheduleBypassed"] as const;
          const changed = trackedHere.filter(
            (f) => JSON.stringify((prev as unknown as Record<string, unknown>)[f])
                !== JSON.stringify((updated as unknown as Record<string, unknown>)[f]),
          );
          if (changed.length > 0) {
            // C1a (go/no-go audit 5. 8. 2026): PUT jednoho bloku série může přes
            // SPLIT_SHARED_FIELDS propagovat na split sourozence (typicky TAIL —
            // ten se do `ids` nikdy nedostane, protože split mu nekopíruje
            // recurrenceParentId, viz split/route.ts). Atomický endpoint nic
            // nepropaguje, takže sourozenci musí do undo kroku ADRESNĚ ze
            // `siblings` v odpovědi PUTu — jinak by Ctrl+Z vrátil editovaný blok,
            // ale sourozenec by si nové sdílené hodnoty nechal (split skupina
            // se sdílenými poli rozejde beze stopy).
            const siblings = (updated.siblings ?? []).filter((s) => typeof s.id === "number");
            const siblingsOld = siblings
              .map((s) => prevById.get(s.id))
              .filter((b): b is Block => b != null);
            // Etapa A pokračování (7. 8. 2026): split sourozenec, kterého TENTÝŽ PUT
            // odsunul chain pushem — server ho schválně vyloučí ze `siblings`
            // (api/blocks/[id]/route.ts, „Vyloučit sourozence, kteří už jsou v shifted"),
            // aby neposlal dvojitou SSE událost pro týž blok. Bez tohohle by ho `siblings`
            // (a tedy ani buildSplitEditTargets) nikdy neviděly a nedostal by
            // SPLIT_SHARED_FIELDS — Ctrl+Z by vrátil editovaný blok, ale sourozenec
            // (typicky TAIL) by zůstal s hodnotami po propagaci. Stejný root cause jako
            // C-1 u handleBlockUpdate, tady navíc přes prevById (viz komentář u snapshotu
            // před smyčkou — blocksRef.current je ve smyčce nespolehlivý).
            const shiftedThisIter = (updated.shifted ?? []).filter((s) => typeof s.id === "number");
            const { shiftedSplitSiblingsOld: shiftedSibOldRaw, shiftedSplitSiblingsNew: shiftedSibNewRaw } =
              pickShiftedSplitSiblings(shiftedThisIter, updated.splitGroupId, prevById);
            const shiftedSplitSiblingsOld = shiftedSibOldRaw.map(toFullSnap);
            const shiftedSplitSiblingsNew = shiftedSibNewRaw.map(toFullSnap);
            const { beforeTargets, afterTargets, absorbedShiftedIds } = buildSplitEditTargetsWithShifted({
              changedFields: changed, sharedFields: SPLIT_SHARED_FIELDS,
              before: prev, after: updated, siblingsOld, siblingsNew: siblings,
              shiftedSplitSiblingsOld, shiftedSplitSiblingsNew,
            });
            saveBefore.push(...beforeTargets);
            saveAfter.push(...afterTargets);
            absorbedShiftedIds.forEach((aid) => absorbedShiftedIdsAll.add(aid));
          }
        }
        // Snapshot odsunutých MUSÍ vzniknout PŘED handleBlockUpdate (staré pozice jsou
        // jen v blocksRef, odpověď serveru je nemá) — stejný vzor jako putFlip v
        // handleFlipReservation. accumulateShifted řeší dedup, když PUT tohoto i
        // předchozího bloku dávky odsune téhož souseda (první „před", poslední „po").
        saveShifted = accumulateShifted(saveShifted, snapshotShiftedFromResponse(updated));
        results.push(updated);
        handleBlockUpdate(updated);
      }
      recordSaveAllUndo();

      if (editingBlock && ids.includes(editingBlock.id)) {
        const updatedEditing = results.find((r) => r.id === editingBlock.id);
        if (updatedEditing) setEditingBlock(updatedEditing);
      }
      return true;
    } catch (error) {
      console.error("Series save failed", error);
      recordSaveAllUndo(); // co se stihlo uložit, musí jít vrátit
      showToast(error instanceof Error ? error.message : "Chyba při ukládání série.", "error");
      return false;
    }
  }

  async function handleAddCompanyDay(startDate: string, endDate: string, label: string, machine: string | null) {
    const res = await fetch("/api/company-days", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, label, machine }),
    });
    if (!res.ok) throw new Error("Chyba serveru");
    const created: CompanyDay = await res.json();
    setCompanyDays((prev) => [...prev, created].sort((a, b) => a.startDate.localeCompare(b.startDate)));
  }

  async function handleUpdateCompanyDay(id: number, startDate: string, endDate: string, label: string, machine: string | null) {
    const res = await fetch(`/api/company-days/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, label, machine }),
    });
    if (!res.ok) throw new Error("Chyba serveru");
    const updated: CompanyDay = await res.json();
    setCompanyDays((prev) => prev.map((d) => d.id === id ? updated : d).sort((a, b) => a.startDate.localeCompare(b.startDate)));
  }

  async function handleDeleteCompanyDay(id: number) {
    const res = await fetch(`/api/company-days/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Chyba serveru");
    setCompanyDays((prev) => prev.filter((d) => d.id !== id));
  }

  async function handleBlockVariantChange(blockId: number, variant: BlockVariant) {
    try {
      const res = await fetch(`/api/blocks/${blockId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockVariant: variant }),
      });
      if (!res.ok) throw new Error("Chyba serveru");
      const updated: Block = await res.json();
      handleBlockUpdate(updated, true);
    } catch (error) {
      console.error("Block variant change failed", error);
      showToast("Nepodařilo se změnit stav zakázky.", "error");
    }
  }

  async function handleExpeditionPublish(blockId: number) {
    try {
      const res = await fetch(`/api/blocks/${blockId}/expedition`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish" }),
      });
      if (res.ok) {
        const updated = await res.json() as Block & { siblings?: Block[] };
        const { siblings, ...blockData } = updated;
        setBlocks((prev) => prev.map((b) => b.id === blockId ? { ...b, ...blockData } : b));
        // 5a: expedice mění pole u celé split skupiny → aplikovat sourozence s čerstvým
        // updatedAt (jinak by následný split sourozence spadl na falešný 409, jako #9 u PUT).
        if (siblings && siblings.length > 0) applyServerBlocks(siblings);
      }
    } catch { /* noop */ }
  }

  async function handleExpeditionUnpublish(blockId: number) {
    try {
      const res = await fetch(`/api/blocks/${blockId}/expedition`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unpublish" }),
      });
      if (res.ok) {
        const updated = await res.json() as Block & { siblings?: Block[] };
        const { siblings, ...blockData } = updated;
        setBlocks((prev) => prev.map((b) => b.id === blockId ? { ...b, ...blockData } : b));
        // 5a: viz handleExpeditionPublish — aplikovat sourozence s čerstvým updatedAt.
        if (siblings && siblings.length > 0) applyServerBlocks(siblings);
      }
    } catch { /* noop */ }
  }

  // ── Kalendářní revalidace (etapa 6) — hromadné „Přepočítat" pro celý stroj (banner
  // v hlavičce sloupce TimelineGrid) a pro jeden blok (tlačítko v BlockDetail). Server
  // emituje SSE block:batch-updated, ale NEDORUČUJE ho původci (záměrný vzor,
  // src/app/api/events/route.ts) — proto tady navíc lokálně aplikujeme bloky z response
  // přes applyServerBlocks, jinak by se mutujícímu uživateli obrazovka nikdy nedorovnala.

  /**
   * Krok historie po přepočtu. `before` přišlo ze serveru (nese i bloky, které
   * klient nemá načtené), `after` se poskládá ze serializovaných bloků v odpovědi.
   *
   * Když dávka přeroste `UNDO_MAX_OPS`, krok se ZÁMĚRNĚ nezaznamená a uživateli
   * se to řekne — endpoint undo by ji stejně odmítl 400 a mlčky zaznamenaný krok
   * by v historii jen svítil jako past. Dnes takovou dávku umí vrátit jen správce
   * ze záznamu revizí (`BlockRevision`) — tlačítko „Vrátit tuto změnu" v historii
   * bloku ani endpoint pro to (etapa D) zatím NEEXISTUJÍ. Až etapa D vznikne,
   * text hlášky níže se má vrátit k odkazu na tlačítko v historii bloku.
   */
  function recordReflowUndo(
    label: string,
    before: BlockSnapshot[] | undefined,
    resultBlocks: Block[],
  ): void {
    if (!Array.isArray(before) || before.length === 0) return;
    if (before.length > UNDO_MAX_OPS) {
      console.error("[historie] krok přepočtu se nezaznamenal — dávka přerostla strop", {
        label, blocks: before.length, max: UNDO_MAX_OPS,
      });
      showToast(
        `Přepočet zasáhl ${before.length} bloků — na Ctrl+Z je to moc. Vrátit ho umí jen správce ze záznamu revizí.`,
        "info",
      );
      return;
    }
    const byId = new Map(resultBlocks.filter((b) => b && typeof b.id === "number").map((b) => [b.id, b]));
    const after: BlockSnapshot[] = [];
    const kept: BlockSnapshot[] = [];
    for (const s of before) {
      const b = byId.get(s.id);
      // Blok, který server v odpovědi nevrátil, nemá „po" stav — vynechává se
      // z OBOU stran, jinak by redo zapisoval do prázdna.
      if (!b) continue;
      kept.push(s);
      after.push({
        id: b.id, startTime: b.startTime as string, endTime: b.endTime as string,
        machine: b.machine, updatedAt: b.updatedAt,
        printMinutes: b.printMinutes ?? null, scheduleBypassed: b.scheduleBypassed ?? false,
      });
    }
    if (kept.length === 0) return;
    recordUndo(buildReflowCommand(label, kept, after));
  }

  /**
   * Krok historie po rozdělení zakázky (task S1, etapa S, 19. 8. 2026). `TimelineGrid`
   * provede atomický split a zavolá tohle přes `onSplitDone` — skládání kroku
   * (`buildSplitCommand`) i zápis (`recordUndo`) žije TADY, ne v `TimelineGrid`,
   * jinak by se logika zapisování historie rozpadla do dvou souborů.
   *
   * Do 19. 8. 2026 split krok NEZAPISOVAL vůbec, takže Ctrl+Z po něm sáhl po
   * PŘEDCHOZÍ, cizí akci — u splitu závažnější než u přepočtu, protože chain push
   * tam běží BEZPODMÍNEČNĚ u každé zakázky (žádný opt-in `resolveChain`).
   *
   * Strop `UNDO_MAX_OPS`, stejná pojistka jako `recordReflowUndo` — když dávka
   * (ocas + hlava + odsunutí) přeroste, krok se ZÁMĚRNĚ nezaznamená a uživateli
   * se to řekne — endpoint undo by ji stejně odmítl 400 a mlčky zaznamenaný krok
   * by v historii jen svítil jako past. Dnes takovou dávku umí vrátit jen správce
   * ze záznamu revizí (`BlockRevision`) — tlačítko „Vrátit tuto změnu" v historii
   * bloku ani endpoint pro to (etapa D) zatím NEEXISTUJÍ. Až etapa D vznikne,
   * text hlášky níže se má vrátit k odkazu na tlačítko v historii bloku.
   */
  function handleSplitDone(data: SplitDoneInfo): void {
    const { head, tail, shifted, before, headLive } = data;
    const opCount = 1 /* ocas */ + 1 /* hlava */ + before.shifted.length;
    if (opCount > UNDO_MAX_OPS) {
      console.error("[historie] krok rozdělení se nezaznamenal — dávka přerostla strop", {
        blocks: opCount, max: UNDO_MAX_OPS,
      });
      showToast(
        `Rozdělení zasáhlo ${opCount} bloků — na Ctrl+Z je to moc. Vrátit ho umí jen správce ze záznamu revizí.`,
        "info",
      );
      return;
    }
    const snap = (b: Block): BlockSnapshot => ({
      id: b.id, startTime: b.startTime as string, endTime: b.endTime as string,
      machine: b.machine, updatedAt: b.updatedAt,
      printMinutes: b.printMinutes ?? null, scheduleBypassed: b.scheduleBypassed ?? false,
    });
    recordUndo(buildSplitCommand(
      "Rozdělení bloku",
      {
        id: headLive.id,
        // Jen pole, která split SKUTEČNĚ mění (CLAUDE.md) — startTime/machine se
        // do kroku historie nedávají, split je nemění.
        beforeFields: {
          endTime: before.head.endTime,
          splitGroupId: before.head.splitGroupId,
          printMinutes: before.head.printMinutes,
          scheduleBypassed: before.head.scheduleBypassed,
        },
        afterFields: {
          endTime: head.endTime,
          splitGroupId: head.splitGroupId,
          printMinutes: head.printMinutes ?? null,
          scheduleBypassed: head.scheduleBypassed ?? false,
        },
        beforeUpdatedAt: before.head.updatedAt,
        afterUpdatedAt: head.updatedAt,
      },
      { id: tail.id, updatedAt: tail.updatedAt, fields: blockToRestoreFields(tail), createdAt: tail.createdAt },
      before.shifted,
      shifted.map(snap),
    ));
  }

  async function handleReflowMachine(machine: string) {
    try {
      const res = await fetchWithCascadeConfirm("/api/blocks/reflow", "POST", { machine }, askCascade);
      if (isCascadeDeclined(res)) return; // uživatel kaskádu zamítl — nic se nestalo, mlčíme
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error ?? "Přepočet se nepodařilo dokončit.", "error");
        return;
      }
      if (Array.isArray(data.blocks) && data.blocks.length) applyServerBlocks(data.blocks);
      recordReflowUndo("Přepočet stroje", data.before, Array.isArray(data.blocks) ? data.blocks : []);
      const reflowedCount = Array.isArray(data.reflowed) ? data.reflowed.length : 0;
      const skippedCount = Array.isArray(data.skipped) ? data.skipped.length : 0;
      showToast(
        reflowMachineToast({
          reflowedCount,
          skippedCount,
          movedCount: typeof data.movedCount === "number" ? data.movedCount : 0,
        }),
        "success",
      );
    } catch (error) {
      console.error("Reflow machine failed", error);
      showToast("Přepočet se nepodařilo dokončit.", "error");
    }
  }

  async function handleReflowBlock(blockId: number) {
    try {
      const res = await fetchWithCascadeConfirm(`/api/blocks/${blockId}/reflow`, "POST", {}, askCascade);
      if (isCascadeDeclined(res)) return; // uživatel kaskádu zamítl — nic se nestalo, mlčíme
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error ?? "Přepočet se nepodařilo dokončit.", "error");
        return;
      }
      // Hlášení musí rozlišit dva různé výsledky se stejným `changed: true`: skutečný
      // posun a pouhé zrušení zbytkové značky (u té se plán nehne ani o minutu).
      // Porovnání proti stavu PŘED applyServerBlocks — potom už je přepsaný.
      const before = blocksRef.current.find((b) => b.id === blockId);
      const timesMoved =
        !before || before.startTime !== data.block?.startTime || before.endTime !== data.block?.endTime;
      applyServerBlocks([data.block, ...(data.moves ?? [])]);
      recordReflowUndo("Přepočet bloku", data.before, [data.block, ...(data.moves ?? [])]);
      showToast(
        reflowBlockToast({
          changed: data.changed === true,
          timesMoved,
          movedCount: Array.isArray(data.moves) ? data.moves.length : 0,
        }),
        "success",
      );
    } catch (error) {
      console.error("Reflow block failed", error);
      showToast("Přepočet se nepodařilo dokončit.", "error");
    }
  }

  async function handleQueueDrop(itemId: number | string, machine: string, rawStartTime: Date) {
    const item = queue.find((q) => q.id === itemId) ?? reservationQueue.find((r) => r.id === itemId);
    if (!item) return;
    const durationMs = item.durationHours * 60 * 60 * 1000;
    // ZAKAZKA a REZERVACE (etapa 9) → model tiskových hodin: start-only snap, server
    // dopočítá autoritativní end z printMinutes. UDRZBA → duration-based snap (rigidní).
    // Nový item z fronty záznam nemá → rozhoduje typ (typeUsesTiskoveHodiny).
    const isZakazka = typeUsesTiskoveHodiny(item.type);
    const pm = Math.round(item.durationHours * 60);
    let startTime = rawStartTime;
    if (workingTimeLockRef.current) {
      if (isZakazka) {
        const snapped = snapStartToNextRunnableSlot(
          machine, rawStartTime, machineWeekShifts, companyDayIntervalsFor(machine, companyDays)
        );
        if (!snapped) {
          showToast("V okolí není žádný pracovní slot — nelze naplánovat.", "error");
          setDraggingQueueItem(null);
          return;
        }
        if (snapped.getTime() !== rawStartTime.getTime()) {
          showToast("Blok umístěn do nejbližšího dostupného slotu (mimo pracovní dobu).", "info");
        }
        startTime = snapped;
      } else {
        const rawSnapped = snapToNextValidStartWithTemplates(machine, rawStartTime, durationMs, machineWeekShifts);
        if (rawSnapped.getTime() !== rawStartTime.getTime()) {
          showToast("Blok umístěn do nejbližšího dostupného slotu (mimo pracovní dobu).", "info");
        }
        startTime = rawSnapped;
      }
    }
    const rType = item.recurrenceType ?? "NONE";
    const rCount = rType !== "NONE" ? Math.max(1, item.recurrenceCount ?? 1) : 1;

    const baseBody: Record<string, unknown> = {
      orderNumber: item.orderNumber,
      machine,
      type: item.type,
      blockVariant: item.blockVariant,
      jobPresetId: item.jobPresetId ?? null,
      description: item.description || null,
      dataStatusId: item.dataStatusId,
      dataStatusLabel: item.dataStatusLabel,
      dataRequiredDate: item.dataRequiredDate || null,
      materialStatusId: item.materialStatusId,
      materialStatusLabel: item.materialStatusLabel,
      materialRequiredDate: item.materialInStock ? null : item.materialRequiredDate || null,
      materialInStock: item.materialInStock,
      // Guard stejný jako u materialRequiredDate o pár řádků výš: je-li SKLADEM
      // zapnuté, termín se neposílá (obrana do hloubky — tenhle invariant vynucuje
      // i POST i PUT /api/blocks, ale nespoléháme jen na server; klient nemá důvod
      // posílat protichůdný pár SKLADEM=true + konkrétní termín).
      pantoneRequiredDate: item.pantoneInStock ? null : item.pantoneRequiredDate || null,
      pantoneOk: item.pantoneOk,
      pantoneRequired: item.pantoneRequired ?? false,
      // pantoneInStock se posílá stejně jako materialInStock o pár řádků výš. pantoneIssued
      // se sem záměrně NEPŘIDÁVÁ (stejně jako materialIssued o pár řádků výš) — z fronty
      // vzniká vždy nový blok, takže „vydáno" nikdy není true a sloupec má na serveru
      // default false.
      pantoneInStock: item.pantoneInStock ?? false,
      barvyStatusId: item.barvyStatusId,
      barvyStatusLabel: item.barvyStatusLabel,
      lakStatusId: item.lakStatusId,
      lakStatusLabel: item.lakStatusLabel,
      specifikace: item.specifikace || null,
      deadlineExpedice: item.deadlineExpedice || null,
      recurrenceType: rType,
      obalka: item.obalka ?? false,
      vnitrky: item.vnitrky ?? false,
      tiskoveArchy: serializeProductionTags(item.tiskoveArchy ?? []),
      serie: serializeProductionTags(item.serie ?? []),
      // Rezervace — pokud jde o rezervační item, přidat reservationId
      ...(item.reservationId !== undefined && { reservationId: item.reservationId }),
    };

    const isReservationItem = item.reservationId !== undefined;
    const removeFromQueue = () => {
      if (isReservationItem) {
        setReservationQueue((prev) => prev.filter((q) => q.id !== itemId));
      } else {
        setQueue((prev) => prev.filter((q) => q.id !== itemId));
      }
    };

    // Umístění z fronty je JEDNO gesto uživatele, i když série vytváří rodičovský
    // blok a pak každý výskyt zvlášť ve smyčce níž — po prvním potvrzení kaskády se
    // další bloky dávky už neptají (askOncePerGesture, sdílené s ostatními místy).
    const askOnce = askOncePerGesture(askCascade);
    try {
      // Vytvořit první (rodičovský) blok
      const firstEnd = new Date(startTime.getTime() + durationMs);
      const queueParentBody = {
        ...baseBody,
        startTime: startTime.toISOString(),
        endTime: firstEnd.toISOString(),
        ...(isZakazka ? { printMinutes: pm } : {}),
        bypassScheduleValidation: !workingTimeLockRef.current,
        resolveChain: true,
      };
      const res1 = await fetchWithCascadeConfirm("/api/blocks", "POST", queueParentBody, askOnce);
      if (isCascadeDeclined(res1)) {
        // Uživatel kaskádu zamítl — nic se nestalo, mlčíme (žádný toast).
        setDraggingQueueItem(null);
        return;
      }
      if (!res1.ok) {
        const err = await res1.json().catch(() => ({})) as { error?: string; code?: string };
        // Jen 409 z důvodu „rezervace už není QUEUE_READY" (naplánoval ji mezitím
        // někdo jiný) znamená zastaralý seznam. Ostatní 409 (typicky OVERLAP —
        // místo blokuje zamčená nebo odklepnutá zakázka) mají vlastní srozumitelný
        // text ze serveru a výzva k obnovení stránky by uživatele posílala jinam.
        if (res1.status === 409 && isReservationItem && err.code === "RESERVATION_NOT_AVAILABLE") {
          showToast(`Rezervace ${item.reservationCode ?? ""} už není dostupná — obnovte stránku.`, "error");
          setDraggingQueueItem(null);
          return;
        }
        throw new Error(err.error ?? "Chyba serveru");
      }
      const parentBlock: Block = await res1.json();
      const queueShift = snapshotShiftedFromResponse(parentBlock); // před handleBlockCreate!
      handleBlockCreate(parentBlock);
      if (canUndoCreated(parentBlock)) {
        recordUndo(buildCreateCommand("Umístění z fronty", [
          { id: parentBlock.id, updatedAt: parentBlock.updatedAt, fields: blockToRestoreFields(parentBlock) },
        ], queueShift.before, queueShift.after));
      }

      // Vytvořit children bloky (pokud opakování > 1).
      // resolveChain → server umístí každý výskyt na cíl a odsune navazující bloky.
      // autoShiftIfBusy → parita s handleScheduleSeries: výskyt bez místa se posune, ne zamítne.
      let createdChildren = 0;
      const shiftedToasts: Array<{ original: string; final: string }> = [];
      const failedSlots: Array<{ date: string; reason: string }> = [];
      // Zamítnutí zastaví CELOU zbývající sérii (viz `break` níž) — nastaví se
      // jen když k tomu doopravdy dojde, aby souhrn níž rozlišil "zamítnuto" od
      // "nastala chyba" (finální review, bod 5).
      let declinedMidSeries = false;
      if (rType !== "NONE" && rCount > 1) {
        let curStart = addRecurrenceInterval(startTime, rType);
        for (let i = 1; i < rCount; i++) {
          const curEnd = new Date(curStart.getTime() + durationMs);
          try {
            const res = await fetchWithCascadeConfirm(
              "/api/blocks",
              "POST",
              {
                ...baseBody,
                startTime: curStart.toISOString(),
                endTime: curEnd.toISOString(),
                ...(isZakazka ? { printMinutes: pm } : {}),
                recurrenceParentId: parentBlock.id,
                bypassScheduleValidation: !workingTimeLockRef.current,
                resolveChain: true,
                autoShiftIfBusy: true,
              },
              askOnce,
            );
            if (res.ok) {
              const childBlock: Block & { autoShift?: { originalStart: string } } = await res.json();
              handleBlockCreate(childBlock);
              createdChildren++;
              if (childBlock.autoShift) {
                const orig = new Date(childBlock.autoShift.originalStart);
                const final = new Date(childBlock.startTime);
                const fmt = (d: Date) => d.toLocaleString("cs-CZ", {
                  timeZone: "Europe/Prague",
                  day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
                });
                shiftedToasts.push({ original: fmt(orig), final: fmt(final) });
              }
            } else if (isCascadeDeclined(res)) {
              // Uživatel kaskádu zamítl — nic se nestalo, netahat do failedSlots
              // (není to chyba). Série je JEDNO gesto (askOnce), takže zamítnutí
              // bereme za rozhodnutí o CELÉ zbývající sérii — bez `break` by se
              // `askOncePerGesture` zeptal znovu u dalšího výskytu a plánovač by
              // odklikával tentýž dialog opakovaně (finální review, bod 5).
              declinedMidSeries = true;
              break;
            } else {
              const err = await res.json().catch(() => ({ error: "neznámá chyba" }));
              const dateLabel = curStart.toLocaleString("cs-CZ", {
                timeZone: "Europe/Prague",
                day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
              });
              failedSlots.push({ date: dateLabel, reason: err.error ?? "chyba serveru" });
            }
          } catch {
            const dateLabel = curStart.toLocaleString("cs-CZ", {
              timeZone: "Europe/Prague",
              day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
            });
            failedSlots.push({ date: dateLabel, reason: "síťová chyba" });
          }
          curStart = addRecurrenceInterval(curStart, rType);
        }
      }

      // Per-blok info-toasty pro auto-shift (max 5, aby se uživatel neutopil v toastech)
      shiftedToasts.slice(0, 5).forEach((s) => {
        showToast(`${s.original} → ${s.final} — přesunuto z kapacitních důvodů`, "info");
      });
      if (shiftedToasts.length > 5) {
        showToast(`+${shiftedToasts.length - 5} dalších bloků posunuto. Zkontroluj timeline.`, "info");
      }

      // Souhrn série — bez tohoto větev tiše přeskočila výskyty, které se
      // nepodařilo umístit NEBO se vůbec nevytvořily (zamítnutá kaskáda,
      // finální review bod 5 — "objednal 10, dostal 2, nedozvěděl se nic").
      const totalOccurrences = rCount - 1;
      if (declinedMidSeries) {
        showToast(
          `Autoposun zrušen — vytvořeno ${createdChildren} z ${totalOccurrences} výskytů, zbytek se nevytvořil.`
          + (failedSlots.length > 0 ? ` (${failedSlots.length} dalších se navíc nepodařilo umístit.)` : ""),
          "info",
        );
      } else if (failedSlots.length > 0) {
        showToast(
          `Série: vytvořeno ${createdChildren}/${totalOccurrences} výskytů. ${failedSlots.length} se nepodařilo umístit — zkontroluj timeline.`,
          "error"
        );
      }

      removeFromQueue();
      setDraggingQueueItem(null);
      const y = dateToY(startTime, viewStart, gridSlotHeight);
      scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
    } catch (error) {
      console.error("Queue drop block creation failed", error);
      showToast(error instanceof Error ? error.message : "Chyba při vytváření bloku.", "error");
      setDraggingQueueItem(null);
    }
  }

  function handleBlockDoubleClick(block: Block) {
    if (!canEdit) return;
    setSelectedBlock(null);
    setEditingBlock(block);
  }

  async function handlePasteWithTarget(target: { machine: string; time: Date }) {
    const src = copiedBlockRef.current;
    if (!src) return;
    const durationMs = new Date(src.endTime).getTime() - new Date(src.startTime).getTime();
    const rawStart = target.time;
    // Existující blok → rozhoduje záznam (usesTiskoveHodiny): tisková rezervace jde
    // start-only snap + printMinutes, legacy rezervace bez pm zůstává duration-based.
    const isZakazka = usesTiskoveHodiny(src);
    let newStart = rawStart;
    if (workingTimeLockRef.current) {
      if (isZakazka) {
        const snapped = snapStartToNextRunnableSlot(
          target.machine, rawStart, machineWeekShifts, companyDayIntervalsFor(target.machine, companyDays)
        );
        if (!snapped) {
          showToast("V okolí není žádný pracovní slot — nelze vložit.", "error");
          return;
        }
        newStart = snapped;
      } else {
        newStart = snapToNextValidStartWithTemplates(target.machine, rawStart, durationMs, machineWeekShifts);
      }
    }
    // Naivní end jako fallback — server pro ZAKAZKA autoritativně přepočítá z printMinutes.
    const newEnd = new Date(newStart.getTime() + durationMs);
    if (isCutRef.current) {
      // CUT = PŘESUN existujícího bloku (PUT, stejná cesta jako drag) — zachová
      // splitGroupId, historii auditu, vazbu na rezervaci i tiskařské poznámky.
      // Bod 17 auditu: dřívější POST kopie + DELETE originálu rozbíjel split skupiny.
      if (cutMoveInFlightRef.current) return;
      // Čerstvý stav bloku z blocksRef — clipboard je snapshot z okamžiku Ctrl+X a SSE
      // ho neobčerstvuje: printMinutes by po cizím resize byl zastaralý a locked/printed
      // guard z Ctrl+X mohl mezitím přestat platit (TOCTOU).
      const fresh = blocksRef.current.find((b) => b.id === src.id) ?? src;
      if (fresh.locked || fresh.printCompletedAt) {
        showToast(fresh.locked ? "Blok byl mezitím zamčen — nelze přesunout." : "Blok byl mezitím vytištěn — nelze přesunout.", "info");
        return;
      }
      // F4 (finální review etapy 9): rozhoduje ČERSTVÁ klasifikace, ne `isZakazka`
      // odvozená ze snapshotu `src` z okamžiku Ctrl+X — mezitím se mohla typ/printMinutes
      // bloku změnit (jinde v appce, SSE clipboard neobčerstvuje) a stará klasifikace
      // by poslala špatnou dvojici polí (printMinutes vs. endTime).
      const freshIsZakazka = usesTiskoveHodiny(fresh);
      const moveBody: Record<string, unknown> = {
        startTime: newStart.toISOString(),
        machine: target.machine,
        bypassScheduleValidation: !workingTimeLockRef.current,
        resolveChain: true,
      };
      if (freshIsZakazka) {
        moveBody.printMinutes = blockPrintMinutes(fresh);
      } else {
        const freshDurationMs = new Date(fresh.endTime).getTime() - new Date(fresh.startTime).getTime();
        moveBody.endTime = new Date(newStart.getTime() + freshDurationMs).toISOString();
      }
      cutMoveInFlightRef.current = true;
      try {
        const res = await fetchWithCascadeConfirm(`/api/blocks/${src.id}`, "PUT", moveBody, askCascade);
        if (isCascadeDeclined(res)) return; // uživatel kaskádu zamítl — nic se nestalo, mlčíme
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? "Chyba serveru");
        }
        const updated: Block = await res.json();
        handleBlockUpdate(updated, true); // stav + shifted sousedé + move-undo
        setCopiedBlock(null);
        setIsCut(false);
      } catch (error) {
        console.error("Block cut-move failed", error);
        showToast(error instanceof Error ? error.message : "Chyba při přesunu bloku.", "error");
      } finally {
        cutMoveInFlightRef.current = false;
      }
      return;
    }
    // Kompletní Block→payload mapa (audit #2) — kopie nese i pantone/SKLADEM/materialNote;
    // vkládá se vždy odemčená (locked: false). Sdílená cesta s group paste (buildPasteBody).
    const pasteBody = buildPasteBody(src, target.machine, newStart, newEnd, !workingTimeLockRef.current);
    try {
      const res = await fetchWithCascadeConfirm("/api/blocks", "POST", pasteBody, askCascade);
      if (isCascadeDeclined(res)) return; // uživatel kaskádu zamítl — nic se nestalo, mlčíme
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Chyba serveru");
      }
      const newBlock: Block = await res.json();
      const pasteShift = snapshotShiftedFromResponse(newBlock); // před handleBlockCreate!
      handleBlockCreate(newBlock);
      if (canUndoCreated(newBlock)) {
        recordUndo(buildCreateCommand("Vložení bloku", [
          { id: newBlock.id, updatedAt: newBlock.updatedAt, fields: blockToRestoreFields(newBlock) },
        ], pasteShift.before, pasteShift.after));
      }
    } catch (error) {
      console.error("Block paste failed", error);
      showToast(error instanceof Error ? error.message : "Chyba při vložení bloku.", "error");
    }
  }

  async function handlePaste() {
    if (!copiedBlockRef.current) {
      showToast("Žádný blok není zkopírován. Nejdřív klikni na blok a Ctrl+C.", "info");
      return;
    }
    if (!pasteTargetRef.current) {
      showToast("Klikni na timeline kde má být vložen, pak Ctrl+V.", "info");
      return;
    }
    await handlePasteWithTarget(pasteTargetRef.current);
  }

  async function handleGroupPasteWithTarget(target: { machine: string; time: Date }) {
    const group = clipboardGroupRef.current;
    if (group.length === 0) return;
    // Anchor = nejstarší startTime ve skupině
    const anchorMs = Math.min(...group.map((b) => new Date(b.startTime).getTime()));
    const anchorBlock = group.find((b) => new Date(b.startTime).getTime() === anchorMs)!;
    const anchorDuration = new Date(anchorBlock.endTime).getTime() - anchorMs;
    const allZakazka = group.every((b) => usesTiskoveHodiny(b));
    // Snap anchor pokud je lock zapnutý. Čistě ZAKAZKA skupina: start-only snap
    // (délku rozloží server expanzí přes printMinutes u každého bloku zvlášť).
    // Smíšená skupina: starý duration-based snap přes celou délku anchor bloku.
    let snappedTarget: Date;
    if (workingTimeLockRef.current) {
      if (allZakazka) {
        const snapped = snapStartToNextRunnableSlot(
          target.machine, target.time, machineWeekShifts, companyDayIntervalsFor(target.machine, companyDays)
        );
        if (!snapped) {
          showToast("V okolí není žádný pracovní slot — nelze vložit.", "error");
          return;
        }
        snappedTarget = snapped;
      } else {
        snappedTarget = snapToNextValidStartWithTemplates(target.machine, target.time, anchorDuration, machineWeekShifts);
      }
    } else {
      snappedTarget = target.time;
    }
    const pasteMs = snappedTarget.getTime();

    if (isGroupCutRef.current) {
      // Skupinový CUT = hromadný PŘESUN (batch PUT, stejná cesta jako lasso drag) —
      // žádné POST kopie + DELETE originálů (bod 17 auditu: rozbíjelo split skupiny
      // a historii). Sémantika cíle zachována: všechny bloky na target.machine
      // s offsetem vůči anchoru (geometrie z clipboard snapshotu — rozložení, jak ho
      // uživatel vyjmul). Případné 422 (nevalidní start některého členu při zámku
      // pracovní doby) vrátí batch jako celek a clipboard ZŮSTÁVÁ pro retry jinam.
      if (cutMoveInFlightRef.current) return;
      // TOCTOU re-check: zamčení/vytištění některého členu mezi Ctrl+X a Ctrl+V
      const blockedNow = group
        .map((g) => blocksRef.current.find((b) => b.id === g.id) ?? g)
        .filter((b) => b.locked || b.printCompletedAt);
      if (blockedNow.length > 0) {
        showToast(`${blockedNow.length} blok(y) byly mezitím zamčeny/vytištěny — nelze přesunout.`, "info");
        return;
      }
      const updates = group.map((src) => {
        const offsetMs = new Date(src.startTime).getTime() - anchorMs;
        const durationMs = new Date(src.endTime).getTime() - new Date(src.startTime).getTime();
        const newStart = new Date(pasteMs + offsetMs);
        return { id: src.id, startTime: newStart, endTime: new Date(newStart.getTime() + durationMs), machine: target.machine };
      });
      cutMoveInFlightRef.current = true;
      try {
        const ok = await handleMultiBlockUpdate(updates); // batch PUT + undo „Hromadný přesun" + toast při chybě
        if (!ok) return; // selhání → clipboard i výběr zůstávají, uživatel může Ctrl+V jinam
        clipboardGroupRef.current = [];
        isGroupCutRef.current = false;
        setSelectedBlockIds(new Set());
      } finally {
        cutMoveInFlightRef.current = false;
      }
      return;
    }

    // POST všechny bloky sekvenčně — při prvním selhání se zastaví a žádný lokální stav se nezmění
    const created: Block[] = [];
    // Vložení skupiny je JEDNO gesto uživatele, i když je to N requestů. Po prvním
    // potvrzení se další bloky skupiny už neptají — jinak by plánovač odklikával
    // tentýž dialog pro každý blok zvlášť.
    const askOnce = askOncePerGesture(askCascade);
    try {
      for (const src of group) {
        const offsetMs = new Date(src.startTime).getTime() - anchorMs;
        const durationMs = new Date(src.endTime).getTime() - new Date(src.startTime).getTime();
        const newStart = new Date(pasteMs + offsetMs);
        const newEnd = new Date(newStart.getTime() + durationMs);
        // Sdílená cesta s handlePasteWithTarget (buildPasteBody) — request flagy se nerozejdou.
        const groupBody = buildPasteBody(src, target.machine, newStart, newEnd, !workingTimeLockRef.current);
        const res = await fetchWithCascadeConfirm("/api/blocks", "POST", groupBody, askOnce);
        if (isCascadeDeclined(res)) throw CASCADE_DECLINED_SIGNAL;
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        created.push(await res.json() as Block);
      }
    } catch (err) {
      // Uživatel kaskádu zamítl — zachází se s tím jako se zrušením celé dávky
      // (stejný rollback jako u chyby). Tichý je jen ÚSPĚŠNÝ rollback (nic
      // nezůstalo, nic se opravdu nestalo) — když rollback SÁM selže a bloky
      // zůstanou v DB, ozve se i při zamítnutí (viz toast níž, finální review bod 4).
      const declined = err === CASCADE_DECLINED_SIGNAL;
      if (!declined) console.error("Group paste failed", err);
      // Rollback: smaž bloky, které se stihly vytvořit před selháním
      if (created.length > 0) {
        const rollbackResults = await Promise.allSettled(
          created.map((b) => fetch(`/api/blocks/${b.id}`, { method: "DELETE" }).then((r) => {
            if (!r.ok) throw new Error(`Rollback DELETE ${b.id} HTTP ${r.status}`);
          }))
        );
        const rollbackFailed = rollbackResults.filter((r) => r.status === "rejected");
        if (rollbackFailed.length > 0) {
          console.error("Group paste rollback partial failure", rollbackFailed);
          // allSettled zachovává pořadí — blok na indexu i odpovídá rollbackResults[i]
          const survivingBlocks = created.filter((_, i) => rollbackResults[i].status === "rejected");
          survivingBlocks.forEach((b) => handleBlockCreate(b));
          // Tenhle toast NENÍ o kaskádě — hlásí, že SELHAL ROLLBACK a bloky
          // zůstaly v DB. To je pravda bez ohledu na to, jestli dávku zastavila
          // chyba nebo uživatelovo "Zrušit" — mlčet by tu bylo horší než hláška
          // (finální review, bod 4). Jen se přeformuluje, ať nezní jako pád.
          showToast(
            declined
              ? `Vložení zrušeno — ${survivingBlocks.length} blok(ů) zůstal(y) v DB. Zkontroluj timeline.`
              : `Chyba vložení — ${survivingBlocks.length} blok(ů) zůstal(y) v DB. Zkontroluj timeline.`,
            "error",
          );
          return;
        }
      }
      if (declined) return;
      const errMsg = err instanceof Error ? err.message : "Chyba při vložení skupiny";
      showToast(`${errMsg} — žádné bloky nebyly přidány.`, "error");
      return;
    }

    // Všechny POST proběhly úspěšně — přidej do lokálního stavu.
    // Server (resolveChain) umístil každý blok na cíl a odsunul navazující; handleBlockCreate
    // aplikuje i posunuté bloky (pole shifted).
    // Snapshot odsunutých ze VŠECH odpovědí musí vzniknout před prvním
    // handleBlockCreate — jakmile se stav přepíše, staré pozice jsou pryč.
    // Blok vytvořený dřív v této dávce může být v `shifted` pozdějšího POSTu;
    // ten do undo nepatří (vrací ho už buildCreateCommand jako created), proto
    // se odfiltruje podle id.
    // Týž soused může být v `shifted` několika odpovědí (POST 1 ho odsunul,
    // POST 2 znovu). Pro undo je správné PRVNÍ `before` (původní pozice před
    // celou dávkou) a POSLEDNÍ `after` (kde blok reálně skončil).
    const groupCreatedIds = new Set(created.map((b) => b.id));
    const groupBeforeById = new Map<number, BlockSnapshot>();
    const groupAfterById = new Map<number, BlockSnapshot>();
    for (const b of created) {
      const snap = snapshotShiftedFromResponse(b);
      snap.before.forEach((x, i) => {
        if (groupCreatedIds.has(x.id)) return; // vytvořené bloky řeší created, ne shifted
        if (!groupBeforeById.has(x.id)) groupBeforeById.set(x.id, x);
        groupAfterById.set(x.id, snap.after[i]);
      });
    }
    const groupShiftBefore = [...groupBeforeById.values()];
    const groupShiftAfter = groupShiftBefore.map((b) => groupAfterById.get(b.id)!);
    created.forEach((b) => handleBlockCreate(b));

    // Filtrovat na undo-schopné (ne-rezervační, ne-sériové), pak blockToRestoreFields
    // z ODPOVĚDI serveru (ne z POST payloadu) — nese všech 43 sloupců tak, jak je server
    // reálně uložil, ne jen to, co bylo v request bodě.
    const createdRefs = created
      .filter((b) => canUndoCreated(b))
      .map((b) => ({ id: b.id, updatedAt: b.updatedAt, fields: blockToRestoreFields(b) }));
    if (createdRefs.length > 0) {
      recordUndo(buildCreateCommand("Vložení skupiny", createdRefs, groupShiftBefore, groupShiftAfter));
    }

  }

  async function handleGroupPaste() {
    if (clipboardGroupRef.current.length === 0) {
      showToast("Žádné bloky nejsou zkopírovány.", "info");
      return;
    }
    if (!pasteTargetRef.current) {
      showToast("Klikni na timeline kde má být vložen, pak Ctrl+V.", "info");
      return;
    }
    await handleGroupPasteWithTarget(pasteTargetRef.current);
  }

  // Right-click → "Vložit zde" — přijímá target přímo (state setteru ještě
  // neproběhl, proto target pasujeme přes parametr; setPasteTarget jen kvůli
  // markeru / další interakci).
  function handlePasteHere(machine: string, time: Date) {
    const target = { machine, time };
    setPasteTarget(target);
    if (clipboardGroupRef.current.length > 0) {
      void handleGroupPasteWithTarget(target);
    } else if (copiedBlockRef.current) {
      void handlePasteWithTarget(target);
    } else {
      showToast("Žádný blok není zkopírován. Nejdřív klikni na blok a Ctrl+C.", "info");
    }
  }

  // Sdílené tělo Ctrl+X jednoblokové větve — volá ho klávesový handler NÍŽE
  // i položka menu "✂ Vyjmout" (BlockCard → TimelineGrid → sem). Cut = přesun
  // existujícího bloku (PUT) — zamčený/vytištěný blok se přesunout nesmí,
  // stejně jako u dragu. Guard tady, ať UI selže srozumitelně dřív než server.
  function cutSingleBlock(block: Block) {
    if (block.locked || block.printCompletedAt) {
      showToast(block.locked ? "Zamčený blok nelze vyjmout." : "Vytištěný blok nelze vyjmout.", "info");
      return;
    }
    setCopiedBlock(block);
    setIsCut(true);
    clipboardGroupRef.current = [];
    isGroupCutRef.current = false;
    setPasteTarget(computePasteTargetFromBlock(block));
    showToast("Blok vyříznut. Ctrl+V ho přesune těsně za originál.", "info");
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        setSelectedBlockIds(new Set());
        // Vyčistit i clipboard + paste target + hledání — Esc = "zruš vše"
        setCopiedBlock(null);
        setIsCut(false);
        setPasteTarget(null);
        clipboardGroupRef.current = [];
        isGroupCutRef.current = false;
        // Deselekt ADRESNĚ tady, ne uvnitř `clearSearch` (viz komentář u ní):
        // "zruš vše" zavřít detail chce, klik na blok ani křížek v hledání ne.
        setSelectedBlock(null);
        clearSearch();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedBlockIdsRef.current.size > 0) {
        e.preventDefault();
        setMultiDeletePending(true);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedBlockRef.current) {
        // Otevřený menu-delete dialog (🗑 Odstranit): Delete klávesa nesmí
        // přepnout cíl dialogu na selectedBlock — smazal by se jiný blok,
        // než dialog ukazuje (nález I1 finálního review etapy 7).
        if (menuDeleteBlockRef.current) return;
        e.preventDefault();
        setKeyDeletePending(true);
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (isShortcut(e, "z") && !e.shiftKey) {
        e.preventDefault();
        void undoMgr();
        return;
      }
      if (isShortcut(e, "y") || (isShortcut(e, "z") && e.shiftKey)) {
        e.preventDefault();
        void redoMgr();
        return;
      }
      // Priorita: skupinové operace, pokud je vybráno více bloků lasem
      if (isShortcut(e, "c") && selectedBlockIdsRef.current.size > 0) {
        e.preventDefault();
        const group = blocksRef.current.filter((b) => selectedBlockIdsRef.current.has(b.id));
        clipboardGroupRef.current = group;
        isGroupCutRef.current = false;
        const target = computePasteTargetFromGroup(group);
        if (target) setPasteTarget(target);
        showToast(`Zkopírováno ${group.length} bloků. Ctrl+V je vloží za poslední, nebo klikni jinam.`, "info");
        return;
      }
      if (isShortcut(e, "x") && selectedBlockIdsRef.current.size > 0) {
        e.preventDefault();
        const group = blocksRef.current.filter((b) => selectedBlockIdsRef.current.has(b.id));
        // Cut = přesun (batch PUT) — zamčený/vytištěný blok se přesunout nesmí (parita s dragem)
        const blocked = group.filter((b) => b.locked || b.printCompletedAt);
        if (blocked.length > 0) {
          showToast(`Výběr obsahuje ${blocked.length} zamčený/vytištěný blok(y) — nelze vyjmout.`, "info");
          return;
        }
        clipboardGroupRef.current = group;
        isGroupCutRef.current = true;
        const target = computePasteTargetFromGroup(group);
        if (target) setPasteTarget(target);
        showToast(`Vyříznuto ${group.length} bloků. Ctrl+V je přesune za poslední.`, "info");
        return;
      }
      if (isShortcut(e, "v") && clipboardGroupRef.current.length > 0) {
        e.preventDefault();
        void handleGroupPaste();
        return;
      }
      // Fallback: jednoblokové operace
      if (isShortcut(e, "c") && selectedBlockRef.current) {
        e.preventDefault();
        setCopiedBlock(selectedBlockRef.current);
        setIsCut(false);
        // Vyčistit group clipboard — single copy přebírá precedenci
        clipboardGroupRef.current = [];
        isGroupCutRef.current = false;
        // Auto-set pasteTarget za zdrojový blok, aby Ctrl+V hned fungoval
        setPasteTarget(computePasteTargetFromBlock(selectedBlockRef.current));
        showToast("Blok zkopírován. Ctrl+V vloží těsně za originál, nebo klikni jinam pro jiné místo.", "info");
        return;
      }
      if (isShortcut(e, "x") && selectedBlockRef.current) {
        e.preventDefault();
        cutSingleBlock(selectedBlockRef.current);
        return;
      }
      // Ctrl+C / Ctrl+X bez jakéhokoliv výběru — explicitní toast místo silent no-op
      if (isShortcut(e, "c") || isShortcut(e, "x")) {
        e.preventDefault();
        showToast("Žádný blok není vybrán. Nejdřív klikni na blok nebo vyber skupinu.", "info");
        return;
      }
      if (isShortcut(e, "v")) {
        e.preventDefault();
        handlePaste();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Jediný zdroj pravdy pro delete-confirm dialog níž — klávesnicová cesta
  // (Delete/Backspace na selectedBlock) i menu cesta (🗑 Odstranit na
  // libovolném bloku) sytí týž stav, aniž by se JSX dialogu duplikovalo.
  // SSE smazání nuluje selectedBlock, ale ne keyDeletePending — bez kontroly
  // &&selectedBlock by zůstal dialog „na prázdno" a uživatel viděl jenom titulek
  // (nález M1 finálního review etapy 7).
  const pendingDeleteBlock = (keyDeletePending && selectedBlock) ? selectedBlock : menuDeleteBlock;

  return (
    <main style={{ height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }} className="bg-background text-foreground">
      {sseOffline && (
        <div className="bg-yellow-600 text-white text-center text-sm py-1 px-4">
          Spojení se serverem přerušeno. Data nemusí být aktuální.
        </div>
      )}
      {/* ── Confirm smazání (klávesnice i menu "🗑 Odstranit") ── */}
      <ConfirmDialog
        open={!!pendingDeleteBlock}
        title="Smazat blok?"
        message={pendingDeleteBlock ? `${pendingDeleteBlock.orderNumber}${pendingDeleteBlock.description ? ` — ${pendingDeleteBlock.description}` : ""}` : ""}
        confirmLabel="Smazat"
        danger
        width={pendingDeleteBlock?.reservationId ? 340 : 300}
        autoFocusConfirm={!pendingDeleteBlock?.reservationId}
        onConfirm={() => {
          if (!pendingDeleteBlock) return;
          setKeyDeletePending(false);
          setMenuDeleteBlock(null);
          handleDeleteBlock(pendingDeleteBlock.id, deleteRejectionReason || undefined);
          setDeleteRejectionReason("");
        }}
        onCancel={() => { setKeyDeletePending(false); setMenuDeleteBlock(null); setDeleteRejectionReason(""); }}
      >
        {pendingDeleteBlock?.reservationId && (
          <div style={{ background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.25)", borderRadius: 10, padding: "10px 12px", marginBottom: 16 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: "#c084fc", marginBottom: 8 }}>Propojená rezervace bude zamítnuta</p>
            <input
              type="text"
              placeholder="Důvod zamítnutí (nepovinné)"
              value={deleteRejectionReason}
              onChange={(e) => setDeleteRejectionReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && pendingDeleteBlock) {
                  setKeyDeletePending(false);
                  setMenuDeleteBlock(null);
                  handleDeleteBlock(pendingDeleteBlock.id, deleteRejectionReason || undefined);
                  setDeleteRejectionReason("");
                }
              }}
              autoFocus
              style={{ width: "100%", padding: "8px 12px", fontSize: 12, borderRadius: 8, border: "1px solid rgba(168,85,247,0.3)", background: "rgba(168,85,247,0.08)", color: "var(--text)", outline: "none" }}
            />
          </div>
        )}
      </ConfirmDialog>
      {/* ── Confirm smazání zamčeného/vytištěného bloku (server requiresForce) ── */}
      <ConfirmDialog
        open={forceDeleteConfirm !== null}
        title="Smazat chráněný blok?"
        message={forceDeleteConfirm ? `${forceDeleteConfirm.message} (${forceDeleteConfirm.block.orderNumber})` : ""}
        confirmLabel="Přesto smazat"
        danger
        onConfirm={() => {
          if (!forceDeleteConfirm) return;
          const { block, rejectionReason } = forceDeleteConfirm;
          setForceDeleteConfirm(null);
          deleteSingleBlockWithUndo(block, rejectionReason, true).catch((error) => {
            console.error("Force delete failed", error);
            showToast("Chyba při mazání bloku.", "error");
          });
        }}
        onCancel={() => setForceDeleteConfirm(null)}
      />
      {/* ── Confirm hromadného smazání chráněných bloků (server requiresForce) ── */}
      <ConfirmDialog
        open={multiForceDelete !== null}
        title={`Smazat ${multiForceDelete?.ids.length ?? 0} chráněných bloků?`}
        message="Tyto bloky jsou zamčené nebo mají potvrzený tisk. Smazání je nevratné (undo se pro ně nezaznamenává)."
        confirmLabel="Přesto smazat"
        danger
        onConfirm={() => {
          const ids = multiForceDelete?.ids ?? [];
          setMultiForceDelete(null);
          if (ids.length > 0) forceDeleteMany(ids);
        }}
        onCancel={() => setMultiForceDelete(null)}
      />
      {/* ── Confirm hromadného smazání přes klávesnici ── */}
      <ConfirmDialog
        open={multiDeletePending && selectedBlockIds.size > 0}
        title={`Smazat ${selectedBlockIds.size} ${selectedBlockIds.size === 1 ? "blok" : selectedBlockIds.size < 5 ? "bloky" : "bloků"}?`}
        message="Tato akce je nevratná."
        confirmLabel="Smazat"
        danger
        onConfirm={() => { const ids = [...selectedBlockIds]; setMultiDeletePending(false); setSelectedBlockIds(new Set()); handleDeleteAll(ids); }}
        onCancel={() => setMultiDeletePending(false)}
      />
      {/* ── Confirm velké kaskády autoposunu (server 409 CASCADE_CONFIRM) ── */}
      <ConfirmDialog
        open={cascadeAsk !== null}
        title="Velký autoposun"
        message={cascadeAsk ? cascadeConfirmMessage({
          movedCount: cascadeAsk.payload.movedCount,
          maxShiftMs: cascadeAsk.payload.maxShiftMs,
          farthestEnd: cascadeAsk.payload.farthestEnd ? new Date(cascadeAsk.payload.farthestEnd) : null,
          exceeded: true,
        }) : ""}
        confirmLabel="Posunout i přesto"
        cancelLabel="Zrušit"
        danger
        autoFocusConfirm={false}
        autoFocusCancel
        onConfirm={() => { cascadeAsk?.resolve(true); setCascadeAsk(null); }}
        onCancel={() => { cascadeAsk?.resolve(false); setCascadeAsk(null); }}
      />
      {/* ── TISKAR: Monitor jako domovská obrazovka ── */}
      {isTiskar && tiskarView === "monitor" && (
        <MonitorView
          blocks={blocks}
          viewMachine={viewMachine}
          ownMachine={currentUser.assignedMachine ?? null}
          machineWeekShifts={machineWeekShifts}
          companyDays={companyDays}
          onPrintComplete={
            viewMachine === currentUser.assignedMachine ? handlePrintComplete : undefined
          }
          onOpenPlan={() => setTiskarView("plan")}
          onOpenSearch={() => setSearchSheetOpen(true)}
          onMachineChange={(machine) => setViewMachine(machine)}
          onLogout={handleLogout}
          focusBlockId={monitorFocusId}
          onFocusHandled={() => setMonitorFocusId(null)}
          fontScale={fontScale}
          onFontScaleChange={handleFontScaleChange}
        />
      )}

      {/* ── Header (TISKAR — minimální pruh) ── */}
      {isTiskar && tiskarView === "plan" && (
        <header className="flex-shrink-0 px-4 py-2 flex items-center gap-3" style={{
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}>
          <img src="/logo.png" alt="Integraf" style={{ height: 24, width: "auto", objectFit: "contain", flexShrink: 0 }} />
          <div style={{ width: 1, height: 16, background: "var(--border)", flexShrink: 0 }} />
          <button
            onClick={(e) => { if (e.button !== 0) return; setTiskarView("monitor"); }}
            title="Zpět na Monitor"
            style={{
              padding: "3px 10px", fontSize: 11, borderRadius: 6,
              background: "var(--surface-2)", border: "1px solid var(--border)",
              color: "var(--text)", cursor: "pointer", flexShrink: 0,
            }}
          >
            ← Monitor
          </button>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {currentUser.username}
            <span style={{ marginLeft: 5, fontSize: 10, background: "var(--surface-2)", borderRadius: 4, padding: "1px 5px", color: "var(--text-muted)" }}>
              TISKAŘ
            </span>
          </span>
          <div style={{ flex: 1 }} />
          <TiskarMachineToggle
            machines={["XL_105", "XL_106"] as const}
            activeMachine={viewMachine}
            ownMachine={currentUser.assignedMachine ?? "XL_105"}
            onChange={(machine) => setViewMachine(machine)}
          />
          <button
            onClick={(e) => { if (e.button !== 0) return; setSearchSheetOpen(true); }}
            title="Najít zakázku"
            style={{
              padding: "3px 10px",
              fontSize: 11,
              borderRadius: 6,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            🔍 Najít
          </button>
          <Button variant="outline" size="sm" onClick={handleScrollToNow} className="h-8 text-xs theme-transition-fast" style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }}>
            Dnes
          </Button>
          <FontScaleSwitch value={fontScale} onChange={handleFontScaleChange} />
          <ThemeToggle />
          <button onClick={handleLogout} style={{ padding: "3px 10px", fontSize: 11, borderRadius: 6, background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}>
            Odhlásit
          </button>
        </header>
      )}

      {/* ── Header (ostatní role — plný) ── */}
      {!isTiskar && <header className="flex-shrink-0 px-4 py-2 flex items-center gap-4" style={{
          borderBottom: `1px solid ${headerScrolled ? "color-mix(in oklab, var(--border) 100%, transparent)" : "color-mix(in oklab, var(--border) 70%, transparent)"}`,
          background: headerScrolled ? "color-mix(in oklab, var(--surface) 95%, transparent)" : "color-mix(in oklab, var(--surface) 72%, transparent)",
          backdropFilter: headerScrolled ? "blur(24px) saturate(180%)" : "blur(8px)",
          transition: "background 250ms ease-out, backdrop-filter 250ms ease-out, border-color 250ms ease-out",
        }}>
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Integraf" style={{ height: 28, width: "auto", objectFit: "contain", flexShrink: 0 }} />
        </div>

        <div className="flex items-center gap-2 ml-4 flex-1">
          <SearchField
            value={filterText}
            onChange={(v) => { setFilterText(v); setSearchMatchIndex(0); }}
            onClear={clearSearch}
            onEnter={goToNextMatch}
            ariaLabel="Hledat zakázku v plánu"
          />
          {filterText && (
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              {searchMatches.length > 0 ? (
                <>
                  <button
                    onClick={goToPrevMatch}
                    title="Předchozí výsledek"
                    style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 5, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-muted)", cursor: "pointer", fontSize: 11, lineHeight: 1, transition: "all 120ms ease-out", flexShrink: 0 }}
                  >↑</button>
                  <span style={{ fontSize: 11, whiteSpace: "nowrap", color: "var(--text-muted)", minWidth: 38, textAlign: "center" }}>
                    {searchMatchIndex === 0 ? `${searchMatches.length}` : `${searchMatchIndex}/${searchMatches.length}`}
                  </span>
                  <button
                    onClick={goToNextMatch}
                    title="Další výsledek (Enter)"
                    style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 5, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-muted)", cursor: "pointer", fontSize: 11, lineHeight: 1, transition: "all 120ms ease-out", flexShrink: 0 }}
                  >↓</button>
                </>
              ) : (
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Žádná shoda</span>
              )}
            </div>
          )}
          <div style={{ width: 150 }}>
            <DatePickerField
              value={jumpDate}
              onChange={(v) => { setJumpDate(v); if (v) handleJumpToDate(v); }}
              placeholder="Přejít na datum…"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleScrollToNow}
            className="h-8 text-xs theme-transition-fast"
            style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }}
          >
            Dnes
          </Button>
          <ZoomSlider value={slotHeight} onChange={handleZoomChange} />
          <FontScaleSwitch value={fontScale} onChange={handleFontScaleChange} />
          <div
            role="group"
            aria-label="Rozsah plánování ve dnech"
            style={{
              display: "flex",
              gap: 2,
              padding: 2,
              borderRadius: 999,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              boxShadow: "inset 0 1px 0 color-mix(in oklab, var(--text) 8%, transparent)",
            }}
          >
            {[30, 60, 90].map(d => (
              <button
                key={d}
                type="button"
                aria-pressed={daysAhead === d}
                onClick={() => setDaysAhead(d)}
                style={{
                  minWidth: 36,
                  height: 24,
                  padding: "0 8px",
                  fontSize: 11,
                  fontWeight: daysAhead === d ? 700 : 600,
                  borderRadius: 999,
                  background: daysAhead === d ? "var(--brand)" : "transparent",
                  border: daysAhead === d ? "1px solid color-mix(in oklab, var(--brand) 75%, var(--text))" : "1px solid transparent",
                  color: daysAhead === d ? "var(--brand-contrast)" : "var(--text-muted)",
                  cursor: "pointer",
                  lineHeight: 1,
                  transition: "all 140ms ease-out",
                  boxShadow: daysAhead === d ? "0 2px 8px color-mix(in oklab, var(--text) 20%, transparent)" : "none",
                }}
              >
                {d}d
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 3 }}>
            <button
              type="button"
              onClick={() => setDaysBack(b => b + 30)}
              title="Rozšířit historii o 30 dní"
              style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-muted)", cursor: "pointer", fontSize: 13, lineHeight: 1, transition: "all 120ms ease-out" }}
            >←</button>
            <button
              type="button"
              onClick={() => { pendingScrollMs.current = Date.now() + daysAhead * 24 * 60 * 60 * 1000; setDaysAhead(a => a + 30); }}
              title="Rozšířit budoucnost o 30 dní"
              style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-muted)", cursor: "pointer", fontSize: 13, lineHeight: 1, transition: "all 120ms ease-out" }}
            >→</button>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
          <UndoRedoButtons
            canUndo={canUndoMgr}
            canRedo={canRedoMgr}
            onUndo={() => void undoMgr()}
            onRedo={() => void redoMgr()}
            canEdit={canEditData || canEditMat}
          />

          {/* Tier 1 — ikonová tlačítka */}
          {canEdit && (
            <button
              onClick={() => setWorkingTimeLock(p => !p)}
              title={workingTimeLock ? "Víkendy/noc blokovány — klik pro flexibilní mód" : "Flexibilní mód — klik pro zamknutí"}
              style={{
                width: 28, height: 28, borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: workingTimeLock ? "rgba(251,146,60,0.10)" : "var(--surface-2)",
                border: `1px solid ${workingTimeLock ? "rgba(251,146,60,0.30)" : "var(--border)"}`,
                color: workingTimeLock ? "#fb923c" : "var(--text-muted)",
                cursor: "pointer", transition: "all 120ms ease-out", padding: 0,
              }}
            >{workingTimeLock ? <Lock size={14} strokeWidth={1.5} /> : <Unlock size={14} strokeWidth={1.5} />}</button>
          )}

          {/* Tier 2 — textová tlačítka */}
          {canEdit && (
            <button
              onClick={() => setShowShutdowns((s) => !s)}
              title="Plánované odstávky"
              style={{
                height: 28, padding: "0 10px", borderRadius: 8,
                display: "flex", alignItems: "center",
                background: showShutdowns ? "rgba(239,68,68,0.12)" : "var(--surface-2)",
                border: `1px solid ${showShutdowns ? "rgba(239,68,68,0.35)" : "var(--border)"}`,
                color: showShutdowns ? "#ef4444" : "#ef4444",
                fontSize: 12, cursor: "pointer", transition: "all 120ms ease-out", whiteSpace: "nowrap",
                textDecoration: "none",
              }}
            >
              Odstávky
            </button>
          )}
          {["ADMIN", "PLANOVAT"].includes(currentUser.role) && (
            <>
              <a
                href="/admin"
                style={{
                  height: 28, padding: "0 10px", borderRadius: 8,
                  display: "flex", alignItems: "center",
                  background: "var(--surface-2)", border: "1px solid var(--border)",
                  color: "#3b82f6", fontSize: 12, cursor: "pointer",
                  textDecoration: "none", whiteSpace: "nowrap", transition: "all 120ms ease-out",
                }}
              >Správa</a>
            </>
          )}
          {currentUser.role === "ADMIN" && (
            <a
              href="/reporty"
              style={{
                height: 28, padding: "0 10px", borderRadius: 8,
                display: "flex", alignItems: "center",
                background: "var(--surface-2)", border: "1px solid var(--border)",
                color: "#10b981", fontSize: 12, cursor: "pointer",
                textDecoration: "none", whiteSpace: "nowrap", transition: "all 120ms ease-out",
              }}
            >Reporty</a>
          )}
          {["ADMIN", "PLANOVAT", "OBCHODNIK"].includes(currentUser.role) && (
            <a
              href="/rezervace"
              style={{
                height: 28, padding: "0 10px", borderRadius: 8,
                display: "flex", alignItems: "center",
                background: "var(--surface-2)", border: "1px solid var(--border)",
                color: "#7c3aed", fontSize: 12, cursor: "pointer",
                textDecoration: "none", whiteSpace: "nowrap", transition: "all 120ms ease-out",
              }}
            >Rezervace</a>
          )}

          {/* Expedice — přístupné všem přihlášeným rolím */}
          <a
            href="/expedice"
            style={{
              height: 28, padding: "0 10px", borderRadius: 8,
              display: "flex", alignItems: "center",
              background: "var(--surface-2)", border: "1px solid var(--border)",
              color: "#f97316", fontSize: 12, cursor: "pointer",
              textDecoration: "none", whiteSpace: "nowrap", transition: "all 120ms ease-out",
            }}
          >Expedice</a>

          <ThemeToggle />

          {/* Sloučený zvonek — Upozornění + Aktivita */}
          {notif.canSeeInbox && (
            <NotificationBell
              count={notif.totalBadge}
              active={showNotifPanel}
              onClick={openNotifPanel}
              title="Upozornění a aktivita"
            />
          )}

          {/* Lasso badge */}
          {canEdit && selectedBlockIds.size > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "0 10px", height: 28, borderRadius: 8,
              background: "color-mix(in oklab, var(--accent) 12%, var(--surface))",
              border: "1px solid color-mix(in oklab, var(--accent) 35%, var(--border))",
              color: "var(--accent)", fontSize: 12, whiteSpace: "nowrap",
            }}>
              <span style={{ fontWeight: 600 }}>Vybráno {selectedBlockIds.size} {selectedBlockIds.size === 1 ? "blok" : selectedBlockIds.size < 5 ? "bloky" : "bloků"}</span>
              <button
                onClick={() => setSelectedBlockIds(new Set())}
                style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: "0 2px", fontSize: 14, lineHeight: 1, opacity: 0.7, display: "flex", alignItems: "center" }}
              >×</button>
            </div>
          )}

          {/* Username + Odhlásit */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{currentUser.username}</span>
            <button
              onClick={handleLogout}
              style={{
                height: 28, padding: "0 10px", borderRadius: 8,
                background: "var(--surface-2)", border: "1px solid var(--border)",
                color: "var(--text-muted)", fontSize: 12, cursor: "pointer", transition: "all 120ms ease-out",
              }}
            >Odhlásit</button>
          </div>
        </div>
      </header>}

      {/* ── Tělo ── (TISKAR ho vidí jen v režimu plánu; v Monitoru je nahrazené MonitorView) */}
      {(!isTiskar || tiskarView === "plan") && (
      <section style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* LEVÁ ČÁST – timeline grid */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
          <TimelineGrid
            blocks={blocks}
            filterText={filterText}
            selectedBlockId={selectedBlock?.id ?? null}
            onBlockClick={(block) => { setSelectedBlockIds(new Set()); if (canEdit) setSelectedBlock(block); }}
            onBlockUpdate={handleBlockUpdate}
            onBlockCreate={handleBlockCreate}
            scrollRef={scrollRef}
            queueDragItem={draggingQueueItem}
            onQueueDrop={handleQueueDrop}
            onQueueDragCancel={() => setDraggingQueueItem(null)}
            onBlockDoubleClick={handleBlockDoubleClick}
            companyDays={companyDays}
            slotHeight={gridSlotHeight}
            typeScale={typeScale}
            copiedBlockId={copiedBlock?.id ?? null}
            onGridClick={(machine, time) => setPasteTarget({ machine, time })}
            onGridClickEmpty={() => { setSelectedBlock(null); setEditingBlock(null); }}
            // Hledání ruší klik KAMKOLIV do mřížky, tedy i na blok — plánovač se
            // jinak musí po každém dotazu trefit do malého křížku, aby se vrátil
            // pohled na všechny zakázky (připomínka 13. 8. 2026, doslova „vynulovat
            // kliknutím kamkoliv do plánu").
            //
            // Původní užší varianta (jen prázdné místo ve sloupci) měla chránit
            // procházení shod. Neobstála: mezi shodami se přepíná šipkami v hlavičce,
            // které jsou MIMO mřížku, takže se jich tohle netýká — zato nejčastější
            // pohyb plánovače (najdi zakázku → klikni na ni) hledání nezrušil a
            // featura působila jako rozbitá.
            //
            // Syntetický `click` po dotažení gesta (laso, přetažení bloku, resize,
            // tažení hranice směny) je odchycený v TimelineGridu (`gestureEndedAtRef`).
            onPlanClick={clearSearch}
            onBlockCopy={(block) => {
              setCopiedBlock(block);
              setIsCut(false);
              clipboardGroupRef.current = [];
              isGroupCutRef.current = false;
              setPasteTarget(computePasteTargetFromBlock(block));
              showToast("Blok zkopírován. Ctrl+V vloží za originál, nebo klikni jinam.", "info");
            }}
            onBlockCut={(block) => cutSingleBlock(block)}
            onBlockDelete={(block) => setMenuDeleteBlock(block)}
            selectedBlockIds={selectedBlockIds}
            onMultiSelect={(ids) => { setSelectedBlockIds(ids); }}
            onMultiBlockUpdate={handleMultiBlockUpdate}
            daysAhead={viewDaysAhead(isTiskar, daysAhead)}
            daysBack={effectiveDaysBack}
            canEdit={canEdit}
            canEditData={canEditData}
            canEditDataDate={canEditDataDate}
            canEditMat={canEditMat}
            onError={(msg) => showToast(msg, "error")}
            onInfo={(msg) => showToast(msg, "info")}
            onCascadeConfirm={askCascade}
            workingTimeLock={workingTimeLock}
            badgeColorMap={badgeColorMap}
            machineWeekShifts={machineWeekShifts}
            isTiskar={isTiskar}
            // TISKAR: Hotovo tlačítko jen na vlastním stroji. Když přepne na cizí stroj,
            // onPrintComplete je undefined → button se v BlockCard nezobrazí.
            onPrintComplete={
              isTiskar
                ? (viewMachine === currentUser.assignedMachine ? handlePrintComplete : undefined)
                : (canEdit ? handlePrintComplete : undefined)
            }
            // TISKAR: assignedMachine = aktuálně zobrazený stroj (viewMachine).
            // Pro non-tiskar role zůstává původní chování (null = vidí všechny stroje).
            assignedMachine={isTiskar ? viewMachine : null}
            onNotify={canEdit ? handleNotify : undefined}
            onBlockVariantChange={canEdit ? handleBlockVariantChange : undefined}
            onExpeditionPublish={canEdit ? handleExpeditionPublish : undefined}
            onExpeditionUnpublish={canEdit ? handleExpeditionUnpublish : undefined}
            onReflowMachine={canEdit ? handleReflowMachine : undefined}
            onSplitDone={handleSplitDone}
            onDataChipDoubleClick={canEditData && !canEditDataDate ? handleDataChipDoubleClick : undefined}
            onShiftBoundsChange={canEdit ? updateShiftBounds : undefined}
            onOpenNotes={canSeeNotes ? (b) => setNotesDialogBlockId(b.id) : undefined}
            onSplitChipClick={handleSplitChipClick}
            pasteTarget={pasteTarget}
            clipboardHasContent={!!copiedBlock || clipboardGroupRef.current.length > 0}
            onPasteHere={handlePasteHere}
            // Zdroj používající tiskové hodiny (single i celá skupina, stejná podmínka jako
            // handlePasteWithTarget / handleGroupPasteWithTarget) → marker používá start-only
            // snap přes tiskové hodiny, délka bloku je pro tento snap irelevantní. Jinak (legacy
            // rezervace bez pm nebo smíšená skupina) marker používá starý duration-based snap
            // a potřebuje pasteSlotDurationMs.
            pasteSourceUsesPrintTime={
              clipboardGroupRef.current.length > 0
                ? clipboardGroupRef.current.every((b) => usesTiskoveHodiny(b))
                : copiedBlock != null && usesTiskoveHodiny(copiedBlock)
            }
            pasteSlotDurationMs={(() => {
              // Délka pro snap markeru = max délka v aktuálním clipboardu.
              // Pro single copy = délka zdroje; pro group = max ze skupiny (anchor pozice).
              // Blok s tiskovými hodinami: tiskové minuty (blockPrintMinutes), ne elapsed —
              // server/handlePaste pro něj taky posílá printMinutes, ne surový (endTime-startTime) rozsah.
              const durationMsFor = (b: Block) =>
                usesTiskoveHodiny(b) ? blockPrintMinutes(b) * 60000 : new Date(b.endTime).getTime() - new Date(b.startTime).getTime();
              if (clipboardGroupRef.current.length > 0) {
                return Math.max(...clipboardGroupRef.current.map(durationMsFor));
              }
              if (copiedBlock) {
                return durationMsFor(copiedBlock);
              }
              return undefined;
            })()}
          />
        </div>

        {/* Resize handle + aside — skryté pro non-editors (NOTE etapa 8) */}
        {canEdit && <ResizeHandle onMouseDown={() => {
          isResizing.current = true;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }} />}

        {/* Sloučený notifikační panel — Upozornění + Aktivita (vlevo) */}
        {notif.canSeeInbox && showNotifPanel && (
          <aside style={{ width: 320, flexShrink: 0, position: "relative", zIndex: Z_LAYOUT.sidePanel, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <NotificationsPanel
              canSeeAudit={notif.canSeeAudit}
              activeTab={notifTab}
              onTabChange={handleNotifTabChange}
              onClose={() => setShowNotifPanel(false)}
              notifications={notif.notifications}
              auditLogs={notif.auditLogs}
              notifNewCount={notif.notifNewCount}
              auditNewCount={notif.auditNewCount}
              onMarkRead={handleMarkRead}
              onJumpToBlock={handleJumpToBlock}
            />
          </aside>
        )}

        {/* DTP Panel */}
        {showDtpPanel && (
          <DtpPanel
            blocks={blocks}
            dataOpts={bDataOpts}
            onScrollToBlock={handleDtpScrollToBlock}
            onStatusChange={handleDtpDataStatusChange}
            width={dtpPanelWidth}
            onWidthChange={setDtpPanelWidth}
            onWidthCommit={(w) => savePreference("dtp-panel-width", String(w))}
            onClose={currentUser.role !== "DTP" ? () => setShowDtpPanel(false) : undefined}
          />
        )}

        {/* PRAVÁ ČÁST – detail nebo builder */}
        {canEdit && <aside style={{ width: asideWidth, flexShrink: 0, position: "relative", zIndex: Z_LAYOUT.sidePanel, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {showShutdowns ? (
            <ShutdownManager
              companyDays={companyDays}
              onAdd={handleAddCompanyDay}
              onUpdate={handleUpdateCompanyDay}
              onDelete={handleDeleteCompanyDay}
              onClose={() => setShowShutdowns(false)}
            />
          ) : editingBlock ? (
            <BlockEdit
              key={editingBlock.id}
              block={editingBlock}
              onClose={() => setEditingBlock(null)}
              onSave={(updated) => { handleBlockUpdate(updated, true); setEditingBlock(null); }}
              onBlockUpdate={handleBlockUpdate}
              allBlocks={blocks}
              onDeleteAll={handleDeleteAll}
              onSaveAll={handleSaveAll}
              onFlipReservation={handleFlipReservation}
              onCascadeConfirm={askCascade}
              canEdit={canEdit}
              canEditData={canEditData}
              canEditDataDate={canEditDataDate}
              canEditMat={canEditMat}
              dataOpts={bDataOpts}
              materialOpts={bMaterialOpts}
              barvyOpts={bBarvyOpts}
              lakOpts={bLakOpts}
              jobPresets={jobPresets}
              companyDays={companyDays}
              machineWeekShifts={machineWeekShifts}
              onToast={showToast}
            />
          ) : selectedBlock ? (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <BlockDetail
                block={selectedBlock}
                onClose={() => setSelectedBlock(null)}
                onDelete={handleDeleteBlock}
                canEdit={canEdit}
                onBlockUpdate={handleBlockUpdate}
                allBlocks={blocks}
                calendarDrift={blockCalendarDrift(selectedBlock, machineWeekShifts, companyDays, new Date())}
                onReflow={canEdit ? handleReflowBlock : undefined}
              />
            </div>
          ) : (
            <JobBuilderPanel jb={jb} isDark={isDark} />
          )}
        </aside>}
      </section>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {(() => {
        if (!canSeeNotes || notesDialogBlockId === null) return null;
        const dialogBlock = blocks.find((b) => b.id === notesDialogBlockId);
        if (!dialogBlock) return null;
        const role = currentUser.role as NoteRole;
        const canCreate =
          role === "ADMIN" || role === "PLANOVAT" ||
          (role === "TISKAR" && currentUser.assignedMachine === dialogBlock.machine);
        return (
          <BlockNotesDialog
            open
            blockMachine={dialogBlock.machine}
            blockOrderNumber={dialogBlock.orderNumber}
            notes={dialogBlock.notes ?? []}
            currentUser={{
              id: currentUser.id,
              role,
              assignedMachine: currentUser.assignedMachine ?? null,
            }}
            canCreate={canCreate}
            onClose={() => setNotesDialogBlockId(null)}
            onCreate={(text) => handleCreateNote(dialogBlock.id, text)}
            onUpdate={(noteId, text) => handleUpdateNote(dialogBlock.id, noteId, text)}
            onDelete={(noteId) => handleDeleteNote(dialogBlock.id, noteId)}
          />
        );
      })()}

      {dtpPopover && (
        <DtpDataPopover
          blockId={dtpPopover.blockId}
          currentStatusId={dtpPopover.statusId}
          dataOpts={bDataOpts}
          anchorRect={dtpPopover.rect}
          onClose={() => setDtpPopover(null)}
          onSave={handleDtpDataStatusChange}
        />
      )}

      {isTiskar && (
        <OrderSearchSheet
          open={searchSheetOpen}
          allBlocks={blocks}
          onSelect={(block) => {
            setSearchSheetOpen(false);
            // ZAKÁZKA obvykle míří na velkou kartu Monitoru. Skok do plánu je
            // pro tiskaře typicky slepá ulička: rozsah má napevno 1 den zpět,
            // TimelineGrid blok mimo rozsah nevykreslí a BlockDetail je za
            // `canEdit`. VÝJIMKA: když je tiskař UŽ v plánu (tiskarView ===
            // "plan") a blok leží uvnitř zobrazeného rozsahu (>= viewStart),
            // zůstat v plánu — tam blok reálně JE vidět, `jumpToBlockFromMonitor`
            // ho jen vybere a doscrolluje, žádný `canEdit`/BlockDetail se
            // nepotřebuje. Byla to dřívější fungující cesta „ukaž mi to v
            // plánu" a bez týhle podmínky by klik na viditelný blok tiskaře
            // nečekaně vyhodil z plánu na Monitor (review 13. 8. 2026, nález 2)
            // — NEODSTRAŇOVAT ani „nezjednodušovat" zpátky na plošné `!== "ZAKAZKA"`.
            // Rezervace a údržba jdou do plánu vždy — tiskař je neodklepává
            // a `resolveSelectedBlock` je na kartu nepustí.
            const staysInVisiblePlan =
              block.type === "ZAKAZKA" && tiskarView === "plan" && new Date(block.startTime) >= viewStart;
            if (block.type !== "ZAKAZKA" || staysInVisiblePlan) {
              jumpToBlockFromMonitor(block);
              return;
            }
            // Obojí v jednom handleru, ať to React zbatchuje — jinak Monitor
            // renderuje ještě se starým strojem a výběr se zahodí.
            if (block.machine !== viewMachine) setViewMachine(block.machine);
            setTiskarView("monitor");
            setMonitorFocusId(block.id);
          }}
          onClose={() => setSearchSheetOpen(false)}
        />
      )}

      {plannerCascade && (
        <ShiftCascadeDialog
          machine={plannerCascade.pendingPayload.machine}
          conflictingBlocks={plannerCascade.conflicts}
          longerCount={plannerCascade.longerCount}
          onCancel={() => setPlannerCascade(null)}
          onConfirm={async () => {
            const payload = plannerCascade.pendingPayload;
            setPlannerCascade(null);
            try {
              const res = await fetch("/api/machine-week-shifts?force=1", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
              if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { error?: string };
                showToast(body.error ?? "Chyba úpravy pracovní doby", "error");
                return;
              }
              // Tahle cesta si lokální stav nemergeuje sama (spoléhá na refetch níž),
              // ale tělo úspěchu pořád nese `longerBlocks` (Fix round 1) — přečíst
              // dřív, než ho zahodí `refetchWeekShifts()`.
              const body = (await res.json().catch(() => null)) as { longerBlocks?: CascadeBlock[] } | null;
              await refetchWeekShifts();
              if (Array.isArray(body?.longerBlocks) && body.longerBlocks.length > 0) {
                showToast(
                  `U ${body.longerBlocks.length} zakázek se prodloužil spočítaný konec — jejich příští úprava odsune navazující zakázky. Zkontroluj je v plánu.`,
                  "info",
                );
              }
            } catch (err) {
              console.error("[plannerCascade confirm] failed", err);
              showToast("Chyba úpravy pracovní doby", "error");
            }
          }}
        />
      )}

    </main>
  );
}
