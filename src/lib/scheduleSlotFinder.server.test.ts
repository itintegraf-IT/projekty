import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";

// ─── Mocky (musí být před prvním importem testované funkce) ───────────────────
// Mockujeme JEN Prismu — scheduleValidation nechat běžet reálně,
// protože serializeWeekShifts a isHardcodedBlocked jsou pure funkce
// a duplikovat je inline by způsobilo drift při změně produkční logiky.
const mockBlocks: Array<{ startTime: Date; endTime: Date }> = [];
const mockCompanyDays: Array<{ startDate: Date; endDate: Date }> = [];
const mockWeekShifts: unknown[] = [];

await mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      machineWeekShifts: { findMany: mock.fn(async () => mockWeekShifts) },
      block: { findMany: mock.fn(async () => mockBlocks) },
      companyDay: { findMany: mock.fn(async () => mockCompanyDays) },
    },
  },
});

// Import testované funkce AŽ PO nastavení mocků
const { findNextFreeSlotFromDb, findNextFreePrintSlotFromDb } = await import("@/lib/scheduleSlotFinder");

// ─── Pomocné konstanty pro testy ─────────────────────────────────────────────
const MACHINE = "XL_105";
const HOUR_MS = 60 * 60 * 1000;

// ─── Testy ───────────────────────────────────────────────────────────────────
describe("findNextFreeSlotFromDb", () => {
  beforeEach(() => {
    mockBlocks.length = 0;
    mockCompanyDays.length = 0;
    mockWeekShifts.length = 0;
  });

  it("prázdná DB → vrátí původní čas, wasShifted=false", async () => {
    // 2026-09-15 úterý 10:00Z = 12:00 Praha (CEST) — v pracovní době XL_105
    const start = new Date("2026-09-15T10:00:00.000Z");
    const result = await findNextFreeSlotFromDb(MACHINE, start, 4 * HOUR_MS);
    assert.equal(result.found, true);
    if (result.found) {
      assert.equal(result.startTime.getTime(), start.getTime());
      assert.equal(result.wasShifted, false);
    }
  });

  it("kolize s existujícím blokem v DB → posune za jeho konec", async () => {
    // Blok končí v 16:00Z = 18:00 Praha (CEST) — výsledný slot 16:00Z–20:00Z = 18:00–22:00 Praha (v pracovní době)
    mockBlocks.push({
      startTime: new Date("2026-09-15T10:00:00.000Z"),
      endTime: new Date("2026-09-15T16:00:00.000Z"),
    });
    const start = new Date("2026-09-15T10:00:00.000Z");
    const result = await findNextFreeSlotFromDb(MACHINE, start, 4 * HOUR_MS);
    assert.equal(result.found, true);
    if (result.found) {
      assert.equal(result.startTime.toISOString(), "2026-09-15T16:00:00.000Z");
      assert.equal(result.endTime.toISOString(), "2026-09-15T20:00:00.000Z");
      assert.equal(result.wasShifted, true);
    }
  });

  it("firemní odstávka brání slotu", async () => {
    // Odstávka celý den 15. 9. → slot musí přeskočit přes noční blok (20:00Z–04:00Z) a snappovat na 04:00Z 16. 9. (06:00 Praha)
    mockCompanyDays.push({
      startDate: new Date("2026-09-15T00:00:00.000Z"),
      endDate: new Date("2026-09-16T00:00:00.000Z"),
    });
    const start = new Date("2026-09-15T10:00:00.000Z");
    const result = await findNextFreeSlotFromDb(MACHINE, start, 4 * HOUR_MS);
    assert.equal(result.found, true);
    if (result.found) {
      // Konec odstávky 00:00Z Sep 16 = 02:00 Praha — stále v nočním bloku (22:00–06:00),
      // snap posune na 04:00Z Sep 16 = 06:00 Praha (začátek ranní směny)
      assert.equal(result.startTime.toISOString(), "2026-09-16T04:00:00.000Z");
      assert.equal(result.wasShifted, true);
    }
  });

  it("> 7 dní obsazeno → MAX_SHIFT_EXCEEDED", async () => {
    mockBlocks.push({
      startTime: new Date("2026-09-15T00:00:00.000Z"),
      endTime: new Date("2026-09-30T00:00:00.000Z"),
    });
    const start = new Date("2026-09-15T10:00:00.000Z");
    const result = await findNextFreeSlotFromDb(MACHINE, start, 4 * HOUR_MS);
    assert.equal(result.found, false);
    if (!result.found) {
      assert.equal(result.reason, "MAX_SHIFT_EXCEEDED");
    }
  });
});

describe("findNextFreePrintSlotFromDb (tiskové hodiny)", () => {
  beforeEach(() => {
    mockBlocks.length = 0;
    mockCompanyDays.length = 0;
    mockWeekShifts.length = 0;
  });

  it("kolize s blokem → start za jeho koncem, end z expanze", async () => {
    mockBlocks.push({
      startTime: new Date("2026-09-15T10:00:00.000Z"),
      endTime: new Date("2026-09-15T16:00:00.000Z"),
    });
    const r = await findNextFreePrintSlotFromDb("XL_105", new Date("2026-09-15T10:00:00.000Z"), 240);
    assert.equal(r.found, true);
    if (r.found) {
      assert.equal(r.startTime.toISOString(), "2026-09-15T16:00:00.000Z");
      assert.equal(r.endTime.toISOString(), "2026-09-15T20:00:00.000Z");
      assert.equal(r.wasShifted, true);
    }
  });

  it("firemní odstávka NENÍ blocker — start se snapne za ni a blok nepauzne zbytečně", async () => {
    // Odstávka celý den 15. 9.: start 10:00Z není runnable → snap na konec odstávky.
    // OPRAVENO oproti brief hand-computed hodnotě: konec odstávky 00:00Z 16. 9. = 02:00
    // Praha (středa) je STÁLE v nočním blackoutu XL_105 (isHardcodedBlocked: XL_105 je
    // blokován KAŽDOU noc 22:00–06:00, ne jen v neděli) — ověřeno shodně se sesterským
    // testem "firemní odstávka brání slotu" výše (findNextFreeSlotFromDb) na identickém
    // scénáři. Snap tedy pokračuje na 06:00 Praha = 04:00Z, žádná pauza v expanzi.
    mockCompanyDays.push({
      startDate: new Date("2026-09-15T00:00:00.000Z"),
      endDate: new Date("2026-09-16T00:00:00.000Z"),
    });
    const r = await findNextFreePrintSlotFromDb("XL_105", new Date("2026-09-15T10:00:00.000Z"), 240);
    assert.equal(r.found, true);
    if (r.found) {
      assert.equal(r.startTime.toISOString(), "2026-09-16T04:00:00.000Z");
      assert.equal(r.endTime.toISOString(), "2026-09-16T08:00:00.000Z");
    }
  });

  it("> 7 dní obsazeno → MAX_SHIFT_EXCEEDED", async () => {
    mockBlocks.push({
      startTime: new Date("2026-09-15T00:00:00.000Z"),
      endTime: new Date("2026-09-30T00:00:00.000Z"),
    });
    const r = await findNextFreePrintSlotFromDb("XL_105", new Date("2026-09-15T10:00:00.000Z"), 240);
    assert.deepEqual(r, { found: false, reason: "MAX_SHIFT_EXCEEDED" });
  });
});
