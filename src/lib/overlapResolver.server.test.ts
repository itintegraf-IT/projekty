import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { resolveChainPushFromDb, chainPushGeometry } from "./overlapResolver.server";
import { isAppError } from "./errors";
import { measureCascade } from "./cascadeLimit";
import { logger } from "./logger";

// Úterý 16. 6. 2026, prázdné weekShifts → hardcoded fallback XL_105 (souvislý provoz).
const H = (h: number) => new Date(`2026-06-16T${String(h).padStart(2, "0")}:00:00.000Z`);

type Row = {
  id: number;
  orderNumber: string | null;
  startTime: Date;
  endTime: Date;
  updatedAt: Date;
  locked: boolean;
  printCompletedAt: Date | null;
  printMinutes: number | null;
  scheduleBypassed: boolean;
  type: string;
};

const row = (id: number, start: number, end: number, opts: Partial<Row> = {}): Row => ({
  id,
  orderNumber: opts.orderNumber ?? String(17000 + id),
  startTime: H(start),
  endTime: H(end),
  updatedAt: opts.updatedAt ?? new Date("2026-06-16T09:00:00.000Z"),
  locked: opts.locked ?? false,
  printCompletedAt: opts.printCompletedAt ?? null,
  printMinutes: opts.printMinutes ?? (end - start) * 60,
  scheduleBypassed: opts.scheduleBypassed ?? false,
  type: opts.type ?? "ZAKAZKA",
});

function mkTx(rows: Row[], companyDays: { startDate: Date; endDate: Date }[] = []) {
  const updateMock = mock.fn(async (params: any) => ({}));
  const findManyMock = mock.fn(async (params: any) => rows);
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
    const where = (findManyMock.mock.calls[0]!.arguments[0] as any)?.where;
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

  // ── Chain push pro VŠECHNY typy (rozhodnutí 31. 7. 2026) ────────────────────
  // Dřív byly REZERVACE/UDRZBA pevná zeď (409). Nově se odsouvají jako zakázky,
  // ale jako RIGIDNÍ interval: přesná délka, bez roztažení přes pauzy směn.

  it("REZERVACE se odsune jako zakázka a zachová si přesnou délku", async () => {
    const { tx, updateMock } = mkTx([row(20, 11, 13, { orderNumber: "REZ-1", type: "REZERVACE" })]);
    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) });

    assert.equal(moves.length, 1);
    assert.equal(moves[0]!.orderNumber, "REZ-1");
    assert.deepEqual(moves[0]!.startTime, H(12));
    assert.deepEqual(moves[0]!.endTime, H(14));
    const puvodni = H(13).getTime() - H(11).getTime();
    const nova = moves[0]!.endTime.getTime() - moves[0]!.startTime.getTime();
    assert.equal(nova, puvodni, "délka rezervace se posunem nesmí změnit");
    assert.equal(updateMock.mock.calls.length, 1);
  });

  it("UDRZBA se odsune stejně jako rezervace", async () => {
    const { tx, updateMock } = mkTx([row(21, 11, 13, { orderNumber: "UDR-1", type: "UDRZBA" })]);
    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) });

    assert.equal(moves.length, 1);
    assert.deepEqual(moves[0]!.startTime, H(12));
    assert.deepEqual(moves[0]!.endTime, H(14));
    assert.equal(updateMock.mock.calls.length, 1);
  });

  it("ZAMČENÁ rezervace zůstává zdí → OVERLAP, nic se neposune", async () => {
    const { tx, updateMock } = mkTx([
      row(22, 11, 13, { orderNumber: "REZ-LOCK", type: "REZERVACE", locked: true }),
    ]);
    await assert.rejects(
      () => resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) }),
      (e: unknown) => isAppError(e) && e.code === "OVERLAP" && /rezervac/i.test(e.message)
    );
    assert.equal(updateMock.mock.calls.length, 0);
  });

  it("VYTIŠTĚNÁ zakázka zůstává zdí i pro rezervaci jako anchor", async () => {
    const { tx, updateMock } = mkTx([
      row(23, 11, 13, { orderNumber: "17999", printCompletedAt: H(13) }),
    ]);
    await assert.rejects(
      () => resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) }),
      (e: unknown) => isAppError(e) && e.code === "OVERLAP" && /tisk/i.test(e.message)
    );
    assert.equal(updateMock.mock.calls.length, 0);
  });

  it("rezervace s neceločíselnou délkou (45 min) si ji zachová", async () => {
    const start = new Date("2026-06-16T11:00:00.000Z");
    const end = new Date("2026-06-16T11:45:00.000Z");
    const r: Row = {
      id: 24, orderNumber: "REZ-45", startTime: start, endTime: end,
      updatedAt: new Date("2026-06-16T09:00:00.000Z"),
      locked: false, printCompletedAt: null, printMinutes: null,
      scheduleBypassed: false, type: "REZERVACE",
    };
    const { tx } = mkTx([r]);
    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) });

    assert.equal(moves.length, 1);
    const delka = (moves[0]!.endTime.getTime() - moves[0]!.startTime.getTime()) / 60000;
    assert.equal(delka, 45, "45min rezervace se nesmí zaokrouhlit na 30 ani 60 minut");
  });

  it("rezervace s pm re-expanduje přes firemní odstávku v cestě (tisková geometrie, etapa 9)", async () => {
    // row() dává printMinutes ≠ null (default = span), takže rezervace od etapy 9
    // jede tiskovou geometrií jako zakázka: nevyhýbá se odstávce jako celku, ale
    // PAUZNE přes ni a re-expanduje dál se zachovanou délkou tisku (120 min) —
    // stejně jako zakázka. Dřív (rigidní geometrie) by přeskočila celá až za 17:00.
    const { tx } = mkTx(
      [row(25, 11, 13, { orderNumber: "REZ-CD", type: "REZERVACE" })],
      [{ startDate: H(13), endDate: H(17) }]
    );
    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) });

    assert.equal(moves.length, 1);
    assert.deepEqual(moves[0]!.startTime, H(12));
    assert.deepEqual(moves[0]!.endTime, H(18), "1h do odstávky + 1h po ní = 120 min tisku (pm se zachová)");
  });

  // ── Ochrana bloků umístěných vědomě mimo kalendář (review 31. 7. 2026) ──────
  // Údržba se plánuje PRÁVĚ na odstávku a víkend. Automatický posun by ji
  // vystěhoval do výroby, proto takový blok zůstává zdí jako před změnou.

  it("údržba UVNITŘ firemní odstávky se neposouvá — zůstává zdí", async () => {
    const { tx, updateMock } = mkTx(
      [row(26, 11, 13, { orderNumber: "UDR-CD", type: "UDRZBA" })],
      [{ startDate: H(10), endDate: H(18) }]
    );
    await assert.rejects(
      () => resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) }),
      (e: unknown) => isAppError(e) && e.code === "OVERLAP" && /mimo pracovní dobu/i.test(e.message)
    );
    assert.equal(updateMock.mock.calls.length, 0, "údržba v odstávce se nesmí hnout");
  });

  it("rezervace, která už teď leží mimo pracovní dobu, se neposouvá", async () => {
    // XL_106 s reálným rozvrhem: víkend stroj stojí. Rezervace v sobotu = záměr.
    const sobota = new Date("2026-08-22T08:00:00.000Z");
    const sobotaKonec = new Date("2026-08-22T12:00:00.000Z");
    const r: Row = {
      id: 27, orderNumber: "REZ-SO", startTime: sobota, endTime: sobotaKonec,
      updatedAt: new Date("2026-06-16T09:00:00.000Z"),
      locked: false, printCompletedAt: null, printMinutes: null,
      scheduleBypassed: false, type: "REZERVACE",
    };
    const { tx, updateMock } = mkTx([r]);
    // Anchor přes ni → nelze uvolnit místo, ale rezervace se nikam nepřesune.
    await assert.rejects(
      () =>
        resolveChainPushFromDb(tx, "XL_106", {
          id: 1,
          startTime: new Date("2026-08-22T07:00:00.000Z"),
          endTime: new Date("2026-08-22T09:00:00.000Z"),
        }),
      (e: unknown) => isAppError(e) && e.code === "OVERLAP"
    );
    assert.equal(updateMock.mock.calls.length, 0);
  });

  it("smíšená kaskáda: zakázka → rezervace → zakázka, každá svou geometrií", async () => {
    const { tx, updateMock } = mkTx([
      row(30, 11, 13, { orderNumber: "REZ-M", type: "REZERVACE" }),
      row(31, 13, 15, { orderNumber: "17500" }),
    ]);
    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) });

    assert.equal(moves.length, 2, "odsunout se má rezervace i navazující zakázka");
    const rez = moves.find((m) => m.orderNumber === "REZ-M")!;
    const zak = moves.find((m) => m.orderNumber === "17500")!;
    assert.deepEqual(rez.startTime, H(12));
    assert.deepEqual(rez.endTime, H(14));
    assert.deepEqual(zak.startTime, H(14));
    assert.deepEqual(zak.endTime, H(16));
    assert.equal(updateMock.mock.calls.length, 2);
  });
});

describe("resolveChainPushFromDb — práh kaskády (vynuceno od 21. 8. 2026)", () => {
  it("chain push nad prahem se ODMÍTNE — AppError CASCADE_CONFIRM, transakce se odroluje", async () => {
    // CASCADE_CONFIRM_ENFORCED je true — překročení prahu hodí, nic se nezapíše.
    const { tx, updateMock } = mkTx([
      ...Array.from({ length: 8 }, (_, k) => row(10 + k, 12 + k, 13 + k)),
    ]);
    await assert.rejects(
      () => resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(13) }),
      (e: unknown) => isAppError(e) && e.code === "CASCADE_CONFIRM"
    );
    assert.equal(updateMock.mock.calls.length, 0, "transakce se odrolovala, nic se nemělo zapsat");
  });

  it("chain push pod prahem projde beze změny", async () => {
    const { tx, updateMock } = mkTx([row(10, 12, 13), row(11, 13, 14)]);
    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(13) });
    assert.ok(moves.length <= 5);
    assert.equal(updateMock.mock.calls.length, moves.length);
  });

  it("nad prahem, ale s cascadeConfirmed: true projde beze změny", async () => {
    const { tx, updateMock } = mkTx([
      ...Array.from({ length: 8 }, (_, k) => row(10 + k, 12 + k, 13 + k)),
    ]);
    const moves = await resolveChainPushFromDb(
      tx, "XL_105", { id: 1, startTime: H(10), endTime: H(13) },
      new Set<number>(), new Set<number>(),
      { cascadeConfirmed: true },
    );
    assert.ok(moves.length > 5);
    assert.equal(updateMock.mock.calls.length, moves.length);
  });

  it("measureCascade nad výsledkem chain pushe vidí skutečný dopad", async () => {
    const { tx } = mkTx([row(10, 12, 13), row(11, 13, 14)]);
    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(13) });
    const impact = measureCascade(
      moves.map((m) => ({ id: m.id, startTime: m.startTime, endTime: m.endTime, oldStartTime: m.oldStartTime })),
    );
    assert.equal(impact.movedCount, moves.length);
    assert.ok(impact.maxShiftMs > 0);
  });

  // `assertCascadeConfirmed` sama (co dělá v režimu MĚŘENÍ vs. VYNUCENÍ) má vlastní
  // testy v cascadeLimit.server.test.ts (mock.module na CASCADE_CONFIRM_ENFORCED —
  // ten se v repu nesmí přepínat, tady se testuje reálný modul, tj. VYNUCENÍ).
  // Tady se testuje jen to, co je specifické PRO resolver: jestli se kontrola
  // vůbec ZAVOLÁ. S `CASCADE_CONFIRM_ENFORCED === true` se to dnes pozná přímo
  // z hozené výjimky (kontrola proběhla → CASCADE_CONFIRM, transakce se
  // odrolovala) i z logu (`logger.warn`, viz cascadeLimit.server.ts) —
  // `skipCascadeCheck: true` obojí vynechá úplně.
  it("skipCascadeCheck: true nechá i velkou kaskádu projít BEZ kontroly (žádný log)", async () => {
    const infoSpy = mock.method(logger, "info", () => {});
    try {
      const { tx } = mkTx([
        ...Array.from({ length: 8 }, (_, k) => row(10 + k, 12 + k, 13 + k)),
      ]);
      const moves = await resolveChainPushFromDb(
        tx, "XL_105", { id: 1, startTime: H(10), endTime: H(13) },
        new Set<number>(), new Set<number>(),
        { skipCascadeCheck: true },
      );
      assert.ok(moves.length > 5);
      assert.equal(infoSpy.mock.calls.length, 0);
    } finally {
      infoSpy.mock.restore();
    }
  });

  it("bez skipCascadeCheck se kontrola provede (velká kaskáda se odmítne a zaloguje warn)", async () => {
    const warnSpy = mock.method(logger, "warn", () => {});
    try {
      const { tx, updateMock } = mkTx([
        ...Array.from({ length: 8 }, (_, k) => row(10 + k, 12 + k, 13 + k)),
      ]);
      await assert.rejects(
        () => resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(13) }),
        (e: unknown) => isAppError(e) && e.code === "CASCADE_CONFIRM"
      );
      assert.equal(warnSpy.mock.calls.length, 1);
      assert.equal(updateMock.mock.calls.length, 0);
    } finally {
      warnSpy.mock.restore();
    }
  });
});

describe("chainPushGeometry", () => {
  const base = { startTime: H(10), endTime: H(12), printMinutes: null, scheduleBypassed: false };

  it("ZAKAZKA s printMinutes → tiskové hodiny, žádný rigid", () => {
    const g = chainPushGeometry({ ...base, type: "ZAKAZKA", printMinutes: 90 });
    assert.deepEqual(g, { printMinutes: 90, scheduleBypassed: false, rigid: false });
  });

  it("ZAKAZKA bez printMinutes → legacy fallback zarovnaný na 30 min", () => {
    const g = chainPushGeometry({ ...base, type: "ZAKAZKA" });
    assert.equal(g.printMinutes, 120);
    assert.equal(g.rigid, false);
  });

  it("ZAKAZKA s bypassem si bypass nese dál", () => {
    const g = chainPushGeometry({ ...base, type: "ZAKAZKA", printMinutes: 60, scheduleBypassed: true });
    assert.equal(g.scheduleBypassed, true);
    assert.equal(g.rigid, false);
  });

  it("REZERVACE → rigid s přesnou délkou (bez zaokrouhlení)", () => {
    const g = chainPushGeometry({
      ...base, type: "REZERVACE",
      endTime: new Date("2026-06-16T10:45:00.000Z"),
    });
    assert.deepEqual(g, { printMinutes: 45, scheduleBypassed: false, rigid: true });
  });

  it("UDRZBA → rigid stejně jako rezervace", () => {
    const g = chainPushGeometry({ ...base, type: "UDRZBA" });
    assert.equal(g.rigid, true);
    assert.equal(g.printMinutes, 120);
  });
});

describe("chainPushGeometry — etapa 9 (REZERVACE s pm = tisková, legacy = rigidní)", () => {
  it("UDRZBA → rigidní vždy", () => {
    const g = chainPushGeometry({ type: "UDRZBA", startTime: H(10), endTime: H(12), printMinutes: 120, scheduleBypassed: false });
    assert.deepEqual(g, { printMinutes: 120, scheduleBypassed: false, rigid: true });
  });
  it("REZERVACE bez printMinutes → rigidní (legacy, spec §3)", () => {
    const g = chainPushGeometry({ type: "REZERVACE", startTime: H(10), endTime: H(12), printMinutes: null, scheduleBypassed: false });
    assert.deepEqual(g, { printMinutes: 120, scheduleBypassed: false, rigid: true });
  });
  it("REZERVACE s printMinutes → tisková geometrie se 7denním stropem (rozhodnutí #1)", () => {
    const g = chainPushGeometry({ type: "REZERVACE", startTime: H(10), endTime: H(12), printMinutes: 90, scheduleBypassed: true });
    assert.deepEqual(g, { printMinutes: 90, scheduleBypassed: true, rigid: false, maxPushMs: 7 * 24 * 60 * 60 * 1000 });
  });
  it("ZAKAZKA → tisková BEZ stropu (maxPushMs undefined — dluh P31 se nešíří, ale ani neřeší)", () => {
    const g = chainPushGeometry({ type: "ZAKAZKA", startTime: H(10), endTime: H(12), printMinutes: 120, scheduleBypassed: false });
    assert.equal(g.rigid, false);
    assert.equal(g.maxPushMs, undefined);
  });
});

describe("resolveChainPushFromDb — tisková REZERVACE (etapa 9)", () => {
  it("rezervace s pm v cestě anchoru se posune s re-expanzí (fallback 24/7: end = start + pm)", async () => {
    const { tx, updateMock } = mkTx([row(2, 11, 13, { type: "REZERVACE", printMinutes: 120 })]);
    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) });
    assert.equal(moves.length, 1);
    assert.equal(updateMock.mock.callCount(), 1);
    const call = updateMock.mock.calls[0]!.arguments[0] as { where: { id: number }; data: { startTime: Date; endTime: Date } };
    assert.deepEqual(call.data, { startTime: H(12), endTime: H(14) });
  });
});
