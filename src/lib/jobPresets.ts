import { normalizeBlockVariant, type BlockVariant } from "@/lib/blockVariants";
import { utcToPragueDateStr } from "@/lib/dateUtils";

export const SYSTEM_JOB_PRESET_NAMES = ["XL 105", "XL 106 LED", "XL 106 IML"] as const;
export const JOB_PRESET_MACHINE_OPTIONS = ["XL_105", "XL_106"] as const;

export type JobPresetMachine = typeof JOB_PRESET_MACHINE_OPTIONS[number];

export type JobPreset = {
  id: number;
  name: string;
  isSystemPreset: boolean;
  isActive: boolean;
  sortOrder: number;
  appliesToZakazka: boolean;
  appliesToRezervace: boolean;
  machineConstraint: JobPresetMachine | null;
  blockVariant: string | null;
  specifikace: string | null;
  dataStatusId: number | null;
  dataRequiredDateOffsetDays: number | null;
  materialStatusId: number | null;
  materialRequiredDateOffsetDays: number | null;
  materialInStock: boolean | null;
  pantoneRequiredDateOffsetDays: number | null;
  barvyStatusId: number | null;
  lakStatusId: number | null;
  deadlineExpediceOffsetDays: number | null;
  createdAt: string;
  updatedAt: string;
};

export type JobPresetDraftValues = {
  blockVariant: BlockVariant;
  specifikace: string;
  dataStatusId: string;
  dataRequiredDate: string;
  materialStatusId: string;
  materialRequiredDate: string;
  materialInStock: boolean;
  pantoneRequiredDate: string;
  barvyStatusId: string;
  lakStatusId: string;
  deadlineExpedice: string;
  jobPresetId: number | null;
  jobPresetLabel: string;
};

export type JobPresetUpsertInput = {
  name: string;
  isActive: boolean;
  appliesToZakazka: boolean;
  appliesToRezervace: boolean;
  machineConstraint: JobPresetMachine | null;
  blockVariant: string | null;
  specifikace: string | null;
  dataStatusId: number | null;
  dataRequiredDateOffsetDays: number | null;
  materialStatusId: number | null;
  materialRequiredDateOffsetDays: number | null;
  materialInStock: boolean | null;
  pantoneRequiredDateOffsetDays: number | null;
  barvyStatusId: number | null;
  lakStatusId: number | null;
  deadlineExpediceOffsetDays: number | null;
};

type PresetLabelResolver = (category: "DATA" | "MATERIAL" | "BARVY" | "LAK", id: number) => string | null;

function addDaysToDateStr(dateStr: string, days: number): string {
  const base = new Date(`${dateStr}T12:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function dateStrToOffsetDays(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const today = todayPragueDateStr();
  const base = new Date(`${today}T12:00:00.000Z`);
  const target = new Date(`${dateStr}T12:00:00.000Z`);
  return Math.round((target.getTime() - base.getTime()) / (24 * 60 * 60 * 1000));
}

export function todayPragueDateStr(): string {
  return utcToPragueDateStr(new Date());
}

export function resolvePresetDateOffset(offsetDays: number | null | undefined): string | null {
  if (offsetDays === null || offsetDays === undefined) return null;
  return addDaysToDateStr(todayPragueDateStr(), offsetDays);
}

function pushOverwrite(overwrittenFields: string[], key: string, changed: boolean) {
  if (changed && !overwrittenFields.includes(key)) overwrittenFields.push(key);
}

export function applyJobPresetToDraft(
  current: JobPresetDraftValues,
  preset: JobPreset,
  type: string
): { next: JobPresetDraftValues; overwrittenFields: string[] } {
  const next: JobPresetDraftValues = { ...current };
  const overwrittenFields: string[] = [];

  if (type === "ZAKAZKA" && preset.blockVariant) {
    const normalized = normalizeBlockVariant(preset.blockVariant, type);
    pushOverwrite(overwrittenFields, "blockVariant", current.blockVariant !== normalized && current.blockVariant !== "STANDARD");
    next.blockVariant = normalized;
  }

  if (preset.specifikace !== null) {
    pushOverwrite(overwrittenFields, "specifikace", current.specifikace.trim() !== "" && current.specifikace !== preset.specifikace);
    next.specifikace = preset.specifikace;
  }

  if (preset.dataStatusId !== null) {
    const value = String(preset.dataStatusId);
    pushOverwrite(overwrittenFields, "dataStatusId", current.dataStatusId !== "" && current.dataStatusId !== value);
    next.dataStatusId = value;
  }

  if (preset.dataRequiredDateOffsetDays !== null) {
    const value = resolvePresetDateOffset(preset.dataRequiredDateOffsetDays) ?? "";
    pushOverwrite(overwrittenFields, "dataRequiredDate", current.dataRequiredDate !== "" && current.dataRequiredDate !== value);
    next.dataRequiredDate = value;
  }

  if (preset.materialStatusId !== null) {
    const value = String(preset.materialStatusId);
    pushOverwrite(overwrittenFields, "materialStatusId", current.materialStatusId !== "" && current.materialStatusId !== value);
    next.materialStatusId = value;
  }

  if (preset.materialInStock !== null) {
    pushOverwrite(overwrittenFields, "materialInStock", current.materialInStock !== preset.materialInStock);
    next.materialInStock = preset.materialInStock;
    if (preset.materialInStock) {
      pushOverwrite(overwrittenFields, "materialRequiredDate", current.materialRequiredDate !== "");
      next.materialRequiredDate = "";
    }
  }

  if (!next.materialInStock && preset.materialRequiredDateOffsetDays !== null) {
    const value = resolvePresetDateOffset(preset.materialRequiredDateOffsetDays) ?? "";
    pushOverwrite(overwrittenFields, "materialRequiredDate", current.materialRequiredDate !== "" && current.materialRequiredDate !== value);
    next.materialRequiredDate = value;
  }

  if (preset.pantoneRequiredDateOffsetDays !== null) {
    const value = resolvePresetDateOffset(preset.pantoneRequiredDateOffsetDays) ?? "";
    pushOverwrite(overwrittenFields, "pantoneRequiredDate", current.pantoneRequiredDate !== "" && current.pantoneRequiredDate !== value);
    next.pantoneRequiredDate = value;
  }

  if (preset.barvyStatusId !== null) {
    const value = String(preset.barvyStatusId);
    pushOverwrite(overwrittenFields, "barvyStatusId", current.barvyStatusId !== "" && current.barvyStatusId !== value);
    next.barvyStatusId = value;
  }

  if (preset.lakStatusId !== null) {
    const value = String(preset.lakStatusId);
    pushOverwrite(overwrittenFields, "lakStatusId", current.lakStatusId !== "" && current.lakStatusId !== value);
    next.lakStatusId = value;
  }

  if (preset.deadlineExpediceOffsetDays !== null) {
    const value = resolvePresetDateOffset(preset.deadlineExpediceOffsetDays) ?? "";
    pushOverwrite(overwrittenFields, "deadlineExpedice", current.deadlineExpedice !== "" && current.deadlineExpedice !== value);
    next.deadlineExpedice = value;
  }

  next.jobPresetId = preset.id;
  next.jobPresetLabel = preset.name;

  return { next, overwrittenFields };
}

export function buildPresetInputFromDraft(
  name: string,
  draft: JobPresetDraftValues,
  type: string,
  options?: {
    isActive?: boolean;
    appliesToZakazka?: boolean;
    appliesToRezervace?: boolean;
    machineConstraint?: JobPresetMachine | null;
  }
): JobPresetUpsertInput {
  return {
    name: name.trim(),
    isActive: options?.isActive ?? true,
    appliesToZakazka: options?.appliesToZakazka ?? (type === "ZAKAZKA"),
    appliesToRezervace: options?.appliesToRezervace ?? (type === "REZERVACE"),
    machineConstraint: options?.machineConstraint ?? null,
    blockVariant: type === "ZAKAZKA" ? draft.blockVariant : null,
    specifikace: draft.specifikace.trim() || null,
    dataStatusId: draft.dataStatusId ? Number(draft.dataStatusId) : null,
    dataRequiredDateOffsetDays: dateStrToOffsetDays(draft.dataRequiredDate),
    materialStatusId: draft.materialStatusId ? Number(draft.materialStatusId) : null,
    materialRequiredDateOffsetDays: draft.materialInStock ? null : dateStrToOffsetDays(draft.materialRequiredDate),
    materialInStock: draft.materialInStock ? true : null,
    pantoneRequiredDateOffsetDays: dateStrToOffsetDays(draft.pantoneRequiredDate),
    barvyStatusId: draft.barvyStatusId ? Number(draft.barvyStatusId) : null,
    lakStatusId: draft.lakStatusId ? Number(draft.lakStatusId) : null,
    deadlineExpediceOffsetDays: dateStrToOffsetDays(draft.deadlineExpedice),
  };
}

export function presetSupportsType(preset: JobPreset, type: string): boolean {
  if (type === "ZAKAZKA") return preset.appliesToZakazka;
  if (type === "REZERVACE") return preset.appliesToRezervace;
  return false;
}

type PresetConfigShape = {
  blockVariant?: string | null;
  specifikace?: string | null;
  dataStatusId?: number | null;
  dataRequiredDateOffsetDays?: number | null;
  materialStatusId?: number | null;
  materialRequiredDateOffsetDays?: number | null;
  materialInStock?: boolean | null;
  pantoneRequiredDateOffsetDays?: number | null;
  barvyStatusId?: number | null;
  lakStatusId?: number | null;
  deadlineExpediceOffsetDays?: number | null;
  machineConstraint?: string | null;
};

export function presetHasConfiguredValues(preset: PresetConfigShape): boolean {
  return [
    preset.blockVariant,
    preset.specifikace,
    preset.dataStatusId,
    preset.dataRequiredDateOffsetDays,
    preset.materialStatusId,
    preset.materialRequiredDateOffsetDays,
    preset.materialInStock,
    preset.pantoneRequiredDateOffsetDays,
    preset.barvyStatusId,
    preset.lakStatusId,
    preset.deadlineExpediceOffsetDays,
    preset.machineConstraint,
  ].some((value) => value !== null && value !== undefined && value !== "");
}

export function summarizeJobPreset(
  preset: JobPreset,
  resolveLabel?: PresetLabelResolver
): string {
  const parts: string[] = [];

  if (preset.dataStatusId !== null) {
    parts.push(`DATA${resolveLabel ? `: ${resolveLabel("DATA", preset.dataStatusId) ?? "vybráno"}` : ""}`);
  }
  if (preset.materialInStock === true) {
    parts.push("Materiál: skladem");
  } else if (preset.materialStatusId !== null) {
    parts.push(`Materiál${resolveLabel ? `: ${resolveLabel("MATERIAL", preset.materialStatusId) ?? "vybráno"}` : ""}`);
  }
  if (preset.barvyStatusId !== null) {
    parts.push(`Barvy${resolveLabel ? `: ${resolveLabel("BARVY", preset.barvyStatusId) ?? "vybráno"}` : ""}`);
  }
  if (preset.lakStatusId !== null) {
    parts.push(`Lak${resolveLabel ? `: ${resolveLabel("LAK", preset.lakStatusId) ?? "vybráno"}` : ""}`);
  }
  if (preset.specifikace) {
    parts.push("Specifikace");
  }

  if (parts.length === 0) return "Bez nakonfigurovaných polí";
  return parts.join(" + ");
}
