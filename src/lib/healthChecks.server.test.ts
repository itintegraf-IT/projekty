import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOverlapPairs, computeIntegrityIssues, computeSplitDivergence, diffAttachmentFiles, bucketDrift, attempt, runHealthChecks, type BlockRow, type IntegrityRefs, type SplitSharedRow, type AttachmentFileRow, type DiskEntry } from "./healthChecks.server";
import { SPLIT_SHARED_FIELDS } from "./splitSharedFields";
import { FIELD_LABELS } from "./auditFormatters";
import type { DriftedBlock } from "./calendarDrift.server";

const D = (iso: string) => new Date(iso);
function blk(o: Partial<BlockRow> & Pick<BlockRow, "id" | "startTime" | "endTime">): BlockRow {
  return {
    orderNumber: `Z-${o.id}`, machine: "XL_105", type: "ZAKAZKA",
    printMinutes: 120, printCompletedAt: null, printCompletedByUserId: null,
    jobPresetId: null,
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
  return { jobPresetIds: o.jobPresetIds ?? new Set<number>() };
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
  const res = computeIntegrityIssues([orphan, ok], refs({ jobPresetIds: new Set([5]) }));
  const it = issue(res, "orphanJobPreset");
  assert.deepEqual(it.items.map((x) => x.id), [1]);
  assert.equal(it.count, 1);
});

test("integrity: neplatný stroj a typ", () => {
  const bad = blk({ id: 1, machine: "XX_999", type: "PRUSER", startTime: OK_START, endTime: OK_END });
  const res = computeIntegrityIssues([bad], refs());
  assert.equal(issue(res, "invalidMachine").count, 1);
  assert.equal(issue(res, "invalidType").count, 1);
});

test("integrity: konec <= začátek", () => {
  const bad = blk({ id: 1, startTime: D("2026-08-03T10:00:00Z"), endTime: D("2026-08-03T08:00:00Z") });
  const res = computeIntegrityIssues([bad], refs());
  assert.equal(issue(res, "negativeInterval").count, 1);
});

test("integrity: vadné printMinutes (odd/too big/<=0); NULL a completed se nehlásí", () => {
  const odd = blk({ id: 1, startTime: OK_START, endTime: OK_END, printMinutes: 45 });
  const big = blk({ id: 2, startTime: OK_START, endTime: OK_END, printMinutes: 3000 });
  const nul = blk({ id: 3, startTime: OK_START, endTime: OK_END, printMinutes: null });
  const done = blk({ id: 4, startTime: OK_START, endTime: OK_END, printMinutes: 45, printCompletedAt: D("2026-08-04T00:00:00Z") });
  const res = computeIntegrityIssues([odd, big, nul, done], refs());
  const it = issue(res, "badPrintMinutes");
  assert.equal(it.count, 2);
  assert.deepEqual(it.items.map((x) => x.id), [1, 2]);
});

test("integrity: nezarovnaný start jen ZAKAZKA nedokončená; REZERVACE ne", () => {
  const zak = blk({ id: 1, type: "ZAKAZKA", startTime: D("2026-08-03T08:15:00Z"), endTime: OK_END });
  const rez = blk({ id: 2, type: "REZERVACE", startTime: D("2026-08-03T08:15:00Z"), endTime: OK_END });
  const res = computeIntegrityIssues([zak, rez], refs());
  const it = issue(res, "unalignedStart");
  assert.equal(it.count, 1);
  assert.deepEqual(it.items.map((x) => x.id), [1]);
});

test("integrity: nekonzistentní printCompleted (XOR) se hlásí, konzistentní ne", () => {
  const onlyAt = blk({ id: 1, startTime: OK_START, endTime: OK_END, printCompletedAt: D("2026-08-04T00:00:00Z") });
  const onlyUser = blk({ id: 2, startTime: OK_START, endTime: OK_END, printCompletedByUserId: 7 });
  const bothSet = blk({ id: 3, startTime: OK_START, endTime: OK_END, printCompletedAt: D("2026-08-04T00:00:00Z"), printCompletedByUserId: 7 });
  const bothNull = blk({ id: 4, startTime: OK_START, endTime: OK_END });
  const res = computeIntegrityIssues([onlyAt, onlyUser, bothSet, bothNull], refs());
  const it = issue(res, "inconsistentPrintCompleted");
  assert.equal(it.count, 2);
  assert.deepEqual(it.items.map((x) => x.id), [1, 2]);
});

test("integrity: zrušené kontroly už v rozpadu nejsou", () => {
  const b = blk({ id: 1, startTime: OK_START, endTime: OK_END });
  const keys = computeIntegrityIssues([b], refs()).map((i) => i.key);
  for (const gone of ["orphanSplitGroup", "orphanReservation", "orphanRecurrenceParent", "undersizedSplitGroup"]) {
    assert.equal(keys.includes(gone), false, `kontrola ${gone} měla být zrušena`);
  }
  assert.equal(keys.length, 7);
});

test("integrity: item nese číslo zakázky, stroj jako popisek a konkrétní vadnou hodnotu", () => {
  const odd = blk({ id: 1, orderNumber: "18447", machine: "XL_105", startTime: OK_START, endTime: OK_END, printMinutes: 45 });
  const it = issue(computeIntegrityIssues([odd], refs()), "badPrintMinutes");
  assert.equal(it.count, 1);
  assert.equal(it.items[0].id, 1);
  assert.equal(it.items[0].orderNumber, "18447");
  assert.equal(it.items[0].machine, "XL 105");
  assert.equal(it.items[0].detail, "45 min");
});

test("integrity: detail nezarovnaného startu ukazuje pražský čas", () => {
  const zak = blk({ id: 1, startTime: D("2026-08-03T06:17:00Z"), endTime: OK_END });
  const it = issue(computeIntegrityIssues([zak], refs()), "unalignedStart");
  assert.equal(it.items[0].detail, "start 08:17");
});

test("integrity: detail nelogického intervalu ukazuje obě strany", () => {
  const bad = blk({ id: 1, startTime: D("2026-08-03T08:00:00Z"), endTime: D("2026-08-03T06:00:00Z") });
  const it = issue(computeIntegrityIssues([bad], refs()), "negativeInterval");
  assert.equal(it.items[0].detail, "konec 08:00 ≤ začátek 10:00");
});

test("integrity: detail osiřelého presetu jmenuje chybějící id", () => {
  const orphan = blk({ id: 1, startTime: OK_START, endTime: OK_END, jobPresetId: 99 });
  const it = issue(computeIntegrityIssues([orphan], refs()), "orphanJobPreset");
  assert.equal(it.items[0].detail, "preset #99 neexistuje");
});

test("integrity: detail nekonzistentního dokončení rozlišuje obě strany XOR", () => {
  const onlyAt = blk({ id: 1, startTime: OK_START, endTime: OK_END, printCompletedAt: D("2026-08-04T00:00:00Z") });
  const onlyUser = blk({ id: 2, startTime: OK_START, endTime: OK_END, printCompletedByUserId: 7 });
  const it = issue(computeIntegrityIssues([onlyAt, onlyUser], refs()), "inconsistentPrintCompleted");
  assert.equal(it.items[0].detail, "čas dokončení bez uživatele");
  assert.equal(it.items[1].detail, "uživatel bez času dokončení");
});

test("integrity: items respektují strop, count nese skutečný počet", () => {
  const many = Array.from({ length: 60 }, (_, i) =>
    blk({ id: i + 1, startTime: OK_START, endTime: OK_END, printMinutes: 45 }));
  const it = issue(computeIntegrityIssues(many, refs()), "badPrintMinutes");
  assert.equal(it.count, 60);
  assert.equal(it.items.length, 50);
});

// ── Rozešlá split-skupina ───────────────────────────────────────────────────
function srow(o: Partial<SplitSharedRow> & Pick<SplitSharedRow, "id" | "splitGroupId">): SplitSharedRow {
  // Všechna sdílená pole nejdřív na null, pak přebijeme těmi, na kterých testu záleží.
  // Pořadí je podstatné: `orderNumber` a `type` jsou SOUČÁSTÍ SPLIT_SHARED_FIELDS,
  // takže musí přijít až za rozbalením základu, jinak by zůstaly null.
  const base: Record<string, unknown> = {};
  for (const f of SPLIT_SHARED_FIELDS) base[f] = null;
  return {
    ...base,
    machine: "XL_105",
    orderNumber: "18447",
    type: "ZAKAZKA",
    startTime: OK_START,
    ...o,
  } as SplitSharedRow;
}

test("divergence: shodná skupina → žádný nález", () => {
  const rows = [srow({ id: 1, splitGroupId: 7 }), srow({ id: 2, splitGroupId: 7 })];
  assert.equal(computeSplitDivergence(rows).count, 0);
});

test("divergence: jednočlenná skupina se přeskakuje", () => {
  const rows = [srow({ id: 1, splitGroupId: 7, materialInStock: true })];
  assert.equal(computeSplitDivergence(rows).count, 0);
});

test("divergence: null proti hodnotě je rozdíl (sentinel funguje)", () => {
  const rows = [
    srow({ id: 1, splitGroupId: 7, jobPresetLabel: "XL 106 LED" }),
    srow({ id: 2, splitGroupId: 7, jobPresetLabel: null }),
  ];
  const res = computeSplitDivergence(rows);
  assert.equal(res.count, 1);
  assert.match(res.items[0].detail, /Preset/);
  assert.match(res.items[0].detail, /1 = XL 106 LED/);
  assert.match(res.items[0].detail, /2 = —/);
});

test("divergence: dvě Date instance se stejným časem NEJSOU rozdíl", () => {
  const rows = [
    srow({ id: 1, splitGroupId: 7, deadlineExpedice: new Date("2026-09-01T00:00:00Z") }),
    srow({ id: 2, splitGroupId: 7, deadlineExpedice: new Date("2026-09-01T00:00:00Z") }),
  ];
  assert.equal(computeSplitDivergence(rows).count, 0);
});

test("divergence: item nese skupinu, oba stroje a odkaz na první blok", () => {
  const rows = [
    srow({ id: 11, splitGroupId: 7, machine: "XL_105", materialInStock: true }),
    srow({ id: 12, splitGroupId: 7, machine: "XL_106", materialInStock: false }),
  ];
  const res = computeSplitDivergence(rows);
  assert.equal(res.count, 1);
  assert.equal(res.items[0].id, 11);
  assert.equal(res.items[0].orderNumber, "18447");
  assert.equal(res.items[0].machine, "XL 105 + XL 106");
});

test("divergence: víc rozešlých polí se v detailu spojí", () => {
  const rows = [
    srow({ id: 1, splitGroupId: 7, materialInStock: true, pantoneOk: true }),
    srow({ id: 2, splitGroupId: 7, materialInStock: false, pantoneOk: false }),
  ];
  const detail = computeSplitDivergence(rows).items[0].detail;
  assert.match(detail, /Materiál skladem/);
  assert.match(detail, /Pantone OK/);
  assert.equal(detail.includes(" · "), true);
});

test("divergence: strážný test — hlídá se KAŽDÉ pole ze SPLIT_SHARED_FIELDS", () => {
  for (const field of SPLIT_SHARED_FIELDS) {
    const a = srow({ id: 1, splitGroupId: 7 });
    const b = srow({ id: 2, splitGroupId: 7 });
    (a as Record<string, unknown>)[field] = "A";
    (b as Record<string, unknown>)[field] = "B";
    assert.equal(computeSplitDivergence([a, b]).count, 1, `pole ${field} se nehlídá`);
  }
});

test("divergence: strážný test — každé sdílené pole má český popisek", () => {
  for (const field of SPLIT_SHARED_FIELDS) {
    assert.ok(field in FIELD_LABELS, `pole ${field} nemá popisek ve FIELD_LABELS`);
  }
});

test("divergence: prázdný řetězec proti NULL je v detailu ROZLIŠITELNÝ", () => {
  // fmtAuditVal vrací „—" pro obojí; bez vlastního wrapperu by nález byl pravdivý,
  // ale detail by tvrdil „1 = —, 2 = —", tedy žádný viditelný rozdíl.
  const rows = [
    srow({ id: 1, splitGroupId: 7, description: "" }),
    srow({ id: 2, splitGroupId: 7, description: null }),
  ];
  const res = computeSplitDivergence(rows);
  assert.equal(res.count, 1);
  const detail = res.items[0].detail;
  assert.match(detail, /1 = \(prázdné\)/);
  assert.match(detail, /2 = —/);
});

test("divergence: bílé znaky proti NULL jsou taky rozlišitelné", () => {
  const rows = [
    srow({ id: 1, splitGroupId: 7, specifikace: "   " }),
    srow({ id: 2, splitGroupId: 7, specifikace: null }),
  ];
  const detail = computeSplitDivergence(rows).items[0].detail;
  assert.match(detail, /1 = \(prázdné\)/);
  assert.match(detail, /2 = —/);
});

test("divergence: dlouhá hodnota se v detailu ořízne na 80 znaků", () => {
  const rows = [
    srow({ id: 1, splitGroupId: 7, description: "A".repeat(1200) }),
    srow({ id: 2, splitGroupId: 7, description: "B".repeat(1200) }),
  ];
  const detail = computeSplitDivergence(rows).items[0].detail;
  assert.equal(detail.includes("A".repeat(80) + "…"), true);
  assert.equal(detail.includes("A".repeat(81)), false);
  assert.ok(detail.length < 300, `detail je ${detail.length} znaků, měl by být oříznutý`);
});

test("divergence: Invalid Date kontrolu nepoloží (RangeError)", () => {
  const bad = new Date("nesmysl");
  const rows = [
    srow({ id: 1, splitGroupId: 7, deadlineExpedice: bad }),
    srow({ id: 2, splitGroupId: 7, deadlineExpedice: new Date("2026-09-01T00:00:00Z") }),
  ];
  const res = computeSplitDivergence(rows);
  assert.equal(res.count, 1);
  assert.match(res.items[0].detail, /neplatné datum/);
});

test("divergence: řazení má sekundární klíč id (shodný start nepřehazuje pořadí)", () => {
  // MySQL bez `orderBy` pořadí řádků negarantuje → bez `|| a.id - b.id` by se
  // items[0].id i pořadí v detailu mezi běhy panelu přehazovalo.
  const mk = (ids: number[]) => ids.map((id) =>
    srow({ id, splitGroupId: 7, machine: id % 2 ? "XL_105" : "XL_106", jobPresetLabel: `P${id}` }));
  const a = computeSplitDivergence(mk([12, 11]));
  const b = computeSplitDivergence(mk([11, 12]));
  assert.equal(a.items[0].id, 11);
  assert.equal(b.items[0].id, 11);
  assert.equal(a.items[0].detail, b.items[0].detail);
});

test("divergence: items respektují strop MAX_ITEMS, count nese skutečný počet", () => {
  const rows: SplitSharedRow[] = [];
  for (let g = 1; g <= 60; g++) {
    rows.push(srow({ id: g * 2, splitGroupId: g, jobPresetLabel: "A" }));
    rows.push(srow({ id: g * 2 + 1, splitGroupId: g, jobPresetLabel: "B" }));
  }
  const res = computeSplitDivergence(rows);
  assert.equal(res.count, 60);
  assert.equal(res.items.length, 50);
});

test("divergence: klíč nálezu je splitFieldsDiverged", () => {
  assert.equal(computeSplitDivergence([]).key, "splitFieldsDiverged");
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
    id, orderNumber: `Z-${id}`, description: null, machine: "XL_105",
    startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z"),
    expectedEnd: reason === "END_MISMATCH" ? D("2026-08-01T11:00:00Z") : null, reason,
  });
  const { drift, outsideHours } = bucketDrift([mk(1, "END_MISMATCH"), mk(2, "START_NOT_RUNNABLE"), mk(3, "HORIZON_EXCEEDED")]);
  assert.deepEqual(drift.map((d) => d.id), [1, 3]);
  assert.deepEqual(outsideHours.map((d) => d.id), [2]);
  assert.equal(drift[0].storedEnd.getTime(), D("2026-08-01T10:00:00Z").getTime());
  assert.equal(drift[0].expectedEnd?.getTime(), D("2026-08-01T11:00:00Z").getTime());
});

// ── Izolace selhání jedné kontroly ───────────────────────────────────────────

test("attempt: selhání jedné kontroly nezhatí ostatní", async () => {
  const ok = await attempt("dobrá", async () => 42);
  assert.equal(ok.value, 42);
  assert.equal(ok.error, undefined);

  const bad = await attempt("špatná", async () => { throw new Error("Unknown column 'pantoneInStock'"); });
  assert.equal(bad.value, null);
  assert.equal(bad.error, "Unknown column 'pantoneInStock'");
});

test("attempt: výjimka bez Error dostane náhradní text", async () => {
  const bad = await attempt("divná", async () => { throw "boom"; });
  assert.equal(bad.value, null);
  assert.equal(bad.error, "neznámá chyba");
});

test("attempt: mnohořádková Prisma hláška se zkrátí na první řádek", async () => {
  // PrismaClientValidationError.message má naměřeno 2 624 znaků / 75 řádků včetně
  // absolutních cest na serveru — do UI se z toho smí dostat jen první řádek.
  const bad = await attempt("prisma", async () => {
    throw new Error("\nInvalid `prisma.block.findMany()` invocation:\n\n\n{\n  select: {\n    vymyslenePole: true\n  }\n}\n/Users/x/y/z.ts:12:34");
  });
  assert.equal(bad.error, "Invalid `prisma.block.findMany()` invocation:");
});

test("attempt: dlouhý první řádek se ořízne na 200 znaků", async () => {
  const bad = await attempt("dlouhá", async () => { throw new Error("X".repeat(500)); });
  assert.equal(bad.error, "X".repeat(200) + "…");
});

// ── Kompozice runHealthChecks (fake Prisma klient) ───────────────────────────
// Vzorem `scheduleSlotFinder.server.test.ts`: funkce si klienta bere parametrem,
// takže se podstrkuje přímo, bez mockování modulu.

type FakeOpts = {
  blocks?: unknown[];
  blocksThrow?: boolean;
  presetsThrow?: boolean;
  splitRows?: SplitSharedRow[];
  splitThrow?: boolean;
};

function fakeDb(o: FakeOpts = {}) {
  return {
    block: {
      findMany: async (args: { where?: Record<string, unknown> }) => {
        // Dotaz driftu (`scheduleBypassed` ve where) → prázdno, drift doběhne bez kalendáře.
        if (args.where && "scheduleBypassed" in args.where) return [];
        if (args.where && "splitGroupId" in args.where) {
          if (o.splitThrow) throw new Error("Unknown column 'Block.pantoneIssued'");
          return o.splitRows ?? [];
        }
        if (o.blocksThrow) throw new Error("Unknown column 'Block.orderNumber'");
        return o.blocks ?? [];
      },
    },
    jobPreset: {
      findMany: async () => { if (o.presetsThrow) throw new Error("JobPreset nedostupný"); return []; },
    },
    reservationAttachment: { findMany: async () => [] },
    machineWeekShifts: { findMany: async () => [] },
    companyDay: { findMany: async () => [] },
  } as unknown as Parameters<typeof runHealthChecks>[0];
}

const okBlock = () => ({ ...blk({ id: 1, startTime: OK_START, endTime: OK_END, printMinutes: 45 }) });
const divergedRows = () => [
  srow({ id: 11, splitGroupId: 7, jobPresetLabel: "A" }),
  srow({ id: 12, splitGroupId: 7, jobPresetLabel: "B" }),
];
const breakdownRow = (r: Awaited<ReturnType<typeof runHealthChecks>>, key: string) => {
  const row = r.checks.integrity.breakdown.find((i) => i.key === key);
  assert.ok(row, `v rozpadu chybí ${key}`);
  return row!;
};

test("runHealthChecks: base OK + diverged OK → součet obou, žádná chyba", async () => {
  const r = await runHealthChecks(fakeDb({ blocks: [okBlock()], splitRows: divergedRows() }), NOW);
  assert.equal(r.checks.integrity.error, undefined);
  assert.equal(breakdownRow(r, "splitFieldsDiverged").count, 1);
  assert.equal(r.checks.integrity.count, 2); // badPrintMinutes 1 + rozešlá skupina 1
  assert.equal(r.checks.overlaps.count, 0);
  assert.equal(r.checks.drift.count, 0);
});

test("runHealthChecks: base OK + diverged FAIL → základ se spočte, řádek nese chybu", async () => {
  const r = await runHealthChecks(fakeDb({ blocks: [okBlock()], splitThrow: true }), NOW);
  assert.equal(r.checks.integrity.count, 1); // jen základní kontroly
  assert.equal(r.checks.integrity.error, "Dílčí kontrola nespočtena.");
  const row = breakdownRow(r, "splitFieldsDiverged");
  assert.equal(row.count, null);
  assert.equal(row.error, "Unknown column 'Block.pantoneIssued'");
});

test("runHealthChecks: base FAIL + diverged OK → integrita null, řádek skupiny přesto nese číslo", async () => {
  // Poškozený řádek (endTime není Date) shodí computeIntegrityIssues, ne načtení dat.
  const broken = { ...okBlock(), endTime: "nesmysl" as unknown as Date };
  const r = await runHealthChecks(fakeDb({ blocks: [broken], splitRows: divergedRows() }), NOW);
  assert.equal(r.checks.integrity.count, null);
  assert.ok(r.checks.integrity.error);
  assert.equal(breakdownRow(r, "splitFieldsDiverged").count, 1);
});

test("runHealthChecks: base FAIL + diverged FAIL → integrita null a obě chyby jsou vidět", async () => {
  const broken = { ...okBlock(), endTime: "nesmysl" as unknown as Date };
  const r = await runHealthChecks(fakeDb({ blocks: [broken], splitThrow: true }), NOW);
  assert.equal(r.checks.integrity.count, null);
  assert.ok(r.checks.integrity.error);
  assert.equal(breakdownRow(r, "splitFieldsDiverged").error, "Unknown column 'Block.pantoneIssued'");
});

test("runHealthChecks: selhání NAČTENÍ dat neshodí panel — drift doběhne", async () => {
  // Regrese V1: `Promise.all` stálo mimo `attempt`, takže jediný vadný sloupec
  // propadl do routy jako 500 a zmizelo všech 5 kontrol včetně těch nezávislých.
  const r = await runHealthChecks(fakeDb({ blocksThrow: true, splitRows: divergedRows() }), NOW);
  assert.equal(r.checks.drift.count, 0);
  assert.equal(r.checks.drift.error, undefined);
  assert.equal(r.checks.outsideHours.count, 0);
  assert.equal(r.checks.overlaps.count, null);
  assert.equal(r.checks.overlaps.error, "Unknown column 'Block.orderNumber'");
  assert.equal(r.checks.integrity.count, null);
  assert.equal(r.checks.integrity.error, "Unknown column 'Block.orderNumber'");
  assert.equal(r.checks.attachments.count, null);
  assert.equal(r.checks.attachments.error, "Unknown column 'Block.orderNumber'");
  // Kontrola s vlastním dotazem se spočte i tak.
  assert.equal(breakdownRow(r, "splitFieldsDiverged").count, 1);
});

test("runHealthChecks: selhání dílčího dotazu (presety) taky nepoloží celý panel", async () => {
  const r = await runHealthChecks(fakeDb({ presetsThrow: true }), NOW);
  assert.equal(r.checks.drift.count, 0);
  assert.equal(r.checks.integrity.count, null);
  assert.equal(r.checks.integrity.error, "JobPreset nedostupný");
});

test("runHealthChecks: klíč splitFieldsDiverged je v rozpadu integrity vždy", async () => {
  const r = await runHealthChecks(fakeDb(), NOW);
  assert.equal(breakdownRow(r, "splitFieldsDiverged").key, computeSplitDivergence([]).key);
});

