import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeBlockRow } from "./rowNormalize";
import { BLOCK_BOOLEAN_COLUMNS, BLOCK_DATE_COLUMNS } from "./blockColumns";

// Cesta k tomuto souboru, ne k pracovnímu adresáři (`process.cwd()`) — test
// tak najde schema.prisma spolehlivě bez ohledu na to, odkud se `node --test`
// spouští (jiná konvence v repu, undoApply.server.test.ts:403, používá
// `process.cwd()`; tady je to záměrně jinak, viz komentář u testu níž).
const testDir = dirname(fileURLToPath(import.meta.url));

test("BOOLEAN sloupce z 0/1 na false/true", () => {
  const out = normalizeBlockRow({ locked: 1, dataOk: 0, scheduleBypassed: 1 });
  assert.equal(out.locked, true);
  assert.equal(out.dataOk, false);
  assert.equal(out.scheduleBypassed, true);
});

test("NULL v BOOLEAN sloupci zůstane null, ne false", () => {
  const out = normalizeBlockRow({ locked: null });
  assert.equal(out.locked, null);
});

test("obranná větev: DATETIME jako řetězec (dnešní driver ho nevrací, ale kdyby)", () => {
  // Prisma 5 + MySQL přes $queryRaw DATETIME jako string NEVRACÍ (ověřeno
  // proti dev DB 7. 8. 2026, viz komentář u normalizeBlockRow) — tahle větev
  // se v provozu dnes nespustí. Test ji přesto drží živou jako obrannou síť
  // pro případ budoucí změny driveru/verze; interpretace naivního MySQL
  // DATETIME jako UTC musí zůstat správná, i kdyby k tomu jednou došlo.
  const out = normalizeBlockRow({ startTime: "2026-09-03 06:00:00.000" });
  assert.ok(out.startTime instanceof Date);
  assert.equal((out.startTime as Date).toISOString(), "2026-09-03T06:00:00.000Z");
});

test("DATETIME, které už je Date (skutečný tvar z $queryRaw), projde beze změny", () => {
  const d = new Date("2026-09-03T06:00:00.000Z");
  const out = normalizeBlockRow({ endTime: d });
  assert.equal((out.endTime as Date).getTime(), d.getTime());
});

test("NULL v DATETIME sloupci zůstane null", () => {
  const out = normalizeBlockRow({ printCompletedAt: null });
  assert.equal(out.printCompletedAt, null);
});

test("ostatní sloupce projdou beze změny", () => {
  const out = normalizeBlockRow({ orderNumber: "5000", printMinutes: 480, machine: "XL_105" });
  assert.equal(out.orderNumber, "5000");
  assert.equal(out.printMinutes, 480);
  assert.equal(out.machine, "XL_105");
});

test("BLOCK_BOOLEAN_COLUMNS a BLOCK_DATE_COLUMNS odpovídají SKUTEČNÉMU schema.prisma (oba směry — chybějící i přebývající sloupec)", () => {
  // JSDoc u BLOCK_BOOLEAN_COLUMNS/BLOCK_DATE_COLUMNS slibuje: „když do modelu
  // Block přibude Boolean nebo DateTime sloupec, MUSÍ přibýt i sem." Bez
  // téhle kontroly to hlídá jen komentář — přesně tahle třída selhání (seznam
  // sloupců v kódu se tiše rozejde se schématem) už v repu jednou reálně
  // způsobila incident: AUDITED_FIELDS nepokrývalo startTime/endTime/machine/
  // printMinutes, což znemožnilo rekonstrukci havárií plánu 5.–6. 8. 2026.
  //
  // Na rozdíl od DATE_FIELDS v undoApply.server.test.ts (to je záměrně jen
  // PRŮNIK s UNDO_RESTORABLE_FIELDS, protože undo záměrně nevrací
  // createdAt/updatedAt/printCompletedAt) tady BLOCK_BOOLEAN_COLUMNS a
  // BLOCK_DATE_COLUMNS mají pokrývat ÚPLNÝ seznam — proto přímá množinová
  // rovnost oběma směry, ne průnik.
  const schemaPath = join(testDir, "../../../prisma/schema.prisma");
  const schema = readFileSync(schemaPath, "utf8");
  const modelMatch = schema.match(/model Block \{([\s\S]*?)\n\}/);
  assert.ok(modelMatch, "model Block nenalezen v prisma/schema.prisma — zkontroluj cestu/formát souboru");
  const body = modelMatch![1];

  // Stejný vzor jako už ověřený parser v undoApply.server.test.ts (řádek 418):
  // typ MUSÍ následovat přesně za jménem pole a končit buď mezerou (za typem
  // je ještě atribut, např. `@default(false)`), nebo koncem řádku (pole bez
  // atributu). Relační pole (Block?, Reservation?, BlockNote[], …) mají jiný
  // typ než "Boolean"/"DateTime", takže je regex bezpečně přeskočí — nejde o
  // hledání podřetězce, ale přesné shody typu.
  const booleanColumns = new Set<string>();
  const dateTimeColumns = new Set<string>();
  for (const line of body.split("\n")) {
    const boolMatch = line.match(/^\s*(\w+)\s+Boolean\??(?:\s|$)/);
    if (boolMatch) booleanColumns.add(boolMatch[1]);
    const dateMatch = line.match(/^\s*(\w+)\s+DateTime\??(?:\s|$)/);
    if (dateMatch) dateTimeColumns.add(dateMatch[1]);
  }
  assert.ok(booleanColumns.size > 0, "parser nenašel žádný Boolean sloupec — regex/formát schématu se pravděpodobně změnil");
  assert.ok(dateTimeColumns.size > 0, "parser nenašel žádný DateTime sloupec — regex/formát schématu se pravděpodobně změnil");

  assert.deepEqual(
    [...BLOCK_BOOLEAN_COLUMNS].sort(),
    [...booleanColumns].sort(),
    "BLOCK_BOOLEAN_COLUMNS se rozešel se skutečnými Boolean sloupci Blocku ve schema.prisma",
  );
  assert.deepEqual(
    [...BLOCK_DATE_COLUMNS].sort(),
    [...dateTimeColumns].sort(),
    "BLOCK_DATE_COLUMNS se rozešel se skutečnými DateTime sloupci Blocku ve schema.prisma",
  );
});
