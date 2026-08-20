import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * STRÁŽNÝ TEST ZAPOJENÍ syncReservationScheduleForBlocks (etapa 9, fáze 0).
 *
 * Chain push posouvá bloky s reservationId na ŠESTI cestách; zapomenutá cesta
 * = obchodník vidí v /rezervace zastaralý termín (třída dluhu
 * rezervace_chain_push_dluh.md). Vzor revisionWiring.test.ts — čte zdrojáky
 * jako text; nová mutační cesta bloku patří do tabulky níž.
 *
 * DELETE /api/blocks/[id] tu ZÁMĚRNĚ není: mazání překlápí rezervaci na
 * REJECTED a nuluje scheduled* vlastní větví.
 */
const WIRED: Array<{ file: string; calls: number }> = [
  { file: "src/app/api/blocks/route.ts", calls: 1 },
  { file: "src/app/api/blocks/[id]/route.ts", calls: 1 },
  { file: "src/app/api/blocks/batch/route.ts", calls: 1 },
  { file: "src/app/api/blocks/[id]/split/route.ts", calls: 1 },
  { file: "src/lib/reflow.server.ts", calls: 1 },
  { file: "src/lib/undoApply.server.ts", calls: 1 },
];

for (const w of WIRED) {
  test(`${w.file} volá syncReservationScheduleForBlocks (${w.calls}×)`, () => {
    const src = readFileSync(join(process.cwd(), w.file), "utf8");
    assert.match(
      src,
      /import \{ syncReservationScheduleForBlocks \} from "@\/lib\/reservationSync\.server";/,
      "cesta musí importovat sync helper",
    );
    const count = src.split("syncReservationScheduleForBlocks(").length - 1;
    assert.equal(
      count,
      w.calls,
      `očekává se ${w.calls} volání, nalezeno ${count} — cesta byla odpojena, nebo přibylo neevidované volání`,
    );
  });
}
