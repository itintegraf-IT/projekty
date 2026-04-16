import { ClipboardList, Pin, Wrench } from "lucide-react";
import type { JobPreset } from "@/lib/jobPresets";

// ─── Shared codebook type ─────────────────────────────────────────────────────
export type CodebookOption = {
  id: number;
  category: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  shortCode: string | null;
  isWarning: boolean;
  badgeColor: string | null;
};

// ─── Block type labels ────────────────────────────────────────────────────────
export const TYPE_LABELS: Record<string, string> = {
  ZAKAZKA: "Zakázka",
  REZERVACE: "Rezervace",
  UDRZBA: "Údržba",
};

export const TYPE_BUILDER_CONFIG = {
  ZAKAZKA:   { icon: ClipboardList, label: "Zakázka",        color: "#1a6bcc" },
  REZERVACE: { icon: Pin,           label: "Rezervace",       color: "#7c3aed" },
  UDRZBA:    { icon: Wrench,        label: "Údržba / Oprava", color: "#c0392b" },
} as const;

// ─── Job preset helpers ───────────────────────────────────────────────────────
export const JOB_PRESET_TONE_PALETTE = ["#1a6bcc", "#d97706", "#0f9f6e", "#c2410c", "#7c3aed"] as const;

export function getJobPresetTone(preset: Pick<JobPreset, "name">, index: number) {
  const normalized = preset.name.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized.includes("105")) return "#1a6bcc";
  if (normalized.includes("led")) return "#d97706";
  if (normalized.includes("iml")) return "#0f9f6e";
  return JOB_PRESET_TONE_PALETTE[index % JOB_PRESET_TONE_PALETTE.length];
}

// ─── Duration options (0:30 … 24:00 v 30minutových krocích) ──────────────────
export const DURATION_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const totalMinutes = (i + 1) * 30;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return { label: `${h}:${m.toString().padStart(2, "0")}`, hours: totalMinutes / 60 };
});
