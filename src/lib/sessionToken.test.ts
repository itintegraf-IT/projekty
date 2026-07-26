import { test } from "node:test";
import assert from "node:assert/strict";

// JWT_SECRET musí být před importem modulu (auth vyžaduje env).
process.env.JWT_SECRET = "test-secret-aspon-32-znaku-1234567890";

test("signSessionToken: default ~7 dní", async () => {
  const { signSessionToken } = await import("./sessionToken.ts");
  const { decodeJwt } = await import("jose");
  const token = await signSessionToken({ id: 1, username: "a", role: "TISKAR", assignedMachine: null });
  const { iat, exp } = decodeJwt(token);
  assert.ok(iat && exp, "token má iat i exp");
  const days = (exp! - iat!) / 86400;
  assert.ok(Math.abs(days - 7) < 0.1, `čekáno ~7 dní, dostal ${days}`);
});

test("signSessionToken: 365d ~365 dní", async () => {
  const { signSessionToken } = await import("./sessionToken.ts");
  const { decodeJwt } = await import("jose");
  const token = await signSessionToken(
    { id: 1, username: "a", role: "TISKAR", assignedMachine: null },
    "365d"
  );
  const { iat, exp } = decodeJwt(token);
  const days = (exp! - iat!) / 86400;
  assert.ok(Math.abs(days - 365) < 0.5, `čekáno ~365 dní, dostal ${days}`);
});
