import test, { mock } from "node:test";
import assert from "node:assert/strict";

// Prisma je namockovaná — testy běží bez DB.
// Vyžaduje --experimental-test-module-mocks (viz CLAUDE.md).
let findUniqueCalls = 0;
let nextResult: { tokenVersion: number } | null = { tokenVersion: 0 };
let shouldThrow = false;

mock.module("./prisma", {
  namedExports: {
    prisma: {
      user: {
        findUnique: async () => {
          findUniqueCalls++;
          if (shouldThrow) throw new Error("DB je dole");
          return nextResult;
        },
      },
    },
  },
});

const { checkSessionVersion, invalidateSessionVersionCache, bumpTokenVersion } =
  await import("./sessionVersion");

function reset(result: { tokenVersion: number } | null, throwErr = false) {
  findUniqueCalls = 0;
  nextResult = result;
  shouldThrow = throwErr;
  invalidateSessionVersionCache();
}

test("shodná verze → platná session", async () => {
  reset({ tokenVersion: 3 });
  assert.equal(await checkSessionVersion(1, 3), true);
});

test("nižší verze v tokenu (po bumpu) → neplatná session", async () => {
  reset({ tokenVersion: 4 });
  assert.equal(await checkSessionVersion(1, 3), false);
});

test("smazaný uživatel → neplatná session", async () => {
  reset(null);
  assert.equal(await checkSessionVersion(99, 0), false);
});

test("chybějící claim (starý token) se bere jako verze 0", async () => {
  reset({ tokenVersion: 0 });
  assert.equal(await checkSessionVersion(1, 0), true);
});

test("cache: druhé volání už nejde do DB", async () => {
  reset({ tokenVersion: 1 });
  await checkSessionVersion(7, 1);
  await checkSessionVersion(7, 1);
  await checkSessionVersion(7, 1);
  assert.equal(findUniqueCalls, 1);
});

test("invalidace cache vynutí nový dotaz (revokace se projeví hned)", async () => {
  reset({ tokenVersion: 1 });
  assert.equal(await checkSessionVersion(8, 1), true);
  nextResult = { tokenVersion: 2 };
  // Bez invalidace by cache vracela starou verzi.
  assert.equal(await checkSessionVersion(8, 1), true);
  invalidateSessionVersionCache(8);
  assert.equal(await checkSessionVersion(8, 1), false);
});

test("cache je per-uživatel (invalidace jednoho nezahodí druhého)", async () => {
  reset({ tokenVersion: 1 });
  await checkSessionVersion(10, 1);
  await checkSessionVersion(11, 1);
  const callsAfterWarmup = findUniqueCalls;
  invalidateSessionVersionCache(10);
  await checkSessionVersion(11, 1); // z cache
  assert.equal(findUniqueCalls, callsAfterWarmup);
});

test("chyba DB → fail-open (výpadek DB neodhlásí celou firmu)", async () => {
  reset({ tokenVersion: 1 }, true);
  assert.equal(await checkSessionVersion(1, 0), true);
});

test("bumpTokenVersion inkrementuje a zahodí cache", async () => {
  reset({ tokenVersion: 5 });
  await checkSessionVersion(20, 5); // naplní cache
  let updateArgs: unknown = null;
  const tx = { user: { update: async (args: unknown) => { updateArgs = args; return {}; } } };
  await bumpTokenVersion(tx, 20);
  assert.deepEqual(updateArgs, { where: { id: 20 }, data: { tokenVersion: { increment: 1 } } });
  // Cache musí být pryč → další check jde znovu do DB.
  const before = findUniqueCalls;
  await checkSessionVersion(20, 5);
  assert.equal(findUniqueCalls, before + 1);
});
