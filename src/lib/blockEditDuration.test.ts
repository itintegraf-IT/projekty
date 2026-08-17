import test from "node:test";
import assert from "node:assert/strict";
import { durationPayload, resolveDurationSync } from "./blockEditDuration.js";
import { blockPrintMinutes } from "./printTimeClient.js";

test("nedotčeno + typ beze změny → {} (délka se neposílá)", () => {
  const result = durationPayload({
    type: "ZAKAZKA",
    typeChanged: false,
    touched: false,
    durationHours: 4,
    startTime: "2026-08-17T06:00:00.000Z",
  });
  assert.deepEqual(result, {});
});

test("dotčeno + ZAKAZKA → printMinutes zaokrouhlené na celé minuty", () => {
  const result = durationPayload({
    type: "ZAKAZKA",
    typeChanged: false,
    touched: true,
    durationHours: 2.5,
    startTime: "2026-08-17T06:00:00.000Z",
  });
  assert.deepEqual(result, { printMinutes: 150 });
});

test("dotčeno + REZERVACE → endTime dopočítaný ze startTime + durationHours", () => {
  const result = durationPayload({
    type: "REZERVACE",
    typeChanged: false,
    touched: true,
    durationHours: 3,
    startTime: "2026-08-17T06:00:00.000Z",
  });
  assert.deepEqual(result, { endTime: "2026-08-17T09:00:00.000Z" });
});

test("nedotčeno, ale typeChanged → délka se posílá i tak (flip rezervace na zakázku)", () => {
  const result = durationPayload({
    type: "ZAKAZKA",
    typeChanged: true,
    touched: false,
    durationHours: 6,
    startTime: "2026-08-17T06:00:00.000Z",
  });
  assert.deepEqual(result, { printMinutes: 360 });
});

test("nedotčeno + typeChanged + UDRZBA → endTime, ne printMinutes", () => {
  const result = durationPayload({
    type: "UDRZBA",
    typeChanged: true,
    touched: false,
    durationHours: 1,
    startTime: "2026-08-17T06:00:00.000Z",
  });
  assert.deepEqual(result, { endTime: "2026-08-17T07:00:00.000Z" });
});

// Regresní test incidentu 14. 8. 2026 (zakázka 18827): split snížil printMinutes
// na serveru, panel zůstal otevřený se stavovou hodnotou 6 h z okamžiku mountu.
// Uživatel se selectu délky nedotkl — payload nesmí obsahovat printMinutes: 360.
test("regrese 18827: nedotčený select + ZAKAZKA + durationHours=6 → {} (ne printMinutes: 360)", () => {
  const result = durationPayload({
    type: "ZAKAZKA",
    typeChanged: false,
    touched: false,
    durationHours: 6,
    startTime: "2026-08-17T06:00:00.000Z",
  });
  assert.deepEqual(result, {});
  assert.equal("printMinutes" in result, false);
});

test("startTime jako Date instance funguje stejně jako ISO string", () => {
  const result = durationPayload({
    type: "REZERVACE",
    typeChanged: false,
    touched: true,
    durationHours: 1.5,
    startTime: new Date("2026-08-17T06:00:00.000Z"),
  });
  assert.deepEqual(result, { endTime: "2026-08-17T07:30:00.000Z" });
});

// ─── resolveDurationSync (opravné kolo 1 — recenze etapy 2, 17. 8. 2026) ──────────

test("resolveDurationSync: server beze změny → none (bez ohledu na touched)", () => {
  assert.deepEqual(resolveDurationSync(4, 4, false), { kind: "none" });
  assert.deepEqual(resolveDurationSync(4, 4, true), { kind: "none" });
});

test("resolveDurationSync: server se změnil + nedotčeno → sync na novou hodnotu", () => {
  assert.deepEqual(resolveDurationSync(6, 2, false), { kind: "sync", durationHours: 2 });
});

test("resolveDurationSync: server se změnil + dotčeno → warn, nepřepisuje", () => {
  assert.deepEqual(resolveDurationSync(6, 2, true), { kind: "warn", durationHours: 2 });
});

// Regrese opravného kola 1: efekt dřív sledoval currentDurationHours, což je
// type === "ZAKAZKA" ? blockPrintMinutes(block)/60 : span — se STAVEM formuláře
// `type`, ne s block.type. Kliknutí na „Typ záznamu" (ZAKAZKA↔UDRZBA↔REZERVACE)
// tak přepnulo vzorec a `currentDurationHours` skočilo (u pozastavené zakázky
// span 26 h vs printMinutes 10 h), i když se na serveru nic nezměnilo — nedotčený
// select se tiše přepsal na hodnotu mimo DURATION_OPTIONS a dotčený vyvolal
// falešnou hlášku „změnilo se". Test dokládá, že serverová hodnota (odvozená
// VÝHRADNĚ z block.type přes blockPrintMinutes, ne z lokálního `type`) je na
// takovém přepnutí nezávislá, takže resolveDurationSync správně vrátí none.
test("regrese oprav. kola 1: lokálně přepnutý typ formuláře, blok beze změny → žádná reakce", () => {
  // Pozastavená zakázka na serveru: span (elapsed) 26 h, printMinutes 10 h —
  // přesně scénář z komentáře u mountu v BlockEdit.tsx.
  const block = {
    type: "ZAKAZKA",
    printMinutes: 600,
    startTime: "2026-08-17T06:00:00.000Z",
    endTime: "2026-08-18T08:00:00.000Z", // +26h span
  };
  // "Předtím" — panel právě otevřený, efekt se ještě nespustil.
  const prevServerDurationHours = blockPrintMinutes(block) / 60; // 10 (printMinutes)
  // Uživatel klikne na tlačítko „Typ záznamu" → UDRZBA. Block prop se NEMĚNÍ
  // (žádný fetch, žádný split) — jen lokální stav formuláře `type`. Serverová
  // hodnota se počítá pořád ze stejného, nezměněného `block`.
  const nextServerDurationHours = blockPrintMinutes(block) / 60; // stále 10
  assert.equal(prevServerDurationHours, nextServerDurationHours);
  assert.deepEqual(
    resolveDurationSync(prevServerDurationHours, nextServerDurationHours, false),
    { kind: "none" },
  );
  assert.deepEqual(
    resolveDurationSync(prevServerDurationHours, nextServerDurationHours, true),
    { kind: "none" },
  );
});
