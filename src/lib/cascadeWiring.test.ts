import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripComments } from "@/lib/sourceTextTestUtils";

/**
 * Párování `skipCascadeCheck` ↔ souhrnné `assertCascadeConfirmed`.
 *
 * `skipCascadeCheck: true` vypíná kontrolu prahu UVNITŘ `resolveChainPushFromDb`, protože
 * u gesta s několika chain-push voláními by první volání vyhodilo výjimku s číslem jen
 * ze sebe — uživatel by odklepl menší dopad, než jaký se provede. Autoritativní je souhrn
 * za celé gesto. Kdyby ten souhrn vypadl, práh by u toho gesta neplatil VŮBEC a nic by
 * nespadlo: per-volání kontrola je vypnutá, takže by mlčel i běžný provoz.
 *
 * Zdroj se čte přes `stripComments` (sdílené s `revisionWiring.test.ts`) — bez toho by
 * dočasně ZAKOMENTOVANÉ volání (typický stav při refaktoru nebo merge konfliktu: „na
 * chvíli vypnu, ať mi to nespadá", a zapomenuté vrátit) prošlo tiše, protože text volání
 * by ve zdroji pořád byl přítomný, jen neúčinný.
 */
const SOUBORY = [
  { path: "src/app/api/blocks/batch/route.ts", souhrn: 'path: "batch-total"' },
  { path: "src/lib/reflow.server.ts", souhrn: 'path: "reflow-machine"' },
];

for (const s of SOUBORY) {
  test(`${s.path}: skipCascadeCheck má párové souhrnné assertCascadeConfirmed`, () => {
    const src = stripComments(readFileSync(s.path, "utf8"));
    assert.ok(src.includes("skipCascadeCheck: true"),
      `${s.path} už neposílá skipCascadeCheck — jestli to je záměr, uprav i tenhle test`);
    // Hledá se TVAR VOLÁNÍ `assertCascadeConfirmed(`, ne pouhý výskyt jména — jinak by
    // tenhle assert byl dekorativní: jméno je ve zdroji vždy přítomné i přes importní
    // řádek (`import { assertCascadeConfirmed } from "@/lib/cascadeLimit.server"`),
    // takže by prošel i po smazání samotného volání.
    assert.ok(src.includes("assertCascadeConfirmed("),
      `${s.path} vypíná per-volání kontrolu, ale nevolá souhrnné assertCascadeConfirmed(...) — práh tam NEPLATÍ`);
    assert.ok(src.includes(s.souhrn),
      `${s.path} nevolá souhrn s ${s.souhrn} — bez něj nejde v logu poznat, že gesto práh překročilo`);
  });
}

test("žádný DALŠÍ soubor neposílá skipCascadeCheck bez souhrnu", () => {
  // Nový volající se skipCascadeCheck musí do seznamu výš přibýt VĚDOMĚ, i s párovým souhrnem.
  const kandidati = [
    "src/app/api/blocks/route.ts",
    "src/app/api/blocks/[id]/route.ts",
    "src/app/api/blocks/[id]/split/route.ts",
    "src/app/api/blocks/[id]/reflow/route.ts",
    "src/app/api/blocks/reflow/route.ts",
  ];
  for (const p of kandidati) {
    const src = stripComments(readFileSync(p, "utf8"));
    assert.ok(!src.includes("skipCascadeCheck"),
      `${p} nově posílá skipCascadeCheck — přidej ho do SOUBORY i s párovým souhrnem, jinak tam práh tiše neplatí`);
  }
});
