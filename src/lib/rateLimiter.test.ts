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

test("getClientIp: adresa smyčky v x-forwarded-for → unknown (Next.js ji doplní, když proxy IP neposlala)", () => {
  // Za nginxem bez X-Real-IP si Next.js doplní x-forwarded-for adresou socketu,
  // tedy nginxu na localhostu. Na produkci tak do 10. 10. 2026 vypadali všichni
  // uživatelé jako jeden klient a sdíleli přísný login limit (POUCENI P34).
  assert.equal(getClientIp(req({ "x-forwarded-for": "::ffff:127.0.0.1" })), "unknown");
  assert.equal(getClientIp(req({ "x-forwarded-for": "127.0.0.1" })), "unknown");
  assert.equal(getClientIp(req({ "x-forwarded-for": "::1" })), "unknown");
  assert.equal(getClientIp(req({ "x-forwarded-for": "1.2.3.4, 127.0.0.1" })), "unknown");
});

test("getClientIp: adresa smyčky i v x-real-ip → unknown", () => {
  assert.equal(getClientIp(req({ "x-real-ip": "127.0.0.1" })), "unknown");
  assert.equal(getClientIp(req({ "x-real-ip": "::ffff:127.0.0.2" })), "unknown");
});

test("getClientIp: skutečné adresy zůstávají beze změny, i ve tvaru ::ffff:", () => {
  assert.equal(getClientIp(req({ "x-forwarded-for": "::ffff:192.168.8.23" })), "::ffff:192.168.8.23");
  assert.equal(getClientIp(req({ "x-real-ip": "192.168.10.1" })), "192.168.10.1");
  // 127 rozhoduje jen jako první oktet, ne kdekoli v adrese
  assert.equal(getClientIp(req({ "x-forwarded-for": "10.127.0.1" })), "10.127.0.1");
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
