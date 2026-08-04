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
  materialIssued: "Materiál vydán",
  deadlineExpedice: "Expedice termín",
  expediceNote: "Poznámka expedice",
  doprava: "Doprava",
  pantoneRequiredDate: "Pantone datum",
  pantoneOk: "Pantone OK",
  pantoneRequired: "Pantone potřeba",
  blockVariant: "Stav zakázky",
  obalka: "Obálka",
  vnitrky: "Vnitřky",
  tiskoveArchy: "Tiskové archy",
  serie: "Série",
  type: "Typ záznamu",
  orderNumber: "Číslo zakázky",
};

export function fmtAuditVal(val: string | null, field: string | null): string {
  if (!val || val === "null") return "—";
  if (field === "obalka" || field === "vnitrky") return val === "true" ? "✓ Ano" : "✗ Ne";
  if (field === "tiskoveArchy" || field === "serie") {
    try {
      const arr = JSON.parse(val);
      if (Array.isArray(arr)) return arr.length ? arr.join(", ") : "—";
    } catch { /* fallthrough */ }
    return val;
  }
  if (field === "dataOk" || field === "materialOk" || field === "pantoneRequired") return val === "true" ? "✓ OK" : "✗ Ne";
  if (field === "materialInStock" || field === "materialIssued") return val === "true" ? "✓ Ano" : "✗ Ne";
  if (field && ["dataRequiredDate", "materialRequiredDate", "pantoneRequiredDate", "deadlineExpedice"].includes(field)) {
    return formatCivilDate(val);
  }
  // Span "start–end" (AUTO_SHIFT řádky po re-expanzi) — formátovat obě půlky.
  // Guard MUSÍ být striktní ISO tvar: new Date() je benevolentní a český free-text
  // („dodávka 1–2") by se jinak mis-formátoval na data — server píše výhradně toISOString().
  if (val.includes("–")) {
    const ISO = /^\d{4}-\d{2}-\d{2}T/;
    const [a, b] = val.split("–");
    if (a && b && ISO.test(a.trim()) && ISO.test(b.trim())) {
      const da = new Date(a.trim());
      const db = new Date(b.trim());
      if (!Number.isNaN(da.getTime()) && !Number.isNaN(db.getTime())) {
        return `${formatPragueDateTime(da)} – ${formatPragueDateTime(db)}`;
      }
    }
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
