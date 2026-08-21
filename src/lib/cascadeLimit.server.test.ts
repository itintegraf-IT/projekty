import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { isAppError } from "@/lib/errors";
import type { CascadeImpact } from "@/lib/cascadeLimit";

// `assertCascadeConfirmed` čte `CASCADE_CONFIRM_ENFORCED` jako MODULOVOU konstantu
// z @/lib/cascadeLimit (viz jeho zdroj) — jde tedy o hodnotu zafixovanou v okamžiku
// vazby (linku) importujícího modulu, ne o něco, co lze měnit za běhu. Od 21. 8. 2026
// je `CASCADE_CONFIRM_ENFORCED` v repu `true` (etapa B4 — vynucení zapnuto, práh
// zůstává 5). Větev "režim MĚŘENÍ" (ENFORCED === false) se v repu dnes NIKDY
// nevykoná — testuje se proto na PODSTRČENÉM modulu (mock.module, vzor
// sessionVersion.test.ts), NIKDY na přepnutí konstanty v cascadeLimit.ts.
// Vyžaduje --experimental-test-module-mocks (viz CLAUDE.md).
//
// Modul pod testem (`cascadeLimit.server.ts`) se importuje VÍCKRÁT, pod různými
// specifikátory (cache-busting query). Tím vzniknou NEZÁVISLÉ instance modulu,
// každá navázaná na `@/lib/cascadeLimit`, jaký byl aktivní v okamžiku JEJÍHO
// PRVNÍHO importu — první (bezpříponová) instance na reálný (nemockovaný,
// `true`) modul, ostatní na podstrčené varianty. Bez tohoto triku by druhý
// import stejného specifikátoru vrátil z cache tu samou (už navázanou) instanci.

function impact(overrides: Partial<CascadeImpact> = {}): CascadeImpact {
  return {
    movedCount: 1,
    maxShiftMs: 0,
    farthestEnd: null,
    exceeded: false,
    ...overrides,
  };
}

// Režim VYNUCENÍ = REÁLNÝ, nemockovaný modul — CASCADE_CONFIRM_ENFORCED je v repu
// skutečně `true`, není co podstrkovat.
const { assertCascadeConfirmed: assertEnforcedMode } = await import("./cascadeLimit.server");

test("pod prahem (exceeded: false) → nehází, nic nedělá", () => {
  assert.doesNotThrow(() =>
    assertEnforcedMode(impact({ exceeded: false, movedCount: 20 }), { confirmed: false, path: "test" })
  );
});

test("nad prahem, confirmed: true → nehází", () => {
  assert.doesNotThrow(() =>
    assertEnforcedMode(impact({ exceeded: true, movedCount: 10 }), { confirmed: true, path: "test" })
  );
});

test("nad prahem, confirmed: false, režim VYNUCENÍ → hodí AppError CASCADE_CONFIRM s details", () => {
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

test("nad prahem, režim VYNUCENÍ → PŘED hozením zaloguje warn s machine/anchorId a maxShiftMinutes vedle maxShiftHours", async (t) => {
  const logged: unknown[] = [];
  // `t.mock.module` (test-context-scoped, ne top-level `mock`) se automaticky
  // vrátí po konci testu — jinak by druhý test níž na téže mockované cestě
  // `@/lib/logger` narazil na "module is already mocked".
  t.mock.module("@/lib/logger", {
    namedExports: {
      logger: {
        info: () => {},
        warn: (_label: string, detail?: unknown) => { logged.push(detail); },
        error: () => {},
      },
    },
  });
  // ?logspy=1 = cache-busting, viz komentář v hlavě souboru — potřebujeme instanci
  // `cascadeLimit.server` navázanou na PODSTRČENÝ `@/lib/logger`, ne na reálný.
  // @ts-expect-error -- viz komentář výš, modul s query suffixem neexistuje staticky
  const { assertCascadeConfirmed: assertWithLogSpy } = await import("./cascadeLimit.server?logspy=1");

  const farthestEnd = new Date("2026-09-01T00:00:00.000Z");
  // 20 minut je záměrně POD hodinou: Math.round(ms / 3_600_000) z toho vyjde 0,
  // přesně ten tvar, který u incidentu 17. 8. 2026 četl "neposunulo se" —
  // šlo o desítky minut, ne o celé hodiny, ale zaokrouhlené hodiny to smazaly.
  assert.throws(() =>
    assertWithLogSpy(
      impact({ exceeded: true, movedCount: 6, maxShiftMs: 20 * 60_000, farthestEnd }),
      { confirmed: false, path: "test", machine: "XL 105", anchorId: 4242 },
    )
  );

  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0], {
    path: "test",
    movedCount: 6,
    maxShiftHours: 0,
    maxShiftMinutes: 20,
    farthestEnd: farthestEnd.toISOString(),
    enforced: true,
    machine: "XL 105",
    anchorId: 4242,
  });
});

test("nad prahem, režim VYNUCENÍ, bez machine/anchorId → loguje null (souhrnná volání bez jedné kotvy)", async (t) => {
  const logged: unknown[] = [];
  t.mock.module("@/lib/logger", {
    namedExports: {
      logger: {
        info: () => {},
        warn: (_label: string, detail?: unknown) => { logged.push(detail); },
        error: () => {},
      },
    },
  });
  // @ts-expect-error -- viz komentář výš, modul s query suffixem neexistuje staticky
  const { assertCascadeConfirmed: assertWithLogSpy } = await import("./cascadeLimit.server?logspy=2");

  assert.throws(() =>
    assertWithLogSpy(impact({ exceeded: true, movedCount: 40 }), { confirmed: false, path: "reflow-machine" })
  );

  assert.equal(logged.length, 1);
  assert.equal((logged[0] as { machine: unknown }).machine, null);
  assert.equal((logged[0] as { anchorId: unknown }).anchorId, null);
});

test("nad prahem, confirmed: false, režim MĚŘENÍ → nehází, jen zaloguje (dřívější výchozí stav, dnes jen podstrčený)", async () => {
  mock.module("@/lib/cascadeLimit", {
    namedExports: {
      CASCADE_CONFIRM_ENFORCED: false,
      cascadeConfirmMessage: (i: CascadeImpact) => `Tato změna odsune ${i.movedCount} navazujících bloků. Potvrdit?`,
    },
  });
  // ?measure=1 = cache-busting, viz komentář v hlavě souboru. TS nezná modul s
  // query suffixem (žádný takový soubor neexistuje) — za běhu ho tsx/node přes
  // mock.module vyřeší správně, tsc by na tom ale spadl, proto @ts-expect-error.
  // @ts-expect-error -- viz komentář výš, modul s query suffixem neexistuje staticky
  const { assertCascadeConfirmed: assertMeasureMode } = await import("./cascadeLimit.server?measure=1");

  assert.doesNotThrow(() =>
    assertMeasureMode(impact({ exceeded: true, movedCount: 10 }), { confirmed: false, path: "test" })
  );
});
