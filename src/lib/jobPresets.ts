import { normalizeBlockVariant, type BlockVariant } from "@/lib/blockVariants";
import { addDaysToCivilDate, todayPragueDateStr } from "@/lib/dateUtils";

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
  pantoneRequired: boolean | null;
  pantoneRequiredDateOffsetDays: number | null;
  pantoneInStock: boolean | null;
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
  pantoneRequired: boolean;
  pantoneRequiredDate: string;
  pantoneInStock: boolean;
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
  pantoneRequired: boolean | null;
  pantoneRequiredDateOffsetDays: number | null;
  pantoneInStock: boolean | null;
  barvyStatusId: number | null;
  lakStatusId: number | null;
  deadlineExpediceOffsetDays: number | null;
};

type PresetLabelResolver = (category: "DATA" | "MATERIAL" | "BARVY" | "LAK", id: number) => string | null;

export function dateStrToOffsetDays(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const today = todayPragueDateStr();
  const base = new Date(`${today}T12:00:00.000Z`);
  const target = new Date(`${dateStr}T12:00:00.000Z`);
  return Math.round((target.getTime() - base.getTime()) / (24 * 60 * 60 * 1000));
}

export function resolvePresetDateOffset(offsetDays: number | null | undefined): string | null {
  if (offsetDays === null || offsetDays === undefined) return null;
  return addDaysToCivilDate(todayPragueDateStr(), offsetDays);
}

export function applyJobPresetToDraft(
  current: JobPresetDraftValues,
  preset: JobPreset,
  type: string
): { next: JobPresetDraftValues; overwrittenFields: string[] } {
  const next: JobPresetDraftValues = { ...current };
  // Variant A nikdy nepřepíše vyplněné pole, takže overwrittenFields je vždy prázdné.
  // Návratový tvar zachován pro kompatibilitu s call-sity v BlockEdit a PlannerPage.
  const overwrittenFields: string[] = [];

  // blockVariant: jen když je STANDARD (default)
  if (type === "ZAKAZKA" && preset.blockVariant && current.blockVariant === "STANDARD") {
    next.blockVariant = normalizeBlockVariant(preset.blockVariant, type);
  }

  // specifikace: jen když prázdné
  if (preset.specifikace !== null && current.specifikace.trim() === "") {
    next.specifikace = preset.specifikace;
  }

  // dataStatusId: jen když prázdné
  if (preset.dataStatusId !== null && current.dataStatusId === "") {
    next.dataStatusId = String(preset.dataStatusId);
  }

  // dataRequiredDate: jen když prázdné
  if (preset.dataRequiredDateOffsetDays !== null && current.dataRequiredDate === "") {
    const value = resolvePresetDateOffset(preset.dataRequiredDateOffsetDays) ?? "";
    next.dataRequiredDate = value;
  }

  // materialStatusId: jen když prázdné
  if (preset.materialStatusId !== null && current.materialStatusId === "") {
    next.materialStatusId = String(preset.materialStatusId);
  }

  // materialInStock: aplikovat z presetu; vyplněné materialRequiredDate
  // se nikdy nemaže (Variant A — preserve user values)
  if (preset.materialInStock !== null && current.materialInStock !== preset.materialInStock) {
    next.materialInStock = preset.materialInStock;
  }

  // materialRequiredDate fill: jen když prázdné a preset nehlásí materialInStock
  if (
    !next.materialInStock &&
    preset.materialRequiredDateOffsetDays !== null &&
    current.materialRequiredDate === ""
  ) {
    const value = resolvePresetDateOffset(preset.materialRequiredDateOffsetDays) ?? "";
    next.materialRequiredDate = value;
  }

  // pantoneRequired: aplikovat z presetu; vyplněné pantoneRequiredDate
  // se nikdy nemaže (Variant A — preserve user values)
  if (preset.pantoneRequired !== null && current.pantoneRequired !== preset.pantoneRequired) {
    next.pantoneRequired = preset.pantoneRequired;
  }

  // pantoneInStock: aplikovat z presetu
  if (preset.pantoneInStock !== null && current.pantoneInStock !== preset.pantoneInStock) {
    next.pantoneInStock = preset.pantoneInStock;
    // „skladem" znamená, že pantone je potřeba — jinak by stav zůstal neviditelný
    if (preset.pantoneInStock) next.pantoneRequired = true;
  }

  // pantoneRequiredDate fill: jen když prázdné a preset nehlásí pantoneInStock
  if (!next.pantoneInStock && preset.pantoneRequiredDateOffsetDays !== null && current.pantoneRequiredDate === "") {
    const value = resolvePresetDateOffset(preset.pantoneRequiredDateOffsetDays) ?? "";
    next.pantoneRequiredDate = value;
    // Setting a date implies pantone is required (existing behavior)
    if (value) next.pantoneRequired = true;
  }

  // barvyStatusId: jen když prázdné
  if (preset.barvyStatusId !== null && current.barvyStatusId === "") {
    next.barvyStatusId = String(preset.barvyStatusId);
  }

  // lakStatusId: jen když prázdné
  if (preset.lakStatusId !== null && current.lakStatusId === "") {
    next.lakStatusId = String(preset.lakStatusId);
  }

  // deadlineExpedice: jen když prázdné
  if (preset.deadlineExpediceOffsetDays !== null && current.deadlineExpedice === "") {
    const value = resolvePresetDateOffset(preset.deadlineExpediceOffsetDays) ?? "";
    next.deadlineExpedice = value;
  }

  // Identita presetu — vždy aktualizovat
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
    pantoneRequired: draft.pantoneRequired ? true : null,
    pantoneRequiredDateOffsetDays: draft.pantoneInStock ? null : dateStrToOffsetDays(draft.pantoneRequiredDate),
    pantoneInStock: draft.pantoneInStock ? true : null,
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
  pantoneRequired?: boolean | null;
  pantoneRequiredDateOffsetDays?: number | null;
  pantoneInStock?: boolean | null;
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
    preset.pantoneRequired,
    preset.pantoneRequiredDateOffsetDays,
    preset.pantoneInStock,
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
  if (preset.pantoneInStock === true) {
    parts.push("Pantone: skladem");
  } else if (preset.pantoneRequired === true) {
    parts.push("Pantone");
  }
  if (preset.specifikace) {
    parts.push("Specifikace");
  }

  if (parts.length === 0) return "Bez nakonfigurovaných polí";
  return parts.join(" + ");
}
