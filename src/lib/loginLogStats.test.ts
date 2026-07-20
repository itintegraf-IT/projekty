import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLoginOverview } from "./loginLogStats";

const bounds = {
  todayStart: new Date("2026-07-20T00:00:00.000Z"),
  weekStart: new Date("2026-07-14T00:00:00.000Z"),
  d7Start: new Date("2026-07-14T00:00:00.000Z"),
};

test("buildLoginOverview: souhrn počítá dnes/týden/aktivní/neúspěchy", () => {
  const logs = [
    { userId: 1, username: "vojta", success: true, createdAt: new Date("2026-07-20T08:00:00Z") },
    { userId: 1, username: "vojta", success: true, createdAt: new Date("2026-07-15T08:00:00Z") },
    { userId: 2, username: "pepa", success: true, createdAt: new Date("2026-07-16T08:00:00Z") },
    { userId: 2, username: "pepa", success: false, createdAt: new Date("2026-07-17T08:00:00Z") },
    { userId: null, username: "hacker", success: false, createdAt: new Date("2026-07-18T08:00:00Z") },
  ];
  const users = [
    { id: 1, username: "vojta", role: "ADMIN" },
    { id: 2, username: "pepa", role: "ADMIN" },
    { id: 3, username: "nahled", role: "VIEWER" },
  ];
  const o = buildLoginOverview(logs, users, bounds);
  assert.equal(o.summary.loginsToday, 1);       // jen vojta dnes
  assert.equal(o.summary.loginsWeek, 3);        // 3 úspěšná od 14.7.
  assert.equal(o.summary.activeUsersWeek, 2);   // vojta + pepa
  assert.equal(o.summary.failed7d, 2);          // pepa + hacker
  assert.equal(o.summary.neverLoggedIn, 1);     // nahled
});

test("buildLoginOverview: per-user statistiky, řazení podle počtu", () => {
  const logs = [
    { userId: 1, username: "vojta", success: true, createdAt: new Date("2026-07-20T08:00:00Z") },
    { userId: 1, username: "vojta", success: true, createdAt: new Date("2026-07-19T08:00:00Z") },
    { userId: 2, username: "pepa", success: true, createdAt: new Date("2026-07-18T08:00:00Z") },
    { userId: 2, username: "pepa", success: false, createdAt: new Date("2026-07-18T09:00:00Z") },
  ];
  const users = [
    { id: 2, username: "pepa", role: "ADMIN" },
    { id: 1, username: "vojta", role: "ADMIN" },
  ];
  const o = buildLoginOverview(logs, users, bounds);
  assert.deepEqual(o.users.map((u) => u.username), ["vojta", "pepa"]); // vojta 2 > pepa 1
  const vojta = o.users[0];
  assert.equal(vojta.count30d, 2);
  assert.equal(vojta.failed30d, 0);
  assert.equal(vojta.lastLoginAt, new Date("2026-07-20T08:00:00Z").toISOString());
  const pepa = o.users[1];
  assert.equal(pepa.count30d, 1);
  assert.equal(pepa.failed30d, 1);
});

test("buildLoginOverview: uživatel bez přihlášení má 0 a lastLoginAt=null", () => {
  const users = [{ id: 3, username: "nahled", role: "VIEWER" }];
  const o = buildLoginOverview([], users, bounds);
  assert.equal(o.users[0].count30d, 0);
  assert.equal(o.users[0].lastLoginAt, null);
  assert.equal(o.summary.neverLoggedIn, 1);
});
