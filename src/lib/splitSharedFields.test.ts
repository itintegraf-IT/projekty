import { test } from "node:test";
import assert from "node:assert/strict";
import { SPLIT_SHARED_FIELDS } from "./splitSharedFields";

test("SPLIT_SHARED_FIELDS: má přesně 29 položek (tripwire — nové sdílené pole se přidává vědomě)", () => {
  assert.equal(SPLIT_SHARED_FIELDS.length, 29);
  assert.equal(new Set(SPLIT_SHARED_FIELDS).size, 29, "duplicita v seznamu");
});

test("SPLIT_SHARED_FIELDS: nikdy neobsahuje startTime/endTime/machine", () => {
  // Split sourozenci se na serveru aktualizují přes updateMany, který NEprochází finální
  // pojistkou assertNoOverlapForBlocks — časové pole by tak otevřelo nehlídaný překryv.
  const forbidden = ["startTime", "endTime", "machine"];
  for (const f of forbidden) {
    assert.equal((SPLIT_SHARED_FIELDS as readonly string[]).includes(f), false, `${f} nesmí být sdílené pole`);
  }
});

test("SPLIT_SHARED_FIELDS: obsahuje materialIssued (regrese Fix round 2)", () => {
  // Klientská kopie tohohle seznamu dřív materialIssued postrádala (i expediceNote/doprava/
  // expeditionPublishedAt/expeditionSortOrder) — po sloučení do jednoho modulu už dvě kopie
  // k rozejití nejsou, ale tenhle test hlídá i kdyby se sem někdo v budoucnu vrátil.
  assert.equal((SPLIT_SHARED_FIELDS as readonly string[]).includes("materialIssued"), true);
});
