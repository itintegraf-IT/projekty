import { test } from "node:test";
import assert from "node:assert/strict";
import { countUnread, countNewSince, totalBadge } from "./notifications";

test("countUnread počítá jen nepřečtené", () => {
  assert.equal(countUnread([]), 0);
  assert.equal(countUnread([{ isRead: false }, { isRead: true }, { isRead: false }]), 2);
});

test("countUnread — vše přečtené = 0", () => {
  assert.equal(countUnread([{ isRead: true }, { isRead: true }]), 0);
});

test("countNewSince — bez lastSeen počítá vše", () => {
  const logs = [{ createdAt: "2026-07-03T10:00:00.000Z" }, { createdAt: "2026-07-03T11:00:00.000Z" }];
  assert.equal(countNewSince(logs, null), 2);
});

test("countNewSince — jen novější než lastSeen", () => {
  const logs = [
    { createdAt: "2026-07-03T09:00:00.000Z" },
    { createdAt: "2026-07-03T12:00:00.000Z" },
  ];
  assert.equal(countNewSince(logs, "2026-07-03T10:00:00.000Z"), 1);
});

test("countNewSince — nic novějšího = 0", () => {
  const logs = [{ createdAt: "2026-07-03T09:00:00.000Z" }];
  assert.equal(countNewSince(logs, "2026-07-03T10:00:00.000Z"), 0);
});

test("totalBadge = součet", () => {
  assert.equal(totalBadge(0, 0), 0);
  assert.equal(totalBadge(3, 2), 5);
});
