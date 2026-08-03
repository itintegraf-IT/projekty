import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeChainPush, type BlockInterval } from "./overlapResolver";
import { pragueToUTC } from "./dateUtils";
import type { CompanyDayInterval } from "./printTime";
import { xl106Week, mkDay, W1, W2 } from "./weekShiftsTestFixtures";

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

  it("computeChainPush: locked obstacle (simulace ne-ZAKAZKA zdi) v cestě anchoru → LOCKED_CONFLICT", () => {
    // R4 (overlapResolver.server.ts) mapuje REZERVACE/UDRZBA na locked:true dřív, než je
    // předá sem — tento test dokazuje, že pure funkce takovou "zeď" bez dalších změn zvládá.
    const wall = blk(20, 8, 10, { locked: true });
    const anchor = { id: 1, startTime: H(9), endTime: H(11) };
    const res = computeChainPush("XL_105", anchor, [wall], [], NO_CD);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "LOCKED_CONFLICT");
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

  it("MIN SEGMENT: odsunutý blok s 0,5h kusem se posune CELÝ za odstávku", () => {
    // Anchor končí Pá 21:30 → 4h blok by měl kusy 0,5+3,5 → pravidlo ho pošle celý na Ne 22:00.
    const r = computeChainPush(
      "XL_106",
      { id: 1, startTime: P("2026-08-21", 10), endTime: new Date(P("2026-08-21", 21).getTime() + 30 * 60000) },
      [{ id: 2, startTime: P("2026-08-21", 12), endTime: P("2026-08-21", 16), locked: false, printMinutes: 240, scheduleBypassed: false }],
      SHIFTS,
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.moves[0], { id: 2, startTime: P("2026-08-23", 22), endTime: P("2026-08-24", 2) });
    }
  });

  it("MIN SEGMENT nouzová pojistka: když se blok nevejde nikam bez porušení, pauza se povolí", () => {
    // Kalendář jen Pá 6–22 (16 h) v každém týdnu; 990min (16,5h) blok se na KAŽDÉ Pá pozici
    // rozpadne na 16 h + 0,5 h → kus 0,5 h < 60 min porušuje pravidlo úplně všude.
    //
    // POZN. k fixture (odchylka od brief zadání, zdůvodněno komentářem dle pravidel úkolu):
    // Se 2 týdny (W1/W2) dle brief návrhu placeAfter escapuje do NEDEFINOVANÉHO 3. týdne,
    // který tiše spadne na hardcoded fallback rozvrh (isHardcodedBlocked — pro XL_106 prakticky
    // 24/7 mimo So a Ne do 22:00) → tam už 990min blok NEPORUŠUJE (dost hodin na oba kusy ≥60 min)
    // a nouzová pojistka se nikdy nevyvolá (ověřeno přímým behem přes expandPrintTime). Aby test
    // reálně vyčerpal placeAfter (g < 100) BEZ úniku do hardcoded fallbacku, kalendář musí mít
    // Pá-only týdny definované po celou dobu, kterou 100 iterací (každá = 1 týden posunu na
    // konec pauzy) prochází → 105 po sobě jdoucích týdnů (W1 + rezerva), počínaje 2026-08-17.
    // Se 100+ definovanými týdny placeAfter(min=60) skutečně vyčerpá cyklus a vrátí null →
    // fallback placeAfter(min=0) umístí blok na PRVNÍ pozici (Pá1 06:00) s pauzou (16 h + 0,5 h).
    const WEEK_COUNT = 105;
    function mondayPlusWeeks(n: number): string {
      const d = new Date(`${W1}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + n * 7);
      return d.toISOString().slice(0, 10);
    }
    const fridayOnlyWeeks = Array.from({ length: WEEK_COUNT }, (_, i) => mondayPlusWeeks(i));
    const sparse = [0, 1, 2, 3, 4, 5, 6].flatMap((d) =>
      fridayOnlyWeeks.map((w) => mkDay(w, d, d === 5 ? { m: true, a: true } : { active: false }))
    );
    const r = computeChainPush(
      "XL_106",
      { id: 1, startTime: P("2026-08-21", 5, 30), endTime: P("2026-08-21", 6) }, // anchor reálně překrývá blok 2 (half-open)
      [{ id: 2, startTime: P("2026-08-21", 5, 30), endTime: P("2026-08-21", 6), locked: false, printMinutes: 990, scheduleBypassed: false }],
      sparse,
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.moves.length, 1);
      // start Pá1 06:00, end Pá2 06:30 (16 h Pá1 + 0,5 h Pá2)
      assert.deepEqual(r.moves[0]!.startTime, P("2026-08-21", 6));
      assert.deepEqual(r.moves[0]!.endTime, new Date(P("2026-08-28", 6).getTime() + 30 * 60000));
    }
  });
});

// ── Rigidní bloky (REZERVACE / UDRZBA) — pevná délka, do pracovní doby ──────
describe("computeChainPush — rigidní bloky (rezervace/údržba)", () => {
  const rigidBlk = (id: number, start: number, end: number, opts: { locked?: boolean } = {}): BlockInterval => ({
    id,
    startTime: H(start),
    endTime: H(end),
    locked: opts.locked ?? false,
    printMinutes: (end - start) * 60,
    scheduleBypassed: false,
    rigid: true,
  });

  it("rigidní blok se odsune za anchor se zachovanou délkou", () => {
    const r = computeChainPush("XL_105", { id: 1, startTime: H(10), endTime: H(12) }, [rigidBlk(2, 11, 13)], [], NO_CD);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.moves[0]!.startTime, H(12));
      assert.deepEqual(r.moves[0]!.endTime, H(14));
    }
  });

  it("rigidní blok se NEroztáhne přes odstávku — celý ji přeskočí", () => {
    // Zakázka by přes odstávku pauzla (end by se posunul o její délku).
    // Rigidní blok musí zůstat souvislý, tedy začít až za ní.
    const cd: CompanyDayInterval[] = [{ start: H(12), end: H(15) }];
    const r = computeChainPush("XL_105", { id: 1, startTime: H(10), endTime: H(12) }, [rigidBlk(2, 11, 13)], [], cd);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.moves[0]!.startTime, H(15));
      assert.deepEqual(r.moves[0]!.endTime, H(17));
      const delkaH = (r.moves[0]!.endTime.getTime() - r.moves[0]!.startTime.getTime()) / 3600000;
      assert.equal(delkaH, 2, "délka rigidního bloku se nesmí změnit");
    }
  });

  it("rigidní blok přeskočí zamčený blok v cestě", () => {
    const r = computeChainPush(
      "XL_105",
      { id: 1, startTime: H(10), endTime: H(12) },
      [rigidBlk(2, 11, 13), blk(3, 12, 14, { locked: true })],
      [],
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      const m = r.moves.find((x) => x.id === 2)!;
      assert.deepEqual(m.startTime, H(14), "musí začít až za zamčeným blokem");
      assert.deepEqual(m.endTime, H(16));
    }
  });

  it("rigidní blok za dlouhou odstávkou se stane zdí — kaskáda projde (regrese 3. 8. 2026)", () => {
    // Reálný scénář: celozávodní odstávka delší než horizont rigidního posunu (7 dní).
    // Rezervace se za ni nemá kam vejít. PŘED opravou to shodilo CELÝ přesun na 422,
    // přestože na produkci (kde je rezervace pevná zeď) tentýž přesun projde.
    const shifts = [W1, W2].flatMap((w) => [1, 2, 3, 4, 5].map((d) => mkDay(w, d, { m: true, a: true })));
    const odstavka: CompanyDayInterval[] = [
      { start: P("2026-08-22", 0), end: P("2026-09-05", 0) }, // 14 dní
    ];
    const zakazka: BlockInterval = {
      id: 2, startTime: P("2026-08-21", 19), endTime: P("2026-08-21", 21),
      locked: false, printMinutes: 120, scheduleBypassed: false,
    };
    const rezervace: BlockInterval = {
      id: 3, startTime: P("2026-08-21", 20), endTime: P("2026-08-21", 22),
      locked: false, printMinutes: 120, scheduleBypassed: false, rigid: true,
    };
    const r = computeChainPush(
      "XL_106",
      { id: 1, startTime: P("2026-08-21", 18), endTime: P("2026-08-21", 20) },
      [zakazka, rezervace],
      shifts,
      odstavka
    );
    assert.equal(r.ok, true, "neumístitelná rezervace nesmí shodit celou operaci");
    if (r.ok) {
      assert.ok(!r.moves.some((m) => m.id === 3), "rezervace zůstane na místě (zeď)");
      assert.ok(r.moves.some((m) => m.id === 2), "zakázka se odsune kolem ní");
    }
  });

  it("neumístitelný rigidní blok pod anchorem → LOCKED_CONFLICT s příznakem unplaceable", () => {
    // Stroj jede jen ranní směnu (6–14) → 20h blok se nevejde do žádného okna.
    // Bez horizontu by se posouval dál a dál, až by dorazil do týdne bez rozvrhu
    // (hardcoded fallback = nonstop) a skočil o týdny i s celou kaskádou.
    const morningOnly = [0, 1, 2, 3, 4, 5, 6].flatMap((d) =>
      [W1, W2].map((w) => mkDay(w, d, { m: true }))
    );
    const dlouhy: BlockInterval = {
      id: 2,
      startTime: P(W1, 7),
      endTime: new Date(P(W1, 7).getTime() + 20 * 3600000), // 20 h
      locked: false,
      printMinutes: 20 * 60,
      scheduleBypassed: false,
      rigid: true,
    };
    const r = computeChainPush(
      "XL_106",
      { id: 1, startTime: P(W1, 6), endTime: P(W1, 8) },
      [dlouhy],
      morningOnly,
      NO_CD
    );
    // Blok se nikam nevejde → degraduje na zeď. Anchor na něm leží, takže se drop
    // odmítne stejně jako u zamčeného bloku — ale s příznakem, že zamčený NENÍ.
    assert.equal(r.ok, false, "neumístitelný blok nesmí být teleportován");
    if (!r.ok) {
      assert.equal(r.reason, "LOCKED_CONFLICT");
      if (r.reason === "LOCKED_CONFLICT") {
        assert.equal(r.lockedId, 2);
        assert.equal(r.unplaceable, true, "hláška nesmí tvrdit, že je blok zamčený");
      }
    }
  });

  it("rigidní blok s korumpovanou délkou → PLACEMENT_FAILED, ne výjimka", () => {
    const bad: BlockInterval = { ...rigidBlk(2, 11, 13), printMinutes: -60 };
    const r = computeChainPush("XL_105", { id: 1, startTime: H(10), endTime: H(12) }, [bad], [], NO_CD);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "PLACEMENT_FAILED");
  });
});
