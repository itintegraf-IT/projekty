"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input }     from "@/components/ui/input";
import { Textarea }  from "@/components/ui/textarea";
import { Label }     from "@/components/ui/label";
import { Button }    from "@/components/ui/button";
import { Switch }    from "@/components/ui/switch";
import { Badge }     from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Lock, Unlock, CalendarDays } from "lucide-react";
import DatePickerField from "@/app/_components/DatePickerField";
import { type Block } from "@/app/_components/TimelineGrid";
import { BLOCK_VARIANTS, VARIANT_CONFIG, normalizeBlockVariant, type BlockVariant } from "@/lib/blockVariants";
import { utcToPragueDateStr, utcToPragueHour, pragueToUTC } from "@/lib/dateUtils";
import { applyJobPresetToDraft, presetSupportsType, type JobPreset, type JobPresetDraftValues } from "@/lib/jobPresets";
import { type Toast } from "@/components/ToastContainer";
import {
  type CodebookOption,
  TYPE_LABELS,
  TYPE_BUILDER_CONFIG,
  DURATION_OPTIONS,
  JOB_PRESET_TONE_PALETTE,
  getJobPresetTone,
} from "@/lib/plannerTypes";

// Suppress unused import warnings for re-exported symbols used in JSX
void TYPE_LABELS;
void Unlock;
void CalendarDays;
void Badge;
void Separator;
void Popover;
void PopoverContent;
void PopoverTrigger;
void JOB_PRESET_TONE_PALETTE;

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

// ─── BlockEdit ────────────────────────────────────────────────────────────────
export function BlockEdit({
  block,
  onClose,
  onSave,
  onBlockUpdate,
  allBlocks,
  onDeleteAll,
  onSaveAll,
  canEdit = true,
  canEditData = true,
  canEditDataDate = true,
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
  canEditDataDate?: boolean;
  canEditMat?: boolean;
  dataOpts?: CodebookOption[];
  materialOpts?: CodebookOption[];
  barvyOpts?: CodebookOption[];
  lakOpts?: CodebookOption[];
  jobPresets?: JobPreset[];
  onToast?: (message: string, type: Toast["type"]) => void;
}) {
  const [orderNumber, setOrderNumber] = useState(block.orderNumber);
  const [type, setType]               = useState(block.type);
  const [blockVariant, setBlockVariant] = useState<BlockVariant>(normalizeBlockVariant(block.blockVariant, block.type));
  const [description, setDescription] = useState(block.description ?? "");
  const [locked, setLocked]           = useState(block.locked);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [showOrderNumberPrompt, setShowOrderNumberPrompt] = useState(false);
  const [promptOrderNumber, setPromptOrderNumber] = useState("");

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
          // Sync form state pro aktuální blok — jinak by buildPayload() při
          // následném "Uložit změny" přepsal tyto hodnoty původními.
          if (draft.blockId === block.id) {
            setDataRequiredDate(draft.dataRequiredDate);
            setDeadlineExpedice(draft.deadlineExpedice);
          }
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
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)", outline: "none", position: "relative" }}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
        if (
          e.key === "Enter" && !e.shiftKey &&
          (e.target as HTMLElement).tagName !== "TEXTAREA" &&
          (e.target as HTMLElement).tagName !== "SELECT" &&
          !seriesConfirm && !showOrderNumberPrompt
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
                <div style={{ pointerEvents: !canEditDataDate ? "none" : "auto", opacity: !canEditDataDate ? 0.45 : 1 }}>
                  <DatePickerField value={dataRequiredDate} onChange={setDataRequiredDate} placeholder="Datum" />
                </div>
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
                      fontSize: 9, fontWeight: 700, color: "#3b82f6",
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
                    await onDeleteAll([block.id]);
                    onClose();
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
                  const num = promptOrderNumber.trim();
                  setShowOrderNumberPrompt(false);
                  setPromptOrderNumber("");
                  const payload = buildPayload();
                  payload.orderNumber = num;
                  payload.type = "ZAKAZKA";
                  payload.blockVariant = blockVariant;
                  doSave(payload);
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
                onClick={() => {
                  const num = promptOrderNumber.trim();
                  setShowOrderNumberPrompt(false);
                  setPromptOrderNumber("");
                  const payload = buildPayload();
                  payload.orderNumber = num;
                  payload.type = "ZAKAZKA";
                  payload.blockVariant = blockVariant;
                  doSave(payload);
                }}
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
    </div>
  );
}
