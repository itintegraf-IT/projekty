import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * STRÁŽNÝ TEST ZAPOJENÍ — hlídá, že devět mutačních cest pořád píše do
 * `BlockRevision`.
 *
 * Proč staticky a ne přes HTTP: routy `src/app/api/**\/route.ts` neimportuje ani
 * jeden z ostatních testů, takže je NIC nenačítá. Doloženo (recenze 8. 8. 2026):
 * do všech devíti souborů naráz vložená syntaktická chyba nechala suitu
 * 758/758 zelenou, a mutační kampaň 28 mutací zapojení (záměna `action`,
 * prohození `label`, podvržený `user`, odpojení zpět na `prisma.$transaction`)
 * nezabila ani jednu. Jedinou obranou byl code review.
 *
 * Test čte zdrojáky jako text. Je to hrubý nástroj, ale zabírá přesně na to,
 * co se v praxi rozbíjí — odpojení cesty při refaktoru nebo merge konfliktu.
 * NENAHRAZUJE integrační test, který by ověřil obsah zapsaného řádku; ten je
 * pořád dluh (`groupId` společný s auditem, `kind`, `before`/`after`).
 *
 * Když sem přibude desátá mutační cesta, patří do tabulky níž — jinak ji tenhle
 * test neuhlídá a mlčky projde.
 */

/** Akční token revize: SCREAMING_SNAKE. Popisky (`label`) jsou české věty, ty se sem netrefí. */
const ACTION_TOKEN = /^[A-Z_]+$/;

type RouteExpectation = {
  /** Cesta od kořene repa. */
  file: string;
  /** Kolik volání `withRevision` v souboru je (víc jich má PUT+DELETE a expedice). */
  calls: number;
  /** Všechny hodnoty `action`, které se v metech smí objevit — VČETNĚ obou směrů u párových cest. */
  actions: string[];
};

const ROUTES: RouteExpectation[] = [
  { file: "src/app/api/blocks/route.ts", calls: 1, actions: ["CREATE"] },
  // PUT (UPDATE) + DELETE v jednom souboru.
  { file: "src/app/api/blocks/[id]/route.ts", calls: 2, actions: ["DELETE", "UPDATE"] },
  { file: "src/app/api/blocks/batch/route.ts", calls: 1, actions: ["BATCH"] },
  { file: "src/app/api/blocks/[id]/split/route.ts", calls: 1, actions: ["SPLIT"] },
  { file: "src/app/api/blocks/reflow/route.ts", calls: 1, actions: ["REFLOW"] },
  { file: "src/app/api/blocks/[id]/reflow/route.ts", calls: 1, actions: ["REFLOW"] },
  // Směr kroku historie MUSÍ být v `action` — jinak splácne undo a redo dohromady.
  { file: "src/app/api/blocks/undo/route.ts", calls: 1, actions: ["REDO", "UNDO"] },
  // Potvrzení i vrácení tisku, každé pod vlastní hodnotou.
  { file: "src/app/api/blocks/[id]/complete/route.ts", calls: 1, actions: ["PRINT_COMPLETE", "PRINT_UNDO"] },
  // Reorder (jedno volání) + publish/unpublish (druhé volání, ternárkou).
  {
    file: "src/app/api/blocks/[id]/expedition/route.ts",
    calls: 2,
    actions: ["EXPEDITION_PUBLISH", "EXPEDITION_REORDER", "EXPEDITION_UNPUBLISH"],
  },
];

/**
 * Zdroják bez komentářů, řetězce zachované.
 *
 * Musí se to udělat DŘÍV než cokoli jiného, jinak test lže v obou směrech:
 * český komentář typu „EXPEDITION" nese nepárovou uvozovku a posunul by hledání
 * řetězcových literálů o jednu (hodnota `action` by z meta „zmizela"), a naopak
 * komentář, který o `$transaction(` jen mluví, by vypadal jako obcházení obalu.
 */
function stripComments(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      const open = i;
      i++;
      while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
      i++;
      out.push(src.slice(open, i));
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join("");
}

function readRoute(file: string): string {
  return stripComments(readFileSync(join(process.cwd(), file), "utf8"));
}

/** Text prvního vyváženého `{ … }` za daným indexem (nad zdrojákem bez komentářů). */
function balancedObjectAfter(src: string, from: number): string {
  const start = src.indexOf("{", from);
  assert.notEqual(start, -1, "za withRevision( musí následovat meta objekt");
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
    i++;
  }
  assert.fail("nevyvážené závorky v meta objektu withRevision");
}

/** Všechna volací místa `withRevision(` a text jejich meta objektu. */
function revisionMetas(src: string): string[] {
  const metas: string[] = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf("withRevision(", from);
    if (at === -1) break;
    metas.push(balancedObjectAfter(src, at + "withRevision(".length));
    from = at + 1;
  }
  return metas;
}

for (const route of ROUTES) {
  test(`${route.file} zapisuje revize přes withRevision`, () => {
    const src = readRoute(route.file);

    assert.match(
      src,
      /import \{ withRevision \} from "@\/lib\/revision\.server";/,
      "routa musí importovat withRevision z jádra",
    );

    const metas = revisionMetas(src);
    assert.equal(
      metas.length,
      route.calls,
      `očekává se ${route.calls} volání withRevision, nalezeno ${metas.length} — cesta byla odpojena, nebo přibyla další`,
    );

    // Transakci otevírá VÝHRADNĚ pomocník. Vlastní `prisma.$transaction` v mutační
    // routě je přesně ten tvar, do kterého se zapojení při refaktoru vrací zpátky —
    // a revize by se přestaly psát bez jediné chyby v buildu, lintu i testech.
    assert.equal(
      src.includes("$transaction("),
      false,
      "mutační routa nesmí otevírat vlastní transakci — obchází to revizní obal",
    );

    const actions = new Set<string>();
    for (const meta of metas) {
      assert.match(meta, /\baction:/, "meta withRevision musí nést action");
      for (const [, literal] of meta.matchAll(/"([^"\\]*)"/g)) {
        if (ACTION_TOKEN.test(literal)) actions.add(literal);
      }
    }
    assert.deepEqual(
      [...actions].sort(),
      [...route.actions].sort(),
      "hodnoty action se neshodují — u párových cest musí jít poznat směr (K5)",
    );
  });
}

/** Všechny `route.ts` pod danou složkou, cestami od kořene repa. */
function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...routeFiles(rel));
    else if (entry.name === "route.ts") out.push(rel);
  }
  return out;
}

test("žádná neevidovaná API routa nezapisuje do tabulky Block", () => {
  // Pojistka proti DESÁTÉ cestě: kdyby někdo přidal routu, která do Block píše,
  // a na tabulku výš zapomněl, strážný test by ji mlčky nehlídal. Tenhle test
  // proto hledá zápisová volání sám a trvá na tom, aby byla jen v evidovaných
  // souborech. (Reflow a undo tu nejsou proto, že zápis delegují do helperů
  // `reflowMachineInTx` / `applyUndoOps` — jejich zapojení hlídá tabulka výš.)
  const known = new Set(ROUTES.map((r) => r.file));
  const writeCall = /\bblock\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
  for (const file of routeFiles("src/app/api")) {
    if (!writeCall.test(readRoute(file))) continue;
    assert.ok(known.has(file), `${file} zapisuje do Block, ale není mezi evidovanými mutačními cestami`);
  }
  assert.equal(known.size, 9, "devět mutačních cest — po přidání desáté aktualizuj tabulku");
});
