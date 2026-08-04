import assert from "node:assert/strict";
import test from "node:test";
import { findReservationSiblings } from "./reservationSiblings";

type B = { id: number; type: string; orderNumber: string; machine: string; reservationId?: number | null };

const mk = (id: number, over: Partial<B> = {}): B => ({
  id, type: "REZERVACE", orderNumber: "R123", machine: "XL_105", reservationId: null, ...over,
});

test("kopie na jiném stroji: sourozence spojuje jen shodné číslo rezervace", () => {
  // Ctrl+C/V kopie nikdy nenese reservationId (blockPayload.ts) — jediné pojítko
  // je orderNumber = kód rezervace.
  const anchor = mk(1, { reservationId: 7 });
  const copy = mk(2, { machine: "XL_106" });
  const found = findReservationSiblings(anchor, [anchor, copy]);
  assert.deepEqual(found.map((b) => b.id), [2]);
});

test("split část: spojuje shodné číslo, i když reservationId chybí", () => {
  const anchor = mk(1, { reservationId: 7 });
  const tail = mk(2); // split tail — reservationId se nekopíruje
  assert.deepEqual(findReservationSiblings(anchor, [anchor, tail]).map((b) => b.id), [2]);
});

test("spojuje i přes reservationId, když se čísla liší", () => {
  // Obranná větev: kdyby někdo orderNumber ručně přepsal, vazba na rezervaci drží.
  const anchor = mk(1, { reservationId: 7 });
  const other = mk(2, { orderNumber: "R999", reservationId: 7 });
  assert.deepEqual(findReservationSiblings(anchor, [anchor, other]).map((b) => b.id), [2]);
});

test("cizí zakázka se shodným číslem se nebere (filtr na typ)", () => {
  // Job Builder nevaliduje formát čísla — „R123" jde napsat i ručně jako zakázku.
  const anchor = mk(1, { reservationId: 7 });
  const fake = mk(2, { type: "ZAKAZKA" });
  assert.deepEqual(findReservationSiblings(anchor, [anchor, fake]), []);
});

test("cizí rezervace s jiným číslem se nebere", () => {
  const anchor = mk(1, { reservationId: 7 });
  const other = mk(2, { orderNumber: "R456", reservationId: 9 });
  assert.deepEqual(findReservationSiblings(anchor, [anchor, other]), []);
});

test("blok sám sebe nikdy nevrací", () => {
  const anchor = mk(1, { reservationId: 7 });
  assert.deepEqual(findReservationSiblings(anchor, [anchor]), []);
});

test("null reservationId na obou stranách nespojuje bloky s různým číslem", () => {
  // Bez tohoto by se null === null spojily všechny rezervace bez vazby.
  const anchor = mk(1, { orderNumber: "R123" });
  const other = mk(2, { orderNumber: "R456" });
  assert.deepEqual(findReservationSiblings(anchor, [anchor, other]), []);
});

test("najde víc sourozenců naráz a zachová pořadí vstupu", () => {
  const anchor = mk(1, { reservationId: 7 });
  const all = [anchor, mk(2, { machine: "XL_106" }), mk(3, { reservationId: 7, orderNumber: "R123" })];
  assert.deepEqual(findReservationSiblings(anchor, all).map((b) => b.id), [2, 3]);
});

test("prázdný seznam bloků nevrací nic", () => {
  assert.deepEqual(findReservationSiblings(mk(1), []), []);
});
