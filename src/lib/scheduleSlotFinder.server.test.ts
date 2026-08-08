import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";
import type { PrismaTransactionClient } from "@/lib/prismaTx";
import { findNextFreeSlotFromDb, findNextFreePrintSlotFromDb } from "@/lib/scheduleSlotFinder";

// ─── Fake klient ─────────────────────────────────────────────────────────────
// Mockuje se JEN Prisma — scheduleValidation nechat běžet reálně, protože
// serializeWeekShifts a isHardcodedBlocked jsou pure funkce a duplikovat je
// inline by způsobilo drift při změně produkční logiky.
//
// Dřív se podstrkoval přes `mock.module("@/lib/prisma")`. Od chvíle, kdy jsou
// oba `*FromDb` findery napojené na `withRevision` (Task 7), si klienta berou
// POVINNÝM parametrem a modulový singleton vůbec neimportují — mock modulu by
// tedy neměl co nahradit. Fake se proto předává přímo, vzorem `reflow.server.test.ts`
// a `overlapResolver.server.test.ts`.
const mockBlocks: Array<{ startTime: Date; endTime: Date }> = [];
const mockCompanyDays: Array<{ startDate: Date; endDate: Date }> = [];
const mockWeekShifts: unknown[] = [];

const weekShiftsFindManyMock = mock.fn(async () => mockWeekShifts);

const db = {
  machineWeekShifts: { findMany: weekShiftsFindManyMock },
  block: { findMany: mock.fn(async () => mockBlocks) },
  companyDay: { findMany: mock.fn(async () => mockCompanyDays) },
} as unknown as PrismaTransactionClient;

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
    const result = await findNextFreeSlotFromDb(db, MACHINE, start, 4 * HOUR_MS);
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
    const result = await findNextFreeSlotFromDb(db, MACHINE, start, 4 * HOUR_MS);
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
    const result = await findNextFreeSlotFromDb(db, MACHINE, start, 4 * HOUR_MS);
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
    const result = await findNextFreeSlotFromDb(db, MACHINE, start, 4 * HOUR_MS);
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
    const r = await findNextFreePrintSlotFromDb(db, "XL_105", new Date("2026-09-15T10:00:00.000Z"), 240);
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
    const r = await findNextFreePrintSlotFromDb(db, "XL_105", new Date("2026-09-15T10:00:00.000Z"), 240);
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
    const r = await findNextFreePrintSlotFromDb(db, "XL_105", new Date("2026-09-15T10:00:00.000Z"), 240);
    assert.deepEqual(r, { found: false, reason: "MAX_SHIFT_EXCEEDED" });
  });
});

describe("findNextFreePrintSlotFromDb — okno kalendáře (week-boundary wrap, nález 3. 7.)", () => {
  beforeEach(() => {
    mockBlocks.length = 0;
    mockCompanyDays.length = 0;
    mockWeekShifts.length = 0;
  });

  it("start v pondělí ráno dotahuje weekShifts i PŘEDCHOZÍHO týdne (nedělní noc přes půlnoc)", async () => {
    weekShiftsFindManyMock.mock.resetCalls();
    // Po 21. 9. 2026 00:30 Praha = 2026-09-20T22:30Z — předchozí týden = 14. 9.
    await findNextFreePrintSlotFromDb(db, "XL_105", new Date("2026-09-20T22:30:00.000Z"), 60);
    const args = (weekShiftsFindManyMock.mock.calls as unknown as { arguments: [{ where: { weekStart: { in: Date[] } } }] }[])[0]!.arguments[0];
    const weeks = args.where.weekStart.in.map((d) => d.toISOString().slice(0, 10));
    assert.ok(weeks.includes("2026-09-14"), `chybí předchozí týden: ${weeks.join(", ")}`);
  });
});
