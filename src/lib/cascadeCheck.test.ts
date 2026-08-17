import { test } from "node:test";
import assert from "node:assert";
import { classifyCascade, computeConflictWindow } from "./cascadeCheck";
import { pragueToUTC } from "./dateUtils";
import type { DriftedBlock } from "./calendarDrift.server";

function drift(over: Partial<DriftedBlock> & Pick<DriftedBlock, "id" | "reason">): DriftedBlock {
  return {
    orderNumber: `Z${over.id}`, description: null, machine: "XL_105",
    startTime: pragueToUTC("2026-08-18", 8), endTime: pragueToUTC("2026-08-18", 12),
    expectedEnd: null,
    ...over,
  } as DriftedBlock;
}
/** END_MISMATCH, kde spočítaný konec je POZDĚJI než uložený = zkrácení směny = detonátor. */
const longer = (id: number) => drift({ id, reason: "END_MISMATCH", expectedEnd: pragueToUTC("2026-08-18", 20) });
/** END_MISMATCH, kde je spočítaný konec DŘÍV = přidání směny = neškodné. */
const shorter = (id: number) => drift({ id, reason: "END_MISMATCH", expectedEnd: pragueToUTC("2026-08-18", 10) });
const homeless = (id: number) => drift({ id, reason: "START_NOT_RUNNABLE" });

test("cc-1) prázdné vstupy → prázdný diff", () => {
  assert.deepStrictEqual(classifyCascade([], []), { newlyHomeless: [], newlyLonger: [] });
});

test("cc-2) blok ztratil místo TOUTO změnou → newlyHomeless", () => {
  const d = classifyCascade([], [homeless(1)]);
  assert.deepStrictEqual(d.newlyHomeless.map((b) => b.id), [1]);
  assert.deepStrictEqual(d.newlyLonger, []);
});

test("cc-3) blok byl bez místa už PŘED změnou → mlčení", () => {
  const d = classifyCascade([homeless(1)], [homeless(1)]);
  assert.deepStrictEqual(d.newlyHomeless, []);
});

test("cc-4) SALÁM: rozejitý konec PŘED → bez místa PO → hlásí se", () => {
  // Bez tohoto se zakázka vystěhuje dvěma uloženími a druhé je bez varování.
  const d = classifyCascade([longer(1)], [homeless(1)]);
  assert.deepStrictEqual(d.newlyHomeless.map((b) => b.id), [1]);
});

test("cc-5) nově prodloužený konec (zkrácení směny) → newlyLonger, NEBLOKUJE", () => {
  const d = classifyCascade([], [longer(1)]);
  assert.deepStrictEqual(d.newlyHomeless, []);
  assert.deepStrictEqual(d.newlyLonger.map((b) => b.id), [1]);
});

test("cc-6) nově zkrácený konec (PŘIDÁNÍ směny) → oba prázdné", () => {
  // Monotonie expanze: přidání směny může spočítaný konec jen zkrátit. Tohle je
  // Lukešův případ ze stížnosti a je to dobrá zpráva — nesmí vyvolat nic.
  const d = classifyCascade([], [shorter(1)]);
  assert.deepStrictEqual(d, { newlyHomeless: [], newlyLonger: [] });
});

test("cc-7) prodloužený konec už PŘED změnou → mlčení", () => {
  assert.deepStrictEqual(classifyCascade([longer(1)], [longer(1)]).newlyLonger, []);
});

test("cc-8) computeConflictWindow: okno je [pondělí, +7d +6h) v UTC", () => {
  const { from, to } = computeConflictWindow("2026-08-17");
  assert.strictEqual(from.toISOString(), "2026-08-17T00:00:00.000Z");
  assert.strictEqual(to.toISOString(), "2026-08-24T06:00:00.000Z");
});
