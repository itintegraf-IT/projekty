import { test } from "node:test";
import assert from "node:assert";
import {
  canEditBlockNote,
  canCreateBlockNote,
  canAccessBlockNotes,
  NOTE_EDIT_WINDOW_MS,
  MAX_NOTE_LENGTH,
} from "./blockNotePermissions";

const now = new Date("2026-04-30T10:00:00Z");
const fresh = new Date(now.getTime() - 5 * 60 * 1000);
const stale = new Date(now.getTime() - 60 * 60 * 1000);

const ownNoteFresh = { id: 1, blockId: 10, createdByUserId: 7, createdAt: fresh, machine: "XL_105" };
const ownNoteStale = { ...ownNoteFresh, createdAt: stale };
const otherUsersNote = { ...ownNoteFresh, createdByUserId: 99 };

test("canEditBlockNote: ADMIN edituje cokoliv", () => {
  assert.strictEqual(
    canEditBlockNote(otherUsersNote, { role: "ADMIN", id: 1, assignedMachine: null }, now),
    true,
  );
});

test("canEditBlockNote: PLANOVAT edituje cokoliv (i staré)", () => {
  assert.strictEqual(
    canEditBlockNote(ownNoteStale, { role: "PLANOVAT", id: 1, assignedMachine: null }, now),
    true,
  );
});

test("canEditBlockNote: TISKAR edituje vlastní do 30 min na svém stroji", () => {
  assert.strictEqual(
    canEditBlockNote(ownNoteFresh, { role: "TISKAR", id: 7, assignedMachine: "XL_105" }, now),
    true,
  );
});

test("canEditBlockNote: TISKAR needituje vlastní starou (>30 min)", () => {
  assert.strictEqual(
    canEditBlockNote(ownNoteStale, { role: "TISKAR", id: 7, assignedMachine: "XL_105" }, now),
    false,
  );
});

test("canEditBlockNote: TISKAR needituje cizí poznámku", () => {
  assert.strictEqual(
    canEditBlockNote(otherUsersNote, { role: "TISKAR", id: 7, assignedMachine: "XL_105" }, now),
    false,
  );
});

test("canEditBlockNote: TISKAR needituje na cizím stroji", () => {
  assert.strictEqual(
    canEditBlockNote(ownNoteFresh, { role: "TISKAR", id: 7, assignedMachine: "XL_106" }, now),
    false,
  );
});

test("canEditBlockNote: DTP/MTZ/OBCHODNIK/VIEWER needituje", () => {
  for (const role of ["DTP", "MTZ", "OBCHODNIK", "VIEWER"] as const) {
    assert.strictEqual(
      canEditBlockNote(ownNoteFresh, { role, id: 7, assignedMachine: "XL_105" }, now),
      false,
      `role ${role} musí mít zakázáno`,
    );
  }
});

test("canCreateBlockNote: TISKAR jen na svém stroji", () => {
  assert.strictEqual(
    canCreateBlockNote({ role: "TISKAR", id: 1, assignedMachine: "XL_105" }, "XL_105"),
    true,
  );
  assert.strictEqual(
    canCreateBlockNote({ role: "TISKAR", id: 1, assignedMachine: "XL_105" }, "XL_106"),
    false,
  );
});

test("canCreateBlockNote: ADMIN/PLANOVAT všude", () => {
  assert.strictEqual(canCreateBlockNote({ role: "ADMIN", id: 1, assignedMachine: null }, "XL_106"), true);
  assert.strictEqual(canCreateBlockNote({ role: "PLANOVAT", id: 1, assignedMachine: null }, "XL_106"), true);
});

test("canCreateBlockNote: ostatní role zakázané", () => {
  for (const role of ["DTP", "MTZ", "OBCHODNIK", "VIEWER"] as const) {
    assert.strictEqual(
      canCreateBlockNote({ role, id: 1, assignedMachine: "XL_105" }, "XL_105"),
      false,
    );
  }
});

test("canAccessBlockNotes: jen ADMIN/PLANOVAT/TISKAR", () => {
  assert.strictEqual(canAccessBlockNotes("ADMIN"), true);
  assert.strictEqual(canAccessBlockNotes("PLANOVAT"), true);
  assert.strictEqual(canAccessBlockNotes("TISKAR"), true);
  for (const role of ["DTP", "MTZ", "OBCHODNIK", "VIEWER"] as const) {
    assert.strictEqual(canAccessBlockNotes(role), false);
  }
});

test("Konstanty", () => {
  assert.strictEqual(NOTE_EDIT_WINDOW_MS, 30 * 60 * 1000);
  assert.strictEqual(MAX_NOTE_LENGTH, 500);
});
