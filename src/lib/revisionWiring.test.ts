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
 * Hlídají se DVĚ věci a každá má vlastní smyčku testů:
 *  1. cesta pořád volá `withRevision` a nese správné hodnoty `action`;
 *  2. UVNITŘ těla `withRevision` není modulový singleton `prisma`. Tohle je
 *     poslední známá úniková cesta a jediná, kterou pomocník neuzavírá
 *     strukturálně: `prisma` je v uzávěru každého těla (routy si ho importují
 *     nahoře kvůli refetchi ZA transakcí), takže `prisma.block.update` uvnitř
 *     těla projde typovou kontrolou, lintem i celou suitou — a přitom obejde
 *     revizi a PŘEŽIJE rollback, protože běží mimo transakci.
 *
 * Na co ani druhá kontrola NEDOSÁHNE: nepřímý nosič, tedy helper volaný z těla,
 * který si klienta bere z importu místo z parametru (dnes
 * `src/lib/scheduleSlotFinder.ts`). V routě to vidět není a text zdrojáku o tom
 * neví — tohle zůstává na code review.
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

/**
 * Index znaku, který uzavírá závorku otevřenou na `openIdx` (`(` nebo `{`).
 *
 * Řetězcové literály se přeskakují celé: apostrof v české větě uvnitř `label`
 * nebo závorka v šablonovém řetězci by jinak rozhodily počítání a vymezení
 * těla by se posunulo — tedy tichá slepá skvrna přesně tam, kde má test hlídat.
 */
function matchBalanced(src: string, openIdx: number): number {
  const open = src[openIdx];
  const close = open === "(" ? ")" : "}";
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  assert.fail("nevyvážené závorky ve zdrojáku routy");
}

/** Text prvního vyváženého `{ … }` za daným indexem (nad zdrojákem bez komentářů). */
function balancedObjectAfter(src: string, from: number): string {
  const start = src.indexOf("{", from);
  assert.notEqual(start, -1, "za withRevision( musí následovat meta objekt");
  return src.slice(start, matchBalanced(src, start) + 1);
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

/**
 * Text TĚLA každého volání `withRevision(` — tedy druhého argumentu, bez meta
 * objektu. Vymezuje se párováním závorek: od `(` za jménem funkce k jejímu `)`,
 * a z toho se odřízne meta objekt.
 *
 * Odříznout meta je nutné, ne kosmetické — kdyby se hledalo přes celý argument,
 * byl by rozsah sice širší, ale test by přestal mluvit o „těle" a jeho hláška by
 * ukazovala na místo, kde pravidlo neplatí.
 */
function revisionBodies(src: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf("withRevision(", from);
    if (at === -1) break;
    const openParen = at + "withRevision".length;
    const closeParen = matchBalanced(src, openParen);
    const metaStart = src.indexOf("{", openParen + 1);
    assert.ok(metaStart !== -1 && metaStart < closeParen, "za withRevision( musí následovat meta objekt");
    bodies.push(src.slice(matchBalanced(src, metaStart) + 1, closeParen));
    from = at + 1;
  }
  return bodies;
}

/**
 * Modulový singleton `prisma` — hledá se jen tenhle tvar, ne jakékoli „prisma".
 *
 * `\b` odstíní `myPrisma.` i `prismaTx`, malé počáteční písmeno odstíní typový
 * namespace `Prisma.` (`Prisma.join`, `Prisma.DbNull`), který je legitimní všude.
 * Import `from "@/lib/prisma"` se netrefí, protože za ním není tečka.
 */
const MODULE_PRISMA = /\bprisma\s*\./;

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

for (const route of ROUTES) {
  test(`${route.file} nesahá uvnitř withRevision na modulový prisma`, () => {
    const src = readRoute(route.file);
    const bodies = revisionBodies(src);

    // Bez tohohle by se test uměl „uzdravit" sám: kdyby vymezení těla selhalo
    // a vrátilo prázdný seznam, projde smyčka níž naprázdno a zelená by
    // znamenala jen to, že se nic nekontrolovalo.
    assert.equal(
      bodies.length,
      route.calls,
      `nepodařilo se vymezit ${route.calls} těl withRevision (nalezeno ${bodies.length})`,
    );

    for (const body of bodies) {
      assert.equal(
        MODULE_PRISMA.test(body),
        false,
        "uvnitř těla withRevision je modulový `prisma` — zápis by revizi obešel a PŘEŽIL by " +
        "rollback transakce, protože běží mimo ni. Do Block se píše výhradně přes rtx.block.*, " +
        "a ani číst se uvnitř těla přes `prisma` nesmí. Refetch a odpověď patří AŽ ZA volání.",
      );
    }
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
