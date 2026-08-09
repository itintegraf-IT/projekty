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
  // Složené názvy, které do `field` píší hromadné cesty (batch, PUT s přesunem
  // na jiný stroj, undo). Bez popisku se v historii ukazovaly syrově jako
  // „startTime/endTime/machine:" — nález z proklikávání na produkčních datech
  // 9. 8. 2026. Klíč je celý řetězec včetně lomítek, ne jednotlivá pole.
  "startTime/endTime": "Čas",
  "startTime/endTime/machine": "Čas a stroj",
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
  // Volitelně s předsazeným strojem ("XL_106 <ISO>–<ISO>"): tak ho píšou cesty,
  // kde se spolu s časem měnil i stroj. Bez téhle větve řádek propadl až na
  // `return val` a v historii svítil syrový ISO čas (nález z proklikávání
  // na produkčních datech 9. 8. 2026).
  //
  // Guard MUSÍ zůstat striktní ISO tvar: new Date() je benevolentní a český
  // free-text („dodávka 1–2") by se jinak mis-formátoval na data — server píše
  // výhradně toISOString(). Prefix se strojem se proto přijme jen tehdy, když po
  // něm následuje ISO datum; „Praha 1–2" tudy neprojde.
  if (val.includes("–")) {
    const ISO = /^\d{4}-\d{2}-\d{2}T/;
    const [rawA, rawB] = val.split("–");
    if (rawA && rawB) {
      const machineSplit = /^(\S+)\s+(\d{4}-\d{2}-\d{2}T.*)$/.exec(rawA.trim());
      const a = machineSplit ? machineSplit[2] : rawA.trim();
      const b = rawB.trim();
      const prefix = machineSplit ? `${machineSplit[1]} ` : "";
      if (ISO.test(a) && ISO.test(b)) {
        const da = new Date(a);
        const db = new Date(b);
        if (!Number.isNaN(da.getTime()) && !Number.isNaN(db.getTime())) {
          return `${prefix}${formatPragueDateTime(da)} – ${formatPragueDateTime(db)}`;
        }
      }
    }
  }
  // Samostatné ISO datum. Guard MUSÍ být striktní ISO tvar, ne pouhé `val.includes("T")`:
  // `new Date()` je extrémně benevolentní a běžný český text jí projde jako datum —
  // ověřeno v Node: „Tisk 4" → 1. 4. 2001, „Teplice 2" → 1. 2. 2001,
  // „TISK 2000" → 1. 1. 2000, „Tiskarna 12" → 1. 12. 2001. V polygrafické firmě je
  // „Tisk…" jedno z nejčastějších slov v popisu zakázky, takže se v historii místo
  // popisu ukazovalo smyšlené datum z roku 2001. Psavci píšou výhradně
  // `toISOString()`, takže striktní tvar nic legitimního neodřízne.
  // Nález z proklikávání na produkčních datech 9. 8. 2026 (popis „TEST 2" se
  // v historii zobrazil jako „01. 02. 2001 01:00").
  if (/^\d{4}-\d{2}-\d{2}T/.test(val)) {
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
