import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { reflowBlockInTx, reflowMachineInTx, MACHINE_REFLOW_WINDOW_DAYS, type ReflowOutcome } from "./reflow.server";
import type { AppliedMove } from "./overlapResolver.server";
import type { DriftedBlock } from "./calendarDrift.server";
import { offWeek, xl106Week, W1 } from "./weekShiftsTestFixtures";

// Úterý 16. 6. 2026, prázdné weekShifts → hardcoded fallback XL_105 (souvislý provoz
// mimo pátek noc 22–6, sobotu celou a všední noci 22–6 — viz overlapResolver.server.test.ts).
const H = (h: number) => new Date(`2026-06-16T${String(h).padStart(2, "0")}:00:00.000Z`);

const DAY_MS = 24 * 60 * 60 * 1000;

const actor = { id: 42, username: "planovac" };

type BlockRow = {
  id: number;
  orderNumber: string | null;
  machine: string;
  type: string;
  startTime: Date;
  endTime: Date;
  printMinutes: number | null;
  scheduleBypassed: boolean;
  locked: boolean;
  printCompletedAt: Date | null;
};

function mkBlock(overrides: Partial<BlockRow> = {}): BlockRow {
  return {
    id: 1,
    orderNumber: "17300",
    machine: "XL_105",
    type: "ZAKAZKA",
    startTime: H(10),
    endTime: H(12),
    printMinutes: 120,
    scheduleBypassed: false,
    locked: false,
    printCompletedAt: null,
    ...overrides,
  };
}

/**
 * Fake tx: obyčejné objekty s mock.fn (BEZ mock.module) — vzor overlapResolver.server.test.ts.
 * `block.findUnique` vrací `block`; `block.update`/`auditLog.create` jsou spy.
 * `machineWeekShifts.findMany`/`companyDay.findMany` slouží loadMachineCalendarRange (T1).
 */
function mkTx(
  block: BlockRow | null,
  opts: { weekShifts?: unknown[]; companyDays?: { startDate: Date; endDate: Date }[] } = {}
) {
  const findUniqueMock = mock.fn(async () => block);
  const updateMock = mock.fn(async (args: { data: { startTime: Date; endTime: Date } }) => ({
    ...block,
    ...args.data,
  }));
  const auditCreateMock = mock.fn(async (_args: { data: Record<string, unknown> }) => ({}));
  const auditCreateManyMock = mock.fn(async (args: { data: Record<string, unknown>[] }) => ({ count: args.data.length }));
  const tx = {
    block: { findUnique: findUniqueMock, update: updateMock },
    auditLog: { create: auditCreateMock, createMany: auditCreateManyMock },
    machineWeekShifts: { findMany: mock.fn(async () => opts.weekShifts ?? []) },
    companyDay: { findMany: mock.fn(async () => opts.companyDays ?? []) },
  } as never;
  return { tx, findUniqueMock, updateMock, auditCreateMock, auditCreateManyMock };
}

function mkDeps(moves: AppliedMove[] = []) {
  const resolveChainPush = mock.fn(async () => moves);
  return { resolveChainPush };
}

describe("reflowBlockInTx", () => {
  it("1) drifted blok (end nesedí, start runnable) → changed:true, update s re-expandovaným endem, audit AUTO_REFLOW se span old/new", async () => {
    // Uložený end (H(13)) neodpovídá expanzi 120 min od H(10) (=H(12)) — drift.
    const block = mkBlock({ startTime: H(10), endTime: H(13), printMinutes: 120 });
    const { tx, updateMock, auditCreateMock } = mkTx(block);
    const deps = mkDeps();

    const result = await reflowBlockInTx(tx, 1, actor, deps);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.changed, true);
    assert.deepEqual(result.startTime, H(10));
    assert.deepEqual(result.endTime, H(12));
    assert.deepEqual(result.moves, []);

    assert.equal(updateMock.mock.calls.length, 1);
    const updateArgs = updateMock.mock.calls[0]!.arguments[0] as { where: { id: number }; data: { startTime: Date; endTime: Date } };
    assert.equal(updateArgs.where.id, 1);
    assert.deepEqual(updateArgs.data.startTime, H(10));
    assert.deepEqual(updateArgs.data.endTime, H(12));

    assert.equal(auditCreateMock.mock.calls.length, 1);
    const auditArgs = auditCreateMock.mock.calls[0]!.arguments[0] as { data: Record<string, unknown> };
    assert.equal(auditArgs.data.blockId, 1);
    assert.equal(auditArgs.data.action, "AUTO_REFLOW");
    assert.equal(auditArgs.data.field, "startTime/endTime");
    assert.equal(auditArgs.data.oldValue, `${H(10).toISOString()}–${H(13).toISOString()}`);
    assert.equal(auditArgs.data.newValue, `${H(10).toISOString()}–${H(12).toISOString()}`);
    assert.equal(auditArgs.data.userId, actor.id);
    assert.equal(auditArgs.data.username, actor.username);

    assert.equal(deps.resolveChainPush.mock.calls.length, 1);
  });

  it("1b) drifted blok s chain-push moves → 1× AUTO_REFLOW create + 1× createMany se 2 AUTO_SHIFT řádky, en-dash span", async () => {
    const block = mkBlock({ startTime: H(10), endTime: H(13), printMinutes: 120 });
    const { tx, auditCreateMock, auditCreateManyMock } = mkTx(block);
    // Hodnoty odsunutých bloků na dalším dni (H() pokrývá jen 0–23h) — nesouvisí s
    // reflow kalendářem, jsou to jen fixní hodnoty vracené mockovaným resolveChainPush.
    const oldStart1 = new Date("2026-06-17T20:00:00.000Z");
    const oldEnd1 = new Date("2026-06-17T22:00:00.000Z");
    const newStart1 = new Date("2026-06-17T23:00:00.000Z");
    const newEnd1 = new Date("2026-06-18T01:00:00.000Z");
    const oldStart2 = new Date("2026-06-18T06:00:00.000Z");
    const oldEnd2 = new Date("2026-06-18T08:00:00.000Z");
    const newStart2 = new Date("2026-06-18T09:00:00.000Z");
    const newEnd2 = new Date("2026-06-18T11:00:00.000Z");
    const moves: AppliedMove[] = [
      { id: 101, orderNumber: "MOVE-101", startTime: newStart1, endTime: newEnd1, oldStartTime: oldStart1, oldEndTime: oldEnd1 },
      { id: 102, orderNumber: "MOVE-102", startTime: newStart2, endTime: newEnd2, oldStartTime: oldStart2, oldEndTime: oldEnd2 },
    ];
    const deps = mkDeps(moves);

    const result = await reflowBlockInTx(tx, 1, actor, deps);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.moves, moves);

    assert.equal(auditCreateMock.mock.calls.length, 1); // AUTO_REFLOW pro reflownutý blok samotný

    assert.equal(auditCreateManyMock.mock.calls.length, 1);
    const createManyArgs = auditCreateManyMock.mock.calls[0]!.arguments[0] as { data: Record<string, unknown>[] };
    assert.equal(createManyArgs.data.length, 2);

    const row0 = createManyArgs.data[0]!;
    assert.equal(row0.blockId, 101);
    assert.equal(row0.orderNumber, "MOVE-101");
    assert.equal(row0.userId, actor.id);
    assert.equal(row0.username, actor.username);
    assert.equal(row0.action, "AUTO_SHIFT");
    assert.equal(row0.field, "startTime/endTime");
    assert.equal(row0.oldValue, `${oldStart1.toISOString()}–${oldEnd1.toISOString()}`);
    assert.equal(row0.newValue, `${newStart1.toISOString()}–${newEnd1.toISOString()}`);

    const row1 = createManyArgs.data[1]!;
    assert.equal(row1.blockId, 102);
    assert.equal(row1.orderNumber, "MOVE-102");
    assert.equal(row1.oldValue, `${oldStart2.toISOString()}–${oldEnd2.toISOString()}`);
    assert.equal(row1.newValue, `${newStart2.toISOString()}–${newEnd2.toISOString()}`);
  });

  it("1c) moves prázdné → createMany se NEvolá (guard)", async () => {
    const block = mkBlock({ startTime: H(10), endTime: H(13), printMinutes: 120 });
    const { tx, auditCreateMock, auditCreateManyMock } = mkTx(block);
    const deps = mkDeps([]);

    const result = await reflowBlockInTx(tx, 1, actor, deps);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.moves, []);
    assert.equal(auditCreateMock.mock.calls.length, 1); // AUTO_REFLOW pořád proběhne
    assert.equal(auditCreateManyMock.mock.calls.length, 0);
  });

  it("2) blok sedí → changed:false, žádný block.update/auditLog.create", async () => {
    // H(10)+120min přes souvislý provoz = H(12) — přesně jak je uložený end.
    const block = mkBlock({ startTime: H(10), endTime: H(12), printMinutes: 120 });
    const { tx, updateMock, auditCreateMock, auditCreateManyMock } = mkTx(block);
    const deps = mkDeps();

    const result = await reflowBlockInTx(tx, 1, actor, deps);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.changed, false);
    assert.deepEqual(result.startTime, H(10));
    assert.deepEqual(result.endTime, H(12));
    assert.deepEqual(result.moves, []);

    assert.equal(updateMock.mock.calls.length, 0);
    assert.equal(auditCreateMock.mock.calls.length, 0);
    assert.equal(auditCreateManyMock.mock.calls.length, 0);
    assert.equal(deps.resolveChainPush.mock.calls.length, 0);
  });

  it("3) start mimo provoz → snap na další runnable slot + expanze; update start i end", async () => {
    // Celý týden W1 vypnutý (offWeek) na XL_106 kromě pondělí odpoledne+noc — start je
    // v sobotu (mimo provoz), snap ho posune na nejbližší runnable slot v následujícím týdnu.
    const weekShifts = [
      ...offWeek(W1).map((d) => ({ ...d, machine: "XL_106" })),
      ...xl106Week("2026-08-24").map((d) => ({ ...d, machine: "XL_106" })), // příští týden = normální provoz
    ];
    // Sobota 22. 8. 2026 10:00 — offWeek → mimo provoz.
    const start = new Date("2026-08-22T10:00:00.000Z");
    const block = mkBlock({ id: 2, machine: "XL_106", startTime: start, endTime: new Date(start.getTime() + 120 * 60000), printMinutes: 120 });
    const { tx, updateMock, auditCreateMock } = mkTx(block, { weekShifts });
    const deps = mkDeps();

    const result = await reflowBlockInTx(tx, 2, actor, deps);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.changed, true);
    // Nový start musí být přísně po starém (posun dopředu) a runnable.
    assert.ok(result.startTime.getTime() > start.getTime());
    assert.equal(updateMock.mock.calls.length, 1);
    const updateArgs = updateMock.mock.calls[0]!.arguments[0] as { data: { startTime: Date; endTime: Date } };
    assert.deepEqual(updateArgs.data.startTime, result.startTime);
    assert.deepEqual(updateArgs.data.endTime, result.endTime);
    assert.equal(auditCreateMock.mock.calls.length, 1);
  });

  it("4) zamčený blok → { ok:false, code:'LOCKED' }, žádné zápisy", async () => {
    const block = mkBlock({ locked: true, startTime: H(10), endTime: H(13) });
    const { tx, updateMock, auditCreateMock } = mkTx(block);
    const deps = mkDeps();

    const result = await reflowBlockInTx(tx, 1, actor, deps);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "LOCKED");
    assert.equal(updateMock.mock.calls.length, 0);
    assert.equal(auditCreateMock.mock.calls.length, 0);
    assert.equal(deps.resolveChainPush.mock.calls.length, 0);
  });

  it("5) vytištěný blok (printCompletedAt) → { ok:false, code:'PRINTED' }, žádné zápisy", async () => {
    const block = mkBlock({ printCompletedAt: H(13), startTime: H(10), endTime: H(13) });
    const { tx, updateMock, auditCreateMock } = mkTx(block);
    const deps = mkDeps();

    const result = await reflowBlockInTx(tx, 1, actor, deps);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "PRINTED");
    assert.equal(updateMock.mock.calls.length, 0);
    assert.equal(auditCreateMock.mock.calls.length, 0);
  });

  it("6) snap nenajde slot do 7 dnů (off kalendář) → NO_SLOT, žádné zápisy", async () => {
    // Celé okno [start, start+7d] vypnuté na obou dotčených týdnech → snap selže.
    const weekShifts = [
      ...offWeek(W1).map((d) => ({ ...d, machine: "XL_106" })),
      ...offWeek("2026-08-24").map((d) => ({ ...d, machine: "XL_106" })),
      ...offWeek("2026-08-10").map((d) => ({ ...d, machine: "XL_106" })),
    ];
    const start = new Date("2026-08-17T10:00:00.000Z"); // pondělí W1, ale offWeek → mimo provoz
    const block = mkBlock({ id: 3, machine: "XL_106", startTime: start, endTime: new Date(start.getTime() + 120 * 60000), printMinutes: 120 });
    const { tx, updateMock, auditCreateMock } = mkTx(block, { weekShifts });
    const deps = mkDeps();

    const result = await reflowBlockInTx(tx, 3, actor, deps);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NO_SLOT");
    assert.equal(updateMock.mock.calls.length, 0);
    assert.equal(auditCreateMock.mock.calls.length, 0);
    assert.equal(deps.resolveChainPush.mock.calls.length, 0);
  });

  it("NOT_FOUND: neexistující blok", async () => {
    const { tx, updateMock } = mkTx(null);
    const result = await reflowBlockInTx(tx, 999, actor, mkDeps());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
    assert.equal(updateMock.mock.calls.length, 0);
  });

  it("NOT_ZAKAZKA: blok typu UDRZBA", async () => {
    const block = mkBlock({ type: "UDRZBA" });
    const { tx } = mkTx(block);
    const result = await reflowBlockInTx(tx, 1, actor, mkDeps());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_ZAKAZKA");
  });

  it("BYPASS: blok se scheduleBypassed=true se nepřepočítává", async () => {
    const block = mkBlock({ scheduleBypassed: true });
    const { tx } = mkTx(block);
    const result = await reflowBlockInTx(tx, 1, actor, mkDeps());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "BYPASS");
  });

  it("NO_PM: printMinutes null", async () => {
    const block = mkBlock({ printMinutes: null });
    const { tx } = mkTx(block);
    const result = await reflowBlockInTx(tx, 1, actor, mkDeps());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NO_PM");
  });

  it("NO_PM: printMinutes <= 0", async () => {
    const block = mkBlock({ printMinutes: 0 });
    const { tx } = mkTx(block);
    const result = await reflowBlockInTx(tx, 1, actor, mkDeps());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NO_PM");
  });

  it("UNALIGNED: start nezarovnaný na 30min hranici", async () => {
    const unaligned = new Date(H(10).getTime() + 5 * 60000); // 10:05
    const block = mkBlock({ startTime: unaligned, endTime: new Date(unaligned.getTime() + 120 * 60000) });
    const { tx } = mkTx(block);
    const result = await reflowBlockInTx(tx, 1, actor, mkDeps());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "UNALIGNED");
  });

  it("chain push kolize se zamčeným blokem bublá jako AppError (netransformuje se na ok:false)", async () => {
    const block = mkBlock({ startTime: H(10), endTime: H(13), printMinutes: 120 });
    const { tx, auditCreateManyMock } = mkTx(block);
    const { AppError } = await import("./errors");
    const resolveChainPush = mock.fn(async () => {
      throw new AppError("OVERLAP", "Nelze uvolnit místo — koliduje se zamčeným blokem #999.");
    });

    await assert.rejects(
      () => reflowBlockInTx(tx, 1, actor, { resolveChainPush }),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "OVERLAP");
        return true;
      }
    );
    assert.equal(auditCreateManyMock.mock.calls.length, 0); // error letí před audit zápisy
  });
});

describe("reflowMachineInTx", () => {
  /** Fake tx — reflowMachineInTx samo o sobě čte jen kalendář (loadMachineCalendarRange
   * pro preloadedCalendar, T6), zbytek předává injektovaným deps (reflowBlock/detectDrift).
   * machineWeekShifts/companyDay mock.fn slouží zároveň jako počítadlo volání loaderu. */
  function mkFakeTx(opts: { weekShifts?: unknown[]; companyDays?: { startDate: Date; endDate: Date }[] } = {}) {
    const weekShiftsFindMany = mock.fn(async () => opts.weekShifts ?? []);
    const companyDayFindMany = mock.fn(async (_args: { where: { endDate: { gt: Date } } }) => opts.companyDays ?? []);
    const tx = {
      machineWeekShifts: { findMany: weekShiftsFindMany },
      companyDay: { findMany: companyDayFindMany },
    } as never;
    return { tx, weekShiftsFindMany, companyDayFindMany };
  }
  const fakeTx = mkFakeTx().tx;

  function mkDrift(id: number, startTime: Date, orderNumber = `ORD-${id}`): DriftedBlock {
    return {
      id,
      orderNumber,
      machine: "XL_105",
      startTime,
      endTime: new Date(startTime.getTime() + 120 * 60000),
      expectedEnd: new Date(startTime.getTime() + 100 * 60000),
      reason: "END_MISMATCH",
    };
  }

  function mkMove(id: number): AppliedMove {
    return {
      id,
      startTime: H(20),
      endTime: H(22),
      orderNumber: `MOVE-${id}`,
      oldStartTime: H(18),
      oldEndTime: H(20),
    };
  }

  it("1) dva drifted bloky → oba reflowed, voláno chronologicky v pořadí startTime asc", async () => {
    const drift1 = mkDrift(1, H(10));
    const drift2 = mkDrift(2, H(14));
    const detectDrift = mock.fn(async (_db: unknown, _machines: string[], _windowStart: Date, _windowEnd: Date, _now: Date) => [
      drift1,
      drift2,
    ]);

    const callOrder: number[] = [];
    const reflowBlock = mock.fn(async (_tx: unknown, blockId: number): Promise<ReflowOutcome> => {
      callOrder.push(blockId);
      return { ok: true, changed: true, startTime: H(10), endTime: H(12), moves: [] };
    });

    const now = H(0);
    const result = await reflowMachineInTx(fakeTx, "XL_105", actor, now, { reflowBlock, detectDrift });

    assert.deepEqual(callOrder, [1, 2]); // chronologické pořadí (detectDrift ho tak už vrací)
    assert.equal(result.reflowed.length, 2);
    assert.deepEqual(result.reflowed.map((r) => r.id).sort(), [1, 2]);
    assert.equal(result.reflowed.find((r) => r.id === 1)?.orderNumber, "ORD-1");
    assert.equal(result.skipped.length, 0);
    assert.deepEqual(result.movedIds, []); // moves:[] u obou → žádné dodatečné refetch id

    assert.equal(detectDrift.mock.calls.length, 1);
    const detectArgs = detectDrift.mock.calls[0]!.arguments;
    assert.deepEqual(detectArgs[1], ["XL_105"]);
    assert.deepEqual(detectArgs[4], now);
  });

  it("1d) okno detekce driftu je přesně [now, now + MACHINE_REFLOW_WINDOW_DAYS d) — pin proti tiché změně", async () => {
    // `now` jde do reflowMachineInTx jako explicitní parametr (ne přes deps) — lze
    // assertnout přesné hranice okna, ne jen toleranci (souřadnice zachytí sám
    // reflowMachineInTx, ne DB — detectDrift je mock, žádný skutečný findMany).
    const detectDrift = mock.fn(async (_db: unknown, _machines: string[], _windowStart: Date, _windowEnd: Date, _now: Date) => []);
    const reflowBlock = mock.fn(async (): Promise<ReflowOutcome> => {
      throw new Error("nemělo se volat — žádný drift");
    });

    const now = H(0);
    await reflowMachineInTx(fakeTx, "XL_105", actor, now, { reflowBlock, detectDrift });

    assert.equal(detectDrift.mock.calls.length, 1);
    const [, , windowStart, windowEnd] = detectDrift.mock.calls[0]!.arguments;

    // Sanity: konstanta je pořád 365 (komentář, ne zdroj pravdy assertu).
    assert.equal(MACHINE_REFLOW_WINDOW_DAYS, 365);

    assert.deepEqual(windowStart, now);
    assert.deepEqual(windowEnd, new Date(now.getTime() + MACHINE_REFLOW_WINDOW_DAYS * 86_400_000));
    assert.equal(windowEnd.getTime() - windowStart.getTime(), MACHINE_REFLOW_WINDOW_DAYS * 86_400_000);
  });

  it("2) drifted + zamčený drifted → 1 reflowed, 1 skipped LOCKED, žádný abort (chyba se nepropaguje)", async () => {
    const drift1 = mkDrift(1, H(10));
    const drift2 = mkDrift(2, H(14));
    const detectDrift = mock.fn(async () => [drift1, drift2]);

    const reflowBlock = mock.fn(async (_tx: unknown, blockId: number): Promise<ReflowOutcome> => {
      if (blockId === 2) {
        return { ok: false, code: "LOCKED", message: "Zamčený blok nelze přepočítat — nejdřív ho odemkni." };
      }
      return { ok: true, changed: true, startTime: H(10), endTime: H(12), moves: [] };
    });

    const result = await reflowMachineInTx(fakeTx, "XL_105", actor, H(0), { reflowBlock, detectDrift });

    assert.equal(result.reflowed.length, 1);
    assert.equal(result.reflowed[0]!.id, 1);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]!.id, 2);
    assert.equal(result.skipped[0]!.orderNumber, "ORD-2");
    assert.equal(result.skipped[0]!.reason, "LOCKED");
  });

  it("3) žádný drift → prázdné výsledky, nula zápisů (reflowBlock se nevolá), detectDrift 1×", async () => {
    const detectDrift = mock.fn(async () => []);
    const reflowBlock = mock.fn(async (): Promise<ReflowOutcome> => {
      throw new Error("nemělo se volat");
    });

    const result = await reflowMachineInTx(fakeTx, "XL_106", actor, H(0), { reflowBlock, detectDrift });

    assert.deepEqual(result.reflowed, []);
    assert.deepEqual(result.skipped, []);
    assert.equal(reflowBlock.mock.calls.length, 0);
    assert.equal(detectDrift.mock.calls.length, 1);
  });

  it("4) druhý drifted blok mezitím srovnal chain push prvního (changed:false) → není v reflowed ani skipped", async () => {
    const drift1 = mkDrift(1, H(10));
    const drift2 = mkDrift(2, H(14));
    const detectDrift = mock.fn(async () => [drift1, drift2]);

    const reflowBlock = mock.fn(async (_tx: unknown, blockId: number): Promise<ReflowOutcome> => {
      if (blockId === 1) {
        return { ok: true, changed: true, startTime: H(10), endTime: H(12), moves: [mkMove(2)] };
      }
      // Blok 2 byl posunut chain pushem bloku 1 a mezitím na kalendář sedí.
      return { ok: true, changed: false, startTime: H(20), endTime: H(22), moves: [] };
    });

    const result = await reflowMachineInTx(fakeTx, "XL_105", actor, H(0), { reflowBlock, detectDrift });

    assert.equal(result.reflowed.length, 1);
    assert.equal(result.reflowed[0]!.id, 1);
    assert.equal(result.skipped.length, 0); // blok 2 nikam nezařazen (ani reflowed, ani skipped)
    // Blok 2 přesto MUSÍ být v movedIds — route ho potřebuje pro refetch/SSE, i když
    // sám nebyl reflownutý (posunul ho jen chain push bloku 1).
    assert.deepEqual(result.movedIds, [2]);
  });

  it("5) AppError z reflowBlock (kolize chain pushe) probublá z reflowMachineInTx ven", async () => {
    const drift1 = mkDrift(1, H(10));
    const detectDrift = mock.fn(async () => [drift1]);

    const reflowBlock = mock.fn(async (): Promise<ReflowOutcome> => {
      const { AppError } = await import("./errors");
      throw new AppError("OVERLAP", "Nelze uvolnit místo — koliduje se zamčeným blokem #999.");
    });

    await assert.rejects(
      () => reflowMachineInTx(fakeTx, "XL_105", actor, H(0), { reflowBlock, detectDrift }),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "OVERLAP");
        return true;
      }
    );
  });

  it("6) preloadedCalendar (T6): 3 drifted bloky → kalendářový loader (machineWeekShifts.findMany) voláno právě 1×, ne 3×", async () => {
    const { tx, weekShiftsFindMany, companyDayFindMany } = mkFakeTx();
    const drift1 = mkDrift(1, H(10));
    const drift2 = mkDrift(2, H(12));
    const drift3 = mkDrift(3, H(14));
    const detectDrift = mock.fn(async () => [drift1, drift2, drift3]);

    const receivedCalendars: unknown[] = [];
    const reflowBlock = mock.fn(
      async (_tx: unknown, _blockId: number, _actor: unknown, deps?: { preloadedCalendar?: unknown }): Promise<ReflowOutcome> => {
        receivedCalendars.push(deps?.preloadedCalendar);
        return { ok: true, changed: true, startTime: H(10), endTime: H(12), moves: [] };
      }
    );

    const result = await reflowMachineInTx(tx, "XL_105", actor, H(0), { reflowBlock, detectDrift });

    assert.equal(result.reflowed.length, 3);
    // Loader (loadMachineCalendarRange → machineWeekShifts.findMany/companyDay.findMany)
    // volaný právě JEDNOU pro celý běh, ne 1× per drifted blok (výkonová oprava T6).
    assert.equal(weekShiftsFindMany.mock.calls.length, 1);
    assert.equal(companyDayFindMany.mock.calls.length, 1);
    // Všechny 3 volání reflowBlock dostanou TENTÝŽ preloadedCalendar objekt (žádný z nich
    // si netáhne vlastní kalendář).
    assert.equal(receivedCalendars.length, 3);
    assert.ok(receivedCalendars[0] !== undefined);
    assert.equal(receivedCalendars[0], receivedCalendars[1]);
    assert.equal(receivedCalendars[1], receivedCalendars[2]);
  });

  it("7) drifted blok s startTime v minulosti (now−5d) → loader dostane from ≤ startTime (I-1 fix)", async () => {
    // `detectCalendarDrift` vrací i BĚŽÍCÍ bloky se startem hluboko v minulosti (filtr
    // startTime < windowEnd && endTime > max(windowStart, now)) — kotva kalendáře
    // proto nesmí být jen `now−1d`, musí sahat i za nejstarší drifted startTime.
    const { tx, companyDayFindMany } = mkFakeTx();
    const now = H(0);
    const oldStart = new Date(now.getTime() - 5 * DAY_MS); // start 5 dní před now
    const runningDrift = mkDrift(1, oldStart);
    const detectDrift = mock.fn(async () => [runningDrift]);
    const reflowBlock = mock.fn(async (): Promise<ReflowOutcome> => ({ ok: true, changed: true, startTime: H(10), endTime: H(12), moves: [] }));

    await reflowMachineInTx(tx, "XL_105", actor, now, { reflowBlock, detectDrift });

    assert.equal(companyDayFindMany.mock.calls.length, 1);
    // loadMachineCalendarRange volá companyDay.findMany s `endDate: { gt: from }` — `from`
    // je tedy přímo čitelné z argumentu (= calendarStart z reflowMachineInTx). Musí sahat
    // aspoň na startTime nejstaršího drifted bloku (BEZ dalšího odečtení −1d zde —
    // loadMachineCalendarRange si k `from` sama přidá interní −1d kotvu pro noční směnu
    // přes půlnoc, viz printTime.server.ts — to pokrytí `startTime−1d` zajistí uvnitř).
    // Před fixem I-1 by `from` bylo `now−1d` (2026-06-15), tedy PO `oldStart` — tenhle
    // assert by na starém kódu spadl.
    const cdArgs = companyDayFindMany.mock.calls[0]!.arguments[0];
    const from = cdArgs.where.endDate.gt;
    assert.ok(
      from.getTime() <= oldStart.getTime(),
      `from (${from.toISOString()}) musí být ≤ startTime nejstaršího drifted bloku (${oldStart.toISOString()})`
    );
  });

  it("8) drifted=[] → loader (loadMachineCalendarRange) se VŮBEC nevolá (M-C fix)", async () => {
    const { tx, weekShiftsFindMany, companyDayFindMany } = mkFakeTx();
    const detectDrift = mock.fn(async () => []);
    const reflowBlock = mock.fn(async (): Promise<ReflowOutcome> => {
      throw new Error("nemělo se volat — žádný drift");
    });

    const result = await reflowMachineInTx(tx, "XL_105", actor, H(0), { reflowBlock, detectDrift });

    assert.deepEqual(result.reflowed, []);
    assert.deepEqual(result.skipped, []);
    assert.equal(weekShiftsFindMany.mock.calls.length, 0);
    assert.equal(companyDayFindMany.mock.calls.length, 0);
  });
});
