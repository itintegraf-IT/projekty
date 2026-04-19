import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

// ─── Mocky (musí být před prvním importem testované funkce) ───────────────────
// Prisma mock — nahradí DB volání testovými daty
const mockWeekShifts: unknown[] = [];
const mockCompanyDays: unknown[] = [];

await mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      machineWeekShifts: {
        findMany: mock.fn(async () => mockWeekShifts),
      },
      companyDay: {
        findMany: mock.fn(async () => mockCompanyDays),
      },
    },
  },
});

// scheduleValidation mock — kontrolujeme výsledky validace
let scheduleViolationResult: string | null = null;

await mock.module("@/lib/scheduleValidation", {
  namedExports: {
    serializeWeekShifts: mock.fn(() => []),
    checkScheduleViolationWithTemplates: mock.fn(() => scheduleViolationResult),
  },
});

// Import testované funkce AŽ PO nastavení mocků
const { validateBlockScheduleFromDb } = await import("@/lib/scheduleValidationServer");

// ─── Pomocné konstanty pro testy ─────────────────────────────────────────────
const MACHINE = "XL_105";
const START = new Date("2026-04-15T06:00:00.000Z");
const END   = new Date("2026-04-15T14:00:00.000Z");

// ─── Testy ───────────────────────────────────────────────────────────────────
describe("validateBlockScheduleFromDb", () => {
  describe("Non-ZAKAZKA typy — okamžitý null (bez DB volání)", () => {
    it("REZERVACE vrátí null bez validace", async () => {
      const result = await validateBlockScheduleFromDb(MACHINE, START, END, "REZERVACE", false);
      assert.equal(result, null);
    });

    it("UDRZBA vrátí null bez validace", async () => {
      const result = await validateBlockScheduleFromDb(MACHINE, START, END, "UDRZBA", false);
      assert.equal(result, null);
    });

    it("Libovolný neznámý typ vrátí null", async () => {
      const result = await validateBlockScheduleFromDb(MACHINE, START, END, "NEEXISTUJICI_TYP", false);
      assert.equal(result, null);
    });
  });

  describe("ZAKAZKA — bez porušení", () => {
    before(() => {
      scheduleViolationResult = null;
      mockCompanyDays.length = 0;
    });

    it("vrátí null pokud není žádné porušení", async () => {
      const result = await validateBlockScheduleFromDb(MACHINE, START, END, "ZAKAZKA", false);
      assert.equal(result, null);
    });

    it("vrátí null v bypass módu bez company days", async () => {
      const result = await validateBlockScheduleFromDb(MACHINE, START, END, "ZAKAZKA", true);
      assert.equal(result, null);
    });
  });

  describe("ZAKAZKA — schedule violation", () => {
    before(() => {
      scheduleViolationResult = "Blok zasahuje mimo pracovní hodiny.";
      mockCompanyDays.length = 0;
    });

    it("vrátí error pokud checkScheduleViolationWithTemplates hlásí porušení", async () => {
      const result = await validateBlockScheduleFromDb(MACHINE, START, END, "ZAKAZKA", false);
      assert.ok(result !== null);
      assert.equal(result.error, "Blok zasahuje mimo pracovní hodiny.");
    });

    it("v bypass módu schedule violation ignoruje (vrátí null)", async () => {
      const result = await validateBlockScheduleFromDb(MACHINE, START, END, "ZAKAZKA", true);
      assert.equal(result, null);
    });
  });

  describe("ZAKAZKA — company day konflikty", () => {
    before(() => {
      scheduleViolationResult = null;
    });

    it("vrátí error pokud blok zasahuje do odstávky (machine === null = obě)", async () => {
      mockCompanyDays.length = 0;
      mockCompanyDays.push({ id: 1, label: "Vánoce", machine: null, startDate: START, endDate: END });

      const result = await validateBlockScheduleFromDb(MACHINE, START, END, "ZAKAZKA", false);
      assert.ok(result !== null);
      assert.equal(result.error, "Blok zasahuje do plánované odstávky.");
    });

    it("vrátí error pokud blok zasahuje do odstávky pro stejný stroj", async () => {
      mockCompanyDays.length = 0;
      mockCompanyDays.push({ id: 2, label: "Oprava XL_105", machine: MACHINE, startDate: START, endDate: END });

      const result = await validateBlockScheduleFromDb(MACHINE, START, END, "ZAKAZKA", false);
      assert.ok(result !== null);
      assert.equal(result.error, "Blok zasahuje do plánované odstávky.");
    });

    it("ignoruje odstávku pro jiný stroj", async () => {
      mockCompanyDays.length = 0;
      mockCompanyDays.push({ id: 3, label: "Oprava XL_106", machine: "XL_106", startDate: START, endDate: END });

      const result = await validateBlockScheduleFromDb(MACHINE, START, END, "ZAKAZKA", false);
      assert.equal(result, null);
    });

    it("company day blokuje i v bypass módu (bypass neobchází odstávky)", async () => {
      mockCompanyDays.length = 0;
      mockCompanyDays.push({ id: 4, label: "Celozávodní dovolená", machine: null, startDate: START, endDate: END });

      const result = await validateBlockScheduleFromDb(MACHINE, START, END, "ZAKAZKA", true);
      assert.ok(result !== null);
      assert.equal(result.error, "Blok zasahuje do plánované odstávky.");
    });
  });

  // ─── Sprint G2: integrační test ověřující load & forward override dat ────────
  // Tento test NEověřuje vnitřní logiku validátoru (to dělají override testy
  // v scheduleValidation.test.ts) — jen potvrzuje, že validateBlockScheduleFromDb
  // správně načte MachineWeekShifts z DB (včetně override sloupců) a předá je dál.
  describe("ZAKAZKA — override integration (Sprint G2)", () => {
    before(() => {
      scheduleViolationResult = null;
      mockCompanyDays.length = 0;
      mockWeekShifts.length = 0;
      // Pondělí 2026-04-13 s overridem morningEndMin=780 (13:00 místo 14:00)
      mockWeekShifts.push({
        machine: MACHINE,
        weekStart: "2026-04-13",
        dayOfWeek: 1,
        isActive: true,
        morningOn: true,
        afternoonOn: true,
        nightOn: false,
        morningStartMin: null,
        morningEndMin: 780,
        afternoonStartMin: null,
        afternoonEndMin: null,
        nightStartMin: null,
        nightEndMin: null,
      });
    });

    it("předává override-ridden weekShifts do serializeWeekShifts", async () => {
      // Scenář: blok 13:15–13:45 (Prague time, DST = UTC+2)
      // by měl být blokován — morning shift končí v 13:00 podle overridu.
      scheduleViolationResult = "Blok zasahuje mimo pracovní hodiny.";
      const result = await validateBlockScheduleFromDb(
        MACHINE,
        new Date("2026-04-13T11:15:00.000Z"), // Prague 13:15
        new Date("2026-04-13T11:45:00.000Z"), // Prague 13:45
        "ZAKAZKA",
        false
      );
      assert.ok(result !== null);
      assert.equal(result.error, "Blok zasahuje mimo pracovní hodiny.");
    });
  });
});
