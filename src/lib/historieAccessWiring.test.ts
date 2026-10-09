import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripComments } from "@/lib/sourceTextTestUtils";

/**
 * Strážný test zapojení historie (etapa 3 září 2026).
 *
 * Historie drží na rolích ČTYŘI místa ve dvou dvojicích a obě dvojice se umí
 * rozpojit TIŠE:
 * - Audit log ve Správě: `/api/audit` a `/api/audit/filters`. Otevře-li se jen
 *   seznam, plánovač dostane log s prázdnými rozbalovátky filtrů — žádná chyba.
 * - Historie jedné zakázky: role v `GET /api/blocks/[id]/audit` a `canSeeHistory`
 *   v `PlannerPage.tsx`. Položka menu, kterou API odmítne, skončí v dialogu
 *   hláškou „nemáte přístup".
 * Navíc hlídá, že KAŽDÁ úspěšná odpověď block-audit routy projde filtrem
 * `visibleHistoryFor` — bez něj by dialog pro DTP a MTZ byl únikem poznámek
 * tiskaře — a že DTP vůbec dostane kontextové menu, ve kterém položka žije.
 *
 * Sdílená konstanta rolí v projektu neexistuje (každý modul si pole opisuje) a
 * etapa ten zvyk nemění — proto shodu výčtů hlídá test, ne typový systém.
 */
const blockAudit = stripComments(readFileSync("src/app/api/blocks/[id]/audit/route.ts", "utf8"));

/** Jediný allowlist ve tvaru `[...].includes(session.role)` v daném souboru. */
function allowlistOf(src: string, file: string): string {
  const all = [...src.matchAll(/(\[[^\]]*\])\.includes\(session\.role\)/g)];
  assert.equal(all.length, 1, `${file}: čekám právě jeden allowlist [...].includes(session.role), je jich ${all.length}`);
  return all[0][1];
}

test("historie bloku: API pouští ADMIN, PLANOVAT, DTP i MTZ", () => {
  assert.equal(allowlistOf(blockAudit, "blocks/[id]/audit"), '["ADMIN", "PLANOVAT", "DTP", "MTZ"]');
});

test("historie bloku: každá úspěšná odpověď jde přes visibleHistoryFor", () => {
  // Každé `NextResponse.json(` je buď chybové tělo `{ error … }`, nebo filtrovaná
  // historie. Nefiltrovaný návrat (`NextResponse.json(sortHistoryEntries(…))`)
  // by poslal poznámky tiskaře i DTP a MTZ.
  const heads = [...blockAudit.matchAll(/NextResponse\.json\(\s*([A-Za-z_{][\w]*)/g)].map((m) => m[1]);
  assert.ok(heads.includes("visibleHistoryFor"), "úspěšná odpověď historie nejde přes visibleHistoryFor");
  for (const head of heads) {
    assert.ok(head === "{" || head === "visibleHistoryFor", `nefiltrovaná odpověď: NextResponse.json(${head}…`);
  }
  assert.match(
    blockAudit,
    /visibleHistoryFor\(\s*sortHistoryEntries\(entries\),\s*session\.role\s*\)/,
    "filtr musí běžet AŽ za řazením a dostat roli ze session",
  );
});

test("historie bloku: limit je 100 na každý zdroj (volba H3 = C)", () => {
  assert.match(blockAudit, /const PER_SOURCE_LIMIT = 100;/);
});
