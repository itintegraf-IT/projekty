import test from "node:test";
import assert from "node:assert/strict";
import { pickHeroBlock, pickNextBlock, monitorQueue, resolveSelectedBlock, reasonForBlock, runProgress, resolveStickyBlock, startDayLabel } from "./monitorView.js";
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

test("pickHeroBlock: noční směna přes půlnoc zůstane na kartě i ráno", () => {
  // 22:00 pražského času předchozího dne až 6:00 ráno; teď je 8:00 ráno.
  const b = mk({ id: 9, startTime: "2026-08-09T20:00:00.000Z", endTime: "2026-08-10T04:00:00.000Z" });
  const hero = pickHeroBlock([b], "XL_106", new Date("2026-08-10T06:00:00.000Z"));
  assert.equal(hero?.reason, "overdue");
  assert.equal(hero?.block.id, 9);
});

test("pickHeroBlock: zakázka po 16hodinovém okně už na kartě není", () => {
  const b = mk({ startTime: "2026-08-09T04:00:00.000Z", endTime: "2026-08-09T08:00:00.000Z" });
  // konec + 17 h
  const hero = pickHeroBlock([b], "XL_106", new Date("2026-08-10T01:00:00.000Z"));
  assert.equal(hero, null);
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

test("monitorQueue: jen daný stroj, dnešek i zítřek, seřazeno podle startu", () => {
  const a = mk({ id: 1, startTime: "2026-08-10T10:00:00.000Z", endTime: "2026-08-10T12:00:00.000Z" });
  const b = mk({ id: 2, startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T09:00:00.000Z" });
  const other = mk({ id: 3, machine: "XL_105" });
  const tmr = mk({ id: 4, startTime: "2026-08-11T06:00:00.000Z", endTime: "2026-08-11T09:00:00.000Z" });
  const later = mk({ id: 5, startTime: "2026-08-13T06:00:00.000Z", endTime: "2026-08-13T09:00:00.000Z" });
  const q = monitorQueue([a, b, other, tmr, later], "XL_106", new Date("2026-08-10T08:00:00.000Z"));
  assert.deepEqual(q.today.map((x) => x.id), [2, 1]);
  assert.deepEqual(q.tomorrow.map((x) => x.id), [4]);
});

test("monitorQueue: odklepnuté zakázky ve frontě zůstávají (zobrazí se ztlumené)", () => {
  const done = mk({ id: 5, printCompletedAt: "2026-08-10T08:00:00.000Z" });
  const q = monitorQueue([done], "XL_106", new Date("2026-08-10T10:00:00.000Z"));
  assert.equal(q.today.length, 1);
});

test("monitorQueue: rezervace a údržba do fronty nepatří", () => {
  const rez = mk({ id: 6, type: "REZERVACE" });
  const udr = mk({ id: 7, type: "UDRZBA" });
  const q = monitorQueue([rez, udr], "XL_106", new Date("2026-08-10T10:00:00.000Z"));
  assert.equal(q.today.length, 0);
  assert.equal(q.tomorrow.length, 0);
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

test("resolveStickyBlock: vrátí odklepnutý blok, který je pořád v datech", () => {
  const b = mk({ id: 5, printCompletedAt: "2026-08-10T13:20:00.000Z" });
  assert.equal(resolveStickyBlock([b], 5, "XL_106")?.id, 5);
});

test("resolveStickyBlock: bez id vrátí null", () => {
  const b = mk({ id: 5, printCompletedAt: "2026-08-10T13:20:00.000Z" });
  assert.equal(resolveStickyBlock([b], null, "XL_106"), null);
});

test("resolveStickyBlock: blok, který z dat zmizel, drží kartu neplatně", () => {
  const other = mk({ id: 9, printCompletedAt: "2026-08-10T13:20:00.000Z" });
  assert.equal(resolveStickyBlock([other], 5, "XL_106"), null);
});

test("resolveStickyBlock: zrušené odklepnutí kartu pustí", () => {
  const b = mk({ id: 5, printCompletedAt: null });
  assert.equal(resolveStickyBlock([b], 5, "XL_106"), null);
});

test("resolveStickyBlock: zakázka přesunutá na jiný stroj kartu pustí", () => {
  const b = mk({ id: 5, machine: "XL_105", printCompletedAt: "2026-08-10T13:20:00.000Z" });
  assert.equal(resolveStickyBlock([b], 5, "XL_106"), null);
});

test("startDayLabel: zakázka začínající dnes nemá popisek dne", () => {
  const now = new Date("2026-08-10T08:00:00.000Z");
  assert.equal(startDayLabel("2026-08-10T12:00:00.000Z", now), null);
});

test("startDayLabel: zítřejší zakázka má \"zítra\"", () => {
  const now = new Date("2026-08-10T08:00:00.000Z");
  assert.equal(startDayLabel("2026-08-11T04:00:00.000Z", now), "zítra");
});

test("startDayLabel: vzdálenější zakázka má krátké datum", () => {
  const now = new Date("2026-08-10T08:00:00.000Z");
  assert.equal(startDayLabel("2026-08-13T04:00:00.000Z", now), "13. 08.");
});

test("startDayLabel: rozhoduje civilní den, ne počet hodin", () => {
  // Ve 23:30 pražského času je zakázka na 0:30 „zítra", i když je za hodinu.
  const now = new Date("2026-08-10T21:30:00.000Z");
  assert.equal(startDayLabel("2026-08-10T22:30:00.000Z", now), "zítra");
});

test("resolveSelectedBlock: vrátí zakázku na daném stroji", () => {
  const b = mk({ id: 5 });
  assert.equal(resolveSelectedBlock([b], 5, "XL_106")?.id, 5);
});

test("resolveSelectedBlock: bez id vrátí null", () => {
  assert.equal(resolveSelectedBlock([mk({ id: 5 })], null, "XL_106"), null);
});

test("resolveSelectedBlock: zakázka, která z dat zmizela", () => {
  assert.equal(resolveSelectedBlock([mk({ id: 9 })], 5, "XL_106"), null);
});

test("resolveSelectedBlock: zakázka přesunutá na jiný stroj výběr pustí", () => {
  const b = mk({ id: 5, machine: "XL_105" });
  assert.equal(resolveSelectedBlock([b], 5, "XL_106"), null);
});

test("resolveSelectedBlock: rezervaci ani údržbu vybrat nejde", () => {
  const rez = mk({ id: 5, type: "REZERVACE" });
  assert.equal(resolveSelectedBlock([rez], 5, "XL_106"), null);
});

test("resolveSelectedBlock: odklepnutou zakázku vybrat jde (kvůli vrácení)", () => {
  const b = mk({ id: 5, printCompletedAt: "2026-08-10T08:00:00.000Z" });
  assert.equal(resolveSelectedBlock([b], 5, "XL_106")?.id, 5);
});

test("reasonForBlock: uvnitř svého času = running", () => {
  const b = mk({ startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T12:00:00.000Z" });
  assert.equal(reasonForBlock(b, new Date("2026-08-10T08:00:00.000Z")), "running");
});

test("reasonForBlock: přesný konec už není running", () => {
  const b = mk({ startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T12:00:00.000Z" });
  assert.equal(reasonForBlock(b, new Date("2026-08-10T12:00:00.000Z")), "overdue");
});

test("reasonForBlock: dávno skončená zakázka je overdue bez ohledu na 16h okno", () => {
  const b = mk({ startTime: "2026-08-01T06:00:00.000Z", endTime: "2026-08-01T12:00:00.000Z" });
  assert.equal(reasonForBlock(b, new Date("2026-08-10T08:00:00.000Z")), "overdue");
});

test("reasonForBlock: budoucí zakázka je upcoming", () => {
  const b = mk({ startTime: "2026-08-12T06:00:00.000Z", endTime: "2026-08-12T12:00:00.000Z" });
  assert.equal(reasonForBlock(b, new Date("2026-08-10T08:00:00.000Z")), "upcoming");
});
