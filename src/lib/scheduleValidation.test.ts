import { test } from "node:test";
import assert from "node:assert/strict";
import { checkScheduleViolationWithTemplates } from "./scheduleValidation";
import { pragueToUTC } from "./dateUtils";
import type { MachineWeekShiftsRow } from "./machineWeekShifts";

type RowOverride = Partial<MachineWeekShiftsRow> & { dayOfWeek: number };

// 2026-05-11 je pondělí (letní čas Praha)
const WEEK_START = "2026-05-11";

function makeRow(machine: string, o: RowOverride): MachineWeekShiftsRow {
  return {
    machine,
    weekStart: o.weekStart ?? WEEK_START,
    dayOfWeek: o.dayOfWeek,
    isActive: o.isActive ?? true,
    morningOn: o.morningOn ?? false,
    afternoonOn: o.afternoonOn ?? false,
    nightOn: o.nightOn ?? false,
    morningStartMin: o.morningStartMin ?? null,
    morningEndMin: o.morningEndMin ?? null,
    afternoonStartMin: o.afternoonStartMin ?? null,
    afternoonEndMin: o.afternoonEndMin ?? null,
    nightStartMin: o.nightStartMin ?? null,
    nightEndMin: o.nightEndMin ?? null,
  };
}

test("checkScheduleViolationWithTemplates — blok v zapnuté ranní → null", () => {
  const shifts = [makeRow("XL_106", { dayOfWeek: 1, morningOn: true })];
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 10),
    pragueToUTC("2026-05-11", 12),
    shifts,
  );
  assert.equal(result, null);
});

test("checkScheduleViolationWithTemplates — blok v odpolední, odpolední vypnutá → violation", () => {
  const shifts = [makeRow("XL_106", { dayOfWeek: 1, morningOn: true })];
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 15),
    pragueToUTC("2026-05-11", 17),
    shifts,
  );
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

test("checkScheduleViolationWithTemplates — blok v ranní, ale ranní vypnutá → violation", () => {
  const shifts = [makeRow("XL_106", { dayOfWeek: 1, afternoonOn: true })];
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 10),
    pragueToUTC("2026-05-11", 12),
    shifts,
  );
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

test("checkScheduleViolationWithTemplates — blok v noční (22:00-23:30 po), noční zapnutá → null", () => {
  const shifts = [makeRow("XL_106", { dayOfWeek: 1, nightOn: true })];
  const end = new Date(pragueToUTC("2026-05-11", 23).getTime() + 30 * 60 * 1000);
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 22),
    end,
    shifts,
  );
  assert.equal(result, null);
});

test("checkScheduleViolationWithTemplates — blok přes půlnoc (22 po → 05 út), noční zapnutá oba dny → null", () => {
  const shifts = [
    makeRow("XL_106", { dayOfWeek: 1, nightOn: true }),
    makeRow("XL_106", { dayOfWeek: 2, nightOn: true }),
  ];
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 22),
    pragueToUTC("2026-05-12", 5),
    shifts,
  );
  assert.equal(result, null);
});

test("checkScheduleViolationWithTemplates — blok přes půlnoc, noční zapnutá jen v pondělí → violation v úterý", () => {
  const shifts = [
    makeRow("XL_106", { dayOfWeek: 1, nightOn: true }),
    makeRow("XL_106", { dayOfWeek: 2, isActive: false }),
  ];
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 22),
    pragueToUTC("2026-05-12", 5),
    shifts,
  );
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

test("checkScheduleViolationWithTemplates — row.isActive=false → violation i když shiftOn=true", () => {
  const shifts = [
    makeRow("XL_106", { dayOfWeek: 1, isActive: false, morningOn: true, afternoonOn: true, nightOn: true }),
  ];
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 10),
    pragueToUTC("2026-05-11", 12),
    shifts,
  );
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

test("checkScheduleViolationWithTemplates — flags jen ranní, blok v odpolední → violation", () => {
  const shifts = [makeRow("XL_106", { dayOfWeek: 1, morningOn: true })];
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 15),
    pragueToUTC("2026-05-11", 17),
    shifts,
  );
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

test("checkScheduleViolationWithTemplates — flags jen odpolední, blok v noční → violation", () => {
  const shifts = [makeRow("XL_106", { dayOfWeek: 1, afternoonOn: true })];
  const end = new Date(pragueToUTC("2026-05-11", 23).getTime() + 30 * 60 * 1000);
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 22),
    end,
    shifts,
  );
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

test("checkScheduleViolationWithTemplates — odpolední zapnutá, blok 14-22 → null", () => {
  const shifts = [makeRow("XL_106", { dayOfWeek: 1, afternoonOn: true })];
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 14),
    pragueToUTC("2026-05-11", 22),
    shifts,
  );
  assert.equal(result, null);
});

// --- Override scénáře (Sprint B2) ---
// Testovaná data: 2026-04-13 (pondělí), Prague letní čas = UTC+2

function rowFor(dayOfWeek: number, overrides: Partial<MachineWeekShiftsRow> = {}): MachineWeekShiftsRow {
  return {
    machine: "XL_105", weekStart: "2026-04-13", dayOfWeek,
    isActive: true, morningOn: true, afternoonOn: true, nightOn: false,
    morningStartMin: null, morningEndMin: null,
    afternoonStartMin: null, afternoonEndMin: null,
    nightStartMin: null, nightEndMin: null,
    ...overrides,
  };
}

test("checkSchedule — override morningEnd=13:00, blok 13:15–13:45 → VIOLATION (mezera)", () => {
  // Pondělí 2026-04-13, Europe/Prague
  const rows = [rowFor(1, { morningEndMin: 780 })]; // morning 6–13, afternoon 14–22, mezera 13–14
  const start = new Date("2026-04-13T11:15:00.000Z"); // 13:15 Prague (letní čas = UTC+2)
  const end = new Date("2026-04-13T11:45:00.000Z");   // 13:45 Prague
  const result = checkScheduleViolationWithTemplates("XL_105", start, end, rows);
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

test("checkSchedule — override afternoonStart=13:00, blok 13:15–13:45 → OK (sladěno)", () => {
  const rows = [rowFor(1, { morningEndMin: 780, afternoonStartMin: 780 })]; // sladěno na 13:00
  const start = new Date("2026-04-13T11:15:00.000Z");
  const end = new Date("2026-04-13T11:45:00.000Z");
  const result = checkScheduleViolationWithTemplates("XL_105", start, end, rows);
  assert.equal(result, null);
});

test("checkSchedule — override afternoonEnd=20:00, blok 20:30–21:00 → VIOLATION", () => {
  const rows = [rowFor(1, { afternoonEndMin: 1200 })]; // afternoon ends 20:00
  const start = new Date("2026-04-13T18:30:00.000Z"); // 20:30 Prague
  const end = new Date("2026-04-13T19:00:00.000Z");   // 21:00 Prague
  const result = checkScheduleViolationWithTemplates("XL_105", start, end, rows);
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

test("checkSchedule — override morningStart=7:00, blok 6:15–6:45 → VIOLATION", () => {
  const rows = [rowFor(1, { morningStartMin: 420 })]; // morning starts 7:00
  const start = new Date("2026-04-13T04:15:00.000Z"); // 6:15 Prague
  const end = new Date("2026-04-13T04:45:00.000Z");   // 6:45 Prague
  const result = checkScheduleViolationWithTemplates("XL_105", start, end, rows);
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});
