import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOverlapPairs, computeIntegrityIssues, diffAttachmentFiles, bucketDrift, type BlockRow, type IntegrityRefs, type AttachmentFileRow, type DiskEntry } from "./healthChecks.server";
import type { DriftedBlock } from "./calendarDrift.server";

const D = (iso: string) => new Date(iso);
function blk(o: Partial<BlockRow> & Pick<BlockRow, "id" | "startTime" | "endTime">): BlockRow {
  return {
    orderNumber: `Z-${o.id}`, machine: "XL_105", type: "ZAKAZKA",
    printMinutes: 120, printCompletedAt: null,
    splitGroupId: null, reservationId: null, jobPresetId: null, recurrenceParentId: null,
    ...o,
  };
}
const NOW = D("2026-07-17T00:00:00.000Z");

test("computeOverlapPairs: dva budoucí překrývající se bloky → 1 pár", () => {
  const a = blk({ id: 1, startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  const b = blk({ id: 2, startTime: D("2026-08-01T09:00:00Z"), endTime: D("2026-08-01T11:00:00Z") });
  const pairs = computeOverlapPairs([a, b], NOW);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a.id, 1);
  assert.equal(pairs[0].b.id, 2);
  assert.equal(pairs[0].overlapMinutes, 60);
});

test("computeOverlapPairs: dotýkající se bloky (end===start) → 0 párů", () => {
  const a = blk({ id: 1, startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  const b = blk({ id: 2, startTime: D("2026-08-01T10:00:00Z"), endTime: D("2026-08-01T12:00:00Z") });
  assert.equal(computeOverlapPairs([a, b], NOW).length, 0);
});

test("computeOverlapPairs: překryv celý v minulosti → 0 (jen budoucí)", () => {
  const a = blk({ id: 1, startTime: D("2026-06-01T08:00:00Z"), endTime: D("2026-06-01T10:00:00Z") });
  const b = blk({ id: 2, startTime: D("2026-06-01T09:00:00Z"), endTime: D("2026-06-01T11:00:00Z") });
  assert.equal(computeOverlapPairs([a, b], NOW).length, 0);
});

test("computeOverlapPairs: různé stroje ve stejný čas → 0", () => {
  const a = blk({ id: 1, machine: "XL_105", startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  const b = blk({ id: 2, machine: "XL_106", startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  assert.equal(computeOverlapPairs([a, b], NOW).length, 0);
});

test("computeOverlapPairs: typově agnostické (REZERVACE × UDRZBA) → 1 pár", () => {
  const a = blk({ id: 1, type: "REZERVACE", startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  const b = blk({ id: 2, type: "UDRZBA", startTime: D("2026-08-01T09:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  const pairs = computeOverlapPairs([a, b], NOW);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].overlapMinutes, 60);
});

test("computeOverlapPairs: tři vzájemně se překrývající → 3 páry", () => {
  const a = blk({ id: 1, startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T11:00:00Z") });
  const b = blk({ id: 2, startTime: D("2026-08-01T09:00:00Z"), endTime: D("2026-08-01T12:00:00Z") });
  const c = blk({ id: 3, startTime: D("2026-08-01T10:00:00Z"), endTime: D("2026-08-01T13:00:00Z") });
  assert.equal(computeOverlapPairs([a, b, c], NOW).length, 3);
});

// ── Integrita dat ──────────────────────────────────────────────────────────
function refs(o: Partial<IntegrityRefs> = {}): IntegrityRefs {
  return {
    splitGroupIds: o.splitGroupIds ?? new Set<number>(),
    reservationIds: o.reservationIds ?? new Set<number>(),
    jobPresetIds: o.jobPresetIds ?? new Set<number>(),
    blockIds: o.blockIds ?? new Set<number>(),
  };
}
function issue(res: ReturnType<typeof computeIntegrityIssues>, key: string) {
  const it = res.find((i) => i.key === key);
  assert.ok(it, `chybí kontrola ${key}`);
  return it!;
}
const OK_START = D("2026-08-03T08:00:00Z"); // zarovnaný na 30min
const OK_END = D("2026-08-03T10:00:00Z");

test("integrity: osiřelý jobPreset se hlásí, platný ne", () => {
  const orphan = blk({ id: 1, startTime: OK_START, endTime: OK_END, jobPresetId: 99 });
  const ok = blk({ id: 2, startTime: OK_START, endTime: OK_END, jobPresetId: 5 });
  const res = computeIntegrityIssues([orphan, ok], refs({ jobPresetIds: new Set([5]), blockIds: new Set([1, 2]) }));
  const it = issue(res, "orphanJobPreset");
  assert.deepEqual(it.sampleBlockIds, [1]);
  assert.equal(it.count, 1);
});

test("integrity: osiřelý splitGroup / reservation / recurrenceParent", () => {
  const b1 = blk({ id: 1, startTime: OK_START, endTime: OK_END, splitGroupId: 7 });
  const b2 = blk({ id: 2, startTime: OK_START, endTime: OK_END, reservationId: 8 });
  const b3 = blk({ id: 3, startTime: OK_START, endTime: OK_END, recurrenceParentId: 900 });
  const res = computeIntegrityIssues([b1, b2, b3], refs({ blockIds: new Set([1, 2, 3]) }));
  assert.equal(issue(res, "orphanSplitGroup").count, 1);
  assert.equal(issue(res, "orphanReservation").count, 1);
  assert.equal(issue(res, "orphanRecurrenceParent").count, 1);
});

test("integrity: neplatný stroj a typ", () => {
  const bad = blk({ id: 1, machine: "XX_999", type: "PRUSER", startTime: OK_START, endTime: OK_END });
  const res = computeIntegrityIssues([bad], refs({ blockIds: new Set([1]) }));
  assert.equal(issue(res, "invalidMachine").count, 1);
  assert.equal(issue(res, "invalidType").count, 1);
});

test("integrity: konec <= začátek", () => {
  const bad = blk({ id: 1, startTime: D("2026-08-03T10:00:00Z"), endTime: D("2026-08-03T08:00:00Z") });
  const res = computeIntegrityIssues([bad], refs({ blockIds: new Set([1]) }));
  assert.equal(issue(res, "negativeInterval").count, 1);
});

test("integrity: vadné printMinutes (odd/too big/<=0); NULL a completed se nehlásí", () => {
  const odd = blk({ id: 1, startTime: OK_START, endTime: OK_END, printMinutes: 45 });
  const big = blk({ id: 2, startTime: OK_START, endTime: OK_END, printMinutes: 3000 });
  const nul = blk({ id: 3, startTime: OK_START, endTime: OK_END, printMinutes: null });
  const done = blk({ id: 4, startTime: OK_START, endTime: OK_END, printMinutes: 45, printCompletedAt: D("2026-08-04T00:00:00Z") });
  const res = computeIntegrityIssues([odd, big, nul, done], refs({ blockIds: new Set([1, 2, 3, 4]) }));
  const it = issue(res, "badPrintMinutes");
  assert.equal(it.count, 2);
  assert.deepEqual(it.sampleBlockIds, [1, 2]);
});

test("integrity: nezarovnaný start jen ZAKAZKA nedokončená; REZERVACE ne", () => {
  const zak = blk({ id: 1, type: "ZAKAZKA", startTime: D("2026-08-03T08:15:00Z"), endTime: OK_END });
  const rez = blk({ id: 2, type: "REZERVACE", startTime: D("2026-08-03T08:15:00Z"), endTime: OK_END });
  const res = computeIntegrityIssues([zak, rez], refs({ blockIds: new Set([1, 2]) }));
  const it = issue(res, "unalignedStart");
  assert.equal(it.count, 1);
  assert.deepEqual(it.sampleBlockIds, [1]);
});

test("integrity: split-skupina < 2 bloky (1 člen i prázdná skupina)", () => {
  const lone = blk({ id: 1, startTime: OK_START, endTime: OK_END, splitGroupId: 10 });
  // skupina 10 má 1 člena; skupina 20 je v setu, ale nemá žádný blok
  const res = computeIntegrityIssues([lone], refs({ splitGroupIds: new Set([10, 20]), blockIds: new Set([1]) }));
  assert.equal(issue(res, "undersizedSplitGroup").count, 2);
});

// ── Přílohy ────────────────────────────────────────────────────────────────

test("diffAttachmentFiles: DB řádek bez souboru → missing", () => {
  const db: AttachmentFileRow[] = [{ id: 1, reservationId: 5, originalName: "a.pdf", storageKey: "k1" }];
  const disk: DiskEntry[] = [];
  const r = diffAttachmentFiles(db, disk);
  assert.equal(r.missingFiles.length, 1);
  assert.equal(r.orphanFiles.length, 0);
});

test("diffAttachmentFiles: soubor bez DB řádku → orphan", () => {
  const db: AttachmentFileRow[] = [];
  const disk: DiskEntry[] = [{ reservationId: 5, storageKey: "k1" }];
  const r = diffAttachmentFiles(db, disk);
  assert.equal(r.missingFiles.length, 0);
  assert.equal(r.orphanFiles.length, 1);
});

test("diffAttachmentFiles: shoda → žádný nález", () => {
  const db: AttachmentFileRow[] = [{ id: 1, reservationId: 5, originalName: "a.pdf", storageKey: "k1" }];
  const disk: DiskEntry[] = [{ reservationId: 5, storageKey: "k1" }];
  const r = diffAttachmentFiles(db, disk);
  assert.equal(r.missingFiles.length, 0);
  assert.equal(r.orphanFiles.length, 0);
});

test("diffAttachmentFiles: stejný storageKey pod jinou rezervací není shoda", () => {
  const db: AttachmentFileRow[] = [{ id: 1, reservationId: 5, originalName: "a.pdf", storageKey: "k1" }];
  const disk: DiskEntry[] = [{ reservationId: 6, storageKey: "k1" }];
  const r = diffAttachmentFiles(db, disk);
  assert.equal(r.missingFiles.length, 1);
  assert.equal(r.orphanFiles.length, 1);
});

// ── Drift bucket ─────────────────────────────────────────────────────────────

test("bucketDrift: END_MISMATCH+HORIZON → drift; START_NOT_RUNNABLE → outsideHours", () => {
  const mk = (id: number, reason: DriftedBlock["reason"]): DriftedBlock => ({
    id, orderNumber: `Z-${id}`, machine: "XL_105",
    startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z"),
    expectedEnd: reason === "END_MISMATCH" ? D("2026-08-01T11:00:00Z") : null, reason,
  });
  const { drift, outsideHours } = bucketDrift([mk(1, "END_MISMATCH"), mk(2, "START_NOT_RUNNABLE"), mk(3, "HORIZON_EXCEEDED")]);
  assert.deepEqual(drift.map((d) => d.id), [1, 3]);
  assert.deepEqual(outsideHours.map((d) => d.id), [2]);
  assert.equal(drift[0].storedEnd.getTime(), D("2026-08-01T10:00:00Z").getTime());
  assert.equal(drift[0].expectedEnd?.getTime(), D("2026-08-01T11:00:00Z").getTime());
});
