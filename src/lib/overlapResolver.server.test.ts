import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { resolveChainPushFromDb } from "./overlapResolver.server";

const H = (h: number) => new Date(`2026-06-16T${String(h).padStart(2, "0")}:00:00.000Z`);

describe("resolveChainPushFromDb", () => {
  it("posune navazující blok a zapíše ho přes tx.block.update", async () => {
    const updateMock = mock.fn(async () => ({}));
    const tx = {
      block: {
        findMany: mock.fn(async () => [{ id: 2, startTime: H(11), endTime: H(13), locked: false }]),
        update: updateMock,
      },
      machineWeekShifts: { findMany: mock.fn(async () => []) },
    } as never;

    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) }, false);

    assert.equal(moves.length, 1);
    assert.deepEqual(moves[0], { id: 2, startTime: H(12), endTime: H(14) });
    assert.equal(updateMock.mock.calls.length, 1);
    const arg = (updateMock.mock.calls as unknown as { arguments: unknown[] }[])[0]!.arguments[0] as { where: { id: number }; data: { startTime: Date; endTime: Date } };
    assert.equal(arg.where.id, 2);
    assert.deepEqual(arg.data.startTime, H(12));
    assert.deepEqual(arg.data.endTime, H(14));
  });

  it("žádná kolize → žádný update, prázdné moves", async () => {
    const updateMock = mock.fn(async () => ({}));
    const tx = {
      block: {
        findMany: mock.fn(async () => [{ id: 2, startTime: H(14), endTime: H(16), locked: false }]),
        update: updateMock,
      },
      machineWeekShifts: { findMany: mock.fn(async () => []) },
    } as never;

    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) }, false);

    assert.equal(moves.length, 0);
    assert.equal(updateMock.mock.calls.length, 0);
  });
});
