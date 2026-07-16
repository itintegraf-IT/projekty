import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { findIntraBatchOverlap, type BatchSpan } from "@/lib/overlapCheck";

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

    const whereArg = (findFirstMock.mock.calls as unknown as { arguments: [{ where: Record<string, unknown> }] }[])[0]!.arguments[0].where;
    assert.equal(whereArg.id, undefined, "excludeBlockId=null nesmí přidat id filter");
  });

  it("sousední bloky (dotýkají se) nepovažuje za overlap", async () => {
    const findFirstMock = mock.fn(async () => null);
    const tx = { block: { findFirst: findFirstMock } } as never;

    await checkBlockOverlap("XL_105", new Date("2026-04-16T12:00:00Z"), new Date("2026-04-16T14:00:00Z"), null, tx);

    const whereArg = (findFirstMock.mock.calls as unknown as { arguments: [{ where: Record<string, unknown> }] }[])[0]!.arguments[0].where;
    assert.deepEqual(whereArg.endTime, { gt: new Date("2026-04-16T12:00:00Z") });
  });
});

describe("assertNoOverlapForBlocks", () => {
  let assertNoOverlapForBlocks: typeof import("@/lib/overlapCheck").assertNoOverlapForBlocks;

  beforeEach(async () => {
    assertNoOverlapForBlocks = (await import("@/lib/overlapCheck")).assertNoOverlapForBlocks;
  });

  it("projde když žádný z dotčených bloků nekoliduje", async () => {
    const tx = {
      block: {
        findMany: mock.fn(async () => [
          { id: 1, orderNumber: "A", startTime: new Date("2026-04-16T10:00:00Z"), endTime: new Date("2026-04-16T12:00:00Z") },
        ]),
      },
      $queryRaw: mock.fn(async () => []),
    } as never;

    await assert.doesNotReject(() => assertNoOverlapForBlocks("XL_105", [1], tx));
  });

  it("vyhodí OVERLAP když některý z dotčených bloků koliduje", async () => {
    const tx = {
      block: {
        findMany: mock.fn(async () => [
          { id: 1, orderNumber: "A", startTime: new Date("2026-04-16T10:00:00Z"), endTime: new Date("2026-04-16T12:00:00Z") },
        ]),
      },
      $queryRaw: mock.fn(async () => [{ id: 99, orderNumber: "B" }]),
    } as never;

    await assert.rejects(
      () => assertNoOverlapForBlocks("XL_105", [1], tx),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "OVERLAP");
        return true;
      },
    );
  });

  it("prázdný seznam blockIds → žádný dotaz, projde", async () => {
    const findManyMock = mock.fn(async () => []);
    const tx = { block: { findMany: findManyMock }, $queryRaw: mock.fn(async () => []) } as never;

    await assert.doesNotReject(() => assertNoOverlapForBlocks("XL_105", [], tx));
  });

  it("vyhodí OVERLAP když koliduje až DRUHÝ blok v seznamu", async () => {
    let call = 0;
    const tx = {
      block: {
        findMany: mock.fn(async () => [
          { id: 1, orderNumber: "A", startTime: new Date("2026-04-16T10:00:00Z"), endTime: new Date("2026-04-16T11:00:00Z") },
          { id: 2, orderNumber: "B", startTime: new Date("2026-04-16T12:00:00Z"), endTime: new Date("2026-04-16T13:00:00Z") },
        ]),
      },
      // první blok bez kolize, druhý koliduje
      $queryRaw: mock.fn(async () => (++call === 1 ? [] : [{ id: 99, orderNumber: "C" }])),
    } as never;

    await assert.rejects(
      () => assertNoOverlapForBlocks("XL_105", [1, 2], tx),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "OVERLAP");
        assert.ok(err.message.includes("B"), "hláška má jmenovat kolidující blok B");
        return true;
      },
    );
  });

  it("net chytí překryv bez ohledu na typ bloku (type-agnostic invariant)", async () => {
    // assertNoOverlapForBlocks nezná a nikdy neznala `type` — pracuje čistě s ID a časy.
    // Tento test fixuje invariant proti budoucí regresi (např. kdyby někdo přidal typový
    // filtr do WHERE): "soused" v konfliktním řádku je UDRZBA blok, dotčený blok je
    // libovolného typu — net musí OVERLAP vyhodit stejně, jako by soused byl ZAKAZKA.
    const tx = {
      block: {
        findMany: mock.fn(async () => [
          { id: 5, orderNumber: "REZ-1", startTime: new Date("2026-04-16T10:00:00Z"), endTime: new Date("2026-04-16T12:00:00Z") },
        ]),
      },
      // konfliktní řádek reprezentuje UDRZBA blok na stejném stroji — $queryRaw v reálu
      // typ nefiltruje, mock to zrcadlí vrácením konfliktu bez ohledu na typ.
      $queryRaw: mock.fn(async () => [{ id: 77, orderNumber: "UDRZBA-3" }]),
    } as never;

    await assert.rejects(
      () => assertNoOverlapForBlocks("XL_105", [5], tx),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "OVERLAP");
        assert.ok(err.message.includes("UDRZBA-3"), "hláška má jmenovat kolidujícího souseda jiného typu");
        return true;
      },
    );
  });
});

describe("findIntraBatchOverlap", () => {
  const span = (id: number, machine: string, startH: number, endH: number): BatchSpan => ({
    id,
    orderNumber: `B${id}`,
    machine,
    start: new Date(`2026-06-16T${String(startH).padStart(2, "0")}:00:00Z`),
    end: new Date(`2026-06-16T${String(endH).padStart(2, "0")}:00:00Z`),
  });

  it("bez překryvu → null", () => {
    assert.equal(findIntraBatchOverlap([span(1, "XL_105", 10, 12), span(2, "XL_105", 12, 14)]), null);
  });

  it("překryv na stejném stroji → vrátí pár", () => {
    const pair = findIntraBatchOverlap([span(1, "XL_105", 10, 13), span(2, "XL_105", 12, 14)]);
    assert.ok(pair);
    assert.deepEqual([pair![0].id, pair![1].id], [1, 2]);
  });

  it("stejné časy na RŮZNÝCH strojích → null", () => {
    assert.equal(findIntraBatchOverlap([span(1, "XL_105", 10, 13), span(2, "XL_106", 12, 14)]), null);
  });

  it("obalený interval (ne-sousední po sortu) se chytí přes running max end", () => {
    // A 10–20 obaluje C 14–15; mezi nimi B 11–12 (uvnitř A) — running max end = A.end.
    const pair = findIntraBatchOverlap([span(1, "XL_105", 10, 20), span(2, "XL_105", 11, 12), span(3, "XL_105", 14, 15)]);
    assert.ok(pair);
    assert.equal(pair![0].id, 1);
  });

  it("dotýkající se bloky (half-open) → null", () => {
    assert.equal(findIntraBatchOverlap([span(1, "XL_105", 10, 12), span(2, "XL_105", 12, 14), span(3, "XL_105", 14, 16)]), null);
  });
});
