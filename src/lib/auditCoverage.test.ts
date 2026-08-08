import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  coveredColumns,
  KNOWN_AUDIT_ACTIONS,
  REVISION_ONLY_ACTIONS,
  type AuditCoverageRow,
} from "@/lib/auditCoverage";
import { AUDITED_FIELDS } from "@/lib/auditedFields";
import { UNDO_MIXED_FIELD_PREFIX } from "@/lib/auditFormatters";
import { isRestorableField } from "@/lib/undo/restoreFields";

/** Zkratka — testy skoro nikdy nepotřebují všechna tři pole najednou. */
function row(action: string, field: string | null = null, newValue: string | null = null): AuditCoverageRow {
  return { action, field, newValue };
}

/** Výsledek jako SEŘAZENÉ pole; „ALL" propadne, aby ho asserce chytila jako rozdíl. */
function sorted(result: string[] | "ALL"): string[] | "ALL" {
  return result === "ALL" ? "ALL" : [...result].sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Běžná editace a propagace — `field` nese jméno sloupce
// ─────────────────────────────────────────────────────────────────────────────

test("UPDATE s názvem sloupce pokrývá právě ten sloupec", () => {
  assert.deepEqual(coveredColumns(row("UPDATE", "deadlineExpedice")), ["deadlineExpedice"]);
});

test("každé pole z AUDITED_FIELDS je pod UPDATE pokryté samo sebou", () => {
  // Vazba na jediný zdroj pravdy vedle: kdyby se mapa někdy přepsala na ruční
  // whitelist sloupců, tenhle test spadne na prvním poli, které do něj někdo
  // zapomene doplnit (přesně ta třída vady, kvůli které AUDITED_FIELDS vznikly
  // jako sdílená konstanta místo lokálního `const` v PUT handleru).
  for (const field of AUDITED_FIELDS) {
    assert.deepEqual(coveredColumns(row("UPDATE", field)), [field], `UPDATE/${field}`);
  }
});

test("SPLIT_PROPAGATE pokrývá propagovaný sloupec stejně jako přímá editace", () => {
  // Propagace do split sourozenců audituje PRŮNIK SPLIT_SHARED_FIELDS × AUDITED_FIELDS
  // (splitPropagateAudit.ts) — v historii má vypadat stejně jako přímá editace.
  assert.deepEqual(coveredColumns(row("SPLIT_PROPAGATE", "materialOk")), ["materialOk"]);
});

test("batch píše změnu stroje jako samostatný řádek s field=machine", () => {
  assert.deepEqual(coveredColumns(row("UPDATE", "machine")), ["machine"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Složená poziční pole
// ─────────────────────────────────────────────────────────────────────────────

test("AUTO_SHIFT pokrývá startTime i endTime", () => {
  assert.deepEqual(sorted(coveredColumns(row("AUTO_SHIFT", "startTime/endTime"))), ["endTime", "startTime"]);
});

test("AUTO_SHIFT po snapnutí nového bloku pokrývá jen startTime", () => {
  // POST /api/blocks píše při snapnutí startu `field: "startTime"` s ISO hodnotami —
  // endTime si server dopočítal, auditní řádek o něm nic netvrdí.
  assert.deepEqual(coveredColumns(row("AUTO_SHIFT", "startTime")), ["startTime"]);
});

test("AUTO_REFLOW pokrývá pozici, ale NE printMinutes", () => {
  // Brief sliboval ["startTime","endTime","printMinutes"], reflow.server.ts ale píše
  // `field: "startTime/endTime"` a `printMinutes` vůbec nemění (re-expanduje END
  // z NEZMĚNĚNÝCH tiskových minut). Kdyby mapa printMinutes tvrdila, panel by
  // skutečnou změnu tiskových minut z revize SCHOVAL — přesně to, kvůli čemu B1 vzniká.
  assert.deepEqual(sorted(coveredColumns(row("AUTO_REFLOW", "startTime/endTime"))), ["endTime", "startTime"]);
});

test("legacy složené pole se strojem pokrývá všechny tři", () => {
  // 198 řádků v dev DB: starý dávkový formát, než ho batchAuditRows.ts rozdělil
  // na `startTime/endTime` + `machine`. Panel je čte pořád.
  assert.deepEqual(
    sorted(coveredColumns(row("UPDATE", "startTime/endTime/machine"))),
    ["endTime", "machine", "startTime"],
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Akce popisující celý řádek
// ─────────────────────────────────────────────────────────────────────────────

test("CREATE a DELETE pokrývají celý řádek", () => {
  assert.equal(coveredColumns(row("CREATE")), "ALL");
  assert.equal(coveredColumns(row("DELETE")), "ALL");
});

test("EXPEDITION_PUBLISH i EXPEDITION_UNPUBLISH pokrývají expediční dvojici", () => {
  const expected = ["expeditionPublishedAt", "expeditionSortOrder"];
  assert.deepEqual(sorted(coveredColumns(row("EXPEDITION_PUBLISH"))), expected);
  assert.deepEqual(sorted(coveredColumns(row("EXPEDITION_UNPUBLISH"))), expected);
});

test("EXPEDITION_REORDER nepokrývá nic — auditní řádek pro něj vůbec nevzniká", () => {
  // Ověřeno v src/app/api/blocks/[id]/expedition/route.ts: větev `reorder` zapisuje
  // jen `block.updateMany` a NEVOLÁ auditLog vůbec. Revize se proto musí zobrazit celá,
  // jinak by změna pořadí v expedici z historie zmizela beze stopy.
  assert.deepEqual(coveredColumns(row("EXPEDITION_REORDER")), []);
});

test("PRINT_COMPLETE i PRINT_UNDO pokrývají trojici printCompleted*", () => {
  const expected = ["printCompletedAt", "printCompletedByUserId", "printCompletedByUsername"];
  assert.deepEqual(sorted(coveredColumns(row("PRINT_COMPLETE"))), expected);
  assert.deepEqual(sorted(coveredColumns(row("PRINT_UNDO"))), expected);
});

test("NOTE_* nepokrývají žádný sloupec Blocku — mění BlockNote", () => {
  for (const action of ["NOTE_CREATE", "NOTE_UPDATE", "NOTE_DELETE"]) {
    assert.deepEqual(coveredColumns(row(action)), [], action);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. UNDO / REDO — pět tvarů, seznam sloupců bývá v `newValue`, ne v `field`
// ─────────────────────────────────────────────────────────────────────────────

test("UNDO/REDO: field=delete pokrývá celý řádek", () => {
  assert.equal(coveredColumns(row("UNDO", "delete", null)), "ALL");
  assert.equal(coveredColumns(row("REDO", "delete", null)), "ALL");
});

test("UNDO/REDO: field=restore pokrývá celý řádek", () => {
  const span = "2026-09-02T04:00:00.000Z–2026-09-02T12:00:00.000Z";
  assert.equal(coveredColumns(row("UNDO", "restore", span)), "ALL");
  assert.equal(coveredColumns(row("REDO", "restore", span)), "ALL");
});

test("UNDO/REDO: čistě poziční obnova pokrývá trojici, NE printMinutes/scheduleBypassed", () => {
  // `op.fields` u poziční obnovy nese VŽDY celou pětici (POSITION_FIELD_KEYS
  // v undoApply.server.ts), auditní řádek ale jmenuje jen tři sloupce a v hodnotách
  // ukazuje pouhý span. printMinutes/scheduleBypassed se tedy musí ukázat z revize —
  // právě ta ztracená informace o délce je důvod, proč B1 vzniká.
  const span = "2026-09-02T04:00:00.000Z–2026-09-02T12:00:00.000Z";
  const result = coveredColumns(row("UNDO", "startTime/endTime/machine", span));
  assert.deepEqual(sorted(result), ["endTime", "machine", "startTime"]);
});

test("UNDO/REDO: field=fields bere seznam sloupců z newValue (v field nejsou vůbec)", () => {
  const result = coveredColumns(row("REDO", "fields", "dataOk, materialNote, pantoneOk"));
  assert.deepEqual(sorted(result), ["dataOk", "materialNote", "pantoneOk"]);
});

test("UNDO/REDO: field=fields s prázdným newValue nepokrývá nic", () => {
  // Writer zapíše newValue=null, když `otherKeys` vyjde prázdný.
  assert.deepEqual(coveredColumns(row("UNDO", "fields", null)), []);
});

test("UNDO/REDO: smíšený tvar pokrývá pozici I vyjmenované sloupce", () => {
  const field = `${UNDO_MIXED_FIELD_PREFIX}description, materialNote`;
  const span = "2026-09-02T04:00:00.000Z–2026-09-02T12:00:00.000Z";
  assert.deepEqual(
    sorted(coveredColumns(row("UNDO", field, span))),
    ["description", "endTime", "machine", "materialNote", "startTime"],
  );
});

test("UNDO/REDO: smíšený tvar s prázdným seznamem degraduje na čistou pozici", () => {
  const field = UNDO_MIXED_FIELD_PREFIX;
  assert.deepEqual(sorted(coveredColumns(row("UNDO", field, null))), ["endTime", "machine", "startTime"]);
});

test("UNDO/REDO: uťatý seznam klíčů nesmí propustit rozseknutý zbytek", () => {
  // Writer ořezává `field` na 180 BAJTŮ (undoApply.server.ts, rezerva pod VARCHAR(191)),
  // takže poslední jméno sloupce může skončit uprostřed. Sestaveno stejným způsobem
  // jako na straně writeru; názvy sloupců jsou čistě ASCII, takže bajty = znaky.
  const keys = [
    "barvyStatusLabel", "dataRequiredDate", "dataStatusLabel", "deadlineExpedice",
    "description", "expediceNote", "jobPresetLabel", "lakStatusLabel", "materialNote",
    "materialStatusLabel", "orderNumber", "specifikace",
  ];
  const full = UNDO_MIXED_FIELD_PREFIX + keys.join(", ");
  const truncated = full.slice(0, 180);
  assert.ok(full.length > 180, "předpoklad testu: seznam musí být delší než limit writeru");
  assert.ok(truncated.endsWith("mat"), "předpoklad testu: ořez má skončit uprostřed jména sloupce");

  const result = coveredColumns(row("UNDO", truncated, null));
  assert.notEqual(result, "ALL");
  const cols = result as string[];

  // (a) žádný vrácený sloupec není smyšlený — „mat" propadlo sítem
  for (const col of cols) {
    const known = col === "startTime" || col === "endTime" || col === "machine" || isRestorableField(col);
    assert.ok(known, `mapa vrátila neexistující sloupec "${col}" — uťatý zbytek propadl filtrem`);
  }
  // (b) klíče, které se do limitu vešly celé, se pokrývají dál
  assert.ok(cols.includes("barvyStatusLabel"));
  assert.ok(cols.includes("materialNote"));
  // (c) klíče, které se do limitu nevešly, pokryté nejsou → revize je ukáže (bezpečný směr)
  assert.ok(!cols.includes("orderNumber"));
  assert.ok(!cols.includes("specifikace"));
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Historické hodnoty, které v DB reálně leží (dev DB, 1357 řádků, 8. 8. 2026)
// ─────────────────────────────────────────────────────────────────────────────

test("PRINT_RESET (legacy) pokrývá trojici printCompleted* stejně jako dnešní akce", () => {
  // 2 řádky v dev DB, field="printCompletedAt". Dnešní kód akci už nepíše, panel ji
  // ale čte. Trojice se v každé cestě zapisuje pohromadě, takže „reset tisku" ji
  // celou vysvětluje — parita s PRINT_COMPLETE/PRINT_UNDO.
  assert.deepEqual(
    sorted(coveredColumns(row("PRINT_RESET", "printCompletedAt"))),
    ["printCompletedAt", "printCompletedByUserId", "printCompletedByUsername"],
  );
});

test("legacy akce bez vazby na sloupce Blocku nepokrývají nic", () => {
  assert.deepEqual(coveredColumns(row("RESERVATION_NOTIFY", "message")), []);
  assert.deepEqual(coveredColumns(row("CASCADE_DELETE_SHIFT_ASSIGNMENTS", "ShiftAssignment")), []);
});

test("OVERLAP_FIX ze servisního skriptu pokrývá jen startTime", () => {
  // scripts/fix-existing-overlaps.ts posouvá startTime i endTime, auditní řádek ale
  // jmenuje jen startTime — endTime se tedy musí ukázat z revize.
  assert.deepEqual(coveredColumns(row("OVERLAP_FIX", "startTime")), ["startTime"]);
});

test("UPDATE/MachineWeekShifts je řádek pracovní doby (blockId 0), ne sloupec Blocku", () => {
  // 91 řádků v dev DB. Mapa ho nechává projít generickou větví — jméno neodpovídá
  // žádnému sloupci Blocku, takže v Tasku 12 nemůže nic potlačit. Pinned schválně:
  // kdyby někdo generickou větev vyměnil za whitelist, ať je vidět, co se stane.
  assert.deepEqual(coveredColumns(row("UPDATE", "MachineWeekShifts")), ["MachineWeekShifts"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Bezpečné výchozí chování a odolnost
// ─────────────────────────────────────────────────────────────────────────────

test("neznámá akce nepokrývá nic (nikdy ALL)", () => {
  // Fail-safe směr: neznámá akce = revize se ukáže CELÁ (nanejvýš duplicitní řádek).
  // Opačná volba („ALL") by změnu z historie SCHOVALA.
  assert.deepEqual(coveredColumns(row("BUDOUCI_AKCE", "deadlineExpedice")), []);
  assert.deepEqual(coveredColumns(row("BUDOUCI_AKCE")), []);
});

test("UPDATE bez field nepokrývá nic", () => {
  assert.deepEqual(coveredColumns(row("UPDATE", null)), []);
});

test("volající smí výsledek setřídit na místě, aniž rozbije mapu", () => {
  // Vrací se obranná KOPIE — `.sort()` na sdílené konstantě by přerovnal mapu
  // pro všechny další volající.
  const first = coveredColumns(row("PRINT_COMPLETE")) as string[];
  first.sort().reverse();
  assert.deepEqual(
    sorted(coveredColumns(row("PRINT_COMPLETE"))),
    ["printCompletedAt", "printCompletedByUserId", "printCompletedByUsername"],
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Strážné testy proti zastarání mapy
// ─────────────────────────────────────────────────────────────────────────────

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "../..");

/** Rekurzivní výpis .ts/.tsx souborů bez testů. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

test("každá hodnota `action` zapisovaná v repu je mapě známá", () => {
  // Táž třída pojistky jako blockColumns.test.ts proti schema.prisma: JSDoc slibuje
  // „když přibude nová hodnota AuditLog.action, MUSÍ přibýt i sem" — bez tohohle testu
  // to hlídá jen komentář a panel by u nové akce tiše vykresloval duplicity.
  //
  // Síť, ne důkaz: hledá literály na řádku s `action:` (tedy i obě větve ternárního
  // operátoru, kterým se píší PRINT_*/EXPEDITION_*/UNDO/REDO). Akci sestavenou
  // dynamicky mimo takový řádek nechytí.
  const dirs = [join(repoRoot, "src/app/api"), join(repoRoot, "src/lib"), join(repoRoot, "scripts")];
  const found = new Map<string, string>();
  for (const dir of dirs) {
    for (const file of sourceFiles(dir)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/\baction:\s*([^\n]*)/g)) {
        // Jen SCREAMING_CASE: odfiltruje `action: "asc"` (orderBy) i HTTP slovesa
        // requestu (`"publish"`, `"unpublish"`, `"reorder"`, `"prepare"`).
        for (const lit of m[1].matchAll(/"([A-Z][A-Z0-9_]*)"/g)) {
          if (!found.has(lit[1])) found.set(lit[1], file.slice(repoRoot.length + 1));
        }
      }
    }
  }
  assert.ok(found.size >= 15, `scanner nenašel skoro nic (${found.size}) — pravděpodobně se rozbil`);

  const revisionOnly = new Set<string>(REVISION_ONLY_ACTIONS);
  const unknown = [...found.entries()]
    .filter(([action]) => !KNOWN_AUDIT_ACTIONS.has(action) && !revisionOnly.has(action))
    .map(([action, file]) => `${action} (${file})`);
  assert.deepEqual(
    unknown,
    [],
    "V repu se zapisuje `action`, kterou auditCoverage.ts nezná — doplň ji do mapy " +
      "(nebo mezi REVISION_ONLY_ACTIONS, pokud auditní řádek nevzniká)",
  );
});

test("každá hodnota RevisionAction je buď známá auditní akce, nebo výslovně jen revizní", () => {
  // Vokabuláře AuditLog.action a RevisionAction se NESMÍ míchat (revision.server.ts),
  // ale mapa musí mít na každou hodnotu odpověď — jinak by u nové revizní akce nikdo
  // nezjistil, že se pro ni auditní řádek nepíše (dnešní případ EXPEDITION_REORDER).
  const src = readFileSync(join(repoRoot, "src/lib/revision.server.ts"), "utf8");
  const union = src.match(/export type RevisionAction =([\s\S]*?);/)?.[1];
  assert.ok(union, "export type RevisionAction nenalezen v src/lib/revision.server.ts");
  const values = [...union!.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.ok(values.length >= 13, `RevisionAction se načetl podezřele krátký (${values.length})`);

  const revisionOnly = new Set<string>(REVISION_ONLY_ACTIONS);
  const orphan = values.filter((v) => !KNOWN_AUDIT_ACTIONS.has(v) && !revisionOnly.has(v));
  assert.deepEqual(
    orphan,
    [],
    "RevisionAction obsahuje hodnotu, kterou auditCoverage.ts neřeší — rozhodni, jestli " +
      "k ní vzniká auditní řádek (do mapy), nebo ne (do REVISION_ONLY_ACTIONS)",
  );
});

test("REVISION_ONLY_ACTIONS obsahuje jen hodnoty, které NEJSOU auditní akce", () => {
  for (const action of REVISION_ONLY_ACTIONS) {
    assert.ok(
      !KNOWN_AUDIT_ACTIONS.has(action),
      `${action} je v REVISION_ONLY_ACTIONS, ale zároveň mezi auditními akcemi — jedno z toho lže`,
    );
    assert.deepEqual(coveredColumns(row(action)), [], `${action} nesmí nic pokrývat`);
  }
});
