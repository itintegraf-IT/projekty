import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { resolveChainPushFromDb } from "./overlapResolver.server";

const H = (h: number) => new Date(`2026-06-16T${String(h).padStart(2, "0")}:00:00.000Z`);

describe("resolveChainPushFromDb", () => {
  it("posune navazující blok, zapíše ho a vrátí orderNumber + staré časy", async () => {
    const updateMock = mock.fn(async () => ({}));
    const tx = {
      block: {
        findMany: mock.fn(async () => [
          { id: 2, orderNumber: "17219", startTime: H(11), endTime: H(13), locked: false },
        ]),
        update: updateMock,
      },
      machineWeekShifts: { findMany: mock.fn(async () => []) },
      companyDay: { findMany: mock.fn(async () => []) },
    } as never;

    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) }, false);

    assert.equal(moves.length, 1);
    assert.equal(moves[0]!.id, 2);
    assert.equal(moves[0]!.orderNumber, "17219");
    assert.deepEqual(moves[0]!.startTime, H(12));
    assert.deepEqual(moves[0]!.endTime, H(14));
    // staré časy pro audit oldValue
    assert.deepEqual(moves[0]!.oldStartTime, H(11));
    assert.deepEqual(moves[0]!.oldEndTime, H(13));
    assert.equal(updateMock.mock.calls.length, 1);
  });

  it("žádná kolize → žádný update, prázdné moves", async () => {
    const updateMock = mock.fn(async () => ({}));
    const tx = {
      block: {
        findMany: mock.fn(async () => [
          { id: 2, orderNumber: "X", startTime: H(14), endTime: H(16), locked: false },
        ]),
        update: updateMock,
      },
      machineWeekShifts: { findMany: mock.fn(async () => []) },
      companyDay: { findMany: mock.fn(async () => []) },
    } as never;

    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) }, false);

    assert.equal(moves.length, 0);
    assert.equal(updateMock.mock.calls.length, 0);
  });

  it("excludeIds přidá bloky do notIn filtru (lasso: sourozenci se neposouvají)", async () => {
    const findManyMock = mock.fn(async () => []);
    const tx = {
      block: { findMany: findManyMock, update: mock.fn(async () => ({})) },
      machineWeekShifts: { findMany: mock.fn(async () => []) },
      companyDay: { findMany: mock.fn(async () => []) },
    } as never;

    await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) }, false, new Set([5, 7]));

    const where = (findManyMock.mock.calls as unknown as { arguments: [{ where: { id: { notIn: number[] } } }] }[])[0]!.arguments[0].where;
    assert.deepEqual(where.id.notIn, [1, 5, 7]);
  });

  it("posunutý blok by spadl do firemní odstávky → vyhodí SCHEDULE_VIOLATION", async () => {
    const updateMock = mock.fn(async () => ({}));
    const tx = {
      block: {
        findMany: mock.fn(async () => [
          { id: 2, orderNumber: "17219", startTime: H(11), endTime: H(13), locked: false },
        ]),
        update: updateMock,
      },
      machineWeekShifts: { findMany: mock.fn(async () => []) },
      // odstávka přesně tam, kam by se blok posunul (12–14)
      companyDay: { findMany: mock.fn(async () => [{ startDate: H(12), endDate: H(14) }]) },
    } as never;

    await assert.rejects(
      () => resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) }, false),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "SCHEDULE_VIOLATION");
        return true;
      },
    );
  });
});
