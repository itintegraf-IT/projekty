import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { resolveChainPushFromDb } from "./overlapResolver.server";

// Úterý 16. 6. 2026, prázdné weekShifts → hardcoded fallback XL_105 (souvislý provoz).
const H = (h: number) => new Date(`2026-06-16T${String(h).padStart(2, "0")}:00:00.000Z`);

type Row = {
  id: number;
  orderNumber: string | null;
  startTime: Date;
  endTime: Date;
  locked: boolean;
  printCompletedAt: Date | null;
  printMinutes: number | null;
  scheduleBypassed: boolean;
};

const row = (id: number, start: number, end: number, opts: Partial<Row> = {}): Row => ({
  id,
  orderNumber: opts.orderNumber ?? String(17000 + id),
  startTime: H(start),
  endTime: H(end),
  locked: opts.locked ?? false,
  printCompletedAt: opts.printCompletedAt ?? null,
  printMinutes: opts.printMinutes ?? (end - start) * 60,
  scheduleBypassed: opts.scheduleBypassed ?? false,
});

function mkTx(rows: Row[], companyDays: { startDate: Date; endDate: Date }[] = []) {
  const updateMock = mock.fn(async () => ({}));
  const findManyMock = mock.fn(async () => rows);
  const tx = {
    block: { findMany: findManyMock, update: updateMock },
    machineWeekShifts: { findMany: mock.fn(async () => []) },
    companyDay: { findMany: mock.fn(async () => companyDays) },
  } as never;
  return { tx, updateMock, findManyMock };
}

describe("resolveChainPushFromDb", () => {
  it("posune navazující blok, zapíše ho a vrátí orderNumber + staré časy", async () => {
    const { tx, updateMock } = mkTx([row(2, 11, 13, { orderNumber: "17219" })]);

    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) });

    assert.equal(moves.length, 1);
    assert.equal(moves[0]!.id, 2);
    assert.equal(moves[0]!.orderNumber, "17219");
    assert.deepEqual(moves[0]!.startTime, H(12));
    assert.deepEqual(moves[0]!.endTime, H(14));
    assert.deepEqual(moves[0]!.oldStartTime, H(11));
    assert.deepEqual(moves[0]!.oldEndTime, H(13));
    assert.equal(updateMock.mock.calls.length, 1);
  });

  it("žádná kolize → žádný update, prázdné moves", async () => {
    const { tx, updateMock } = mkTx([row(2, 14, 16)]);
    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) });
    assert.equal(moves.length, 0);
    assert.equal(updateMock.mock.calls.length, 0);
  });

  it("excludeIds přidá bloky do notIn filtru (lasso: sourozenci se neposouvají)", async () => {
    const { tx, findManyMock } = mkTx([]);
    await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) }, new Set([5, 7]));
    const where = (findManyMock.mock.calls as unknown as { arguments: [{ where: { id: { notIn: number[] } } }] }[])[0]!.arguments[0].where;
    assert.deepEqual(where.id.notIn, [1, 5, 7]);
  });

  it("SEMANTIKA TISKOVÝCH HODIN: odstávka v cílovém místě NEshazuje transakci — start se snapne za ni", async () => {
    // Dřív: posun do odstávky → SCHEDULE_VIOLATION. Teď: start není runnable na odstávce,
    // snap ho posune na její konec (14:00) a end vyjde z expanze (16:00).
    const { tx, updateMock } = mkTx(
      [row(2, 11, 13, { orderNumber: "17219" })],
      [{ startDate: H(12), endDate: H(14) }]
    );

    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) });

    assert.equal(moves.length, 1);
    assert.deepEqual(moves[0]!.startTime, H(14));
    assert.deepEqual(moves[0]!.endTime, H(16));
    assert.equal(updateMock.mock.calls.length, 1);
  });

  it("anchor přes zamčený blok → AppError OVERLAP s orderNumber zamčeného bloku", async () => {
    const { tx, updateMock } = mkTx([row(9, 11, 13, { orderNumber: "R4735", locked: true })]);

    await assert.rejects(
      () => resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) }),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "OVERLAP");
        assert.ok(err.message.includes("R4735"), "hláška má jmenovat zamčený blok");
        return true;
      }
    );
    assert.equal(updateMock.mock.calls.length, 0);
  });

  it("vytištěný blok (printCompletedAt) se chová jako zamčený", async () => {
    await assert.rejects(
      () =>
        resolveChainPushFromDb(
          mkTx([row(9, 11, 13, { orderNumber: "DONE1", printCompletedAt: H(13) })]).tx,
          "XL_105",
          { id: 1, startTime: H(10), endTime: H(12) }
        ),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "OVERLAP");
        assert.ok(err.message.includes("DONE1"));
        return true;
      }
    );
  });

  it("korumpovaný blok (printMinutes <= 0) → AppError SCHEDULE_VIOLATION, ne 500", async () => {
    const { tx } = mkTx([row(2, 11, 13, { orderNumber: "BAD1", printMinutes: -1380 })]);
    await assert.rejects(
      () => resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) }),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "SCHEDULE_VIOLATION");
        assert.ok(err.message.includes("BAD1"));
        return true;
      }
    );
  });
});
