# Historie pro plánovače a pre-press — implementační plán (etapa 3, září 2026)

> **Pro agentní pracovníky:** POVINNÁ SUB-SKILL: použij superpowers:subagent-driven-development (doporučeno) nebo superpowers:executing-plans a implementuj plán úkol po úkolu. Kroky používají checkbox (`- [ ]`) syntaxi pro sledování.

**Cíl:** Plánovač uvidí ve Správě plný audit log a pre-press (DTP) i MTZ uvidí historii změn jedné zakázky — bez poznámek tiskaře — v dialogu z kontextového menu karty; historie jedné zakázky unese 100 řádků z každého zdroje místo 20.

**Architektura:** Tři nezávislé kusy. (A) Audit log ve Správě se plánovači přestane skrývat a obě jeho API (`/api/audit`, `/api/audit/filters`) pustí `ADMIN` + `PLANOVAT` shodným výčtem. (B) Řádky historie se z `BlockDetail.tsx` doslova přesunou do `BlockHistoryList`, načítání do jediného hooku `useBlockHistory`, a nový `BlockHistoryDialog` je zpřístupní rolím `ADMIN`, `PLANOVAT`, `DTP`, `MTZ` přes položku kontextového menu karty; server rolím bez práva na poznámky tiskaře odstraní řádky `NOTE_*` čistou funkcí `visibleHistoryFor`. (C) `PER_SOURCE_LIMIT` 20 → 100. Shodu výčtů rolí, filtr na každé úspěšné odpovědi, menu pro DTP i zachytávání kláves pod dialogem hlídá jeden strážný test nad zdrojovým textem.

**Tech Stack:** Next.js 16 (App Router) · React · TypeScript · Prisma 5 · MySQL/MariaDB · testy `node:test` + `tsx`

**Spec:** `docs/superpowers/specs/2026-10-05-historie-pro-planovace-a-pre-press-design.md`

## Global Constraints

- **Výčet rolí historie zakázky je `["ADMIN", "PLANOVAT", "DTP", "MTZ"]`** — v `GET /api/blocks/[id]/audit` (tam už je, NEMĚNÍ se) a v nové konstantě `canSeeHistory` v `PlannerPage.tsx`, doslova shodně. Položka menu, kterou API odmítne, by skončila hláškou „nemáte přístup".
- **Výčet rolí audit logu je `["ADMIN", "PLANOVAT"]`** — v `/api/audit` i `/api/audit/filters`, doslova shodně. Otevřený seznam bez otevřených faset = log s prázdnými filtry a žádná chyba.
- Sdílená konstanta rolí se NEZAVÁDÍ — projekt si výčty opisuje a shodu hlídá strážný test (stejně jako `src/lib/reportAccessWiring.test.ts` v etapě 2).
- **NEMĚNÍ se:** `src/middleware.ts`, `src/app/admin/page.tsx` (`/admin` zůstává `ADMIN` + `PLANOVAT`), `/api/login-log` (jen ADMIN), `/api/audit/today` (záložka Aktivita pod zvonkem).
- Poznámky tiskaře = auditní akce **`NOTE_CREATE`, `NOTE_UPDATE`, `NOTE_DELETE`** (text je v `newValue`, resp. v `oldValue` i `newValue`, resp. v `oldValue`). Filtr se odvozuje od `canAccessBlockNotes` (`src/lib/blockNotePermissions.ts`), běží jen nad `source === "audit"` a v routě jako **poslední krok, za `sortHistoryEntries`**.
- **`PER_SOURCE_LIMIT = 100`** na každý zdroj zvlášť. Žádné stránkování, žádné „Načíst další", žádný společný strop na sloučený seznam.
- **Detail bloku (`BlockDetail.tsx`) se pro plánovače vizuálně nemění:** rámeček, nadpis „Historie změn", seznam s `maxHeight` 220 px a řádky doslova tytéž (přesun ověřuje skript v Tasku 4).
- Nové komponenty jako named export v `src/components/`, hook v `src/hooks/`. Z-index jen přes `Z_OVERLAY` (`src/lib/zLayers.ts`). V novém kódu barvy přes tokeny z `globals.css` — vědomé výjimky viz Rozhodnutí 9.
- Komentář, který nepopisuje skutečný stav kódu, je v tomhle projektu vada (`docs/POUCENI.md`, P19). Každý komentář, který změna zneplatní, se přepisuje ve stejném commitu.
- Neúspěch se nesmí tvářit jako „nic se nestalo" (`docs/POUCENI.md`, P32): odmítnutý nebo spadlý dotaz na historii nesmí v dialogu vypadat jako prázdná historie.
- Žádná migrace, žádná nová závislost.
- Celá suite (z CLAUDE.md):
  ```bash
  node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
  ```
  Jeden soubor: `node --test --import tsx src/lib/blockHistory.test.ts`
- Typová kontrola: `npx tsc --noEmit -p tsconfig.json` (cca 4 s). `npm run lint` musí skončit s 0 chybami (dnes 32 warningů, počet nesmí stoupnout).
- Větev `Vojta`, nic se nepushuje. Commity česky, zakončené řádkem `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

Pět situací, které spec předpokládá, ale sám nevyjmenovává — každá má test v úkolu, který vlastní její kód:

1. **DTP klikne pravým na kartu a nic se nestane.** `BlockCard` zabalí kartu do kontextového menu jen při `showMenu`, a ten je dnes pro DTP `false` (`if (!showMenu) return blockDiv;`). Bez `!!onOpenHistory` v `showMenu` by položka byla mrtvá přesně pro roli, kvůli které vzniká. → Task 5, test „karta: DTP dostane kontextové menu kvůli položce Historie změn".
2. **Odmítnutý (403) nebo spadlý (500) dotaz vypadá jako „Zatím žádné změny".** Detail bloku dnes mapuje každou chybovou odpověď na `[]`. Pro plánovače to nevadilo, pro dialog DTP by to byla pravdivě vypadající lež (P32). → Task 1, testy `readBlockHistoryResponse`; Task 4 strážný test, že hook jde přes tuto funkci.
3. **Zkratky planneru pod otevřeným dialogem.** Globální handler v `PlannerPage.tsx` poslouchá `keydown` na `window` a ignoruje jen `INPUT`/`TEXTAREA`/`SELECT`. Dialog historie žádné pole nemá, takže by pod ním Ctrl+Z tiše vrátil poslední akci, Delete otevřel mazání vybraného bloku, Ctrl+C místo zkopírování textu z historie ukázal toast „Žádný blok není vybrán" a Esc smazal hledání. Čekané chování: dokud je dialog otevřený, klávesy patří jemu a Esc zavře jen jeho. → Task 5, test „dialog historie zachytí klávesy dřív než globální handler planneru" + proklik v Tasku 7.
4. **Rychlé přepínání bloků v detailu ukáže historii předchozího bloku.** Dnes zůstane pod nově vybraným blokem stará historie, dokud nedoběhne nový dotaz — při vyšetřování havárie, kdy se přepíná rychle, zavádějící. → Task 1, testy `pickLoadedHistory`; Task 4 strážný test zapojení.
5. **Role přidaná později do API uvidí poznámky tiskaře.** Filtr psaný jako „odstraň pro DTP a MTZ" by byl denylist a nová role by poznámky dostala. → Task 1, test „neznámá role je bez poznámek (allowlist, ne denylist)".

---

## Struktura souborů

| Soubor | Odpovědnost | Úkol |
| --- | --- | --- |
| `src/lib/blockHistory.ts` | + `visibleHistoryFor`, typy `BlockHistoryResult` / `BlockHistoryState` / `LoadedBlockHistory`, `readBlockHistoryResponse`, `pickLoadedHistory` | 1 |
| `src/lib/blockHistory.test.ts` | testy čtyř nových funkcí; dosavadních 19 testů BEZE ZMĚNY | 1 |
| `src/app/api/blocks/[id]/audit/route.ts` | `PER_SOURCE_LIMIT` 100 + přepsaný JSDoc; `visibleHistoryFor` na návratové cestě | 2 |
| `src/lib/historieAccessWiring.test.ts` | NOVÝ strážný test zapojení (vzniká v Tasku 2, rozšiřují ho Tasky 3, 4, 5) | 2, 3, 4, 5 |
| `src/app/api/audit/route.ts` | allowlist `["ADMIN", "PLANOVAT"]` | 3 |
| `src/app/api/audit/filters/route.ts` | allowlist `["ADMIN", "PLANOVAT"]` | 3 |
| `src/app/admin/_components/AdminDashboard.tsx` | záložka Audit log viditelná a vyrenderovaná i pro PLANOVAT | 3 |
| `src/components/BlockHistoryList.tsx` | NOVÝ: řádky historie (doslovný přesun z `BlockDetail.tsx`) ve scrollujícím kontejneru | 4 |
| `src/hooks/useBlockHistory.ts` | NOVÝ: jediné načítání historie v klientu | 4 |
| `src/components/BlockDetail.tsx` | sekce Historie změn přes hook a `BlockHistoryList`; vlastní fetch, stav a osiřelé importy pryč | 4 |
| `src/components/BlockHistoryDialog.tsx` | NOVÝ: modál historie (načítání, chyba, prázdno, seznam; zachytávání kláves) | 5 |
| `src/components/planner/BlockCard.tsx` | prop `onOpenHistory`, `showMenu`, položka „🕘 Historie změn" | 5 |
| `src/app/_components/TimelineGrid.tsx` | průchod propu `onOpenHistory` | 5 |
| `src/app/_components/PlannerPage.tsx` | `canSeeHistory`, snímek cíle dialogu, prop pro `TimelineGrid`, render dialogu | 5 |
| `CLAUDE.md` | tabulka rolí (sloupec „Historie zakázky", audit log u PLANOVAT), odstavec o čtyřech místech, konvence kláves pod modálem, index souborů | 6 |
| `docs/vyvoj-historie.md` | datovaný záznam etapy | 6 |

## Rozhodnutí, která spec nechal otevřené (rozhodnuto při psaní plánu)

1. **Struktura extrakce — vědomá odchylka od specu.** Spec jmenuje jednu komponentu `BlockHistoryPanel.tsx`, která si sama načítá data. Plán to dělí na tři části: `BlockHistoryList` (jen řádky, nic nenačítá), `useBlockHistory` (jediné načítání) a čisté funkce v `src/lib/blockHistory.ts`. Důvod: dialog potřebuje stavy načítání, chyby a prázdna, které detail bloku ukazovat NESMÍ (spec: detail beze změny — dnes při čemkoli jiném než datech sekci skryje), a jinou výšku seznamu. Komponenta s vlastním fetchem by k tomu potřebovala přepínač varianty. Záměr specu — jedno místo načítání, žádná duplicita mezi detailem a dialogem, detail vizuálně beze změny — zůstává. Rámeček s malým nadpisem „Historie změn" zůstává v `BlockDetail.tsx`; dialog má nadpis ve vlastní hlavičce.
2. **Klávesy pod dialogem.** Spec mlčí. Dialog zachytává `keydown` na `window` ve fázi capture a volá `stopPropagation()` (Review Focus 3); konvence se zapíše do CLAUDE.md, protože se týká každého dalšího modálu nad plánem. `BlockNotesDialog` má tutéž latentní slabinu (chrání ho jen to, že fokus obvykle stojí v textovém poli) — v etapě se NEOPRAVUJE, jen se zmíní v CLAUDE.md.
3. **Texty stavů v dialogu.** 403 → „K historii této zakázky nemáte přístup.", jiná chyba → „Historii se nepodařilo načíst.", prázdná historie → „Zatím žádné změny.", načítání → sdílený `LoadingSpinner`. Chyby přes sdílený `ErrorMessage` (`src/components/ui/`), bez tlačítka „Zkusit znovu" — dialog jde zavřít a otevřít znovu. Detail bloku při chybě dál sekci tiše skryje (spec: beze změny).
4. **Jediná změna chování v detailu:** po přepnutí na jiný blok se sekce skryje, dokud nedoběhne historie NOVÉHO bloku (dnes ukazuje historii předchozího). Je to oprava zavádějícího stavu, ne vzhledu.
5. **Dialog dostane snímek bloku** (id, číslo zakázky, stroj) z chvíle otevření, ne id do živého pole `blocks`. Historie bloku přežije jeho smazání i přesun — dialog se nesmí zavřít jen proto, že blok mezitím smazal někdo jiný (vzor `BlockNotesDialog` s `blocks.find` by to udělal).
6. **Položka v menu stojí PRVNÍ a bez oddělovače.** U DTP je jediná; oddělovač nad ní by visel nad ničím. U plánovače za ní následuje „Stav zakázky ▸" a teprve pak editační akce.
7. **Soubory nad limitem `max-lines`** (500, warn): `PlannerPage.tsx` má 3840 řádků, `TimelineGrid.tsx` 2594, `BlockCard.tsx` 1659 — všechny už dnes varují. Plán do nich přidává cca 15, 3 a 12 řádků a extrakci NENAVRHUJE: přínos by byl nulový proti riziku zásahu do orchestrátoru. Ohlášeno podle pravidla CLAUDE.md („nejdřív navrhni extrakci a ohlas rozhodnutí"). `BlockDetail.tsx` se naopak zmenší o cca 110 řádků.
8. **Měření výkonu proběhne na testu 3021, ne na devu.** Dev DB má 70 bloků, 1526 auditních řádků a největší revizní skupinu o 8 řádcích; produkce ~1200 bloků a revizní skupiny až o 88 blocích (kaskáda 17. 8. 2026). Všechny čtyři dotazy routy jdou přes index (`AuditLog [blockId, createdAt]` a `[groupId, blockId]`, `BlockRevision [blockId, createdAt]` a `[groupId]`); s počtem revizí ve skupině roste jen `groupRows`. **Připravená náhrada, kdyby měření neprošlo** (NEimplementuje se napřed): `groupRows` zúžit na `where: { groupId: { in: groupIds }, viaMany: false }` + `distinct: ["groupId"]` — `groupsWithAddressedTarget` potřebuje jen vědět, které skupiny mají aspoň jeden řádek s `viaMany === false`, takže výsledná množina je stejná a řádků je nejvýš 100.
9. **Barvy.** Přesunuté řádky si nechávají své starší hex barvy (`#f59e0b`, `#22c55e`, `#ef4444`) — parita s dnešním detailem má přednost, komentář v samotné sekci už je přiznává. Překryv (`rgba(0,0,0,0.7)` + blur) a stín dialogu jsou převzaté beze změny ze sdíleného `ConfirmDialog`; token pro překryv projekt nemá a etapa ho nezavádí. Strážný test tokenů (`src/lib/reportTokens.test.ts`) skenuje jen `src/app/reporty` a `src/components/report`, nové soubory ho neovlivní.
10. **Faseta uživatelů v Audit logu.** `/api/audit/filters` vrací pro všechny účty jméno a roli (`buildUserFacets`), takže plánovač po etapě uvidí v rozbalovátku filtru seznam účtů s rolemi. Je to důsledek volby H1 = A, ne nic navíc — hesla ani nic dalšího se nevrací.

---

### Task 1: Čisté funkce historie — filtr poznámek a stav načítání

**Files:**
- Modify: `src/lib/blockHistory.ts` (import nahoře, nové funkce na konec souboru za `sortHistoryEntries`)
- Test: `src/lib/blockHistory.test.ts` (rozšířit import, nové testy na konec)

**Interfaces:**
- Consumes: `canAccessBlockNotes(role: NoteRole): boolean` a `type NoteRole` ze `src/lib/blockNotePermissions.ts` (beze změny); `BlockHistoryEntry` ze `src/lib/blockHistory.ts` (beze změny).
- Produces:
  - `visibleHistoryFor(entries: BlockHistoryEntry[], role: string): BlockHistoryEntry[]` — Task 2 (routa).
  - `type BlockHistoryResult = { status: "ready"; entries: BlockHistoryEntry[] } | { status: "error"; httpStatus: number | null }`
  - `type BlockHistoryState = { status: "loading" } | BlockHistoryResult`
  - `type LoadedBlockHistory = { blockId: number; result: BlockHistoryResult }`
  - `readBlockHistoryResponse(res: Response): Promise<BlockHistoryResult>` — Task 4 (hook).
  - `pickLoadedHistory(loaded: LoadedBlockHistory | null, blockId: number): BlockHistoryState` — Task 4 (hook).

- [ ] **Step 1: Rozšiř import v testu a připiš testy**

V `src/lib/blockHistory.test.ts` nahraď řádek 3:

```ts
import { suppressCoveredColumns, groupsWithAddressedTarget, sortHistoryEntries, type BlockHistoryEntry } from "./blockHistory";
```

tímto:

```ts
import {
  suppressCoveredColumns,
  groupsWithAddressedTarget,
  sortHistoryEntries,
  visibleHistoryFor,
  readBlockHistoryResponse,
  pickLoadedHistory,
  type BlockHistoryEntry,
} from "./blockHistory";
```

Na konec souboru připiš:

```ts
// ─── visibleHistoryFor — poznámky tiskaře podle role (etapa 3 září 2026) ─────

type AuditEntry = Extract<BlockHistoryEntry, { source: "audit" }>;

function auditRow(id: number, action: string, extra: Partial<AuditEntry> = {}): BlockHistoryEntry {
  return {
    source: "audit",
    id,
    createdAt: "2026-10-05T08:00:00.000Z",
    groupId: `g${id}`,
    username: "planovac",
    action,
    field: null,
    oldValue: null,
    newValue: null,
    orderNumber: "18827",
    ...extra,
  };
}

function revisionRow(id: number, action = "UPDATE"): BlockHistoryEntry {
  return {
    source: "revision",
    id,
    createdAt: "2026-10-05T08:00:00.000Z",
    groupId: `r${id}`,
    username: "planovac",
    action,
    label: "Úprava bloku",
    propagated: false,
    lines: ["Stroj: XL 105 → XL 106"],
  };
}

/** Osa se vším, co se v historii zakázky potká: úprava, tři akce poznámky, revize, tisk. */
const MIXED: BlockHistoryEntry[] = [
  auditRow(1, "UPDATE", { field: "description", oldValue: "a", newValue: "b" }),
  auditRow(2, "NOTE_CREATE", { newValue: "Barva v pořádku, pouštím." }),
  revisionRow(3),
  auditRow(4, "NOTE_UPDATE", { oldValue: "Barva v pořádku, pouštím.", newValue: "Chybí lak." }),
  auditRow(5, "NOTE_DELETE", { oldValue: "Chybí lak." }),
  auditRow(6, "PRINT_COMPLETE"),
];

test("visibleHistoryFor: DTP nedostane žádný řádek poznámky tiskaře", () => {
  assert.deepEqual(visibleHistoryFor(MIXED, "DTP").map((e) => e.id), [1, 3, 6]);
});

test("visibleHistoryFor: MTZ taky ne", () => {
  assert.deepEqual(visibleHistoryFor(MIXED, "MTZ").map((e) => e.id), [1, 3, 6]);
});

test("visibleHistoryFor: text poznámky nepřežije v žádném poli (NOTE_UPDATE/NOTE_DELETE ho nesou v oldValue)", () => {
  const leaked = JSON.stringify(visibleHistoryFor(MIXED, "DTP"));
  for (const text of ["Barva v pořádku", "Chybí lak"]) {
    assert.ok(!leaked.includes(text), `unikl text poznámky „${text}"`);
  }
});

test("visibleHistoryFor: role s právem na poznámky dostane TOTÉŽ pole", () => {
  for (const role of ["ADMIN", "PLANOVAT", "TISKAR"]) {
    assert.equal(visibleHistoryFor(MIXED, role), MIXED, role);
  }
});

test("visibleHistoryFor: neznámá role je bez poznámek (allowlist, ne denylist)", () => {
  assert.deepEqual(visibleHistoryFor(MIXED, "EXPEDICE").map((e) => e.id), [1, 3, 6]);
});

test("visibleHistoryFor: revize se nefiltruje, ani kdyby nesla akci poznámky", () => {
  assert.deepEqual(visibleHistoryFor([revisionRow(7, "NOTE_CREATE")], "DTP").map((e) => e.id), [7]);
});

test("visibleHistoryFor: vstupní pole se nemutuje", () => {
  const before = MIXED.map((e) => e.id);
  visibleHistoryFor(MIXED, "DTP");
  assert.deepEqual(MIXED.map((e) => e.id), before);
});

// ─── readBlockHistoryResponse — chyba nesmí vypadat jako prázdná historie ─────

test("readBlockHistoryResponse: 200 s polem je hotová historie", async () => {
  const out = await readBlockHistoryResponse(new Response(JSON.stringify([auditRow(1, "CREATE")]), { status: 200 }));
  assert.equal(out.status, "ready");
  assert.equal(out.status === "ready" ? out.entries.length : -1, 1);
});

test("readBlockHistoryResponse: 200 s prázdným polem je prázdná historie, ne chyba", async () => {
  assert.deepEqual(await readBlockHistoryResponse(new Response("[]", { status: 200 })), { status: "ready", entries: [] });
});

test("readBlockHistoryResponse: 403 je chyba s kódem, NE prázdná historie", async () => {
  const out = await readBlockHistoryResponse(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
  assert.deepEqual(out, { status: "error", httpStatus: 403 });
});

test("readBlockHistoryResponse: 500 je chyba s kódem", async () => {
  const out = await readBlockHistoryResponse(new Response(JSON.stringify({ error: "Chyba serveru" }), { status: 500 }));
  assert.deepEqual(out, { status: "error", httpStatus: 500 });
});

test("readBlockHistoryResponse: 200 s objektem místo pole je chyba", async () => {
  const out = await readBlockHistoryResponse(new Response(JSON.stringify({ error: "x" }), { status: 200 }));
  assert.deepEqual(out, { status: "error", httpStatus: 200 });
});

test("readBlockHistoryResponse: nečitelné tělo je chyba", async () => {
  const out = await readBlockHistoryResponse(new Response("<html>", { status: 200 }));
  assert.deepEqual(out, { status: "error", httpStatus: 200 });
});

// ─── pickLoadedHistory — historie předchozího bloku se nesmí ukázat ──────────

test("pickLoadedHistory: nic načteno → loading", () => {
  assert.deepEqual(pickLoadedHistory(null, 5), { status: "loading" });
});

test("pickLoadedHistory: výsledek JINÉHO bloku se neukáže → loading", () => {
  const loaded = { blockId: 4, result: { status: "ready" as const, entries: [auditRow(1, "CREATE")] } };
  assert.deepEqual(pickLoadedHistory(loaded, 5), { status: "loading" });
});

test("pickLoadedHistory: výsledek téhož bloku se vrátí", () => {
  const result = { status: "error" as const, httpStatus: 500 };
  assert.equal(pickLoadedHistory({ blockId: 5, result }, 5), result);
});
```

- [ ] **Step 2: Spusť testy a ověř, že padají**

Run: `node --test --import tsx src/lib/blockHistory.test.ts`
Expected: FAIL — `visibleHistoryFor`, `readBlockHistoryResponse` a `pickLoadedHistory` v `./blockHistory` neexistují (chyba importu nebo „is not a function").

- [ ] **Step 3: Implementuj funkce**

V `src/lib/blockHistory.ts` přidej pod řádek 1 (`import { coveredColumns, type AuditCoverageRow } from "./auditCoverage";`):

```ts
import { canAccessBlockNotes, type NoteRole } from "./blockNotePermissions";
```

Na úplný konec souboru (za uzavírací `}` funkce `sortHistoryEntries`) připiš:

```ts

// ─── Viditelnost podle role (etapa 3 září 2026) ──────────────────────────────

/**
 * Auditní akce, jejichž obsahem je TEXT poznámky tiskaře (`BlockNote`):
 * `NOTE_CREATE` ho nese v `newValue`, `NOTE_UPDATE` v `oldValue` i `newValue`,
 * `NOTE_DELETE` v `oldValue`. Proto všechny tři, ne jen vytvoření.
 */
const TISKAR_NOTE_ACTIONS: ReadonlySet<string> = new Set(["NOTE_CREATE", "NOTE_UPDATE", "NOTE_DELETE"]);

/**
 * Historie bloku tak, jak ji smí vidět daná role. Poznámky tiskaře smí jen role
 * s `canAccessBlockNotes` (ADMIN, PLANOVAT, TISKAR); ostatním se jejich auditní
 * řádky odstraní celé. DTP a MTZ dostávají historii zakázky od etapy 3 (září
 * 2026), kdy jim vznikl dialog z kontextového menu karty.
 *
 * Predikát se ZÁMĚRNĚ odvozuje od `canAccessBlockNotes`, ne od vlastního výčtu
 * rolí — dvě definice „kdo smí na poznámky tiskaře" by se časem rozešly. A je to
 * allowlist: role, o které modul poznámek nic neví (třeba nově přidaná), dostane
 * historii BEZ poznámek, ne s nimi.
 *
 * Filtr je vázaný na `source === "audit"`. Revize akci poznámky nenese a nesmí
 * zmizet nikdy — u přesunu bloku na jiný stroj je jediným existujícím záznamem.
 *
 * `GET /api/blocks/[id]/audit` ho volá jako POSLEDNÍ krok, až za
 * `sortHistoryEntries`: potlačení pokrytých sloupců (`suppressCoveredColumns`)
 * tak zůstává pro všechny role shodné a DTP vidí přesně to, co plánovač, minus
 * řádky poznámek. Má-li role na poznámky právo, vrací se TENTÝŽ objekt pole.
 */
export function visibleHistoryFor(entries: BlockHistoryEntry[], role: string): BlockHistoryEntry[] {
  if (canAccessBlockNotes(role as NoteRole)) return entries;
  return entries.filter((e) => !(e.source === "audit" && TISKAR_NOTE_ACTIONS.has(e.action)));
}

// ─── Načítání v klientu (etapa 3 září 2026) ──────────────────────────────────

/** Výsledek jednoho dotazu na historii — co se dá ukázat, když dotaz doběhl. */
export type BlockHistoryResult =
  | { status: "ready"; entries: BlockHistoryEntry[] }
  | { status: "error"; httpStatus: number | null };

/** Stav historie v UI: buď se ještě načítá, nebo je k dispozici výsledek. */
export type BlockHistoryState = { status: "loading" } | BlockHistoryResult;

/** Doběhlý výsledek spolu s blokem, ke kterému patří (viz `pickLoadedHistory`). */
export type LoadedBlockHistory = { blockId: number; result: BlockHistoryResult };

/**
 * Převede odpověď `GET /api/blocks/[id]/audit` na výsledek pro UI.
 *
 * Neúspěch NESMÍ vypadat jako prázdná historie (`docs/POUCENI.md`, P32). Detail
 * bloku do etapy 3 mapoval jakoukoli chybovou odpověď na `[]` a sekci tiše skryl
 * — u plánovače, kterého API pouští, to nevadilo. Dialog pro DTP a MTZ by ale
 * odmítnutí (403) ukázal jako „Zatím žádné změny", tedy jako pravdivě vypadající
 * lež. Proto `error` i s HTTP kódem, ať dialog řekne, co se skutečně stalo.
 */
export async function readBlockHistoryResponse(res: Response): Promise<BlockHistoryResult> {
  if (!res.ok) return { status: "error", httpStatus: res.status };
  const data: unknown = await res.json().catch(() => null);
  if (!Array.isArray(data)) return { status: "error", httpStatus: res.status };
  return { status: "ready", entries: data as BlockHistoryEntry[] };
}

/**
 * Stav historie pro `blockId`: výsledek jen tehdy, když patří TOMUHLE bloku,
 * jinak `loading`. Detail bloku do etapy 3 ukazoval po přepnutí na jiný blok
 * historii PŘEDCHOZÍHO, dokud nedoběhl nový dotaz — při vyšetřování havárie,
 * kdy se mezi bloky přepíná rychle, zavádějící.
 */
export function pickLoadedHistory(loaded: LoadedBlockHistory | null, blockId: number): BlockHistoryState {
  return loaded !== null && loaded.blockId === blockId ? loaded.result : { status: "loading" };
}
```

- [ ] **Step 4: Spusť testy a ověř, že projdou**

Run: `node --test --import tsx src/lib/blockHistory.test.ts`
Expected: PASS — všech 19 dosavadních testů beze změny a 16 nových.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: žádný výstup (0 chyb).

- [ ] **Step 5: Commit**

```bash
git add src/lib/blockHistory.ts src/lib/blockHistory.test.ts
git commit -m "$(cat <<'EOF'
feat(historie): filtr poznámek tiskaře a stav načítání jako čisté funkce

visibleHistoryFor odstraní řádky NOTE_CREATE/NOTE_UPDATE/NOTE_DELETE každé
roli bez canAccessBlockNotes (allowlist — nová role je bez poznámek).
readBlockHistoryResponse nedovolí, aby 403/500 vypadalo jako prázdná
historie (P32), pickLoadedHistory nepustí historii předchozího bloku.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Block-audit routa — filtr na návratové cestě a limit 100

**Files:**
- Modify: `src/app/api/blocks/[id]/audit/route.ts` (import na ř. 5, JSDoc + konstanta na ř. 11–37, návrat na konci `try`)
- Create: `src/lib/historieAccessWiring.test.ts`

**Interfaces:**
- Consumes: `visibleHistoryFor(entries: BlockHistoryEntry[], role: string): BlockHistoryEntry[]` z Tasku 1.
- Produces: soubor `src/lib/historieAccessWiring.test.ts` s pomocníkem `allowlistOf(src: string, file: string): string` a konstantou `blockAudit` (zdroják routy bez komentářů) — Tasky 3 a 5 do souboru připisují a obojí používají.

- [ ] **Step 1: Napiš strážný test**

Vytvoř `src/lib/historieAccessWiring.test.ts`:

```ts
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
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `node --test --import tsx src/lib/historieAccessWiring.test.ts`
Expected: první test PROJDE (výčet rolí se nemění), druhý FAIL („nefiltrovaná odpověď: NextResponse.json(sortHistoryEntries…" nebo „úspěšná odpověď historie nejde přes visibleHistoryFor"), třetí FAIL (limit je 20).

- [ ] **Step 3: Uprav routu**

V `src/app/api/blocks/[id]/audit/route.ts` nahraď import na ř. 5:

```ts
import { suppressCoveredColumns, groupsWithAddressedTarget, sortHistoryEntries, type BlockHistoryEntry } from "@/lib/blockHistory";
```

tímto:

```ts
import { suppressCoveredColumns, groupsWithAddressedTarget, sortHistoryEntries, visibleHistoryFor, type BlockHistoryEntry } from "@/lib/blockHistory";
```

Nahraď celý JSDoc a konstantu (od `/**` na ř. 11 po `const PER_SOURCE_LIMIT = 20;` na ř. 37) tímto. Komentář se přepisuje celý, protože dnešní argumentuje dvaceti řádky a „plnými 40 položkami" a navíc tvrdí, že `AUDITED_FIELDS` má 23 položek — v `src/lib/auditedFields.ts` jich je dnes 26 (P19):

```ts
/**
 * Kolik řádků se načte Z KAŽDÉHO ZDROJE zvlášť. NENÍ to strop na celou odpověď —
 * ta jich může nést až dvojnásobek (100 auditních + 100 revizních).
 *
 * Do etapy 3 (září 2026) tu bylo 20. Na produkční kopii (931 bloků / 3602
 * auditních řádků) na ten strop narazilo 6 bloků, tedy 0,6 % — jenže zrovna ty
 * nejrušnější, tedy přesně ty, které někdo po havárii vyšetřuje. Plánovač si na
 * „omezenou historii" stěžoval a volba H3 = C zní „jen zvednout limit": bez
 * stránkování, bez tlačítka „Načíst další".
 *
 * Společný strop na SLOUČENÝ seznam tu být NESMÍ, a to je celý smysl téhle
 * konstrukce: auditních řádků je vždycky řádově víc než revizních, protože jedno
 * uložení z BlockEditu jich vyrobí spoustu v JEDINÉ transakci — `AUDITED_FIELDS`
 * (`src/lib/auditedFields.ts`) jmenuje přes dvacet polí a bohaté uložení se
 * naměřilo na 12–18 řádků (ověřeno 9. 8. 2026 během endpointu nad dev DB —
 * 18 změněných auditovaných polí dalo 18 řádků). Revizí přitom ze stejné
 * transakce vznikne typicky JEDNA. Jakýkoli společný ořez proto revize
 * SYSTEMATICKY vytlačí — a revize je u některých změn jediný záznam, který
 * existuje: `machine` v `AUDITED_FIELDS` není, takže o přesunu bloku na jiný
 * stroj jinde stopa NENÍ.
 *
 * Známá vlastnost dvou nezávislých oken: konec seznamu je „roztřepený". Když
 * jsou auditní řádky husté a revize řídké, sahá revizní okno časově dál a pod
 * auditní hranicí už jsou v ose vidět jen revize. Je to vědomá cena za to, že
 * se řídký zdroj vůbec zobrazí; alternativa (ořez na novější z obou hranic) je
 * přesně ta vada, kterou tenhle komentář popisuje.
 *
 * Seznam se vykresluje ve scrollujícím kontejneru (`BlockHistoryList`): v detailu
 * bloku vysokém 220 px, v dialogu historie do výšky dialogu. Ani při plných
 * 200 položkách se tedy vizuálně nic nerozjede.
 */
const PER_SOURCE_LIMIT = 100;
```

Na konci bloku `try` nahraď řádek:

```ts
    return NextResponse.json(sortHistoryEntries(entries));
```

tímto (komentář nad ním zůstává, jen se k němu připojí odstavec):

```ts
    //
    // Poznámky tiskaře (`NOTE_*`) smí jen ADMIN, PLANOVAT a TISKAR — DTP a MTZ,
    // kteří historii dostali v etapě 3 (září 2026), je vidět NESMÍ. Filtruje se
    // až TADY, za řazením: potlačení pokrytých sloupců výš tak zůstává pro všechny
    // role shodné a DTP vidí přesně to, co plánovač, minus řádky poznámek.
    return NextResponse.json(visibleHistoryFor(sortHistoryEntries(entries), session.role));
```

Výčet rolí na začátku `GET` (`["ADMIN", "PLANOVAT", "DTP", "MTZ"]`) se NEMĚNÍ.

- [ ] **Step 4: Spusť testy a ověř, že projdou**

Run: `node --test --import tsx src/lib/historieAccessWiring.test.ts src/lib/blockHistory.test.ts`
Expected: PASS — 3 testy strážného souboru a 35 testů `blockHistory`.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 chyb.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/blocks/[id]/audit/route.ts src/lib/historieAccessWiring.test.ts
git commit -m "$(cat <<'EOF'
feat(historie): limit historie bloku 100 a filtr poznámek tiskaře v routě

PER_SOURCE_LIMIT 20 → 100 (volba H3 = C) s přepsaným JSDocem — dosavadní
argumentoval dvaceti řádky a tvrdil 23 položek AUDITED_FIELDS (dnes 26).
Úspěšná odpověď jde přes visibleHistoryFor až za řazením, takže DTP a MTZ
vidí totéž co plánovač, minus NOTE_*. Nový strážný test zapojení.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Audit log ve Správě pro plánovače

**Files:**
- Modify: `src/app/api/audit/route.ts` (role gate, dnes ř. 10–12)
- Modify: `src/app/api/audit/filters/route.ts` (role gate, dnes ř. 57–59)
- Modify: `src/app/admin/_components/AdminDashboard.tsx` (filtr `visibleTabs`, dnes ř. 29–32; render guard záložky audit)
- Test: `src/lib/historieAccessWiring.test.ts` (připsat)

**Interfaces:**
- Consumes: `allowlistOf` ze strážného souboru (Task 2).
- Produces: nic, co by další task volal. Task 6 tuto změnu dokumentuje.

- [ ] **Step 1: Připiš strážné testy**

Na konec `src/lib/historieAccessWiring.test.ts` připiš:

```ts
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
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `node --test --import tsx src/lib/historieAccessWiring.test.ts`
Expected: tři nové testy FAIL („čekám právě jeden allowlist … je jich 0"; „plánovač záložku Audit log nevidí"; „render guard záložky audit pořád vylučuje plánovače"), tři z Tasku 2 PASS.

- [ ] **Step 3: Otevři obě API**

V `src/app/api/audit/route.ts` nahraď:

```ts
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

tímto:

```ts
  // Audit log vidí ADMIN i PLANOVAT (etapa 3 září 2026, volba H1 = A). Výčet MUSÍ
  // být shodný s `/api/audit/filters` — jinak plánovač dostane log s prázdnými
  // filtry a žádnou chybu. Hlídá src/lib/historieAccessWiring.test.ts.
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

V `src/app/api/audit/filters/route.ts` nahraď v `GET` totéž:

```ts
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

tímto:

```ts
  // Fasety pro filtry Audit logu — výčet MUSÍ být shodný s `/api/audit` (etapa 3
  // září 2026). Hlídá src/lib/historieAccessWiring.test.ts.
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

- [ ] **Step 4: Odkryj záložku ve Správě**

V `src/app/admin/_components/AdminDashboard.tsx` nahraď:

```ts
  const visibleTabs = (["users", "codebook", "presets", "audit", "logins", "shifts", "rozpis"] as const).filter((tab) => {
    if (isPlanovat) return tab === "codebook" || tab === "presets" || tab === "shifts" || tab === "rozpis";
    return true;
  });
```

tímto:

```ts
  const visibleTabs = (["users", "codebook", "presets", "audit", "logins", "shifts", "rozpis"] as const).filter((tab) => {
    // PLANOVAT vidí i Audit log (etapa 3 září 2026, volba H1 = A); Uživatelé a
    // Přihlášení zůstávají jen ADMINovi. Obě audit API pouštějí totéž — hlídá
    // src/lib/historieAccessWiring.test.ts.
    if (isPlanovat) return tab === "codebook" || tab === "presets" || tab === "audit" || tab === "shifts" || tab === "rozpis";
    return true;
  });
```

a v renderu obsahu nahraď:

```tsx
        ) : activeTab === "audit" && !isPlanovat ? (
```

tímto:

```tsx
        ) : activeTab === "audit" ? (
```

Větve `users` a `logins` si `&& !isPlanovat` PONECHÁVAJÍ.

- [ ] **Step 5: Spusť testy a ověř, že projdou**

Run: `node --test --import tsx src/lib/historieAccessWiring.test.ts`
Expected: PASS — 6 testů.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 chyb.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/audit/route.ts src/app/api/audit/filters/route.ts src/app/admin/_components/AdminDashboard.tsx src/lib/historieAccessWiring.test.ts
git commit -m "$(cat <<'EOF'
feat(historie): audit log ve Správě i pro plánovače

Záložka Audit log je vidět roli PLANOVAT (volba H1 = A); /api/audit
i /api/audit/filters pouštějí ADMIN + PLANOVAT shodným výčtem — samotný
seznam bez faset by dal plánovači log s prázdnými filtry a žádnou chybu.
Uživatelé a Přihlášení zůstávají jen ADMINovi.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Řádky historie a jejich načítání z `BlockDetail` ven

**Files:**
- Create: `src/components/BlockHistoryList.tsx`
- Create: `src/hooks/useBlockHistory.ts`
- Modify: `src/components/BlockDetail.tsx` (importy ř. 8, 10, 11; stav ř. 115–117; efekt ř. 138–143; sekce ř. 592–701)
- Test: `src/lib/historieAccessWiring.test.ts` (připsat)

**Interfaces:**
- Consumes: z Tasku 1 `readBlockHistoryResponse`, `pickLoadedHistory`, typy `BlockHistoryResult`, `BlockHistoryState`, `LoadedBlockHistory`; `BlockHistoryEntry` (beze změny).
- Produces:
  - `BlockHistoryList({ entries, maxHeight }: { entries: BlockHistoryEntry[]; maxHeight?: number })` — named export z `src/components/BlockHistoryList.tsx`. S `maxHeight` má seznam pevný strop výšky (detail: 220), bez něj vyplní rodiče (`flex: 1; minHeight: 0`) — Task 5 (dialog).
  - `useBlockHistory(blockId: number): BlockHistoryState` — named export z `src/hooks/useBlockHistory.ts` — Task 5 (dialog).

Pozn.: Tasky 1–3 `BlockDetail.tsx` nemění, takže čísla řádků výš platí; skripty v krocích 3 a 6 se přesto řídí textovými kotvami, ne čísly.

- [ ] **Step 1: Připiš strážný test**

Na konec `src/lib/historieAccessWiring.test.ts` připiš:

```ts
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
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `node --test --import tsx src/lib/historieAccessWiring.test.ts`
Expected: nový test FAIL s `ENOENT … src/hooks/useBlockHistory.ts`, ostatních 6 PASS.

- [ ] **Step 3: Vytvoř kostru `BlockHistoryList` a doslova do ní přesuň řádky**

Vytvoř `src/components/BlockHistoryList.tsx` s tímto obsahem (řádek `      /* @@ROWS@@ */` je značka, kterou příkaz níž nahradí řádky z detailu — v souboru nezůstane):

```tsx
"use client";

import { type BlockHistoryEntry } from "@/lib/blockHistory";
import { FIELD_LABELS, fmtAuditVal, classifyUndoRedoField } from "@/lib/auditFormatters";
import { formatPragueDateShort, formatPragueTime } from "@/lib/dateUtils";

/**
 * Řádky historie změn jedné zakázky — sloučená osa `AuditLog` + `BlockRevision`
 * z `GET /api/blocks/[id]/audit` (etapa 3 září 2026).
 *
 * Řádky jsou DOSLOVNĚ přesunuté z `BlockDetail.tsx`, včetně starších hex barev
 * vedle tokenů: plánovač nesmí v detailu bloku poznat žádný rozdíl. Sdílí je
 * detail (v rámečku s nadpisem, `maxHeight` 220 px) a `BlockHistoryDialog` (bez
 * `maxHeight` — seznam vyplní dialog a scrolluje uvnitř něj).
 *
 * Komponenta nic nenačítá a nic nefiltruje. Data drží `useBlockHistory`, poznámky
 * tiskaře rolím bez práva odstraňuje už server (`visibleHistoryFor`).
 */
export function BlockHistoryList({ entries, maxHeight }: { entries: BlockHistoryEntry[]; maxHeight?: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        ...(maxHeight !== undefined ? { maxHeight } : { flex: 1, minHeight: 0 }),
      }}
    >
      /* @@ROWS@@ */
    </div>
  );
}
```

Pak spusť z kořene repa (vytáhne celé `{blockHistory.map(…)}` z detailu podle párování závorek, přejmenuje proměnnou na `entries`, ubere 6 mezer odsazení a vloží místo značky):

```bash
node - <<'EOF'
const fs = require("node:fs");
const src = fs.readFileSync("src/components/BlockDetail.tsx", "utf8");
const start = src.indexOf("{blockHistory.map(");
if (start < 0) throw new Error("kotva {blockHistory.map( v BlockDetail.tsx nenalezena");
let depth = 0, end = -1;
for (let k = start; k < src.length; k++) {
  if (src[k] === "{") depth++;
  else if (src[k] === "}" && --depth === 0) { end = k + 1; break; }
}
if (end < 0) throw new Error("mapa historie v BlockDetail.tsx není uzavřená");
const lineStart = src.lastIndexOf("\n", start) + 1;
const rows = src.slice(lineStart, end)
  .replace("{blockHistory.map(", "{entries.map(")
  .split("\n").map((l) => l.replace(/^ {6}/, "")).join("\n");
const target = "src/components/BlockHistoryList.tsx";
const tpl = fs.readFileSync(target, "utf8");
const MARK = "      /* @@ROWS@@ */\n";
if (!tpl.includes(MARK)) throw new Error("značka @@ROWS@@ v BlockHistoryList.tsx chybí");
fs.writeFileSync(target, tpl.replace(MARK, rows + "\n"));
console.log("vloženo řádků:", rows.split("\n").length);
EOF
```

Expected: `vloženo řádků: 100`.

- [ ] **Step 4: Vytvoř hook `useBlockHistory`**

Vytvoř `src/hooks/useBlockHistory.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import {
  pickLoadedHistory,
  readBlockHistoryResponse,
  type BlockHistoryResult,
  type BlockHistoryState,
  type LoadedBlockHistory,
} from "@/lib/blockHistory";

/**
 * Historie jedné zakázky z `GET /api/blocks/[id]/audit` — JEDINÉ místo, které ji
 * v klientu načítá. Sdílí ho detail bloku (`BlockDetail.tsx`) a dialog historie
 * (`BlockHistoryDialog.tsx`, etapa 3 září 2026).
 *
 * Výsledek se ukládá spolu s číslem bloku a vrací se jen tehdy, když patří
 * TOMUHLE bloku (`pickLoadedHistory`), jinak `loading`. Odpověď, která doběhne až
 * po přepnutí na jiný blok, se zahodí (`ignore`) — jinak by mohla přepsat novější.
 * Neúspěch je `error` s HTTP kódem, ne prázdná historie (`readBlockHistoryResponse`).
 */
export function useBlockHistory(blockId: number): BlockHistoryState {
  const [loaded, setLoaded] = useState<LoadedBlockHistory | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch(`/api/blocks/${blockId}/audit`)
      .then(readBlockHistoryResponse)
      .catch((): BlockHistoryResult => ({ status: "error", httpStatus: null }))
      .then((result) => {
        if (!ignore) setLoaded({ blockId, result });
      });
    return () => {
      ignore = true;
    };
  }, [blockId]);

  return pickLoadedHistory(loaded, blockId);
}
```

- [ ] **Step 5: Přepoj `BlockDetail` na hook a seznam**

V `src/components/BlockDetail.tsx`:

(a) Nahraď ř. 8:

```ts
import { type BlockHistoryEntry } from "@/lib/blockHistory";
```

tímto:

```ts
import { useBlockHistory } from "@/hooks/useBlockHistory";
```

(b) Nahraď ř. 10:

```ts
import { FIELD_LABELS, fmtAuditVal, classifyUndoRedoField } from "@/lib/auditFormatters";
```

tímto:

```ts
import { BlockHistoryList } from "@/components/BlockHistoryList";
```

(c) Nahraď ř. 11:

```ts
import { formatCivilDate, formatPragueDateTime, formatPragueDateShort, formatPragueTime } from "@/lib/dateUtils";
```

tímto (`formatPragueDateShort` a `formatPragueTime` se v detailu používaly jen v řádcích historie):

```ts
import { formatCivilDate, formatPragueDateTime } from "@/lib/dateUtils";
```

(d) Nahraď stav (ř. 115–117):

```ts
  // Sloučená osa AuditLog + BlockRevision. VLASTNÍ typ, ne `AuditLogEntry`:
  // ten má v repu dvě nezávislé definice pro jiné endpointy (viz blockHistory.ts).
  const [blockHistory, setBlockHistory] = useState<BlockHistoryEntry[]>([]);
```

tímto:

```ts
  // Sloučená osa AuditLog + BlockRevision. Načítá ji `useBlockHistory` — jediné
  // místo, sdílené s dialogem historie pro DTP a MTZ (etapa 3 září 2026). Dokud
  // nedoběhne odpověď pro TENHLE blok, sekce se nezobrazí (`pickLoadedHistory`).
  const history = useBlockHistory(block.id);
```

(e) Smaž efekt (ř. 138–143) i s prázdným řádkem za ním:

```ts
  useEffect(() => {
    fetch(`/api/blocks/${block.id}/audit`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: BlockHistoryEntry[]) => setBlockHistory(data))
      .catch(() => setBlockHistory([]));
  }, [block.id]);

```

`useEffect` z importu NEMAŽ — dál ho používá efekt rezervace hned pod ním.

(f) Nahraď celou sekci od `      {/* Historie změn */}` po její uzavírací `      )}` (dnes ř. 592–701) tímto příkazem — sahá od kotvy `{/* Historie změn */}` po prázdný řádek před `{/* Smazat */}`:

```bash
node - <<'EOF'
const fs = require("node:fs");
const f = "src/components/BlockDetail.tsx";
const src = fs.readFileSync(f, "utf8");
const a = src.indexOf("      {/* Historie změn */}\n");
const b = src.indexOf("\n\n      {/* Smazat */}");
if (a < 0 || b < 0 || b < a) throw new Error("kotvy sekce Historie změn v BlockDetail.tsx nenalezeny");
const section = `      {/* Historie změn */}
      {history.status === "ready" && history.entries.length > 0 && (
        <div style={{ margin: "0 16px 12px", borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ padding: "5px 10px", background: "var(--surface-2)", fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Historie změn
          </div>
          <BlockHistoryList entries={history.entries} maxHeight={220} />
        </div>
      )}`;
fs.writeFileSync(f, src.slice(0, a) + section + src.slice(b));
console.log("sekce nahrazena, odebráno znaků:", b - a - section.length);
EOF
```

Rámeček a nadpis jsou znak po znaku tytéž jako dnes; mění se jen podmínka (`history.status === "ready" && history.entries.length > 0` místo `blockHistory.length > 0`) a vnitřek (`<BlockHistoryList … />` místo vlastního seznamu).

- [ ] **Step 6: Ověř, že řádky jsou přesunuté doslova**

Run (porovná mapu řádků z `HEAD` — tedy ještě nezměněný detail — s novým souborem, bez ohledu na odsazení):

```bash
node -e '
const fs = require("node:fs");
const { execSync } = require("node:child_process");
function grab(src, start) {
  const i = src.indexOf(start);
  if (i < 0) throw new Error("nenalezeno: " + start);
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}" && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error("neuzavřeno: " + start);
}
const norm = (s) => s.split("\n").map((l) => l.trim()).join("\n");
const before = execSync("git show HEAD:src/components/BlockDetail.tsx", { encoding: "utf8" });
const after = fs.readFileSync("src/components/BlockHistoryList.tsx", "utf8");
const a = norm(grab(before, "{blockHistory.map(")).replace("{blockHistory.map(", "{entries.map(");
const b = norm(grab(after, "{entries.map("));
if (a !== b) { console.error("ŘÁDKY HISTORIE NEJSOU PŘESUNUTÉ DOSLOVA"); process.exit(1); }
console.log("OK: řádky historie přesunuty doslova (" + a.split("\n").length + " řádků)");
'
```

Expected: `OK: řádky historie přesunuty doslova (100 řádků)`.

- [ ] **Step 7: Typová kontrola, testy, lint**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 chyb (osiřelý import nebo zapomenutý `blockHistory` by tu spadl).

Run: `node --test --import tsx src/lib/historieAccessWiring.test.ts src/lib/blockHistory.test.ts`
Expected: PASS — 7 + 35 testů.

Run: `npm run lint`
Expected: 0 chyb, počet warningů nejvýš 32.

- [ ] **Step 8: Commit**

```bash
git add src/components/BlockHistoryList.tsx src/hooks/useBlockHistory.ts src/components/BlockDetail.tsx src/lib/historieAccessWiring.test.ts
git commit -m "$(cat <<'EOF'
refactor(historie): řádky historie a jejich načítání z BlockDetail ven

Řádky se doslova přesunuly do BlockHistoryList (ověřeno skriptem proti
HEAD), načítání do jediného hooku useBlockHistory. Detail vypadá stejně;
po přepnutí bloku už neukazuje historii předchozího, dokud nedoběhne
nový dotaz. Připravuje dialog historie pro DTP a MTZ.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Dialog historie z kontextového menu karty

**Files:**
- Create: `src/components/BlockHistoryDialog.tsx`
- Modify: `src/components/planner/BlockCard.tsx` (destrukturace propů dnes ř. 247, typ propů dnes ř. 312, `showMenu` dnes ř. 687, začátek `ContextMenuContent` dnes ř. 1507–1511)
- Modify: `src/app/_components/TimelineGrid.tsx` (typ propů dnes ř. 304, destrukturace dnes ř. 635, `<BlockCard` dnes ř. 2322)
- Modify: `src/app/_components/PlannerPage.tsx` (import `BlockNotesDialog`, `canSeeNotes` dnes ř. 128, stav dnes ř. 130, prop `TimelineGrid` dnes ř. 3595, render za dialogem poznámek dnes ř. 3752)
- Test: `src/lib/historieAccessWiring.test.ts` (připsat)

**Interfaces:**
- Consumes: `BlockHistoryList` a `useBlockHistory` z Tasku 4; `allowlistOf` a `blockAudit` ze strážného souboru (Task 2); `LoadingSpinner` (default export) a `ErrorMessage` (default export, prop `message`) ze `src/components/ui/`; `machineLabel(machine: string): string` ze `src/lib/machines.ts`; `Z_OVERLAY.dialog` ze `src/lib/zLayers.ts`.
- Produces: `BlockHistoryDialog({ blockId, orderNumber, machine, onClose }: { blockId: number; orderNumber: string; machine: string; onClose: () => void })` — named export; prop `onOpenHistory?: (block: Block) => void` na `BlockCard` i `TimelineGrid`.

- [ ] **Step 1: Připiš strážné testy**

Na konec `src/lib/historieAccessWiring.test.ts` připiš:

```ts
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
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `node --test --import tsx src/lib/historieAccessWiring.test.ts`
Expected: tři nové testy FAIL (`showMenu` bez `!!onOpenHistory`; chybí `canSeeHistory`; `ENOENT … BlockHistoryDialog.tsx`), sedm dosavadních PASS.

- [ ] **Step 3: Vytvoř dialog**

Vytvoř `src/components/BlockHistoryDialog.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { BlockHistoryList } from "@/components/BlockHistoryList";
import ErrorMessage from "@/components/ui/ErrorMessage";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { useBlockHistory } from "@/hooks/useBlockHistory";
import { machineLabel } from "@/lib/machines";
import { Z_OVERLAY } from "@/lib/zLayers";

/**
 * Historie změn jedné zakázky v modálu (etapa 3 září 2026, volby E1 = A a E2 = A).
 *
 * Pro DTP a MTZ je to JEDINÁ cesta k historii — pravý panel s detailem bloku se
 * jim nerenderuje (`PlannerPage.tsx`, `canEdit`). Plánovač má historii i v detailu;
 * dialog mu nabízí totéž bez nutnosti blok vybrat. Obsah je shodný s detailem,
 * poznámky tiskaře rolím bez práva odstraňuje už server (`visibleHistoryFor`).
 *
 * Modál, ne boční panel: DTP má vlevo `DtpPanel` a na 1366 px by další boční
 * panel časovou osu udusil. Shell (překryv, `role="dialog"`, zavření Esc i klikem
 * mimo) odpovídá sdílenému `ConfirmDialog`.
 *
 * Číslo zakázky a stroj dostává jako SNÍMEK z chvíle otevření, ne odkaz do živého
 * seznamu bloků: historie bloku přežije jeho smazání i přesun a dialog se nesmí
 * zavřít jen proto, že blok mezitím smazal někdo jiný.
 */
export function BlockHistoryDialog({
  blockId,
  orderNumber,
  machine,
  onClose,
}: {
  blockId: number;
  orderNumber: string;
  machine: string;
  onClose: () => void;
}) {
  const history = useBlockHistory(blockId);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Klávesy pod otevřeným dialogem NESMÍ dojít ke globálnímu handleru planneru
    // (`PlannerPage.tsx`: keydown na window v bublací fázi, ignoruje jen INPUT,
    // TEXTAREA a SELECT). Dialog žádné pole nemá, takže bez téhle zarážky by pod
    // ním Ctrl+Z tiše vrátil poslední akci, Delete otevřel mazání vybraného bloku,
    // Ctrl+C místo zkopírování textu z historie ukázal toast a Esc smazal hledání.
    // Capture fáze na window běží před každým jiným posluchačem a stopPropagation
    // zastaví zbytek cesty včetně bublací fáze na window. Výchozí akce prohlížeče
    // (Tab, kopírování označeného textu, Enter na tlačítku) běží dál.
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    // Fokus na zavírací tlačítko se zpožděním převzatým z `BlockNotesDialog`,
    // který se otevírá touž cestou — položkou kontextového menu karty.
    const t = setTimeout(() => closeRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const subtitle = orderNumber ? `${orderNumber} · ${machineLabel(machine)}` : machineLabel(machine);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Z_OVERLAY.dialog,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Historie změn · ${subtitle}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--popover)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: "100%",
          maxWidth: 640,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          color: "var(--text)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Historie změn</div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {subtitle}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Zavřít"
            style={{
              background: "transparent",
              border: 0,
              color: "var(--text-muted)",
              fontSize: 22,
              cursor: "pointer",
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>
        {history.status === "loading" && <LoadingSpinner />}
        {history.status === "error" && (
          <ErrorMessage
            message={
              history.httpStatus === 403
                ? "K historii této zakázky nemáte přístup."
                : "Historii se nepodařilo načíst."
            }
          />
        )}
        {history.status === "ready" && history.entries.length === 0 && (
          <p style={{ margin: 0, padding: "24px 16px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
            Zatím žádné změny.
          </p>
        )}
        {history.status === "ready" && history.entries.length > 0 && <BlockHistoryList entries={history.entries} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Karta — prop, `showMenu` a položka v menu**

V `src/components/planner/BlockCard.tsx`:

(a) V destrukturaci propů nahraď řádek

```ts
  onOpenNotes,
```

tímto:

```ts
  onOpenNotes,
  onOpenHistory,
```

(b) V typu propů nahraď řádek

```ts
  onOpenNotes?: (block: Block) => void;
```

tímto:

```ts
  onOpenNotes?: (block: Block) => void;
  /** Otevře dialog historie změn (etapa 3 září 2026). PlannerPage ho předává rolím ADMIN, PLANOVAT, DTP a MTZ. */
  onOpenHistory?: (block: Block) => void;
```

(c) Nahraď

```ts
  const showMenu = (canEdit && !block.locked) || canEditMat || hasNote || !!onOpenNotes;
```

tímto:

```ts
  // `onOpenHistory` je jediná položka menu, kterou má DTP — bez něj by se mu
  // karta do ContextMenu vůbec nezabalila (`if (!showMenu) return blockDiv;` níž).
  const showMenu = (canEdit && !block.locked) || canEditMat || hasNote || !!onOpenNotes || !!onOpenHistory;
```

(d) Jako PRVNÍ potomek `<ContextMenuContent …>` — tedy hned za jeho otevírací tag a před `{canEdit && !block.locked && block.type === "ZAKAZKA" && (` se submenu „Stav zakázky" — vlož:

```tsx
        {/* Historie změn — pro všechny typy bloků i na zamčeném bloku, je to jen
            čtení (etapa 3 září 2026). Stojí první a bez oddělovače: u DTP je
            v menu jediná. */}
        {onOpenHistory && (
          <ContextMenuItem onClick={() => onOpenHistory(block)} style={menuItemStyle}>
            🕘 Historie změn
          </ContextMenuItem>
        )}
```

- [ ] **Step 5: `TimelineGrid` — průchod propu**

V `src/app/_components/TimelineGrid.tsx`:

(a) V typu propů nahraď řádek

```ts
  onOpenNotes?: (block: Block) => void;
```

tímto:

```ts
  onOpenNotes?: (block: Block) => void;
  onOpenHistory?: (block: Block) => void;
```

(b) V destrukturaci propů nahraď řádek

```ts
  onOpenNotes,
```

tímto:

```ts
  onOpenNotes,
  onOpenHistory,
```

(c) U `<BlockCard` nahraď řádek

```tsx
                      onOpenNotes={onOpenNotes}
```

tímto:

```tsx
                      onOpenNotes={onOpenNotes}
                      onOpenHistory={onOpenHistory}
```

Každý ze tří nahrazovaných řádků je v souboru právě jednou — ověř `grep -n "onOpenNotes" src/app/_components/TimelineGrid.tsx` (čekej 3 řádky).

- [ ] **Step 6: `PlannerPage` — role, snímek, prop, render**

V `src/app/_components/PlannerPage.tsx`:

(a) Za řádek s importem `BlockNotesDialog` (najdi `grep -n "BlockNotesDialog" src/app/_components/PlannerPage.tsx`) přidej:

```ts
import { BlockHistoryDialog } from "@/components/BlockHistoryDialog";
```

(b) Nahraď

```ts
  const canSeeNotes = canEdit || isTiskar;
```

tímto:

```ts
  const canSeeNotes = canEdit || isTiskar;
  // Historie jedné zakázky v dialogu z kontextového menu karty (etapa 3 září 2026).
  // Výčet MUSÍ být shodný s rolemi v GET /api/blocks/[id]/audit — položka, kterou
  // API odmítne, by v dialogu skončila hláškou „nemáte přístup".
  // Hlídá src/lib/historieAccessWiring.test.ts.
  const canSeeHistory = ["ADMIN", "PLANOVAT", "DTP", "MTZ"].includes(currentUser.role);
```

(c) Nahraď

```ts
  const [notesDialogBlockId, setNotesDialogBlockId] = useState<number | null>(null);
```

tímto:

```ts
  const [notesDialogBlockId, setNotesDialogBlockId] = useState<number | null>(null);
  // Snímek z chvíle otevření, ne id do živého `blocks` — viz BlockHistoryDialog.
  const [historyTarget, setHistoryTarget] = useState<{ id: number; orderNumber: string; machine: string } | null>(null);
```

(d) V propech `<TimelineGrid` nahraď řádek

```tsx
            onOpenNotes={canSeeNotes ? (b) => setNotesDialogBlockId(b.id) : undefined}
```

tímto:

```tsx
            onOpenNotes={canSeeNotes ? (b) => setNotesDialogBlockId(b.id) : undefined}
            onOpenHistory={canSeeHistory ? (b) => setHistoryTarget({ id: b.id, orderNumber: b.orderNumber, machine: b.machine }) : undefined}
```

(e) Za konec bloku s dialogem poznámek — za řádek `      })()}`, který uzavírá `{(() => { if (!canSeeNotes || notesDialogBlockId === null) return null; … })()}`, a před `      {dtpPopover && (` — vlož:

```tsx

      {historyTarget && (
        <BlockHistoryDialog
          blockId={historyTarget.id}
          orderNumber={historyTarget.orderNumber}
          machine={historyTarget.machine}
          onClose={() => setHistoryTarget(null)}
        />
      )}
```

- [ ] **Step 7: Testy, typová kontrola, celá suite, lint**

Run: `node --test --import tsx src/lib/historieAccessWiring.test.ts`
Expected: PASS — 10 testů.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 chyb.

Run:
```bash
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```
Expected: 0 selhání; počet testů = 1529 + 16 (Task 1) + 10 (strážný soubor) = 1555.

Run: `npm run lint`
Expected: 0 chyb, nejvýš 32 warningů.

- [ ] **Step 8: Commit**

```bash
git add src/components/BlockHistoryDialog.tsx src/components/planner/BlockCard.tsx src/app/_components/TimelineGrid.tsx src/app/_components/PlannerPage.tsx src/lib/historieAccessWiring.test.ts
git commit -m "$(cat <<'EOF'
feat(historie): dialog historie zakázky z kontextového menu karty

Pravý klik na kartu → „🕘 Historie změn" pro ADMIN, PLANOVAT, DTP a MTZ
(volby H2 = B, E1 = A, E2 = A), všechny typy bloků i zamčený blok. DTP
dřív kontextové menu na kartě neměl vůbec — showMenu teď počítá
s onOpenHistory. Dialog zachytává klávesy ve fázi capture, jinak by pod
ním běželo Ctrl+Z, Delete i Esc planneru. Výčet rolí v planneru je
strážným testem svázaný s výčtem v API.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Dokumentace — CLAUDE.md a historie vývoje

**Files:**
- Modify: `CLAUDE.md` (sekce „Role a přístup", „Design tokens a vizuální konvence", „Klíčové soubory")
- Modify: `docs/vyvoj-historie.md` (připsat na konec)

**Interfaces:**
- Consumes: hotový stav Tasků 1–5. Každé tvrzení v textu níž musí odpovídat kódu — revize tasku to ověřuje proti zdrojákům, ne proti plánu.
- Produces: nic.

- [ ] **Step 1: Tabulka rolí v CLAUDE.md**

V sekci „Role a přístup" nahraď celou tabulku:

```markdown
| Role | Planner | Rezervace | Admin | Reporty | Notifikace |
| --- | --- | --- | --- | --- | --- |
| `ADMIN` | plný edit | ano | plný | ano | audit + historie |
| `PLANOVAT` | plný edit | ano | omezený admin (číselníky/presety/prac. doba) | ano | audit + historie |
| `DTP` | edit DATA | ne | ne | ne | vlastní inbox |
| `MTZ` | edit MATERIÁL | ne | ne | ne | vlastní inbox |
| `OBCHODNIK` | read-only | vlastní rezervace | ne | ne | vlastní inbox |
| `TISKAR` | read-only + tisk (režim `isTiskar` na `/`) | ne | ne | ne | ne |
| `VIEWER` | read-only | ne | ne | ne | ne |
```

touto:

```markdown
| Role | Planner | Rezervace | Admin | Reporty | Historie zakázky | Notifikace |
| --- | --- | --- | --- | --- | --- | --- |
| `ADMIN` | plný edit | ano | plný | ano | ano | audit + historie |
| `PLANOVAT` | plný edit | ano | omezený admin (číselníky/presety/prac. doba/audit log) | ano | ano | audit + historie |
| `DTP` | edit DATA | ne | ne | ne | ano, bez poznámek tiskaře | vlastní inbox |
| `MTZ` | edit MATERIÁL | ne | ne | ne | ano, bez poznámek tiskaře | vlastní inbox |
| `OBCHODNIK` | read-only | vlastní rezervace | ne | ne | ne | vlastní inbox |
| `TISKAR` | read-only + tisk (režim `isTiskar` na `/`) | ne | ne | ne | ne | ne |
| `VIEWER` | read-only | ne | ne | ne | ne | ne |
```

- [ ] **Step 2: Odstavec o místech, která drží historii na rolích**

V téže sekci, hned za odstavec končící větou `… — `/report/daily` (tiskový přehled dne) je jiný modul s vlastním gate (dnes rovněž `ADMIN` + `PLANOVAT`).`, vlož prázdný řádek a tento odstavec:

```markdown
**Historie drží na rolích ČTYŘI místa ve dvou dvojicích** (etapa 3 září 2026) a obě
dvojice se rozpojí tiše. Audit log ve Správě: `/api/audit` a `/api/audit/filters`
musí pouštět totéž (`ADMIN` + `PLANOVAT`) — otevřený seznam bez faset dá plánovači
log s prázdnými filtry a žádnou chybu. Historie jedné zakázky (dialog z kontextového
menu karty, `BlockHistoryDialog`): role v `GET /api/blocks/[id]/audit` a
`canSeeHistory` v `PlannerPage.tsx` musí být shodné (`ADMIN` + `PLANOVAT` + `DTP` +
`MTZ`) — položka, kterou API odmítne, skončí hláškou „nemáte přístup". Poznámky
tiskaře (`NOTE_*`) z historie odstraňuje `visibleHistoryFor` (`src/lib/blockHistory.ts`)
každé roli bez `canAccessBlockNotes`, jako poslední krok routy. DTP a MTZ do
Správy dál nesmí. Hlídá `src/lib/historieAccessWiring.test.ts`.
```

- [ ] **Step 3: Konvence kláves pod modálem**

V sekci „Design tokens a vizuální konvence" vlož hned za odrážku začínající `- **Z-index** výhradně přes` novou odrážku:

```markdown
- **Modál nad plannerem bez textového pole musí klávesy zachytit sám.** Globální handler
  v `PlannerPage.tsx` (keydown na `window`, bublací fáze) ignoruje jen `INPUT`/`TEXTAREA`/`SELECT`,
  takže pod modálem by jinak běželo Ctrl+Z (undo), Delete (mazání vybraného bloku), Ctrl+C
  (toast místo kopírování textu) i Esc (zrušení výběru a hledání). Vzor: `BlockHistoryDialog.tsx`
  — posluchač na `window` v capture fázi + `stopPropagation()`. `BlockNotesDialog` to nedělá;
  chrání ho jen to, že fokus obvykle stojí v jeho textovém poli.
```

- [ ] **Step 4: Index klíčových souborů**

V sekci „Klíčové soubory", odstavec **Revize bloků (černá skříňka, etapa B1):**, nahraď

```markdown
`blockHistory.ts` (`BlockHistoryEntry`, sloučená osa)
```

tímto:

```markdown
`blockHistory.ts` (`BlockHistoryEntry`, sloučená osa; `visibleHistoryFor` — filtr poznámek tiskaře podle role; `readBlockHistoryResponse`/`pickLoadedHistory` — stav načítání v klientu) · `src/components/BlockHistoryList.tsx` + `src/hooks/useBlockHistory.ts` (řádky a jediné načítání historie — sdílí detail bloku i `BlockHistoryDialog.tsx`)
```

- [ ] **Step 5: Záznam do historie vývoje**

Na konec `docs/vyvoj-historie.md` připiš:

```markdown

## Historie pro plánovače a pre-press (etapa 3 září 2026, 5. 10. 2026)

**Zadání.** Tři body zářijové vlny: pre-press (DTP) nevidí, kdo a kdy zakázku změnil;
historie v detailu zakázky končí po dvaceti řádcích z každého zdroje; a plánovač nemá
audit log. Spec: `docs/superpowers/specs/2026-10-05-historie-pro-planovace-a-pre-press-design.md`.

**Dvě plochy, dva adresáti.** Volby H1 (audit log ve Správě) a H2 (historii vidí i DTP
a MTZ) vypadaly jako rozpor — do `/admin` DTP ani MTZ nesmí. Míří ale na jiné body
zadání: plný audit log chtěl plánovač, pre-press chtěl historii jedné zakázky. Správa
proto zůstala `ADMIN` + `PLANOVAT` a middleware se nezměnil.

**Audit log pro plánovače.** Záložka „Audit log" ve Správě je vidět i roli PLANOVAT;
`/api/audit` (seznam) a `/api/audit/filters` (fasety) pouštějí oba shodným výčtem —
otevřený samotný seznam by dal plánovači log s prázdnými rozbalovátky filtrů a žádnou
chybu. „Uživatelé" a „Přihlášení" zůstávají ADMINovi. Důsledek: plánovač vidí ve
filtru seznam všech účtů s rolemi (faseta uživatelů), nic víc.

**Historie zakázky pro DTP a MTZ.** Pravý klik na kartu bloku → „🕘 Historie změn"
otevře `BlockHistoryDialog` — modál, ne boční panel, protože DTP má vlevo `DtpPanel`
a na 1366 px by další panel časovou osu udusil. Položka je pro ADMIN, PLANOVAT, DTP
i MTZ, pro všechny typy bloků i na zamčeném bloku. DTP dřív kontextové menu na kartě
vůbec neměl — `showMenu` v `BlockCard.tsx` teď počítá i s `onOpenHistory`. Řádky
historie se z `BlockDetail.tsx` doslova přesunuly do `BlockHistoryList.tsx` a načítá
je jediný hook `useBlockHistory`; detail vypadá stejně jako dřív, jen po přepnutí bloku
už neukazuje historii předchozího, dokud nedoběhne nový dotaz. Dialog drží snímek
bloku z chvíle otevření, takže se nezavře, když blok mezitím někdo smaže.

**Poznámky tiskaře.** Text poznámky je v auditu (`NOTE_CREATE` v `newValue`,
`NOTE_UPDATE` v obou polích, `NOTE_DELETE` v `oldValue`) a DTP ani MTZ ho vidět nesmí.
`visibleHistoryFor` (`src/lib/blockHistory.ts`) ty řádky odstraní každé roli bez
`canAccessBlockNotes` — je to allowlist, takže nová role dostane historii bez poznámek,
ne s nimi. Běží jako poslední krok routy, za řazením, takže DTP vidí přesně to, co
plánovač, minus poznámky. Revize se nefiltrují nikdy.

**Chyba nevypadá jako prázdno.** Detail bloku dřív mapoval každou chybovou odpověď na
prázdnou historii. Dialog rozlišuje odmítnutí (403 → „K historii této zakázky nemáte
přístup."), jinou chybu a skutečně prázdnou historii (`readBlockHistoryResponse`, P32).

**Limit.** `PER_SOURCE_LIMIT` v `GET /api/blocks/[id]/audit` je 100 místo 20 (volba
H3 = C, bez stránkování). Dál platí na každý zdroj zvlášť — společný strop na sloučený
seznam by vytlačil revize.

**Klávesy pod modálem.** Globální handler planneru poslouchá na `window` a ignoruje
jen vstupní pole, takže pod dialogem bez pole by běželo Ctrl+Z, Delete, Ctrl+C i Esc.
Dialog proto klávesy zachytává ve fázi capture a dál je nepustí. Zapsáno do CLAUDE.md
jako konvence pro každý další modál nad plánem.

**Hlídá** `src/lib/historieAccessWiring.test.ts` (shoda obou dvojic výčtů, filtr na
každé úspěšné odpovědi, záložka ve Správě, menu pro DTP, jediné místo načítání,
zachytávání kláves) a testy čistých funkcí v `src/lib/blockHistory.test.ts`.

**Stranou zůstalo:** retence revizí (90 dní, H4 = A), stránkování historie, plný audit
log pro DTP a MTZ, login log pro plánovače a vstup do historie přímo z karty
v `DtpPanel` (DTP jde přes klik v panelu → doskrolování → pravý klik na kartu v plánu).
```

- [ ] **Step 6: Ověř tvrzení proti kódu**

Run:
```bash
grep -n "canSeeHistory = \|onOpenHistory={canSeeHistory" src/app/_components/PlannerPage.tsx
grep -n "includes(session.role)" src/app/api/audit/route.ts src/app/api/audit/filters/route.ts "src/app/api/blocks/[id]/audit/route.ts"
grep -n "PER_SOURCE_LIMIT = \|visibleHistoryFor(" "src/app/api/blocks/[id]/audit/route.ts"
grep -n "addEventListener(\"keydown\"" src/components/BlockHistoryDialog.tsx src/components/BlockNotesDialog.tsx src/app/_components/PlannerPage.tsx
```
Expected: `canSeeHistory` se čtyřmi rolemi a prop pod ním; dva allowlisty `["ADMIN", "PLANOVAT"]` a jeden se čtyřmi rolemi; `PER_SOURCE_LIMIT = 100` a volání `visibleHistoryFor(`; v dialogu historie posluchač s `true`, v `BlockNotesDialog` a `PlannerPage` bez něj — tedy přesně to, co text tvrdí.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md docs/vyvoj-historie.md
git commit -m "$(cat <<'EOF'
docs: etapa 3 — historie pro plánovače a pre-press v CLAUDE.md a historii vývoje

Tabulka rolí dostala sloupec Historie zakázky a audit log u PLANOVAT,
přibyl odstavec o čtyřech místech, která drží historii na rolích,
a konvence pro klávesy pod modálem nad plannerem.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Ověření v prohlížeči (provádí kontrolér, ne subagent)

**Files:** žádné změny v repu. Playwright běží ve scratchpadu session (postup v paměti `screenshot_bezici_appky`: Playwright NE do projektu, přihlášení na devu `jméno = heslo`, login rate limit 10 pokusů / 15 min, po čerstvém startu serveru `waitUntil: "networkidle"` + 4 s před vyplněním formuláře).

**Interfaces:** ověřuje hotový stav Tasků 1–6.

- [ ] **Step 1: Dev server a data**

Ověř `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/health` → 200; jinak spusť vlastní dev server na portu 3001 na pozadí (nikdy nesahat na Vojtův server na jiném portu). Dev DB nemá žádný živý blok s řádky `NOTE_*` a všechny bloky leží před dneškem, proto data založ: `npx tsx prisma/seed-monitor.ts` (bloky relativně k „teď"). Na jednom ZAKAZKA bloku ze seedu jako `planovac` přes `page.evaluate(fetch…)`: (a) založ poznámku tiskaře `POST /api/blocks/<id>/notes` s tělem `{ "text": "PROKLIK-POZNAMKA-TISKARE" }`, (b) uprav ji (`PUT /api/blocks/<id>/notes/<noteId>`), (c) 25× změň `expediceNote` a (d) 25× změň `description`, obojí přes `PUT /api/blocks/<id>` (`expectedUpdatedAt` je nepovinný). `expediceNote` je v `AUDITED_FIELDS` → 25 auditních řádků; `description` v nich NENÍ → 25 revizí. Každý zdroj tak sám přeleze starý limit 20.

- [ ] **Step 2: Jako `planovac` (PLANOVAT)**

1. Správa → záložka „Audit log" je vidět, seznam se načte, rozbalovátka uživatelů a akcí nejsou prázdná, filtr „Poznámky" ukáže řádky `PROKLIK-POZNAMKA-TISKARE`. Záložky „Uživatelé" a „Přihlášení" vidět nejsou.
2. Planner → klik na připravený blok → detail má sekci „Historie změn" vizuálně shodnou s dneškem (rámeček, nadpis, seznam vysoký 220 px, scrolluje) a obsahuje řádky poznámky tiskaře.
3. Pravý klik na kartu → „🕘 Historie změn" je PRVNÍ položka menu → dialog ukáže totéž a seznam v něm scrolluje. Odpověď `page.evaluate(() => fetch("/api/blocks/<id>/audit").then(r => r.json()))` má víc než 40 položek a víc než 20 z KAŽDÉHO zdroje (`source: "audit"` i `source: "revision"`) — za starého limitu 20 + 20 by nešlo ani jedno.
4. **Klávesy pod dialogem:** s vybraným blokem v detailu otevři dialog a stiskni Ctrl+Z, Delete a Ctrl+C — nic se nesmí stát (žádné undo v toastu, žádný potvrzovací dialog mazání, žádný toast „Žádný blok není vybrán"). Esc zavře JEN dialog — pole hledání a výběr bloku zůstanou.

- [ ] **Step 3: Jako `dtp` (DTP) a `mtz` (MTZ)**

1. Pravý klik na připravenou kartu → menu se objeví, „🕘 Historie změn" v něm je → dialog s řádky; **text `PROKLIK-POZNAMKA-TISKARE` v dialogu NENÍ** a není ani v odpovědi API (`page.evaluate(fetch…)` → `JSON.stringify` ho neobsahuje).
2. Totéž na bloku údržby a rezervace ze seedu (položka je pro všechny typy).
3. Esc i klik mimo dialog ho zavřou.
4. Jako `mtz`: poznámka MTZ (`materialNote`), je-li na bloku, v historii vidět JE.
5. Do `/admin` se `dtp` ani `mtz` nedostane (přesměrování na `/`).

- [ ] **Step 4: Úklid a zápis**

`npx tsx prisma/seed-monitor.ts --clean`. Výsledek prokliku zapiš do ledgeru SDD (prošlo / co neprošlo, s čísly), nálezy řeš před integrací větve.

---

## Po dokončení všech úkolů

1. **Celá suite, build a lint naposledy:**
   ```bash
   node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
   npm run build
   npm run lint
   ```
2. **Nenasazovat samo.** Etapa 3 jde na test 3021 **spolu s etapou 2** (etapa 1 tam už je) — rozhodnutí Vojty 16. 9. 2026 „všechno najednou"; produkce potom taky naráz přes větev `michal`, s `mysqldump` zálohou a PRE/POST otiskem `sum_secs`. Cestu nasazení potvrdit s Vojtou před prvním krokem.
3. **Měření výkonu na testu 3021 (kopie produkce) — podmínka pro produkci.** Vojta na serveru jedním řádkem najde nejrušnější bloky:
   ```bash
   sudo mysql igvyroba_test -e "SELECT blockId, COUNT(*) n FROM AuditLog WHERE blockId > 0 GROUP BY blockId ORDER BY n DESC LIMIT 3; SELECT blockId, COUNT(*) n FROM BlockRevision GROUP BY blockId ORDER BY n DESC LIMIT 3;"
   ```
   Kontrolér pak přes Playwright s dočasným účtem PLANOVAT (založí ho Vojta, po měření se smaže; nikdy nežádat Vojtovo heslo) pro každý z těch bloků 5× změří `page.evaluate` s `performance.now()` kolem `fetch("/api/blocks/<id>/audit")` a zapíše medián, maximum, počet položek a velikost odpovědi v kB (`(await r.text()).length`, spec riziko 5). **Mez: maximum pod 300 ms.** Při překročení nasadit připravenou náhradu z Rozhodnutí 8 (`groupRows` přes `viaMany: false` + `distinct`), znovu změřit, teprve pak produkce.
4. **Říct Lukášovi a DTP dopředu,** kde historii najdou (pravý klik na kartu) a že poznámky tiskaře v ní neuvidí záměrně.
5. **Superpowers:finishing-a-development-branch** až po Vojtově prokliku, ne dřív.
