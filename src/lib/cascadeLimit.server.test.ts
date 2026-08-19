import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { isAppError } from "@/lib/errors";
import type { CascadeImpact } from "@/lib/cascadeLimit";

// `assertCascadeConfirmed` čte `CASCADE_CONFIRM_ENFORCED` jako MODULOVOU konstantu
// z @/lib/cascadeLimit (viz jeho zdroj) — jde tedy o hodnotu zafixovanou v okamžiku
// vazby (linku) importujícího modulu, ne o něco, co lze měnit za běhu. Větev
// "režim VYNUCENÍ" (ENFORCED === true) se v repu dnes NIKDY nevykoná —
// CASCADE_CONFIRM_ENFORCED je `false` a zůstává tak (etapa B4 ho přepne
// samostatným commitem). Testuje se proto na PODSTRČENÉM modulu (mock.module,
// vzor sessionVersion.test.ts), NIKDY na přepnutí konstanty v cascadeLimit.ts.
// Vyžaduje --experimental-test-module-mocks (viz CLAUDE.md).
//
// Modul pod testem (`cascadeLimit.server.ts`) se importuje DVAKRÁT, pod dvěma
// různými specifikátory (druhý s cache-busting query). Tím vzniknou dvě NEZÁVISLÉ
// instance modulu, každá navázaná na `@/lib/cascadeLimit`, jaký byl aktivní v
// okamžiku JEJÍHO PRVNÍHO importu — první instance na reálný (nemockovaný,
// `false`) modul, druhá na podstrčený (`true`). Bez tohoto triku by druhý import
// stejného specifikátoru vrátil z cache tu samou (už navázanou) instanci.

function impact(overrides: Partial<CascadeImpact> = {}): CascadeImpact {
  return {
    movedCount: 1,
    maxShiftMs: 0,
    farthestEnd: null,
    exceeded: false,
    ...overrides,
  };
}

// Měřicí režim = REÁLNÝ, nemockovaný modul — CASCADE_CONFIRM_ENFORCED je v repu
// skutečně `false`, není co podstrkovat.
const { assertCascadeConfirmed: assertMeasureMode } = await import("./cascadeLimit.server");

test("pod prahem (exceeded: false) → nehází, nic nedělá", () => {
  assert.doesNotThrow(() =>
    assertMeasureMode(impact({ exceeded: false, movedCount: 20 }), { confirmed: false, path: "test" })
  );
});

test("nad prahem, confirmed: true → nehází", () => {
  assert.doesNotThrow(() =>
    assertMeasureMode(impact({ exceeded: true, movedCount: 10 }), { confirmed: true, path: "test" })
  );
});

test("nad prahem, confirmed: false, režim MĚŘENÍ → nehází (dnešní stav)", () => {
  assert.doesNotThrow(() =>
    assertMeasureMode(impact({ exceeded: true, movedCount: 10 }), { confirmed: false, path: "test" })
  );
});

test("nad prahem, confirmed: false, režim VYNUCENÍ → hodí AppError CASCADE_CONFIRM s details", async () => {
  mock.module("@/lib/cascadeLimit", {
    namedExports: {
      CASCADE_CONFIRM_ENFORCED: true,
      cascadeConfirmMessage: (i: CascadeImpact) => `Tato změna odsune ${i.movedCount} navazujících bloků. Potvrdit?`,
    },
  });
  // ?enforced=1 = cache-busting, viz komentář v hlavě souboru. TS nezná modul s
  // query suffixem (žádný takový soubor neexistuje) — za běhu ho tsx/node přes
  // mock.module vyřeší správně, tsc by na tom ale spadl, proto @ts-expect-error.
  // @ts-expect-error -- viz komentář výš, modul s query suffixem neexistuje staticky
  const { assertCascadeConfirmed: assertEnforcedMode } = await import("./cascadeLimit.server?enforced=1");

  const farthestEnd = new Date("2026-09-01T00:00:00.000Z");
  const givenImpact = impact({ exceeded: true, movedCount: 12, maxShiftMs: 3_600_000, farthestEnd });

  assert.throws(
    () => assertEnforcedMode(givenImpact, { confirmed: false, path: "test" }),
    (err: unknown) => {
      assert.ok(isAppError(err), "musí to být AppError");
      assert.equal((err as { code: unknown }).code, "CASCADE_CONFIRM");
      assert.deepEqual((err as { details: unknown }).details, {
        movedCount: 12,
        maxShiftMs: 3_600_000,
        farthestEnd: farthestEnd.toISOString(),
      });
      return true;
    }
  );
});
