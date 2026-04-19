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
