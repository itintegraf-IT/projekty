import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RESERVATION_STATUSES, OPEN_STATUSES, CLOSED_STATUSES, SUCCESS_STATUSES,
  computeConversionPercent,
} from "./reservationStatus";

describe("slovník stavů rezervací", () => {
  it("otevřené a uzavřené dohromady pokrývají VŠECHNY stavy a nepřekrývají se", () => {
    const union = [...OPEN_STATUSES, ...CLOSED_STATUSES].sort();
    assert.deepEqual(union, [...RESERVATION_STATUSES].sort());
    assert.equal(new Set(union).size, union.length, "stav je ve dvou skupinách naráz");
  });

  it("úspěšné stavy jsou podmnožinou uzavřených", () => {
    for (const s of SUCCESS_STATUSES) assert.ok(CLOSED_STATUSES.includes(s), `${s} není mezi uzavřenými`);
  });

  it("CONFIRMED se počítá jako úspěch — jinak konverze klesá, čím lépe proces běží", () => {
    assert.ok(SUCCESS_STATUSES.includes("CONFIRMED"));
  });
});

describe("computeConversionPercent", () => {
  it("úspěšně vyřízené ze všech uzavřených", () => {
    assert.equal(computeConversionPercent({ SCHEDULED: 7, CONFIRMED: 6, REJECTED: 3, WITHDRAWN: 0 }), 81);
  });

  it("prázdný jmenovatel → null, ne 0 % (0 % vypadá jako katastrofa)", () => {
    assert.equal(computeConversionPercent({ SCHEDULED: 0, CONFIRMED: 0, REJECTED: 0, WITHDRAWN: 0 }), null);
  });

  it("neznámý stav v datech neshodí výpočet", () => {
    assert.equal(computeConversionPercent({ SCHEDULED: 1, NEZNAMY: 5 }), 100);
  });
});
