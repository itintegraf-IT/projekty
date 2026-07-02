import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeChainPush, type BlockInterval } from "./overlapResolver";
import { pragueToUTC } from "./dateUtils";
import type { CompanyDayInterval } from "./printTime";
import { xl106Week, W1, W2 } from "./weekShiftsTestFixtures";

// ── Jednoduché scénáře: úterý 16. 6. 2026, prázdné weekShifts → hardcoded
// fallback XL_105 (24/7 mimo neděli odpoledne) = souvislý provoz. ────────────
const H = (h: number) => new Date(`2026-06-16T${String(h).padStart(2, "0")}:00:00.000Z`);
const blk = (
  id: number,
  start: number,
  end: number,
  opts: { locked?: boolean; pm?: number; bypassed?: boolean } = {}
): BlockInterval => ({
  id,
  startTime: H(start),
  endTime: H(end),
  locked: opts.locked ?? false,
  printMinutes: opts.pm ?? (end - start) * 60,
  scheduleBypassed: opts.bypassed ?? false,
});
const NO_CD: CompanyDayInterval[] = [];

// ── Víkendové scénáře: XL_106 s odstávkou Pá 22:00 – Ne 22:00 (Praha). ──────
const SHIFTS = [...xl106Week(W1), ...xl106Week(W2)];
const P = pragueToUTC; // P("2026-08-21", 18) = pátek 18:00 Praha

describe("computeChainPush — souvislý provoz (fallback 24/7)", () => {
  it("žádný překryv → ok, žádné posuny", () => {
    const r = computeChainPush("XL_105", { id: 1, startTime: H(10), endTime: H(12) }, [blk(2, 14, 16)], [], NO_CD);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.moves.length, 0);
  });

  it("jeden navazující koliduje → posune se těsně za anchor", () => {
    const r = computeChainPush("XL_105", { id: 1, startTime: H(10), endTime: H(12) }, [blk(2, 11, 13)], [], NO_CD);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.moves.length, 1);
      assert.deepEqual(r.moves[0], { id: 2, startTime: H(12), endTime: H(14) });
    }
  });

  it("řetěz tří bloků se kaskádovitě odsune", () => {
    const r = computeChainPush(
      "XL_105",
      { id: 1, startTime: H(10), endTime: H(12) },
      [blk(2, 11, 13), blk(3, 13, 15)],
      [],
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.moves.length, 2);
      assert.deepEqual(r.moves.find((m) => m.id === 2), { id: 2, startTime: H(12), endTime: H(14) });
      assert.deepEqual(r.moves.find((m) => m.id === 3), { id: 3, startTime: H(14), endTime: H(16) });
    }
  });

  it("zamčený blok se nepřesune a navazující ho přeskočí", () => {
    const r = computeChainPush(
      "XL_105",
      { id: 1, startTime: H(10), endTime: H(12) },
      [blk(2, 11, 13), blk(3, 13, 15, { locked: true })],
      [],
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.moves.find((m) => m.id === 3), undefined);
      assert.deepEqual(r.moves.find((m) => m.id === 2), { id: 2, startTime: H(15), endTime: H(17) });
    }
  });

  it("anchor se sám nikdy neobjeví v posunech", () => {
    const r = computeChainPush(
      "XL_105",
      { id: 1, startTime: H(10), endTime: H(12) },
      [blk(1, 10, 12), blk(2, 11, 13)],
      [],
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.moves.find((m) => m.id === 1), undefined);
  });

  it("anchor koliduje se zamčeným blokem → LOCKED_CONFLICT s id viníka", () => {
    const r = computeChainPush(
      "XL_105",
      { id: 1, startTime: H(10), endTime: H(18) },
      [blk(9, 16, 20, { locked: true })],
      [],
      NO_CD
    );
    assert.deepEqual(r, { ok: false, reason: "LOCKED_CONFLICT", lockedId: 9 });
  });

  it("korumpovaný blok (printMinutes <= 0) → PLACEMENT_FAILED, žádný raw throw", () => {
    const r = computeChainPush(
      "XL_105",
      { id: 1, startTime: H(10), endTime: H(12) },
      [blk(2, 11, 13, { pm: -1380 })],
      [],
      NO_CD
    );
    assert.deepEqual(r, { ok: false, reason: "PLACEMENT_FAILED", blockId: 2 });
  });
});

describe("computeChainPush — re-expanze přes víkendovou odstávku (XL_106)", () => {
  it("odsunutý blok pauzne přes víkend — end se prodlouží expanzí", () => {
    // Anchor Pá 10–18; blok B (6 h tisku, původně Pá 12–18) se odsune na Pá 18:00.
    // Expanze: Pá 18–22 = 4 h tisk, pauza Pá 22 – Ne 22, Ne 22–24 = 2 h → end Po 00:00.
    const r = computeChainPush(
      "XL_106",
      { id: 1, startTime: P("2026-08-21", 10), endTime: P("2026-08-21", 18) },
      [{ id: 2, startTime: P("2026-08-21", 12), endTime: P("2026-08-21", 18), locked: false, printMinutes: 360, scheduleBypassed: false }],
      SHIFTS,
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.moves.length, 1);
      assert.deepEqual(r.moves[0], { id: 2, startTime: P("2026-08-21", 18), endTime: P("2026-08-24", 0) });
    }
  });

  it("přeskok za zamčený blok se počítá z re-expandovaného spanu", () => {
    // Zamčený C Pá 18–20. B (6 h) od Pá 18 by expandoval do Po 00:00 → koliduje s C
    // → kurzor za C (Pá 20). Expanze: Pá 20–22 = 2 h, pauza, Ne 22–24 = 2 h, Po 0–2 = 2 h → Po 02:00.
    const r = computeChainPush(
      "XL_106",
      { id: 1, startTime: P("2026-08-21", 10), endTime: P("2026-08-21", 18) },
      [
        { id: 2, startTime: P("2026-08-21", 12), endTime: P("2026-08-21", 18), locked: false, printMinutes: 360, scheduleBypassed: false },
        { id: 3, startTime: P("2026-08-21", 18), endTime: P("2026-08-21", 20), locked: true, printMinutes: 120, scheduleBypassed: false },
      ],
      SHIFTS,
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.moves.find((m) => m.id === 3), undefined);
      assert.deepEqual(r.moves.find((m) => m.id === 2), {
        id: 2,
        startTime: P("2026-08-21", 20),
        endTime: P("2026-08-24", 2),
      });
    }
  });

  it("scheduleBypassed blok se posouvá souvisle (bez pauz) i přes odstávku směn", () => {
    // Anchor Pá 10–22. Bypass blok B (4 h) → položí se na Pá 22:00 souvisle do So 02:00,
    // přestože směny nejedou (bypass = vědomě mimo kalendář, mimořádná směna).
    const r = computeChainPush(
      "XL_106",
      { id: 1, startTime: P("2026-08-21", 10), endTime: P("2026-08-21", 22) },
      [{ id: 2, startTime: P("2026-08-21", 12), endTime: P("2026-08-21", 16), locked: false, printMinutes: 240, scheduleBypassed: true }],
      SHIFTS,
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.moves[0], { id: 2, startTime: P("2026-08-21", 22), endTime: P("2026-08-22", 2) });
    }
  });

  it("bypass blok NIKDY nepřistane na firemní odstávce — přeskočí za ni", () => {
    const cd: CompanyDayInterval[] = [{ start: P("2026-08-21", 22), end: P("2026-08-22", 6) }];
    const r = computeChainPush(
      "XL_106",
      { id: 1, startTime: P("2026-08-21", 10), endTime: P("2026-08-21", 22) },
      [{ id: 2, startTime: P("2026-08-21", 12), endTime: P("2026-08-21", 16), locked: false, printMinutes: 240, scheduleBypassed: true }],
      SHIFTS,
      cd
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.moves[0], { id: 2, startTime: P("2026-08-22", 6), endTime: P("2026-08-22", 10) });
    }
  });
});
