import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeChainPush, type BlockInterval } from "./overlapResolver";

// Helper: blok na 16. 6. 2026 v celých hodinách (UTC), default nezamčený.
const H = (h: number) => new Date(`2026-06-16T${String(h).padStart(2, "0")}:00:00.000Z`);
const blk = (id: number, start: number, end: number, locked = false): BlockInterval => ({
  id,
  startTime: H(start),
  endTime: H(end),
  locked,
});

describe("computeChainPush", () => {
  it("žádný překryv → žádné posuny", () => {
    const moves = computeChainPush(
      "XL_105",
      { id: 1, startTime: H(10), endTime: H(12) },
      [blk(2, 14, 16)],
      [],
      false,
    );
    assert.equal(moves.length, 0);
  });

  it("jeden navazující koliduje → posune se těsně za anchor", () => {
    const moves = computeChainPush(
      "XL_105",
      { id: 1, startTime: H(10), endTime: H(12) },
      [blk(2, 11, 13)],
      [],
      false,
    );
    assert.equal(moves.length, 1);
    assert.equal(moves[0].id, 2);
    assert.deepEqual(moves[0].startTime, H(12));
    assert.deepEqual(moves[0].endTime, H(14));
  });

  it("řetěz tří bloků se kaskádovitě odsune", () => {
    const moves = computeChainPush(
      "XL_105",
      { id: 1, startTime: H(10), endTime: H(12) },
      [blk(2, 11, 13), blk(3, 13, 15)],
      [],
      false,
    );
    assert.equal(moves.length, 2);
    assert.deepEqual(moves.find((m) => m.id === 2), { id: 2, startTime: H(12), endTime: H(14) });
    assert.deepEqual(moves.find((m) => m.id === 3), { id: 3, startTime: H(14), endTime: H(16) });
  });

  it("zamčený blok se nepřesune a navazující ho přeskočí", () => {
    const moves = computeChainPush(
      "XL_105",
      { id: 1, startTime: H(10), endTime: H(12) },
      [blk(2, 11, 13), blk(3, 13, 15, true)],
      [],
      false,
    );
    // zamčený blok 3 nesmí být v posunech
    assert.equal(moves.find((m) => m.id === 3), undefined);
    // blok 2 se posune ZA zamčený blok 3 (na 15–17)
    assert.deepEqual(moves.find((m) => m.id === 2), { id: 2, startTime: H(15), endTime: H(17) });
  });

  it("anchor se sám nikdy neobjeví v posunech", () => {
    const moves = computeChainPush(
      "XL_105",
      { id: 1, startTime: H(10), endTime: H(12) },
      [blk(1, 10, 12), blk(2, 11, 13)],
      [],
      false,
    );
    assert.equal(moves.find((m) => m.id === 1), undefined);
  });
});
