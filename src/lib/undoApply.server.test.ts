import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeUndoOps } from "./undoApply.server";
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
