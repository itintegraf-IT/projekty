import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCookieSecure } from "./cookieSecurity.ts";

test("explicitní COOKIE_SECURE=true vyhrává nad vším", () => {
  assert.equal(
    resolveCookieSecure({ explicit: "true", forwardedProto: "http", nodeEnv: "development" }),
    true
  );
});

test("explicitní COOKIE_SECURE=false vyhrává i v produkci (HTTP nasazení na LAN)", () => {
  assert.equal(
    resolveCookieSecure({ explicit: "false", forwardedProto: null, nodeEnv: "production" }),
    false
  );
});

test("bez explicitního nastavení se odvodí z X-Forwarded-Proto: https → secure", () => {
  assert.equal(
    resolveCookieSecure({ explicit: undefined, forwardedProto: "https", nodeEnv: "production" }),
    true
  );
});

test("bez explicitního nastavení: http → NEsecure (jinak by se cookie zahodila)", () => {
  assert.equal(
    resolveCookieSecure({ explicit: undefined, forwardedProto: "http", nodeEnv: "production" }),
    false
  );
});

test("X-Forwarded-Proto se seznamem hodnot bere první", () => {
  assert.equal(
    resolveCookieSecure({ explicit: undefined, forwardedProto: "https, http", nodeEnv: "production" }),
    true
  );
  assert.equal(
    resolveCookieSecure({ explicit: undefined, forwardedProto: "http,https", nodeEnv: "production" }),
    false
  );
});

test("X-Forwarded-Proto je case-insensitive a toleruje mezery", () => {
  assert.equal(
    resolveCookieSecure({ explicit: undefined, forwardedProto: "  HTTPS  ", nodeEnv: "production" }),
    true
  );
});

test("bez hlavičky i bez ENV: produkce zůstává secure (bezpečný default)", () => {
  assert.equal(
    resolveCookieSecure({ explicit: undefined, forwardedProto: null, nodeEnv: "production" }),
    true
  );
});

test("bez hlavičky i bez ENV: dev je nesecure (localhost po HTTP)", () => {
  assert.equal(
    resolveCookieSecure({ explicit: undefined, forwardedProto: null, nodeEnv: "development" }),
    false
  );
});

test("neznámá hodnota COOKIE_SECURE se ignoruje, spadne se na odvození", () => {
  assert.equal(
    resolveCookieSecure({ explicit: "yes-please", forwardedProto: "https", nodeEnv: "production" }),
    true
  );
  assert.equal(
    resolveCookieSecure({ explicit: "", forwardedProto: "http", nodeEnv: "production" }),
    false
  );
});
