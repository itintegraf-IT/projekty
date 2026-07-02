import { test } from "node:test";
import assert from "node:assert/strict";
import { pragueToUTC, utcToPragueHour } from "./dateUtils";
import type { MachineWeekShiftsRow } from "./machineWeekShifts";
import { expandPrintTime, isMachineRunnableAt, computePrintMinutes, snapStartToNextRunnableSlot, type CompanyDayInterval } from "./printTime";

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Směny: MORNING 6–14 (360–840), AFTERNOON 14–22 (840–1320), NIGHT 22–6 (1320–360 wrap)
function mkDay(
  weekStart: string,
  dayOfWeek: number,
  opts: { m?: boolean; a?: boolean; n?: boolean; active?: boolean } = {}
): MachineWeekShiftsRow {
  return {
    machine: "XL_106",
    weekStart,
    dayOfWeek,
    isActive: opts.active ?? true,
    morningOn: opts.m ?? false,
    afternoonOn: opts.a ?? false,
    nightOn: opts.n ?? false,
    morningStartMin: 360, morningEndMin: 840,
    afternoonStartMin: 840, afternoonEndMin: 1320,
    nightStartMin: 1320, nightEndMin: 360,
  };
}

// Reálný režim XL_106: Po–Čt nonstop, Pá do 22:00, So off, Ne od 22:00 (noc)
// = víkendová odstávka Pá 22:00 – Ne 22:00
function xl106Week(weekStart: string): MachineWeekShiftsRow[] {
  return [
    mkDay(weekStart, 1, { m: true, a: true, n: true }),
    mkDay(weekStart, 2, { m: true, a: true, n: true }),
    mkDay(weekStart, 3, { m: true, a: true, n: true }),
    mkDay(weekStart, 4, { m: true, a: true, n: true }),
    mkDay(weekStart, 5, { m: true, a: true }),   // pátek bez noci
    mkDay(weekStart, 6, { active: false }),       // sobota off
    mkDay(weekStart, 0, { n: true }),             // neděle jen noc od 22:00
  ];
}

function offWeek(weekStart: string): MachineWeekShiftsRow[] {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => mkDay(weekStart, d, { active: false }));
}

const W1 = "2026-08-17"; // pondělí
const W2 = "2026-08-24";
const SHIFTS = [...xl106Week(W1), ...xl106Week(W2)];
const NO_CD: CompanyDayInterval[] = [];

// ── expandPrintTime ──────────────────────────────────────────────────────────

test("Gardena 27h přes víkend: 12h print + 48h pauza + 15h print", () => {
  const start = pragueToUTC("2026-08-21", 10); // pátek 10:00
  const r = expandPrintTime("XL_106", start, 27 * 60, SHIFTS, NO_CD);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.end.getTime(), pragueToUTC("2026-08-24", 13).getTime()); // pondělí 13:00
  assert.equal(r.segments.length, 3);
  assert.deepEqual(r.segments.map((s) => s.kind), ["print", "pause", "print"]);
  assert.equal(r.segments[0].end.getTime(), pragueToUTC("2026-08-21", 22).getTime());
  assert.equal(r.segments[1].end.getTime(), pragueToUTC("2026-08-23", 22).getTime());
  assert.equal(r.segments[2].start.getTime(), pragueToUTC("2026-08-23", 22).getTime());
});

test("blok, který se vejde před odstávku: 1 segment, žádná pauza", () => {
  const start = pragueToUTC("2026-08-21", 10); // pátek 10:00, 12h → končí přesně 22:00
  const r = expandPrintTime("XL_106", start, 12 * 60, SHIFTS, NO_CD);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.end.getTime(), pragueToUTC("2026-08-21", 22).getTime());
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].kind, "print");
});

test("bypass: žádné pauzy, end = start + printMinutes", () => {
  const start = pragueToUTC("2026-08-21", 10);
  const r = expandPrintTime("XL_106", start, 27 * 60, SHIFTS, NO_CD, true);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.end.getTime(), start.getTime() + 27 * 3600000);
  assert.equal(r.segments.length, 1);
});

test("start v odstávce → START_NOT_RUNNABLE", () => {
  const start = pragueToUTC("2026-08-22", 12); // sobota
  const r = expandPrintTime("XL_106", start, 4 * 60, SHIFTS, NO_CD);
  assert.deepEqual(r, { ok: false, reason: "START_NOT_RUNNABLE" });
});

test("CompanyDay uprostřed bloku vloží pauzu", () => {
  // odstávka celá středa 19. 8. (Praha)
  const cd: CompanyDayInterval[] = [
    { start: pragueToUTC("2026-08-19", 0), end: pragueToUTC("2026-08-20", 0) },
  ];
  const start = pragueToUTC("2026-08-18", 18); // úterý 18:00, 12h tisku
  const r = expandPrintTime("XL_106", start, 12 * 60, SHIFTS, cd);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // 6h út 18–24, pauza středa, 6h čt 00–06 (noční tail středy)
  assert.equal(r.end.getTime(), pragueToUTC("2026-08-20", 6).getTime());
  assert.deepEqual(r.segments.map((s) => s.kind), ["print", "pause", "print"]);
});

// ── isMachineRunnableAt ──────────────────────────────────────────────────────

test("isMachineRunnableAt: směna aktivní + bez CD → true; CD → false", () => {
  const t = pragueToUTC("2026-08-18", 10); // úterý 10:00
  assert.equal(isMachineRunnableAt("XL_106", t, SHIFTS, NO_CD), true);
  const cd = [{ start: pragueToUTC("2026-08-18", 0), end: pragueToUTC("2026-08-19", 0) }];
  assert.equal(isMachineRunnableAt("XL_106", t, SHIFTS, cd), false);
});

// ── computePrintMinutes ──────────────────────────────────────────────────────

test("computePrintMinutes je inverze expandPrintTime (Gardena 27h)", () => {
  const start = pragueToUTC("2026-08-21", 10);
  const r = expandPrintTime("XL_106", start, 27 * 60, SHIFTS, NO_CD);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(computePrintMinutes("XL_106", start, r.end, SHIFTS, NO_CD), 27 * 60);
});

test("computePrintMinutes: end uvnitř pauzy = hodnota na začátku pauzy", () => {
  const start = pragueToUTC("2026-08-21", 10); // pátek 10:00
  const inPause = pragueToUTC("2026-08-22", 12); // sobota 12:00 (odstávka)
  const atPauseStart = pragueToUTC("2026-08-21", 22);
  assert.equal(
    computePrintMinutes("XL_106", start, inPause, SHIFTS, NO_CD),
    computePrintMinutes("XL_106", start, atPauseStart, SHIFTS, NO_CD)
  );
  assert.equal(computePrintMinutes("XL_106", start, atPauseStart, SHIFTS, NO_CD), 12 * 60);
});

test("HORIZON_EXCEEDED: kapacita nestačí do 21 dní, žádná nekonečná smyčka", () => {
  const shifts = [
    ...xl106Week(W1),
    ...offWeek(W2), ...offWeek("2026-08-31"), ...offWeek("2026-09-07"), ...offWeek("2026-09-14"),
  ];
  const start = pragueToUTC("2026-08-21", 10); // pátek 10:00, k dispozici jen 20 h (Pá 12 h + Ne noc 2 h + Po tail 6 h) < 40 h
  const r = expandPrintTime("XL_106", start, 40 * 60, shifts, NO_CD);
  assert.deepEqual(r, { ok: false, reason: "HORIZON_EXCEEDED" });
});

test("hranice: end přesně na začátku odstávky nevkládá pauzu", () => {
  const start = pragueToUTC("2026-08-21", 21, 30); // pátek 21:30, poslední slot před 22:00
  const r = expandPrintTime("XL_106", start, 30, SHIFTS, NO_CD);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.end.getTime(), pragueToUTC("2026-08-21", 22).getTime());
  assert.equal(r.segments.length, 1);
});

test("DST fall-back: printMinutes = reálné minuty (24/7 stroj, noc s 25 hodinami)", () => {
  // 25. 10. 2026 = konec letního času (03:00 → 02:00)
  const wk = "2026-10-19";
  const shifts247 = [0, 1, 2, 3, 4, 5, 6].map((d) => mkDay(wk, d, { m: true, a: true, n: true }));
  const start = pragueToUTC("2026-10-24", 20); // sobota 20:00
  const r = expandPrintTime("XL_106", start, 12 * 60, shifts247, NO_CD);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.end.getTime() - start.getTime(), 12 * 3600000); // reálných 12 h
  assert.equal(utcToPragueHour(r.end), 7); // civilně 07:00 (kvůli hodině navíc)
});

test("start přesně na konci odstávky (Ne 22:00) je runnable", () => {
  const start = pragueToUTC("2026-08-23", 22); // neděle 22:00
  const r = expandPrintTime("XL_106", start, 4 * 60, SHIFTS, NO_CD);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.segments.length, 1);
  assert.equal(r.end.getTime(), pragueToUTC("2026-08-24", 2).getTime());
});

test("nezarovnaný start vyhodí chybu (žádný tichý tisk v odstávce)", () => {
  const start = pragueToUTC("2026-08-21", 21, 45); // pátek 21:45
  assert.throws(() => expandPrintTime("XL_106", start, 30, SHIFTS, NO_CD), /30min hranici/);
});

test("DST spring-forward: printMinutes = reálné minuty (24/7 stroj, noc s 23 hodinami)", () => {
  const wk = "2027-03-22"; // pondělí
  const shifts247 = [0, 1, 2, 3, 4, 5, 6].map((d) => mkDay(wk, d, { m: true, a: true, n: true }));
  const start = pragueToUTC("2027-03-27", 20); // sobota 20:00
  const r = expandPrintTime("XL_106", start, 12 * 60, shifts247, NO_CD);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.end.getTime() - start.getTime(), 12 * 3600000); // reálných 12 h
  assert.equal(utcToPragueHour(r.end), 9); // civilně 09:00 (hodina „zmizela")
});

// ── snapStartToNextRunnableSlot ──────────────────────────────────────────────

test("snap: runnable start se nemění", () => {
  const t = pragueToUTC("2026-08-18", 10); // úterý 10:00 — plný provoz
  assert.deepEqual(snapStartToNextRunnableSlot("XL_106", t, SHIFTS, NO_CD), t);
});

test("snap: sobota (odstávka) → neděle 22:00 (začátek noční)", () => {
  const t = pragueToUTC("2026-08-22", 12); // sobota 12:00
  assert.deepEqual(
    snapStartToNextRunnableSlot("XL_106", t, SHIFTS, NO_CD),
    pragueToUTC("2026-08-23", 22)
  );
});

test("snap: CompanyDay přeskočí i uvnitř aktivní směny", () => {
  const cd: CompanyDayInterval[] = [
    { start: pragueToUTC("2026-08-18", 0), end: pragueToUTC("2026-08-19", 0) }, // celé úterý
  ];
  const t = pragueToUTC("2026-08-18", 10);
  assert.deepEqual(
    snapStartToNextRunnableSlot("XL_106", t, SHIFTS, cd),
    pragueToUTC("2026-08-19", 0) // středa 00:00 — první runnable slot po odstávce
  );
});

test("snap: nezarovnaný čas se zarovná NAHORU na slot grid", () => {
  const t = new Date(pragueToUTC("2026-08-18", 10).getTime() + 7 * 60 * 1000); // 10:07
  assert.deepEqual(
    snapStartToNextRunnableSlot("XL_106", t, SHIFTS, NO_CD),
    pragueToUTC("2026-08-18", 10, 30)
  );
});

test("snap: žádný runnable slot do limitu → null", () => {
  const t = pragueToUTC("2026-08-22", 12); // sobota 12:00, provoz až Ne 22:00
  const limit = pragueToUTC("2026-08-23", 12).getTime(); // limit = neděle poledne
  assert.equal(snapStartToNextRunnableSlot("XL_106", t, SHIFTS, NO_CD, limit), null);
});
