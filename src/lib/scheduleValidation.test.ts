import { test } from "node:test";
import assert from "node:assert/strict";
import { checkScheduleViolationWithTemplates } from "./scheduleValidation";
import { pragueToUTC } from "./dateUtils";
import type { MachineWorkHoursTemplate, MachineWorkHoursTemplateDay } from "./machineWorkHours";

type DayOverride = Partial<MachineWorkHoursTemplateDay> & { dayOfWeek: number };

function makeDay(d: DayOverride): MachineWorkHoursTemplateDay {
  return {
    id: d.dayOfWeek + 1,
    dayOfWeek: d.dayOfWeek,
    startHour: d.startHour ?? 6,
    endHour: d.endHour ?? 14,
    startSlot: d.startSlot ?? null,
    endSlot: d.endSlot ?? null,
    isActive: d.isActive ?? true,
    morningOn: d.morningOn ?? false,
    afternoonOn: d.afternoonOn ?? false,
    nightOn: d.nightOn ?? false,
  };
}

function makeTemplate(machine: string, days: DayOverride[]): MachineWorkHoursTemplate {
  return {
    id: 1,
    machine,
    label: null,
    validFrom: "2026-01-01",
    validTo: null,
    isDefault: true,
    days: days.map(makeDay),
  };
}

// Pondělí 2026-05-11, úterý 2026-05-12 (letní čas — Praha = UTC+2)

test("checkScheduleViolationWithTemplates — blok v zapnuté ranní → null", () => {
  const tmpl = makeTemplate("XL_106", [
    { dayOfWeek: 1, morningOn: true, afternoonOn: false, nightOn: false, startHour: 6, endHour: 14 },
  ]);
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 10),
    pragueToUTC("2026-05-11", 12),
    [tmpl],
    []
  );
  assert.equal(result, null);
});

test("checkScheduleViolationWithTemplates — blok v odpolední, odpolední vypnutá → violation", () => {
  const tmpl = makeTemplate("XL_106", [
    { dayOfWeek: 1, morningOn: true, afternoonOn: false, nightOn: false, startHour: 6, endHour: 14 },
  ]);
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 15),
    pragueToUTC("2026-05-11", 17),
    [tmpl],
    []
  );
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

test("checkScheduleViolationWithTemplates — blok v ranní, ale ranní vypnutá → violation", () => {
  const tmpl = makeTemplate("XL_106", [
    { dayOfWeek: 1, morningOn: false, afternoonOn: true, nightOn: false, startHour: 14, endHour: 22 },
  ]);
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 10),
    pragueToUTC("2026-05-11", 12),
    [tmpl],
    []
  );
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

test("checkScheduleViolationWithTemplates — blok v noční (22:00-24:00 po), noční zapnutá → null", () => {
  const tmpl = makeTemplate("XL_106", [
    { dayOfWeek: 1, morningOn: false, afternoonOn: false, nightOn: true, startHour: 22, endHour: 24 },
    // úterý nic — blok končí před půlnocí, dayOfWeek 2 se neaktivuje
  ]);
  const end = new Date(pragueToUTC("2026-05-11", 23).getTime() + 30 * 60 * 1000); // 23:30 Prague
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 22),
    end,
    [tmpl],
    []
  );
  assert.equal(result, null);
});

test("checkScheduleViolationWithTemplates — blok přes půlnoc (22 po → 05 út), noční zapnutá oba dny → null", () => {
  const tmpl = makeTemplate("XL_106", [
    { dayOfWeek: 1, morningOn: false, afternoonOn: false, nightOn: true, startHour: 22, endHour: 24 },
    { dayOfWeek: 2, morningOn: false, afternoonOn: false, nightOn: true, startHour: 0, endHour: 6 },
  ]);
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 22),
    pragueToUTC("2026-05-12", 5),
    [tmpl],
    []
  );
  assert.equal(result, null);
});

test("checkScheduleViolationWithTemplates — blok přes půlnoc, noční zapnutá jen v pondělí → violation v úterý", () => {
  const tmpl = makeTemplate("XL_106", [
    { dayOfWeek: 1, morningOn: false, afternoonOn: false, nightOn: true, startHour: 22, endHour: 24 },
    { dayOfWeek: 2, morningOn: false, afternoonOn: false, nightOn: false, isActive: false, startHour: 0, endHour: 0 },
  ]);
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 22),
    pragueToUTC("2026-05-12", 5),
    [tmpl],
    []
  );
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

test("checkScheduleViolationWithTemplates — row.isActive=false → violation i když shiftOn=true", () => {
  const tmpl = makeTemplate("XL_106", [
    { dayOfWeek: 1, morningOn: true, afternoonOn: true, nightOn: true, isActive: false, startHour: 0, endHour: 24 },
  ]);
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 10),
    pragueToUTC("2026-05-11", 12),
    [tmpl],
    []
  );
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

test("checkScheduleViolationWithTemplates — exception přebíjí template (backwards compat)", () => {
  const tmpl = makeTemplate("XL_106", [
    { dayOfWeek: 1, morningOn: true, afternoonOn: true, nightOn: true, startHour: 0, endHour: 24 },
  ]);
  const exc = {
    machine: "XL_106",
    date: "2026-05-11",
    startHour: 6,
    endHour: 14,
    startSlot: null,
    endSlot: null,
    isActive: true,
  };
  // Blok v odpolední — template by pustil, ale výjimka pokrývá jen 6-14
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 15),
    pragueToUTC("2026-05-11", 17),
    [tmpl],
    [exc]
  );
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

// TDD — rozlišují starou hour-based logiku od nové shift-flag logiky.
// Data mají hours v rozporu s flagy (scénář: migrace / změna UI bez synchronizace hours).

test("checkScheduleViolationWithTemplates — flags jen ranní, hours 0-24, blok v odpolední → violation (nová logika)", () => {
  // Stará logika: slot 30 je v 0-48 → OK. Nová: shift=AFTERNOON, afternoonOn=false → violation.
  const tmpl = makeTemplate("XL_106", [
    { dayOfWeek: 1, morningOn: true, afternoonOn: false, nightOn: false, startHour: 0, endHour: 24 },
  ]);
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 15),
    pragueToUTC("2026-05-11", 17),
    [tmpl],
    []
  );
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

test("checkScheduleViolationWithTemplates — flags jen odpolední, hours 0-24, blok v noční → violation (nová logika)", () => {
  const tmpl = makeTemplate("XL_106", [
    { dayOfWeek: 1, morningOn: false, afternoonOn: true, nightOn: false, startHour: 0, endHour: 24 },
  ]);
  const end = new Date(pragueToUTC("2026-05-11", 23).getTime() + 30 * 60 * 1000);
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 22),
    end,
    [tmpl],
    []
  );
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

test("checkScheduleViolationWithTemplates — odpolední zapnutá, blok 14-22 → null", () => {
  const tmpl = makeTemplate("XL_106", [
    { dayOfWeek: 1, morningOn: false, afternoonOn: true, nightOn: false, startHour: 14, endHour: 22 },
  ]);
  const result = checkScheduleViolationWithTemplates(
    "XL_106",
    pragueToUTC("2026-05-11", 14),
    pragueToUTC("2026-05-11", 22),
    [tmpl],
    []
  );
  assert.equal(result, null);
});
