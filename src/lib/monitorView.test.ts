import test from "node:test";
import assert from "node:assert/strict";
import { pickHeroBlock, pickNextBlock, todayQueue, runProgress } from "./monitorView.js";
import type { Block } from "../app/_components/TimelineGrid.js";

// Pozn.: časy jsou v UTC. Praha je v srpnu UTC+2, takže 2026-08-10T06:00Z = 8:00 ráno.
function mk(over: Partial<Block> = {}): Block {
  return {
    id: 1,
    machine: "XL_106",
    orderNumber: "25-2418",
    type: "ZAKAZKA",
    startTime: "2026-08-10T06:00:00.000Z",
    endTime: "2026-08-10T09:00:00.000Z",
    printCompletedAt: null,
    blockVariant: "STANDARD",
    locked: false,
    ...over,
  } as Block;
}

test("pickHeroBlock: zakázka uvnitř svého času = running", () => {
  const b = mk({ id: 1 });
  const hero = pickHeroBlock([b], "XL_106", new Date("2026-08-10T07:00:00.000Z"));
  assert.equal(hero?.reason, "running");
  assert.equal(hero?.block.id, 1);
});

test("pickHeroBlock: odklepnutá zakázka se nikdy nevybere jako running", () => {
  const b = mk({ printCompletedAt: "2026-08-10T07:30:00.000Z" });
  const hero = pickHeroBlock([b], "XL_106", new Date("2026-08-10T08:00:00.000Z"));
  assert.equal(hero, null);
});

test("pickHeroBlock: nic neběží, ale dnešní zakázce vypršel čas = overdue", () => {
  const b = mk({ id: 7, endTime: "2026-08-10T09:00:00.000Z" });
  const hero = pickHeroBlock([b], "XL_106", new Date("2026-08-10T10:00:00.000Z"));
  assert.equal(hero?.reason, "overdue");
  assert.equal(hero?.block.id, 7);
});

test("pickHeroBlock: u více přetahujících vyhraje ta s nejpozdějším koncem", () => {
  const a = mk({ id: 1, startTime: "2026-08-10T04:00:00.000Z", endTime: "2026-08-10T06:00:00.000Z" });
  const b = mk({ id: 2, startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T08:00:00.000Z" });
  const hero = pickHeroBlock([a, b], "XL_106", new Date("2026-08-10T09:00:00.000Z"));
  assert.equal(hero?.reason, "overdue");
  assert.equal(hero?.block.id, 2);
});

test("pickHeroBlock: běžící má přednost před přetahující", () => {
  const late = mk({ id: 1, startTime: "2026-08-10T04:00:00.000Z", endTime: "2026-08-10T06:00:00.000Z" });
  const running = mk({ id: 2, startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T10:00:00.000Z" });
  const hero = pickHeroBlock([late, running], "XL_106", new Date("2026-08-10T07:00:00.000Z"));
  assert.equal(hero?.reason, "running");
  assert.equal(hero?.block.id, 2);
});

test("pickHeroBlock: nic neběží ani nepřetahuje = upcoming", () => {
  const b = mk({ id: 3, startTime: "2026-08-10T12:00:00.000Z", endTime: "2026-08-10T14:00:00.000Z" });
  const hero = pickHeroBlock([b], "XL_106", new Date("2026-08-10T10:00:00.000Z"));
  assert.equal(hero?.reason, "upcoming");
  assert.equal(hero?.block.id, 3);
});

test("pickHeroBlock: včerejší neodklepnutá zakázka se jako overdue nebere", () => {
  const b = mk({ startTime: "2026-08-09T06:00:00.000Z", endTime: "2026-08-09T09:00:00.000Z" });
  const hero = pickHeroBlock([b], "XL_106", new Date("2026-08-10T10:00:00.000Z"));
  assert.equal(hero, null);
});

test("pickHeroBlock: cizí stroj a jiné typy bloků se ignorují", () => {
  const other = mk({ id: 1, machine: "XL_105" });
  const maint = mk({ id: 2, type: "UDRZBA" });
  const hero = pickHeroBlock([other, maint], "XL_106", new Date("2026-08-10T07:00:00.000Z"));
  assert.equal(hero, null);
});

test("pickNextBlock: vrátí nejbližší budoucí, i když je zítřejší", () => {
  const far  = mk({ id: 1, startTime: "2026-08-12T06:00:00.000Z", endTime: "2026-08-12T09:00:00.000Z" });
  const near = mk({ id: 2, startTime: "2026-08-11T06:00:00.000Z", endTime: "2026-08-11T09:00:00.000Z" });
  const next = pickNextBlock([far, near], "XL_106", new Date("2026-08-10T10:00:00.000Z"));
  assert.equal(next?.id, 2);
});

test("pickNextBlock: bez budoucí zakázky vrátí null", () => {
  const past = mk({ startTime: "2026-08-09T06:00:00.000Z", endTime: "2026-08-09T09:00:00.000Z" });
  assert.equal(pickNextBlock([past], "XL_106", new Date("2026-08-10T10:00:00.000Z")), null);
});

test("todayQueue: jen dnešek, jen daný stroj, seřazeno podle startu", () => {
  const a = mk({ id: 1, startTime: "2026-08-10T10:00:00.000Z", endTime: "2026-08-10T12:00:00.000Z" });
  const b = mk({ id: 2, startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T09:00:00.000Z" });
  const other = mk({ id: 3, machine: "XL_105" });
  const tomorrow = mk({ id: 4, startTime: "2026-08-11T06:00:00.000Z", endTime: "2026-08-11T09:00:00.000Z" });
  const q = todayQueue([a, b, other, tomorrow], "XL_106", new Date("2026-08-10T08:00:00.000Z"));
  assert.deepEqual(q.map((x) => x.id), [2, 1]);
});

test("todayQueue: odklepnuté zakázky ve frontě zůstávají (zobrazí se ztlumené)", () => {
  const done = mk({ id: 5, printCompletedAt: "2026-08-10T08:00:00.000Z" });
  const q = todayQueue([done], "XL_106", new Date("2026-08-10T10:00:00.000Z"));
  assert.equal(q.length, 1);
});

test("runProgress: v polovině běhu = 50 % a zbývá polovina", () => {
  const b = mk({ startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T10:00:00.000Z" });
  const p = runProgress(b, new Date("2026-08-10T08:00:00.000Z"));
  assert.equal(p.percent, 50);
  assert.equal(p.remainingMinutes, 120);
});

test("runProgress: po konci je 100 % a zbývající minuty jsou záporné", () => {
  const b = mk({ startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T08:00:00.000Z" });
  const p = runProgress(b, new Date("2026-08-10T08:30:00.000Z"));
  assert.equal(p.percent, 100);
  assert.equal(p.remainingMinutes, -30);
});

test("runProgress: před startem je 0 %", () => {
  const b = mk({ startTime: "2026-08-10T10:00:00.000Z", endTime: "2026-08-10T12:00:00.000Z" });
  assert.equal(runProgress(b, new Date("2026-08-10T09:00:00.000Z")).percent, 0);
});
