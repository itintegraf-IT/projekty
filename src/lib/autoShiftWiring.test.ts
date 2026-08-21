import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Vypínač autoposunu musí platit na VŠECH šesti cestách, které sahají na
 * `resolveChainPushFromDb`. Kdyby ho jedna ignorovala, plánovač si autoposun vypne,
 * a ta jedna cesta mu bloky posune dál — a on se to dozví až z plánu.
 *
 * Split je zvlášť: chain push tam byl do etapy 6 BEZPODMÍNEČNÝ (žádný `resolveChain`
 * v těle requestu), takže se u něj kontroluje tvar `!== false` (chybějící příznak =
 * zapnuto, kvůli zpětné snášenlivosti se starým klientem).
 */
const CESTY = [
  { path: "src/app/api/blocks/route.ts", vzor: /resolveChain\s*===\s*true/ },
  { path: "src/app/api/blocks/[id]/route.ts", vzor: /resolveChain\s*===\s*true/ },
  { path: "src/app/api/blocks/batch/route.ts", vzor: /resolveChain\s*===\s*true/ },
  { path: "src/app/api/blocks/[id]/split/route.ts", vzor: /resolveChain\s*!==\s*false/ },
  { path: "src/app/api/blocks/[id]/reflow/route.ts", vzor: /resolveChain\s*!==\s*false/ },
  { path: "src/app/api/blocks/reflow/route.ts", vzor: /resolveChain\s*!==\s*false/ },
];

for (const c of CESTY) {
  test(`${c.path} respektuje vypínač autoposunu`, () => {
    assert.match(readFileSync(c.path, "utf8"), c.vzor,
      `${c.path} nečte resolveChain očekávaným způsobem — vypínač tam neplatí`);
  });
}
