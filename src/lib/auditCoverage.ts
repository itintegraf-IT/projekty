import { classifyUndoRedoField } from "@/lib/auditFormatters";
import { isRestorableField } from "@/lib/undo/restoreFields";

/**
 * Které sloupce `Block` už pokrývá auditní řádek — tedy pro které NEMÁ panel
 * historie vykreslovat revizní řádek navíc.
 *
 * Potlačuje se po SLOUPCÍCH, ne po řádcích: jeden PUT z BlockEditu nese zároveň
 * obchodní pole (auditovaná) i změnu délky (neauditovanou). Potlačení po řádcích
 * by tu poziční změnu zahodilo — přesně tu, kvůli které se revize zavádějí.
 *
 * Žije vedle `AUDITED_FIELDS` (`src/lib/auditedFields.ts`) jako jediný zdroj pravdy
 * o tom, co který auditní řádek čtenáři už řekl. Když přibude nová hodnota
 * `AuditLog.action` nebo nový tvar `.field`, MUSÍ přibýt i sem — hlídají to strážné
 * testy v `auditCoverage.test.ts`, které skenují zdrojáky a `RevisionAction`.
 *
 * ## Proč signatura bere celý řádek, a ne jen `(action, field)`
 *
 * Brief navrhoval `coveredColumns(action, field)`. To NESTAČÍ: undo/redo zapisuje
 * seznam vrácených sloupců do `newValue`, ne do `field` (tvar `field: "fields"`,
 * `newValue: "dataOk, materialNote"`). Bez `newValue` by mapa u každého čistě
 * obchodního Ctrl+Z vrátila prázdno a panel by tytéž změny vykreslil dvakrát.
 *
 * Objektový parametr (ne tři poziční argumenty) proto, že:
 *  - všechny tři složky jsou `string | null`, takže poziční API by šlo tiše prohodit;
 *  - volající v panelu iteruje přímo řádky `AuditLog`, které tyhle tři klíče už mají,
 *    takže se předává celý řádek beze změny tvaru;
 *  - `newValue` je POVINNÉ (ne `?`), aby TypeScript vynutil jeho předání. Volitelné
 *    pole by při zapomenutí propadlo na `undefined` a vyrobilo přesně tu duplicitu,
 *    kvůli které tahle mapa vzniká.
 *
 * ## Směr chyby je zvolený vědomě
 *
 * Neznámá kombinace vrací `[]` (= „nepokrývá nic"), nikdy `"ALL"`. Nadbytečný
 * revizní řádek je nanejvýš duplicita, kterou čtenář vidí; falešné „ALL" by změnu
 * z historie SCHOVALO. Totéž platí pro uťatý seznam klíčů níž.
 */
export type AuditCoverageRow = {
  /** `AuditLog.action` — co se stalo s řádkem. NENÍ to `RevisionAction` (jiný slovník). */
  action: string;
  /** `AuditLog.field` — jméno sloupce, složený tvar, nebo marker undo/redo. */
  field: string | null;
  /** `AuditLog.newValue` — u tvaru `field: "fields"` nese SEZNAM vrácených sloupců. */
  newValue: string | null;
};

/**
 * Trojice, kterou jmenuje poziční undo/redo řádek. `printMinutes`/`scheduleBypassed`
 * tu ZÁMĚRNĚ nejsou: `op.fields` je sice nese vždy (viz `POSITION_FIELD_KEYS`
 * v `undoApply.server.ts`), auditní řádek o nich ale nic netvrdí — v hodnotách je
 * jen span start–end. Zrovna ztracená informace o délce tisku je důvod, proč
 * revize vznikají, takže ji tahle mapa nesmí prohlásit za pokrytou.
 */
const UNDO_POSITION_COLUMNS = ["startTime", "endTime", "machine"] as const;

/** Složené hodnoty `field`, které v jednom řádku jmenují víc sloupců. */
const COMPOSITE_FIELDS: Record<string, readonly string[]> = {
  "startTime/endTime": ["startTime", "endTime"],
  // Legacy dávkový formát (198 řádků v dev DB), než ho `batchAuditRows.ts` rozdělil
  // na `startTime/endTime` + samostatné `machine`. Panel ty řádky čte dál.
  "startTime/endTime/machine": ["startTime", "endTime", "machine"],
};

const PRINT_COLUMNS = ["printCompletedAt", "printCompletedByUserId", "printCompletedByUsername"] as const;
const EXPEDITION_COLUMNS = ["expeditionPublishedAt", "expeditionSortOrder"] as const;

/**
 * Akce, jejichž záběr určuje AKCE SAMA, ne `field` — čtenáři je z popisku jasné,
 * co se stalo („Potvrzení tisku", „Zařazení do expedice"), i když auditní řádek
 * jednotlivé sloupce nejmenuje.
 */
const ROW_LEVEL_ACTIONS: Record<string, readonly string[] | "ALL"> = {
  CREATE: "ALL",
  DELETE: "ALL",
  // Obě expediční pole se v každé cestě zapisují společně (publish i unpublish,
  // včetně auto-unpublish z PUT bloku).
  EXPEDITION_PUBLISH: EXPEDITION_COLUMNS,
  EXPEDITION_UNPUBLISH: EXPEDITION_COLUMNS,
  // Směry jsou samostatné hodnoty schválně — panel podle nich rozliší potvrzení
  // od vrácení tisku (recenze 8. 8. 2026, K5).
  PRINT_COMPLETE: PRINT_COLUMNS,
  PRINT_UNDO: PRINT_COLUMNS,
  // LEGACY: dnešní kód akci nepíše, v DB leží (2 řádky v dev, `field:
  // "printCompletedAt"`). Trojice se odjakživa zapisuje pohromadě, takže „reset
  // tisku" vysvětluje všechny tři sloupce — parita s dvojicí výše.
  PRINT_RESET: PRINT_COLUMNS,
  // Poznámky mění `BlockNote`, žádný sloupec `Block`. Nepokrývají tedy nic — a je
  // to vypsané, ne ponechané na výchozí větvi, aby bylo vidět, že se na ně myslelo.
  NOTE_CREATE: [],
  NOTE_UPDATE: [],
  NOTE_DELETE: [],
  // LEGACY bez vazby na sloupce Blocku (dev DB: 1 + 1 řádek).
  RESERVATION_NOTIFY: [],
  CASCADE_DELETE_SHIFT_ASSIGNMENTS: [],
};

/** Akce, u kterých záběr určuje `field` (jméno sloupce nebo složený tvar). */
const FIELD_DRIVEN_ACTIONS: ReadonlySet<string> = new Set([
  "UPDATE",
  "SPLIT_PROPAGATE",
  "AUTO_SHIFT",
  // `field` je vždy "startTime/endTime" — `printMinutes` reflow NEMĚNÍ, jen
  // z nich znovu dopočítá konec (`reflow.server.ts`). Brief tu sliboval
  // printMinutes navíc; podle kódu by to schovalo skutečnou změnu délky.
  "AUTO_REFLOW",
  // Servisní skript `scripts/fix-existing-overlaps.ts` (`field: "startTime"`).
  "OVERLAP_FIX",
]);

/** Akce s vlastním rozborem `field`+`newValue` (pět tvarů, viz `coveredColumns`). */
const UNDO_ACTIONS: ReadonlySet<string> = new Set(["UNDO", "REDO"]);

/**
 * Všechny hodnoty `AuditLog.action`, na které má mapa odpověď. Slouží strážnému
 * testu, který sken zdrojáků porovná s tímhle seznamem.
 */
export const KNOWN_AUDIT_ACTIONS: ReadonlySet<string> = new Set([
  ...Object.keys(ROW_LEVEL_ACTIONS),
  ...FIELD_DRIVEN_ACTIONS,
  ...UNDO_ACTIONS,
]);

/**
 * Hodnoty `RevisionAction`, ke kterým NEVZNIKÁ žádný auditní řádek — popisují jen
 * mutační cestu (`withRevision`), ne zápis do `AuditLog`.
 *
 * `EXPEDITION_REORDER` je mezi nimi ten podstatný: větev `reorder`
 * v `src/app/api/blocks/[id]/expedition/route.ts` volá jen `block.updateMany`
 * a auditLog NEVOLÁ vůbec. Mapa u něj nemá co pokrývat a revize se musí zobrazit
 * CELÁ — jinak by změna pořadí v expedici zmizela z historie beze stopy.
 * `BATCH`/`SPLIT`/`REFLOW` auditní stopu mají, ale pod jinými hodnotami
 * (`UPDATE`, `CREATE`, `AUTO_SHIFT`, `AUTO_REFLOW`) — vokabuláře obou tabulek
 * se nemíchají.
 */
export const REVISION_ONLY_ACTIONS = ["BATCH", "SPLIT", "REFLOW", "EXPEDITION_REORDER"] as const;

/**
 * Sloupce vyjmenované v seznamu klíčů undo/redo řádku.
 *
 * Filtr přes `isRestorableField` řeší ORŘEZ: `field` smíšeného tvaru se u writeru
 * ořezává na 180 bajtů (`undoApply.server.ts`), takže poslední jméno sloupce může
 * skončit uprostřed („…, materialStatusLab"). Rozseknutý zbytek se pozná spolehlivě
 * podle toho, že NENÍ v `UNDO_RESTORABLE_FIELDS` — a to je přesná kontrola, ne odhad:
 * `sanitizeUndoOps` každý klíč, který se do seznamu může dostat, proti témuž
 * allow-listu ověřuje ještě před zápisem.
 *
 * Následek: klíč, který ořez uťal, zůstane nepokrytý a panel u něj ukáže revizní
 * řádek navíc. To je zvolený směr chyby — duplicita je vidět, schovaná změna ne.
 * (Měřit místo toho délku `field` proti 180 bajtům by uťalo i klíč, který se do
 * limitu vešel přesně, a navíc by si sem zkopírovalo konstantu ze serverového
 * modulu, který tenhle klientský soubor importovat nesmí.)
 */
function restorableKeys(keys: string[]): string[] {
  return keys.filter((key) => isRestorableField(key));
}

/**
 * Sloupce `Block`, které daný auditní řádek čtenáři už sdělil.
 *
 * `"ALL"` znamená „celý řádek" (vznik/zánik bloku) — pro takový záznam nemá panel
 * vykreslovat žádný revizní řádek.
 *
 * Vrací vždy NOVÉ pole: volající si výsledek běžně řadí `.sort()`, což by na
 * sdílené konstantě přerovnalo mapu všem dalším voláním.
 */
export function coveredColumns({ action, field, newValue }: AuditCoverageRow): string[] | "ALL" {
  // 1. UNDO/REDO musí jít PŘED rozborem `field` — jeho `field` nenese jméno sloupce,
  //    ale marker („delete"/"restore"/"fields") nebo pozici se seznamem za prefixem.
  if (UNDO_ACTIONS.has(action)) {
    // Blok jako celek zmizel / se vrátil — jednotlivé sloupce nemá smysl rozepisovat.
    if (field === "delete" || field === "restore") return "ALL";

    // Rozbor tvaru je sdílený s renderery (`InfoPanel`, `BlockDetail`) — vlastní
    // kopie parsování prefixu by se s writerem časem rozešla.
    const kind = classifyUndoRedoField(field, newValue);
    if (kind.kind === "fields") return restorableKeys(kind.keys);
    if (kind.kind === "mixed") return [...UNDO_POSITION_COLUMNS, ...restorableKeys(kind.keys)];
    // `classifyUndoRedoField` vrací "position" i pro cokoliv neznámého, takže tvar
    // ověřujeme sami — neznámý budoucí marker nesmí dostat pozici zadarmo.
    return field === "startTime/endTime/machine" ? [...UNDO_POSITION_COLUMNS] : [];
  }

  // 2. Akce, jejichž záběr plyne z akce samotné.
  const rowLevel = ROW_LEVEL_ACTIONS[action];
  if (rowLevel !== undefined) return rowLevel === "ALL" ? "ALL" : [...rowLevel];

  // 3. Akce řízené `field`em.
  if (FIELD_DRIVEN_ACTIONS.has(action) && field) {
    const composite = COMPOSITE_FIELDS[field];
    return composite ? [...composite] : [field];
  }

  // 4. Neznámá kombinace — nepokrývá nic, revize se ukáže celá.
  return [];
}
