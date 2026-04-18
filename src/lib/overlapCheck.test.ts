import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("checkBlockOverlap", () => {
  let checkBlockOverlap: typeof import("@/lib/overlapCheck").checkBlockOverlap;

  beforeEach(async () => {
    const mod = await import("@/lib/overlapCheck");
    checkBlockOverlap = mod.checkBlockOverlap;
  });

  it("projde pokud žádný blok nekoliduje", async () => {
    const tx = {
      block: {
        findFirst: mock.fn(async () => null),
      },
    } as never;

    await assert.doesNotReject(() =>
      checkBlockOverlap("XL_105", new Date("2026-04-16T10:00:00Z"), new Date("2026-04-16T12:00:00Z"), 1, tx)
    );
  });

  it("vyhodí OVERLAP pokud blok koliduje", async () => {
    const tx = {
      block: {
        findFirst: mock.fn(async () => ({ id: 42, orderNumber: "17221" })),
      },
    } as never;

    await assert.rejects(
      () => checkBlockOverlap("XL_105", new Date("2026-04-16T10:00:00Z"), new Date("2026-04-16T12:00:00Z"), 1, tx),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "OVERLAP");
        assert.ok(err.message.includes("17221"));
        return true;
      }
    );
  });

  it("excludeBlockId=null funguje pro nové bloky", async () => {
    const findFirstMock = mock.fn(async () => null);
    const tx = { block: { findFirst: findFirstMock } } as never;

    await checkBlockOverlap("XL_105", new Date("2026-04-16T10:00:00Z"), new Date("2026-04-16T12:00:00Z"), null, tx);

    const whereArg = findFirstMock.mock.calls[0].arguments[0].where;
    assert.equal(whereArg.id, undefined, "excludeBlockId=null nesmí přidat id filter");
  });

  it("sousední bloky (dotýkají se) nepovažuje za overlap", async () => {
    const findFirstMock = mock.fn(async () => null);
    const tx = { block: { findFirst: findFirstMock } } as never;

    await checkBlockOverlap("XL_105", new Date("2026-04-16T12:00:00Z"), new Date("2026-04-16T14:00:00Z"), null, tx);

    const whereArg = findFirstMock.mock.calls[0].arguments[0].where;
    assert.deepEqual(whereArg.endTime, { gt: new Date("2026-04-16T12:00:00Z") });
  });
});
