"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import TimelineGrid, { dateToY, type Block, type CompanyDay } from "./TimelineGrid";
import { BLOCK_VARIANTS, VARIANT_CONFIG, normalizeBlockVariant, type BlockVariant } from "@/lib/blockVariants";
import {
  addDaysToCivilDate,
  addMonthsToCivilDate,
  diffCivilDateDays,
  formatCivilDate,
  formatPragueDateShort,
  formatPragueDateTime,
  formatPragueTime,
  normalizeCivilDateInput,
  pragueToUTC,
  todayPragueDateStr,
  utcToPragueDateStr,
  utcToPragueHour,
} from "@/lib/dateUtils";
import { snapGroupDeltaWithTemplates, snapToNextValidStartWithTemplates } from "@/lib/workingTime";
import type { MachineWorkHoursTemplate } from "@/lib/machineWorkHours";
import type { MachineScheduleException } from "@/lib/machineScheduleException";
import { Input }     from "@/components/ui/input";
import { Textarea }  from "@/components/ui/textarea";
import { Label }     from "@/components/ui/label";
import { Button }    from "@/components/ui/button";
import { Switch }    from "@/components/ui/switch";
import { Badge }     from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Lock, Unlock, ClipboardList, Pin, Wrench, CalendarDays } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import DatePickerField from "./DatePickerField";
import {
  applyJobPresetToDraft,
  presetSupportsType,
  type JobPreset,
  type JobPresetDraftValues,
} from "@/lib/jobPresets";

// ─── Typy ─────────────────────────────────────────────────────────────────────
type NotificationItem = {
  id: number;
  type?: string;
  message?: string;
  blockId: number | null;
  blockOrderNumber: string | null;
  targetRole: string | null;
  targetUserId?: number | null;
  reservationId?: number | null;
  createdByUserId: number;
  createdByUsername: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

type AuditLogEntry = {
  id: number;
  blockId: number;
  orderNumber: string | null;
  userId: number;
  username: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
};

type CodebookOption = {
  id: number;
  category: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  shortCode: string | null;
  isWarning: boolean;
  badgeColor: string | null;
};

type QueueItem = {
  id: number | string;
  orderNumber: string;
  type: string;
  blockVariant: BlockVariant;
  jobPresetId?: number | null;
  jobPresetLabel?: string | null;
  durationHours: number;
  description: string;
  dataStatusId: number | null;
  dataStatusLabel: string | null;
  dataRequiredDate: string | null;
  materialStatusId: number | null;
  materialStatusLabel: string | null;
  materialRequiredDate: string | null;
  materialInStock: boolean;
  pantoneRequiredDate: string | null;
  pantoneOk: boolean;
  barvyStatusId: number | null;
  barvyStatusLabel: string | null;
  lakStatusId: number | null;
  lakStatusLabel: string | null;
  specifikace: string;
  deadlineExpedice: string;
  recurrenceType: string;
  recurrenceCount: number;
  // Rezervace-specific
  reservationId?: number;
  reservationCode?: string;
  companyName?: string;
};

type PushSuggestion = {
  chain: Block[];
  shiftMs: number;
  blockedByLock: boolean;
  lockedBlock: Block | null;
};

type Toast = { id: number; message: string; type: "success" | "error" | "info" };

type HistoryEntry = { undo: () => Promise<void>; redo: () => Promise<void> };

type OverlapResult = "resolved" | "blocked_by_lock" | "failed";

// ─── Konstanty ────────────────────────────────────────────────────────────────
const TYPE_LABELS: Record<string, string> = {
  ZAKAZKA: "Zakázka",
  REZERVACE: "Rezervace",
  UDRZBA: "Údržba",
};

const TYPE_BUILDER_CONFIG = {
  ZAKAZKA:   { icon: ClipboardList, label: "Zakázka",        color: "#1a6bcc" },
  REZERVACE: { icon: Pin,           label: "Rezervace",       color: "#7c3aed" },
  UDRZBA:    { icon: Wrench,        label: "Údržba / Oprava", color: "#c0392b" },
} as const;

const JOB_PRESET_TONE_PALETTE = ["#1a6bcc", "#d97706", "#0f9f6e", "#c2410c", "#7c3aed"] as const;

function getJobPresetTone(preset: Pick<JobPreset, "name">, index: number) {
  const normalized = preset.name.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized.includes("105")) return "#1a6bcc";
  if (normalized.includes("led")) return "#d97706";
  if (normalized.includes("iml")) return "#0f9f6e";
  return JOB_PRESET_TONE_PALETTE[index % JOB_PRESET_TONE_PALETTE.length];
}


// ─── ZoomSlider ───────────────────────────────────────────────────────────────
function ZoomSlider({ value, onChange, min = 3, max = 26 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const pct = (value - min) / (max - min);

  const applyPosition = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const { left, width } = el.getBoundingClientRect();
    const raw = (clientX - left) / width;
    const clamped = Math.min(1, Math.max(0, raw));
    onChange(Math.round(min + clamped * (max - min)));
  }, [min, max, onChange]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) { if (isDragging.current) applyPosition(e.clientX); }
    function onMouseUp()  { isDragging.current = false; document.body.style.cursor = ""; }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };
  }, [applyPosition]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {/* ikona odzoomu — klikatelná */}
      <svg
        width="12" height="12" viewBox="0 0 16 16" fill="none"
        onClick={() => onChange(Math.max(min, value - 1))}
        style={{ flexShrink: 0, opacity: value <= min ? 0.2 : 0.5, cursor: value <= min ? "default" : "pointer", transition: "opacity 0.15s" }}
      >
        <circle cx="6.5" cy="6.5" r="5" stroke="var(--text-muted)" strokeWidth="1.5"/>
        <line x1="4" y1="6.5" x2="9" y2="6.5" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>

      {/* track */}
      <div
        ref={trackRef}
        onMouseDown={(e) => { isDragging.current = true; document.body.style.cursor = "ew-resize"; applyPosition(e.clientX); }}
        style={{ position: "relative", width: 80, height: 20, display: "flex", alignItems: "center", cursor: "ew-resize", flexShrink: 0 }}
      >
        {/* bg track */}
        <div style={{ position: "absolute", inset: "0 0 0 0", margin: "auto", height: 2, borderRadius: 2, background: "color-mix(in oklab, var(--border) 90%, transparent)" }} />
        {/* fill */}
        <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", height: 2, width: `${pct * 100}%`, borderRadius: 2, background: "color-mix(in oklab, var(--text) 65%, transparent)", transition: isDragging.current ? undefined : "width 0.05s" }} />
        {/* thumb */}
        <div style={{
          position: "absolute",
          left: `calc(${pct * 100}% - 7px)`,
          top: "50%", transform: "translateY(-50%)",
          width: 14, height: 14, borderRadius: "50%",
          background: "var(--text)",
          boxShadow: "0 1px 4px color-mix(in oklab, var(--text) 25%, transparent), 0 0 0 0.5px color-mix(in oklab, var(--text) 15%, transparent)",
          transition: isDragging.current ? undefined : "left 0.05s",
          flexShrink: 0,
        }} />
      </div>

      {/* ikona přiblížení — klikatelná */}
      <svg
        width="14" height="14" viewBox="0 0 16 16" fill="none"
        onClick={() => onChange(Math.min(max, value + 1))}
        style={{ flexShrink: 0, opacity: value >= max ? 0.2 : 0.5, cursor: value >= max ? "default" : "pointer", transition: "opacity 0.15s" }}
      >
        <circle cx="6.5" cy="6.5" r="5" stroke="var(--text-muted)" strokeWidth="1.5"/>
        <line x1="4" y1="6.5" x2="9" y2="6.5" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="6.5" y1="4" x2="6.5" y2="9" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </div>
  );
}

// 0:30 … 24:00 v 30minutových krocích
const DURATION_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const totalMinutes = (i + 1) * 30;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return { label: `${h}:${m.toString().padStart(2, "0")}`, hours: totalMinutes / 60 };
});

// ─── Pomocné funkce ───────────────────────────────────────────────────────────
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatPragueDateTime(d);
}

function formatDate(iso: string | null): string {
  return formatCivilDate(iso);
}

function formatPragueMaybeToday(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const isToday = utcToPragueDateStr(d) === todayPragueDateStr();
  const time = formatPragueTime(d);
  return isToday ? time : `${formatPragueDateShort(d)} ${time}`;
}

function durationHuman(startIso: string, endIso: string): string {
  const mins = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h} hod`;
  return `${h} hod ${m} min`;
}

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h} hod`;
  return `${h}:${m.toString().padStart(2, "0")} hod`;
}

function emptyPresetDraft(type: string): JobPresetDraftValues {
  return {
    blockVariant: type === "ZAKAZKA" ? "STANDARD" : normalizeBlockVariant("STANDARD", type),
    specifikace: "",
    dataStatusId: "",
    dataRequiredDate: "",
    materialStatusId: "",
    materialRequiredDate: "",
    materialInStock: false,
    pantoneRequiredDate: "",
    barvyStatusId: "",
    lakStatusId: "",
    deadlineExpedice: "",
    jobPresetId: null,
    jobPresetLabel: "",
  };
}

// NOTE etapa 8: pro role bez přístupu k builderu stačí nevyrenderovat handle + aside
// — timeline s flex-1 se automaticky roztáhne na celou šířku

// ─── BlockEdit ────────────────────────────────────────────────────────────────
function BlockEdit({
  block,
  onClose,
  onSave,
  onBlockUpdate,
  allBlocks,
  onDeleteAll,
  onSaveAll,
  canEdit = true,
  canEditData = true,
  canEditMat = true,
  dataOpts: dataOptsProp,
  materialOpts: materialOptsProp,
  barvyOpts: barvyOptsProp,
  lakOpts: lakOptsProp,
  jobPresets = [],
  onToast,
}: {
  block: Block;
  onClose: () => void;
  onSave: (updated: Block) => void;
  onBlockUpdate?: (updated: Block) => void;
  allBlocks: Block[];
  onDeleteAll: (ids: number[]) => Promise<void>;
  onSaveAll: (ids: number[], payload: Record<string, unknown>) => Promise<void>;
  canEdit?: boolean;
  canEditData?: boolean;
  canEditMat?: boolean;
  dataOpts?: CodebookOption[];
  materialOpts?: CodebookOption[];
  barvyOpts?: CodebookOption[];
  lakOpts?: CodebookOption[];
  jobPresets?: JobPreset[];
  onToast?: (message: string, type: "success" | "error" | "info") => void;
}) {
  const [orderNumber, setOrderNumber] = useState(block.orderNumber);
  const [type, setType]               = useState(block.type);
  const [blockVariant, setBlockVariant] = useState<BlockVariant>(normalizeBlockVariant(block.blockVariant, block.type));
  const [description, setDescription] = useState(block.description ?? "");
  const [locked, setLocked]           = useState(block.locked);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Délka tisku
  const currentDurationHours = (new Date(block.endTime).getTime() - new Date(block.startTime).getTime()) / 3600000;
  const [durationHours, setDurationHours] = useState(currentDurationHours);

  // Termín expedice
  const [deadlineExpedice, setDeadlineExpedice] = useState(
    block.deadlineExpedice ? utcToPragueDateStr(new Date(block.deadlineExpedice)) : ""
  );

  // DATA
  const [dataStatusId, setDataStatusId]         = useState<string>(block.dataStatusId?.toString() ?? "");
  const [dataRequiredDate, setDataRequiredDate] = useState(
    block.dataRequiredDate ? utcToPragueDateStr(new Date(block.dataRequiredDate)) : ""
  );
  const [dataOk, setDataOk] = useState(block.dataOk);

  // MATERIÁL
  const [materialStatusId, setMaterialStatusId]         = useState<string>(block.materialStatusId?.toString() ?? "");
  const [materialRequiredDate, setMaterialRequiredDate] = useState(
    block.materialRequiredDate ? utcToPragueDateStr(new Date(block.materialRequiredDate)) : ""
  );
  const [materialOk, setMaterialOk]             = useState(block.materialOk);
  const [materialNote, setMaterialNote]         = useState(block.materialNote ?? "");
  const [materialInStock, setMaterialInStock]   = useState(block.materialInStock);
  // PANTONE
  const [pantoneRequiredDate, setPantoneRequiredDate] = useState(
    block.pantoneRequiredDate ? utcToPragueDateStr(new Date(block.pantoneRequiredDate)) : ""
  );
  const [pantoneOk, setPantoneOk] = useState(block.pantoneOk);
  // BARVY
  const [barvyStatusId, setBarvyStatusId] = useState<string>(block.barvyStatusId?.toString() ?? "");

  // LAK
  const [lakStatusId, setLakStatusId] = useState<string>(block.lakStatusId?.toString() ?? "");

  // SPECIFIKACE
  const [specifikace, setSpecifikace] = useState(block.specifikace ?? "");
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

  // SPLIT SKUPINA
  const splitGroup = block.splitGroupId != null
    ? allBlocks
        .filter((b) => b.splitGroupId === block.splitGroupId || b.id === block.splitGroupId)
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
    for (const draft of seriesOccDrafts) {
      const orig = curSeries.find((b) => b.id === draft.blockId);
      if (!orig) continue;
      const origDate = utcToPragueDateStr(new Date(orig.startTime));
      const origHour = utcToPragueHour(new Date(orig.startTime));
      const origDataDate = orig.dataRequiredDate ? utcToPragueDateStr(new Date(orig.dataRequiredDate)) : "";
      const origExpedice = orig.deadlineExpedice ? utcToPragueDateStr(new Date(orig.deadlineExpedice)) : "";
      if (draft.date === origDate && draft.hour === origHour && draft.dataRequiredDate === origDataDate && draft.deadlineExpedice === origExpedice) continue;
      attempted++;
      const origDuration = new Date(orig.endTime).getTime() - new Date(orig.startTime).getTime();
      const newStart = pragueToUTC(draft.date, draft.hour);
      const newEnd = new Date(newStart.getTime() + origDuration);
      try {
        const res = await fetch(`/api/blocks/${draft.blockId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startTime: newStart.toISOString(),
            endTime: newEnd.toISOString(),
            dataRequiredDate: draft.dataRequiredDate || null,
            deadlineExpedice: draft.deadlineExpedice || null,
          }),
        });
        if (res.ok) {
          const updated: Block = await res.json();
          onBlockUpdate?.(updated);
          saved++;
        }
      } catch { /* skip */ }
    }
    setSeriesOccSaving(false);
    if (attempted === 0) {
      onToast?.("Žádné změny k uložení.", "info");
    } else if (saved === attempted) {
      onToast?.(`Uloženo ${saved} výskytů.`, "success");
    } else if (saved > 0) {
      onToast?.(`Uloženo ${saved}/${attempted} výskytů — některé selhaly.`, "error");
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
      pantoneRequiredDate,
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
    setPantoneRequiredDate(next.pantoneRequiredDate);
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
    setPantoneRequiredDate(next.pantoneRequiredDate);
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
      dataOk,
      materialStatusId: materialStatusId ? parseInt(materialStatusId) : null,
      materialStatusLabel: materialStatusId ? resolveLabel(materialOpts, materialStatusId) : null,
      materialRequiredDate: materialInStock ? null : materialRequiredDate || null,
      materialOk,
      materialNote: materialNote.trim() || null,
      materialInStock,
      pantoneRequiredDate: pantoneRequiredDate || null,
      pantoneOk,
      barvyStatusId: barvyStatusId ? parseInt(barvyStatusId) : null,
      barvyStatusLabel: barvyStatusId ? resolveLabel(barvyOpts, barvyStatusId) : null,
      lakStatusId: lakStatusId ? parseInt(lakStatusId) : null,
      lakStatusLabel: lakStatusId ? resolveLabel(lakOpts, lakStatusId) : null,
      specifikace: specifikace.trim() || null,
      endTime: new Date(new Date(block.startTime).getTime() + durationHours * 3600000).toISOString(),
    };
  }

  async function doSave(payload: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/blocks/${block.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Chyba serveru");
      const updated: Block = await res.json();
      onSave(updated);
    } catch (error) {
      console.error("Block save failed", error);
      setError("Chyba při ukládání.");
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
  const SECTION = "fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: 'var(--text-muted)'";
  void SECTION;

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
      <div style={{ position: "relative" }}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            appearance: "none", width: "100%", height: 34,
            background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8,
            color: value ? "var(--text)" : "var(--text-muted)", fontSize: 11, fontWeight: 600,
            padding: "0 26px 0 10px", cursor: "pointer", outline: "none",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
        >
          <option value="">—</option>
          {opts.map((o) => (
            <option key={o.id} value={o.id.toString()}>
              {o.isWarning ? "⚠ " : ""}{o.label}
            </option>
          ))}
        </select>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"
          color="var(--text-muted)"
          style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
          <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  return (
    <div
      tabIndex={-1}
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)", outline: "none" }}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
        if (
          e.key === "Enter" && !e.shiftKey &&
          (e.target as HTMLElement).tagName !== "TEXTAREA" &&
          (e.target as HTMLElement).tagName !== "SELECT" &&
          !seriesConfirm
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
            {isInSeries && (
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent)", background: "color-mix(in oklab, var(--accent) 14%, transparent)", borderRadius: 4, padding: "1px 5px" }}>↻ Série</span>
            )}
            {isInSplit && (
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", background: "color-mix(in oklab, var(--text-muted) 12%, transparent)", borderRadius: 4, padding: "1px 5px" }}>
                ✂ Část {splitIndex + 1} / {splitGroup!.length}
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
              <button key={key} type="button" onClick={() => { setType(key); if (key !== "ZAKAZKA") setBlockVariant("STANDARD"); }} style={{ flex: 1, padding: "7px 4px", borderRadius: 7, border: type === key ? `1px solid ${cfg.color}` : "1px solid var(--border)", background: type === key ? `${cfg.color}22` : "var(--surface-2)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
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
          <div style={{ position: "relative" }}>
            <select
              value={String(durationHours)}
              onChange={(e) => setDurationHours(Number(e.target.value))}
              style={{
                appearance: "none", width: "100%", height: 32,
                background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10,
                color: "var(--text)", fontSize: 12, fontWeight: 600,
                padding: "0 32px 0 12px", cursor: "pointer", outline: "none",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
            >
              {DURATION_OPTIONS.map((opt) => (
                <option key={opt.hours} value={String(opt.hours)}>{opt.label}</option>
              ))}
            </select>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"
              color="var(--text-muted)"
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
              <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
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
                <DatePickerField value={dataRequiredDate} onChange={setDataRequiredDate} placeholder="Datum" />
                <label style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5, fontSize: 10, fontWeight: 600, color: dataOk ? "var(--success)" : "var(--text-muted)", cursor: "pointer", letterSpacing: "0.04em" }}>
                  <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, background: dataOk ? "var(--success)" : "transparent", border: dataOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 120ms ease-out" }}>
                    {dataOk && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <input type="checkbox" checked={dataOk} onChange={(e) => setDataOk(e.target.checked)} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                  OK
                </label>
              </div>
              {/* MATERIÁL */}
              <div style={{ opacity: !canEditMat ? 0.45 : 1, pointerEvents: !canEditMat ? "none" : "auto" }}>
                <ColLabel>Materiál</ColLabel>
                {materialInStock ? (
                  <div style={{ height: 32, display: "flex", alignItems: "center", borderRadius: 8, background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", padding: "0 10px", fontSize: 11, fontWeight: 700, color: "#10b981" }}>Skladem ✓</div>
                ) : (
                  <DatePickerField value={materialRequiredDate} onChange={setMaterialRequiredDate} placeholder="Datum" />
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
                  {!materialInStock && (
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
                </div>
              </div>
              {/* PANTONE */}
              <div style={{ opacity: !canEditMat ? 0.45 : 1, pointerEvents: !canEditMat ? "none" : "auto" }}>
                <ColLabel>Pantone</ColLabel>
                <DatePickerField value={pantoneRequiredDate} onChange={setPantoneRequiredDate} placeholder="Datum" />
                <label style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5, fontSize: 10, fontWeight: 600, color: pantoneOk ? "var(--success)" : "var(--text-muted)", cursor: "pointer", letterSpacing: "0.04em" }}>
                  <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, background: pantoneOk ? "var(--success)" : "transparent", border: pantoneOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 120ms ease-out" }}>
                    {pantoneOk && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <input type="checkbox" checked={pantoneOk} onChange={(e) => setPantoneOk(e.target.checked)} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                  OK
                </label>
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

        {/* Zamčeno */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          <Switch checked={locked} onCheckedChange={setLocked} />
          <Label style={{ fontSize: 11, color: locked ? "var(--brand)" : "var(--text-muted)", cursor: "pointer" }}>
            <Lock size={11} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }} />Zamčený blok
          </Label>
        </div>

        </div>{/* close: Hlavní pole disabled wrapper */}

        {/* ── Termíny série ── */}
        {canEdit && isInSeries && seriesOccDrafts.length > 1 && (
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Termíny série</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto" }}>
              {seriesOccDrafts.map((occ, i) => (
                <div key={occ.blockId} style={{ display: "flex", flexDirection: "column", gap: 3, padding: "6px 8px", borderRadius: 7, background: occ.blockId === block.id ? "rgba(59,130,246,0.08)" : "rgba(255,255,255,0.03)", border: occ.blockId === block.id ? "1px solid rgba(59,130,246,0.2)" : "1px solid rgba(255,255,255,0.06)" }}>
                  {/* Řádek 1: badge + Tisk datum + hodina */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      flexShrink: 0, width: 20, height: 20, borderRadius: 4,
                      background: occ.blockId === block.id ? "rgba(59,130,246,0.28)" : "rgba(59,130,246,0.1)",
                      border: occ.blockId === block.id ? "1px solid rgba(59,130,246,0.55)" : "1px solid rgba(59,130,246,0.2)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 9, fontWeight: 700, color: "#93c5fd",
                    }}>{i + 1}</div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-muted)", width: 28, flexShrink: 0 }}>Tisk:</div>
                    <div style={{ flex: 1 }}>
                      <DatePickerField
                        value={occ.date}
                        onChange={(d) => setSeriesOccDrafts((prev) => prev.map((o) => o.blockId === occ.blockId ? { ...o, date: d } : o))}
                        placeholder="Datum…"
                      />
                    </div>
                    <div style={{ flex: "0 0 72px", position: "relative" }}>
                      <select
                        value={occ.hour}
                        onChange={(e) => setSeriesOccDrafts((prev) => prev.map((o) => o.blockId === occ.blockId ? { ...o, hour: parseInt(e.target.value) } : o))}
                        style={{
                          appearance: "none", width: "100%", height: 30,
                          background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8,
                          color: "var(--text)", fontSize: 11, fontWeight: 600,
                          padding: "0 22px 0 8px", cursor: "pointer", outline: "none",
                        }}
                        onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                        ))}
                      </select>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" color="var(--text-muted)"
                        style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", width: 10, height: 10, pointerEvents: "none" }}>
                        <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
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
              ))}
            </div>
            <button
              type="button"
              onClick={handleSaveSeriesOccurrences}
              disabled={seriesOccSaving}
              style={{
                marginTop: 8, width: "100%", height: 30,
                borderRadius: 7, border: "1px solid rgba(59,130,246,0.3)",
                background: "rgba(59,130,246,0.12)", color: "#93c5fd",
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
          <div style={{ marginTop: 16, borderRadius: 8, border: "1px solid color-mix(in oklab, var(--accent) 30%, transparent)", background: "color-mix(in oklab, var(--accent) 8%, transparent)", padding: "12px 14px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 8 }}>
              {seriesConfirm === "save" ? "Uložit změny pro…" : "Smazat…"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button
                disabled={saving}
                onClick={async () => {
                  if (seriesConfirm === "save" && pendingSavePayload.current) {
                    await doSave(pendingSavePayload.current);
                  } else if (seriesConfirm === "delete") {
                    await onDeleteAll([block.id]);
                    onClose();
                  }
                  setSeriesConfirm(null);
                }}
                style={{ background: "color-mix(in oklab, var(--accent) 15%, transparent)", border: "1px solid color-mix(in oklab, var(--accent) 35%, transparent)", borderRadius: 7, color: "var(--accent)", fontSize: 11, fontWeight: 600, padding: "7px 12px", cursor: saving ? "default" : "pointer", opacity: saving ? 0.65 : 1, textAlign: "left" }}
              >
                Jen tuto instanci
              </button>
              <button
                disabled={saving}
                onClick={async () => {
                  if (seriesConfirm === "save" && pendingSavePayload.current) {
                    const ids = getSeriesIds();
                    await onSaveAll(ids, pendingSavePayload.current);
                    onClose();
                  } else if (seriesConfirm === "delete") {
                    const ids = getFollowingSeriesIds();
                    await onDeleteAll(ids);
                    onClose();
                  }
                  setSeriesConfirm(null);
                }}
                style={{ background: "color-mix(in oklab, var(--accent) 15%, transparent)", border: "1px solid color-mix(in oklab, var(--accent) 35%, transparent)", borderRadius: 7, color: "var(--accent)", fontSize: 11, fontWeight: 600, padding: "7px 12px", cursor: saving ? "default" : "pointer", opacity: saving ? 0.65 : 1, textAlign: "left" }}
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
                    onClick={() => onDeleteAll([block.id]).then(onClose)}
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
    </div>
  );
}

// ─── BlockDetail ──────────────────────────────────────────────────────────────
function BlockDetail({
  block,
  onClose,
  onDelete,
}: {
  block: Block;
  onClose: () => void;
  onDelete: (id: number) => void;
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
          <div style={{ display: "flex", flexDirection: "column" }}>
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

// ─── InfoPanel ────────────────────────────────────────────────────────────────
const FIELD_LABELS: Record<string, string> = {
  jobPresetLabel: "Preset",
  dataStatusLabel: "DATA stav",
  dataRequiredDate: "DATA datum",
  dataOk: "DATA OK",
  materialStatusLabel: "Materiál stav",
  materialRequiredDate: "Materiál datum",
  materialOk: "Materiál OK",
  materialNote: "Poznámka MTZ",
  materialInStock: "Materiál skladem",
  deadlineExpedice: "Expedice termín",
  pantoneRequiredDate: "Pantone datum",
  pantoneOk: "Pantone OK",
  blockVariant: "Stav zakázky",
};

function fmtAuditVal(val: string | null, field: string | null) {
  if (!val || val === "null") return "—";
  if (field === "dataOk" || field === "materialOk") return val === "true" ? "✓ OK" : "✗ Ne";
  if (field && ["dataRequiredDate", "materialRequiredDate", "pantoneRequiredDate", "deadlineExpedice"].includes(field)) {
    return formatCivilDate(val);
  }
  if (val.includes("T")) {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) return formatPragueDateTime(d);
  }
  return val;
}

function InfoPanel({ logs, onClose, onJumpToBlock }: { logs: AuditLogEntry[]; onClose: () => void; onJumpToBlock: (orderNumber: string) => void }) {
  function fmtDatetime(iso: string) {
    return formatPragueMaybeToday(iso);
  }
  function fmtVal(val: string | null, field: string | null) {
    return fmtAuditVal(val, field);
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--surface)", borderLeft: "1px solid var(--border)" }}>
      <div style={{ padding: "10px 16px", background: "linear-gradient(135deg, color-mix(in oklab, var(--surface-2) 95%, transparent) 0%, var(--surface) 100%)", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Posledních 3 dny</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginTop: 2 }}>DTP + MTZ aktivita</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-xs text-slate-400"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="15 18 9 12 15 6"/></svg> Zpět</Button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px" }}>
        {logs.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", marginTop: 32 }}>
            Žádné změny od DTP / MTZ za poslední 3 dny.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {logs.map((log) => (
              <div key={log.id} style={{ padding: "8px 10px", borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{log.username}</span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{fmtDatetime(log.createdAt)}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {log.orderNumber ? (
                    <button
                      onClick={() => { onClose(); onJumpToBlock(log.orderNumber!); }}
                      style={{ background: "none", border: "none", padding: 0, color: "#3b82f6", fontWeight: 600, cursor: "pointer", fontSize: 11, textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2 }}
                    >
                      {log.orderNumber}
                    </button>
                  ) : (
                    <span>#{log.blockId}</span>
                  )}
                  {log.action === "UPDATE" && log.field && (
                    <span> · {FIELD_LABELS[log.field] ?? log.field}: <span style={{ color: "var(--text)" }}>{fmtVal(log.oldValue, log.field)} → {fmtVal(log.newValue, log.field)}</span></span>
                  )}
                  {log.action === "CREATE" && <span style={{ color: "#22c55e" }}> · Přidána</span>}
                  {log.action === "DELETE" && <span style={{ color: "#ef4444" }}> · Smazána</span>}
                  {log.action === "PRINT_COMPLETE" && <span style={{ color: "#22c55e" }}> · ✓ Tisk dokončen</span>}
                  {log.action === "PRINT_UNDO" && <span style={{ color: "#f59e0b" }}> · Vráceno hotovo</span>}
                  {log.action === "PRINT_RESET" && <span style={{ color: "#64748b" }}> · Reset potvrzení (přeplánováno)</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── InboxPanel ───────────────────────────────────────────────────────────────
function InboxPanel({ notifications, onClose, onMarkRead, onJumpToBlock }: {
  notifications: NotificationItem[];
  onClose: () => void;
  onMarkRead: (id: number) => void;
  onJumpToBlock: (orderNumber: string) => void;
}) {
  function fmtDatetime(iso: string) {
    return formatPragueMaybeToday(iso);
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--surface)", borderLeft: "1px solid var(--border)" }}>
      <div style={{ padding: "10px 16px", background: "linear-gradient(135deg, color-mix(in oklab, var(--surface-2) 95%, transparent) 0%, var(--surface) 100%)", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Inbox</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginTop: 2 }}>Upozornění</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-xs text-slate-400"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="15 18 9 12 15 6"/></svg> Zpět</Button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px" }}>
        {notifications.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", marginTop: 32 }}>
            Žádná upozornění.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {notifications.map((n) => {
              const isReservationNotif = n.type && n.type !== "BLOCK_NOTIFY";
              return (
                <div key={n.id} style={{ padding: "8px 10px", borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)", opacity: n.isRead ? 0.5 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>od {n.createdByUsername}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{fmtDatetime(n.createdAt)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    {isReservationNotif ? (
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.4 }}>{n.message}</div>
                        {n.reservationId && (
                          <a
                            href={`/rezervace?id=${n.reservationId}`}
                            style={{ fontSize: 11, color: "#7c3aed", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2 }}
                          >
                            → Zobrazit rezervaci
                          </a>
                        )}
                      </div>
                    ) : n.blockOrderNumber ? (
                      <button
                        onClick={() => onJumpToBlock(n.blockOrderNumber!)}
                        style={{ background: "none", border: "none", padding: 0, color: "#3b82f6", fontWeight: 600, cursor: "pointer", fontSize: 11, textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2 }}
                      >
                        {n.blockOrderNumber}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>#{n.blockId}</span>
                    )}
                    {!n.isRead && (
                      <button
                        onClick={() => onMarkRead(n.id)}
                        style={{ fontSize: 10, fontWeight: 600, color: "#22c55e", background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}
                      >
                        ✓ Přečteno
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ShutdownManager ──────────────────────────────────────────────────────────
type EditState = { label: string; startDate: string; endDate: string; startHour: number; endHour: number; machine: "both" | "XL_105" | "XL_106" };

function machineBadgeStyle(m?: string | null): React.CSSProperties {
  return {
    flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", borderRadius: 4, padding: "1px 5px",
    background: !m ? "rgba(139,92,246,0.55)" : m === "XL_105" ? "rgba(37,99,235,0.65)" : "rgba(22,163,74,0.65)",
    color: !m ? "#f3e8ff" : m === "XL_105" ? "#dbeafe" : "#dcfce7",
    border: `1px solid ${!m ? "rgba(167,139,250,0.5)" : m === "XL_105" ? "rgba(96,165,250,0.5)" : "rgba(74,222,128,0.5)"}`,
  };
}

function MachinePicker({ value, onChange }: { value: "both" | "XL_105" | "XL_106"; onChange: (v: "both" | "XL_105" | "XL_106") => void }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {(["both", "XL_105", "XL_106"] as const).map((opt) => {
        const lbl = opt === "both" ? "Oba stroje" : opt === "XL_105" ? "XL 105" : "XL 106";
        const active = value === opt;
        return (
          <button key={opt} type="button" onClick={() => onChange(opt)} style={{
            flex: 1, height: 28, borderRadius: 6, fontSize: 11, fontWeight: active ? 700 : 500,
            border: active ? "1px solid rgba(139,92,246,0.5)" : "1px solid var(--border)",
            background: active ? "rgba(139,92,246,0.15)" : "var(--surface-2)",
            color: active ? "#c4b5fd" : "var(--text-muted)",
            cursor: "pointer", transition: "all 0.12s ease-out",
          }}>{lbl}</button>
        );
      })}
    </div>
  );
}

function ShutdownManager({
  companyDays,
  onAdd,
  onUpdate,
  onDelete,
  onClose,
}: {
  companyDays: CompanyDay[];
  onAdd: (startDate: string, endDate: string, label: string, machine: string | null) => Promise<void>;
  onUpdate: (id: number, startDate: string, endDate: string, label: string, machine: string | null) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onClose: () => void;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate]     = useState("");
  const [startHour, setStartHour] = useState(0);
  const [endHour, setEndHour]     = useState(23);
  const [label, setLabel]         = useState("");
  const [machine, setMachine]     = useState<"both" | "XL_105" | "XL_106">("both");
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState<number | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const hourSelectStyle: React.CSSProperties = {
    height: 32, borderRadius: 6, border: "1px solid var(--border)",
    background: "var(--surface-2)", color: "var(--text)", fontSize: 11,
    padding: "0 6px", cursor: "pointer", width: "100%",
  };

  function startEdit(cd: CompanyDay) {
    const s = new Date(cd.startDate);
    const e = new Date(cd.endDate);
    setEditingId(cd.id);
    setEditState({
      label: cd.label,
      startDate: utcToPragueDateStr(s),
      endDate: utcToPragueDateStr(e),
      startHour: utcToPragueHour(s),
      endHour: utcToPragueHour(e),
      machine: !cd.machine ? "both" : cd.machine === "XL_105" ? "XL_105" : "XL_106",
    });
  }

  function cancelEdit() { setEditingId(null); setEditState(null); }

  async function handleAdd() {
    if (!startDate || !endDate || !label.trim()) { setError("Vyplňte všechna pole."); return; }
    const startUTC = pragueToUTC(startDate, startHour, 0);
    const endUTC   = pragueToUTC(endDate, endHour, 59);
    if (endUTC <= startUTC) { setError("Konec musí být po začátku."); return; }
    setSaving(true); setError(null);
    try {
      await onAdd(startUTC.toISOString(), endUTC.toISOString(), label.trim(), machine === "both" ? null : machine);
      setStartDate(""); setEndDate(""); setLabel(""); setStartHour(0); setEndHour(23); setMachine("both");
    } catch (error) {
      console.error("Company day save failed", error);
      setError("Chyba při ukládání.");
    }
    finally { setSaving(false); }
  }

  async function handleSaveEdit(id: number) {
    if (!editState) return;
    if (!editState.startDate || !editState.endDate || !editState.label.trim()) { setError("Vyplňte všechna pole."); return; }
    const startUTC = pragueToUTC(editState.startDate, editState.startHour, 0);
    const endUTC   = pragueToUTC(editState.endDate, editState.endHour, 59);
    if (endUTC <= startUTC) { setError("Konec musí být po začátku."); return; }
    setEditSaving(true); setError(null);
    try {
      await onUpdate(id, startUTC.toISOString(), endUTC.toISOString(), editState.label.trim(), editState.machine === "both" ? null : editState.machine);
      cancelEdit();
    } catch (err) {
      console.error("Company day update failed", err);
      setError("Chyba při ukládání.");
    }
    finally { setEditSaving(false); }
  }

  async function handleDelete(id: number) {
    setDeleting(id);
    try { await onDelete(id); }
    catch (error) {
      console.error("Company day delete failed", error);
      setError("Chyba při mazání.");
    }
    finally { setDeleting(null); }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)" }}>
      <div style={{ padding: "10px 16px", background: "linear-gradient(135deg, color-mix(in oklab, var(--surface-2) 95%, transparent) 0%, var(--surface) 100%)", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Firemní dny</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginTop: 2 }}>Odstávky a svátky</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-xs text-slate-400"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="15 18 9 12 15 6"/></svg> Zpět</Button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px" }}>
        {error && (
          <div style={{ marginBottom: 12, borderRadius: 6, background: "color-mix(in oklab, var(--danger) 15%, transparent)", border: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)", padding: "8px 12px", fontSize: 11, color: "var(--danger)" }}>{error}</div>
        )}

        {/* Formulář */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Přidat odstávku</div>
          <div>
            <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Název</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Velikonoce, dovolená…" className="h-8 text-xs" />
          </div>
          <div>
            <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Stroj</Label>
            <MachinePicker value={machine} onChange={setMachine} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto", gap: 6, alignItems: "end" }}>
            <div>
              <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Od (datum)</Label>
              <DatePickerField value={startDate} onChange={setStartDate} placeholder="Od…" />
            </div>
            <div>
              <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Hod.</Label>
              <select value={startHour} onChange={(e) => setStartHour(Number(e.target.value))} style={hourSelectStyle}>
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                ))}
              </select>
            </div>
            <div>
              <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Do (datum)</Label>
              <DatePickerField value={endDate} onChange={setEndDate} placeholder="Do…" />
            </div>
            <div>
              <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Hod.</Label>
              <select value={endHour} onChange={(e) => setEndHour(Number(e.target.value))} style={hourSelectStyle}>
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, "0")}:59</option>
                ))}
              </select>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={handleAdd}
            disabled={saving || !label.trim() || !startDate || !endDate}
            className="w-full text-xs font-semibold border border-purple-400/35 bg-purple-400/[0.06] text-purple-400 hover:bg-purple-400/[0.12] hover:text-purple-400 disabled:text-slate-600 disabled:border-slate-700 disabled:bg-transparent"
          >
            {saving ? "Ukládám…" : "＋ Přidat"}
          </Button>
        </div>

        <Separator className="my-1 bg-slate-800" />

        {/* Seznam */}
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>
            Uložené ({companyDays.length})
          </div>
          {companyDays.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: "12px 0" }}>Žádné záznamy</div>
          )}
          {companyDays.map((cd) => (
            <div key={cd.id} style={{ background: editingId === cd.id ? "rgba(139,92,246,0.1)" : "rgba(139,92,246,0.06)", border: `1px solid ${editingId === cd.id ? "rgba(139,92,246,0.35)" : "rgba(139,92,246,0.15)"}`, borderRadius: 8, overflow: "hidden" }}>
              {/* Řádek s názvem */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#c4b5fd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{cd.label}</div>
                    <span style={machineBadgeStyle(cd.machine)}>
                      {!cd.machine ? "OBA" : cd.machine === "XL_105" ? "XL 105" : "XL 106"}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {(() => {
                      const tz = "Europe/Prague";
                      const s = new Date(cd.startDate);
                      const e = new Date(cd.endDate);
                      const sDate = s.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz });
                      const eDate = e.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz });
                      const sHour = utcToPragueHour(s); const eHour = utcToPragueHour(e);
                      const wholeDay = sHour === 0 && eHour === 23;
                      const sTime = wholeDay ? "" : ` ${String(sHour).padStart(2, "0")}:00`;
                      const eTime = wholeDay ? "" : ` ${String(eHour).padStart(2, "0")}:59`;
                      const sDateStr = utcToPragueDateStr(s);
                      const eDateStr = utcToPragueDateStr(e);
                      const sameDateStr = sDateStr === eDateStr;
                      return sameDateStr ? `${sDate}${sTime}${eTime && sTime !== eTime ? ` – ${eTime.trim()}` : ""}` : `${sDate}${sTime} – ${eDate}${eTime}`;
                    })()}
                  </div>
                </div>
                {/* Tlačítka */}
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => editingId === cd.id ? cancelEdit() : startEdit(cd)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: editingId === cd.id ? "#c4b5fd" : "var(--text-muted)", fontSize: 13, padding: "0 4px", lineHeight: 1 }}
                    title={editingId === cd.id ? "Zrušit editaci" : "Upravit"}
                  >
                    {editingId === cd.id ? "✕" : "✎"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(cd.id)}
                    disabled={deleting === cd.id}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 16, padding: "0 4px", lineHeight: 1 }}
                    title="Smazat"
                  >
                    {deleting === cd.id ? "…" : "×"}
                  </button>
                </div>
              </div>

              {/* Inline editační formulář */}
              {editingId === cd.id && editState && (
                <div style={{ borderTop: "1px solid rgba(139,92,246,0.2)", padding: "10px 10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div>
                    <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Název</Label>
                    <Input value={editState.label} onChange={(e) => setEditState((s) => s && ({ ...s, label: e.target.value }))} className="h-8 text-xs" />
                  </div>
                  <div>
                    <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Stroj</Label>
                    <MachinePicker value={editState.machine} onChange={(v) => setEditState((s) => s && ({ ...s, machine: v }))} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto", gap: 6, alignItems: "end" }}>
                    <div>
                      <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Od</Label>
                      <DatePickerField value={editState.startDate} onChange={(v) => setEditState((s) => s && ({ ...s, startDate: v }))} placeholder="Od…" />
                    </div>
                    <div>
                      <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Hod.</Label>
                      <select value={editState.startHour} onChange={(e) => setEditState((s) => s && ({ ...s, startHour: Number(e.target.value) }))} style={hourSelectStyle}>
                        {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}
                      </select>
                    </div>
                    <div>
                      <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Do</Label>
                      <DatePickerField value={editState.endDate} onChange={(v) => setEditState((s) => s && ({ ...s, endDate: v }))} placeholder="Do…" />
                    </div>
                    <div>
                      <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Hod.</Label>
                      <select value={editState.endHour} onChange={(e) => setEditState((s) => s && ({ ...s, endHour: Number(e.target.value) }))} style={hourSelectStyle}>
                        {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:59</option>)}
                      </select>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleSaveEdit(cd.id)}
                    disabled={editSaving || !editState.label.trim() || !editState.startDate || !editState.endDate}
                    className="w-full text-xs font-semibold border border-purple-400/35 bg-purple-400/[0.06] text-purple-400 hover:bg-purple-400/[0.12] hover:text-purple-400 disabled:text-slate-600 disabled:border-slate-700 disabled:bg-transparent"
                  >
                    {editSaving ? "Ukládám…" : "Uložit změny"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ResizeHandle ─────────────────────────────────────────────────────────────
function ResizeHandle({ onMouseDown }: { onMouseDown: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseDown={(e) => { e.preventDefault(); onMouseDown(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 8, flexShrink: 0, position: "relative", zIndex: 20,
        cursor: "col-resize", display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: hovered ? "rgb(59 130 246 / 0.4)" : "var(--border)",
        transition: "background-color 0.15s",
      }}
    >
      {hovered && (
        <div style={{ color: "rgb(148 163 184)", fontSize: 10, lineHeight: 1, userSelect: "none", pointerEvents: "none", display: "flex", gap: 1 }}>
          <span>⇐</span><span>⇒</span>
        </div>
      )}
    </div>
  );
}

// ─── ToastContainer ──────────────────────────────────────────────────────────
function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  const borderColor = { success: "var(--success)", error: "var(--danger)", info: "var(--info)" };
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}
    >
      {toasts.map((t) => (
        <div key={t.id} role="status" style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "color-mix(in oklab, var(--surface) 92%, transparent)", backdropFilter: "blur(12px)",
          borderTop: "1px solid var(--border)",
          borderRight: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          borderLeft: `3px solid ${borderColor[t.type]}`,
          borderRadius: 10, padding: "10px 14px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          minWidth: 220, maxWidth: 340,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
          fontSize: 13, color: "var(--text)",
          pointerEvents: "auto",
          animation: "toast-in 0.15s ease-out",
        }}>
          <span style={{ flex: 1, lineHeight: 1.4 }}>{t.message}</span>
          <button
            type="button"
            aria-label="Zavřít oznámení"
            onClick={() => onDismiss(t.id)}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0 }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Reservation queue types ──────────────────────────────────────────────────
type ReservationQueueItem = {
  id: number;
  code: string;
  companyName: string;
  planningPayload: Record<string, unknown> | null;
  requestedExpeditionDate: string;
  requestedDataDate: string;
  preparedAt: string | null;
};

function reservationToQueueItem(r: ReservationQueueItem): QueueItem {
  const p = r.planningPayload ?? {};
  return {
    id: `r_${r.id}`,
    orderNumber: r.code,
    type: "REZERVACE",
    blockVariant: "STANDARD",
    jobPresetId: typeof p.jobPresetId === "number" ? p.jobPresetId : typeof p.jobPresetId === "string" ? Number(p.jobPresetId) || null : null,
    jobPresetLabel: typeof p.jobPresetLabel === "string" ? p.jobPresetLabel : null,
    durationHours: typeof p.durationHours === "number" ? p.durationHours : 2,
    description: typeof p.description === "string" ? p.description : r.companyName,
    dataStatusId: null,
    dataStatusLabel: null,
    dataRequiredDate: typeof p.dataRequiredDate === "string" ? p.dataRequiredDate : r.requestedDataDate.slice(0, 10),
    materialStatusId: null,
    materialStatusLabel: null,
    materialRequiredDate: typeof p.materialRequiredDate === "string" ? p.materialRequiredDate : null,
    materialInStock: Boolean(p.materialInStock),
    pantoneRequiredDate: typeof p.pantoneRequiredDate === "string" ? p.pantoneRequiredDate : null,
    pantoneOk: Boolean(p.pantoneOk),
    barvyStatusId: null,
    barvyStatusLabel: null,
    lakStatusId: null,
    lakStatusLabel: null,
    specifikace: typeof p.specifikace === "string" ? p.specifikace : "",
    deadlineExpedice: typeof p.deadlineExpedice === "string" ? p.deadlineExpedice : r.requestedExpeditionDate.slice(0, 10),
    recurrenceType: "NONE",
    recurrenceCount: 1,
    reservationId: r.id,
    reservationCode: r.code,
    companyName: r.companyName,
  };
}

// ─── PlannerPage ──────────────────────────────────────────────────────────────
export default function PlannerPage({ initialBlocks, initialCompanyDays, initialMachineWorkHoursTemplates, initialMachineExceptions, currentUser, initialQueueReservations = [], initialFilterText }: { initialBlocks: Block[]; initialCompanyDays: CompanyDay[]; initialMachineWorkHoursTemplates: MachineWorkHoursTemplate[]; initialMachineExceptions: MachineScheduleException[]; currentUser: { id: number; username: string; role: string; assignedMachine?: string | null }; initialQueueReservations?: ReservationQueueItem[]; initialFilterText?: string }) {
  // Role-based permissions
  const canEdit     = ["ADMIN", "PLANOVAT"].includes(currentUser.role);
  const canEditData = canEdit || currentUser.role === "DTP";
  const canEditMat  = canEdit || currentUser.role === "MTZ";
  const isTiskar    = currentUser.role === "TISKAR";

  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [companyDays, setCompanyDays] = useState<CompanyDay[]>(initialCompanyDays);
  const [machineWorkHoursTemplates, setMachineWorkHoursTemplates] = useState<MachineWorkHoursTemplate[]>(initialMachineWorkHoursTemplates);
  const [machineExceptions, setMachineExceptions] = useState<MachineScheduleException[]>(initialMachineExceptions);
  const [showShutdowns, setShowShutdowns] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [todayAuditLogs, setTodayAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditNewCount, setAuditNewCount] = useState(0);
  const [showInboxPanel, setShowInboxPanel] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifNewCount, setNotifNewCount] = useState(0);

  // ── Toast systém ──
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  function showToast(message: string, type: Toast["type"] = "info") {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }

  // ── Undo/Redo ──
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [workingTimeLock, setWorkingTimeLock] = useState(true);
  const workingTimeLockRef = useRef(true);
  workingTimeLockRef.current = workingTimeLock;
  const MAX_HISTORY = 30;

  // Builder form fields
  const [orderNumber, setOrderNumber]     = useState("");
  const [type, setType]                   = useState("ZAKAZKA");
  const [blockVariant, setBlockVariant]   = useState<BlockVariant>("STANDARD");
  const [durationHours, setDurationHours] = useState(1);
  const [description, setDescription]     = useState("");
  const [bDeadlineExpedice, setBDeadlineExpedice] = useState("");
  const [bDataStatusId, setBDataStatusId]         = useState<string>("");
  const [bDataRequiredDate, setBDataRequiredDate] = useState<string>("");
  const [bMaterialStatusId, setBMaterialStatusId]         = useState<string>("");
  const [bMaterialRequiredDate, setBMaterialRequiredDate] = useState<string>("");
  const [bMaterialInStock, setBMaterialInStock]           = useState(false);
  const [bPantoneRequiredDate, setBPantoneRequiredDate]   = useState<string>("");
  const [bPantoneOk, setBPantoneOk]                       = useState(false);
  const [bBarvyStatusId, setBBarvyStatusId]       = useState<string>("");
  const [bLakStatusId, setBLakStatusId]           = useState<string>("");
  const [bSpecifikace, setBSpecifikace]           = useState("");
  const [bJobPresetId, setBJobPresetId]           = useState<number | null>(null);
  const [bJobPresetLabel, setBJobPresetLabel]     = useState("");
  const [bRecurrenceType, setBRecurrenceType]     = useState("NONE");
  const [bRecurrenceCount, setBRecurrenceCount]   = useState(2);
  // Serie flow (jen pro bRecurrenceType !== "NONE")
  const [bSeriesMachine, setBSeriesMachine]       = useState<"XL_105" | "XL_106">("XL_105");
  const [bSeriesFirstDate, setBSeriesFirstDate]   = useState<string>("");
  const [bSeriesFirstHour, setBSeriesFirstHour]   = useState<number>(7);
  const [seriesPreview, setSeriesPreview]         = useState<Array<{ date: string; hour: number; dataRequiredDate: string; deadlineExpedice: string }>>([]);
  const [seriesScheduling, setSeriesScheduling]   = useState(false);

  // Číselníky pro builder
  const [bDataOpts, setBDataOpts]         = useState<CodebookOption[]>([]);
  const [bMaterialOpts, setBMaterialOpts] = useState<CodebookOption[]>([]);
  const [bBarvyOpts, setBBarvyOpts]       = useState<CodebookOption[]>([]);
  const [bLakOpts, setBLakOpts]           = useState<CodebookOption[]>([]);
  const [jobPresets, setJobPresets]       = useState<JobPreset[]>([]);

  // Lookup mapa badgeColor pro TimelineGrid — jen id → barva, fallback null = zachovat per-field výchozí
  const badgeColorMap: Record<number, string | null> = Object.fromEntries(
    [...bDataOpts, ...bMaterialOpts, ...bBarvyOpts, ...bLakOpts]
      .map((o) => [o.id, o.badgeColor])
  );

  const compatibleBuilderPresets = useMemo(
    () => jobPresets.filter((preset) => preset.isActive && presetSupportsType(preset, type)),
    [jobPresets, type]
  );
  useEffect(() => {
    if (type === "UDRZBA") {
      if (bJobPresetId !== null || bJobPresetLabel) {
        setBJobPresetId(null);
        setBJobPresetLabel("");
      }
      return;
    }
    if (bJobPresetId === null) return;
    const existingPreset = jobPresets.find((preset) => preset.id === bJobPresetId);
    if (existingPreset && presetSupportsType(existingPreset, type)) return;
    setBJobPresetId(null);
    setBJobPresetLabel("");
  }, [bJobPresetId, bJobPresetLabel, jobPresets, type]);

  // Queue (manuální)
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueIdRef = useRef(0);
  const [draggingQueueItem, setDraggingQueueItem] = useState<QueueItem | null>(null);

  // Rezervační fronta (QUEUE_READY rezervace ze serveru — persistentní)
  const [reservationQueue, setReservationQueue] = useState<QueueItem[]>(() =>
    initialQueueReservations.map(reservationToQueueItem)
  );

  // Timeline state
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [keyDeletePending, setKeyDeletePending] = useState(false);
  const [multiDeletePending, setMultiDeletePending] = useState(false);
  const [editingBlock, setEditingBlock]   = useState<Block | null>(null);
  const [copiedBlock, setCopiedBlock] = useState<Block | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<number>>(new Set());
  const [pushSuggestion, setPushSuggestion] = useState<PushSuggestion | null>(null);
  const blocksRef = useRef<Block[]>([]);
  blocksRef.current = blocks;
  const selectedBlockIdsRef = useRef<Set<number>>(new Set());
  selectedBlockIdsRef.current = selectedBlockIds;
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
  const [slotHeight, setSlotHeight] = useState(26);
  const zoomAnchorMs = useRef<number | null>(null); // ms od epochy = datum středu viewportu

  function handleZoomChange(newHeight: number) {
    const el = scrollRef.current;
    if (el) {
      const centerY = el.scrollTop + el.clientHeight / 2;
      // yToDate inline: viewStart + (y / slotHeight * 30 min)
      const anchorDate = new Date(viewStart.getTime() + (centerY / slotHeight) * 30 * 60000);
      zoomAnchorMs.current = anchorDate.getTime();
    }
    setSlotHeight(newHeight);
  }

  useLayoutEffect(() => {
    const anchorMs = zoomAnchorMs.current;
    const el = scrollRef.current;
    if (anchorMs === null || !el) return;
    const newY = dateToY(new Date(anchorMs), viewStart, slotHeight);
    el.scrollTop = newY - el.clientHeight / 2;
    zoomAnchorMs.current = null;
  }, [slotHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Načtení preferencí z localStorage po mount (SSR-safe — default se renderuje server i client stejně)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setFilterText(q);
    const z = localStorage.getItem("ig-planner-zoom");
    if (z) setSlotHeight(Math.max(3, Math.min(26, Number(z))));
    const w = localStorage.getItem("ig-planner-aside-width");
    if (w) setAsideWidth(Math.max(200, Math.min(600, Number(w))));
  }, []);

  useEffect(() => { localStorage.setItem("ig-planner-zoom", String(slotHeight)); }, [slotHeight]);

  // Resizable aside
  const [asideWidth, setAsideWidth] = useState(320);
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
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => { localStorage.setItem("ig-planner-aside-width", String(asideWidth)); }, [asideWidth]);

  // Načtení číselníků pro builder
  useEffect(() => {
    Promise.all([
      fetch("/api/codebook?category=DATA").then((r) => r.json()),
      fetch("/api/codebook?category=MATERIAL").then((r) => r.json()),
      fetch("/api/codebook?category=BARVY").then((r) => r.json()),
      fetch("/api/codebook?category=LAK").then((r) => r.json()),
      fetch("/api/job-presets?includeInactive=true").then((r) => r.json()),
    ]).then(([d, m, b, l, presets]) => {
      setBDataOpts(d);
      setBMaterialOpts(m);
      setBBarvyOpts(b);
      setBLakOpts(l);
      setJobPresets(Array.isArray(presets) ? presets : []);
    }).catch((error) => {
      console.error("Planner supporting data load failed", error);
      showToast("Nepodařilo se načíst číselníky a presety.", "error");
    });
  }, []);

  // Načtení dnešních audit logů (jen pro ADMIN + PLANOVAT)
  const fetchTodayAudit = useCallback(() => {
    if (!["ADMIN", "PLANOVAT"].includes(currentUser.role)) return;
    fetch("/api/audit/today")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: AuditLogEntry[]) => {
        setTodayAuditLogs(data);
        const lastSeen = localStorage.getItem("auditLastSeen");
        const lastSeenTime = lastSeen ? new Date(lastSeen).getTime() : 0;
        const newCount = data.filter((l) => new Date(l.createdAt).getTime() > lastSeenTime).length;
        setAuditNewCount(newCount);
      })
      .catch(() => { /* zachovat poslední validní data a count — neměnit stav */ });
  }, [currentUser.role]);

  // Načtení notifikací (DTP + MTZ + OBCHODNIK)
  const fetchNotifications = useCallback(() => {
    if (!["DTP", "MTZ", "OBCHODNIK"].includes(currentUser.role)) return;
    fetch("/api/notifications")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data: NotificationItem[]) => {
        setNotifications(data);
        setNotifNewCount(data.filter((n) => !n.isRead).length);
      })
      .catch(() => { /* zachovat poslední validní stav */ });
  }, [currentUser.role]);

  useEffect(() => {
    fetchTodayAudit();
    fetchNotifications();
    const interval = setInterval(() => { fetchTodayAudit(); fetchNotifications(); }, 60_000);
    return () => clearInterval(interval);
  }, [fetchTodayAudit, fetchNotifications]);

  // Refresh schedule (machineWorkHours + exceptions) při návratu do okna —
  // zajišťuje, že klientský snap používá aktuální data i po změně v jiné relaci
  useEffect(() => {
    async function refreshSchedule() {
      try {
        const [shiftsRes, exceptionsRes] = await Promise.all([
          fetch("/api/machine-shifts"),
          fetch("/api/machine-exceptions"),
        ]);
        if (shiftsRes.ok) setMachineWorkHoursTemplates(await shiftsRes.json());
        if (exceptionsRes.ok) setMachineExceptions(await exceptionsRes.json());
      } catch (e) { console.debug("[schedule refresh]", e); /* tiché — stale data jsou lepší než error toast */ }
    }
    window.addEventListener("focus", refreshSchedule);
    window.addEventListener("machineScheduleUpdated", refreshSchedule);
    return () => {
      window.removeEventListener("focus", refreshSchedule);
      window.removeEventListener("machineScheduleUpdated", refreshSchedule);
    };
  }, []);

  // Polling bloků každých 30 s — merge jen printCompleted* pole
  useEffect(() => {
    const pollBlocks = async () => {
      try {
        const res = await fetch("/api/blocks");
        if (!res.ok) return;
        const fresh: Block[] = await res.json();
        const freshById = new Map(fresh.map((block) => [block.id, block]));
        const mergePrintCompleted = (b: Block): Block => {
          const f = freshById.get(b.id);
          if (!f) return b;
          if (
            b.printCompletedAt === f.printCompletedAt &&
            b.printCompletedByUserId === f.printCompletedByUserId &&
            b.printCompletedByUsername === f.printCompletedByUsername
          ) {
            return b;
          }
          return {
            ...b,
            printCompletedAt: f.printCompletedAt,
            printCompletedByUserId: f.printCompletedByUserId,
            printCompletedByUsername: f.printCompletedByUsername,
          };
        };
        setBlocks((prev) => {
          let changed = false;
          const next = prev.map((block) => {
            const merged = mergePrintCompleted(block);
            if (merged !== block) changed = true;
            return merged;
          });
          return changed ? next : prev;
        });
        setSelectedBlock((sel) => sel ? mergePrintCompleted(sel) : null);
        setEditingBlock((eb) => eb ? mergePrintCompleted(eb) : null);
      } catch {
        // tiché selhání — zachovat aktuální stav
      }
    };
    const t = setInterval(pollBlocks, 30_000);
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
        // revert — znovu načíst
        const r = await fetch("/api/blocks");
        if (r.ok) { const fresh: Block[] = await r.json(); setBlocks(fresh); }
      } else {
        const updated: Block = await res.json();
        setBlocks((prev) => prev.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)));
      }
    } catch (e) {
      console.error("Print complete failed", e);
      showToast("Potvrzení tisku se nepodařilo uložit.", "error");
    }
  }

  function handleOpenInfoPanel() {
    setShowInfoPanel(true);
    fetchTodayAudit();
    localStorage.setItem("auditLastSeen", new Date().toISOString());
    setAuditNewCount(0);
  }

  function handleJumpToBlock(orderNumber: string) {
    setShowInfoPanel(false);
    setFilterText(orderNumber);
    const match = blocks.find((b) => b.orderNumber === orderNumber);
    if (match) setSelectedBlock(match);
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
    const r = await fetch(`/api/notifications/${notifId}/read`, { method: "PATCH" });
    if (!r.ok) { showToast("Nepodařilo se označit jako přečtené", "error"); return; }
    setNotifications((prev) => prev.map((n) => n.id === notifId ? { ...n, isRead: true } : n));
    setNotifNewCount((prev) => Math.max(0, prev - 1));
  }

  const effectiveDaysBack = isTiskar ? 1 : daysBack;
  const viewStart = pragueToUTC(addDaysToCivilDate(todayPragueDateStr(), -effectiveDaysBack), 0, 0);

  // "Přejít na" blok mimo rozsah — ref pro čekající scroll + výběr bloku po změně daysBack/daysAhead
  const pendingScrollMs = useRef<number | null>(null);
  const pendingSelectBlock = useRef<Block | null>(null);
  useLayoutEffect(() => {
    const target = pendingScrollMs.current;
    if (target === null) return;
    pendingScrollMs.current = null;
    const newViewStart = pragueToUTC(addDaysToCivilDate(todayPragueDateStr(), -daysBack), 0, 0);
    const y = dateToY(new Date(target), newViewStart, slotHeight);
    scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
    if (pendingSelectBlock.current) {
      setSelectedBlock(pendingSelectBlock.current);
      pendingSelectBlock.current = null;
    }
  }, [daysBack, daysAhead]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleJumpToOutOfRange(block: Block) {
    const diffDays = diffCivilDateDays(utcToPragueDateStr(new Date(block.startTime)), todayPragueDateStr());
    pendingScrollMs.current = new Date(block.startTime).getTime();
    setDaysBack(Math.max(3, diffDays + 5));
  }

  // Bloky mimo rozsah (v minulosti) odpovídající aktuálnímu hledání
  const outOfRangeBlocks = filterText.trim()
    ? blocks
        .filter(b => {
          const q = filterText.trim().toLowerCase();
          const matches = [b.orderNumber, b.description, b.specifikace, b.jobPresetLabel].some(f => f?.toLowerCase().includes(q));
          return matches && new Date(b.startTime) < viewStart;
        })
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    : [];
  const nearestOutOfRange = outOfRangeBlocks[0] ?? null;

  // Všechny bloky odpovídající hledání, seřazené podle startTime
  const searchMatches = filterText.trim()
    ? blocks
        .filter(b => {
          const q = filterText.trim().toLowerCase();
          return [b.orderNumber, b.description, b.specifikace, b.jobPresetLabel].some(f => f?.toLowerCase().includes(q));
        })
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
        const y = dateToY(blockTime, viewStart, slotHeight);
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
    const y = dateToY(new Date(), viewStart, slotHeight);
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
      const y = dateToY(d, viewStart, slotHeight);
      scrollRef.current?.scrollTo({ top: Math.max(0, y - 100), behavior: "smooth" });
    }
  }

  // Automaticky vyřeší jakýkoli překryv po přesunu/resize bloku:
  //  1. Překryv dozadu (přesunutý blok narazí na předchozí) → snap dopředu
  //  2. Překryv dopředu → auto-push navazující bloky
  // excludeIds = bloky které mají být při kontrole přeskočeny (přesouvané bloky ve skupině)
  async function autoResolveOverlap(movedBlock: Block, excludeIds: Set<number> = new Set([movedBlock.id]), prevBlock?: Block, deleteBlockOnConflict = false): Promise<OverlapResult> {
    const duration = new Date(movedBlock.endTime).getTime() - new Date(movedBlock.startTime).getTime();
    const otherBlocks = blocksRef.current.filter(b => !excludeIds.has(b.id));
    const sameMachine = otherBlocks
      .filter(b => b.machine === movedBlock.machine)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    let current = movedBlock;

    // Helper: vrátit blok zpět na původní pozici (nebo smazat pokud je nový a deleteBlockOnConflict)
    async function revertMovedBlock(): Promise<OverlapResult> {
      if (deleteBlockOnConflict && !prevBlock) {
        // Nový blok — smazat místo revert
        let deleteOk = false;
        try {
          const delRes = await fetch(`/api/blocks/${current.id}`, { method: "DELETE" });
          deleteOk = delRes.ok;
        } catch {
          deleteOk = false;
        }
        if (!deleteOk) {
          // DELETE selhalo — blok zůstává v DB; caller odstraní item z fronty (prevence duplicit)
          showToast("Blok koliduje se zamknutým blokem a nepodařilo se ho smazat — zkontroluj timeline.", "error");
          return "failed";
        }
        setBlocks(prev => prev.filter(b => b.id !== current.id));
        setSelectedBlock(sel => sel?.id === current.id ? null : sel);
        showToast("Blok nelze umístit — koliduje se zamknutým blokem.", "error");
        return "blocked_by_lock";
      }
      const orig = prevBlock ?? movedBlock;
      try {
        const res = await fetch(`/api/blocks/${current.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startTime: new Date(orig.startTime).toISOString(), endTime: new Date(orig.endTime).toISOString(), machine: orig.machine, bypassScheduleValidation: !workingTimeLockRef.current }),
        });
        if (res.ok) {
          const reverted = await res.json() as Block;
          setBlocks(prev => prev.map(b => b.id === reverted.id ? reverted : b));
          setSelectedBlock(sel => sel?.id === reverted.id ? reverted : sel);
        } else {
          return "failed";
        }
      } catch (error) {
        console.error("Revert moved block failed", error);
        showToast("Nepodařilo se vrátit blok na původní pozici.", "error");
        return "failed";
      }
      return "blocked_by_lock";
    }

    // ── Krok 1: Překryv dozadu ────────────────────────────────────────────────
    const ms = new Date(current.startTime).getTime();
    const preceding = sameMachine.find(b =>
      new Date(b.startTime).getTime() < ms && new Date(b.endTime).getTime() > ms
    );
    if (preceding) {
      let rawStart = new Date(preceding.endTime);
      // Pokud je lock zapnutý, snapneme výslednou pozici přes blokované časy
      // (preceding.endTime může ležet uvnitř šrafování — např. blok přesahující přes noc)
      if (workingTimeLockRef.current) {
        rawStart = snapToNextValidStartWithTemplates(current.machine, rawStart, duration, machineWorkHoursTemplates, machineExceptions);
      }
      const newStart = rawStart.getTime();
      try {
        const res = await fetch(`/api/blocks/${current.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startTime: new Date(newStart).toISOString(), endTime: new Date(newStart + duration).toISOString(), bypassScheduleValidation: !workingTimeLockRef.current }),
        });
        if (res.ok) {
          current = await res.json() as Block;
          setBlocks(prev => prev.map(b => b.id === current.id ? current : b));
        } else {
          return "failed";
        }
      } catch (error) {
        console.error("Backward overlap correction failed", error);
        showToast("Nepodařilo se opravit překryv bloku.", "error");
        return "failed";
      }
    }

    // ── Krok 2: Překryv dopředu → auto-push ──────────────────────────────────
    const curEnd   = new Date(current.endTime).getTime();
    const curStart = new Date(current.startTime).getTime();
    const firstFollowing = sameMachine.find(b =>
      new Date(b.startTime).getTime() >= curStart && new Date(b.startTime).getTime() < curEnd
    );
    if (!firstFollowing) return "resolved";

    const shiftMs = curEnd - new Date(firstFollowing.startTime).getTime();
    if (shiftMs <= 0) return "resolved";

    if (firstFollowing.locked) {
      const result = await revertMovedBlock();
      if (!deleteBlockOnConflict) setPushSuggestion({ chain: [], shiftMs, blockedByLock: true, lockedBlock: firstFollowing });
      return result;
    }

    const chain: Block[] = [firstFollowing];
    let blockedByLocked = false;
    let lockedBlockRef: Block | null = null;
    for (let i = 0; i < 200; i++) {
      const cursor = chain[chain.length - 1];
      const cursorEnd = new Date(cursor.endTime).getTime();
      const next = sameMachine.find(b =>
        !chain.find(c => c.id === b.id) &&
        new Date(b.startTime).getTime() >= cursorEnd - 60_000 &&
        new Date(b.startTime).getTime() < cursorEnd + shiftMs
      );
      if (!next) break;
      if (next.locked) {
        const availableRoom = new Date(next.startTime).getTime() - new Date(cursor.endTime).getTime();
        if (availableRoom >= shiftMs) {
          // Dost místa před zamknutým blokem — chain posuneme, zamknutý zůstane
          break;
        }
        // Nedost místa — vrátit přesunutý blok zpět
        blockedByLocked = true;
        lockedBlockRef = next;
        break;
      }
      chain.push(next);
    }

    // Zkontrolovat, zda posunutý chain nepřekryje locked blok mimo chain
    if (!blockedByLocked) {
      const lockedOnMachine = sameMachine.filter(b => b.locked && !chain.find(c => c.id === b.id));
      for (const b of chain) {
        const newStart = new Date(b.startTime).getTime() + shiftMs;
        const newEnd   = new Date(b.endTime).getTime()   + shiftMs;
        const hit = lockedOnMachine.find(l =>
          new Date(l.startTime).getTime() < newEnd && new Date(l.endTime).getTime() > newStart
        );
        if (hit) {
          blockedByLocked = true;
          lockedBlockRef = hit;
          break;
        }
      }
    }

    if (blockedByLocked) {
      const result = await revertMovedBlock();
      if (!deleteBlockOnConflict) setPushSuggestion({ chain, shiftMs, blockedByLock: true, lockedBlock: lockedBlockRef });
      return result;
    }

    if (chain.length === 0) return "resolved";

    // Pokud je zamknutý pracovní čas, snapneme push chain přes blokované časy
    let effectiveShiftMs = shiftMs;
    if (workingTimeLockRef.current) {
      const { deltaMs } = snapGroupDeltaWithTemplates(
        chain.map(b => ({ machine: b.machine, originalStart: new Date(b.startTime), originalEnd: new Date(b.endTime) })),
        shiftMs,
        machineWorkHoursTemplates,
        machineExceptions
      );
      effectiveShiftMs = deltaMs;
    }

    try {
      const results = await Promise.all(
        chain.map(b => {
          const newStart = new Date(new Date(b.startTime).getTime() + effectiveShiftMs);
          const newEnd   = new Date(new Date(b.endTime).getTime()   + effectiveShiftMs);
          return fetch(`/api/blocks/${b.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startTime: newStart.toISOString(), endTime: newEnd.toISOString(), bypassScheduleValidation: !workingTimeLockRef.current }),
          }).then(async r => {
            if (!r.ok) {
              const err = await r.json().catch(() => ({})) as { error?: string };
              throw new Error(err.error ?? `Chain push HTTP ${r.status}`);
            }
            return r.json() as Promise<Block>;
          });
        })
      );
      setBlocks(prev => prev.map(b => (results as Block[]).find(r => r.id === b.id) ?? b));
      // Pokud snap přeskočil víkend/noc a zvětšil posun, chain mohl přistát na bloku,
      // který nebyl v původním chainu — rekurzivně vyřešit překryv posledního bloku chainu
      if (effectiveShiftMs > shiftMs) {
        const allExcluded = new Set([...Array.from(excludeIds), ...chain.map(b => b.id)]);
        const lastResult = (results as Block[])[results.length - 1];
        if (lastResult) void autoResolveOverlap(lastResult, allExcluded);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Nepodařilo se automaticky posunout navazující bloky.";
      showToast(msg, "error");
      await revertMovedBlock();
      return "failed";
    }

    return "resolved";
  }

  const SPLIT_SHARED_FIELDS = [
    "orderNumber", "description", "specifikace", "deadlineExpedice",
    "jobPresetId", "jobPresetLabel",
    "type", "blockVariant",
    "dataStatusId", "dataStatusLabel", "dataRequiredDate", "dataOk",
    "materialStatusId", "materialStatusLabel", "materialRequiredDate", "materialOk", "materialInStock",
    "pantoneRequiredDate", "pantoneOk",
    "barvyStatusId", "barvyStatusLabel", "lakStatusId", "lakStatusLabel",
  ] as const;

  function handleBlockUpdate(updated: Block, addToHistory = false) {
    if (typeof updated.id !== "number") return; // Guard against API error responses
    const prev = blocksRef.current.find(b => b.id === updated.id);
    setBlocks((arr) => arr.map((b) => (b.id === updated.id ? updated : b)));
    setSelectedBlock((sel) => (sel?.id === updated.id ? updated : sel));
    // Lokální propagace sdílených polí do split sourozenců
    if (updated.splitGroupId != null) {
      const patch: Partial<Block> = {};
      for (const f of SPLIT_SHARED_FIELDS) {
        (patch as Record<string, unknown>)[f] = (updated as Record<string, unknown>)[f];
      }
      // Pokud se type mění na non-ZAKAZKA, normalizovat blockVariant na STANDARD
      if (patch.type && patch.type !== "ZAKAZKA") patch.blockVariant = "STANDARD";
      setBlocks(prev => prev.map(b =>
        b.id !== updated.id &&
        (b.splitGroupId === updated.splitGroupId || b.id === updated.splitGroupId)
          ? { ...b, ...patch }
          : b
      ));
    }
    if (prev) {
      const timeOrMachineChanged =
        new Date(prev.startTime).getTime() !== new Date(updated.startTime).getTime() ||
        new Date(prev.endTime).getTime()   !== new Date(updated.endTime).getTime()   ||
        prev.machine !== updated.machine;
      if (timeOrMachineChanged) {
        void autoResolveOverlap(updated, new Set([updated.id]), prev);
        if (addToHistory) {
          const bypassAtTime = !workingTimeLockRef.current;
          const prevSnap = { startTime: prev.startTime, endTime: prev.endTime, machine: prev.machine, bypassScheduleValidation: bypassAtTime };
          const nextSnap = { startTime: updated.startTime, endTime: updated.endTime, machine: updated.machine, bypassScheduleValidation: bypassAtTime };
          undoStack.current.push({
            undo: async () => {
              const res = await fetch(`/api/blocks/${updated.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prevSnap) });
              if (res.ok) { const b: Block = await res.json(); setBlocks(arr => arr.map(x => x.id === b.id ? b : x)); setSelectedBlock(sel => sel?.id === b.id ? b : sel); }
            },
            redo: async () => {
              const res = await fetch(`/api/blocks/${updated.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextSnap) });
              if (res.ok) { const b: Block = await res.json(); setBlocks(arr => arr.map(x => x.id === b.id ? b : x)); setSelectedBlock(sel => sel?.id === b.id ? b : sel); }
            },
          });
          if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
          redoStack.current = [];
          setCanUndo(true);
          setCanRedo(false);
        }
      }
    }
  }

  async function handleMultiBlockUpdate(updates: { id: number; startTime: Date; endTime: Date; machine: string }[]) {
    const originals = new Map(updates.map(u => [u.id, blocksRef.current.find(b => b.id === u.id)]));
    try {
      const batchRes = await fetch("/api/blocks/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: updates.map((u) => ({
            id: u.id,
            startTime: u.startTime.toISOString(),
            endTime: u.endTime.toISOString(),
            machine: u.machine,
          })),
          bypassScheduleValidation: !workingTimeLockRef.current,
        }),
      });
      if (!batchRes.ok) {
        const err = await batchRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Chyba serveru");
      }
      const results: Block[] = await batchRes.json();
      setBlocks((prev) => prev.map((b) => results.find((r) => r.id === b.id) ?? b));

      const prevSnaps = updates.map(u => { const o = originals.get(u.id); return o ? { id: u.id, startTime: o.startTime, endTime: o.endTime, machine: o.machine } : null; }).filter(Boolean) as { id: number; startTime: string; endTime: string; machine: string }[];
      const nextSnaps = updates.map(u => ({ id: u.id, startTime: u.startTime.toISOString(), endTime: u.endTime.toISOString(), machine: u.machine }));
      if (prevSnaps.length > 0) {
        const bypassAtTime = !workingTimeLockRef.current;
        undoStack.current.push({
          undo: async () => {
            const r = await fetch("/api/blocks/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates: prevSnaps, bypassScheduleValidation: bypassAtTime }) });
            if (!r.ok) { const err = await r.json().catch(() => ({})) as { error?: string }; throw new Error(err.error ?? "Chyba serveru"); }
            const res: Block[] = await r.json(); setBlocks(prev => prev.map(b => res.find(x => x.id === b.id) ?? b));
          },
          redo: async () => {
            const r = await fetch("/api/blocks/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates: nextSnaps, bypassScheduleValidation: bypassAtTime }) });
            if (!r.ok) { const err = await r.json().catch(() => ({})) as { error?: string }; throw new Error(err.error ?? "Chyba serveru"); }
            const res: Block[] = await r.json(); setBlocks(prev => prev.map(b => res.find(x => x.id === b.id) ?? b));
          },
        });
        if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
        redoStack.current = [];
        setCanUndo(true);
        setCanRedo(false);
      }

      const excludeIds = new Set(updates.map(u => u.id));
      for (const moved of results) {
        await autoResolveOverlap(moved, excludeIds, originals.get(moved.id));
      }
    } catch (error) {
      console.error("Multi-block update failed", error);
      showToast("Hromadný posun se nepodařilo uložit.", "error");
    }
  }

  function handleBlockCreate(newBlock: Block) {
    setBlocks((prev) =>
      [...prev, newBlock].sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      )
    );
  }

  async function deleteSingleBlockWithUndo(block: Block) {
    const res = await fetch(`/api/blocks/${block.id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Chyba serveru");

    setBlocks((prev) => prev.filter((b) => b.id !== block.id));
    setSelectedBlock(null);
    setEditingBlock(null);

    // Pokud byl blok spojen s rezervací — server ji vrátil do QUEUE_READY;
    // klient ji musí přidat zpět do fialové fronty (bez reloadu)
    if (block.reservationId) {
      try {
        const rRes = await fetch(`/api/reservations/${block.reservationId}`);
        if (rRes.ok) {
          const rData = await rRes.json();
          if (rData.status === "QUEUE_READY") {
            setReservationQueue((prev) => {
              const alreadyIn = prev.some((q) => q.id === `r_${rData.id}`);
              return alreadyIn ? prev : [...prev, reservationToQueueItem(rData)];
            });
          }
        }
      } catch {
        // Nepodařilo se načíst — queue se zaktualizuje při dalším reloadu
      }
      // REZERVACE bloky přeskakujeme undo — vztah rezervace↔blok je komplexní
      return;
    }

    // Undo jen pro standalone bloky — série mají komplexní parent/child vztahy
    if (block.recurrenceType !== "NONE" || block.recurrenceParentId !== null) return;

    let restoredId: number | null = null;

    const payload = {
      orderNumber: block.orderNumber,
      machine: block.machine,
      startTime: block.startTime,
      endTime: block.endTime,
      type: block.type,
      blockVariant: block.blockVariant,
      description: block.description,
      locked: block.locked,
      deadlineExpedice: block.deadlineExpedice,
      jobPresetId: block.jobPresetId,
      dataStatusId: block.dataStatusId,
      dataStatusLabel: block.dataStatusLabel,
      dataRequiredDate: block.dataRequiredDate,
      dataOk: block.dataOk,
      materialStatusId: block.materialStatusId,
      materialStatusLabel: block.materialStatusLabel,
      materialRequiredDate: block.materialRequiredDate,
      materialOk: block.materialOk,
      barvyStatusId: block.barvyStatusId,
      barvyStatusLabel: block.barvyStatusLabel,
      lakStatusId: block.lakStatusId,
      lakStatusLabel: block.lakStatusLabel,
      specifikace: block.specifikace,
      materialNote: block.materialNote,
      recurrenceType: "NONE",
    };

    undoStack.current = undoStack.current.slice(-MAX_HISTORY + 1);
    undoStack.current.push({
      undo: async () => {
        const r = await fetch("/api/blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error("Chyba serveru");
        const newBlock: Block = await r.json();
        restoredId = newBlock.id;
        handleBlockCreate(newBlock);
        setSelectedBlock(newBlock);
      },
      redo: async () => {
        if (restoredId === null) throw new Error("Žádný obnovený blok");
        const r = await fetch(`/api/blocks/${restoredId}`, { method: "DELETE" });
        if (!r.ok) throw new Error("Chyba serveru");
        const rid = restoredId;
        restoredId = null;
        setBlocks((prev) => prev.filter((b) => b.id !== rid));
        setSelectedBlock(null);
      },
    });
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }

  async function handleDeleteBlock(id: number) {
    const block = blocks.find((b) => b.id === id);
    if (!block) return;
    try {
      await deleteSingleBlockWithUndo(block);
    } catch (error) {
      console.error("Block delete failed", error);
      showToast("Chyba při mazání bloku.", "error");
    }
  }

  async function handleDeleteAll(ids: number[]) {
    // Single delete — s undo podporou
    if (ids.length === 1) {
      const block = blocks.find((b) => b.id === ids[0]);
      if (block) {
        try {
          await deleteSingleBlockWithUndo(block);
        } catch (error) {
          console.error("Block delete failed", error);
          showToast("Chyba při mazání bloku.", "error");
        }
        return;
      }
    }

    // Multi delete — standalone bloky dostanou undo, série a split bez undo
    const toDelete = blocksRef.current.filter((b) => ids.includes(b.id));
    const standalone = toDelete.filter(
      (b) => b.recurrenceType === "NONE" && b.recurrenceParentId === null && b.splitGroupId === null
    );
    const complex = toDelete.filter((b) => !standalone.some((s) => s.id === b.id));
    // Smazat vše — zachytit které DELETE uspěly (na serveru ne jen síťově)
    let deletedIds: number[];
    try {
      const responses = await Promise.all(
        ids.map((id) => fetch(`/api/blocks/${id}`, { method: "DELETE" }).then((r) => ({ id, ok: r.ok })))
      );
      deletedIds = responses.filter((r) => r.ok).map((r) => r.id);
      if (deletedIds.length < ids.length) {
        const failCount = ids.length - deletedIds.length;
        showToast(`${failCount} blok${failCount > 1 ? "y" : ""} se nepodařilo smazat.`, "error");
      }
    } catch (error) {
      console.error("Multi delete failed", error);
      showToast("Chyba při mazání bloků.", "error");
      return;
    }
    if (deletedIds.length === 0) return;
    setBlocks((prev) => prev.filter((b) => !deletedIds.includes(b.id)));
    if (deletedIds.includes(editingBlock?.id ?? -1)) setEditingBlock(null);
    if (deletedIds.includes(selectedBlock?.id ?? -1)) setSelectedBlock(null);
    const deletedComplex = complex.filter((b) => deletedIds.includes(b.id));
    if (deletedComplex.length > 0) showToast("Série/split bloky smazány bez možnosti vrátit.", "info");

    // Undo jen pro standalone bloky, které byly skutečně smazány
    const deletedStandalone = standalone.filter((b) => deletedIds.includes(b.id));
    if (deletedStandalone.length === 0) return;

    const payloads = deletedStandalone.map((b) => ({
      orderNumber: b.orderNumber, machine: b.machine, startTime: b.startTime,
      endTime: b.endTime, type: b.type, blockVariant: b.blockVariant,
      description: b.description, locked: b.locked, deadlineExpedice: b.deadlineExpedice,
      jobPresetId: b.jobPresetId,
      dataStatusId: b.dataStatusId, dataStatusLabel: b.dataStatusLabel,
      dataRequiredDate: b.dataRequiredDate, dataOk: b.dataOk,
      materialStatusId: b.materialStatusId, materialStatusLabel: b.materialStatusLabel,
      materialRequiredDate: b.materialRequiredDate, materialOk: b.materialOk,
      barvyStatusId: b.barvyStatusId, barvyStatusLabel: b.barvyStatusLabel,
      lakStatusId: b.lakStatusId, lakStatusLabel: b.lakStatusLabel,
      specifikace: b.specifikace, materialNote: b.materialNote, recurrenceType: "NONE",
    }));
    let restoredIds: number[] = [];
    undoStack.current = undoStack.current.slice(-MAX_HISTORY + 1);
    undoStack.current.push({
      undo: async () => {
        const results = await Promise.all(
          payloads.map(async (p) => {
            const r = await fetch("/api/blocks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
            if (!r.ok) throw new Error(`POST /api/blocks selhalo: ${r.status}`);
            return r.json() as Promise<Block>;
          })
        );
        restoredIds = results.map((b) => b.id);
        setBlocks((prev) => [...prev, ...results].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()));
      },
      redo: async () => {
        const responses = await Promise.all(
          restoredIds.map((id) => fetch(`/api/blocks/${id}`, { method: "DELETE" }).then((r) => ({ id, ok: r.ok })))
        );
        const gone = responses.filter((r) => r.ok).map((r) => r.id);
        if (gone.length < restoredIds.length) throw new Error("Některé bloky se nepodařilo znovu smazat.");
        restoredIds = [];
        setBlocks((prev) => prev.filter((b) => !gone.includes(b.id)));
      },
    });
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }

  async function handleSaveAll(ids: number[], payload: Record<string, unknown>) {
    try {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/blocks/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }).then((r) => r.json())
        )
      );
      setBlocks((prev) =>
        prev.map((b) => {
          const updated = (results as Block[]).find((r) => r.id === b.id);
          return updated ?? b;
        })
      );
      if (editingBlock && ids.includes(editingBlock.id)) {
        const updatedEditing = (results as Block[]).find((r) => r.id === editingBlock.id);
        if (updatedEditing) setEditingBlock(updatedEditing);
      }
    } catch (error) {
      console.error("Series save failed", error);
      showToast("Chyba při ukládání série.", "error");
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

  function buildBuilderPresetDraft(): JobPresetDraftValues {
    return {
      blockVariant,
      specifikace: bSpecifikace,
      dataStatusId: bDataStatusId,
      dataRequiredDate: bDataRequiredDate,
      materialStatusId: bMaterialStatusId,
      materialRequiredDate: bMaterialRequiredDate,
      materialInStock: bMaterialInStock,
      pantoneRequiredDate: bPantoneRequiredDate,
      barvyStatusId: bBarvyStatusId,
      lakStatusId: bLakStatusId,
      deadlineExpedice: bDeadlineExpedice,
      jobPresetId: bJobPresetId,
      jobPresetLabel: bJobPresetLabel,
    };
  }

  function applyPresetToBuilder(preset: JobPreset) {
    const { next, overwrittenFields } = applyJobPresetToDraft(buildBuilderPresetDraft(), preset, type);
    if (
      overwrittenFields.length > 0 &&
      !window.confirm(`Preset přepíše ${overwrittenFields.length} vyplněných polí. Pokračovat?`)
    ) {
      return;
    }
    setBlockVariant(next.blockVariant);
    setBSpecifikace(next.specifikace);
    setBDataStatusId(next.dataStatusId);
    setBDataRequiredDate(next.dataRequiredDate);
    setBMaterialStatusId(next.materialStatusId);
    setBMaterialRequiredDate(next.materialRequiredDate);
    setBMaterialInStock(next.materialInStock);
    setBPantoneRequiredDate(next.pantoneRequiredDate);
    setBBarvyStatusId(next.barvyStatusId);
    setBLakStatusId(next.lakStatusId);
    setBDeadlineExpedice(next.deadlineExpedice);
    setBJobPresetId(next.jobPresetId);
    setBJobPresetLabel(next.jobPresetLabel);
  }

  function clearBuilderPresetSelection() {
    const next = emptyPresetDraft(type);
    setBlockVariant(next.blockVariant);
    setBSpecifikace(next.specifikace);
    setBDataStatusId(next.dataStatusId);
    setBDataRequiredDate(next.dataRequiredDate);
    setBMaterialStatusId(next.materialStatusId);
    setBMaterialRequiredDate(next.materialRequiredDate);
    setBMaterialInStock(next.materialInStock);
    setBPantoneRequiredDate(next.pantoneRequiredDate);
    setBBarvyStatusId(next.barvyStatusId);
    setBLakStatusId(next.lakStatusId);
    setBDeadlineExpedice(next.deadlineExpedice);
    setBJobPresetId(null);
    setBJobPresetLabel("");
  }

  function resetBuilderForm() {
    setOrderNumber("");
    setDescription("");
    setBDataStatusId("");
    setBDataRequiredDate("");
    setBMaterialStatusId("");
    setBMaterialRequiredDate("");
    setBMaterialInStock(false);
    setBPantoneRequiredDate("");
    setBPantoneOk(false);
    setBBarvyStatusId("");
    setBLakStatusId("");
    setBSpecifikace("");
    setBDeadlineExpedice("");
    setBRecurrenceType("NONE");
    setBRecurrenceCount(2);
    setBJobPresetId(null);
    setBJobPresetLabel("");
    setBlockVariant("STANDARD");
  }

  function handleAddToQueue() {
    if (!orderNumber.trim()) return;
    const findLabel = (opts: CodebookOption[], id: string) =>
      opts.find((o) => String(o.id) === id)?.label ?? null;
    setQueue((prev) => [
      ...prev,
      {
        id: ++queueIdRef.current,
        orderNumber: orderNumber.trim(),
        type,
        blockVariant: type === "ZAKAZKA" ? blockVariant : "STANDARD",
        jobPresetId: type === "UDRZBA" ? null : bJobPresetId,
        jobPresetLabel: type === "UDRZBA" ? null : bJobPresetLabel || null,
        durationHours,
        description: description.trim(),
        dataStatusId: bDataStatusId ? Number(bDataStatusId) : null,
        dataStatusLabel: findLabel(bDataOpts, bDataStatusId),
        dataRequiredDate: bDataRequiredDate || null,
        materialStatusId: bMaterialStatusId ? Number(bMaterialStatusId) : null,
        materialStatusLabel: findLabel(bMaterialOpts, bMaterialStatusId),
        materialRequiredDate: bMaterialInStock ? null : bMaterialRequiredDate || null,
        materialInStock: bMaterialInStock,
        pantoneRequiredDate: bPantoneRequiredDate || null,
        pantoneOk: bPantoneOk,
        barvyStatusId: bBarvyStatusId ? Number(bBarvyStatusId) : null,
        barvyStatusLabel: findLabel(bBarvyOpts, bBarvyStatusId),
        lakStatusId: bLakStatusId ? Number(bLakStatusId) : null,
        lakStatusLabel: findLabel(bLakOpts, bLakStatusId),
        specifikace: bSpecifikace,
        deadlineExpedice: bDeadlineExpedice,
        recurrenceType: bRecurrenceType,
        recurrenceCount: bRecurrenceType !== "NONE" ? bRecurrenceCount : 1,
      },
    ]);
    resetBuilderForm();
  }

  async function handleScheduleSeries() {
    if (!orderNumber.trim() || seriesPreview.length === 0 || seriesScheduling) return;
    const durationMs = durationHours * 3600000;
    const findLabel = (opts: CodebookOption[], id: string) => opts.find((o) => String(o.id) === id)?.label ?? null;
    const baseBody = {
      orderNumber: orderNumber.trim(),
      machine: bSeriesMachine,
      type,
      blockVariant: type === "ZAKAZKA" ? blockVariant : "STANDARD",
      jobPresetId: type === "UDRZBA" ? null : bJobPresetId,
      description: description.trim() || null,
      dataStatusId: bDataStatusId ? Number(bDataStatusId) : null,
      dataStatusLabel: findLabel(bDataOpts, bDataStatusId),
      materialStatusId: bMaterialStatusId ? Number(bMaterialStatusId) : null,
      materialStatusLabel: findLabel(bMaterialOpts, bMaterialStatusId),
      materialRequiredDate: bMaterialInStock ? null : bMaterialRequiredDate || null,
      materialInStock: bMaterialInStock,
      pantoneRequiredDate: bPantoneRequiredDate || null,
      pantoneOk: bPantoneOk,
      barvyStatusId: bBarvyStatusId ? Number(bBarvyStatusId) : null,
      barvyStatusLabel: findLabel(bBarvyOpts, bBarvyStatusId),
      lakStatusId: bLakStatusId ? Number(bLakStatusId) : null,
      lakStatusLabel: findLabel(bLakOpts, bLakStatusId),
      specifikace: bSpecifikace || null,
      recurrenceType: bRecurrenceType,
    };
    setSeriesScheduling(true);
    let parentId: number | null = null;
    let created = 0;
    for (let i = 0; i < seriesPreview.length; i++) {
      const occ = seriesPreview[i];
      const startTime = pragueToUTC(occ.date, occ.hour);
      const endTime = new Date(startTime.getTime() + durationMs);
      const body: Record<string, unknown> = {
        ...baseBody,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        dataRequiredDate: occ.dataRequiredDate || null,
        deadlineExpedice: occ.deadlineExpedice || null,
      };
      if (parentId !== null) body.recurrenceParentId = parentId;
      try {
        const res = await fetch("/api/blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const block: Block = await res.json();
          if (i === 0) parentId = block.id;
          handleBlockCreate(block);
          created++;
        }
      } catch { /* skip failed occurrence */ }
    }
    setSeriesScheduling(false);
    if (created > 0 && created < seriesPreview.length) {
      showToast(`Naplánováno jen ${created}/${seriesPreview.length} bloků — zkontroluj timeline.`, "error");
    } else if (created > 0) {
      showToast(`Série ${created} bloků naplánována.`, "success");
    } else {
      showToast("Naplánování série selhalo.", "error");
    }
    if (created > 0) {
      resetBuilderForm();
      setBSeriesFirstDate(""); setBSeriesFirstHour(7);
      setSeriesPreview([]);
    }
  }

  function addRecurrenceInterval(date: Date, type: string): Date {
    const dateStr = normalizeCivilDateInput(date);
    if (!dateStr) return date;
    if (type === "DAILY") return pragueToUTC(addDaysToCivilDate(dateStr, 1), 12, 0);
    if (type === "WEEKLY") return pragueToUTC(addDaysToCivilDate(dateStr, 7), 12, 0);
    if (type === "MONTHLY") return pragueToUTC(addMonthsToCivilDate(dateStr, 1), 12, 0);
    return date;
  }

  function generateSeriesPreview(firstDate: string, firstHour: number, count: number, rType: string, defaultDataDate: string, defaultExpedice: string): Array<{ date: string; hour: number; dataRequiredDate: string; deadlineExpedice: string }> {
    if (!firstDate || rType === "NONE" || count < 1) return [];
    const occurrences: Array<{ date: string; hour: number; dataRequiredDate: string; deadlineExpedice: string }> = [];
    // UTC noon — bezpečné pro aritmetiku celých dnů ve všech timezone
    let cur = new Date(firstDate + "T12:00:00.000Z");
    for (let i = 0; i < count; i++) {
      occurrences.push({ date: cur.toISOString().slice(0, 10), hour: firstHour, dataRequiredDate: defaultDataDate, deadlineExpedice: defaultExpedice });
      cur = addRecurrenceInterval(cur, rType);
    }
    return occurrences;
  }

  // Regeneruje preview série při změně parametrů
  // POZOR: bDataRequiredDate a bDeadlineExpedice jsou jen defaulty pro nově generované řádky —
  // záměrně nejsou v dep array, aby ruční editace per-occurrence hodnot nebyla přepsána
  // při změně počtu bloků nebo intervalu.
  useEffect(() => {
    if (bRecurrenceType === "NONE" || !bSeriesFirstDate) {
      setSeriesPreview([]);
      return;
    }
    setSeriesPreview(generateSeriesPreview(bSeriesFirstDate, bSeriesFirstHour, bRecurrenceCount, bRecurrenceType, bDataRequiredDate, bDeadlineExpedice));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bRecurrenceType, bRecurrenceCount, bSeriesFirstDate, bSeriesFirstHour]);

  async function handleExceptionUpsert(machine: string, date: Date, startSlot: number, endSlot: number, isActive: boolean) {
    try {
      const res = await fetch("/api/machine-exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Datum posíláme jako YYYY-MM-DD lokálního (CZ) kalendářního dne — bez UTC posunu
        body: JSON.stringify({
          machine,
          date: utcToPragueDateStr(date),
          startSlot,
          endSlot,
          isActive,
        }),
      });
      if (!res.ok) { showToast("Nepodařilo se uložit výjimku.", "error"); return; }
      const exc: MachineScheduleException = await res.json();
      setMachineExceptions((prev) => {
        const filtered = prev.filter((e) => !(e.machine === exc.machine && e.date.slice(0, 10) === exc.date.slice(0, 10)));
        return [...filtered, exc];
      });
    } catch {
      showToast("Chyba při ukládání výjimky.", "error");
    }
  }

  async function handleExceptionDelete(id: number) {
    try {
      const res = await fetch(`/api/machine-exceptions/${id}`, { method: "DELETE" });
      if (!res.ok) { showToast("Nepodařilo se smazat výjimku.", "error"); return; }
      setMachineExceptions((prev) => prev.filter((e) => e.id !== id));
    } catch {
      showToast("Chyba při mazání výjimky.", "error");
    }
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
      handleBlockUpdate(updated);
    } catch (error) {
      console.error("Block variant change failed", error);
      showToast("Nepodařilo se změnit stav zakázky.", "error");
    }
  }

  async function handleQueueDrop(itemId: number | string, machine: string, rawStartTime: Date) {
    const item = queue.find((q) => q.id === itemId) ?? reservationQueue.find((r) => r.id === itemId);
    if (!item) return;
    const durationMs = item.durationHours * 60 * 60 * 1000;
    // Snap na pracovní dobu — kontrolujeme celou délku bloku, ne jen 30 min.
    const rawSnapped = workingTimeLockRef.current
      ? snapToNextValidStartWithTemplates(machine, rawStartTime, durationMs, machineWorkHoursTemplates, machineExceptions)
      : rawStartTime;
    const startTime = rawSnapped;
    if (workingTimeLockRef.current && rawSnapped.getTime() !== rawStartTime.getTime()) {
      showToast("Blok umístěn do nejbližšího dostupného slotu (mimo pracovní dobu).", "info");
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
      pantoneRequiredDate: item.pantoneRequiredDate || null,
      pantoneOk: item.pantoneOk,
      barvyStatusId: item.barvyStatusId,
      barvyStatusLabel: item.barvyStatusLabel,
      lakStatusId: item.lakStatusId,
      lakStatusLabel: item.lakStatusLabel,
      specifikace: item.specifikace || null,
      deadlineExpedice: item.deadlineExpedice || null,
      recurrenceType: rType,
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

    try {
      // Vytvořit první (rodičovský) blok
      const firstEnd = new Date(startTime.getTime() + durationMs);
      const res1 = await fetch("/api/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...baseBody, startTime: startTime.toISOString(), endTime: firstEnd.toISOString(), bypassScheduleValidation: !workingTimeLockRef.current }),
      });
      if (!res1.ok) {
        const err = await res1.json().catch(() => ({})) as { error?: string };
        // 409 = rezervace už není QUEUE_READY (mohla být mezitím naplánována někým jiným)
        if (res1.status === 409 && isReservationItem) {
          showToast(`Rezervace ${item.reservationCode ?? ""} už není dostupná — obnovte stránku.`, "error");
          setDraggingQueueItem(null);
          return;
        }
        throw new Error(err.error ?? "Chyba serveru");
      }
      const parentBlock: Block = await res1.json();
      handleBlockCreate(parentBlock);

      // Vyřešit případný overlap nového bloku s existujícími
      const overlapResult = await autoResolveOverlap(parentBlock, new Set([parentBlock.id]), undefined, true);
      if (overlapResult === "blocked_by_lock") {
        // Blok byl smazán (kolidoval se zamknutým), item zůstane ve frontě
        setDraggingQueueItem(null);
        return;
      }
      if (overlapResult === "failed") {
        // POST proběhl, blok existuje v DB/UI, ale overlap resolution selhala
        removeFromQueue();
        setDraggingQueueItem(null);
        showToast("Blok byl vytvořen, ale nepodařilo se automaticky vyřešit překryv — zkontroluj pozici na timeline.", "info");
        return;
      }

      // Vytvořit children bloky (pokud opakování > 1)
      if (rType !== "NONE" && rCount > 1) {
        let curStart = addRecurrenceInterval(startTime, rType);
        for (let i = 1; i < rCount; i++) {
          const curEnd = new Date(curStart.getTime() + durationMs);
          const res = await fetch("/api/blocks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...baseBody,
              startTime: curStart.toISOString(),
              endTime: curEnd.toISOString(),
              recurrenceParentId: parentBlock.id,
              bypassScheduleValidation: !workingTimeLockRef.current,
            }),
          });
          if (res.ok) {
            const childBlock: Block = await res.json();
            handleBlockCreate(childBlock);
          }
          curStart = addRecurrenceInterval(curStart, rType);
        }
      }

      removeFromQueue();
      setDraggingQueueItem(null);
      const y = dateToY(startTime, viewStart, slotHeight);
      scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
    } catch (error) {
      console.error("Queue drop block creation failed", error);
      showToast("Chyba při vytváření bloku.", "error");
      setDraggingQueueItem(null);
    }
  }

  function handleBlockDoubleClick(block: Block) {
    setSelectedBlock(null);
    setEditingBlock(block);
  }

  async function handlePaste() {
    const src = copiedBlockRef.current;
    const target = pasteTargetRef.current;
    if (!src || !target) return;
    const durationMs = new Date(src.endTime).getTime() - new Date(src.startTime).getTime();
    const rawStart = target.time;
    const newStart = workingTimeLockRef.current
      ? snapToNextValidStartWithTemplates(target.machine, rawStart, durationMs, machineWorkHoursTemplates, machineExceptions)
      : rawStart;
    const newEnd = new Date(newStart.getTime() + durationMs);
    try {
      const res = await fetch("/api/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber: src.orderNumber,
          machine: target.machine,
          type: src.type,
          blockVariant: src.blockVariant,
          jobPresetId: src.jobPresetId,
          startTime: newStart.toISOString(),
          endTime: newEnd.toISOString(),
          description: src.description,
          locked: false,
          deadlineExpedice: src.deadlineExpedice,
          dataStatusId: src.dataStatusId,
          dataStatusLabel: src.dataStatusLabel,
          dataRequiredDate: src.dataRequiredDate,
          dataOk: src.dataOk,
          materialStatusId: src.materialStatusId,
          materialStatusLabel: src.materialStatusLabel,
          materialRequiredDate: src.materialRequiredDate,
          materialOk: src.materialOk,
          barvyStatusId: src.barvyStatusId,
          barvyStatusLabel: src.barvyStatusLabel,
          lakStatusId: src.lakStatusId,
          lakStatusLabel: src.lakStatusLabel,
          specifikace: src.specifikace,
          bypassScheduleValidation: !workingTimeLockRef.current,
        }),
      });
      if (!res.ok) throw new Error();
      const newBlock: Block = await res.json();
      handleBlockCreate(newBlock);
      if (isCutRef.current) {
        await fetch(`/api/blocks/${src.id}`, { method: "DELETE" });
        setBlocks((prev) => prev.filter((b) => b.id !== src.id));
        setSelectedBlock((sel) => (sel?.id === src.id ? null : sel));
        setCopiedBlock(null);
        setIsCut(false);
      }
    } catch (error) {
      console.error("Block paste failed", error);
      showToast("Chyba při vložení bloku.", "error");
    }
  }

  async function handleGroupPaste() {
    const group = clipboardGroupRef.current;
    const target = pasteTargetRef.current;
    if (!group.length || !target) return;
    // Anchor = nejstarší startTime ve skupině
    const anchorMs = Math.min(...group.map((b) => new Date(b.startTime).getTime()));
    const anchorBlock = group.find((b) => new Date(b.startTime).getTime() === anchorMs)!;
    const anchorDuration = new Date(anchorBlock.endTime).getTime() - anchorMs;
    // Snap anchor pokud je lock zapnutý — kontrolujeme celou délku anchor bloku
    const snappedTarget = workingTimeLockRef.current
      ? snapToNextValidStartWithTemplates(target.machine, target.time, anchorDuration, machineWorkHoursTemplates, machineExceptions)
      : target.time;
    const pasteMs = snappedTarget.getTime();

    // POST všechny bloky sekvenčně — při prvním selhání se zastaví a žádný lokální stav se nezmění
    const created: Block[] = [];
    try {
      for (const src of group) {
        const offsetMs = new Date(src.startTime).getTime() - anchorMs;
        const durationMs = new Date(src.endTime).getTime() - new Date(src.startTime).getTime();
        const newStart = new Date(pasteMs + offsetMs);
        const newEnd = new Date(newStart.getTime() + durationMs);
        const res = await fetch("/api/blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderNumber: src.orderNumber, machine: target.machine, type: src.type, blockVariant: src.blockVariant,
            jobPresetId: src.jobPresetId,
            startTime: newStart.toISOString(), endTime: newEnd.toISOString(),
            description: src.description, locked: false,
            deadlineExpedice: src.deadlineExpedice,
            dataStatusId: src.dataStatusId, dataStatusLabel: src.dataStatusLabel, dataRequiredDate: src.dataRequiredDate, dataOk: src.dataOk,
            materialStatusId: src.materialStatusId, materialStatusLabel: src.materialStatusLabel, materialRequiredDate: src.materialRequiredDate, materialOk: src.materialOk,
            barvyStatusId: src.barvyStatusId, barvyStatusLabel: src.barvyStatusLabel,
            lakStatusId: src.lakStatusId, lakStatusLabel: src.lakStatusLabel,
            specifikace: src.specifikace,
            bypassScheduleValidation: !workingTimeLockRef.current,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        created.push(await res.json() as Block);
      }
    } catch (err) {
      console.error("Group paste failed", err);
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
          showToast(`Chyba vložení — ${survivingBlocks.length} blok(ů) zůstal(y) v DB. Zkontroluj timeline.`, "error");
          return;
        }
      }
      const errMsg = err instanceof Error ? err.message : "Chyba při vložení skupiny";
      showToast(`${errMsg} — žádné bloky nebyly přidány.`, "error");
      return;
    }

    // Všechny POST proběhly úspěšně — přidej do lokálního stavu
    created.forEach((b) => handleBlockCreate(b));

    if (isGroupCutRef.current) {
      // DELETE originálů — kontroluj .ok, sb er selhání
      const deleteResults = await Promise.allSettled(
        group.map((src) => fetch(`/api/blocks/${src.id}`, { method: "DELETE" }).then((r) => {
          if (!r.ok) throw new Error(`DELETE ${src.id} HTTP ${r.status}`);
        }))
      );
      const failedDeletes = deleteResults.filter((r) => r.status === "rejected");
      if (failedDeletes.length > 0) {
        console.error("Group cut: some DELETEs failed", failedDeletes);
        showToast("Bloky byly zkopírovány, ale původní se nepodařilo smazat.", "error");
      } else {
        setBlocks((prev) => prev.filter((b) => !group.some((g) => g.id === b.id)));
        setSelectedBlockIds(new Set());
        clipboardGroupRef.current = [];
        isGroupCutRef.current = false;
      }
    }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        setSelectedBlockIds(new Set());
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedBlockIdsRef.current.size > 0) {
        e.preventDefault();
        setMultiDeletePending(true);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedBlock) {
        e.preventDefault();
        setKeyDeletePending(true);
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const entry = undoStack.current.pop();
        if (entry) {
          entry.undo()
            .then(() => { redoStack.current.push(entry); setCanUndo(undoStack.current.length > 0); setCanRedo(true); showToast("Vráceno zpět", "info"); })
            .catch((err: unknown) => { undoStack.current.push(entry); setCanUndo(true); console.error("Undo failed", err); showToast("Vrácení zpět selhalo.", "error"); });
        }
        return;
      }
      if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        const entry = redoStack.current.pop();
        if (entry) {
          entry.redo()
            .then(() => { undoStack.current.push(entry); setCanUndo(true); setCanRedo(redoStack.current.length > 0); showToast("Znovu provedeno", "info"); })
            .catch((err: unknown) => { redoStack.current.push(entry); setCanRedo(true); console.error("Redo failed", err); showToast("Znovu provedení selhalo.", "error"); });
        }
        return;
      }
      // Priorita: skupinové operace, pokud je vybráno více bloků lasem
      if (e.key === "c" && selectedBlockIdsRef.current.size > 0) {
        e.preventDefault();
        clipboardGroupRef.current = blocksRef.current.filter((b) => selectedBlockIdsRef.current.has(b.id));
        isGroupCutRef.current = false;
        return;
      }
      if (e.key === "x" && selectedBlockIdsRef.current.size > 0) {
        e.preventDefault();
        clipboardGroupRef.current = blocksRef.current.filter((b) => selectedBlockIdsRef.current.has(b.id));
        isGroupCutRef.current = true;
        return;
      }
      if (e.key === "v" && clipboardGroupRef.current.length > 0 && pasteTargetRef.current) {
        e.preventDefault();
        void handleGroupPaste();
        return;
      }
      // Fallback: jednoblokové operace
      if (e.key === "c" && selectedBlock) {
        e.preventDefault();
        setCopiedBlock(selectedBlock);
        setIsCut(false);
      }
      if (e.key === "x" && selectedBlock) {
        e.preventDefault();
        setCopiedBlock(selectedBlock);
        setIsCut(true);
      }
      if (e.key === "v" && copiedBlockRef.current && pasteTargetRef.current) {
        e.preventDefault();
        handlePaste();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedBlock]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeConfig = TYPE_BUILDER_CONFIG[type as keyof typeof TYPE_BUILDER_CONFIG];

  return (
    <main style={{ height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }} className="bg-background text-foreground">
      {/* ── Confirm smazání přes klávesnici ── */}
      {keyDeletePending && selectedBlock && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setKeyDeletePending(false)}
        >
          <div
            style={{ background: "#1c1c1e", borderRadius: 14, padding: "20px 24px", width: 280, border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 16px 48px rgba(0,0,0,0.7)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", textAlign: "center", marginBottom: 4 }}>Smazat blok?</p>
            <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginBottom: 16 }}>{selectedBlock.orderNumber}{selectedBlock.description ? ` — ${selectedBlock.description}` : ""}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="destructive" size="sm" className="flex-1 text-xs" autoFocus
                onClick={() => { setKeyDeletePending(false); handleDeleteBlock(selectedBlock.id); }}>
                Smazat
              </Button>
              <Button variant="outline" size="sm" className="flex-1 text-xs border-slate-700 text-slate-300"
                onClick={() => setKeyDeletePending(false)}>
                Zrušit
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* ── Confirm hromadného smazání přes klávesnici ── */}
      {multiDeletePending && selectedBlockIds.size > 0 && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setMultiDeletePending(false)}
        >
          <div
            style={{ background: "#1c1c1e", borderRadius: 14, padding: "20px 24px", width: 280, border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 16px 48px rgba(0,0,0,0.7)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", textAlign: "center", marginBottom: 4 }}>Smazat {selectedBlockIds.size} {selectedBlockIds.size === 1 ? "blok" : selectedBlockIds.size < 5 ? "bloky" : "bloků"}?</p>
            <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginBottom: 16 }}>Tato akce je nevratná.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="destructive" size="sm" className="flex-1 text-xs" autoFocus
                onClick={() => { const ids = [...selectedBlockIds]; setMultiDeletePending(false); setSelectedBlockIds(new Set()); handleDeleteAll(ids); }}>
                Smazat
              </Button>
              <Button variant="outline" size="sm" className="flex-1 text-xs border-slate-700 text-slate-300"
                onClick={() => setMultiDeletePending(false)}>
                Zrušit
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* ── Header (TISKAR — minimální pruh) ── */}
      {isTiskar && (
        <header className="flex-shrink-0 px-4 py-2 flex items-center gap-3" style={{
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}>
          <img src="/logo.png" alt="Integraf" style={{ height: 24, width: "auto", objectFit: "contain", flexShrink: 0 }} />
          <div style={{ width: 1, height: 16, background: "var(--border)", flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {currentUser.username}
            <span style={{ marginLeft: 5, fontSize: 10, background: "var(--surface-2)", borderRadius: 4, padding: "1px 5px", color: "var(--text-muted)" }}>
              TISKAŘ
            </span>
          </span>
          <div style={{ flex: 1 }} />
          <Button variant="outline" size="sm" onClick={handleScrollToNow} className="h-8 text-xs theme-transition-fast" style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }}>
            Dnes
          </Button>
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
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <Input
              type="text"
              value={filterText}
              onChange={(e) => { setFilterText(e.target.value); setSearchMatchIndex(0); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); goToNextMatch(); }
                if (e.key === "Escape") { setFilterText(""); setSelectedBlock(null); setSearchMatchIndex(0); }
              }}
              placeholder="Hledat zakázku…"
              className="h-8 text-xs w-40 theme-transition-fast"
              style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)", paddingRight: filterText ? 22 : undefined }}
            />
            {filterText && (
              <button
                onClick={() => { setFilterText(""); setSelectedBlock(null); setSearchMatchIndex(0); }}
                style={{ position: "absolute", right: 6, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0, lineHeight: 1, fontSize: 14, display: "flex", alignItems: "center" }}
                title="Zrušit filtr (Esc)"
              >
                ×
              </button>
            )}
          </div>
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
                display: "flex", alignItems: "center", gap: 5,
                background: showShutdowns ? "var(--brand)" : "var(--surface-2)",
                border: `1px solid ${showShutdowns ? "var(--brand)" : "var(--border)"}`,
                color: showShutdowns ? "var(--brand-contrast)" : "var(--text-muted)",
                fontSize: 12, cursor: "pointer", transition: "all 120ms ease-out", whiteSpace: "nowrap",
              }}
            >
              <CalendarDays size={12} strokeWidth={1.5} />Odstávky
            </button>
          )}
          {["ADMIN", "PLANOVAT"].includes(currentUser.role) && (
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

          <ThemeToggle />

          {/* Bell — audit (ADMIN/PLANOVAT) */}
          {["ADMIN", "PLANOVAT"].includes(currentUser.role) && (
            <div style={{ position: "relative" }}>
              <button
                onClick={handleOpenInfoPanel}
                title="Aktivita DTP a MTZ za poslední 3 dny"
                style={{
                  width: 28, height: 28, borderRadius: 8,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: showInfoPanel ? "rgba(59,130,246,0.14)" : "var(--surface-2)",
                  border: `1px solid ${showInfoPanel ? "rgba(59,130,246,0.35)" : "var(--border)"}`,
                  color: showInfoPanel ? "#3b82f6" : "var(--text-muted)",
                  cursor: "pointer", transition: "all 120ms ease-out", padding: 0,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
              </button>
              {auditNewCount > 0 && (
                <span style={{
                  position: "absolute", top: -3, right: -3,
                  width: 14, height: 14, borderRadius: "50%",
                  background: "#ef4444", color: "#fff",
                  fontSize: 8, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  pointerEvents: "none",
                }}>{auditNewCount > 9 ? "9+" : auditNewCount}</span>
              )}
            </div>
          )}

          {/* Bell — inbox (DTP/MTZ/OBCHODNIK) */}
          {["DTP", "MTZ", "OBCHODNIK"].includes(currentUser.role) && (
            <div style={{ position: "relative" }}>
              <button
                onClick={() => { setShowInboxPanel(true); fetchNotifications(); }}
                title="Upozornění"
                style={{
                  width: 28, height: 28, borderRadius: 8,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: showInboxPanel ? "rgba(59,130,246,0.14)" : "var(--surface-2)",
                  border: `1px solid ${showInboxPanel ? "rgba(59,130,246,0.35)" : "var(--border)"}`,
                  color: showInboxPanel ? "#3b82f6" : "var(--text-muted)",
                  cursor: "pointer", transition: "all 120ms ease-out", padding: 0,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
              </button>
              {notifNewCount > 0 && (
                <span style={{
                  position: "absolute", top: -3, right: -3,
                  width: 14, height: 14, borderRadius: "50%",
                  background: "#ef4444", color: "#fff",
                  fontSize: 8, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  pointerEvents: "none",
                }}>{notifNewCount > 9 ? "9+" : notifNewCount}</span>
              )}
            </div>
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

      {/* ── Tělo ── */}
      <section style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* LEVÁ ČÁST – timeline grid */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
          <TimelineGrid
            blocks={blocks}
            filterText={filterText}
            selectedBlockId={selectedBlock?.id ?? null}
            onBlockClick={(block) => { setSelectedBlockIds(new Set()); setSelectedBlock(block); }}
            onBlockUpdate={handleBlockUpdate}
            onBlockCreate={handleBlockCreate}
            scrollRef={scrollRef}
            queueDragItem={draggingQueueItem}
            onQueueDrop={handleQueueDrop}
            onQueueDragCancel={() => setDraggingQueueItem(null)}
            onBlockDoubleClick={handleBlockDoubleClick}
            companyDays={companyDays}
            slotHeight={slotHeight}
            copiedBlockId={copiedBlock?.id ?? null}
            onGridClick={(machine, time) => setPasteTarget({ machine, time })}
            onGridClickEmpty={() => { setSelectedBlock(null); setEditingBlock(null); }}
            onBlockCopy={(block) => { setCopiedBlock(block); setIsCut(false); }}
            selectedBlockIds={selectedBlockIds}
            onMultiSelect={(ids) => { setSelectedBlockIds(ids); }}
            onMultiBlockUpdate={handleMultiBlockUpdate}
            daysAhead={isTiskar ? 2 : daysAhead}
            daysBack={effectiveDaysBack}
            canEdit={canEdit}
            canEditData={canEditData}
            canEditMat={canEditMat}
            onError={(msg) => showToast(msg, "error")}
            onInfo={(msg) => showToast(msg, "info")}
            workingTimeLock={workingTimeLock}
            badgeColorMap={badgeColorMap}
            machineWorkHours={machineWorkHoursTemplates}
            machineExceptions={machineExceptions}
            onExceptionUpsert={canEdit ? handleExceptionUpsert : undefined}
            onExceptionDelete={canEdit ? handleExceptionDelete : undefined}
            isTiskar={isTiskar}
            onPrintComplete={isTiskar || canEdit ? handlePrintComplete : undefined}
            assignedMachine={isTiskar ? (currentUser.assignedMachine ?? null) : null}
            onNotify={canEdit ? handleNotify : undefined}
            onBlockVariantChange={canEdit ? handleBlockVariantChange : undefined}
          />
        </div>

        {/* Resize handle + aside — skryté pro non-editors (NOTE etapa 8) */}
        {canEdit && <ResizeHandle onMouseDown={() => {
          isResizing.current = true;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }} />}

        {/* InboxPanel pro DTP/MTZ/OBCHODNIK — mimo canEdit aside */}
        {["DTP", "MTZ", "OBCHODNIK"].includes(currentUser.role) && showInboxPanel && (
          <aside style={{ width: 320, flexShrink: 0, position: "relative", zIndex: 10, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <InboxPanel
              notifications={notifications}
              onClose={() => setShowInboxPanel(false)}
              onMarkRead={handleMarkRead}
              onJumpToBlock={(orderNumber) => { setShowInboxPanel(false); setFilterText(orderNumber); }}
            />
          </aside>
        )}

        {/* PRAVÁ ČÁST – detail nebo builder */}
        {canEdit && <aside style={{ width: asideWidth, flexShrink: 0, position: "relative", zIndex: 10, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {showInfoPanel ? (
            <InfoPanel
              logs={todayAuditLogs}
              onClose={() => setShowInfoPanel(false)}
              onJumpToBlock={handleJumpToBlock}
            />
          ) : showShutdowns ? (
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
              onSave={(updated) => { handleBlockUpdate(updated); setEditingBlock(null); }}
              onBlockUpdate={handleBlockUpdate}
              allBlocks={blocks}
              onDeleteAll={handleDeleteAll}
              onSaveAll={handleSaveAll}
              canEdit={canEdit}
              canEditData={canEditData}
              canEditMat={canEditMat}
              dataOpts={bDataOpts}
              materialOpts={bMaterialOpts}
              barvyOpts={bBarvyOpts}
              lakOpts={bLakOpts}
              jobPresets={jobPresets}
              onToast={showToast}
            />
          ) : selectedBlock ? (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <BlockDetail block={selectedBlock} onClose={() => setSelectedBlock(null)} onDelete={handleDeleteBlock} />
              {/* "Upozornit obchod" — jen pokud blok má reservationId a canEdit */}
              {canEdit && selectedBlock.reservationId && (
                <div style={{ padding: "8px 16px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
                  <button
                    onClick={async () => {
                      const r = await fetch(`/api/reservations/${selectedBlock.reservationId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "notify" }),
                      });
                      if (r.ok) showToast("Upozornění odesláno obchodníkovi", "success");
                      else showToast("Chyba při odesílání upozornění", "error");
                    }}
                    style={{
                      width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(124,58,237,0.3)",
                      background: "rgba(124,58,237,0.08)", color: "#7c3aed", fontFamily: "inherit",
                      fontWeight: 600, fontSize: 12, cursor: "pointer", transition: "background 150ms ease-out",
                    }}
                  >
                    Upozornit obchod
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--surface)", borderLeft: "1px solid var(--border)" }}>

              {/* ── Builder Header ── */}
              <div style={{ padding: "12px 16px", background: "linear-gradient(135deg, color-mix(in oklab, var(--surface-2) 95%, transparent) 0%, var(--surface) 100%)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #e53e3e 0%, #dd6b20 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#fff", fontSize: 15, flexShrink: 0 }}>
                    J
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>Job Builder</div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 2 }}>Integraf</div>
                  </div>
                </div>
              </div>

              {/* ── Formulář ── */}
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "0 16px", flex: 1 }}>

                  {/* ── Typ záznamu ── */}
                  <div style={{ paddingTop: 16, paddingBottom: 14, borderBottom: type === "ZAKAZKA" ? "none" : "1px solid var(--border)" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>
                      Typ záznamu
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {(Object.entries(TYPE_BUILDER_CONFIG) as [string, typeof TYPE_BUILDER_CONFIG[keyof typeof TYPE_BUILDER_CONFIG]][]).map(([key, cfg]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => { setType(key); if (key !== "ZAKAZKA") setBlockVariant("STANDARD"); }}
                          style={{
                            flex: 1, padding: "8px 4px", borderRadius: 7,
                            border: type === key ? `1px solid ${cfg.color}` : "1px solid var(--border)",
                            background: type === key ? `${cfg.color}22` : "var(--surface-2)",
                            cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                            transition: "all 0.15s",
                          }}
                        >
                          <cfg.icon size={16} strokeWidth={1.5} color={type === key ? cfg.color : "var(--text-muted)"} />
                          <span style={{ fontSize: 9, fontWeight: 600, color: type === key ? cfg.color : "var(--text-muted)", letterSpacing: "0.04em", lineHeight: 1.3, textAlign: "center" }}>
                            {cfg.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {type !== "UDRZBA" && (
                    <div style={{ paddingTop: 10, paddingBottom: 14, borderBottom: type === "ZAKAZKA" ? "none" : "1px solid var(--border)" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
                        Preset
                      </div>
                      {bJobPresetLabel && (
                        <div style={{ marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            Aktivní:
                            <span style={{ marginLeft: 6, color: "var(--text)", fontWeight: 700 }}>{bJobPresetLabel}</span>
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            Předvyplnění je jen návrh
                          </div>
                        </div>
                      )}
                      {compatibleBuilderPresets.length > 0 ? (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 5 }}>
                          {compatibleBuilderPresets.map((preset, index) => {
                            const active = bJobPresetId === preset.id;
                            const tone = getJobPresetTone(preset, index);
                            return (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() => applyPresetToBuilder(preset)}
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
                                <span style={{ fontSize: 8, fontWeight: active ? 700 : 600, color: active ? tone : "var(--text-muted)", letterSpacing: "0.03em", lineHeight: 1.15, textAlign: "center" }}>
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
                          onClick={clearBuilderPresetSelection}
                          disabled={bJobPresetId === null && !bJobPresetLabel}
                          style={{
                            width: "100%", height: 34, borderRadius: 10, border: "1px solid color-mix(in oklab, var(--border) 88%, transparent)",
                            background: "linear-gradient(180deg, color-mix(in oklab, var(--surface-2) 94%, white 6%) 0%, var(--surface-2) 100%)",
                            color: "var(--text-muted)", fontSize: 11, fontWeight: 700,
                            cursor: bJobPresetId === null && !bJobPresetLabel ? "default" : "pointer",
                            opacity: bJobPresetId === null && !bJobPresetLabel ? 0.5 : 1,
                            boxShadow: "inset 0 1px 0 color-mix(in oklab, white 24%, transparent)",
                          }}
                        >
                          Vyčistit preset
                        </button>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.4 }}>
                        Výběr pouze předvyplní nastavená pole. Vyčištění preset odpojí a smaže jeho předvyplněné hodnoty.
                      </div>
                    </div>
                  )}

                  {/* ── Stav zakázky — jen pro ZAKAZKA ── */}
                  {type === "ZAKAZKA" && (
                    <div style={{ paddingTop: 10, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
                        Stav zakázky
                      </div>
                      <div style={{ display: "flex", gap: 5 }}>
                        {(BLOCK_VARIANTS as readonly BlockVariant[]).map((v) => {
                          const cfg = VARIANT_CONFIG[v];
                          const isActive = blockVariant === v;
                          return (
                            <button
                              key={v}
                              type="button"
                              onClick={() => setBlockVariant(v)}
                              style={{
                                flex: 1, padding: "7px 4px", borderRadius: 7,
                                border: isActive ? `1px solid ${cfg.color}` : "1px solid var(--border)",
                                background: isActive ? `${cfg.color}22` : "var(--surface-2)",
                                cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                                transition: "all 0.12s",
                              }}
                            >
                              <div style={{ width: 8, height: 8, borderRadius: "50%", background: isActive ? cfg.color : "var(--border)" }} />
                              <span style={{ fontSize: 8, fontWeight: 600, color: isActive ? cfg.color : "var(--text-muted)", lineHeight: 1.2, textAlign: "center" }}>
                                {cfg.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── Zakázka ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                      {type === "UDRZBA" ? "Popis" : "Zakázka"}
                    </div>

                    {/* Číslo zakázky + Délka tisku */}
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                      <div style={{ flex: "0 0 130px" }}>
                        <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block" }}>
                          {type === "UDRZBA" ? "Název / označení" : "Číslo zakázky"} *
                        </Label>
                        <Input
                          value={orderNumber}
                          onChange={(e) => setOrderNumber(e.target.value)}
                          placeholder={type === "UDRZBA" ? "Čištění hlavy…" : "17001"}
                          className="h-8 text-xs"
                        />
                      </div>

                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Délka tisku</label>
                        <div style={{ position: "relative" }}>
                          <select
                            value={String(durationHours)}
                            onChange={(e) => setDurationHours(Number(e.target.value))}
                            style={{
                              appearance: "none",
                              width: "100%",
                              height: 32,
                              background: "var(--surface-2)",
                              border: "1px solid var(--border)",
                              borderRadius: 10,
                              color: "var(--text)",
                              fontSize: 13,
                              fontWeight: 600,
                              padding: "0 36px 0 14px",
                              cursor: "pointer",
                              outline: "none",
                            }}
                            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                          >
                            {DURATION_OPTIONS.map((opt) => (
                              <option key={opt.hours} value={String(opt.hours)}>{opt.label}</option>
                            ))}
                          </select>
                          <svg
                            viewBox="0 0 20 20"
                            fill="none"
                            stroke="currentColor"
                            color="var(--text-muted)"
                            strokeWidth="1.8"
                            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, pointerEvents: "none" }}
                          >
                            <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* Popis */}
                    <div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                        <Label style={{ fontSize: 10, color: "var(--text-muted)" }}>Popis</Label>
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(description)}
                          title="Kopírovat popis"
                          style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: "0 2px", lineHeight: 1, transition: "color 120ms ease-out" }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                          Kopírovat
                        </button>
                      </div>
                      <Textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={2}
                        placeholder="Firma – produkt – počet tisků…"
                        className="text-xs resize-none"
                      />
                    </div>
                  </div>

                  {/* ── Výrobní sloupečky (skryté pro Údržbu) ── */}
                  {type !== "UDRZBA" && (
                    <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Výrobní sloupečky</div>
                      {/* DATA — datum + dropdown v jednom řádku */}
                      <div>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Data</label>
                        <div style={{ display: "flex", gap: 6 }}>
                          <div style={{ flex: "0 0 130px" }}>
                            <DatePickerField value={bDataRequiredDate} onChange={setBDataRequiredDate} placeholder="Datum dodání…" />
                          </div>
                          <div style={{ position: "relative", flex: 1 }}>
                            <select
                              value={bDataStatusId}
                              onChange={(e) => setBDataStatusId(e.target.value)}
                              style={{
                                appearance: "none", width: "100%", height: 32,
                                background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10,
                                color: bDataStatusId ? "var(--text)" : "var(--text-muted)", fontSize: 12, fontWeight: 600,
                                padding: "0 32px 0 12px", cursor: "pointer", outline: "none",
                              }}
                              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                            >
                              <option value="">— info —</option>
                              {bDataOpts.map((o) => (
                                <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                              ))}
                            </select>
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" color="var(--text-muted)"
                              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
                              <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        </div>
                      </div>

                      {/* Materiál — datum + dropdown v jednom řádku */}
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                          <label style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>Materiál</label>
                          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: bMaterialInStock ? "#10b981" : "var(--text-muted)", cursor: "pointer" }}>
                            <Switch checked={bMaterialInStock} onCheckedChange={(checked) => { setBMaterialInStock(checked); if (checked) setBMaterialRequiredDate(""); }} />
                            SKLADEM
                          </label>
                        </div>
                        <div style={{ display: "flex", gap: 6, opacity: bMaterialInStock ? 0.4 : 1, pointerEvents: bMaterialInStock ? "none" : "auto" }}>
                          <div style={{ flex: "0 0 130px" }}>
                            <DatePickerField value={bMaterialRequiredDate} onChange={setBMaterialRequiredDate} placeholder="Datum dodání…" />
                          </div>
                          <div style={{ position: "relative", flex: 1 }}>
                            <select
                              value={bMaterialStatusId}
                              onChange={(e) => setBMaterialStatusId(e.target.value)}
                              style={{
                                appearance: "none", width: "100%", height: 32,
                                background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10,
                                color: bMaterialStatusId ? "var(--text)" : "var(--text-muted)", fontSize: 12, fontWeight: 600,
                                padding: "0 32px 0 12px", cursor: "pointer", outline: "none",
                              }}
                              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                            >
                              <option value="">— info —</option>
                              {bMaterialOpts.map((o) => (
                                <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                              ))}
                            </select>
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" color="var(--text-muted)"
                              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
                              <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        </div>
                      </div>

                      {/* Pantone + Barvy + Lak — 3-sloupcový grid */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        {/* Pantone — datepicker + OK */}
                        <div>
                          <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Pantone</label>
                          <DatePickerField value={bPantoneRequiredDate} onChange={setBPantoneRequiredDate} placeholder="Datum…" />
                          <label style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5, fontSize: 10, fontWeight: 600, color: bPantoneOk ? "var(--success)" : "var(--text-muted)", cursor: "pointer", letterSpacing: "0.04em" }}>
                            <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, background: bPantoneOk ? "var(--success)" : "transparent", border: bPantoneOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 120ms ease-out" }}>
                              {bPantoneOk && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            </div>
                            <input type="checkbox" checked={bPantoneOk} onChange={(e) => setBPantoneOk(e.target.checked)} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                            OK
                          </label>
                        </div>
                        {/* Barvy + Lak */}
                        {([
                          { label: "Barvy",   value: bBarvyStatusId,    setter: setBBarvyStatusId,    opts: bBarvyOpts },
                          { label: "Lak",     value: bLakStatusId,      setter: setBLakStatusId,      opts: bLakOpts },
                        ] as { label: string; value: string; setter: (v: string) => void; opts: CodebookOption[] }[]).map(({ label, value, setter, opts }) => (
                          <div key={label}>
                            <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>{label}</label>
                            <div style={{ position: "relative" }}>
                              <select
                                value={value}
                                onChange={(e) => setter(e.target.value)}
                                style={{
                                  appearance: "none", width: "100%", height: 32,
                                  background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10,
                                  color: value ? "var(--text)" : "var(--text-muted)", fontSize: 12, fontWeight: 600,
                                  padding: "0 32px 0 12px", cursor: "pointer", outline: "none",
                                }}
                                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                              >
                                <option value="">— nezadáno —</option>
                                {opts.map((o) => (
                                  <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                                ))}
                              </select>
                              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" color="var(--text-muted)"
                                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
                                <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div>
                        <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block" }}>Specifikace</Label>
                        <Input value={bSpecifikace} onChange={(e) => setBSpecifikace(e.target.value)} placeholder="Volný text…" className="h-8 text-xs" />
                      </div>
                      <div>
                        <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block" }}>Termín expedice</Label>
                        <DatePickerField value={bDeadlineExpedice} onChange={setBDeadlineExpedice} placeholder="Datum expedice…" />
                      </div>
                    </div>
                  )}

                  {/* ── Opakování ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>Opakování</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Interval</label>
                        <div style={{ position: "relative" }}>
                          <select
                            value={bRecurrenceType}
                            onChange={(e) => setBRecurrenceType(e.target.value)}
                            style={{
                              appearance: "none", width: "100%", height: 32,
                              background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10,
                              color: "var(--text)", fontSize: 12, fontWeight: 600,
                              padding: "0 32px 0 12px", cursor: "pointer", outline: "none",
                            }}
                            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                          >
                            <option value="NONE">— bez opakování —</option>
                            <option value="DAILY">↻ Každý den</option>
                            <option value="WEEKLY">↻ Každý týden</option>
                            <option value="MONTHLY">↻ Každý měsíc</option>
                          </select>
                          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" color="var(--text-muted)"
                            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
                            <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      </div>
                      {bRecurrenceType !== "NONE" && (
                        <div style={{ flex: "0 0 90px" }}>
                          <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Počet bloků</label>
                          <input
                            type="number"
                            min={2}
                            max={52}
                            value={bRecurrenceCount}
                            onChange={(e) => setBRecurrenceCount(Math.max(2, Math.min(52, parseInt(e.target.value) || 2)))}
                            style={{
                              width: "100%", height: 32, background: "var(--surface-2)",
                              border: "1px solid var(--border)", borderRadius: 10,
                              color: "var(--text)", fontSize: 13, fontWeight: 700,
                              padding: "0 10px", outline: "none", textAlign: "center",
                            }}
                          />
                        </div>
                      )}
                    </div>
                    {bRecurrenceType !== "NONE" && (
                      <>
                        {/* Stroj */}
                        <div style={{ marginTop: 10 }}>
                          <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Stroj</label>
                          <div style={{ display: "flex", gap: 4 }}>
                            {(["XL_105", "XL_106"] as const).map((m) => (
                              <button key={m} type="button" onClick={() => setBSeriesMachine(m)} style={{
                                flex: 1, height: 28, borderRadius: 6, fontSize: 11, fontWeight: bSeriesMachine === m ? 700 : 500,
                                border: bSeriesMachine === m ? "1px solid rgba(59,130,246,0.5)" : "1px solid var(--border)",
                                background: bSeriesMachine === m ? "rgba(59,130,246,0.15)" : "var(--surface-2)",
                                color: bSeriesMachine === m ? "#93c5fd" : "var(--text-muted)",
                                cursor: "pointer", transition: "all 0.12s ease-out",
                              }}>{m === "XL_105" ? "XL 105" : "XL 106"}</button>
                            ))}
                          </div>
                        </div>
                        {/* První výskyt */}
                        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "flex-end" }}>
                          <div style={{ flex: 1 }}>
                            <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Datum 1. výskytu</label>
                            <DatePickerField value={bSeriesFirstDate} onChange={setBSeriesFirstDate} placeholder="Datum…" />
                          </div>
                          <div style={{ flex: "0 0 84px" }}>
                            <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Čas</label>
                            <div style={{ position: "relative" }}>
                              <select
                                value={bSeriesFirstHour}
                                onChange={(e) => setBSeriesFirstHour(parseInt(e.target.value))}
                                style={{
                                  appearance: "none", width: "100%", height: 32,
                                  background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10,
                                  color: "var(--text)", fontSize: 12, fontWeight: 600,
                                  padding: "0 28px 0 10px", cursor: "pointer", outline: "none",
                                }}
                                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                              >
                                {Array.from({ length: 24 }, (_, h) => (
                                  <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                                ))}
                              </select>
                              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" color="var(--text-muted)"
                                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 11, height: 11, pointerEvents: "none" }}>
                                <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* ── Preview série ── */}
                  {bRecurrenceType !== "NONE" && seriesPreview.length > 0 && (
                    <div style={{ paddingTop: 12, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Preview série</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto" }}>
                        {seriesPreview.map((occ, i) => (
                          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3, padding: "6px 8px", borderRadius: 7, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                            {/* Řádek 1: badge + Tisk datum + hodina */}
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <div style={{
                                flexShrink: 0, width: 20, height: 20, borderRadius: 4,
                                background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 9, fontWeight: 700, color: "#93c5fd",
                              }}>{i + 1}</div>
                              <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-muted)", width: 28, flexShrink: 0 }}>Tisk:</div>
                              <div style={{ flex: 1 }}>
                                <DatePickerField
                                  value={occ.date}
                                  onChange={(d) => setSeriesPreview((prev) => prev.map((o, j) => j === i ? { ...o, date: d } : o))}
                                  placeholder="Datum…"
                                />
                              </div>
                              <div style={{ flex: "0 0 72px", position: "relative" }}>
                                <select
                                  value={occ.hour}
                                  onChange={(e) => setSeriesPreview((prev) => prev.map((o, j) => j === i ? { ...o, hour: parseInt(e.target.value) } : o))}
                                  style={{
                                    appearance: "none", width: "100%", height: 30,
                                    background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8,
                                    color: "var(--text)", fontSize: 11, fontWeight: 600,
                                    padding: "0 22px 0 8px", cursor: "pointer", outline: "none",
                                  }}
                                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
                                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                                >
                                  {Array.from({ length: 24 }, (_, h) => (
                                    <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                                  ))}
                                </select>
                                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" color="var(--text-muted)"
                                  style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", width: 10, height: 10, pointerEvents: "none" }}>
                                  <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </div>
                            </div>
                            {/* Řádek 2: DATA datum + EXP datum */}
                            <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 26 }}>
                              <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-muted)", width: 28, flexShrink: 0 }}>DATA:</div>
                              <div style={{ flex: 1 }}>
                                <DatePickerField
                                  value={occ.dataRequiredDate}
                                  onChange={(d) => setSeriesPreview((prev) => prev.map((o, j) => j === i ? { ...o, dataRequiredDate: d } : o))}
                                  placeholder="Termín dat…"
                                />
                              </div>
                              <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-muted)", width: 24, flexShrink: 0, textAlign: "right" }}>EXP:</div>
                              <div style={{ flex: 1 }}>
                                <DatePickerField
                                  value={occ.deadlineExpedice}
                                  onChange={(d) => setSeriesPreview((prev) => prev.map((o, j) => j === i ? { ...o, deadlineExpedice: d } : o))}
                                  placeholder="Expedice…"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Live náhled ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Náhled bloku</div>
                    <div style={{
                      borderRadius: 6, padding: "9px 11px",
                      background: `${typeConfig?.color ?? "#334155"}18`,
                      borderTop: `1px solid ${typeConfig?.color ?? "var(--text-muted)"}33`,
                      borderRight: `1px solid ${typeConfig?.color ?? "var(--text-muted)"}33`,
                      borderBottom: `1px solid ${typeConfig?.color ?? "var(--text-muted)"}33`,
                      borderLeft: `3px solid ${typeConfig?.color ?? "var(--text-muted)"}`,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>
                        {orderNumber || <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>—</span>}
                      </div>
                      {description && (
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>{description}</div>
                      )}
                      {bJobPresetLabel && type !== "UDRZBA" && (
                        <div style={{ fontSize: 10, color: "var(--accent)", marginTop: 4, lineHeight: 1.4, fontWeight: 700 }}>
                          {bJobPresetLabel}
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: typeConfig?.color ?? "var(--text-muted)", marginTop: 5 }}>
                        {typeConfig && <typeConfig.icon size={10} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 3 }} />}{typeConfig?.label} · {formatDuration(durationHours)}
                      </div>
                    </div>
                  </div>

                  {/* ── CTA — podmíněné ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 16 }}>
                    {bRecurrenceType !== "NONE" ? (
                      <>
                        <button
                          type="button"
                          onClick={handleScheduleSeries}
                          disabled={!orderNumber.trim() || seriesPreview.length === 0 || seriesScheduling}
                          style={{
                            width: "100%", paddingTop: 11, paddingBottom: 11, borderRadius: 10, border: "none",
                            background: (orderNumber.trim() && seriesPreview.length > 0 && !seriesScheduling) ? "#FFE600" : "rgba(255,255,255,0.06)",
                            color: (orderNumber.trim() && seriesPreview.length > 0 && !seriesScheduling) ? "#111" : "rgba(255,255,255,0.2)",
                            fontSize: 13, fontWeight: 700, letterSpacing: "0.02em",
                            cursor: (orderNumber.trim() && seriesPreview.length > 0 && !seriesScheduling) ? "pointer" : "default",
                            transition: "background 120ms ease-out, transform 80ms ease-out",
                            fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
                          }}
                          onMouseDown={(e) => { if (orderNumber.trim() && seriesPreview.length > 0 && !seriesScheduling) (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.97)"; }}
                          onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
                        >
                          {seriesScheduling ? "Plánuji…" : `↻ Naplánovat sérii (${seriesPreview.length} bloků)`}
                        </button>
                        {seriesPreview.length === 0 && (
                          <div style={{ fontSize: 9, color: "var(--text-muted)", textAlign: "center", marginTop: 6 }}>
                            Zadej datum prvního výskytu pro zobrazení preview
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={handleAddToQueue}
                          disabled={!orderNumber.trim()}
                          style={{
                            width: "100%", paddingTop: 11, paddingBottom: 11, borderRadius: 10, border: "none",
                            background: orderNumber.trim() ? "#FFE600" : "rgba(255,255,255,0.06)",
                            color: orderNumber.trim() ? "#111" : "rgba(255,255,255,0.2)",
                            fontSize: 13, fontWeight: 700, letterSpacing: "0.02em",
                            cursor: orderNumber.trim() ? "pointer" : "default",
                            transition: "background 120ms ease-out, transform 80ms ease-out",
                            fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
                          }}
                          onMouseDown={(e) => { if (orderNumber.trim()) (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.97)"; }}
                          onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
                        >
                          + Přidat do fronty
                        </button>
                        <div style={{ fontSize: 9, color: "var(--text-muted)", textAlign: "center", marginTop: 6 }}>
                          Přetáhni kartu z fronty na timeline → stroj a čas
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* ── Fronta ── */}
                {queue.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", background: "var(--surface-2)", padding: "12px 16px 16px", flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Fronta</div>
                      <div style={{ minWidth: 18, height: 18, borderRadius: 9, background: "var(--brand)", color: "var(--brand-contrast)", fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
                        {queue.length}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {queue.map((item) => {
                        const itemCfg = TYPE_BUILDER_CONFIG[item.type as keyof typeof TYPE_BUILDER_CONFIG];
                        return (
                          <div
                            key={item.id}
                            className="pressable-card"
                            onMouseDown={(e) => {
                              if (e.button !== 0) return;
                              e.preventDefault();
                              setDraggingQueueItem(item);
                            }}
                            style={{
                              display: "flex", alignItems: "stretch",
                              background: "var(--surface)",
                              borderRadius: 6,
                              border: "1px solid var(--border)",
                              overflow: "hidden",
                              cursor: draggingQueueItem?.id === item.id ? "grabbing" : "grab",
                            }}
                          >
                            {/* Barevný pruh vlevo */}
                            <div style={{ width: 3, background: itemCfg?.color ?? "var(--text-muted)", flexShrink: 0 }} />
                            {/* Obsah */}
                            <div style={{ flex: 1, padding: "7px 9px", minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{item.orderNumber}</div>
                              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                                {itemCfg && <itemCfg.icon size={10} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 3 }} />}{itemCfg?.label} · {formatDuration(item.durationHours)}
                              </div>
                              {item.description && (
                                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {item.description}
                                </div>
                              )}
                            </div>
                            {/* Smazat */}
                            <button
                              type="button"
                              onClick={() => setQueue((prev) => prev.filter((q) => q.id !== item.id))}
                              onMouseDown={(e) => e.stopPropagation()}
                              style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 16, padding: "0 10px", display: "flex", alignItems: "center", lineHeight: 1 }}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Připravené rezervace ── */}
                {reservationQueue.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", background: "rgba(124,58,237,0.04)", padding: "12px 16px 16px", flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#7c3aed" }}>Připravené rezervace</div>
                      <div style={{ minWidth: 18, height: 18, borderRadius: 9, background: "#7c3aed", color: "#fff", fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
                        {reservationQueue.length}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {reservationQueue.map((item) => (
                        <div
                          key={item.id}
                          className="pressable-card"
                          onMouseDown={(e) => {
                            if (e.button !== 0) return;
                            e.preventDefault();
                            setDraggingQueueItem(item);
                          }}
                          style={{
                            display: "flex", alignItems: "stretch",
                            background: "var(--surface)",
                            borderRadius: 6,
                            border: "1px solid rgba(124,58,237,0.3)",
                            overflow: "hidden",
                            cursor: draggingQueueItem?.id === item.id ? "grabbing" : "grab",
                          }}
                        >
                          <div style={{ width: 3, background: "#7c3aed", flexShrink: 0 }} />
                          <div style={{ flex: 1, padding: "7px 9px", minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", background: "rgba(124,58,237,0.12)", padding: "1px 5px", borderRadius: 4 }}>
                                {item.reservationCode}
                              </span>
                              <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>Rezervace</span>
                            </div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.companyName}
                            </div>
                            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                              {formatDuration(item.durationHours)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>}
      </section>

      {/* ── Push chain notifikace ── */}
      {pushSuggestion?.blockedByLock && (
        <div style={{
          position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
          background: "var(--surface)", border: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)",
          borderRadius: 12, padding: "10px 16px",
          display: "flex", alignItems: "center", gap: 12,
          zIndex: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
          whiteSpace: "nowrap",
        }}>
          <span style={{ fontSize: 11, color: "var(--danger)" }}>
            <Lock size={11} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }} />Blok vrácen — v cestě je zamknutý blok
            {pushSuggestion.lockedBlock && <b> {pushSuggestion.lockedBlock.orderNumber}</b>}
          </span>
          <button
            onClick={() => setPushSuggestion(null)}
            style={{ fontSize: 11, color: "var(--text)", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}
          >
            OK
          </button>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />

    </main>
  );
}
