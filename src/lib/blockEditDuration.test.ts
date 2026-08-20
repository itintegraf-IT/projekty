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

test("dotčeno + REZERVACE → printMinutes, ne endTime (etapa 9: REZERVACE je tiskový typ)", () => {
  const result = durationPayload({
    type: "REZERVACE",
    typeChanged: false,
    touched: true,
    durationHours: 3,
    startTime: "2026-08-17T06:00:00.000Z",
  });
  assert.deepEqual(result, { printMinutes: 180 });
});

test("durationPayload: REZERVACE posílá printMinutes — tiskové hodiny (etapa 9)", () => {
  assert.deepEqual(
    durationPayload({ type: "REZERVACE", typeChanged: false, touched: true, durationHours: 2.5, startTime: "2026-08-21T08:00:00.000Z" }),
    { printMinutes: 150 },
  );
});

test("durationPayload: UDRZBA zůstává na endTime (rigidní)", () => {
  assert.deepEqual(
    durationPayload({ type: "UDRZBA", typeChanged: false, touched: true, durationHours: 2, startTime: "2026-08-21T08:00:00.000Z" }),
    { endTime: "2026-08-21T10:00:00.000Z" },
  );
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

test("startTime jako Date instance funguje stejně jako ISO string (UDRZBA, endTime větev)", () => {
  const result = durationPayload({
    type: "UDRZBA",
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

// Regrese opravného kola 1 (kontext, ne co tenhle test hlídá — viz níž): efekt
// dřív sledoval currentDurationHours, což je type === "ZAKAZKA" ?
// blockPrintMinutes(block)/60 : span — se STAVEM formuláře `type`, ne s
// block.type. Kliknutí na „Typ záznamu" (ZAKAZKA↔UDRZBA↔REZERVACE) tak přepnulo
// vzorec a `currentDurationHours` skočilo (u pozastavené zakázky span 26 h vs
// printMinutes 10 h), i když se na serveru nic nezměnilo.
//
// CO TENHLE TEST HLÍDÁ: dokumentuje očekávanou sémantiku `resolveDurationSync` —
// když se obě porovnávané hodnoty rovnají (server se nezměnil), vrátí vždy
// `{ kind: "none" }`, bez ohledu na `touched`. To je i case „beze změny" z prvního
// testu v souboru pod jiným jménem.
//
// CO TENHLE TEST NEHLÍDÁ: napojení efektu 2b/2c v BlockEdit.tsx. Test je
// tautologický — `prevServerDurationHours` a `nextServerDurationHours` se počítají
// ze STEJNÉHO neměnného `block`, takže `resolveDurationSync(x, x, …)` vrátí
// `"none"` už na první řádce funkce (early-return při rovnosti), dřív než se
// vyhodnotí cokoliv jiného. Kdyby někdo v BlockEdit.tsx přepojil `serverDurationHours`
// zpátky na `currentDurationHours` (regrese, které se tenhle test má podle názvu
// týkat), na tomhle testu se to NEPROJEVÍ — nesahá na komponentu ani na lokální
// stav `type`, jen na čistou funkci s ručně sestavenými vstupy. Projekt nemá
// render testy, takže napojení efektu dnes neověřuje nic v repu.
test("resolveDurationSync: rovnost vstupů → vždy none (dokumentace sémantiky, NEhlídá napojení efektu v BlockEdit.tsx)", () => {
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
