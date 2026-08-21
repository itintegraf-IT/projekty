import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripComments } from "@/lib/sourceTextTestUtils";

/**
 * Vypínač autoposunu musí platit na VŠECH šesti cestách, které sahají na
 * `resolveChainPushFromDb` (přímo nebo přes `reflowBlockInTx`). Kdyby ho jedna
 * ignorovala, plánovač si autoposun vypne, a ta jedna cesta mu bloky posune dál —
 * a on se to dozví až z plánu.
 *
 * Split je zvlášť: chain push tam byl do etapy 6 BEZPODMÍNEČNÝ (žádný `resolveChain`
 * v těle requestu), takže se u něj kontroluje tvar `!== false` (chybějící příznak =
 * zapnuto, kvůli zpětné snášenlivosti se starým klientem). Obě reflow cesty čtou
 * stejně `!== false` ze stejného důvodu.
 *
 * Zdroj se čte přes `stripComments` (sdílené s `revisionWiring.test.ts` /
 * `cascadeWiring.test.ts`) — bez toho by dočasně ZAKOMENTOVANÉ volání (typický stav
 * při refaktoru nebo merge konfliktu: „na chvíli vypnu, ať mi to nespadá", a zapomenuté
 * vrátit) prošlo tiše, protože text by ve zdroji pořád byl přítomný, jen neúčinný.
 *
 * Každý řádek testuje DVOJICI vzorů: `parse` (příznak se čte z těla requestu do
 * proměnné) a `usage` (proměnná skutečně ŘÍDÍ, jestli se `resolveChainPushFromDb`
 * zavolá). Jen `parse` by nestačilo — kdyby někdo při refaktoru smazal `&& resolveChain`
 * u splitu (nebo `if` dočasně zakomentoval při merge), řádek `const resolveChain = …`
 * by zůstal, `parse` by dál procházel, a split by posouval bloky i s vypnutým
 * autoposunem, aniž by tenhle test cokoliv zachytil.
 */
const CESTY = [
  {
    path: "src/app/api/blocks/route.ts",
    parse: /resolveChain\s*===\s*true/,
    usage: /if\s*\(resolveChain\b/,
  },
  {
    path: "src/app/api/blocks/[id]/route.ts",
    parse: /resolveChain\s*===\s*true/,
    usage: /if\s*\(resolveChain\b/,
  },
  {
    path: "src/app/api/blocks/batch/route.ts",
    parse: /resolveChain\s*===\s*true/,
    usage: /if\s*\(resolveChain\b/,
  },
  {
    path: "src/app/api/blocks/[id]/split/route.ts",
    parse: /resolveChain\s*!==\s*false/,
    usage: /block\.type\s*===\s*"ZAKAZKA"\s*&&\s*resolveChain\b/,
  },
];

for (const c of CESTY) {
  test(`${c.path} respektuje vypínač autoposunu (čte HO I ho POUŽÍVÁ)`, () => {
    const src = stripComments(readFileSync(c.path, "utf8"));
    assert.match(src, c.parse,
      `${c.path} nečte resolveChain očekávaným způsobem — vypínač tam neplatí`);
    assert.match(src, c.usage,
      `${c.path} resolveChain přečte, ale NEPOUŽÍVÁ ho na místě, kde se rozhoduje o chain pushi — vypínač je tam dekorativní (parsuje se, ale nic neřídí)`);
  });
}

/**
 * Obě reflow cesty negatují chain push NEPŘÍMO — routa jen přečte `resolveChain` z
 * těla a protéče ho (shorthand vlastnost `resolveChain,`) do deps objektu volání
 * `reflowBlockInTx`/`reflowMachineInTx`; skutečné gatování dělá až sdílené jádro
 * `src/lib/reflow.server.ts`. Test proto ověřuje DVĚ věci zvlášť: že routa příznak
 * doopravdy PŘEDÁ (ne jen spočítá a zahodí) a že jádro ho doopravdy POUŽIJE.
 */
test("src/app/api/blocks/[id]/reflow/route.ts protéká resolveChain do reflowBlockInTx", () => {
  const src = stripComments(readFileSync("src/app/api/blocks/[id]/reflow/route.ts", "utf8"));
  assert.match(src, /resolveChain\s*!==\s*false/,
    "nečte resolveChain očekávaným způsobem — vypínač tam neplatí");
  const callIdx = src.indexOf("reflowBlockInTx(tx, id,");
  assert.notEqual(callIdx, -1, "volání reflowBlockInTx(tx, id, …) se nenašlo — přesunulo se jinam?");
  const window = src.slice(callIdx, callIdx + 250);
  assert.match(window, /resolveChain,/,
    "resolveChain se sice přečte z těla, ale nepředává se do reflowBlockInTx — vypínač je tam dekorativní");
});

test("src/app/api/blocks/reflow/route.ts protéká resolveChain do reflowMachineInTx", () => {
  const src = stripComments(readFileSync("src/app/api/blocks/reflow/route.ts", "utf8"));
  assert.match(src, /resolveChain\s*!==\s*false/,
    "nečte resolveChain očekávaným způsobem — vypínač tam neplatí");
  const callIdx = src.indexOf("reflowMachineInTx(tx, machine,");
  assert.notEqual(callIdx, -1, "volání reflowMachineInTx(tx, machine, …) se nenašlo — přesunulo se jinam?");
  const window = src.slice(callIdx, callIdx + 300);
  assert.match(window, /resolveChain,/,
    "resolveChain se sice přečte z těla, ale nepředává se do reflowMachineInTx — vypínač je tam dekorativní");
});

test("src/lib/reflow.server.ts skutečně GATUJE chain push podle deps.resolveChain, ne jen ho deklaruje", () => {
  const src = stripComments(readFileSync("src/lib/reflow.server.ts", "utf8"));
  // Musí to být PODMÍNKA řídící samotné volání resolveChainPush, ne izolovaný výraz
  // nebo komentář, který se na resolveChain jen odkazuje.
  assert.match(src, /deps\.resolveChain\s*!==\s*false\s*\?\s*await\s+deps\.resolveChainPush\(/,
    "deps.resolveChain !== false neřídí volání deps.resolveChainPush — reflow (jednoblokový i hromadný) by chain push spouštěl bez ohledu na vypínač");
  // Hromadný reflow musí příznak protéct do KAŽDÉHO volání reflowBlock v běhu,
  // jinak by vypínač platil jen pro jednoblokové „Přepočítat", ne pro celý stroj.
  const machineCallIdx = src.indexOf("deps.reflowBlock(tx, block.id, actor,");
  assert.notEqual(machineCallIdx, -1, "volání deps.reflowBlock(tx, block.id, actor, …) v reflowMachineInTx se nenašlo — přesunulo se jinam?");
  const window = src.slice(machineCallIdx, machineCallIdx + 250);
  assert.match(window, /resolveChain:\s*deps\.resolveChain,/,
    "reflowMachineInTx nepředává deps.resolveChain do jednotlivých reflowBlock volání — vypínač by u hromadného přepočtu stroje neplatil");
});
