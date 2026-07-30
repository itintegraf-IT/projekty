import test from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, getClientIp } from "./rateLimiter";

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/auth/login", { headers });
}

test("getClientIp: preferuje x-real-ip (nginx ho přepisuje)", () => {
  assert.equal(
    getClientIp(req({ "x-real-ip": "10.0.0.5", "x-forwarded-for": "1.2.3.4" })),
    "10.0.0.5"
  );
});

test("getClientIp: z x-forwarded-for bere POSLEDNÍ hodnotu (klient podvrhne první)", () => {
  // Útočník pošle "1.2.3.4", proxy připojí skutečnou adresu na konec.
  assert.equal(getClientIp(req({ "x-forwarded-for": "1.2.3.4, 192.168.10.20" })), "192.168.10.20");
  assert.equal(getClientIp(req({ "x-forwarded-for": "192.168.10.20" })), "192.168.10.20");
});

test("getClientIp: bez hlaviček → unknown", () => {
  assert.equal(getClientIp(req({})), "unknown");
  assert.equal(getClientIp(req({ "x-forwarded-for": "" })), "unknown");
  assert.equal(getClientIp(req({ "x-forwarded-for": " , " })), "unknown");
});

test("checkRateLimit: pustí max pokusů, pak blokuje s retryAfter", () => {
  const key = `test-${Math.round(Number(process.hrtime.bigint() % 1000000n))}`;
  for (let i = 0; i < 3; i++) {
    assert.equal(checkRateLimit("unit", key, 3, 60_000).allowed, true, `pokus ${i + 1}`);
  }
  const blocked = checkRateLimit("unit", key, 3, 60_000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 60);
});

test("checkRateLimit: jmenné prostory a klíče jsou nezávislé", () => {
  const a = `ns-a-${Math.round(Number(process.hrtime.bigint() % 1000000n))}`;
  assert.equal(checkRateLimit("nsA", a, 1, 60_000).allowed, true);
  assert.equal(checkRateLimit("nsA", a, 1, 60_000).allowed, false);
  // Stejný klíč v jiném limiteru má vlastní bucket.
  assert.equal(checkRateLimit("nsB", a, 1, 60_000).allowed, true);
});

test("checkRateLimit: po vypršení okna se počítadlo resetuje", () => {
  const key = `win-${Math.round(Number(process.hrtime.bigint() % 1000000n))}`;
  assert.equal(checkRateLimit("winNs", key, 1, 1).allowed, true);
  const start = Date.now();
  while (Date.now() - start < 5) { /* krátké okno 1 ms musí vypršet */ }
  assert.equal(checkRateLimit("winNs", key, 1, 1).allowed, true);
});
