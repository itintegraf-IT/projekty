import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeUndoOps, applyUndoOps, DATE_FIELDS } from "./undoApply.server";
import { isAppError } from "./errors";
import { isRestorableField, UNDO_RESTORABLE_FIELDS } from "./undo/restoreFields";
import { logger } from "./logger";
import { UNDO_MIXED_FIELD_PREFIX } from "./auditFormatters";

function rejects(raw: unknown, fragment: string) {
  try {
    sanitizeUndoOps(raw);
    assert.fail("mělo hodit AppError");
  } catch (e) {
    assert.ok(isAppError(e), "musí být AppError");
    assert.equal(e.code, "VALIDATION_ERROR");
    assert.ok(e.message.includes(fragment), `hláška "${e.message}" neobsahuje "${fragment}"`);
  }
}

test("sanitizeUndoOps propustí platný upsert i remove", () => {
  const ops = sanitizeUndoOps([
    { kind: "upsert", id: 1, expectedUpdatedAt: "2026-08-01T10:00:00.000Z", fields: { startTime: "2026-09-02T04:00:00.000Z" } },
    { kind: "remove", id: 2 },
  ]);
  assert.equal(ops.length, 2);
  assert.equal(ops[0].kind, "upsert");
  assert.equal(ops[1].kind, "remove");
});

test("sanitizeUndoOps odmítne pole mimo allowlist", () => {
  rejects([{ kind: "upsert", id: 1, fields: { printCompletedAt: "2026-08-01T00:00:00.000Z" } }], "printCompletedAt");
  rejects([{ kind: "upsert", id: 1, fields: { reservationId: 5 } }], "reservationId");
});

test("sanitizeUndoOps odmítne prázdný seznam a neznámý druh operace", () => {
  rejects([], "prázdn");
  rejects([{ kind: "smaz-vsechno", id: 1 }], "Neznámá operace");
});

test("sanitizeUndoOps odmítne neplatné id a duplicitní id", () => {
  rejects([{ kind: "remove", id: 0 }], "id");
  rejects([{ kind: "remove", id: -3 }], "id");
  rejects([{ kind: "remove", id: 1 }, { kind: "upsert", id: 1, fields: {} }], "vícekrát");
});

test("sanitizeUndoOps odmítne seznam delší než 200 operací", () => {
  const ops = Array.from({ length: 201 }, (_, i) => ({ kind: "remove" as const, id: i + 1 }));
  rejects(ops, "příliš dlouhý");
});

test("sanitizeUndoOps odmítne fields, který není objekt", () => {
  rejects([{ kind: "upsert", id: 1, fields: null }], "Chybí fields");
  rejects([{ kind: "upsert", id: 2, fields: [] }], "Chybí fields");
  rejects([{ kind: "upsert", id: 3, fields: "string" }], "Chybí fields");
});

test("sanitizeUndoOps odmítne hodnotu v fields, která je objekt nebo pole", () => {
  rejects([{ kind: "upsert", id: 1, fields: { printMinutes: { increment: 999999999 } } }], "neplatný formát");
  rejects([{ kind: "upsert", id: 2, fields: { description: ["pole", "hodnot"] } }], "neplatný formát");
});

test("sanitizeUndoOps odmítne neplatný expectedUpdatedAt", () => {
  rejects([{ kind: "remove", id: 1, expectedUpdatedAt: "ne-je-datum" }], "Neplatné expectedUpdatedAt");
  rejects([{ kind: "upsert", id: 2, fields: {}, expectedUpdatedAt: "" }], "Neplatné expectedUpdatedAt");
});

test("sanitizeUndoOps odmítne ID větší než 2147483647", () => {
  rejects([{ kind: "remove", id: 2147483648 }], "id");
  rejects([{ kind: "upsert", id: 9007199254740992, fields: {} }], "id");
});

type Row = {
  id: number; orderNumber: string | null; machine: string;
  startTime: Date; endTime: Date; updatedAt: Date; printCompletedAt: Date | null;
  /** Série — mazání kořene ji musí rozvázat adresně, ne kaskádou v MySQL. */
  recurrenceParentId?: number | null;
};

const T = (iso: string) => new Date(iso);
const actor = { id: 42, username: "planovac" };

function row(over: Partial<Row> = {}): Row {
  return {
    id: 1, orderNumber: "17300", machine: "XL_105",
    startTime: T("2026-09-02T14:00:00.000Z"), endTime: T("2026-09-02T16:00:00.000Z"),
    updatedAt: T("2026-08-01T10:00:00.000Z"), printCompletedAt: null, recurrenceParentId: null, ...over,
  };
}

/** Fake tx podle vzoru reflow.server.test.ts — obyčejné objekty s mock.fn. */
function mkTx(
  rows: Row[],
  opts: {
    conflicts?: { id: number; orderNumber: string | null }[];
    /** D3: odstávky, které má loadMachineCalendarRange „najít" — prázdné ve výchozím stavu. */
    companyDays?: { start: Date; end: Date }[];
  } = {},
) {
  const store = new Map(rows.map((r) => [r.id, r]));
  // Pořadí volání napříč RŮZNÝMI mock.fn — potřeba pro test I1 (zamykající SELECT
  // musí proběhnout PŘED findMany). Push je synchronní přímo na místě volání,
  // takže pořadí odpovídá skutečnému pořadí await v produkčním kódu.
  const callOrder: string[] = [];
  const updateMock = mock.fn(async (a: { where: { id: number }; data: Record<string, unknown> }) => {
    callOrder.push("update");
    const cur = store.get(a.where.id)!;
    const next = { ...cur, ...a.data } as Row;
    store.set(a.where.id, next);
    return next;
  });
  const createMock = mock.fn(async (a: { data: Record<string, unknown> }) => {
    callOrder.push("create");
    const next = { ...row(), ...a.data } as Row;
    store.set(next.id, next);
    return next;
  });
  const deleteMock = mock.fn(async (a: { where: { id: number } }) => {
    callOrder.push("delete");
    const cur = store.get(a.where.id);
    store.delete(a.where.id);
    return cur ?? null;
  });
  // Rozvázání série před smazáním kořene. Bez něj by odkaz potomkům vynulovala
  // kaskáda `ON DELETE SET NULL` uvnitř MySQL, tedy mimo Prismu i mimo revizi.
  const updateManyMock = mock.fn(async (a: { where: { recurrenceParentId: number }; data: Record<string, unknown> }) => {
    callOrder.push("updateMany");
    let count = 0;
    for (const [id, r] of store) {
      if (r.recurrenceParentId !== a.where.recurrenceParentId) continue;
      store.set(id, { ...r, ...a.data } as Row);
      count++;
    }
    return { count };
  });
  const auditMock = mock.fn(async (a: { data: unknown[] }) => ({ count: a.data.length }));
  const findManyMock = mock.fn(async (a: { where: { id: { in: number[] } } }) => {
    callOrder.push("findMany");
    return a.where.id.in.map((i) => store.get(i)).filter(Boolean);
  });
  const queryRawMock = mock.fn(async (..._args: unknown[]) => {
    callOrder.push("queryRaw");
    return opts.conflicts ?? [];
  });
  // D3: warnIfUnusual volá loadMachineCalendarRange (printTime.server.ts) pro KAŽDÝ upsert,
  // který mění startTime/endTime — potřebuje companyDay.findMany i machineWeekShifts.findMany.
  // Výchozí prázdné pole = žádná odstávka, žádné vlastní směny (běžný případ, testy níž na to
  // nesmí spoléhat implicitně, proto companyDaysMock jde přepsat přes opts.companyDays).
  const companyDayMock = mock.fn(async (_a: unknown) =>
    (opts.companyDays ?? []).map((c) => ({ startDate: c.start, endDate: c.end })));
  const weekShiftsMock = mock.fn(async (_a: unknown) => []);
  const tx = {
    block: {
      findMany: findManyMock,
      update: updateMock, create: createMock, delete: deleteMock, updateMany: updateManyMock,
    },
    auditLog: { createMany: auditMock },
    companyDay: { findMany: companyDayMock },
    machineWeekShifts: { findMany: weekShiftsMock },
    $queryRaw: queryRawMock,
  } as never;
  return { tx, store, updateMock, createMock, deleteMock, updateManyMock, auditMock, findManyMock, queryRawMock, companyDayMock, weekShiftsMock, callOrder };
}

test("applyUndoOps: upsert zapíše off-grid start doslova (opravený incident 4. 8.)", async () => {
  const { tx, store, updateMock } = mkTx([row()]);
  await applyUndoOps(tx, [{
    kind: "upsert", id: 1,
    fields: { startTime: "2026-09-02T14:45:00.000Z", endTime: "2026-09-02T16:45:00.000Z", machine: "XL_105" },
  }], actor, "undo");
  assert.equal(updateMock.mock.callCount(), 1);
  // store drží Date (toPrismaData konvertuje ISO string před zápisem — stejně jako
  // zbytek repa, viz batch/route.ts a [id]/route.ts), proto porovnání přes toISOString().
  assert.equal(store.get(1)!.startTime.toISOString(), "2026-09-02T14:45:00.000Z");
});

test("applyUndoOps: upsert zachová endTime přes noční pauzu (žádný přepočet)", async () => {
  const { tx, store } = mkTx([row()]);
  await applyUndoOps(tx, [{
    kind: "upsert", id: 1,
    fields: { startTime: "2026-09-02T18:00:00.000Z", endTime: "2026-09-03T06:00:00.000Z", printMinutes: 240, machine: "XL_105" },
  }], actor, "undo");
  assert.equal(store.get(1)!.endTime.toISOString(), "2026-09-03T06:00:00.000Z", "endTime se NEsmí dopočítat z printMinutes");
});

test("applyUndoOps: stale expectedUpdatedAt → CONFLICT a ŽÁDNÝ zápis", async () => {
  const { tx, updateMock, deleteMock, auditMock } = mkTx([row(), row({ id: 2 })]);
  await assert.rejects(
    () => applyUndoOps(tx, [
      { kind: "upsert", id: 1, expectedUpdatedAt: "2026-08-01T10:00:00.000Z", fields: { machine: "XL_106" } },
      { kind: "upsert", id: 2, expectedUpdatedAt: "1999-01-01T00:00:00.000Z", fields: { machine: "XL_106" } },
    ], actor, "undo"),
    (e: unknown) => isAppError(e) && e.code === "CONFLICT",
  );
  assert.equal(updateMock.mock.callCount(), 0, "zámek se kontroluje PŘED prvním zápisem");
  assert.equal(deleteMock.mock.callCount(), 0);
  assert.equal(auditMock.mock.callCount(), 0);
});

test("applyUndoOps: remove neexistujícího bloku je úspěch (idempotence)", async () => {
  const { tx, deleteMock } = mkTx([]);
  const res = await applyUndoOps(tx, [{ kind: "remove", id: 99 }], actor, "undo");
  assert.deepEqual(res.removed, []);
  assert.equal(deleteMock.mock.callCount(), 0, "chybějící řádek se nemaže, jen se přeskočí");
});

test("applyUndoOps: remove bloku s potvrzeným tiskem → CONFLICT", async () => {
  const { tx, deleteMock } = mkTx([row({ printCompletedAt: T("2026-09-01T12:00:00.000Z") })]);
  await assert.rejects(
    () => applyUndoOps(tx, [{ kind: "remove", id: 1 }], actor, "undo"),
    (e: unknown) => isAppError(e) && e.code === "CONFLICT",
  );
  assert.equal(deleteMock.mock.callCount(), 0);
});

test("applyUndoOps: upsert chybějícího bloku ho vytvoří s PŮVODNÍM id", async () => {
  const { tx, createMock, store } = mkTx([]);
  const res = await applyUndoOps(tx, [{
    kind: "upsert", id: 738,
    fields: { orderNumber: "17300", machine: "XL_105", startTime: "2026-09-02T14:00:00.000Z", endTime: "2026-09-02T16:00:00.000Z" },
  }], actor, "undo");
  assert.deepEqual(res.createdIds, [738]);
  assert.equal((createMock.mock.calls[0].arguments[0] as { data: { id: number } }).data.id, 738);
  assert.ok(store.has(738));
});

// ── createdAt při vzkříšení (nález z proklikávání na produkčních datech 9. 8. 2026) ──
// Undo mazání obnoví blok pod PŮVODNÍM id, ale bez tohohle by mu Prisma dosadila
// `now()` — tentýž blok by pak měl dvě různá data narození. `createdAt` proto jde
// VEDLE `fields` (v UNDO_RESTORABLE_FIELDS být nesmí, viz komentář u UndoOp).

test("sanitizeUndoOps: propustí createdAt vedle fields", () => {
  const ops = sanitizeUndoOps([
    { kind: "upsert", id: 1, fields: { orderNumber: "17300" }, createdAt: "2026-08-03T11:14:16.000Z" },
  ]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, "upsert");
  assert.equal(ops[0].kind === "upsert" ? ops[0].createdAt : undefined, "2026-08-03T11:14:16.000Z");
  // Do fields se propašovat nesmí — allowlist ho nezná a update větev by ho zapsala.
  assert.ok(!("createdAt" in (ops[0].kind === "upsert" ? ops[0].fields : {})));
});

test("sanitizeUndoOps: odmítne createdAt, které není platné datum", () => {
  rejects([{ kind: "upsert", id: 1, fields: { orderNumber: "17300" }, createdAt: "vcera" }], "createdAt");
  rejects([{ kind: "upsert", id: 1, fields: { orderNumber: "17300" }, createdAt: 12345 }], "createdAt");
});

test("sanitizeUndoOps: createdAt uvnitř fields projít NESMÍ (allowlist)", () => {
  rejects([{ kind: "upsert", id: 1, fields: { createdAt: "2026-08-03T11:14:16.000Z" } }], "createdAt");
});

test("applyUndoOps: vzkříšení zapíše PŮVODNÍ createdAt ze snapshotu", async () => {
  const { tx, createMock } = mkTx([]);
  await applyUndoOps(tx, [{
    kind: "upsert", id: 738,
    fields: { orderNumber: "17300", machine: "XL_105", startTime: "2026-09-02T14:00:00.000Z", endTime: "2026-09-02T16:00:00.000Z" },
    createdAt: "2026-08-03T11:14:16.000Z",
  }], actor, "undo");
  const data = (createMock.mock.calls[0].arguments[0] as { data: Record<string, unknown> }).data;
  assert.ok(data.createdAt instanceof Date, "createdAt musí jít do Prismy jako Date, ne ISO string");
  assert.equal((data.createdAt as Date).toISOString(), "2026-08-03T11:14:16.000Z");
});

test("applyUndoOps: bez createdAt se vzkříšení chová jako dřív (Prisma dosadí default)", async () => {
  const { tx, createMock } = mkTx([]);
  await applyUndoOps(tx, [{
    kind: "upsert", id: 738,
    fields: { orderNumber: "17300", machine: "XL_105", startTime: "2026-09-02T14:00:00.000Z", endTime: "2026-09-02T16:00:00.000Z" },
  }], actor, "undo");
  const data = (createMock.mock.calls[0].arguments[0] as { data: Record<string, unknown> }).data;
  assert.ok(!("createdAt" in data), "bez snapshotu se createdAt nesmí posílat vůbec");
});

test("applyUndoOps: createdAt se NEZAPÍŠE při obnově existujícího bloku (jen vzkříšení)", async () => {
  const { tx, updateMock } = mkTx([row()]);
  await applyUndoOps(tx, [{
    kind: "upsert", id: 1,
    fields: { startTime: "2026-09-02T15:00:00.000Z", endTime: "2026-09-02T17:00:00.000Z" },
    createdAt: "2026-08-03T11:14:16.000Z",
  }], actor, "undo");
  const data = (updateMock.mock.calls[0].arguments[0] as { data: Record<string, unknown> }).data;
  assert.ok(!("createdAt" in data), "běžné undo úpravy nesmí datum vzniku přepisovat");
});

test("applyUndoOps: vytvoření bez povinného pole → VALIDATION_ERROR", async () => {
  const { tx, createMock } = mkTx([]);
  await assert.rejects(
    () => applyUndoOps(tx, [{ kind: "upsert", id: 738, fields: { orderNumber: "17300" } }], actor, "undo"),
    (e: unknown) => isAppError(e) && e.code === "VALIDATION_ERROR",
  );
  assert.equal(createMock.mock.callCount(), 0);
});

test("applyUndoOps: výsledný překryv → OVERLAP (pojistka nemá únikovou cestu)", async () => {
  const { tx } = mkTx([row()], { conflicts: [{ id: 2, orderNumber: "17301" }] });
  await assert.rejects(
    () => applyUndoOps(tx, [{ kind: "upsert", id: 1, fields: { machine: "XL_105", startTime: "2026-09-02T14:00:00.000Z", endTime: "2026-09-02T16:00:00.000Z" } }],
      actor, "undo"),
    (e: unknown) => isAppError(e) && e.code === "OVERLAP",
  );
});

test("applyUndoOps: zapíše audit s akcí UNDO a spanem start–end", async () => {
  const { tx, auditMock } = mkTx([row()]);
  await applyUndoOps(tx, [{
    kind: "upsert", id: 1,
    fields: { machine: "XL_105", startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z" },
  }], actor, "undo");
  const rows = (auditMock.mock.calls[0].arguments[0] as { data: Record<string, unknown>[] }).data;
  assert.equal(rows[0].action, "UNDO");
  assert.equal(rows[0].userId, 42);
  assert.ok(String(rows[0].oldValue).includes("–"), "oldValue je span 'start–end'");
  assert.ok(String(rows[0].newValue).includes("2026-09-02T10:00:00.000Z"));
});

test("applyUndoOps: dávka přes DVA stroje — kontrola stroje B nesmí dostat id bloku ze stroje A (cross-machine false positive)", async () => {
  // Blok 1 zůstává na XL_105, blok 2 jde na XL_106 — stejné časové okno na DVOU různých
  // strojích je naprosto v pořádku. Finální pojistka (assertNoOverlapForBlocks) filtruje
  // `machine = ?` uvnitř sebe — pokud by dostala id bloku z jiného stroje, srovnávala by
  // cizí časové okno proti tomuto stroji a nahlásila by falešnou kolizi (viz batch/route.ts
  // vzor `checkByMachine`, kde se id strojům striktně rozdělují, ne sdílí plošně).
  const { tx, findManyMock } = mkTx([row({ id: 1, machine: "XL_105" }), row({ id: 2, machine: "XL_106" })]);
  await applyUndoOps(tx, [
    { kind: "upsert", id: 1, fields: { machine: "XL_105", startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z" } },
    { kind: "upsert", id: 2, fields: { machine: "XL_106", startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z" } },
  ], actor, "undo");

  // Volání findMany PO tom prvním (index 0 = počáteční načtení existujících řádků) patří
  // finální pojistce — každé smí obsahovat jen id bloku, který na daný stroj skutečně patří.
  const overlapCalls = findManyMock.mock.calls.slice(1);
  assert.equal(overlapCalls.length, 2, "assertNoOverlapForBlocks se volá jednou za cílový stroj");
  for (const call of overlapCalls) {
    const ids = (call.arguments[0] as { where: { id: { in: number[] } } }).where.id.in;
    assert.equal(ids.length, 1, `kontrola jednoho stroje nesmí táhnout id bloků z jiných strojů: ${JSON.stringify(ids)}`);
  }
});

// ── Fix round 1 (review nálezy) ─────────────────────────────────────────────

test("applyUndoOps: vytvoření s obráceným intervalem (end < start) → VALIDATION_ERROR, žádný zápis (C1)", async () => {
  const { tx, createMock } = mkTx([]);
  await assert.rejects(
    () => applyUndoOps(tx, [{
      kind: "upsert", id: 740,
      fields: { orderNumber: "17301", machine: "XL_105", startTime: "2026-09-02T16:00:00.000Z", endTime: "2026-09-02T14:00:00.000Z" },
    }], actor, "undo"),
    (e: unknown) => isAppError(e) && e.code === "VALIDATION_ERROR",
  );
  assert.equal(createMock.mock.callCount(), 0);
});

test("applyUndoOps: update mění jen startTime, posune ho za DB endTime → VALIDATION_ERROR (C1, druhá hodnota z DB)", async () => {
  // row() má endTime 2026-09-02T16:00 — op posílá jen startTime 17:00, endTime se
  // nezmiňuje vůbec (musí se dopočítat z DB, ne mlčky projít).
  const { tx, updateMock } = mkTx([row()]);
  await assert.rejects(
    () => applyUndoOps(tx, [{ kind: "upsert", id: 1, fields: { startTime: "2026-09-02T17:00:00.000Z" } }], actor, "undo"),
    (e: unknown) => isAppError(e) && e.code === "VALIDATION_ERROR",
  );
  assert.equal(updateMock.mock.callCount(), 0);
});

test("applyUndoOps: update mění jen endTime, posune ho před DB startTime → VALIDATION_ERROR (C1, druhá hodnota z DB)", async () => {
  // row() má startTime 2026-09-02T14:00 — op posílá jen endTime 13:00.
  const { tx, updateMock } = mkTx([row()]);
  await assert.rejects(
    () => applyUndoOps(tx, [{ kind: "upsert", id: 1, fields: { endTime: "2026-09-02T13:00:00.000Z" } }], actor, "undo"),
    (e: unknown) => isAppError(e) && e.code === "VALIDATION_ERROR",
  );
  assert.equal(updateMock.mock.callCount(), 0);
});

test("applyUndoOps: neparsovatelné datum ('zítra') → VALIDATION_ERROR, ne RangeError z Prismy (C1)", async () => {
  const { tx, createMock } = mkTx([]);
  await assert.rejects(
    () => applyUndoOps(tx, [{
      kind: "upsert", id: 741,
      fields: { orderNumber: "17302", machine: "XL_105", startTime: "zítra", endTime: "2026-09-02T14:00:00.000Z" },
    }], actor, "undo"),
    (e: unknown) => isAppError(e) && e.code === "VALIDATION_ERROR",
  );
  assert.equal(createMock.mock.callCount(), 0);
});

test("applyUndoOps: update s startTime: null → VALIDATION_ERROR (nesmí se tiše zapsat jako epoch 1970)", async () => {
  const { tx, updateMock, store } = mkTx([row()]);
  await assert.rejects(
    () => applyUndoOps(tx, [{ kind: "upsert", id: 1, fields: { startTime: null } }], actor, "undo"),
    (e: unknown) => isAppError(e) && e.code === "VALIDATION_ERROR",
  );
  assert.equal(updateMock.mock.callCount(), 0);
  assert.equal(store.get(1)!.startTime.getTime(), row().startTime.getTime(), "blok se nesmí změnit");
});

test("applyUndoOps: zamykající SELECT ... FOR UPDATE proběhne PŘED findMany (I1)", async () => {
  const { tx, callOrder, queryRawMock } = mkTx([row()]);
  await applyUndoOps(tx, [{ kind: "upsert", id: 1, fields: { machine: "XL_105" } }], actor, "undo");

  const firstQueryRawIdx = callOrder.indexOf("queryRaw");
  const firstFindManyIdx = callOrder.indexOf("findMany");
  assert.ok(firstQueryRawIdx !== -1, "musí se zavolat $queryRaw (zamykající SELECT)");
  assert.ok(firstFindManyIdx !== -1, "musí se zavolat findMany (typovaná data k dalším krokům)");
  assert.ok(
    firstQueryRawIdx < firstFindManyIdx,
    `zamykající čtení musí proběhnout PŘED findMany (pořadí: ${callOrder.join(",")})`,
  );

  // Zamykající dotaz má tvar dvou argumentů (strings pole + Prisma.join fragment) —
  // odlišuje ho od pozdějšího overlap-check dotazu z overlapCheck.ts (5 argumentů:
  // strings + machine + id + endTime + startTime).
  const lockCall = queryRawMock.mock.calls[0]!;
  assert.equal(lockCall.arguments.length, 2, "zamykající dotaz má jen id-list jako parametr");
  const sqlText = (lockCall.arguments[0] as TemplateStringsArray).join("?");
  assert.ok(sqlText.includes("FOR UPDATE"), "zamykající dotaz musí obsahovat FOR UPDATE");
});

test("applyUndoOps: prázdná dávka ops vrátí prázdný výsledek bez volání DB (I1 guard pro Prisma.join)", async () => {
  const { tx, findManyMock, queryRawMock } = mkTx([]);
  const res = await applyUndoOps(tx, [], actor, "undo");
  assert.deepEqual(res, { updatedIds: [], createdIds: [], removed: [] });
  assert.equal(findManyMock.mock.callCount(), 0);
  assert.equal(queryRawMock.mock.callCount(), 0);
});

test("applyUndoOps: změna stroje — finální pojistka kontroluje CÍLOVÝ stroj, ne původní (I2 tripwire)", async () => {
  // Kdyby někdo v addToMachine napsal `row.machine` místo `saved.machine`, tenhle
  // test by to chytil: kontrola by běžela nad XL_105 (odkud blok odešel), ne XL_106.
  const { tx, queryRawMock } = mkTx([row({ id: 1, machine: "XL_105" })]);
  await applyUndoOps(tx, [{
    kind: "upsert", id: 1,
    fields: { machine: "XL_106", startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z" },
  }], actor, "undo");

  // Overlap-check dotaz z overlapCheck.ts má 5 argumentů (strings + machine + id +
  // endTime + startTime); zamykající dotaz z kroku výše má jen 2 — filtr je odliší.
  const overlapCalls = queryRawMock.mock.calls.filter((c) => c.arguments.length === 5);
  assert.ok(overlapCalls.length > 0, "assertNoOverlapForBlocks musí proběhnout");
  for (const call of overlapCalls) {
    assert.equal(call.arguments[1], "XL_106", "kontrola musí běžet nad CÍLOVÝM strojem XL_106, ne zdrojovým XL_105");
  }
});

test("applyUndoOps: remove zapíše CELÝ blok jako JSON do oldValue (I3 — obnova po redu bez dalšího undo kroku)", async () => {
  const { tx, auditMock } = mkTx([row({ id: 5, orderNumber: "99001", machine: "XL_106" })]);
  const res = await applyUndoOps(tx, [{ kind: "remove", id: 5 }], actor, "undo");

  const rows = (auditMock.mock.calls[0].arguments[0] as { data: Record<string, unknown>[] }).data;
  assert.equal(rows[0].field, "delete");
  assert.equal(rows[0].newValue, null);
  const snapshot = JSON.parse(rows[0].oldValue as string) as Record<string, unknown>;
  assert.equal(snapshot.id, 5);
  assert.equal(snapshot.orderNumber, "99001");
  assert.equal(snapshot.machine, "XL_106");
  // `removed` musí nést i machine ze smazaného bloku (Task 4 endpoint z něj skládá
  // block:deleted SSE payload — TISKAR filtr v events/route.ts je bez něj fail-closed).
  assert.deepEqual(res.removed, [{ id: 5, machine: "XL_106" }]);
});

test("applyUndoOps: remove kořene série rozváže potomky ADRESNĚ, ne kaskádou", async () => {
  // `Block.recurrenceParentId` má `ON DELETE SET NULL`, takže po smazání kořene
  // vynuluje odkaz potomkům sama MySQL — mimo Prismu, tedy mimo revizní obal:
  // série se rozpadne a v černé skříňce po tom nezůstane ani řádek. Adresný
  // `updateMany` obal vidí a potomci dostanou vlastní revizi.
  const { tx, store, updateManyMock, callOrder } = mkTx([
    row({ id: 5 }),
    row({ id: 6, recurrenceParentId: 5 }),
    row({ id: 7, recurrenceParentId: 5 }),
    row({ id: 8, recurrenceParentId: 99 }),
  ]);
  await applyUndoOps(tx, [{ kind: "remove", id: 5 }], actor, "undo");

  assert.equal(updateManyMock.mock.callCount(), 1, "rozvázání série musí proběhnout adresně");
  assert.deepEqual(updateManyMock.mock.calls[0].arguments[0], {
    where: { recurrenceParentId: 5 },
    data: { recurrenceParentId: null },
  });
  assert.equal(store.get(6)!.recurrenceParentId, null);
  assert.equal(store.get(7)!.recurrenceParentId, null);
  assert.equal(store.get(8)!.recurrenceParentId, 99, "cizí série se nesmí rozvázat");

  // Pořadí je součást opravy: zápis smí přijít až ZA zamykajícím čtením
  // (`$queryRaw ... FOR UPDATE` musí zůstat prvním dotazem transakce) a rozvázání
  // musí předcházet smazání, jinak kaskáda stihne udeřit dřív.
  assert.equal(callOrder[0], "queryRaw", "zamykající čtení zůstává první dotaz transakce");
  assert.ok(
    callOrder.indexOf("updateMany") < callOrder.indexOf("delete"),
    "rozvázání série musí být PŘED smazáním kořene",
  );
});

test("DATE_FIELDS: odvozeno ze SKUTEČNÉHO schema.prisma — pokrývá každý DateTime sloupec Blocku z UNDO_RESTORABLE_FIELDS (D2, go/no-go audit 5. 8. 2026)", () => {
  // Komentář u DATE_FIELDS slibuje: „nový DateTime sloupec přidaný do
  // UNDO_RESTORABLE_FIELDS bez odpovídajícího zápisu sem by poslal ISO string
  // místo Date do Prisma a spadl by na 500." Test to donedávna NEPLNIL — jen
  // porovnával DATE_FIELDS s ručně přepsanou kopií sebe sama (`expected`
  // literál, který nikdy nečetl ani UNDO_RESTORABLE_FIELDS, ani schéma), takže
  // by nový zapomenutý DateTime sloupec prošel beze stopy. Tenhle test čte
  // SKUTEČNÉ schema.prisma, takže slib doopravdy plní.
  //
  // Rozhodnutí (D2 nabízelo dvě cesty — spravit test, nebo zmírnit komentář):
  // schema-parsing je v repu bez precedentu, ale formát Block modelu je
  // stabilní (jeden sloupec na řádek, typ hned za jménem) a riziko křehkosti
  // je nízké proti ceně tiché regrese (ISO string do Prisma DateTime sloupce
  // je runtime pád, ne kompilační chyba — projeví se až při undo konkrétního
  // bloku v produkci).
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const modelMatch = schema.match(/model Block \{([\s\S]*?)\n\}/);
  assert.ok(modelMatch, "model Block nenalezen v prisma/schema.prisma — zkontroluj cestu/formát souboru");
  const body = modelMatch![1];

  // Relační pole (Block?, Block[], Reservation?, ...) nemají typ "DateTime" —
  // regex vyžaduje typ PŘESNĚ "DateTime" nebo "DateTime?", takže je bezpečně
  // přeskočí. Konec shody je BUĎ mezera (sloupec má za typem ještě atribut,
  // např. `createdAt DateTime @default(now())`), NEBO konec řádku (`split("\n")`
  // už oddělovač useknul, takže bezatributové sloupce jako `startTime DateTime`
  // s holým `\s` na konci nikdy nechytíš — to byl první pokus a mlčky
  // vynechal většinu sloupců, testu ovšem procházel, protože `dateTimeColumns`
  // nebylo prázdné jako celek, jen chybělo přesně to, co mělo být nalezené).
  const dateTimeColumns = new Set<string>();
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*(\w+)\s+DateTime\??(?:\s|$)/);
    if (m) dateTimeColumns.add(m[1]);
  }
  assert.ok(dateTimeColumns.size > 0, "parser nenašel žádný DateTime sloupec — regex/formát schématu se pravděpodobně změnil");

  // Jen průnik s UNDO_RESTORABLE_FIELDS — undo se netýká DateTime sloupců mimo
  // allowlist (createdAt/updatedAt/printCompletedAt jsou vědomě vyloučené).
  const expected = [...dateTimeColumns].filter((f) => isRestorableField(f));
  assert.deepEqual([...DATE_FIELDS].sort(), expected.sort());
});

// ── I2 (go/no-go audit 5. 8. 2026): audit u NE-pozičního pole ────────────────

test("applyUndoOps (I2): audit u NE-pozičního pole zapíše seznam obnovených klíčů, ne smyšlený časový span", async () => {
  const { tx, auditMock } = mkTx([row()]);
  await applyUndoOps(tx, [{ kind: "upsert", id: 1, fields: { materialStatusId: 7 } }], actor, "undo");
  const rows = (auditMock.mock.calls[0].arguments[0] as { data: Record<string, unknown>[] }).data;
  assert.equal(rows[0].field, "fields", "NE 'startTime/endTime/machine' — pozice se vůbec neobnovuje");
  assert.equal(rows[0].oldValue, null, "server nezná staré hodnoty jednotlivých polí, jen jejich seznam");
  assert.equal(rows[0].newValue, "materialStatusId");
});

test("applyUndoOps (I2): víc obnovených NE-pozičních polí → seznam klíčů SEŘAZENÝ, ne pořadí vložení do objektu", async () => {
  const { tx, auditMock } = mkTx([row()]);
  await applyUndoOps(tx, [{ kind: "upsert", id: 1, fields: { pantoneOk: true, dataOk: false } }], actor, "undo");
  const rows = (auditMock.mock.calls[0].arguments[0] as { data: Record<string, unknown>[] }).data;
  assert.equal(rows[0].newValue, "dataOk, pantoneOk", "abecedně — pantoneOk bylo v objektu první, ale musí být druhé");
});

test("applyUndoOps (I2 + fix round 1): pozice I obchodní pole v JEDNOM opu → SMÍŠENÝ řádek, span I seznam polí zůstanou OBA", async () => {
  // Scénář C1c: chain-pushnutý split sourozenec (nebo kotva z mergeAnchorPositionIfChanged,
  // etapa A) dostane business pole i pozici v JEDNOM upsertu. Audit musí ukázat OBOJÍ —
  // původní I2 (go/no-go audit 5. 8. 2026) tu jen zajistil, že se ukáže SPRÁVNÝ span
  // místo smyšleného; binární gate ale pořád vybíral BUĎ span, NEBO seznam polí a u
  // smíšeného zápisu seznam business polí tiše zahazoval (review nález, fix round 1) —
  // přesně u NEJBĚŽNĚJŠÍHO případu smíšené editace (termín + popis v jednom uložení),
  // ne okrajového.
  const { tx, auditMock } = mkTx([row()]);
  await applyUndoOps(tx, [{
    kind: "upsert", id: 1,
    fields: { startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z", machine: "XL_105", materialStatusId: 7 },
  }], actor, "undo");
  const rows = (auditMock.mock.calls[0].arguments[0] as { data: Record<string, unknown>[] }).data;
  assert.equal(rows[0].field, `${UNDO_MIXED_FIELD_PREFIX}materialStatusId`, "field nese poziční marker I seznam business polí");
  assert.ok(String(rows[0].oldValue).includes("–"), "oldValue zůstává span 'start–end', ne seznam klíčů");
  assert.ok(String(rows[0].newValue).includes("2026-09-02T10:00:00.000Z"), "newValue zůstává span, ne seznam klíčů");
});

test("applyUndoOps (fix round 1): čistě poziční upsert s CELOU pěticí (+printMinutes/scheduleBypassed) NESMÍ vypadat jako smíšený", async () => {
  // posOp/mergePositionIntoTargets (src/lib/undo/commands.ts, splitSiblingFields.ts) vždy
  // posílají printMinutes+scheduleBypassed SPOLU se startTime/endTime/machine — i u ryze
  // pozičního přesunu beze změny jediného business pole. MUTAČNÍ POJISTKA: kdyby "otherKeys"
  // vyřazovalo z business seznamu jen trojici (startTime/endTime/machine), kterou testuje
  // touchesPosition, a ne CELOU poziční pětici, KAŽDÝ čistě poziční krok by dostal
  // "+fields:printMinutes, scheduleBypassed" navíc, i když žádné business pole nešlo.
  const { tx, auditMock } = mkTx([row()]);
  await applyUndoOps(tx, [{
    kind: "upsert", id: 1,
    fields: {
      startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z", machine: "XL_105",
      printMinutes: 120, scheduleBypassed: false,
    },
  }], actor, "undo");
  const rows = (auditMock.mock.calls[0].arguments[0] as { data: Record<string, unknown>[] }).data;
  assert.equal(rows[0].field, "startTime/endTime/machine", "žádný '+fields:' sufix — printMinutes/scheduleBypassed nejsou business pole");
});

test("applyUndoOps (fix round 1): smíšený řádek s VÍC business poli → seznam v field SEŘAZENÝ (parita s I2 seznamem pro čistě polní řádek)", async () => {
  const { tx, auditMock } = mkTx([row()]);
  await applyUndoOps(tx, [{
    kind: "upsert", id: 1,
    fields: { startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z", machine: "XL_105", pantoneOk: true, dataOk: false },
  }], actor, "undo");
  const rows = (auditMock.mock.calls[0].arguments[0] as { data: Record<string, unknown>[] }).data;
  assert.equal(rows[0].field, `${UNDO_MIXED_FIELD_PREFIX}dataOk, pantoneOk`, "abecedně — pantoneOk bylo v objektu první, ale musí být druhé");
});

test("applyUndoOps (fix round 1): smíšený řádek s VŠEMI business poli (celý formulář) se doopravdy ořízne — nesmí spadnout na DB limit VARCHAR(191)", async () => {
  // Přesně scénář, na který review upozornila: „u editace celého formuláře jich může
  // být hodně". Použité klíče jsou SKUTEČNÝ UNDO_RESTORABLE_FIELDS (minus poziční
  // pětice), ne uměle vymyšlený dlouhý string — kdyby formulář v budoucnu přibral další
  // pole, test roste s ním.
  const { tx, auditMock } = mkTx([row()]);
  const businessFields = UNDO_RESTORABLE_FIELDS.filter((f) => !["startTime", "endTime", "machine", "printMinutes", "scheduleBypassed"].includes(f));
  const fields: Record<string, unknown> = {
    startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z", machine: "XL_105",
  };
  for (const f of businessFields) fields[f] = null; // hodnota nehraje roli, do field se počítá jen klíč
  await applyUndoOps(tx, [{ kind: "upsert", id: 1, fields }], actor, "undo");
  const rows = (auditMock.mock.calls[0].arguments[0] as { data: Record<string, unknown>[] }).data;
  const fieldVal = rows[0].field as string;
  assert.ok(fieldVal.startsWith(UNDO_MIXED_FIELD_PREFIX), "pořád rozpoznatelný jako smíšený i po ořezu");
  const byteLen = Buffer.byteLength(fieldVal, "utf8");
  assert.ok(byteLen <= 191, `field musí projít do sloupce VARCHAR(191), má ${byteLen} bajtů: "${fieldVal}"`);
  const untruncatedList = businessFields.slice().sort().join(", ");
  assert.ok(fieldVal.length < UNDO_MIXED_FIELD_PREFIX.length + untruncatedList.length, "musí být DOOPRAVDY oříznuté (celý seznam by se do 191 bajtů nevešel), ne jen náhodou pod limitem");
});

// ── D3 (go/no-go audit 5. 8. 2026): warn při obnově do firemní odstávky ──────

test("applyUndoOps (D3): obnova pozice DO firemní odstávky zaloguje warn (spec §5 — neblokuje)", async (t) => {
  const warnSpy = t.mock.method(logger, "warn", () => {});
  const { tx } = mkTx([row()], {
    companyDays: [{ start: T("2026-09-02T00:00:00.000Z"), end: T("2026-09-03T00:00:00.000Z") }],
  });
  await applyUndoOps(tx, [{
    kind: "upsert", id: 1,
    fields: { startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z", machine: "XL_105" },
  }], actor, "undo");
  const msgs = warnSpy.mock.calls.map((c) => String(c.arguments[0]));
  assert.ok(msgs.some((m) => m.includes("odstávk")), `očekávám warn o odstávce, dostal jsem: ${JSON.stringify(msgs)}`);
});

test("applyUndoOps (D3): obnova pozice MIMO odstávku warn o odstávce nezaloguje", async (t) => {
  const warnSpy = t.mock.method(logger, "warn", () => {});
  const { tx } = mkTx([row()], { companyDays: [] });
  await applyUndoOps(tx, [{
    kind: "upsert", id: 1,
    fields: { startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z", machine: "XL_105" },
  }], actor, "undo");
  const msgs = warnSpy.mock.calls.map((c) => String(c.arguments[0]));
  assert.ok(!msgs.some((m) => m.includes("odstávk")));
});

test("applyUndoOps (D3): čistě obchodní editace (pozice se netýká) nekontroluje odstávku vůbec — MUTAČNÍ POJISTKA", async (t) => {
  const warnSpy = t.mock.method(logger, "warn", () => {});
  const { tx } = mkTx([row()], {
    // row() má startTime 2026-09-02T14:00 — tahle odstávka by ho zasáhla,
    // KDYBY se kontrolovala bez ohledu na to, jestli se pozice mění. Test tak
    // odliší „gate podle přítomnosti startTime/endTime v op.fields" od
    // (chybné) varianty „kontroluj vždy, ať se mění pozice, nebo ne".
    companyDays: [{ start: T("2026-09-02T00:00:00.000Z"), end: T("2026-09-03T00:00:00.000Z") }],
  });
  await applyUndoOps(tx, [{ kind: "upsert", id: 1, fields: { materialStatusId: 7 } }], actor, "undo");
  assert.equal(warnSpy.mock.calls.length, 0, "operace se času vůbec netýká — žádný warn, ani mřížkový, ani odstávkový");
});

// ── D4 (go/no-go audit 5. 8. 2026): finální pojistka prochází stroje seřazené ─

test("applyUndoOps (D4): finální pojistka prochází stroje SEŘAZENĚ podle jména, ne v pořadí vložení (prevence deadlocku)", async () => {
  const { tx, findManyMock } = mkTx([row({ id: 1, machine: "XL_106" }), row({ id: 2, machine: "XL_105" })]);
  // Op pro XL_106 je v poli PRVNÍ → bez opravy by idsByMachine vložil XL_106
  // jako první klíč Map (insertion order) a assertNoOverlapForBlocks by nad
  // ním běžel dřív než nad XL_105 — opačně, než je abecedně.
  await applyUndoOps(tx, [
    { kind: "upsert", id: 1, fields: { machine: "XL_106", startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z" } },
    { kind: "upsert", id: 2, fields: { machine: "XL_105", startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z" } },
  ], actor, "undo");
  // Volání findMany PO počátečním načtení existujících řádků (index 0) patří
  // finální pojistce — jedno volání na stroj, v pořadí, ve kterém funkce stroje iteruje.
  const overlapCalls = findManyMock.mock.calls.slice(1);
  assert.equal(overlapCalls.length, 2, "assertNoOverlapForBlocks se volá jednou za cílový stroj");
  const firstIds = (overlapCalls[0].arguments[0] as { where: { id: { in: number[] } } }).where.id.in;
  assert.deepEqual(firstIds, [2], "XL_105 (blok 2) musí přijít na řadu PŘED XL_106 (blok 1), i když byl v ops až druhý");
});
