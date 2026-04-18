import { formatCivilDate, formatPragueDateTime, formatPragueDateShort, formatPragueTime, todayPragueDateStr, utcToPragueDateStr } from "./dateUtils";

export const FIELD_LABELS: Record<string, string> = {
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
  expediceNote: "Poznámka expedice",
  doprava: "Doprava",
  pantoneRequiredDate: "Pantone datum",
  pantoneOk: "Pantone OK",
  pantoneRequired: "Pantone potřeba",
  blockVariant: "Stav zakázky",
};

export function fmtAuditVal(val: string | null, field: string | null): string {
  if (!val || val === "null") return "—";
  if (field === "dataOk" || field === "materialOk" || field === "pantoneRequired") return val === "true" ? "✓ OK" : "✗ Ne";
  if (field && ["dataRequiredDate", "materialRequiredDate", "pantoneRequiredDate", "deadlineExpedice"].includes(field)) {
    return formatCivilDate(val);
  }
  if (val.includes("T")) {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) return formatPragueDateTime(d);
  }
  return val;
}

export function formatPragueMaybeToday(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const isToday = utcToPragueDateStr(d) === todayPragueDateStr();
  const time = formatPragueTime(d);
  return isToday ? time : `${formatPragueDateShort(d)} ${time}`;
}
