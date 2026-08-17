import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeIntervals, intersectIntervals, subtractIntervals, totalHours, type Interval,
} from "./intervals";

/** Čitelný zápis — hodiny místo milisekund. */
const iv = (startH: number, endH: number): Interval => ({ start: startH * 3_600_000, end: endH * 3_600_000 });
const hours = (list: Interval[]) => list.map((i) => [i.start / 3_600_000, i.end / 3_600_000]);

describe("intervals — merge", () => {
  it("slučuje překryvy i dotyky a řadí", () => {
    assert.deepEqual(hours(mergeIntervals([iv(5, 8), iv(1, 3), iv(2, 6)])), [[1, 8]]);
    assert.deepEqual(hours(mergeIntervals([iv(0, 2), iv(2, 4)])), [[0, 4]], "dotyk se slučuje");
    assert.deepEqual(hours(mergeIntervals([iv(0, 2), iv(3, 4)])), [[0, 2], [3, 4]], "mezera zůstane");
  });

  it("zahazuje prázdné a obrácené", () => {
    assert.deepEqual(hours(mergeIntervals([iv(3, 3), iv(5, 4)])), []);
  });

  it("prázdný vstup dá prázdný výstup", () => {
    assert.deepEqual(mergeIntervals([]), []);
  });
});

describe("intervals — průnik", () => {
  it("vrací jen společnou část", () => {
    assert.deepEqual(hours(intersectIntervals([iv(0, 10)], [iv(3, 5), iv(7, 12)])), [[3, 5], [7, 10]]);
  });

  it("bez překryvu je prázdný", () => {
    assert.deepEqual(intersectIntervals([iv(0, 2)], [iv(5, 8)]), []);
  });

  it("dotyk NENÍ průnik — intervaly jsou polootevřené", () => {
    assert.deepEqual(intersectIntervals([iv(0, 3)], [iv(3, 6)]), []);
  });

  it("je komutativní", () => {
    const a = [iv(0, 5), iv(8, 12)], b = [iv(3, 9)];
    assert.deepEqual(hours(intersectIntervals(a, b)), hours(intersectIntervals(b, a)));
  });
});

describe("intervals — rozdíl", () => {
  it("vyřízne prostředek", () => {
    assert.deepEqual(hours(subtractIntervals([iv(0, 10)], [iv(3, 6)])), [[0, 3], [6, 10]]);
  });

  it("odečtení celku nezanechá nic", () => {
    assert.deepEqual(subtractIntervals([iv(2, 5)], [iv(0, 9)]), []);
  });

  it("odečtení mimo rozsah nemění nic", () => {
    assert.deepEqual(hours(subtractIntervals([iv(0, 3)], [iv(5, 9)])), [[0, 3]]);
  });

  it("odečítaný seznam se nemusí překrývat ani řadit", () => {
    assert.deepEqual(hours(subtractIntervals([iv(0, 10)], [iv(6, 8), iv(1, 2), iv(7, 9)])), [[0, 1], [2, 6], [9, 10]]);
  });
});

describe("intervals — součet", () => {
  it("sčítá délky v hodinách", () => {
    assert.equal(totalHours([iv(0, 2), iv(5, 8)]), 5);
  });

  it("NEodečítá překryvy — vstup se musí sloučit předem", () => {
    // Záměrná past: `totalHours` je hloupý součet. Volající, který si zapomene
    // vstup projet `mergeIntervals`, dostane dvojnásobek — a přesně tahle vada
    // v R1 nafoukla dostupné hodiny nepřetržitého stroje ze 168 na 182 týdně.
    assert.equal(totalHours([iv(0, 5), iv(3, 8)]), 10);
    assert.equal(totalHours(mergeIntervals([iv(0, 5), iv(3, 8)])), 8);
  });

  it("prázdný seznam dá nulu", () => {
    assert.equal(totalHours([]), 0);
  });
});
