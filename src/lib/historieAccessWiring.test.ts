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

// ─── Audit log ve Správě (volba H1 = A) ──────────────────────────────────────

const auditList = stripComments(readFileSync("src/app/api/audit/route.ts", "utf8"));
const auditFacets = stripComments(readFileSync("src/app/api/audit/filters/route.ts", "utf8"));
const adminDashboard = stripComments(readFileSync("src/app/admin/_components/AdminDashboard.tsx", "utf8"));

test("audit log: seznam i fasety pouštějí ADMIN i PLANOVAT, shodným výčtem", () => {
  const list = allowlistOf(auditList, "api/audit");
  const facets = allowlistOf(auditFacets, "api/audit/filters");
  assert.equal(list, '["ADMIN", "PLANOVAT"]');
  assert.equal(facets, list, "fasety pouštějí jiné role než seznam — plánovač by dostal log s prázdnými filtry");
  assert.doesNotMatch(auditList, /session\.role\s*!==\s*"ADMIN"/);
  assert.doesNotMatch(auditFacets, /session\.role\s*!==\s*"ADMIN"/);
});

test("Správa: záložka Audit log je vidět i plánovači, Uživatelé a Přihlášení ne", () => {
  const m = adminDashboard.match(/if \(isPlanovat\) return ([^;]+);/);
  assert.ok(m, "AdminDashboard: chybí filtr záložek pro isPlanovat");
  assert.match(m[1], /tab === "audit"/, "plánovač záložku Audit log nevidí");
  assert.doesNotMatch(m[1], /tab === "users"|tab === "logins"/, "plánovač nesmí vidět Uživatele ani Přihlášení");
});

test("Správa: obsah záložky Audit log není pro plánovače zablokovaný", () => {
  // Kotva na samotný panel a NEJBLIŽŠÍ předchozí podmínku záložky — stejně jako
  // strážný test reportů u odkazu, aby ji nemohla zastoupit jiná větev.
  const at = adminDashboard.indexOf("<AuditLogPanel");
  assert.ok(at > 0, "AuditLogPanel se ve Správě nerenderuje");
  const before = adminDashboard.slice(0, at);
  const cond = before.lastIndexOf('activeTab === "audit"');
  assert.ok(cond >= 0, "AuditLogPanel není pod podmínkou záložky audit");
  const guard = before.slice(cond, before.indexOf("?", cond));
  assert.doesNotMatch(guard, /isPlanovat/, `render guard záložky audit pořád vylučuje plánovače: ${guard}`);
});

// ─── Jediné místo načítání historie v klientu ───────────────────────────────

test("historie se načítá na JEDNOM místě a chyba nevypadá jako prázdná historie", () => {
  // Čte se až uvnitř testu: dokud hook neexistuje, spadne jen tenhle test, ne celý soubor.
  const hook = stripComments(readFileSync("src/hooks/useBlockHistory.ts", "utf8"));
  const detail = stripComments(readFileSync("src/components/BlockDetail.tsx", "utf8"));
  assert.match(hook, /\.then\(readBlockHistoryResponse\)/, "hook neprochází readBlockHistoryResponse (403 by vypadalo jako prázdná historie)");
  assert.match(hook, /pickLoadedHistory\(/, "hook nepoužívá pickLoadedHistory (ukázal by historii předchozího bloku)");
  assert.doesNotMatch(detail, /\/audit`/, "BlockDetail si historii zase načítá sám");
  assert.match(detail, /useBlockHistory\(block\.id\)/);
  assert.match(detail, /<BlockHistoryList entries=\{history\.entries\} maxHeight=\{220\} \/>/, "detail musí dál mít seznam vysoký 220 px");
});

// ─── Dialog historie z kontextového menu karty ──────────────────────────────

const blockCard = stripComments(readFileSync("src/components/planner/BlockCard.tsx", "utf8"));
const planner = stripComments(readFileSync("src/app/_components/PlannerPage.tsx", "utf8"));
const timeline = stripComments(readFileSync("src/app/_components/TimelineGrid.tsx", "utf8"));

test("karta: DTP dostane kontextové menu kvůli položce Historie změn", () => {
  const m = blockCard.match(/const showMenu = ([^;]+);/);
  assert.ok(m, "BlockCard: chybí const showMenu");
  assert.match(m[1], /!!onOpenHistory/, "bez !!onOpenHistory v showMenu se karta DTP do menu nezabalí a položka je mrtvá");
  assert.match(blockCard, /\{onOpenHistory && \(/, "položka Historie změn chybí, nebo ji neřídí onOpenHistory");
});

test("planner nabízí historii PŘESNĚ rolím, které pustí API", () => {
  const m = planner.match(/const canSeeHistory = (\[[^\]]*\])\.includes\(currentUser\.role\);/);
  assert.ok(m, "PlannerPage: chybí const canSeeHistory = [...].includes(currentUser.role)");
  assert.equal(m[1], allowlistOf(blockAudit, "blocks/[id]/audit"), "menu nabízí historii jiným rolím, než pustí API");
  assert.match(planner, /onOpenHistory=\{canSeeHistory \?/, "TimelineGrid dostává onOpenHistory bez podmínky canSeeHistory");
  assert.match(timeline, /onOpenHistory=\{onOpenHistory\}/, "TimelineGrid prop kartě nepředává");
});

test("dialog historie zachytí klávesy dřív než globální handler planneru", () => {
  // Čte se až uvnitř testu: dokud dialog neexistuje, spadne jen tenhle test.
  const dialog = stripComments(readFileSync("src/components/BlockHistoryDialog.tsx", "utf8"));
  assert.match(dialog, /window\.addEventListener\("keydown",\s*\w+,\s*true\)/, "posluchač musí být na window v capture fázi (třetí argument true)");
  assert.match(dialog, /window\.removeEventListener\("keydown",\s*\w+,\s*true\)/);
  assert.match(dialog, /\.stopPropagation\(\)/);
});
