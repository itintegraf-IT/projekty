"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input }     from "@/components/ui/input";
import { Textarea }  from "@/components/ui/textarea";
import { Label }     from "@/components/ui/label";
import { Button }    from "@/components/ui/button";
import { Switch }    from "@/components/ui/switch";
import { Lock } from "lucide-react";
import DatePickerField from "@/app/_components/DatePickerField";
import { type Block, type CompanyDay } from "@/app/_components/TimelineGrid";
import { BLOCK_VARIANTS, RESERVATION_FLIP_VARIANT, VARIANT_CONFIG, normalizeBlockVariant, type BlockVariant } from "@/lib/blockVariants";
import { findReservationSiblings, splitReservationSiblings } from "@/lib/reservationSiblings";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatPragueDateShort, utcToPragueDateStr, utcToPragueHour, pragueToUTC } from "@/lib/dateUtils";
import { applyJobPresetToDraft, presetSupportsType, type JobPreset, type JobPresetDraftValues } from "@/lib/jobPresets";
import { stripSeriesPropagatedFields } from "@/lib/seriesPropagation";
import { parseProductionTags, serializeProductionTags } from "@/lib/productionTags";
import { ProductionTagsRow } from "@/components/planner/ProductionTagsRow";
import { NativeSelect } from "@/components/NativeSelect";
import { findNextFreeSlot, type BlockedInterval } from "@/lib/scheduleSlotFinder";
import { blockPrintMinutes, formatPrintHoursShort, splitGroupTotalPrintMinutes } from "@/lib/printTimeClient";
import { type MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { type Toast } from "@/components/ToastContainer";
import {
  type CodebookOption,
  TYPE_BUILDER_CONFIG,
  DURATION_OPTIONS,
  getJobPresetTone,
} from "@/lib/plannerTypes";


function emptyPresetDraft(type: string): JobPresetDraftValues {
  return {
    blockVariant: type === "ZAKAZKA" ? "STANDARD" : normalizeBlockVariant("STANDARD", type),
    specifikace: "",
    dataStatusId: "",
    dataRequiredDate: "",
    materialStatusId: "",
    materialRequiredDate: "",
    materialInStock: false,
    pantoneRequired: false,
    pantoneRequiredDate: "",
    pantoneInStock: false,
    barvyStatusId: "",
    lakStatusId: "",
    deadlineExpedice: "",
    jobPresetId: null,
    jobPresetLabel: "",
  };
}

// Module-scope prezentační komponenty (audit #30) — dřív definované uvnitř BlockEditu,
// což je re-vytvářelo každý render (remount → ztráta focusu ve StatusSelectu).
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>{children}</div>;
}

function ColLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 5 }}>{children}</div>;
}

function StatusSelect({ value, onChange, opts }: {
  value: string;
  onChange: (v: string) => void;
  opts: CodebookOption[];
}) {
  return (
    <NativeSelect value={value} onChange={onChange} height={34} fontSize={11} paddingLeft={10} mutedWhenEmpty hover>
      <option value="">—</option>
      {opts.map((o) => (
        <option key={o.id} value={o.id.toString()}>
          {o.isWarning ? "⚠ " : ""}{o.label}
        </option>
      ))}
    </NativeSelect>
  );
}

// ─── BlockEdit ────────────────────────────────────────────────────────────────
export function BlockEdit({
  block,
  onClose,
  onSave,
  onBlockUpdate,
  allBlocks,
  onDeleteAll,
  onSaveAll,
  onFlipReservation,
  canEdit = true,
  canEditData = true,
  canEditDataDate = true,
  canEditMat = true,
  dataOpts: dataOptsProp,
  materialOpts: materialOptsProp,
  barvyOpts: barvyOptsProp,
  lakOpts: lakOptsProp,
  jobPresets = [],
  companyDays = [],
  machineWeekShifts = [],
  onToast,
}: {
  block: Block;
  onClose: () => void;
  onSave: (updated: Block) => void;
  onBlockUpdate?: (updated: Block) => void;
  allBlocks: Block[];
  /** Vrací false, když mazání čeká na potvrzení (zamčený/vytištěný blok) — panel pak nezavírat. */
  onDeleteAll: (ids: number[]) => Promise<boolean | void>;
  onSaveAll: (ids: number[], payload: Record<string, unknown>) => Promise<boolean>;
  /** Překlopení rezervace na zakázku včetně ostatních bloků téže rezervace. */
  onFlipReservation?: (anchorId: number, payload: Record<string, unknown>, siblingIds: number[]) => Promise<boolean>;
  canEdit?: boolean;
  canEditData?: boolean;
  canEditDataDate?: boolean;
  canEditMat?: boolean;
  dataOpts?: CodebookOption[];
  materialOpts?: CodebookOption[];
  barvyOpts?: CodebookOption[];
  lakOpts?: CodebookOption[];
  jobPresets?: JobPreset[];
  companyDays?: CompanyDay[];
  machineWeekShifts?: MachineWeekShiftsRow[];
  onToast?: (message: string, type: Toast["type"]) => void;
}) {
  const [orderNumber, setOrderNumber] = useState(block.orderNumber);
  const [type, setType]               = useState(block.type);
  const [blockVariant, setBlockVariant] = useState<BlockVariant>(normalizeBlockVariant(block.blockVariant, block.type));
  const [description, setDescription] = useState(block.description ?? "");
  const [locked, setLocked]           = useState(block.locked);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);
  // Po 409 CONFLICT: další Uložit zapíše přes aktuální verzi (bez zámku),
  // ať uživatel nepřijde o rozepsané změny slepým opakováním (review F4 #3).
  const [conflictOverride, setConflictOverride] = useState(false);
  const [showOrderNumberPrompt, setShowOrderNumberPrompt] = useState(false);
  const [promptOrderNumber, setPromptOrderNumber] = useState("");
  /** Zadané číslo zakázky čekající na rozhodnutí „jen tento / všechny bloky rezervace". */
  const [flipOrderNumber, setFlipOrderNumber] = useState<string | null>(null);

  // Ostatní bloky téže rezervace — kopie na druhém stroji i split části.
  // Počítá se jen u rezervace; u zakázky by shoda čísel byla bezvýznamná.
  const reservationSiblings = useMemo(
    () => (block.type === "REZERVACE" ? findReservationSiblings(block, allBlocks) : []),
    [block, allBlocks],
  );
  // Povinní (stejná split skupina jako `block`) se překlopí vždy propagací na
  // serveru — dialog je musí odlišit od volitelných, jinak by „jen tento
  // blok" lhalo (nahlásil Vojta z reálného testování, 8/2026).
  const { required: requiredSiblings, optional: optionalSiblings } = useMemo(
    () => splitReservationSiblings(block, reservationSiblings),
    [block, reservationSiblings],
  );

  // Délka tisku — pro ZAKAZKA vychází z printMinutes (tiskové hodiny), ne z elapsed
  // start→end. Elapsed může u pozastaveného bloku vzrůst na hodnotu mimo DURATION_OPTIONS
  // (např. 26 h), zatímco printMinutes zůstává skutečnou tiskovou délkou (např. 10 h) —
  // select by jinak spadl na hodnotu, kterou <option> nenabízí.
  const currentDurationHours = type === "ZAKAZKA"
    ? blockPrintMinutes(block) / 60
    : (new Date(block.endTime).getTime() - new Date(block.startTime).getTime()) / 3600000;
  const [durationHours, setDurationHours] = useState(currentDurationHours);

  // Termín expedice
  const [deadlineExpedice, setDeadlineExpedice] = useState(
    block.deadlineExpedice ? utcToPragueDateStr(new Date(block.deadlineExpedice)) : ""
  );

  // DATA
  const [dataStatusId, setDataStatusId]         = useState<string>(block.dataStatusId?.toString() ?? "");
  const [dataRequiredDate, setDataRequiredDate_raw] = useState(
    block.dataRequiredDate ? utcToPragueDateStr(new Date(block.dataRequiredDate)) : ""
  );
  // Změna data → auto-clear chipu
  function setDataRequiredDate(val: string) {
    setDataRequiredDate_raw(val);
    if (val !== dataRequiredDate) {
      setDataStatusId("");
    }
  }

  // MATERIÁL
  const [materialStatusId, setMaterialStatusId]         = useState<string>(block.materialStatusId?.toString() ?? "");
  const [materialRequiredDate, setMaterialRequiredDate] = useState(
    block.materialRequiredDate ? utcToPragueDateStr(new Date(block.materialRequiredDate)) : ""
  );
  const [materialOk, setMaterialOk]             = useState(block.materialOk);
  const [materialNote, setMaterialNote]         = useState(block.materialNote ?? "");
  const [materialInStock, setMaterialInStock]   = useState(block.materialInStock);
  const [materialIssued, setMaterialIssued]     = useState(block.materialIssued);
  // PANTONE
  const [pantoneRequiredDate, setPantoneRequiredDate] = useState(
    block.pantoneRequiredDate ? utcToPragueDateStr(new Date(block.pantoneRequiredDate)) : ""
  );
  const [pantoneOk, setPantoneOk] = useState(block.pantoneOk);
  const [pantoneRequired, setPantoneRequired] = useState(block.pantoneRequired ?? false);
  const [pantoneInStock, setPantoneInStock]   = useState(block.pantoneInStock ?? false);
  const [pantoneIssued, setPantoneIssued]     = useState(block.pantoneIssued ?? false);
  // BARVY
  const [barvyStatusId, setBarvyStatusId] = useState<string>(block.barvyStatusId?.toString() ?? "");

  // LAK
  const [lakStatusId, setLakStatusId] = useState<string>(block.lakStatusId?.toString() ?? "");

  // SPECIFIKACE
  const [specifikace, setSpecifikace] = useState(block.specifikace ?? "");
  // VÝROBNÍ ŠTÍTKY
  const [obalka, setObalka]   = useState(block.obalka ?? false);
  const [vnitrky, setVnitrky] = useState(block.vnitrky ?? false);
  const [tiskoveArchy, setTiskoveArchy] = useState<string[]>(parseProductionTags(block.tiskoveArchy));
  const [serie, setSerie]               = useState<string[]>(parseProductionTags(block.serie));
  const [tiskoveArchyOpts, setTiskoveArchyOpts] = useState<string[]>([]);
  const [serieOpts, setSerieOpts]               = useState<string[]>([]);
  const [jobPresetId, setJobPresetId] = useState<number | null>(block.jobPresetId ?? null);
  const [jobPresetLabel, setJobPresetLabel] = useState(block.jobPresetLabel ?? "");

  // SÉRIE — potvrzovací dialog
  const [seriesConfirm, setSeriesConfirm] = useState<"save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isInSeries = block.recurrenceType !== "NONE" || block.recurrenceParentId !== null;

  // SÉRIE — editace termínů jednotlivých výskytů
  const [seriesOccDrafts, setSeriesOccDrafts] = useState<Array<{ blockId: number; date: string; hour: number; dataRequiredDate: string; deadlineExpedice: string }>>(() => {
    if (!isInSeries) return [];
    const rootId = block.recurrenceParentId ?? block.id;
    return allBlocks
      .filter((b) => b.id === rootId || b.recurrenceParentId === rootId)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .map((b) => ({
        blockId: b.id,
        date: utcToPragueDateStr(new Date(b.startTime)),
        hour: utcToPragueHour(new Date(b.startTime)),
        dataRequiredDate: b.dataRequiredDate ? utcToPragueDateStr(new Date(b.dataRequiredDate)) : "",
        deadlineExpedice: b.deadlineExpedice ? utcToPragueDateStr(new Date(b.deadlineExpedice)) : "",
      }));
  });
  const [seriesOccSaving, setSeriesOccSaving] = useState(false);

  // Dark mode detekce — projekt přepíná theme přes .dark třídu na html elementu.
  // Stejný pattern jako v PlannerPage; lokální duplikace je levnější než nový prop.
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains("dark"));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // SÉRIE — auto-shift resolver per draft (preview kolize/pracovní doby)
  // Iteruje drafty v chronologickém pořadí; každý úspěšný slot se přidá do blocked,
  // aby sourozenci v sérii nekolidovali mezi sebou. Bloky série jsou z baseBlocked
  // vyloučeny (každý draft může najít vlastní pozici nezávisle na původní).
  type ResolvedDraft = {
    blockId: number;
    date: string;
    hour: number;
    dataRequiredDate: string;
    deadlineExpedice: string;
    adjustedDate: string;
    adjustedHour: number;
    wasShifted: boolean;
    noSlotFound: boolean;
  };
  const seriesOccResolved: ResolvedDraft[] = useMemo(() => {
    if (!isInSeries || seriesOccDrafts.length === 0) return [];
    const seriesIdSet = new Set(seriesOccDrafts.map((d) => d.blockId));
    // Skupiny per stroj — sourozenci série jsou obvykle na stejném stroji,
    // ale defensivně podporujeme i cross-machine sérii.
    const machineBlockedBase = new Map<string, BlockedInterval[]>();
    function getBaseBlocked(machine: string): BlockedInterval[] {
      const cached = machineBlockedBase.get(machine);
      if (cached) return cached;
      const built: BlockedInterval[] = [
        ...allBlocks
          .filter((b) => b.machine === machine && !seriesIdSet.has(b.id))
          .map((b) => ({ start: new Date(b.startTime), end: new Date(b.endTime) })),
        ...companyDays
          .filter((cd) => cd.machine == null || cd.machine === machine)
          .map((cd) => ({ start: new Date(cd.startDate), end: new Date(cd.endDate) })),
      ];
      machineBlockedBase.set(machine, built);
      return built;
    }
    const sortedDrafts = [...seriesOccDrafts].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.hour - b.hour;
    });
    const machineBlocked = new Map<string, BlockedInterval[]>();
    const resolved = new Map<number, ResolvedDraft>();
    for (const draft of sortedDrafts) {
      const orig = allBlocks.find((b) => b.id === draft.blockId);
      if (!orig) continue;
      const draftMachine = orig.machine;
      const duration = new Date(orig.endTime).getTime() - new Date(orig.startTime).getTime();
      let proposed: Date;
      try {
        proposed = pragueToUTC(draft.date, draft.hour);
      } catch {
        // Neplatný uživatelský vstup (např. nesmyslné datum) — UI ukáže ⛔.
        resolved.set(draft.blockId, {
          ...draft, adjustedDate: draft.date, adjustedHour: draft.hour,
          wasShifted: false, noSlotFound: true,
        });
        continue;
      }
      if (!machineBlocked.has(draftMachine)) {
        machineBlocked.set(draftMachine, [...getBaseBlocked(draftMachine)]);
      }
      const blocked = machineBlocked.get(draftMachine)!;
      const result = findNextFreeSlot(draftMachine, proposed, duration, blocked, machineWeekShifts);
      if (!result.found) {
        resolved.set(draft.blockId, {
          ...draft, adjustedDate: draft.date, adjustedHour: draft.hour,
          wasShifted: false, noSlotFound: true,
        });
        continue;
      }
      blocked.push({ start: result.startTime, end: result.endTime });
      resolved.set(draft.blockId, {
        ...draft,
        adjustedDate: utcToPragueDateStr(result.startTime),
        adjustedHour: utcToPragueHour(result.startTime),
        wasShifted: result.wasShifted,
        noSlotFound: false,
      });
    }
    return seriesOccDrafts.map((d) => resolved.get(d.blockId) ?? {
      ...d, adjustedDate: d.date, adjustedHour: d.hour, wasShifted: false, noSlotFound: false,
    });
  }, [seriesOccDrafts, allBlocks, companyDays, machineWeekShifts, isInSeries]);

  // SPLIT SKUPINA
  const splitGroup = block.splitGroupId != null
    ? allBlocks
        .filter((b) => b.splitGroupId === block.splitGroupId)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    : null;
  const splitIndex = splitGroup?.findIndex((b) => b.id === block.id) ?? -1;
  const isInSplit = splitGroup !== null && splitIndex !== -1;

  function getSeriesIds(): number[] {
    const rootId = block.recurrenceParentId ?? block.id;
    return allBlocks
      .filter((b) => b.id === rootId || b.recurrenceParentId === rootId)
      .map((b) => b.id);
  }

  function getFollowingSeriesIds(): number[] {
    const rootId = block.recurrenceParentId ?? block.id;
    const blockStart = new Date(block.startTime).getTime();
    return allBlocks
      .filter((b) => (b.id === rootId || b.recurrenceParentId === rootId) && new Date(b.startTime).getTime() >= blockStart)
      .map((b) => b.id);
  }

  async function handleSaveSeriesOccurrences() {
    if (seriesOccSaving) return;
    setSeriesOccSaving(true);
    const rootId = block.recurrenceParentId ?? block.id;
    const curSeries = allBlocks
      .filter((b) => b.id === rootId || b.recurrenceParentId === rootId)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    let saved = 0;
    let attempted = 0;
    let skippedNoSlot = 0;
    const failedReasons: string[] = [];
    const savedAdjusted: Array<{ blockId: number; date: string; hour: number }> = [];
    // Iterujeme v chronologickém pořadí adjustedDate/Hour — totéž pořadí, v jakém
    // resolver alokoval sloty. Tím se vyhneme tomu, aby PUT pro pozdější blok
    // přepsal pozici, kterou ještě nestihne uvolnit dřívější blok.
    const orderedResolved = [...seriesOccResolved].sort((a, b) => {
      if (a.adjustedDate !== b.adjustedDate) return a.adjustedDate.localeCompare(b.adjustedDate);
      return a.adjustedHour - b.adjustedHour;
    });
    for (const resolved of orderedResolved) {
      const orig = curSeries.find((b) => b.id === resolved.blockId);
      if (!orig) continue;
      const origDate = utcToPragueDateStr(new Date(orig.startTime));
      const origHour = utcToPragueHour(new Date(orig.startTime));
      const origDataDate = orig.dataRequiredDate ? utcToPragueDateStr(new Date(orig.dataRequiredDate)) : "";
      const origExpedice = orig.deadlineExpedice ? utcToPragueDateStr(new Date(orig.deadlineExpedice)) : "";
      // Změna jen pokud se posune ADJUSTED čas (ne raw user input) nebo datumy DAT/EXP.
      const timeChanged = resolved.adjustedDate !== origDate || resolved.adjustedHour !== origHour;
      const dataChanged = resolved.dataRequiredDate !== origDataDate;
      const expediceChanged = resolved.deadlineExpedice !== origExpedice;
      if (!timeChanged && !dataChanged && !expediceChanged) continue;
      // Slot nebyl nalezen do 7 dní — skip + počítat pro toast
      if (resolved.noSlotFound) {
        skippedNoSlot++;
        continue;
      }
      attempted++;
      const origDuration = new Date(orig.endTime).getTime() - new Date(orig.startTime).getTime();
      const newStart = pragueToUTC(resolved.adjustedDate, resolved.adjustedHour);
      const newEnd = new Date(newStart.getTime() + origDuration);
      try {
        const res = await fetch(`/api/blocks/${resolved.blockId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startTime: newStart.toISOString(),
            endTime: newEnd.toISOString(),
            // Tiskové hodiny výskytu — server dopočítá autoritativní end z nového startu.
            printMinutes: blockPrintMinutes(orig),
            dataRequiredDate: resolved.dataRequiredDate || null,
            deadlineExpedice: resolved.deadlineExpedice || null,
            // resolveChain — server umístí výskyt a případně odsune navazující bloky
            // (chain push) v téže transakci; finální pojistka ověří výsledek.
            resolveChain: true,
            // bypassScheduleValidation zůstává true záměrně — výskyty série jsou
            // deadline-driven na přesné datum. Server od etapy 2 ukládá spočítanou
            // konformitu (effectivelyBypassed), takže výskyt na konformním místě
            // se bypass flagem "neotráví".
            bypassScheduleValidation: true,
          }),
        });
        if (res.ok) {
          const updated: Block = await res.json();
          onBlockUpdate?.(updated);
          // Sync form state pro aktuální blok — jinak by buildPayload() při
          // následném "Uložit změny" přepsal tyto hodnoty původními.
          if (resolved.blockId === block.id) {
            setDataRequiredDate(resolved.dataRequiredDate);
            setDeadlineExpedice(resolved.deadlineExpedice);
          }
          savedAdjusted.push({ blockId: resolved.blockId, date: resolved.adjustedDate, hour: resolved.adjustedHour });
          saved++;
        } else {
          const err = await res.json().catch(() => ({})) as { error?: string };
          if (err.error) failedReasons.push(err.error);
        }
      } catch (error) {
        failedReasons.push(error instanceof Error ? error.message : "Neznámá chyba sítě");
      }
    }
    // Sync drafty s adjusted hodnotami pro úspěšně uložené bloky — aby UI nezobrazoval
    // původní uživatelský vstup (např. 30.7.), když realita v DB je adjusted (např. 1.8.).
    if (savedAdjusted.length > 0) {
      setSeriesOccDrafts((prev) => prev.map((d) => {
        const saved = savedAdjusted.find((s) => s.blockId === d.blockId);
        return saved ? { ...d, date: saved.date, hour: saved.hour } : d;
      }));
    }
    setSeriesOccSaving(false);
    const skippedMsg = skippedNoSlot > 0
      ? ` ${skippedNoSlot} ${skippedNoSlot === 1 ? "blok" : "bloků"} nebylo možné naplánovat do 7 dní — zvol jiné datum.`
      : "";
    const reasonsMsg = failedReasons.length > 0 ? ` Důvod: ${failedReasons[0]}` : "";
    if (attempted === 0 && skippedNoSlot === 0) {
      onToast?.("Žádné změny k uložení.", "info");
    } else if (attempted === 0 && skippedNoSlot > 0) {
      onToast?.(`Nelze uložit:${skippedMsg}`, "error");
    } else if (saved === attempted && skippedNoSlot === 0) {
      onToast?.(`Uloženo ${saved} výskytů.`, "success");
    } else if (saved === attempted && skippedNoSlot > 0) {
      onToast?.(`Uloženo ${saved} výskytů.${skippedMsg}`, "error");
    } else if (saved > 0) {
      onToast?.(`Uloženo ${saved}/${attempted} výskytů — některé selhaly.${reasonsMsg}${skippedMsg}`, "error");
    } else {
      onToast?.("Uložení selhalo — zkus to znovu.", "error");
    }
  }

  // Číselníky — preferujeme props z PlannerPage (single source of truth), fallback na vlastní fetch
  const [dataOptsLocal, setDataOptsLocal]         = useState<CodebookOption[]>([]);
  const [materialOptsLocal, setMaterialOptsLocal] = useState<CodebookOption[]>([]);
  const [barvyOptsLocal, setBarvyOptsLocal]       = useState<CodebookOption[]>([]);
  const [lakOptsLocal, setLakOptsLocal]           = useState<CodebookOption[]>([]);

  const dataOpts     = dataOptsProp     ?? dataOptsLocal;
  const materialOpts = materialOptsProp ?? materialOptsLocal;
  const barvyOpts    = barvyOptsProp    ?? barvyOptsLocal;
  const lakOpts      = lakOptsProp      ?? lakOptsLocal;

  useEffect(() => {
    if (dataOptsProp) return; // props dodány — přeskočíme vlastní fetch
    Promise.all([
      fetch("/api/codebook?category=DATA").then((r) => r.json()),
      fetch("/api/codebook?category=MATERIAL").then((r) => r.json()),
      fetch("/api/codebook?category=BARVY").then((r) => r.json()),
      fetch("/api/codebook?category=LAK").then((r) => r.json()),
    ]).then(([d, m, b, l]) => {
      setDataOptsLocal(d);
      setMaterialOptsLocal(m);
      setBarvyOptsLocal(b);
      setLakOptsLocal(l);
    });
  }, [dataOptsProp]);

  // Číselníky pro multi-selecty (TA/série) — fetch labelů v pořadí sortOrder
  useEffect(() => {
    Promise.all([
      fetch("/api/codebook?category=TISKOVY_ARCH").then((r) => r.json()),
      fetch("/api/codebook?category=SERIE").then((r) => r.json()),
    ]).then(([ta, se]) => {
      setTiskoveArchyOpts((ta as Array<{ label: string }>).map((o) => o.label));
      setSerieOpts((se as Array<{ label: string }>).map((o) => o.label));
    }).catch(() => { /* prázdný seznam = dropdown ukáže hint */ });
  }, []);

  const compatibleJobPresets = useMemo(
    () => jobPresets.filter((preset) => preset.isActive && presetSupportsType(preset, type)),
    [jobPresets, type]
  );
  const presetSelectOptions = useMemo(() => {
    const selected = jobPresets.find((preset) => preset.id === jobPresetId) ?? null;
    if (selected && !compatibleJobPresets.some((preset) => preset.id === selected.id)) {
      return [selected, ...compatibleJobPresets];
    }
    return compatibleJobPresets;
  }, [compatibleJobPresets, jobPresetId, jobPresets]);

  useEffect(() => {
    if (type === "UDRZBA") {
      if (jobPresetId !== null || jobPresetLabel) {
        setJobPresetId(null);
        setJobPresetLabel("");
      }
      return;
    }
    if (jobPresetId === null) return;
    const existingPreset = jobPresets.find((preset) => preset.id === jobPresetId);
    if (existingPreset && presetSupportsType(existingPreset, type)) return;
    setJobPresetId(null);
    setJobPresetLabel("");
  }, [jobPresetId, jobPresetLabel, jobPresets, type]);


  function resolveLabel(opts: CodebookOption[], id: string): string | null {
    return opts.find((o) => o.id.toString() === id)?.label ?? null;
  }

  const pendingSavePayload = useRef<Record<string, unknown> | null>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.max(32, el.scrollHeight) + "px";
  }, []);

  function buildPresetDraft(): JobPresetDraftValues {
    return {
      blockVariant,
      specifikace,
      dataStatusId,
      dataRequiredDate,
      materialStatusId,
      materialRequiredDate,
      materialInStock,
      pantoneRequired,
      pantoneRequiredDate,
      pantoneInStock,
      barvyStatusId,
      lakStatusId,
      deadlineExpedice,
      jobPresetId,
      jobPresetLabel,
    };
  }

  function applyPreset(preset: JobPreset) {
    const { next, overwrittenFields } = applyJobPresetToDraft(buildPresetDraft(), preset, type);
    if (
      overwrittenFields.length > 0 &&
      !window.confirm(`Preset přepíše ${overwrittenFields.length} vyplněných polí. Pokračovat?`)
    ) {
      return;
    }
    setBlockVariant(next.blockVariant);
    setSpecifikace(next.specifikace);
    setDataStatusId(next.dataStatusId);
    setDataRequiredDate(next.dataRequiredDate);
    setMaterialStatusId(next.materialStatusId);
    setMaterialRequiredDate(next.materialRequiredDate);
    setMaterialInStock(next.materialInStock);
    setPantoneRequired(next.pantoneRequired);
    setPantoneRequiredDate(next.pantoneRequiredDate);
    setPantoneInStock(next.pantoneInStock);
    setBarvyStatusId(next.barvyStatusId);
    setLakStatusId(next.lakStatusId);
    setDeadlineExpedice(next.deadlineExpedice);
    setJobPresetId(next.jobPresetId);
    setJobPresetLabel(next.jobPresetLabel);
  }

  function clearPresetSelection() {
    const next = emptyPresetDraft(type);
    setBlockVariant(next.blockVariant);
    setSpecifikace(next.specifikace);
    setDataStatusId(next.dataStatusId);
    setDataRequiredDate(next.dataRequiredDate);
    setMaterialStatusId(next.materialStatusId);
    setMaterialRequiredDate(next.materialRequiredDate);
    setMaterialInStock(next.materialInStock);
    setPantoneRequired(next.pantoneRequired);
    setPantoneRequiredDate(next.pantoneRequiredDate);
    setPantoneInStock(next.pantoneInStock);
    setBarvyStatusId(next.barvyStatusId);
    setLakStatusId(next.lakStatusId);
    setDeadlineExpedice(next.deadlineExpedice);
    setJobPresetId(null);
    setJobPresetLabel("");
  }

  function buildPayload(): Record<string, unknown> {
    return {
      orderNumber: orderNumber.trim(),
      type,
      blockVariant: type === "ZAKAZKA" ? blockVariant : "STANDARD",
      jobPresetId: type === "UDRZBA" ? null : jobPresetId,
      description: description.trim() || null,
      locked,
      deadlineExpedice: deadlineExpedice || null,
      dataStatusId: dataStatusId ? parseInt(dataStatusId) : null,
      dataStatusLabel: dataStatusId ? resolveLabel(dataOpts, dataStatusId) : null,
      dataRequiredDate: dataRequiredDate || null,
      dataOk: !!dataStatusId,
      materialStatusId: materialStatusId ? parseInt(materialStatusId) : null,
      materialStatusLabel: materialStatusId ? resolveLabel(materialOpts, materialStatusId) : null,
      materialRequiredDate: materialInStock ? null : materialRequiredDate || null,
      materialOk,
      materialNote: materialNote.trim() || null,
      materialInStock,
      materialIssued,
      pantoneRequired,
      pantoneRequiredDate: (pantoneInStock || pantoneIssued) ? null : (pantoneRequiredDate || null),
      pantoneOk,
      pantoneInStock,
      pantoneIssued,
      barvyStatusId: barvyStatusId ? parseInt(barvyStatusId) : null,
      barvyStatusLabel: barvyStatusId ? resolveLabel(barvyOpts, barvyStatusId) : null,
      lakStatusId: lakStatusId ? parseInt(lakStatusId) : null,
      lakStatusLabel: lakStatusId ? resolveLabel(lakOpts, lakStatusId) : null,
      specifikace: specifikace.trim() || null,
      obalka,
      vnitrky,
      tiskoveArchy: serializeProductionTags(tiskoveArchy),
      serie: serializeProductionTags(serie),
      // ZAKAZKA: posíláme printMinutes (tiskové hodiny) — server dopočítá autoritativní
      // end z uloženého startu (explicitní-pm PUT větev z etapy 2). Ne-ZAKAZKA typy
      // (REZERVACE, UDRZBA) model tiskových hodin nemají, tam zůstává prostý endTime.
      ...(type === "ZAKAZKA"
        ? { printMinutes: Math.round(durationHours * 60) }
        : { endTime: new Date(new Date(block.startTime).getTime() + durationHours * 3600000).toISOString() }),
    };
  }

  /**
   * Překlopení rezervace na zakázku — jediné místo, kde se skládá payload flipu.
   * Varianta je natvrdo RESERVATION_FLIP_VARIANT: rezervace variantu nenese
   * (normalizeBlockVariant jí vrací STANDARD), takže hodnota ze stavu by z každé
   * překlopené zakázky udělala „Klasickou" (připomínka plánovače, 8/2026).
   */
  function buildFlipPayload(num: string): Record<string, unknown> {
    const payload = buildPayload();
    payload.orderNumber = num;
    payload.type = "ZAKAZKA";
    payload.blockVariant = RESERVATION_FLIP_VARIANT;
    return payload;
  }

  function confirmFlipToZakazka(num: string) {
    setShowOrderNumberPrompt(false);
    setPromptOrderNumber("");
    // Rezervace bývá rozpuštěná do víc bloků (obálka na jednom stroji, vnitřky
    // na druhém). Volitelné sourozence (jiný stroj) necháme plánovače potvrdit —
    // tiché překlopení všeho by bylo stejně překvapivé jako dnešní překlopení
    // jednoho. Povinné (split část téže zakázky) server překlopí propagací
    // vždycky — bez volitelných tedy není o čem rozhodovat a dialog se vůbec
    // neotevře (nahlásil Vojta z reálného testování, 8/2026).
    if (optionalSiblings.length > 0 && onFlipReservation) {
      setFlipOrderNumber(num);
      return;
    }
    if (requiredSiblings.length > 0 && onFlipReservation) {
      runFlip(num, true);
      return;
    }
    doSave(buildFlipPayload(num));
  }

  async function runFlip(num: string, includeSiblings: boolean) {
    setFlipOrderNumber(null);
    if (!onFlipReservation) { doSave(buildFlipPayload(num)); return; }
    setSaving(true);
    setError(null);
    try {
      // Povinní (split) se do siblingIds nedávají — server je propaguje přes
      // SPLIT_SHARED_FIELDS už samotným PUTem na kotvu. siblingIds nese jen
      // volitelné, o kterých si plánovač řekl.
      const ok = await onFlipReservation(
        block.id,
        buildFlipPayload(num),
        includeSiblings ? optionalSiblings.map((b) => b.id) : [],
      );
      // Chybu už ohlásil toast z PlannerPage; tady jen necháme panel otevřený
      // s hláškou, aby plánovač viděl, že se nic neuložilo.
      if (!ok) setError("Překlopení se nepovedlo. Zkuste to znovu.");
    } finally {
      setSaving(false);
    }
  }

  async function doSave(payload: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      // expectedUpdatedAt = optimistic lock proti tichému přepisu druhým
      // plánovačem (audit REL-02). ZÁMĚRNĚ tady, ne v buildPayload —
      // buildPayload jde i do onSaveAll pro split-série a expectedUpdatedAt
      // editovaného bloku by shodil uložení sourozenců.
      // Zdroj pravdy je čerstvý záznam z allBlocks (chain push mohl blok
      // odsunout); po potvrzeném konfliktu se zámek vynechá = vědomý přepis.
      const freshUpdatedAt = allBlocks.find((b) => b.id === block.id)?.updatedAt ?? block.updatedAt;
      const res = await fetch(`/api/blocks/${block.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          resolveChain: true,
          ...(conflictOverride ? {} : { expectedUpdatedAt: freshUpdatedAt }),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; code?: string };
        if (err.code === "CONFLICT") {
          // Konflikt = blok v DB je novější. Nabídnout uložení přes čerstvý
          // stav místo slepého retry, který by 409 opakoval donekonečna.
          const msg = "Blok mezitím změnil někdo jiný. Klikněte na Uložit znovu — změny se zapíšou přes aktuální verzi.";
          setConflictOverride(true);
          onToast?.("Blok mezitím změnil jiný uživatel.", "error");
          throw new Error(msg);
        }
        if (err.code === "OVERLAP") {
          throw new Error(err.error ?? "Blok koliduje s jiným blokem na stejném stroji.");
        }
        throw new Error(err.error ?? "Chyba serveru");
      }
      const updated: Block = await res.json();
      onSave(updated);
    } catch (error) {
      console.error("Block save failed", error);
      setError(error instanceof Error ? error.message : "Chyba při ukládání.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!orderNumber.trim()) { setError("Vyplňte číslo zakázky."); return; }
    const payload = buildPayload();
    if (isInSeries) {
      pendingSavePayload.current = payload;
      setSeriesConfirm("save");
    } else {
      await doSave(payload);
    }
  }

  const typeCfg = TYPE_BUILDER_CONFIG[type as keyof typeof TYPE_BUILDER_CONFIG];

  return (
    <div
      tabIndex={-1}
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)", outline: "none", position: "relative" }}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
        if (
          e.key === "Enter" && !e.shiftKey &&
          (e.target as HTMLElement).tagName !== "TEXTAREA" &&
          (e.target as HTMLElement).tagName !== "SELECT" &&
          // flipOrderNumber = otevřený dialog překlopení. Bez něj by Enter
          // probublal z tlačítka dialogu sem, preventDefault zrušil jeho
          // aktivaci a místo překlopení by se uložila rezervace beze změny.
          !seriesConfirm && !showOrderNumberPrompt && flipOrderNumber === null
        ) {
          e.preventDefault();
          handleSave();
        }
      }}
    >
      {/* Hlavička */}
      <div style={{ padding: "10px 16px", background: "linear-gradient(135deg, color-mix(in oklab, var(--surface-2) 95%, transparent) 0%, var(--surface) 100%)", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Upravit záznam</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
            {block.orderNumber}
            {/* Text nese --accent-foreground, ne --accent: ten je podkladový tón a jako
                barva písma dává kontrast ~1,2:1 (prakticky neviditelné v obou motivech).
                14% tónovaný podklad to nezachraňoval — tónuje se týmž odstínem. */}
            {isInSeries && (
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-foreground)", background: "var(--accent)", borderRadius: 4, padding: "1px 5px" }}>↻ Série</span>
            )}
            {isInSplit && (
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", background: "color-mix(in oklab, var(--text-muted) 12%, transparent)", borderRadius: 4, padding: "1px 5px" }}>
                ✂ Část {splitIndex + 1} / {splitGroup!.length} · celkem {formatPrintHoursShort(splitGroupTotalPrintMinutes(splitGroup!))} tisku
              </span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-xs text-slate-400">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="15 18 9 12 15 6"/></svg> Zpět
        </Button>
      </div>

      {/* Obsah */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 16px 16px" }}>

        {error && (
          <div style={{ margin: "12px 0 0", borderRadius: 6, background: "color-mix(in oklab, var(--danger) 15%, transparent)", border: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)", padding: "8px 12px", fontSize: 11, color: "var(--danger)" }}>
            {error}
          </div>
        )}

        {/* Hlavní pole — disabled pro MTZ/DTP/VIEWER */}
        <div style={{ opacity: !canEdit ? 0.45 : 1, pointerEvents: !canEdit ? "none" : "auto" }}>

        {/* Typ */}
        <div style={{ marginTop: 14 }}>
          <SectionLabel>Typ záznamu</SectionLabel>
          <div style={{ display: "flex", gap: 6 }}>
            {(Object.entries(TYPE_BUILDER_CONFIG) as [string, typeof TYPE_BUILDER_CONFIG[keyof typeof TYPE_BUILDER_CONFIG]][]).map(([key, cfg]) => (
              <button key={key} type="button" onClick={() => { if (key === "ZAKAZKA" && block.type === "REZERVACE") { setShowOrderNumberPrompt(true); return; } setType(key); if (key !== "ZAKAZKA") setBlockVariant("STANDARD"); }} style={{ flex: 1, padding: "7px 4px", borderRadius: 7, border: type === key ? `1px solid ${cfg.color}` : "1px solid var(--border)", background: type === key ? `${cfg.color}22` : "var(--surface-2)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <cfg.icon size={14} strokeWidth={1.5} color={type === key ? cfg.color : "var(--text-muted)"} />
                <span style={{ fontSize: 9, fontWeight: 600, color: type === key ? cfg.color : "var(--text-muted)", textAlign: "center" }}>{cfg.label}</span>
              </button>
            ))}
          </div>
        </div>

        {type !== "UDRZBA" && (
          <div style={{ marginTop: 8 }}>
            <SectionLabel>Preset</SectionLabel>
            {jobPresetLabel && (
              <div style={{ marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Aktivní:
                  <span style={{ marginLeft: 6, color: "var(--text)", fontWeight: 700 }}>{jobPresetLabel}</span>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Předvyplnění je jen návrh
                </div>
              </div>
            )}
            {presetSelectOptions.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 5 }}>
                {presetSelectOptions.map((preset, index) => {
                  const active = jobPresetId === preset.id;
                  const tone = getJobPresetTone(preset, index);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      style={{
                        minHeight: 30,
                        padding: "5px 8px",
                        borderRadius: 7,
                        border: active ? `1px solid ${tone}` : "1px solid var(--border)",
                        background: active ? `${tone}26` : "var(--surface-2)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.12s",
                        boxShadow: active ? `inset 0 1px 0 ${tone}33, 0 0 0 1px ${tone}22` : "none",
                      }}
                    >
                      <span style={{ fontSize: 8, fontWeight: active ? 700 : 600, color: active ? tone : "var(--text-muted)", textAlign: "center", lineHeight: 1.15, letterSpacing: "0.03em" }}>
                        {preset.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                Pro tento typ zatím není dostupný žádný preset.
              </div>
            )}
            <div style={{ marginTop: 6 }}>
              <button
                type="button"
                onClick={clearPresetSelection}
                disabled={jobPresetId === null && !jobPresetLabel}
                style={{
                  width: "100%",
                  height: 34,
                  borderRadius: 10,
                  border: "1px solid color-mix(in oklab, var(--border) 88%, transparent)",
                  background: "linear-gradient(180deg, color-mix(in oklab, var(--surface-2) 94%, white 6%) 0%, var(--surface-2) 100%)",
                  color: "var(--text-muted)",
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: jobPresetId === null && !jobPresetLabel ? "default" : "pointer",
                  opacity: jobPresetId === null && !jobPresetLabel ? 0.5 : 1,
                  boxShadow: "inset 0 1px 0 color-mix(in oklab, white 24%, transparent)",
                }}
              >
                Vyčistit preset
              </button>
            </div>
            <div style={{ marginTop: 6, fontSize: 10, color: "var(--text-muted)", lineHeight: 1.4 }}>
              Výběr pouze předvyplní nastavená pole. Vyčištění preset odpojí a smaže jeho předvyplněné hodnoty.
            </div>
          </div>
        )}

        {/* Varianta zakázky — jen pro ZAKAZKA */}
        {type === "ZAKAZKA" && (
          <div style={{ marginTop: 8 }}>
            <SectionLabel>Stav zakázky</SectionLabel>
            <div style={{ display: "flex", gap: 5 }}>
              {(BLOCK_VARIANTS as readonly BlockVariant[]).map((v) => {
                const cfg = VARIANT_CONFIG[v];
                const isActive = blockVariant === v;
                return (
                  <button key={v} type="button" onClick={() => setBlockVariant(v)} style={{ flex: 1, padding: "6px 4px", borderRadius: 7, border: isActive ? `1px solid ${cfg.color}` : "1px solid var(--border)", background: isActive ? `${cfg.color}22` : "var(--surface-2)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, transition: "all 0.12s" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: isActive ? cfg.color : "var(--border)" }} />
                    <span style={{ fontSize: 8, fontWeight: 600, color: isActive ? cfg.color : "var(--text-muted)", textAlign: "center", lineHeight: 1.2 }}>{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Číslo zakázky + Popis — side by side */}
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block" }}>
              {type === "UDRZBA" ? "Název / označení" : "Číslo zakázky"} *
            </Label>
            <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} className="h-8 text-xs" autoFocus />
          </div>
          <div>
            <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block" }}>Popis</Label>
            <textarea
              ref={descRef}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = Math.max(32, e.currentTarget.scrollHeight) + "px";
              }}
              placeholder="Volitelný popis…"
              rows={1}
              style={{
                width: "100%", minHeight: 32, resize: "none", overflow: "hidden",
                background: "var(--surface-2)", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text)", fontSize: 12, lineHeight: "1.5",
                padding: "6px 10px", outline: "none", fontFamily: "inherit",
                transition: "border-color 120ms ease-out",
                boxSizing: "border-box",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
            />
          </div>
        </div>

        {/* Délka tisku */}
        <div style={{ marginTop: 8 }}>
          <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block" }}>Délka tisku</Label>
          <NativeSelect value={String(durationHours)} onChange={(v) => setDurationHours(Number(v))}>
            {DURATION_OPTIONS.map((opt) => (
              <option key={opt.hours} value={String(opt.hours)}>{opt.label}</option>
            ))}
          </NativeSelect>
        </div>

        {/* ── Výrobní sloupečky ── */}
        {type !== "UDRZBA" && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
            <SectionLabel>Výrobní sloupečky</SectionLabel>

            {/* Řádek 1: Datumy + OK — DATA | MATERIÁL | PANTONE | EXPEDICE */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
              {/* DATA */}
              <div style={{ opacity: !canEditData ? 0.45 : 1, pointerEvents: !canEditData ? "none" : "auto" }}>
                <ColLabel>DATA</ColLabel>
                <div style={{ pointerEvents: !canEditDataDate ? "none" : "auto", opacity: !canEditDataDate ? 0.45 : 1 }}>
                  <DatePickerField value={dataRequiredDate} onChange={setDataRequiredDate} placeholder="Datum" />
                </div>
              </div>
              {/* MATERIÁL */}
              <div style={{ opacity: !canEditMat ? 0.45 : 1, pointerEvents: !canEditMat ? "none" : "auto" }}>
                <ColLabel>Materiál</ColLabel>
                {materialIssued ? (
                  <div style={{ height: 32, display: "flex", alignItems: "center", borderRadius: 8, background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)", padding: "0 10px", fontSize: 11, fontWeight: 700, color: "#3b82f6" }}>Vydáno ➜</div>
                ) : materialInStock ? (
                  <div style={{ height: 32, display: "flex", alignItems: "center", borderRadius: 8, background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", padding: "0 10px", fontSize: 11, fontWeight: 700, color: "#10b981" }}>Skladem ✓</div>
                ) : (
                  <DatePickerField value={materialRequiredDate} onChange={setMaterialRequiredDate} placeholder="Datum" />
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
                  {!materialInStock && !materialIssued && (
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: materialOk ? "var(--success)" : "var(--text-muted)", cursor: "pointer", letterSpacing: "0.04em" }}>
                      <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, background: materialOk ? "var(--success)" : "transparent", border: materialOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 120ms ease-out" }}>
                        {materialOk && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      <input type="checkbox" checked={materialOk} onChange={(e) => setMaterialOk(e.target.checked)} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                      OK
                    </label>
                  )}
                  <button type="button" onClick={() => { setMaterialInStock(!materialInStock); if (!materialInStock) { setMaterialRequiredDate(""); setMaterialOk(false); } }} style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 5, border: materialInStock ? "1px solid rgba(16,185,129,0.5)" : "1px solid var(--border)", background: materialInStock ? "rgba(16,185,129,0.15)" : "transparent", color: materialInStock ? "#10b981" : "var(--text-muted)", cursor: "pointer", transition: "all 100ms" }}>
                    SKLAD
                  </button>
                  <button type="button" onClick={() => setMaterialIssued(!materialIssued)} style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 5, border: materialIssued ? "1px solid rgba(59,130,246,0.5)" : "1px solid var(--border)", background: materialIssued ? "rgba(59,130,246,0.15)" : "transparent", color: materialIssued ? "#3b82f6" : "var(--text-muted)", cursor: "pointer", transition: "all 100ms" }}>
                    VYDÁNO
                  </button>
                </div>
              </div>
              {/* PANTONE */}
              <div style={{ opacity: !canEditMat ? 0.45 : 1, pointerEvents: !canEditMat ? "none" : "auto" }}>
                <ColLabel>Pantone</ColLabel>
                {pantoneIssued ? (
                  <div style={{ height: 32, display: "flex", alignItems: "center", borderRadius: 8, background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)", padding: "0 10px", fontSize: 11, fontWeight: 700, color: "#3b82f6" }}>Vydáno ➜</div>
                ) : pantoneInStock ? (
                  <div style={{ height: 32, display: "flex", alignItems: "center", borderRadius: 8, background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", padding: "0 10px", fontSize: 11, fontWeight: 700, color: "#10b981" }}>Skladem ✓</div>
                ) : (
                  <DatePickerField value={pantoneRequiredDate} onChange={(v) => { setPantoneRequiredDate(v); if (v) setPantoneRequired(true); }} placeholder="Datum" />
                )}
                {/* Řádek se ZÁMĚRNĚ nezalamuje — stejně jako materiálový o sloupec vedle.
                    Sloupec mřížky je minmax(auto, 1fr), takže se roztáhne na min-content
                    tohohle řádku; u materiálu je to ~141 px (OK + SKLAD + VYDÁNO) a pantone
                    se díky zkráceným popiskům „P!" / „SKL." / „VYD." vejde do ~137 px, tedy
                    do téže šířky. Povolené zalomení tu bylo krátce vyzkoušené a je to horší
                    volba: sloupec se sice zúží, ale čtyři tlačítka se naskládají pod sebe. */}
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5 }}>
                  <button type="button" onClick={() => {
                    const next = !pantoneRequired;
                    setPantoneRequired(next);
                    if (!next) { setPantoneRequiredDate(""); setPantoneOk(false); setPantoneInStock(false); setPantoneIssued(false); }
                  }} title={pantoneRequired ? "Pantone je potřeba — kliknutím zrušíte" : "Označit, že je pantone potřeba"}
                  style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 5, border: pantoneRequired ? "1px solid rgba(168,85,247,0.5)" : "1px solid var(--border)", background: pantoneRequired ? "rgba(168,85,247,0.15)" : "transparent", color: pantoneRequired ? "#a855f7" : "var(--text-muted)", cursor: "pointer", transition: "all 100ms" }}>
                    P!
                  </button>
                  {!pantoneInStock && !pantoneIssued && (
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: pantoneOk ? "var(--success)" : "var(--text-muted)", cursor: "pointer", letterSpacing: "0.04em" }}>
                      <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, background: pantoneOk ? "var(--success)" : "transparent", border: pantoneOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 120ms ease-out" }}>
                        {pantoneOk && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      <input type="checkbox" checked={pantoneOk} onChange={(e) => setPantoneOk(e.target.checked)} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                      OK
                    </label>
                  )}
                  <button type="button" onClick={() => { setPantoneInStock(!pantoneInStock); if (!pantoneInStock) { setPantoneRequiredDate(""); setPantoneOk(false); setPantoneRequired(true); } }} style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 5, border: pantoneInStock ? "1px solid rgba(16,185,129,0.5)" : "1px solid var(--border)", background: pantoneInStock ? "rgba(16,185,129,0.15)" : "transparent", color: pantoneInStock ? "#10b981" : "var(--text-muted)", cursor: "pointer", transition: "all 100ms" }}>
                    SKL.
                  </button>
                  <button type="button" onClick={() => { setPantoneIssued(!pantoneIssued); if (!pantoneIssued) { setPantoneRequired(true); } }} style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 5, border: pantoneIssued ? "1px solid rgba(59,130,246,0.5)" : "1px solid var(--border)", background: pantoneIssued ? "rgba(59,130,246,0.15)" : "transparent", color: pantoneIssued ? "#3b82f6" : "var(--text-muted)", cursor: "pointer", transition: "all 100ms" }}>
                    VYD.
                  </button>
                </div>
              </div>
              {/* EXPEDICE */}
              <div style={{ opacity: !canEdit ? 0.45 : 1, pointerEvents: !canEdit ? "none" : "auto" }}>
                <ColLabel>Expedice</ColLabel>
                <DatePickerField value={deadlineExpedice} onChange={setDeadlineExpedice} placeholder="Datum" />
              </div>
            </div>

            {/* Řádek 2: Stavy — DATA | MATERIÁL | BARVY | LAK */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 10 }}>
              {/* DATA */}
              <div style={{ opacity: !canEditData ? 0.45 : 1, pointerEvents: !canEditData ? "none" : "auto" }}>
                <ColLabel>DATA</ColLabel>
                <StatusSelect value={dataStatusId} onChange={setDataStatusId} opts={dataOpts} />
              </div>
              {/* MATERIÁL */}
              <div style={{ opacity: !canEditMat ? 0.45 : 1, pointerEvents: !canEditMat ? "none" : "auto" }}>
                <ColLabel>Materiál</ColLabel>
                <StatusSelect value={materialStatusId} onChange={setMaterialStatusId} opts={materialOpts} />
              </div>
              {/* BARVY */}
              <div style={{ opacity: !canEdit ? 0.45 : 1, pointerEvents: !canEdit ? "none" : "auto" }}>
                <ColLabel>Barvy</ColLabel>
                <StatusSelect value={barvyStatusId} onChange={setBarvyStatusId} opts={barvyOpts} />
              </div>
              {/* LAK */}
              <div style={{ opacity: !canEdit ? 0.45 : 1, pointerEvents: !canEdit ? "none" : "auto" }}>
                <ColLabel>Lak</ColLabel>
                <StatusSelect value={lakStatusId} onChange={setLakStatusId} opts={lakOpts} />
              </div>
            </div>

            {/* Řádek 3: Výrobní štítky — OBÁLKA | VNITŘKY | Tiskové archy | Série */}
            <ProductionTagsRow
              obalka={obalka} onObalkaChange={setObalka}
              vnitrky={vnitrky} onVnitrkyChange={setVnitrky}
              tiskoveArchy={tiskoveArchy} onTiskoveArchyChange={setTiskoveArchy} tiskoveArchyOpts={tiskoveArchyOpts}
              serie={serie} onSerieChange={setSerie} serieOpts={serieOpts}
              disabled={!canEdit}
            />

            {/* SPECIFIKACE */}
            <div style={{ marginTop: 8, opacity: !canEdit ? 0.45 : 1, pointerEvents: !canEdit ? "none" : "auto" }}>
              <SectionLabel>Specifikace</SectionLabel>
              <Textarea value={specifikace} onChange={(e) => setSpecifikace(e.target.value)} rows={2} placeholder="Speciální požadavky…" className="text-xs resize-none" />
            </div>

            {/* POZNÁMKA MTZ */}
            <div style={{ marginTop: 8, opacity: !canEditMat ? 0.45 : 1, pointerEvents: !canEditMat ? "none" : "auto" }}>
              <SectionLabel>Poznámka materiál (MTZ)</SectionLabel>
              <Textarea value={materialNote} onChange={(e) => setMaterialNote(e.target.value)} rows={2} placeholder="Materiál skladem od…" className="text-xs resize-none" />
            </div>
          </div>
        )}

        {/* Zamčeno — jen pro ADMIN a PLANOVAT (canEdit) */}
        {canEdit && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
            <Switch checked={locked} onCheckedChange={setLocked} />
            <Label style={{ fontSize: 11, color: locked ? "var(--brand)" : "var(--text-muted)", cursor: "pointer" }}>
              <Lock size={11} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }} />Zamčený blok
            </Label>
          </div>
        )}

        </div>{/* close: Hlavní pole disabled wrapper */}

        {/* ── Termíny série ── */}
        {canEdit && isInSeries && seriesOccDrafts.length > 1 && (
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Termíny série</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto" }}>
              {seriesOccDrafts.map((occ, i) => {
                const resolved = seriesOccResolved.find((r) => r.blockId === occ.blockId);
                const wasShifted = resolved?.wasShifted ?? false;
                const noSlotFound = resolved?.noSlotFound ?? false;
                const isEditing = occ.blockId === block.id;
                // Banner styl je převzat z Job Builder preview série, aby UX byl konzistentní.
                const cardStyle: React.CSSProperties = noSlotFound
                  ? {
                      background: isDark ? "rgba(239, 68, 68, 0.12)" : "#fee2e2",
                      border: isDark ? "1px solid rgba(239, 68, 68, 0.45)" : "1px solid #ef4444",
                      borderLeft: isDark ? "3px solid #ef4444" : "3px solid #b91c1c",
                    }
                  : wasShifted
                  ? {
                      background: isDark ? "rgba(255, 230, 0, 0.12)" : "#fef3c7",
                      border: isDark ? "1px solid rgba(255, 230, 0, 0.45)" : "1px solid #f59e0b",
                      borderLeft: isDark ? "3px solid #FFE600" : "3px solid #d97706",
                    }
                  : {
                      background: isEditing ? "rgba(59,130,246,0.08)" : "rgba(255,255,255,0.03)",
                      border: isEditing ? "1px solid rgba(59,130,246,0.2)" : "1px solid rgba(255,255,255,0.06)",
                    };
                const titleAttr = noSlotFound
                  ? "Nelze najít volný slot do 7 dní od požadovaného času. Zvol jiné datum nebo uvolni kapacitu stroje."
                  : wasShifted
                  ? `Posunuto kvůli kapacitě stroje — původně ${occ.date} ${String(occ.hour).padStart(2, "0")}:00`
                  : undefined;
                return (
                <div
                  key={occ.blockId}
                  title={titleAttr}
                  style={{ display: "flex", flexDirection: "column", gap: 3, padding: "6px 8px", borderRadius: 7, ...cardStyle }}
                >
                  {wasShifted && !noSlotFound && (
                    <div style={{
                      fontSize: 10, fontWeight: 700,
                      color: isDark ? "#FFE600" : "#92400e",
                      letterSpacing: "0.04em", marginBottom: 2,
                    }}>
                      ⚠ Posunuto z {occ.date} {String(occ.hour).padStart(2, "0")}:00 (kapacita)
                    </div>
                  )}
                  {noSlotFound && (
                    <div style={{
                      fontSize: 10, fontWeight: 700,
                      color: isDark ? "#fca5a5" : "#991b1b",
                      letterSpacing: "0.04em", marginBottom: 2,
                    }}>
                      ⛔ Nelze naplánovat — žádný volný slot do 7 dní od {occ.date} {String(occ.hour).padStart(2, "0")}:00
                    </div>
                  )}
                  {/* Řádek 1: badge + Tisk datum + hodina */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      flexShrink: 0, width: 20, height: 20, borderRadius: 4,
                      background: isEditing ? "rgba(59,130,246,0.28)" : "rgba(59,130,246,0.1)",
                      border: isEditing ? "1px solid rgba(59,130,246,0.55)" : "1px solid rgba(59,130,246,0.2)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 9, fontWeight: 700, color: "#3b82f6",
                    }}>{i + 1}</div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-muted)", width: 28, flexShrink: 0 }}>Tisk:</div>
                    <div style={{ flex: 1 }}>
                      <DatePickerField
                        // Pattern z Job Builder preview: input zobrazuje ADJUSTED hodnotu
                        // (kam se to po uložení posune). User vidí v inputu výsledek auto-shiftu;
                        // banner ⚠ ukazuje, odkud původně tahal. Při noSlotFound zůstává user input
                        // v inputu (adjusted neexistuje).
                        value={wasShifted && resolved ? resolved.adjustedDate : occ.date}
                        onChange={(d) => setSeriesOccDrafts((prev) => prev.map((o) => o.blockId === occ.blockId ? { ...o, date: d } : o))}
                        placeholder="Datum…"
                      />
                    </div>
                    <NativeSelect
                      wrapperStyle={{ flex: "0 0 72px" }}
                      value={wasShifted && resolved ? resolved.adjustedHour : occ.hour}
                      onChange={(v) => setSeriesOccDrafts((prev) => prev.map((o) => o.blockId === occ.blockId ? { ...o, hour: parseInt(v) } : o))}
                      height={30}
                      fontSize={11}
                      paddingLeft={8}
                      chevronSize={10}
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                      ))}
                    </NativeSelect>
                  </div>
                  {/* Řádek 2: DATA datum + EXP datum */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 26 }}>
                    <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-muted)", width: 28, flexShrink: 0 }}>DATA:</div>
                    <div style={{ flex: 1 }}>
                      <DatePickerField
                        value={occ.dataRequiredDate}
                        onChange={(d) => setSeriesOccDrafts((prev) => prev.map((o) => o.blockId === occ.blockId ? { ...o, dataRequiredDate: d } : o))}
                        placeholder="Termín dat…"
                      />
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-muted)", width: 24, flexShrink: 0, textAlign: "right" }}>EXP:</div>
                    <div style={{ flex: 1 }}>
                      <DatePickerField
                        value={occ.deadlineExpedice}
                        onChange={(d) => setSeriesOccDrafts((prev) => prev.map((o) => o.blockId === occ.blockId ? { ...o, deadlineExpedice: d } : o))}
                        placeholder="Expedice…"
                      />
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={handleSaveSeriesOccurrences}
              disabled={seriesOccSaving}
              style={{
                marginTop: 8, width: "100%", height: 30,
                borderRadius: 7, border: "1px solid rgba(59,130,246,0.3)",
                background: "rgba(59,130,246,0.12)", color: "#3b82f6",
                fontSize: 11, fontWeight: 600,
                cursor: seriesOccSaving ? "default" : "pointer",
                opacity: seriesOccSaving ? 0.65 : 1,
                transition: "opacity 120ms ease-out",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
              }}
            >
              {seriesOccSaving ? "Ukládám…" : "Uložit termíny série"}
            </button>
          </div>
        )}

        {/* Série — inline dialog */}
        {seriesConfirm ? (
          <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
              {seriesConfirm === "save" ? "Uložit změny pro…" : "Smazat…"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button
                disabled={saving}
                onClick={async () => {
                  if (seriesConfirm === "save" && pendingSavePayload.current) {
                    await doSave(pendingSavePayload.current);
                  } else if (seriesConfirm === "delete") {
                    const deleted = await onDeleteAll([block.id]);
                    if (deleted !== false) onClose();
                  }
                  setSeriesConfirm(null);
                }}
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text)", fontSize: 12, fontWeight: 600, padding: "8px 12px", cursor: saving ? "default" : "pointer", opacity: saving ? 0.65 : 1, textAlign: "left", transition: "opacity 120ms ease-out" }}
              >
                Jen tuto instanci
              </button>
              <button
                disabled={saving}
                onClick={async () => {
                  const pending = pendingSavePayload.current;
                  if (seriesConfirm === "save" && pending) {
                    const allIds = getSeriesIds();
                    const otherIds = allIds.filter((id) => id !== block.id);
                    // Per-instance fieldy (termíny, ready flagy, sklad/vydání)
                    // patří jen editovanému bloku — odrážejí konkrétní intent
                    // uživatele pro tuto instanci. Sourozenci v sérii dostanou
                    // jen sdílená pole (orderNumber, specifikace, materialStatusId, …).
                    // Viz src/lib/seriesPropagation.ts pro úplný seznam.
                    const sharedPayload = stripSeriesPropagatedFields(pending);
                    const ok = await onSaveAll([block.id], pending);
                    // Pokud první save selhal, sourozence nepřepisujeme — nechceme
                    // nekonzistentní stav, kdy se sdílená pole aplikují na ostatní,
                    // ale editovaný blok zůstává starý.
                    if (ok && otherIds.length > 0) {
                      await onSaveAll(otherIds, sharedPayload);
                    }
                    onClose();
                  } else if (seriesConfirm === "delete") {
                    const ids = getFollowingSeriesIds();
                    const deleted = await onDeleteAll(ids);
                    if (deleted !== false) onClose();
                  }
                  setSeriesConfirm(null);
                }}
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text)", fontSize: 12, fontWeight: 600, padding: "8px 12px", cursor: saving ? "default" : "pointer", opacity: saving ? 0.65 : 1, textAlign: "left", transition: "opacity 120ms ease-out" }}
              >
                {seriesConfirm === "delete"
                  ? `Tuto a následující (${getFollowingSeriesIds().length} bloků)`
                  : `Celou sérii (${getSeriesIds().length} bloků)`}
              </button>
              <button
                disabled={saving}
                onClick={() => setSeriesConfirm(null)}
                style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 11, padding: "4px 0", cursor: saving ? "default" : "pointer", opacity: saving ? 0.65 : 1, textAlign: "left" }}
              >
                Zrušit
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Tlačítka */}
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={{
                  flex: 1,
                  height: 32,
                  borderRadius: 8,
                  border: "1px solid color-mix(in oklab, var(--brand) 80%, var(--text) 20%)",
                  background: "linear-gradient(135deg, color-mix(in oklab, var(--brand) 90%, white 10%) 0%, var(--brand) 100%)",
                  color: "var(--brand-contrast)",
                  fontWeight: 800,
                  fontSize: 11,
                  letterSpacing: "0.01em",
                  cursor: saving ? "default" : "pointer",
                  opacity: saving ? 0.7 : 1,
                  boxShadow: "0 2px 8px color-mix(in oklab, var(--brand) 28%, transparent)",
                  transition: "filter 120ms ease-out, transform 120ms ease-out, box-shadow 120ms ease-out",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                }}
                onMouseEnter={(e) => { if (!saving) (e.currentTarget as HTMLButtonElement).style.filter = "brightness(0.96)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.filter = "none"; }}
              >
                {saving ? "Ukládám…" : <><span>Uložit změny</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></>}
              </button>
              <Button type="button" variant="ghost" onClick={onClose} disabled={saving} className="text-slate-400 text-xs">
                Zrušit
              </Button>
            </div>

            {/* Smazat */}
            {confirmDelete ? (
              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", marginBottom: 6, margin: "0 0 6px" }}>
                  Opravdu smazat blok?
                </p>
                <div style={{ display: "flex", gap: 6 }}>
                  <Button
                    variant="destructive" size="sm"
                    onClick={() => onDeleteAll([block.id]).then((deleted) => { if (deleted !== false) onClose(); })}
                    className="flex-1 text-xs"
                  >
                    Smazat
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 text-xs border-slate-700 text-slate-300"
                  >
                    Zrušit
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (isInSeries) {
                    setSeriesConfirm("delete");
                  } else {
                    setConfirmDelete(true);
                  }
                }}
                style={{ marginTop: 8, width: "100%", background: "none", border: "none", color: "var(--text-muted)", fontSize: 11, padding: "6px 0", cursor: "pointer", textAlign: "center", transition: "color 0.1s" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
              >
                Smazat blok
              </button>
            )}
          </>
        )}

        {/* Barva náhledu */}
        <div style={{ marginTop: 12, borderRadius: 6, padding: "8px 10px", background: `${typeCfg?.color ?? "#334155"}14`, borderLeft: `3px solid ${typeCfg?.color ?? "var(--text-muted)"}`, fontSize: 11, color: typeCfg?.color ?? "var(--text-muted)" }}>
          {typeCfg && <typeCfg.icon size={11} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }} />}{typeCfg?.label}
        </div>
      </div>

      {/* Popup: vyplň číslo zakázky při překlopení REZERVACE → ZAKAZKA */}
      {showOrderNumberPrompt && (
        <div style={{ position: "absolute", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)", borderRadius: "inherit" }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 20, width: 280, boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>Překlopení na zakázku</div>
            <label style={{ fontSize: 12, color: "var(--text)", display: "block", marginBottom: 6 }}>Vyplň číslo zakázky</label>
            <input
              autoFocus
              value={promptOrderNumber}
              onChange={(e) => setPromptOrderNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && promptOrderNumber.trim()) {
                  e.stopPropagation();
                  confirmFlipToZakazka(promptOrderNumber.trim());
                }
                if (e.key === "Escape") {
                  setShowOrderNumberPrompt(false);
                  setPromptOrderNumber("");
                }
              }}
              placeholder="např. 12345"
              style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                disabled={!promptOrderNumber.trim()}
                onClick={() => confirmFlipToZakazka(promptOrderNumber.trim())}
                style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", background: promptOrderNumber.trim() ? "#10b981" : "var(--surface-2)", color: promptOrderNumber.trim() ? "#fff" : "var(--text-muted)", fontWeight: 600, fontSize: 12, cursor: promptOrderNumber.trim() ? "pointer" : "not-allowed" }}
              >
                Potvrdit
              </button>
              <button
                type="button"
                onClick={() => { setShowOrderNumberPrompt(false); setPromptOrderNumber(""); }}
                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 12, cursor: "pointer" }}
              >
                Zrušit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rezervace rozpuštěná do víc bloků — nechat plánovače rozhodnout, co překlopit. */}
      <ConfirmDialog
        open={flipOrderNumber !== null}
        title="Překlopit celou rezervaci?"
        width={360}
        confirmLabel={`Překlopit všechny (${reservationSiblings.length + 1})`}
        cancelLabel="Zrušit"
        // Fokus schválně NEbere hromadná volba: sourozenci se párují podle čísla
        // rezervace přes celou databázi, takže se mezi ně může dostat i cizí blok
        // se shodným ručně zadaným číslem. Enter má padnout na bezpečnější variantu.
        autoFocusConfirm={false}
        message={(() => {
          const total = reservationSiblings.length + 1;
          // Česká shoda: 2–4 „bloky", 5+ „bloků" (1 sem nepadá — dialog se bez sourozenců neotevře).
          return (
            <>
              Rezervace <strong>{block.orderNumber}</strong> má {total} {total < 5 ? "bloky" : "bloků"}.
              Překlopit na zakázku <strong>{flipOrderNumber}</strong> všechny, nebo jen tento?
              {requiredSiblings.length > 0 && (
                <> Části rozdělené zakázky (<strong>ČÁST SPLITU</strong>) se překlopí vždy — server je propaguje automaticky.</>
              )}
            </>
          );
        })()}
        onConfirm={() => { if (flipOrderNumber) runFlip(flipOrderNumber, true); }}
        onCancel={() => setFlipOrderNumber(null)}
      >
        {/* Výpis toho, co se reálně překlopí. Bez něj plánovač nepozná, že se
            mezi sourozence připletla jiná rezervace se stejným číslem. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3, margin: "10px 0 4px", maxHeight: 160, overflowY: "auto" }}>
          {[block, ...reservationSiblings].map((b) => {
            const isRequired = b.id !== block.id && requiredSiblings.some((r) => r.id === b.id);
            return (
              <div
                key={b.id}
                style={{
                  display: "flex", alignItems: "baseline", gap: 6, fontSize: 11,
                  padding: "4px 8px", borderRadius: 6,
                  background: b.id === block.id ? "var(--surface-2)" : "transparent",
                  border: `1px solid ${b.id === block.id ? "var(--border)" : "transparent"}`,
                }}
              >
                <span style={{ fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" }}>
                  {b.machine === "XL_105" ? "XL 105" : b.machine === "XL_106" ? "XL 106" : b.machine}
                </span>
                <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {formatPragueDateShort(new Date(b.startTime))}
                </span>
                {b.description && (
                  <span style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {b.description}
                  </span>
                )}
                {b.id === block.id && (
                  <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    TENTO
                  </span>
                )}
                {/* Plný --accent podklad s --accent-foreground textem, ne --accent jako
                    barva písma: --accent je v tomhle designu podkladový tón (proto k němu
                    existuje párový foreground). Jako `color` na pozadí dialogu dává kontrast
                    ~1,2:1, tedy prakticky neviditelný text v obou motivech. */}
                {isRequired && (
                  <span style={{
                    marginLeft: "auto", fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                    whiteSpace: "nowrap", background: "var(--accent)", color: "var(--accent-foreground)",
                    padding: "1px 5px", borderRadius: 4,
                  }}>
                    ČÁST SPLITU
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          autoFocus
          onClick={() => { if (flipOrderNumber) runFlip(flipOrderNumber, false); }}
          style={{ width: "100%", marginTop: 4, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          {requiredSiblings.length > 0
            ? `Jen rozdělenou zakázku (${1 + requiredSiblings.length})`
            : "Jen tento blok (1)"}
        </button>
      </ConfirmDialog>
    </div>
  );
}
