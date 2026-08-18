import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithCascadeConfirm } from "./cascadeConfirmClient";

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  let i = 0;
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      clone: () => ({ json: async () => r.body }),
    } as unknown as Response;
  };
  return { fn, calls };
}

test("bez kaskády se posílá jeden požadavek", async () => {
  const { fn, calls } = fakeFetch([{ status: 200, body: { id: 1 } }]);
  const res = await fetchWithCascadeConfirm("/api/blocks/1", "PUT", { startTime: "x" }, async () => true, fn);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal((calls[0]!.body as Record<string, unknown>).cascadeConfirmed, undefined);
});

test("409 CASCADE_CONFIRM + potvrzení pošle požadavek znovu s příznakem", async () => {
  const { fn, calls } = fakeFetch([
    { status: 409, body: { code: "CASCADE_CONFIRM", error: "…", cascade: { movedCount: 20, maxShiftMs: 1, farthestEnd: null } } },
    { status: 200, body: { id: 1 } },
  ]);
  let asked: unknown = null;
  const res = await fetchWithCascadeConfirm("/api/blocks/1", "PUT", { startTime: "x" }, async (p) => { asked = p; return true; }, fn);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  assert.equal((calls[1]!.body as Record<string, unknown>).cascadeConfirmed, true);
  assert.deepEqual(asked, { movedCount: 20, maxShiftMs: 1, farthestEnd: null });
});

test("odmítnutí vrátí PŮVODNÍ 409 — volající si chybu ošetří sám", async () => {
  const { fn, calls } = fakeFetch([
    { status: 409, body: { code: "CASCADE_CONFIRM", error: "…", cascade: { movedCount: 20, maxShiftMs: 1, farthestEnd: null } } },
  ]);
  const res = await fetchWithCascadeConfirm("/api/blocks/1", "PUT", {}, async () => false, fn);
  assert.equal(res.status, 409);
  assert.equal(calls.length, 1);
});

test("jiná 409 (OVERLAP) se NEptá a propustí se rovnou", async () => {
  const { fn, calls } = fakeFetch([{ status: 409, body: { code: "OVERLAP", error: "…" } }]);
  let askedTimes = 0;
  const res = await fetchWithCascadeConfirm("/api/blocks/1", "PUT", {}, async () => { askedTimes++; return true; }, fn);
  assert.equal(res.status, 409);
  assert.equal(askedTimes, 0);
  assert.equal(calls.length, 1);
});

test("po potvrzení se NEptá podruhé, i kdyby server 409 zopakoval", async () => {
  const body = { code: "CASCADE_CONFIRM", error: "…", cascade: { movedCount: 9, maxShiftMs: 1, farthestEnd: null } };
  const { fn, calls } = fakeFetch([{ status: 409, body }, { status: 409, body }]);
  let askedTimes = 0;
  const res = await fetchWithCascadeConfirm("/api/blocks/1", "PUT", {}, async () => { askedTimes++; return true; }, fn);
  assert.equal(askedTimes, 1);
  assert.equal(calls.length, 2);
  assert.equal(res.status, 409);
});
