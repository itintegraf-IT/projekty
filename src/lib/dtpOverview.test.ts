import test from "node:test";
import assert from "node:assert/strict";
import {
  isInDtpDefaultList,
  selectDtpOverviewBlocks,
  type DtpOverviewBlock,
} from "./dtpOverview";

// Pevné „teď" — 12. 8. 2026, 11:00 pražského času (09:00 UTC, letní čas).
const NOW = new Date("2026-08-12T09:00:00.000Z");

function mkBlock(over: Partial<DtpOverviewBlock> & { id?: number } = {}): DtpOverviewBlock & { id: number } {
  return {
    id: 1,
    orderNumber: "25-1234",
    description: "Katalog jaro 2026",
    specifikace: null,
    jobPresetLabel: null,
    type: "ZAKAZKA",
    startTime: "2026-08-12T12:00:00.000Z",
    endTime: "2026-08-12T16:00:00.000Z",
    dataOk: true,
    dataStatusId: null,
    ...over,
  };
}

// ── isInDtpDefaultList — přesně dnešní podmínka panelu ──────────────────────

test("isInDtpDefaultList: běžící zakázka v nejbližších dnech patří do přehledu", () => {
  assert.equal(isInDtpDefaultList(mkBlock(), NOW), true);
});

test("isInDtpDefaultList: zakázka, která už skončila, do přehledu nepatří", () => {
  const b = mkBlock({ startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T14:00:00.000Z" });
  assert.equal(isInDtpDefaultList(b, NOW), false);
});

test("isInDtpDefaultList: PRÁVĚ BĚŽÍCÍ zakázka patří do přehledu", () => {
  // Start v minulosti, konec v budoucnosti — noční směna rozjetá přes půlnoc.
  // Guard je `endTime < now`; kdyby se spletl na `startTime`, tenhle blok by
  // z přehledu vypadl právě ve chvíli, kdy na něm DTP nejvíc záleží.
  const b = mkBlock({ startTime: "2026-08-12T04:00:00.000Z", endTime: "2026-08-12T12:00:00.000Z" });
  assert.equal(isInDtpDefaultList(b, NOW), true);
});

test("isInDtpDefaultList: poslední den horizontu ještě patří, první den za ním už ne", () => {
  // NOW je 12. 8. pražského času, DTP_HORIZON_DAYS = 30 → hranice je 11. 9.
  // Bez obou stran by prošla i změna konstanty nebo `<=` na `<`.
  const posledni = mkBlock({ startTime: "2026-09-11T06:00:00.000Z", endTime: "2026-09-11T14:00:00.000Z" });
  const prvniZa  = mkBlock({ startTime: "2026-09-12T06:00:00.000Z", endTime: "2026-09-12T14:00:00.000Z" });
  assert.equal(isInDtpDefaultList(posledni, NOW), true);
  assert.equal(isInDtpDefaultList(prvniZa, NOW), false);
});

test("isInDtpDefaultList: zakázka za horizontem 30 dnů do přehledu nepatří", () => {
  const b = mkBlock({ startTime: "2026-09-26T06:00:00.000Z", endTime: "2026-09-26T14:00:00.000Z" });
  assert.equal(isInDtpDefaultList(b, NOW), false);
});

test("isInDtpDefaultList: zakázka za horizontem BEZ hotových dat do přehledu patří", () => {
  const b = mkBlock({
    startTime: "2026-09-26T06:00:00.000Z",
    endTime: "2026-09-26T14:00:00.000Z",
    dataOk: false,
  });
  assert.equal(isInDtpDefaultList(b, NOW), true);
});

test("isInDtpDefaultList: rezervace ani údržba do přehledu nepatří", () => {
  assert.equal(isInDtpDefaultList(mkBlock({ type: "REZERVACE" }), NOW), false);
  assert.equal(isInDtpDefaultList(mkBlock({ type: "UDRZBA" }), NOW), false);
});

// ── selectDtpOverviewBlocks — bez dotazu = dnešní chování ───────────────────

test("bez dotazu vrátí jen zakázky z běžného okna přehledu", () => {
  const bezi = mkBlock({ id: 1 });
  const skoncila = mkBlock({ id: 2, startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T14:00:00.000Z" });
  const daleko = mkBlock({ id: 3, startTime: "2026-09-26T06:00:00.000Z", endTime: "2026-09-26T14:00:00.000Z" });
  const rezervace = mkBlock({ id: 4, type: "REZERVACE" });

  const { list: out } = selectDtpOverviewBlocks({
    blocks: [bezi, skoncila, daleko, rezervace],
    query: "",
    statusFilter: "all",
    now: NOW,
  });
  assert.deepEqual(out.map((b) => b.id), [1]);
});

test("bez dotazu řadí vzestupně podle začátku", () => {
  const pozdeji = mkBlock({ id: 1, startTime: "2026-08-20T06:00:00.000Z", endTime: "2026-08-20T14:00:00.000Z" });
  const driv = mkBlock({ id: 2, startTime: "2026-08-14T06:00:00.000Z", endTime: "2026-08-14T14:00:00.000Z" });

  const { list: out } = selectDtpOverviewBlocks({ blocks: [pozdeji, driv], query: "", statusFilter: "all", now: NOW });
  assert.deepEqual(out.map((b) => b.id), [2, 1]);
});

// ── selectDtpOverviewBlocks — s dotazem sahá i mimo okno ────────────────────

test("s dotazem najde i zakázku, která už skončila", () => {
  const skoncila = mkBlock({
    id: 7, orderNumber: "25-9999",
    startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T14:00:00.000Z",
  });
  const { list: out } = selectDtpOverviewBlocks({ blocks: [skoncila], query: "9999", statusFilter: "all", now: NOW });
  assert.deepEqual(out.map((b) => b.id), [7]);
});

test("s dotazem najde i zakázku za horizontem 30 dnů", () => {
  const daleko = mkBlock({
    id: 8, orderNumber: "25-8888",
    startTime: "2026-09-26T06:00:00.000Z", endTime: "2026-09-26T14:00:00.000Z",
  });
  const { list: out } = selectDtpOverviewBlocks({ blocks: [daleko], query: "8888", statusFilter: "all", now: NOW });
  assert.deepEqual(out.map((b) => b.id), [8]);
});

test("s dotazem nikdy nevrátí rezervaci ani údržbu", () => {
  const rezervace = mkBlock({ id: 9, orderNumber: "25-7777", type: "REZERVACE" });
  const udrzba = mkBlock({ id: 10, orderNumber: "25-7777", type: "UDRZBA" });
  const { list: out } = selectDtpOverviewBlocks({
    blocks: [rezervace, udrzba], query: "7777", statusFilter: "all", now: NOW,
  });
  assert.deepEqual(out.map((b) => b.id), []);
});

test("dotaz bez shody vrátí prázdný seznam, i když je co zobrazit", () => {
  const { list: out } = selectDtpOverviewBlocks({ blocks: [mkBlock()], query: "nenajdeš", statusFilter: "all", now: NOW });
  assert.deepEqual(out.map((b) => b.id), []);
});

// ── kombinace se statusovým filtrem ─────────────────────────────────────────

test("statusový filtr se s dotazem kombinuje (musí platit obojí)", () => {
  const prijato = mkBlock({ id: 1, orderNumber: "25-1111", dataStatusId: 5 });
  const jinyStatus = mkBlock({ id: 2, orderNumber: "25-1111", dataStatusId: 6 });

  const { list: out } = selectDtpOverviewBlocks({
    blocks: [prijato, jinyStatus], query: "1111", statusFilter: 5, now: NOW,
  });
  assert.deepEqual(out.map((b) => b.id), [1]);
});

// ── řazení výsledků hledání ─────────────────────────────────────────────────

test("s dotazem jdou zakázky z běžné fronty nahoru, až pod ně ty mimo přehled", () => {
  const skoncila = mkBlock({
    id: 1, orderNumber: "25-0001",
    startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T14:00:00.000Z",
  });
  const bezi = mkBlock({
    id: 2, orderNumber: "25-0002",
    startTime: "2026-08-20T06:00:00.000Z", endTime: "2026-08-20T14:00:00.000Z",
  });

  const { list: out } = selectDtpOverviewBlocks({ blocks: [skoncila, bezi], query: "25-000", statusFilter: "all", now: NOW });
  assert.deepEqual(out.map((b) => b.id), [2, 1]);
});

test("mezi zakázkami mimo přehled je nejčerstvější nahoře", () => {
  const stara = mkBlock({
    id: 1, orderNumber: "25-0001",
    startTime: "2026-07-01T06:00:00.000Z", endTime: "2026-07-01T14:00:00.000Z",
  });
  const cerstva = mkBlock({
    id: 2, orderNumber: "25-0002",
    startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T14:00:00.000Z",
  });

  const { list: out } = selectDtpOverviewBlocks({ blocks: [stara, cerstva], query: "25-000", statusFilter: "all", now: NOW });
  assert.deepEqual(out.map((b) => b.id), [2, 1]);
});

test("s dotazem se řadí obě skupiny naráz: živé vzestupně, mimo přehled sestupně", () => {
  // Se dvěma prvky v každé skupině — s jedním by prošlo i obrácené řazení uvnitř
  // živé fronty, což je přitom hlavní pointa toho rozdělení.
  const zivaPozdeji = mkBlock({ id: 1, orderNumber: "25-0001", startTime: "2026-08-25T06:00:00.000Z", endTime: "2026-08-25T14:00:00.000Z" });
  const zivaDriv    = mkBlock({ id: 2, orderNumber: "25-0002", startTime: "2026-08-14T06:00:00.000Z", endTime: "2026-08-14T14:00:00.000Z" });
  const staraDavno  = mkBlock({ id: 3, orderNumber: "25-0003", startTime: "2026-07-01T06:00:00.000Z", endTime: "2026-07-01T14:00:00.000Z" });
  const staraNedavno = mkBlock({ id: 4, orderNumber: "25-0004", startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T14:00:00.000Z" });

  const { list: out } = selectDtpOverviewBlocks({
    blocks: [staraDavno, zivaPozdeji, staraNedavno, zivaDriv],
    query: "25-000", statusFilter: "all", now: NOW,
  });
  assert.deepEqual(out.map((b) => b.id), [2, 1, 4, 3]);
});

test("outsideIds obsahuje právě zakázky mimo běžnou frontu", () => {
  // Panel z toho kreslí štítek „mimo přehled". Dřív si to dopočítával sám druhým
  // průchodem; teď to musí sedět s tím, jak výběr sám rozdělil live/outside.
  const ziva = mkBlock({ id: 1, orderNumber: "25-0001" });
  const skoncila = mkBlock({
    id: 2, orderNumber: "25-0002",
    startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T14:00:00.000Z",
  });

  const { outsideIds } = selectDtpOverviewBlocks({
    blocks: [ziva, skoncila], query: "25-000", statusFilter: "all", now: NOW,
  });
  assert.deepEqual([...outsideIds], [2]);
});

test("bez dotazu je outsideIds prázdná — všechno je z definice uvnitř přehledu", () => {
  const { outsideIds } = selectDtpOverviewBlocks({
    blocks: [mkBlock()], query: "", statusFilter: "all", now: NOW,
  });
  assert.equal(outsideIds.size, 0);
});

test("hledá i podle popisu, nejen podle čísla zakázky", () => {
  // Bez tohohle by zúžení DTP hledání jen na `orderNumber` prošlo celou suitou.
  const b = mkBlock({ id: 1, orderNumber: "25-1234", description: "Vánoční katalog" });
  const { list: out } = selectDtpOverviewBlocks({ blocks: [b], query: "vánoční", statusFilter: "all", now: NOW });
  assert.deepEqual(out.map((x) => x.id), [1]);
});

test("filtr „bez statusu“ vrátí jen zakázky bez přiřazeného DATA statusu", () => {
  const bez = mkBlock({ id: 1, dataStatusId: null });
  const se = mkBlock({ id: 2, dataStatusId: 5 });

  const { list: out } = selectDtpOverviewBlocks({ blocks: [bez, se], query: "", statusFilter: "none", now: NOW });
  assert.deepEqual(out.map((b) => b.id), [1]);
});
