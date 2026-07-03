import { test } from "node:test";
import assert from "node:assert";
import { detectConflictsPure, computeConflictWindow, conflictWindowWhere, neighborWeekStarts, type WeekRowInput } from "./findConflictingBlocks";
import { pragueToUTC, civilDateToUTCMidnight } from "./dateUtils";
import { mkDay, xl106Week, W1, W2 } from "./weekShiftsTestFixtures";
import type { MachineWeekShiftsRow } from "./machineWeekShifts";

function allOffRow(dow: number): WeekRowInput {
  return {
    dayOfWeek: dow, morningOn: false, afternoonOn: false, nightOn: false, isActive: false,
    morningStartMin: null, morningEndMin: null,
    afternoonStartMin: null, afternoonEndMin: null,
    nightStartMin: null, nightEndMin: null,
  };
}
function morningRow(dow: number, endMin?: number): WeekRowInput {
  return { ...allOffRow(dow), morningOn: true, isActive: true, morningEndMin: endMin ?? null };
}
function weekWithRow(row: WeekRowInput): WeekRowInput[] {
  const out: WeekRowInput[] = [];
  for (let d = 0; d < 7; d++) out.push(d === row.dayOfWeek ? row : allOffRow(d));
  return out;
}

test("detectConflictsPure — blok uvnitř MORNING → není konflikt", () => {
  const rows = weekWithRow(morningRow(1)); // pondělí MORNING 6-14
  const blocks = [{
    id: 1, orderNumber: "X", description: null,
    startTime: new Date("2026-04-20T08:00:00+02:00"), // Po 08:00 Prague
    endTime:   new Date("2026-04-20T10:00:00+02:00"), // Po 10:00 Prague
  }];
  const result = detectConflictsPure("XL_106", "2026-04-20", rows, blocks);
  assert.equal(result.length, 0);
});

test("detectConflictsPure — blok přes override end → konflikt", () => {
  // MORNING Po zkrácené na 13:00 (override end 780)
  const rows = weekWithRow(morningRow(1, 780));
  const blocks = [{
    id: 42, orderNumber: "Y", description: "foo",
    startTime: new Date("2026-04-20T12:00:00+02:00"), // Po 12:00
    endTime:   new Date("2026-04-20T14:00:00+02:00"), // Po 14:00 — překročí 13:00 end
  }];
  const result = detectConflictsPure("XL_106", "2026-04-20", rows, blocks);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 42);
});

test("detectConflictsPure — cross-midnight blok Ne NIGHT ✓ → Po 05:00 → není konflikt (forward)", () => {
  const rows: WeekRowInput[] = [];
  for (let d = 0; d < 7; d++) {
    if (d === 0) rows.push({ ...allOffRow(0), nightOn: true, isActive: true });
    else rows.push(allOffRow(d));
  }
  const blocks = [{
    id: 7, orderNumber: "N", description: null,
    startTime: new Date("2026-04-19T22:00:00+02:00"), // Ne 22:00
    endTime:   new Date("2026-04-20T05:00:00+02:00"), // Po 05:00
  }];
  const result = detectConflictsPure("XL_106", "2026-04-13", rows, blocks);
  assert.equal(result.length, 0, "forward semantic: Ne NIGHT pokrývá Po 0-6 jako tail");
});

// ─────────────────────────────────────────────────────────────────────────
// Bug fix: přesahující bloky + week-boundary okno (etapa 6, task 2).
// Fixní směny (xl106Week/mkDay): MORNING 6-14, AFTERNOON 14-22, NIGHT 22-6 (Praha).
// W0 = 2026-08-10 (Po týdne PŘED W1), W1 = 2026-08-17, W2 = 2026-08-24 (Po týdne PO W1).
// ─────────────────────────────────────────────────────────────────────────

const MACHINE = "XL_106";
const W0 = "2026-08-10";
const FRI_W0 = "2026-08-14"; // Pá téhož týdne jako W0
const SUN_W0 = "2026-08-16"; // Ne téhož týdne jako W0 (poslední den týdne W0)

/** MachineWeekShiftsRow[] (7 dní) → WeekRowInput[] (bez machine/weekStart/id) pro `newRows`. */
function toWeekRowInput(rows: MachineWeekShiftsRow[]): WeekRowInput[] {
  return rows.map((r) => ({
    dayOfWeek: r.dayOfWeek,
    morningOn: r.morningOn,
    afternoonOn: r.afternoonOn,
    nightOn: r.nightOn,
    morningStartMin: r.morningStartMin,
    morningEndMin: r.morningEndMin,
    afternoonStartMin: r.afternoonStartMin,
    afternoonEndMin: r.afternoonEndMin,
    nightStartMin: r.nightStartMin,
    nightEndMin: r.nightEndMin,
    isActive: r.isActive,
  }));
}

function fcBlock(id: number, startCivil: [string, number, number?], endCivil: [string, number, number?]) {
  return {
    id,
    orderNumber: `ORD-${id}`,
    description: null,
    startTime: pragueToUTC(startCivil[0], startCivil[1], startCivil[2] ?? 0),
    endTime: pragueToUTC(endCivil[0], endCivil[1], endCivil[2] ?? 0),
  };
}

test("fc-1) blok celý v editovaném týdnu, rozvrh ho vypne → konflikt (regrese-pin stávajícího chování)", () => {
  const b = fcBlock(101, [W1, 10, 0], [W1, 12, 0]);
  const newRows = toWeekRowInput(
    xl106Week(W1).map((r) => (r.dayOfWeek === 1 ? mkDay(W1, 1, { active: false }, MACHINE) : r))
  );

  const conflicts = detectConflictsPure(MACHINE, W1, newRows, [b]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].id, 101);
});

// fc-2 testuje okno samo (`computeConflictWindow`), ne `detectConflictsPure` — ta bloky
// nefiltruje, dostává je hotové jako parametr. Okno je odpovědnost `findConflictingBlocks`
// (Prisma `where`), proto se testuje na exportované čisté aritmetice sdílené oběma místy
// (findConflictingBlocks.ts i route.ts TOCTOU re-check).
test("fc-2) computeConflictWindow: blok Pá 20:00 W0 -> Po 02:30 W1 spadá do nového okna, ale MIMO staré `[gte weekStart, lt weekEnd)` okno", () => {
  const startOld = civilDateToUTCMidnight(W1); // staré weekStartDate
  const endOld = new Date(startOld);
  endOld.setUTCDate(endOld.getUTCDate() + 7); // staré weekEnd (= nové computeConflictWindow.to - 6h)

  const blockStart = pragueToUTC(FRI_W0, 20, 0); // Pá 20:00 W0
  const blockEnd = pragueToUTC(W1, 2, 30); // Po 02:30 W1

  // Starý filtr byl `startTime: { gte: weekStartDate, lt: weekEnd }` — start bloku leží
  // v týdnu PŘED W1, takže na starém kódu by ho DB dotaz vůbec nevrátil (blok by unikl).
  const matchedOldFilter = blockStart.getTime() >= startOld.getTime() && blockStart.getTime() < endOld.getTime();
  assert.equal(matchedOldFilter, false, "start bloku musí být mimo staré okno — to je přesně bug ze spec 3.9");

  // Nové okno (span-overlap s [weekStart, weekStart+7d+6h)) blok zahrne.
  const { from, to } = computeConflictWindow(W1);
  assert.equal(from.getTime(), startOld.getTime());
  const matchedNewWindow = blockStart.getTime() < to.getTime() && blockEnd.getTime() > from.getTime();
  assert.equal(matchedNewWindow, true, "nové span-overlap okno musí blok zahrnout — to je oprava bugu");
});

test("fc-2b) neighborWeekStarts(W1) vrací týdny W1−7d a W1+7d (pondělky)", () => {
  const [prevWeek, nextWeek] = neighborWeekStarts(W1);
  assert.equal(prevWeek, "2026-08-10");
  assert.equal(nextWeek, W2);
});

// Pin test: reálná Prisma `where` klauzule je duplikovaná ve DVOU místech
// (findConflictingBlocks.ts + TOCTOU re-check v machine-week-shifts/route.ts) a žádný
// jiný test nepinuje, že strany srovnání (`from`/`to`) jsou napojené na správná pole
// (startTime.lt vs. endTime.gt). Prohození stran (`startTime: { gt: from }` apod.) by
// touto suitou jinak prošlo.
//
// `computeConflictWindow` pracuje s `civilDateToUTCMidnight` — čistou UTC půlnocí
// kalendářního data, NE pražskou půlnocí převedenou do UTC (`pragueToUTC(d, 0, 0)` dává
// jinou hodnotu, viz CEST posun). Očekávané hodnoty proto počítáme nezávisle přes
// `civilDateToUTCMidnight` + stejnou UTC aritmetiku (+7d, +6h) jako produkční kód — ne
// přes `computeConflictWindow` samo (to by test učinilo tautologickým vůči přesně té
// chybě, kterou má odhalit — prohozené strany).
test("fc-2c) conflictWindowWhere(W1): startTime.lt = W1+7d+6h (UTC), endTime.gt = UTC půlnoc W1", () => {
  const where = conflictWindowWhere(W1);

  const expectedFrom = civilDateToUTCMidnight(W1); // 2026-08-17T00:00:00.000Z
  const expectedTo = new Date(expectedFrom);
  expectedTo.setUTCDate(expectedTo.getUTCDate() + 7);
  expectedTo.setUTCHours(expectedTo.getUTCHours() + 6); // 2026-08-24T06:00:00.000Z

  assert.equal(where.startTime.lt.toISOString(), "2026-08-24T06:00:00.000Z");
  assert.equal(where.endTime.gt.toISOString(), "2026-08-17T00:00:00.000Z");
  assert.equal(where.startTime.lt.getTime(), expectedTo.getTime());
  assert.equal(where.endTime.gt.getTime(), expectedFrom.getTime());

  // Křížová kontrola proti computeConflictWindow — where fragment musí odpovídat {from, to}
  // na SPRÁVNÝCH stranách (lt↔to, gt↔from), ne prohozeně.
  const { from, to } = computeConflictWindow(W1);
  assert.equal(where.startTime.lt.getTime(), to.getTime());
  assert.equal(where.endTime.gt.getTime(), from.getTime());
});

test("fc-3) blok Po 00:30-05:30 týdne NÁSLEDUJÍCÍHO (W2); editovaný týden (W1) neděle nightOn=false; W2 pondělí bez rána → konflikt", () => {
  const b = fcBlock(103, [W2, 0, 30], [W2, 5, 30]);
  // Editovaný týden W1: standardní rozvrh, ALE neděle (poslední den W1) má nightOn vypnuté —
  // to je řádek, který v `checkScheduleViolationWithTemplates` řídí prev-tail pro Po 00:00-06:00 týdne W2.
  const newRows = toWeekRowInput(
    xl106Week(W1).map((r) => (r.dayOfWeek === 0 ? mkDay(W1, 0, { n: false }, MACHINE) : r))
  );
  // neighborRows: následující týden W2, pondělí BEZ ranní směny — žádné krytí zvenčí týdne W1.
  const neighborRows = xl106Week(W2).map((r) =>
    r.dayOfWeek === 1 ? mkDay(W2, 1, { a: true, n: true }, MACHINE) : r
  );

  const conflicts = detectConflictsPure(MACHINE, W1, newRows, [b], neighborRows);
  assert.equal(conflicts.length, 1, "nedělní noc W1 zmizela a pondělí W2 nemá ráno → sloty 00:30-05:30 nejsou kryté");
  assert.equal(conflicts[0].id, 103);
});

test("fc-4) tentýž blok, editovaný týden (W1) neděle nightOn=true → BEZ konfliktu (prev-tail drží)", () => {
  const b = fcBlock(104, [W2, 0, 30], [W2, 5, 30]);
  const newRows = toWeekRowInput(xl106Week(W1)); // standardní rozvrh — neděle W1 má nightOn=true
  const neighborRows = xl106Week(W2).map((r) =>
    r.dayOfWeek === 1 ? mkDay(W2, 1, { a: true, n: true }, MACHINE) : r
  );

  const conflicts = detectConflictsPure(MACHINE, W1, newRows, [b], neighborRows);
  assert.equal(conflicts.length, 0, "nedělní noc editovaného týdne W1 (prev-tail) pokrývá Po 00:00-06:00 týdne W2");
});

test("fc-5) blok přesahující z minulého týdne, jehož sloty tam jsou dle neighborRows aktivní → BEZ konfliktu", () => {
  // Ne W0 22:00 (start noční směny) -> Po W1 02:30 — celé pokryto noční směnou neděle W0 (22:00-06:00).
  const b = fcBlock(105, [SUN_W0, 22, 0], [W1, 2, 30]);
  const newRows = toWeekRowInput(xl106Week(W1)); // editovaný týden standardní
  const neighborRows = xl106Week(W0); // týden W0 — neděle (poslední den) má nightOn=true

  const conflicts = detectConflictsPure(MACHINE, W1, newRows, [b], neighborRows);
  assert.equal(
    conflicts.length,
    0,
    "sloty bloku ležící v minulém týdnu musí být posouzeny podle skutečného rozvrhu (neighborRows), ne fallbacku"
  );
});

test("fc-6) detectConflictsPure bez 5. parametru (zpětná kompatibilita) — chová se jako neighborRows = []", () => {
  const b = fcBlock(106, [W1, 10, 0], [W1, 12, 0]);
  const newRows = toWeekRowInput(
    xl106Week(W1).map((r) => (r.dayOfWeek === 1 ? mkDay(W1, 1, { active: false }, MACHINE) : r))
  );

  const conflicts = detectConflictsPure(MACHINE, W1, newRows, [b]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].id, 106);
});
