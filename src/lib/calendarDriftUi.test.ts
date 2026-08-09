import { test } from "node:test";
import assert from "node:assert/strict";
import { isParkedDrift, countActionableDriftByMachine } from "./calendarDriftUi";
import type { CalendarDriftInfo } from "./printTimeClient";

const drift = (reason: CalendarDriftInfo["reason"]): CalendarDriftInfo => ({ reason, expectedEnd: null });

test("isParkedDrift: odložení ano, porucha ne", () => {
  assert.equal(isParkedDrift("PARKED"), true);
  assert.equal(isParkedDrift("STALE_BYPASS"), true);
  assert.equal(isParkedDrift("END_MISMATCH"), false);
  assert.equal(isParkedDrift("START_NOT_RUNNABLE"), false);
  assert.equal(isParkedDrift("HORIZON_EXCEEDED"), false);
});

test("countActionableDriftByMachine: počítá jen to, s čím hromadné Přepočítat hne", () => {
  // MUTAČNÍ POJISTKA: bez vyloučení odložených by pruh nad strojem hlásil „3 nesedí
  // na kalendář" a dialog sliboval posun, ale serverový detektor odložené bloky
  // vyřazuje — hromadná akce by se dotkla jediného z nich.
  const blocks = [
    { id: 1, machine: "XL_105" }, // skutečný drift
    { id: 2, machine: "XL_105" }, // vědomě odložená
    { id: 3, machine: "XL_105" }, // zbytková značka
    { id: 4, machine: "XL_106" }, // bez nálezu
  ];
  const driftMap = new Map<number, CalendarDriftInfo>([
    [1, drift("END_MISMATCH")],
    [2, drift("PARKED")],
    [3, drift("STALE_BYPASS")],
  ]);
  const counts = countActionableDriftByMachine(blocks, driftMap);
  assert.equal(counts.get("XL_105"), 1);
  assert.equal(counts.get("XL_106"), undefined, "stroj bez nálezu nesmí mít v mapě klíč (pruh se nekreslí)");
});

test("countActionableDriftByMachine: stroj jen s odloženými zakázkami nemá pruh vůbec", () => {
  // Kdyby tu vyšla nula místo chybějícího klíče, chip by se nekreslil taky —
  // ale tenhle test pinuje, že se do mapy vůbec nedostane, takže `?? 0` u volajícího
  // nemusí nic dopočítávat.
  const counts = countActionableDriftByMachine(
    [{ id: 1, machine: "XL_106" }, { id: 2, machine: "XL_106" }],
    new Map([[1, drift("PARKED")], [2, drift("STALE_BYPASS")]])
  );
  assert.deepEqual([...counts.entries()], []);
});

test("countActionableDriftByMachine: nálezy se sčítají per stroj", () => {
  const counts = countActionableDriftByMachine(
    [
      { id: 1, machine: "XL_105" },
      { id: 2, machine: "XL_105" },
      { id: 3, machine: "XL_106" },
    ],
    new Map([
      [1, drift("END_MISMATCH")],
      [2, drift("START_NOT_RUNNABLE")],
      [3, drift("HORIZON_EXCEEDED")],
    ])
  );
  assert.equal(counts.get("XL_105"), 2);
  assert.equal(counts.get("XL_106"), 1);
});
