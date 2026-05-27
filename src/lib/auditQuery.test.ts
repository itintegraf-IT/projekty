import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIT_LIMIT_DEFAULT,
  AUDIT_LIMIT_MAX,
  buildAuditWhere,
  parseAuditFilters,
} from "./auditQuery";

function sp(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

test("parseAuditFilters — prázdné query vrátí defaulty", () => {
  const f = parseAuditFilters(sp(""));
  assert.equal(f.limit, AUDIT_LIMIT_DEFAULT);
  assert.equal(f.cursor, undefined);
  assert.deepEqual(f.usernames, []);
  assert.deepEqual(f.actions, []);
  assert.equal(f.dateFrom, undefined);
  assert.equal(f.dateTo, undefined);
  assert.equal(f.q, undefined);
});

test("parseAuditFilters — limit cap na AUDIT_LIMIT_MAX", () => {
  const f = parseAuditFilters(sp("limit=99999"));
  assert.equal(f.limit, AUDIT_LIMIT_MAX);
});

test("parseAuditFilters — neplatný limit padá zpět na default", () => {
  assert.equal(parseAuditFilters(sp("limit=abc")).limit, AUDIT_LIMIT_DEFAULT);
  assert.equal(parseAuditFilters(sp("limit=-5")).limit, AUDIT_LIMIT_DEFAULT);
  // parseInt prefix attack — "50abc" by neměl projít striktním regex
  assert.equal(parseAuditFilters(sp("limit=50abc")).limit, AUDIT_LIMIT_DEFAULT);
  assert.equal(parseAuditFilters(sp("limit=12.5")).limit, AUDIT_LIMIT_DEFAULT);
});

test("parseAuditFilters — cursor jen numerický", () => {
  assert.equal(parseAuditFilters(sp("cursor=123")).cursor, 123);
  assert.equal(parseAuditFilters(sp("cursor=abc")).cursor, undefined);
  assert.equal(parseAuditFilters(sp("cursor=12.5")).cursor, undefined);
  assert.equal(parseAuditFilters(sp("cursor=-1")).cursor, undefined);
});

test("parseAuditFilters — multi-username s deduplikací", () => {
  const f = parseAuditFilters(sp("username=alice&username=bob&username=alice&username="));
  assert.deepEqual(f.usernames.sort(), ["alice", "bob"]);
});

test("parseAuditFilters — multi-action", () => {
  const f = parseAuditFilters(sp("action=UPDATE&action=DELETE"));
  assert.deepEqual(f.actions.sort(), ["DELETE", "UPDATE"]);
});

test("parseAuditFilters — dateFrom / dateTo validace formátu", () => {
  const ok = parseAuditFilters(sp("dateFrom=2026-05-01&dateTo=2026-05-27"));
  assert.equal(ok.dateFrom, "2026-05-01");
  assert.equal(ok.dateTo, "2026-05-27");

  const bad = parseAuditFilters(sp("dateFrom=2026-5-1&dateTo=not-a-date"));
  assert.equal(bad.dateFrom, undefined);
  assert.equal(bad.dateTo, undefined);
});

test("parseAuditFilters — striktní datum odmítá neexistující den", () => {
  // 2026-13-45 matchne regex, ale není reálné datum → odmítnout
  assert.equal(parseAuditFilters(sp("dateFrom=2026-13-01")).dateFrom, undefined);
  assert.equal(parseAuditFilters(sp("dateFrom=2026-02-30")).dateFrom, undefined);
  assert.equal(parseAuditFilters(sp("dateFrom=2026-00-15")).dateFrom, undefined);
  // 29. únor přestupný rok OK
  assert.equal(parseAuditFilters(sp("dateFrom=2024-02-29")).dateFrom, "2024-02-29");
});

test("parseAuditFilters — q trim + min/max length", () => {
  const f = parseAuditFilters(sp("q=%20%20ZA12345%20%20"));
  assert.equal(f.q, "ZA12345");

  // Příliš krátké → undefined (min 2 znaky)
  assert.equal(parseAuditFilters(sp("q=a")).q, undefined);
  assert.equal(parseAuditFilters(sp("q=")).q, undefined);
  // 2 znaky OK
  assert.equal(parseAuditFilters(sp("q=ab")).q, "ab");

  const long = "a".repeat(200);
  const f2 = parseAuditFilters(new URLSearchParams({ q: long }));
  assert.equal((f2.q ?? "").length, 100);
});

test("buildAuditWhere — prázdné filtry → prázdný where", () => {
  const where = buildAuditWhere({ limit: 50, usernames: [], actions: [] });
  assert.deepEqual(where, {});
});

test("buildAuditWhere — single username → equality", () => {
  const where = buildAuditWhere({ limit: 50, usernames: ["alice"], actions: [] });
  assert.equal(where.username, "alice");
});

test("buildAuditWhere — multi username → in clause", () => {
  const where = buildAuditWhere({ limit: 50, usernames: ["alice", "bob"], actions: [] });
  assert.deepEqual(where.username, { in: ["alice", "bob"] });
});

test("buildAuditWhere — dateFrom/dateTo vytvoří createdAt range s inkluzivním koncem", () => {
  const where = buildAuditWhere({
    limit: 50,
    usernames: [],
    actions: [],
    dateFrom: "2026-05-01",
    dateTo: "2026-05-01",
  });
  const range = where.createdAt as { gte?: Date; lt?: Date };
  assert.ok(range.gte instanceof Date);
  assert.ok(range.lt instanceof Date);
  // 24h rozdíl (mimo DST hranice) — testujeme jen že lt > gte a < 26h
  const diffMs = (range.lt as Date).getTime() - (range.gte as Date).getTime();
  assert.ok(diffMs >= 23 * 3600 * 1000 && diffMs <= 25 * 3600 * 1000);
});

test("buildAuditWhere — pouze dateFrom → jen gte", () => {
  const where = buildAuditWhere({
    limit: 50,
    usernames: [],
    actions: [],
    dateFrom: "2026-05-01",
  });
  const range = where.createdAt as { gte?: Date; lt?: Date };
  assert.ok(range.gte instanceof Date);
  assert.equal(range.lt, undefined);
});

test("buildAuditWhere — q jako číslo → orderNumber contains + blockId equals", () => {
  const where = buildAuditWhere({
    limit: 50,
    usernames: [],
    actions: [],
    q: "12345",
  });
  assert.ok(Array.isArray(where.OR));
  assert.equal(where.OR?.length, 2);
  assert.deepEqual(where.OR?.[0], { orderNumber: { contains: "12345" } });
  assert.deepEqual(where.OR?.[1], { blockId: 12345 });
});

test("buildAuditWhere — q jako text → jen orderNumber contains", () => {
  const where = buildAuditWhere({
    limit: 50,
    usernames: [],
    actions: [],
    q: "ZA12",
  });
  assert.equal(where.OR?.length, 1);
  assert.deepEqual(where.OR?.[0], { orderNumber: { contains: "ZA12" } });
});

test("buildAuditWhere — q escape LIKE wildcardů (% _ \\)", () => {
  const where = buildAuditWhere({
    limit: 50,
    usernames: [],
    actions: [],
    q: "50%_x\\y",
  });
  // % a _ a \ musí být escapované backslashem v contains hodnotě
  assert.deepEqual(where.OR?.[0], { orderNumber: { contains: "50\\%\\_x\\\\y" } });
});
