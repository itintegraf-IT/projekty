import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { sanitizeUndoOps, applyUndoOps, DATE_FIELDS } from "./undoApply.server";
import { isAppError } from "./errors";

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
};

const T = (iso: string) => new Date(iso);
const actor = { id: 42, username: "planovac" };

function row(over: Partial<Row> = {}): Row {
  return {
    id: 1, orderNumber: "17300", machine: "XL_105",
    startTime: T("2026-09-02T14:00:00.000Z"), endTime: T("2026-09-02T16:00:00.000Z"),
    updatedAt: T("2026-08-01T10:00:00.000Z"), printCompletedAt: null, ...over,
  };
}

/** Fake tx podle vzoru reflow.server.test.ts — obyčejné objekty s mock.fn. */
function mkTx(rows: Row[], opts: { conflicts?: { id: number; orderNumber: string | null }[] } = {}) {
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
  const auditMock = mock.fn(async (a: { data: unknown[] }) => ({ count: a.data.length }));
  const findManyMock = mock.fn(async (a: { where: { id: { in: number[] } } }) => {
    callOrder.push("findMany");
    return a.where.id.in.map((i) => store.get(i)).filter(Boolean);
  });
  const queryRawMock = mock.fn(async (..._args: unknown[]) => {
    callOrder.push("queryRaw");
    return opts.conflicts ?? [];
  });
  const tx = {
    block: {
      findMany: findManyMock,
      update: updateMock, create: createMock, delete: deleteMock,
    },
    auditLog: { createMany: auditMock },
    $queryRaw: queryRawMock,
  } as never;
  return { tx, store, updateMock, createMock, deleteMock, auditMock, findManyMock, queryRawMock, callOrder };
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

test("DATE_FIELDS: pokrývá přesně očekávanou množinu DateTime sloupců (M6 tripwire)", () => {
  // Nový DateTime sloupec přidaný do UNDO_RESTORABLE_FIELDS bez odpovídajícího
  // zápisu sem by poslal ISO string místo Date do Prisma → pád na 500.
  const expected = [
    "startTime", "endTime", "deadlineExpedice", "dataRequiredDate",
    "materialRequiredDate", "pantoneRequiredDate", "expeditionPublishedAt",
  ];
  assert.deepEqual([...DATE_FIELDS].sort(), [...expected].sort());
  assert.equal(DATE_FIELDS.size, 7);
});
