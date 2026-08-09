import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIELD_LABELS } from "./auditFormatters";
import {
  formatRevisionLines,
  REVISION_LINE_COLUMNS,
  REVISION_SKIPPED_COLUMNS,
} from "./revisionFormat";

const T = (iso: string) => new Date(iso);

// ---------------------------------------------------------------------------
// Testy z briefu (Task 11, Step 2) — beze změny znění asercí.
// ---------------------------------------------------------------------------

test("změna stroje i času → jeden řádek s oběma stroji", () => {
  const lines = formatRevisionLines(
    { machine: "XL_105", startTime: T("2026-08-08T12:00:00Z") },
    { machine: "XL_106", startTime: T("2026-08-11T04:00:00Z") },
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Přesunuto z XL_105 .* na XL_106 /);
});

test("změna jen času → „Přesunuto na“", () => {
  const lines = formatRevisionLines(
    { startTime: T("2026-08-08T12:00:00Z") },
    { startTime: T("2026-08-11T04:00:00Z") },
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Přesunuto na /);
});

test("prodloužení konce → „Prodlouženo“", () => {
  const lines = formatRevisionLines(
    { endTime: T("2026-08-08T14:00:00Z") },
    { endTime: T("2026-08-08T16:00:00Z") },
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Prodlouženo do /);
});

test("zkrácení konce → „Zkráceno“", () => {
  const lines = formatRevisionLines(
    { endTime: T("2026-08-08T16:00:00Z") },
    { endTime: T("2026-08-08T13:00:00Z") },
  );
  assert.match(lines[0], /^Zkráceno do /);
});

test("printMinutes se slučuje do řádku o délce, nevytváří vlastní", () => {
  const lines = formatRevisionLines(
    { endTime: T("2026-08-08T14:00:00Z"), printMinutes: 480 },
    { endTime: T("2026-08-08T16:00:00Z"), printMinutes: 600 },
  );
  assert.equal(lines.length, 1);
});

test("zámek", () => {
  assert.deepEqual(formatRevisionLines({ locked: false }, { locked: true }), ["Zamčeno"]);
  assert.deepEqual(formatRevisionLines({ locked: true }, { locked: false }), ["Odemčeno"]);
});

test("sloupec bez popisku se tiše přeskočí", () => {
  assert.deepEqual(formatRevisionLines({ splitGroupId: null }, { splitGroupId: 7 }), []);
});

test("přechod letního času — konec října", () => {
  const lines = formatRevisionLines(
    { startTime: T("2026-10-24T06:00:00Z") },
    { startTime: T("2026-10-26T06:00:00Z") },
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /7:00/, "26. 10. je po přechodu, UTC 06:00 je 7:00 pražského času");
});

// ---------------------------------------------------------------------------
// Doplňkové testy — případy, které brief nepokrýval, ale reálný rozdíl je vyrobí.
// ---------------------------------------------------------------------------

test("přechod letního času — konec března (UTC 06:00 je po přechodu 8:00)", () => {
  const lines = formatRevisionLines(
    { startTime: T("2026-03-27T06:00:00Z") },
    { startTime: T("2026-03-30T06:00:00Z") },
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Přesunuto na po 30\. 3\. 08:00 \(z pá 27\. 3\. 07:00\)$/);
});

test("celé znění vět (regresní otisk formátu)", () => {
  assert.deepEqual(
    formatRevisionLines(
      { machine: "XL_105", startTime: T("2026-08-08T12:00:00Z") },
      { machine: "XL_106", startTime: T("2026-08-11T04:00:00Z") },
    ),
    ["Přesunuto z XL_105 so 8. 8. 14:00 na XL_106 út 11. 8. 06:00"],
  );
  assert.deepEqual(
    formatRevisionLines({ startTime: T("2026-08-08T12:00:00Z") }, { startTime: T("2026-08-11T04:00:00Z") }),
    ["Přesunuto na út 11. 8. 06:00 (z so 8. 8. 14:00)"],
  );
  assert.deepEqual(
    formatRevisionLines({ endTime: T("2026-08-08T14:00:00Z") }, { endTime: T("2026-08-08T16:00:00Z") }),
    ["Prodlouženo do so 8. 8. 18:00 (z so 8. 8. 16:00)"],
  );
});

test("změna jen stroje (start beze změny) → věta bez času a bez koncové mezery", () => {
  assert.deepEqual(formatRevisionLines({ machine: "XL_105" }, { machine: "XL_106" }), [
    "Přesunuto z XL_105 na XL_106",
  ]);
});

test("posun celého bloku (start i konec o týž interval) NENÍ prodloužení", () => {
  // Běžný drag: start i konec se posunou o 2 hodiny. Věta „Prodlouženo" by tu
  // lhala — délka se nezměnila, blok se jen přesunul.
  const lines = formatRevisionLines(
    { startTime: T("2026-08-08T06:00:00Z"), endTime: T("2026-08-08T14:00:00Z") },
    { startTime: T("2026-08-08T08:00:00Z"), endTime: T("2026-08-08T16:00:00Z") },
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Přesunuto na /);
});

test("posun přes pauzu směny (konec se protáhl, tiskové minuty stejné) NENÍ prodloužení", () => {
  // Tiskové hodiny: týž blok na jiném dni prochází noční pauzou, takže se ROZTÁHNE
  // v absolutním čase, ale vytištěných minut je stejně. Pravdu o délce nese
  // `printMinutes`, ne rozdíl koncových časů — a ten v rozdílu vůbec není.
  const lines = formatRevisionLines(
    { startTime: T("2026-08-08T06:00:00Z"), endTime: T("2026-08-08T14:00:00Z") },
    { startTime: T("2026-08-10T06:00:00Z"), endTime: T("2026-08-11T04:00:00Z") },
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Přesunuto na /);
});

test("přesun SPOLU se změnou délky tisku → dvě věty", () => {
  const lines = formatRevisionLines(
    { startTime: T("2026-08-08T06:00:00Z"), endTime: T("2026-08-08T14:00:00Z"), printMinutes: 480 },
    { startTime: T("2026-08-09T06:00:00Z"), endTime: T("2026-08-09T16:00:00Z"), printMinutes: 600 },
  );
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Přesunuto na /);
  assert.equal(lines[1], "Délka tisku: 8h → 10h");
});

test("samotné printMinutes (poziční undo, časy odečetl audit) → vlastní věta", () => {
  // Poziční UNDO/REDO pokrývá auditním řádkem jen startTime/endTime
  // (`auditCoverage.ts`), takže po odečtení zbude v rozdílu právě printMinutes.
  // Bez téhle věty by celá revize zmizela z panelu.
  assert.deepEqual(formatRevisionLines({ printMinutes: 480 }, { printMinutes: 600 }), [
    "Délka tisku: 8h → 10h",
  ]);
});

test("hodnoty po round-tripu přes JSON sloupec (data jako ISO řetězce) dávají TÝŽ výsledek", () => {
  // `BlockRevision.before/after` je Json sloupec — Date se do něj uloží jako ISO
  // řetězec a takhle se taky přečte. Task 12 tedy formátovači předá ŘETĚZCE,
  // ne Date. Kdyby to funkce neuměla, panel by po nasazení nezobrazil nic.
  const asDates = formatRevisionLines(
    { machine: "XL_105", startTime: T("2026-08-08T12:00:00Z"), deadlineExpedice: null },
    { machine: "XL_106", startTime: T("2026-08-11T04:00:00Z"), deadlineExpedice: T("2026-08-12T00:00:00Z") },
  );
  const asJson = formatRevisionLines(
    { machine: "XL_105", startTime: "2026-08-08T12:00:00.000Z", deadlineExpedice: null },
    { machine: "XL_106", startTime: "2026-08-11T04:00:00.000Z", deadlineExpedice: "2026-08-12T00:00:00.000Z" },
  );
  assert.deepEqual(asJson, asDates);
  assert.deepEqual(asJson, [
    "Přesunuto z XL_105 so 8. 8. 14:00 na XL_106 út 11. 8. 06:00",
    "Expedice termín: — → 12. 08. 2026",
  ]);
});

test("obchodní pole bez auditního řádku (Popis, Specifikace) se v historii objeví", () => {
  // `description` ani `specifikace` NEJSOU v AUDITED_FIELDS — auditní řádek
  // o nich nevzniká vůbec, revize je jediný záznam. Tiché přeskočení by je
  // ztratilo nadobro.
  assert.deepEqual(formatRevisionLines({ description: "Katalog jaro" }, { description: "Katalog léto" }), [
    "Popis: Katalog jaro → Katalog léto",
  ]);
  assert.deepEqual(formatRevisionLines({ specifikace: null }, { specifikace: "4/4 CMYK" }), [
    "Specifikace: — → 4/4 CMYK",
  ]);
});

test("hodnoty se vykreslují stejně jako na auditním řádku (boolean, JSON pole, datum)", () => {
  assert.deepEqual(formatRevisionLines({ dataOk: false }, { dataOk: true }), ["DATA OK: ✗ Ne → ✓ OK"]);
  assert.deepEqual(formatRevisionLines({ obalka: false }, { obalka: true }), ["Obálka: ✗ Ne → ✓ Ano"]);
  assert.deepEqual(
    formatRevisionLines({ tiskoveArchy: '["A1"]' }, { tiskoveArchy: '["A1","A2"]' }),
    ["Tiskové archy: A1 → A1, A2"],
  );
  assert.deepEqual(
    formatRevisionLines({ materialRequiredDate: null }, { materialRequiredDate: T("2026-08-12T00:00:00Z") }),
    ["Materiál datum: — → 12. 08. 2026"],
  );
});

test("vnitřní identifikátor číselníku se přeskočí, i když popisek v FIELD_LABELS má", () => {
  // `dataStatusId` v FIELD_LABELS je („DATA stav ID"), ale do historie patří
  // čitelný popisek, ne interní id — stejné pravidlo, jaké drží
  // `splitPropagateAudit.ts` u SPLIT_PROPAGATE řádků.
  assert.deepEqual(formatRevisionLines({ dataStatusId: 3 }, { dataStatusId: 5 }), []);
  assert.deepEqual(formatRevisionLines({ dataStatusLabel: "Čeká" }, { dataStatusLabel: "OK" }), [
    "DATA stav: Čeká → OK",
  ]);
});

test("pořadí vět: pozice, délka, zámek, obchodní pole", () => {
  const lines = formatRevisionLines(
    { startTime: T("2026-08-08T06:00:00Z"), printMinutes: 480, locked: false, doprava: "vlastní" },
    { startTime: T("2026-08-09T06:00:00Z"), printMinutes: 600, locked: true, doprava: "PPL" },
  );
  assert.deepEqual(lines, [
    "Přesunuto na ne 9. 8. 08:00 (z so 8. 8. 08:00)",
    "Délka tisku: 8h → 10h",
    "Zamčeno",
    "Doprava: vlastní → PPL",
  ]);
});

test("nečitelné datum nespadne a nevyrobí větu s otazníkem", () => {
  assert.deepEqual(formatRevisionLines({ startTime: "nesmysl" }, { startTime: "taky nesmysl" }), []);
  assert.deepEqual(formatRevisionLines({ endTime: "nesmysl" }, { endTime: "taky nesmysl" }), []);
});

test("prázdný rozdíl → žádná věta", () => {
  assert.deepEqual(formatRevisionLines({}, {}), []);
});

// ---------------------------------------------------------------------------
// Strážný test: KAŽDÝ sloupec Block musí být vědomě zařazen.
// ---------------------------------------------------------------------------

const testDir = dirname(fileURLToPath(import.meta.url));
test("scheduleBypassed: nastavení značky → česká věta", () => {
  const lines = formatRevisionLines({ scheduleBypassed: false }, { scheduleBypassed: true });
  assert.deepEqual(lines, ["Označeno jako odložené mimo pracovní dobu"]);
});

test("scheduleBypassed: zrušení značky → česká věta", () => {
  // Přesně tohle zapíše tlačítko „Přepočítat" u zbytkové značky, kde se nic nepohne —
  // bez věty by v historii nebyla po té změně ani stopa.
  const lines = formatRevisionLines({ scheduleBypassed: true }, { scheduleBypassed: false });
  assert.deepEqual(lines, ["Zrušeno označení „odložené mimo pracovní dobu“"]);
});

test("scheduleBypassed: MySQL TINYINT 0/1 se čte stejně jako boolean", () => {
  // Hodnota chodí z Json sloupce BlockRevision.after, kde po cestě přes MySQL
  // může být 0/1 místo false/true (týž důvod, proč existuje asBool).
  assert.deepEqual(formatRevisionLines({ scheduleBypassed: 0 }, { scheduleBypassed: 1 }), [
    "Označeno jako odložené mimo pracovní dobu",
  ]);
});

test("scheduleBypassed: věta o značce nepotlačí větu o přesunu", () => {
  // Přetažení do šrafování mění obojí naráz — v historii musí být obě věty.
  const lines = formatRevisionLines(
    { startTime: "2026-08-17T06:00:00.000Z", scheduleBypassed: false },
    { startTime: "2026-08-17T08:00:00.000Z", scheduleBypassed: true },
  );
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /^Přesunuto na /);
  assert.equal(lines[1], "Označeno jako odložené mimo pracovní dobu");
});

const schemaPath = join(testDir, "../../prisma/schema.prisma");

/** Skalární sloupce modelu Block ze schématu (relační pole = typ je jméno modelu). */
function scalarBlockColumns(schema: string): string[] {
  const models = new Set([...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]));
  const body = schema.match(/model Block \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(body, "model Block nenalezen v prisma/schema.prisma");
  const out: string[] = [];
  for (const line of body!.split("\n")) {
    const m = line.trim().match(/^(\w+)\s+(\w+)(\[\])?\??(\s|$)/);
    if (!m) continue;
    const [, field, type] = m;
    if (models.has(type)) continue; // relace
    out.push(field);
  }
  return out;
}

test("každý sloupec Block je buď větou, nebo popiskem, nebo vědomě přeskočený", () => {
  // Bez téhle kontroly by nový sloupec ve schématu tiše propadl do „nemá popisek,
  // přeskočit" a zmizel z historie — táž třída selhání jako AUDITED_FIELDS,
  // kvůli které nešly rekonstruovat havárie plánu z 5.–6. 8. 2026.
  const columns = scalarBlockColumns(readFileSync(schemaPath, "utf8"));
  assert.ok(columns.length > 40, `parser sloupců selhal, našel jen ${columns.length}`);

  const unclassified = columns.filter(
    (c) =>
      !(REVISION_LINE_COLUMNS as readonly string[]).includes(c) &&
      !(c in REVISION_SKIPPED_COLUMNS) &&
      !(c in FIELD_LABELS),
  );
  assert.deepEqual(
    unclassified,
    [],
    `Sloupec Block bez rozhodnutí: ${unclassified.join(", ")} — doplň větu do revisionFormat.ts, ` +
      "popisek do FIELD_LABELS, nebo důvod do REVISION_SKIPPED_COLUMNS.",
  );
});

test("seznamy v revisionFormat.ts nejmenují sloupec, který ve schématu není", () => {
  const columns = new Set(scalarBlockColumns(readFileSync(schemaPath, "utf8")));
  const phantom = [...REVISION_LINE_COLUMNS, ...Object.keys(REVISION_SKIPPED_COLUMNS)].filter(
    (c) => !columns.has(c),
  );
  assert.deepEqual(phantom, [], `Sloupec už ve schématu není: ${phantom.join(", ")}`);
});

test("sloupec s vlastní větou nesmí být zároveň přeskočený ani obecně popsaný", () => {
  // Dvojí zařazení = dvě věty o téže změně (nebo naopak tichý zánik té vlastní).
  for (const col of REVISION_LINE_COLUMNS) {
    assert.ok(!(col in REVISION_SKIPPED_COLUMNS), `${col} má vlastní větu i důvod k přeskočení`);
    assert.ok(!(col in FIELD_LABELS), `${col} má vlastní větu i obecný popisek v FIELD_LABELS`);
  }
});

test("každý přeskočený sloupec má v kódu napsaný důvod", () => {
  for (const [col, reason] of Object.entries(REVISION_SKIPPED_COLUMNS)) {
    assert.ok(reason.length > 10, `${col} nemá srozumitelný důvod přeskočení`);
  }
});
