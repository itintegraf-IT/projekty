import assert from "node:assert/strict";
import test from "node:test";
import {
  addMonthsToCivilDate,
  normalizeCivilDateInput,
  parseCivilDateWriteInput,
  pragueOf,
  pragueToUTC,
} from "./dateUtils";
import {
  parseCompanyDayDateTimeInput,
  serializeCompanyDay,
} from "./companyDaySerialization";

test("roundtrips late-night Prague times without crossing into the wrong day", () => {
  const cases: Array<[string, number, number]> = [
    ["2026-04-01", 22, 0],
    ["2026-04-01", 23, 30],
    ["2026-04-02", 0, 0],
    ["2026-04-02", 0, 30],
  ];

  for (const [dateStr, hour, minute] of cases) {
    const actual = pragueOf(pragueToUTC(dateStr, hour, minute));
    assert.equal(actual.dateStr, dateStr);
    assert.equal(actual.hour, hour);
    assert.equal(actual.minute, minute);
  }
});

test("normalizes spring-forward gap to the first valid Prague instant", () => {
  const twoOClock = pragueOf(pragueToUTC("2026-03-29", 2, 0));
  const twoThirty = pragueOf(pragueToUTC("2026-03-29", 2, 30));

  assert.equal(twoOClock.dateStr, "2026-03-29");
  assert.equal(twoOClock.hour, 3);
  assert.equal(twoOClock.minute, 0);

  assert.equal(twoThirty.dateStr, "2026-03-29");
  assert.equal(twoThirty.hour, 3);
  assert.equal(twoThirty.minute, 0);
});

test("keeps duplicated fall-back times on the requested Prague civil time", () => {
  const actual = pragueOf(pragueToUTC("2026-10-25", 2, 30));
  assert.equal(actual.dateStr, "2026-10-25");
  assert.equal(actual.hour, 2);
  assert.equal(actual.minute, 30);
});

test("parses ISO date-time writes to Prague civil dates instead of slicing UTC dates", () => {
  const iso = "2026-04-01T22:00:00.000Z";
  assert.equal(parseCivilDateWriteInput(iso), "2026-04-02");
  assert.equal(normalizeCivilDateInput(iso), "2026-04-02");
});

test("company days keep instant serialization instead of collapsing to YYYY-MM-DD", () => {
  const raw = {
    id: 1,
    label: "Odstavka",
    startDate: new Date("2026-04-01T20:00:00.000Z"),
    endDate: new Date("2026-04-01T21:59:00.000Z"),
    createdAt: new Date("2026-03-01T10:00:00.000Z"),
  };

  const serialized = serializeCompanyDay(raw);

  assert.equal(serialized.startDate, "2026-04-01T20:00:00.000Z");
  assert.equal(serialized.endDate, "2026-04-01T21:59:00.000Z");
  assert.equal(serialized.createdAt, "2026-03-01T10:00:00.000Z");

  assert.equal(parseCompanyDayDateTimeInput(serialized.startDate)?.toISOString(), serialized.startDate);
  assert.equal(parseCompanyDayDateTimeInput(serialized.endDate)?.toISOString(), serialized.endDate);
});

test("clamps monthly civil-date recurrence to the end of the target month", () => {
  assert.equal(addMonthsToCivilDate("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsToCivilDate("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonthsToCivilDate("2026-03-31", -1), "2026-02-28");
});
