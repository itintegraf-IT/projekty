import { formatPragueDateTimeWithWeekday } from "./dateUtils";
import { FIELD_LABELS, fmtAuditVal } from "./auditFormatters";
import { serializeAuditValue } from "./blockSerialization";
import { formatPrintHoursShort } from "./printTimeClient";

type Row = Record<string, unknown>;

/**
 * Sloupce, které mají v historii VLASTNÍ větu („Přesunuto z…", „Zamčeno"),
 * ne obecné „popisek: staré → nové". Slouží i strážnému testu, který porovnává
 * zařazení všech sloupců `Block` proti `prisma/schema.prisma`.
 */
export const REVISION_LINE_COLUMNS = [
  "machine",
  "startTime",
  "endTime",
  "printMinutes",
  "locked",
  "scheduleBypassed",
] as const;

/**
 * Sloupce `Block`, které se do panelu historie ZÁMĚRNĚ nepromítají — klíč je
 * jméno sloupce, hodnota je důvod. Důvod žije v kódu, ne jen v reportu: bez něj
 * by příští čtenář nepoznal rozdíl mezi „rozhodli jsme se to nezobrazovat"
 * a „zapomnělo se na to".
 *
 * Pravidlo, podle kterého se rozhodovalo: sloupec smí zmizet z historie jen
 * tehdy, když čtenáři TÝŽ fakt sdělí něco jiného (auditní řádek na téže cestě,
 * nebo jiná věta ve stejné revizi), nebo když jeho hodnota nenese pro plánovače
 * žádnou informaci (vnitřní identifikátor).
 *
 * Přeskočení vyhrává nad `FIELD_LABELS` — pět `*Id` sloupců tam popisek má,
 * ale do historie patří čitelný popisek, ne interní číslo (totéž pravidlo drží
 * `splitPropagateAudit.ts` u řádků SPLIT_PROPAGATE).
 */
export const REVISION_SKIPPED_COLUMNS: Record<string, string> = {
  id: "Identita řádku — obě strany rozdílu jsou týž blok, ve výsledku se objevit nemůže.",
  createdAt: "Nastaví se při vzniku bloku a už se nemění; vznik pokrývá auditní akce CREATE.",
  updatedAt: "Do rozdílu se nedostane vůbec — `computeRevisionDiff` ho vylučuje (verze je v BlockRevision.rowVersion).",
  splitGroupId:
    "Interní členství ve split skupině — číslo skupiny čtenáři nic neříká, rozdělení bloku je v historii vidět jako vznik nových bloků (CREATE).",
  reservationId:
    "Interní cizí klíč na rezervaci; překlopení rezervace na zakázku je vidět přes `type` a `orderNumber` (obojí auditované i s popiskem).",
  recurrenceType:
    "Vnitřní vazba série opakování; nastaví se při vzniku (pokrývá CREATE) a mění se jen jako důsledek smazání rodiče série, které má vlastní záznam u rodičovského bloku.",
  recurrenceParentId:
    "Totéž co recurrenceType — id rodiče série je pro plánovače nečitelné a vyvázání je důsledek operace nad JINÝM blokem.",
  printCompletedAt:
    "Potvrzení/vrácení tisku má vlastní auditní akci (PRINT_COMPLETE / PRINT_UNDO / PRINT_RESET), která čtenáři řekne totéž srozumitelněji.",
  printCompletedByUserId: "Vnitřní id uživatele; kdo tisk potvrdil, nese auditní řádek PRINT_COMPLETE.",
  printCompletedByUsername: "Doprovodné pole k printCompletedAt — vlastní řádek by byl duplicita auditní akce.",
  materialNoteByUsername:
    "Doprovodné pole k `materialNote` (ta popisek má) — samostatná věta o autorovi poznámky by byla jen šum vedle věty o poznámce.",
  dataStatusId: "Vnitřní id číselníku; čitelnou hodnotu nese dataStatusLabel.",
  materialStatusId: "Vnitřní id číselníku; čitelnou hodnotu nese materialStatusLabel.",
  barvyStatusId: "Vnitřní id číselníku; čitelnou hodnotu nese barvyStatusLabel.",
  lakStatusId: "Vnitřní id číselníku; čitelnou hodnotu nese lakStatusLabel.",
  jobPresetId: "Vnitřní id presetu; čitelnou hodnotu nese jobPresetLabel.",
};

const LINE_COLUMN_SET: ReadonlySet<string> = new Set<string>(REVISION_LINE_COLUMNS);

/**
 * Hodnota z rozdílu → `Date`. Přijímá OBOJÍ tvar záměrně: `computeRevisionDiff`
 * vrací `Date`, ale `BlockRevision.before/after` je Json sloupec, takže zpátky
 * z databáze (a tedy do panelu historie) přijde ISO ŘETĚZEC. Nečitelná hodnota
 * dá `null` — věta se pak nevypíše místo toho, aby se vypsala s „Invalid Date".
 */
function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function asMinutes(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Boolean stejně shovívavě jako `normalizeBlockRow` — MySQL TINYINT(1) chodí i jako 0/1. */
function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function machineText(value: unknown): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

/**
 * Hodnota obchodního pole ve stejném tvaru, v jakém ji vykresluje auditní řádek
 * o kus výš v témže panelu — proto přes `serializeAuditValue` + `fmtAuditVal`,
 * ne vlastním formátováním. Vlastní kopie by se s auditem časem rozešla a jeden
 * seznam by pak tvrdil „✓ OK" a druhý „true".
 */
function valueText(field: string, value: unknown): string {
  return fmtAuditVal(serializeAuditValue(field, value), field);
}

/**
 * Rozdíl revize → české řádky pro panel historie bloku.
 *
 * Vstup je rozdíl z `computeRevisionDiff` (jen skutečně změněné sloupce), po
 * odečtení sloupců, které už pokrývá auditní řádek (`suppressCoveredColumns`).
 * Funkce je čistá — žádná databáze, žádné odvozování, jen text.
 *
 * Sloupec bez zařazení se tiše přeskočí. Zařazení všech sloupců `Block` hlídá
 * strážný test proti `prisma/schema.prisma`, aby nový sloupec nepropadl mlčky
 * (přesně tahle třída selhání u `AUDITED_FIELDS` znemožnila rekonstrukci havárií
 * plánu z 5.–6. 8. 2026, kvůli kterým celá etapa vzniká).
 */
export function formatRevisionLines(before: Row, after: Row): string[] {
  const lines: string[] = [];

  const machineChanged = "machine" in after;
  const startChanged = "startTime" in after;
  const endChanged = "endTime" in after;
  const printMinutesChanged = "printMinutes" in after;

  const oldStart = asDate(before.startTime);
  const newStart = asDate(after.startTime);
  const oldEnd = asDate(before.endTime);
  const newEnd = asDate(after.endTime);

  // 1) POZICE. Změna stroje se slučuje se změnou začátku do JEDNÉ věty — je to
  //    jedno přetažení, ne dvě události.
  if (machineChanged) {
    const from = oldStart ? ` ${formatPragueDateTimeWithWeekday(oldStart)}` : "";
    const to = newStart ? ` ${formatPragueDateTimeWithWeekday(newStart)}` : "";
    lines.push(`Přesunuto z ${machineText(before.machine)}${from} na ${machineText(after.machine)}${to}`);
  } else if (startChanged && newStart) {
    const from = oldStart ? ` (z ${formatPragueDateTimeWithWeekday(oldStart)})` : "";
    lines.push(`Přesunuto na ${formatPragueDateTimeWithWeekday(newStart)}${from}`);
  }

  const moved = machineChanged || startChanged;

  // 2) DÉLKA. `printMinutes` má vlastní větu jen tam, kde by jinak nezaznělo nic —
  //    když se změnil i konec, je to TÁŽ událost a stačí jedna věta.
  //
  //    Verdikt „prodlouženo/zkráceno" se z koncových časů smí odvodit JEN u bloku,
  //    který se nehnul. U posunutého bloku by lhal dvakrát: posun o tři dny dopředu
  //    dá pozdější konec i u zkráceného bloku, a týž blok přeložený na jiný den se
  //    v absolutním čase roztáhne o noční pauzu, aniž by se tisklo o minutu déle
  //    (tiskové hodiny). Pravdu o délce nese u zakázek `printMinutes`; když v rozdílu
  //    není, délka se nezměnila a žádná věta o ní se nepíše.
  if (!moved && endChanged && oldEnd && newEnd && newEnd.getTime() !== oldEnd.getTime()) {
    const verb = newEnd.getTime() > oldEnd.getTime() ? "Prodlouženo" : "Zkráceno";
    lines.push(
      `${verb} do ${formatPragueDateTimeWithWeekday(newEnd)} (z ${formatPragueDateTimeWithWeekday(oldEnd)})`,
    );
  } else if (printMinutesChanged) {
    const oldMinutes = asMinutes(before.printMinutes);
    const newMinutes = asMinutes(after.printMinutes);
    if (oldMinutes !== null && newMinutes !== null && oldMinutes !== newMinutes) {
      lines.push(`Délka tisku: ${formatPrintHoursShort(oldMinutes)} → ${formatPrintHoursShort(newMinutes)}`);
    }
  }

  // 3) ZÁMEK. Vlastní věta proto, že `locked` NENÍ v `AUDITED_FIELDS` — auditní
  //    řádek o zamčení nevzniká vůbec a revize je jediný záznam.
  if ("locked" in after) lines.push(asBool(after.locked) ? "Zamčeno" : "Odemčeno");

  // 4) ZNAČKA „ODLOŽENO MIMO PRACOVNÍ DOBU". Do 8/2026 byla mezi přeskočenými sloupci
  //    s odůvodněním „vnitřní příznak, mění se jako důsledek změny časů" — to přestalo
  //    platit: je to stav, který plánovač na kartě VIDÍ (štítek ⚠ KALENDÁŘ) a který se
  //    mění i bez jediné změny časů (tlačítko „Přepočítat" u zbytkové značky). Bez
  //    vlastní věty by po té změně v historii nezůstala žádná stopa — přesně ta třída
  //    slepého místa, kvůli které revize vznikly.
  if ("scheduleBypassed" in after) {
    lines.push(
      asBool(after.scheduleBypassed)
        ? "Označeno jako odložené mimo pracovní dobu"
        : "Zrušeno označení „odložené mimo pracovní dobu“",
    );
  }

  // 5) OBCHODNÍ POLE. Popisek se bere z téhož `FIELD_LABELS`, jaký používají
  //    auditní řádky ve stejném panelu. Není to jen pohodlí: `description`,
  //    `specifikace`, `barvyStatusLabel` ani `lakStatusLabel` v `AUDITED_FIELDS`
  //    nejsou, takže o jejich změně nevzniká auditní řádek a revize je jediné
  //    místo, kde je vidět.
  for (const key of Object.keys(after)) {
    if (LINE_COLUMN_SET.has(key)) continue;
    if (key in REVISION_SKIPPED_COLUMNS) continue;
    const label = FIELD_LABELS[key];
    if (!label) continue;
    lines.push(`${label}: ${valueText(key, before[key])} → ${valueText(key, after[key])}`);
  }

  return lines;
}
