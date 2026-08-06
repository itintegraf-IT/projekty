import { formatCivilDate, formatPragueDateTime, formatPragueDateShort, formatPragueTime, todayPragueDateStr, utcToPragueDateStr } from "./dateUtils";

export const FIELD_LABELS: Record<string, string> = {
  jobPresetId: "Preset ID",
  jobPresetLabel: "Preset",
  dataStatusId: "DATA stav ID",
  dataStatusLabel: "DATA stav",
  dataRequiredDate: "DATA datum",
  dataOk: "DATA OK",
  materialStatusId: "Materiál stav ID",
  materialStatusLabel: "Materiál stav",
  materialRequiredDate: "Materiál datum",
  materialOk: "Materiál OK",
  materialNote: "Poznámka MTZ",
  materialInStock: "Materiál skladem",
  materialIssued: "Materiál vydán",
  deadlineExpedice: "Expedice termín",
  expediceNote: "Poznámka expedice",
  doprava: "Doprava",
  // Zařazení/pořadí v Expedici — jako samostatná pole propagovaná do split skupiny
  // (viz SPLIT_SHARED_FIELDS); běžná UPDATE editace je nemění přímo, ale dedikovaná
  // akce EXPEDITION_PUBLISH/EXPEDITION_UNPUBLISH ano (má vlastní popisek v UI).
  expeditionPublishedAt: "Zařazení do expedice",
  expeditionSortOrder: "Pořadí v expedici",
  pantoneRequiredDate: "Pantone datum",
  pantoneOk: "Pantone OK",
  pantoneRequired: "Pantone potřeba",
  // Barvy/lak nejsou v AUDITED_FIELDS běžné editace (historický dluh), ale JSOU
  // v SPLIT_SHARED_FIELDS, takže se mohou objevit v SPLIT_PROPAGATE řádcích.
  barvyStatusId: "Barvy stav ID",
  barvyStatusLabel: "Barvy stav",
  lakStatusId: "Lak stav ID",
  lakStatusLabel: "Lak stav",
  blockVariant: "Stav zakázky",
  obalka: "Obálka",
  vnitrky: "Vnitřky",
  tiskoveArchy: "Tiskové archy",
  serie: "Série",
  type: "Typ záznamu",
  orderNumber: "Číslo zakázky",
  description: "Popis",
  specifikace: "Specifikace",
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
  // pantoneOk sem patří sémanticky ke dataOk/materialOk („X potvrzeno OK"), ne
  // k pantoneRequired („je Pantone vůbec potřeba"). Bez téhle větve se řádek
  // v historii vykreslil jako syrové true/false (doplněno 8/2026).
  if (field === "dataOk" || field === "materialOk" || field === "pantoneOk" || field === "pantoneRequired") return val === "true" ? "✓ OK" : "✗ Ne";
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

/**
 * Marker prefix `field` sloupce AuditLog pro UNDO/REDO řádek, který v JEDNOM
 * kroku obnovil pozici I business pole zároveň (fix round 1, etapa A
 * atomického undo — review upozornila, že binární klasifikace „buď span,
 * nebo seznam polí" u smíšeného zápisu seznam vrácených polí tiše ztrácela).
 *
 * oldValue/newValue u smíšeného řádku zůstávají ČISTÝ span — stejný tvar
 * jako u ryze pozičního řádku (undoApply.server.ts), takže žádné volání
 * `fmtAuditVal`/`span` parsování nepotřebuje zvlášť ošetřovat. Jediné volné
 * místo pro dynamický seznam navíc vrácených business polí je tak samotné
 * `field` (`VARCHAR(191)` — proto ořez přes `truncateUtf8` na straně writeru).
 *
 * Konstanta i `classifyUndoRedoField` níž jsou sdílené mezi writerem
 * (`undoApply.server.ts`) a oběma renderery (`InfoPanel.tsx`, `BlockDetail.tsx`),
 * ať nemůžou rozjet vlastní kopii stringu/parsovací logiky.
 */
export const UNDO_MIXED_FIELD_PREFIX = "startTime/endTime/machine+fields:";

export type UndoRedoFieldKind =
  | { kind: "position" }
  | { kind: "fields"; keys: string[] }
  | { kind: "mixed"; keys: string[] };

/**
 * Rozklíčuje `field`+`newValue` UNDO/REDO auditního řádku (`undoApply.server.ts`)
 * na to, co se má vykreslit:
 * - `"position"` — čistě poziční obnova, oldValue/newValue je span (vykresli jako dnes).
 * - `"fields"` — čistě obchodní obnova, `newValueForFieldsCase` nese seznam klíčů
 *   (ne span) oddělený ", " — pozice se vůbec neobnovila.
 * - `"mixed"` — obojí zároveň: oldValue/newValue je span JAKO U `"position"`, `keys`
 *   navíc nese seznam obnovených business polí (vykresli span I seznam v jednom řádku).
 *
 * `newValueForFieldsCase` slouží JEN případu `"fields"` — u `"position"`/`"mixed"`
 * volající span čte přímo z oldValue/newValue beze změny, tenhle parametr se ignoruje.
 */
export function classifyUndoRedoField(field: string | null, newValueForFieldsCase: string | null): UndoRedoFieldKind {
  if (field === "fields") {
    return { kind: "fields", keys: newValueForFieldsCase ? newValueForFieldsCase.split(", ") : [] };
  }
  if (field != null && field.startsWith(UNDO_MIXED_FIELD_PREFIX)) {
    const rest = field.slice(UNDO_MIXED_FIELD_PREFIX.length);
    return { kind: "mixed", keys: rest.length > 0 ? rest.split(", ") : [] };
  }
  return { kind: "position" };
}

export function formatPragueMaybeToday(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const isToday = utcToPragueDateStr(d) === todayPragueDateStr();
  const time = formatPragueTime(d);
  return isToday ? time : `${formatPragueDateShort(d)} ${time}`;
}
