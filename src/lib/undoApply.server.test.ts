import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { sanitizeUndoOps, applyUndoOps } from "./undoApply.server";
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
  const updateMock = mock.fn(async (a: { where: { id: number }; data: Record<string, unknown> }) => {
    const cur = store.get(a.where.id)!;
    const next = { ...cur, ...a.data } as Row;
    store.set(a.where.id, next);
    return next;
  });
  const createMock = mock.fn(async (a: { data: Record<string, unknown> }) => {
    const next = { ...row(), ...a.data } as Row;
    store.set(next.id, next);
    return next;
  });
  const deleteMock = mock.fn(async (a: { where: { id: number } }) => {
    const cur = store.get(a.where.id);
    store.delete(a.where.id);
    return cur ?? null;
  });
  const auditMock = mock.fn(async (a: { data: unknown[] }) => ({ count: a.data.length }));
  const tx = {
    block: {
      findMany: mock.fn(async (a: { where: { id: { in: number[] } } }) =>
        a.where.id.in.map((i) => store.get(i)).filter(Boolean)),
      update: updateMock, create: createMock, delete: deleteMock,
    },
    auditLog: { createMany: auditMock },
    $queryRaw: mock.fn(async () => opts.conflicts ?? []),
  } as never;
  return { tx, store, updateMock, createMock, deleteMock, auditMock };
}

test("applyUndoOps: upsert zapíše off-grid start doslova (opravený incident 4. 8.)", async () => {
  const { tx, store, updateMock } = mkTx([row()]);
  await applyUndoOps(tx, [{
    kind: "upsert", id: 1,
    fields: { startTime: "2026-09-02T14:45:00.000Z", endTime: "2026-09-02T16:45:00.000Z", machine: "XL_105" },
  }], actor, "Přesun bloku", "undo");
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
  }], actor, "Přesun bloku", "undo");
  assert.equal(store.get(1)!.endTime.toISOString(), "2026-09-03T06:00:00.000Z", "endTime se NEsmí dopočítat z printMinutes");
});

test("applyUndoOps: stale expectedUpdatedAt → CONFLICT a ŽÁDNÝ zápis", async () => {
  const { tx, updateMock, deleteMock, auditMock } = mkTx([row(), row({ id: 2 })]);
  await assert.rejects(
    () => applyUndoOps(tx, [
      { kind: "upsert", id: 1, expectedUpdatedAt: "2026-08-01T10:00:00.000Z", fields: { machine: "XL_106" } },
      { kind: "upsert", id: 2, expectedUpdatedAt: "1999-01-01T00:00:00.000Z", fields: { machine: "XL_106" } },
    ], actor, "Přesun bloku", "undo"),
    (e: unknown) => isAppError(e) && e.code === "CONFLICT",
  );
  assert.equal(updateMock.mock.callCount(), 0, "zámek se kontroluje PŘED prvním zápisem");
  assert.equal(deleteMock.mock.callCount(), 0);
  assert.equal(auditMock.mock.callCount(), 0);
});

test("applyUndoOps: remove neexistujícího bloku je úspěch (idempotence)", async () => {
  const { tx, deleteMock } = mkTx([]);
  const res = await applyUndoOps(tx, [{ kind: "remove", id: 99 }], actor, "Vložení bloku", "undo");
  assert.deepEqual(res.removedIds, []);
  assert.equal(deleteMock.mock.callCount(), 0, "chybějící řádek se nemaže, jen se přeskočí");
});

test("applyUndoOps: remove bloku s potvrzeným tiskem → CONFLICT", async () => {
  const { tx, deleteMock } = mkTx([row({ printCompletedAt: T("2026-09-01T12:00:00.000Z") })]);
  await assert.rejects(
    () => applyUndoOps(tx, [{ kind: "remove", id: 1 }], actor, "Vložení bloku", "undo"),
    (e: unknown) => isAppError(e) && e.code === "CONFLICT",
  );
  assert.equal(deleteMock.mock.callCount(), 0);
});

test("applyUndoOps: upsert chybějícího bloku ho vytvoří s PŮVODNÍM id", async () => {
  const { tx, createMock, store } = mkTx([]);
  const res = await applyUndoOps(tx, [{
    kind: "upsert", id: 738,
    fields: { orderNumber: "17300", machine: "XL_105", startTime: "2026-09-02T14:00:00.000Z", endTime: "2026-09-02T16:00:00.000Z" },
  }], actor, "Smazání bloku", "undo");
  assert.deepEqual(res.createdIds, [738]);
  assert.equal((createMock.mock.calls[0].arguments[0] as { data: { id: number } }).data.id, 738);
  assert.ok(store.has(738));
});

test("applyUndoOps: vytvoření bez povinného pole → VALIDATION_ERROR", async () => {
  const { tx, createMock } = mkTx([]);
  await assert.rejects(
    () => applyUndoOps(tx, [{ kind: "upsert", id: 738, fields: { orderNumber: "17300" } }], actor, "Smazání bloku", "undo"),
    (e: unknown) => isAppError(e) && e.code === "VALIDATION_ERROR",
  );
  assert.equal(createMock.mock.callCount(), 0);
});

test("applyUndoOps: výsledný překryv → OVERLAP (pojistka nemá únikovou cestu)", async () => {
  const { tx } = mkTx([row()], { conflicts: [{ id: 2, orderNumber: "17301" }] });
  await assert.rejects(
    () => applyUndoOps(tx, [{ kind: "upsert", id: 1, fields: { machine: "XL_105", startTime: "2026-09-02T14:00:00.000Z", endTime: "2026-09-02T16:00:00.000Z" } }],
      actor, "Přesun bloku", "undo"),
    (e: unknown) => isAppError(e) && e.code === "OVERLAP",
  );
});

test("applyUndoOps: zapíše audit s akcí UNDO a spanem start–end", async () => {
  const { tx, auditMock } = mkTx([row()]);
  await applyUndoOps(tx, [{
    kind: "upsert", id: 1,
    fields: { machine: "XL_105", startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z" },
  }], actor, "Přesun bloku", "undo");
  const rows = (auditMock.mock.calls[0].arguments[0] as { data: Record<string, unknown>[] }).data;
  assert.equal(rows[0].action, "UNDO");
  assert.equal(rows[0].userId, 42);
  assert.ok(String(rows[0].oldValue).includes("–"), "oldValue je span 'start–end'");
  assert.ok(String(rows[0].newValue).includes("2026-09-02T10:00:00.000Z"));
});
