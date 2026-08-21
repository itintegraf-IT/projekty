import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithCascadeConfirm, askOncePerGesture, type CascadeAsk } from "./cascadeConfirmClient";

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

test("group paste: sdílený 'zeptej se jednou za dávku' wrapper se ptá jen na PRVNÍ kaskádu", async () => {
  // Stejná logika jako `askCascadeOnceForGroup` v `handleGroupPasteWithTarget`
  // (PlannerPage.tsx) — postavená TADY v testu, ne v produkčním modulu, protože
  // patří k tomu jednomu volajícímu (vložení skupiny je jedno gesto uživatele,
  // i když je to N requestů; druhý a další blok skupiny se už neptají znovu).
  const cascade = { movedCount: 5, maxShiftMs: 1, farthestEnd: null };
  const { fn, calls } = fakeFetch([
    { status: 409, body: { code: "CASCADE_CONFIRM", error: "…", cascade } },
    { status: 200, body: { id: 1 } },
    { status: 409, body: { code: "CASCADE_CONFIRM", error: "…", cascade } },
    { status: 200, body: { id: 2 } },
  ]);

  let askedTimes = 0;
  let groupCascadeConfirmed = false;
  const askOnceForGroup = async (): Promise<boolean> => {
    if (groupCascadeConfirmed) return true;
    askedTimes++;
    groupCascadeConfirmed = true;
    return true;
  };

  const res1 = await fetchWithCascadeConfirm("/api/blocks", "POST", { block: 1 }, askOnceForGroup, fn);
  const res2 = await fetchWithCascadeConfirm("/api/blocks", "POST", { block: 2 }, askOnceForGroup, fn);

  assert.equal(askedTimes, 1);
  assert.equal(calls.length, 4);
  assert.equal((calls[1]!.body as Record<string, unknown>).cascadeConfirmed, true);
  assert.equal((calls[3]!.body as Record<string, unknown>).cascadeConfirmed, true);
  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
});

test("askOncePerGesture: druhý a další požadavek se už neptá", async () => {
  let asked = 0;
  const once = askOncePerGesture(async () => { asked++; return true; });
  assert.equal(await once({ movedCount: 6, maxShiftMs: 1, farthestEnd: null }), true);
  assert.equal(await once({ movedCount: 9, maxShiftMs: 1, farthestEnd: null }), true);
  assert.equal(await once({ movedCount: 3, maxShiftMs: 1, farthestEnd: null }), true);
  assert.equal(asked, 1, "za jedno gesto se ptáme nejvýš jednou");
});

test("askOncePerGesture: po ZAMÍTNUTÍ se ptá znovu (paměť si drží jen souhlas)", async () => {
  // Zamítnutí není rozhodnutí o celém gestu — uživatel odmítl JEDEN posun. Kdyby si
  // wrapper pamatoval i „ne", tiše by zamítl i zbytek dávky bez zeptání.
  let asked = 0;
  const once = askOncePerGesture(async () => { asked++; return asked > 1; });
  assert.equal(await once({ movedCount: 6, maxShiftMs: 1, farthestEnd: null }), false);
  assert.equal(await once({ movedCount: 6, maxShiftMs: 1, farthestEnd: null }), true);
  assert.equal(asked, 2);
});

test("askOncePerGesture: každé gesto má vlastní paměť", async () => {
  let asked = 0;
  const ask: CascadeAsk = async () => { asked++; return true; };
  await askOncePerGesture(ask)({ movedCount: 6, maxShiftMs: 1, farthestEnd: null });
  await askOncePerGesture(ask)({ movedCount: 6, maxShiftMs: 1, farthestEnd: null });
  assert.equal(asked, 2, "druhé gesto se musí zeptat znovu");
});
