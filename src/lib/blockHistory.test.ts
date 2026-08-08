import { test } from "node:test";
import assert from "node:assert/strict";
import { suppressCoveredColumns } from "./blockHistory";

test("sloupec pokrytý auditem se z revize odečte", () => {
  const out = suppressCoveredColumns(
    { deadlineExpedice: null, endTime: new Date("2026-08-08T14:00:00Z") },
    { deadlineExpedice: new Date("2026-08-12T00:00:00Z"), endTime: new Date("2026-08-08T18:00:00Z") },
    [{ action: "UPDATE", field: "deadlineExpedice", newValue: "2026-08-12" }],
  );
  assert.ok(out);
  assert.deepEqual(Object.keys(out.after), ["endTime"], "poziční změna zůstává viditelná");
});

test("když audit pokryje všechno, revize zmizí", () => {
  const out = suppressCoveredColumns(
    { deadlineExpedice: null },
    { deadlineExpedice: new Date("2026-08-12T00:00:00Z") },
    [{ action: "UPDATE", field: "deadlineExpedice", newValue: "2026-08-12" }],
  );
  assert.equal(out, null);
});

test("CREATE pokrývá celý řádek", () => {
  const out = suppressCoveredColumns({ machine: "XL_105" }, { machine: "XL_106" }, [
    { action: "CREATE", field: null, newValue: null },
  ]);
  assert.equal(out, null);
});

test("bez auditních řádků zůstane revize celá", () => {
  const out = suppressCoveredColumns({ machine: "XL_105" }, { machine: "XL_106" }, []);
  assert.ok(out);
  assert.deepEqual(Object.keys(out.after), ["machine"]);
});

test("AUTO_SHIFT potlačí obě poloviny posunu", () => {
  const out = suppressCoveredColumns(
    { startTime: new Date("2026-08-08T06:00:00Z"), endTime: new Date("2026-08-08T14:00:00Z") },
    { startTime: new Date("2026-08-09T06:00:00Z"), endTime: new Date("2026-08-09T14:00:00Z") },
    [{ action: "AUTO_SHIFT", field: "startTime/endTime", newValue: "2026-08-09T06:00:00.000Z" }],
  );
  assert.equal(out, null);
});

/**
 * Kvůli TOMUHLE tvaru je třetí parametr celý auditní řádek včetně `newValue`,
 * ne jen dvojice (action, field): undo/redo píše seznam vrácených sloupců do
 * `newValue`, `field` nese jen marker "fields". Bez `newValue` by mapa pokrytí
 * vrátila prázdno a panel by tytéž změny vykreslil dvakrát.
 */
test("undo obchodních polí potlačí sloupce vyjmenované v newValue", () => {
  const out = suppressCoveredColumns(
    { dataOk: false, materialNote: null },
    { dataOk: true, materialNote: "dorazí v pátek" },
    [{ action: "UNDO", field: "fields", newValue: "dataOk, materialNote" }],
  );
  assert.equal(out, null);
});

/**
 * Poziční undo řádek jmenuje `machine` ve `field`, ale do hodnot zapisuje POUZE
 * časový span — stroj v něm čtenář nevidí. Revize je tedy jediné místo, kde je
 * změna stroje zaznamenaná, a potlačit se nesmí (Task 10, fix 375f5a2d).
 */
test("poziční undo nepotlačí stroj — jinak by změna stroje zmizela z historie", () => {
  const out = suppressCoveredColumns(
    { machine: "XL_106", startTime: new Date("2026-08-09T06:00:00Z"), endTime: new Date("2026-08-09T14:00:00Z") },
    { machine: "XL_105", startTime: new Date("2026-08-08T06:00:00Z"), endTime: new Date("2026-08-08T14:00:00Z") },
    [{ action: "UNDO", field: "startTime/endTime/machine", newValue: "2026-08-08T06:00…–14:00" }],
  );
  assert.ok(out);
  assert.deepEqual(Object.keys(out.after), ["machine"]);
});

/** Klíč, který v „před" chybí (Json bez hodnoty), musí vyjít jako null, ne undefined. */
test("chybějící hodnota v před se doplní na null", () => {
  const out = suppressCoveredColumns({}, { description: "Katalog léto" }, []);
  assert.ok(out);
  assert.equal(out.before.description, null);
  assert.equal(out.after.description, "Katalog léto");
});
