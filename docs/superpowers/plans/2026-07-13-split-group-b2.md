# Split skupina — varianta B2 (dedikovaná tabulka `SplitGroup`) — implementační plán

> **Pro agentické workery:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (doporučeno) nebo superpowers:executing-plans, task po tasku. Kroky používají checkbox (`- [ ]`).

**Cíl:** Odstranit root cause bugu „smazání kořene split skupiny rozpustí skupinu a Ctrl+Z ji neobnoví na N/N" tím, že identita skupiny přestane být PK jejího člena a stane se samostatnou entitou (`SplitGroup` tabulka), jejíž řádek přežije smazání kteréhokoli bloku.

**Architektura:** `Block.splitGroupId` (sloupec i hodnoty) **zůstává**, jen jeho FK se přebodová ze self-referenční vazby `Block.id` na novou stabilní tabulku `SplitGroup.id`. Migrace nastaví `SplitGroup.id` = existující root PK, takže **žádný `Block` řádek se nemění** a všech dnešních 17 skupin zůstane seskupených beze změny hodnot. Tvorba splitu přejde na **serverový atomický endpoint** `POST /api/blocks/[id]/split`. Undo se zjednoduší — `restoreSplitGroupId` FK-gymnastika **zaniká**.

**Tech stack:** Next.js 16 App Router, React, TypeScript, Prisma 5, MySQL. Testy: `node --test --import tsx` (node:test).

> **Verze plánu:** v2 (2026-07-13) — zpevněno po multi-agent red-teamu (28 ověřených nálezů, 4 CRITICAL). Změny oproti v1 jsou označené `[RT#…]` u dotčených tasků a shrnuté v sekci „Red-team zpevnění" na konci.

## Globální omezení

- Větev **`Vojta`** (nikdy nepřepínat na michal). Checkpoint po KAŽDÉ fázi: `npm run build` + celá lib suite zelená + commit + **OK od Vojty** před další fází. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Nic se nedeployuje na produkci piecemeal.** Migrace + VŠECHNY kódové změny jsou **jeden deploy unit** s pořadím **build → app-stop → migrace → app-start** (Fáze 7). Po přebodování FK starý split kód (`PUT {splitGroupId: block.id}`) spadne na FK violation → migrace bez nového split endpointu a bez zastavené app rozbije dělení bloků.
- **INVARIANT „SplitGroup se nikdy nemaže, dokud na ni ukazuje jakýkoli Block NEBO existuje pending undo"** [RT#26/#17]. Nový FK je `ON DELETE SET NULL` — smazání řádku `SplitGroup` s živými členy by je tiše rozpustilo (regrese původního bugu). Žádný cleanup osiřelých řádků není ve scope; řádky jsou levné a jejich persistence je pro undo ŽÁDOUCÍ. Do CLAUDE.md zapsat jako tvrdé pravidlo.
- **`splitGroupId` je zapisovatelný VÝHRADNĚ:** (a) novým endpointem `/split`, (b) undo re-POSTem přes `POST /api/blocks` (posílá platný, deleci přeživší `SplitGroup.id`). PUT `/api/blocks/[id]` ho po B2 **NESMÍ** zapisovat z těla requestu (task 3.5) [RT#6/#7].
- **Prisma gotcha (CLAUDE.md:179):** NIKDY nespouštět `prisma db pull` ani `prisma format`. Novou relaci pojmenovat explicitně (`"BlockSplitGroup"`); po editaci schématu jen `prisma generate` + `git diff schema.prisma` (nepřejmenovaly se Reservation/recurrence relace).
- **UNSIGNED FK (errno 150):** `Block.id` i `Block.splitGroupId` jsou v produkci `int(10) unsigned`. `SplitGroup.id` MUSÍ být `INT UNSIGNED`. Schema-level zůstává `Int` (konvence — UNSIGNED v migrační SQL).
- **Produkce (potvrzeno sondou):** FK `Block_splitGroupId_fkey` (SET NULL/CASCADE), id+splitGroupId `int(10) unsigned`, **17 skupin / 34 částí, 0 bezhlavých**. Deploy přes Prisma migrace (ne `mysql-schema.sql`).
- Standardy: `AppError` + `logger` + `requireRole` v API routes; nové lib funkce s unit testy; `if (e.button !== 0) return`; audit každé mutace v `$transaction`.

## Mapa souborů

| Soubor | Akce | Odpovědnost |
|---|---|---|
| `prisma/schema.prisma` | Modify | model `SplitGroup`; `Block.splitGroupId` relace self→SplitGroup |
| `prisma/migrations/<ts>_split_group_table/migration.sql` | Create (ruční edit) | tabulka (+charset) + backfill + přebodování FK |
| `src/lib/blockPayload.ts` | Modify | smazat `restoreSplitGroupId`; `opts.splitGroupId` beze změny |
| `src/lib/blockPayload.test.ts` | Modify | přepsat split testy |
| `src/lib/splitCompute.ts` | **Create** | čistá pm math (head/tail) + 30min alignment guard |
| `src/lib/splitCompute.test.ts` | **Create** | unit testy pm math |
| `src/app/api/blocks/[id]/split/route.ts` | **Create** | atomický split endpoint |
| `src/app/api/blocks/[id]/route.ts` | Modify | **PUT: `delete allowed.splitGroupId`** [RT#6/#7]; propagace komentář; DELETE beze změny |
| `src/app/api/blocks/route.ts` | Modify | **POST: guard splitGroupId → existující SplitGroup, jinak 422** [RT#6] |
| `src/app/_components/TimelineGrid.tsx` | Modify | `handleSplitBlockAt` → volání endpointu; `splitGroupMap` beze změny |
| `src/app/_components/PlannerPage.tsx` | Modify | undo delete cesty (bez `restoreSplitGroupId`); propagace bez `OR id`; split callback |
| `src/app/api/blocks/[id]/expedition/route.ts` | Modify | odstranit `OR { id: splitGroupId }` (2×) |
| `src/components/BlockDetail.tsx` | Modify | odstranit `|| b.id === block.splitGroupId` |
| `src/components/BlockEdit.tsx` | Modify | odstranit `|| b.id === block.splitGroupId` |
| `src/lib/blockShades.ts` + `.test.ts` | Modify | `orderIdentity` namespace |
| `src/lib/undo/commands.ts` | **(FK konzument — bez změny kódu)** [RT#17] | re-POST nese splitGroupId; zdokumentovat vazbu na SplitGroup lifecycle |
| `scripts/seed-shade-alternation-dev.ts` | Modify | zakládat `SplitGroup` řádek |
| `scripts/restore-igvyroba-from-import.sql` | **(legacy — poznámka)** [RT#27] | při ne-null splitGroupId nutno nejdřív naplnit SplitGroup |
| `deploy.sh` / deploy docs | Modify | app-stop + build-first + rollback runbook (Fáze 7) |
| `CLAUDE.md` + memory | Modify | model, endpoint, invarianty, testy |

---

## Fáze 0 — Baseline & bezpečnost (S)

- [ ] **0.1** Ověřit větev `Vojta` + čistý strom.
- [ ] **0.2** Baseline zelené: `npm run build` + `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts` (385/385).
- [ ] **0.3** Dev DB snapshot: `mysqldump` dev `IGvyroba` do scratch. Otisk: `SELECT COUNT(DISTINCT splitGroupId) FROM Block WHERE splitGroupId IS NOT NULL;`.

---

## Fáze 1 — DB foundation: tabulka `SplitGroup` + přebodování FK (M) — nejvyšší riziko

- [ ] **1.0 Grep gate PŘED úpravou schématu** [RT#16]: `grep -rn 'Block_Block_splitGroupIdToBlock\|other_Block_Block_splitGroupIdToBlock' src/` — očekává **0 shod** (self-relace se nikde v `src/` nepoužívá). Pokud by shoda existovala, řešit PŘED přebodováním dev DB (build je TS brána až v 1.6, tj. pozdě).
- [ ] **1.1 schema.prisma — model + relace.** Odstranit self-relaci (ř. 81–82), přidat:
  ```prisma
  splitGroup                                  SplitGroup?  @relation("BlockSplitGroup", fields: [splitGroupId], references: [id])
  ```
  Zachovat `splitGroupId Int?` (ř. 63) + `@@index([splitGroupId])`. Přidat model:
  ```prisma
  model SplitGroup {
    id        Int      @id @default(autoincrement())
    createdAt DateTime @default(now())
    blocks    Block[]  @relation("BlockSplitGroup")
  }
  ```
- [ ] **1.2** `npx prisma migrate dev --create-only --name split_group_table`. NEspouštět `prisma format`.
- [ ] **1.3 Ruční edit migrace** — přepsat na tento přesný obsah [RT#5 charset; RT#14 pořadí]:
  ```sql
  -- CreateTable: identita skupiny je samostatná entita (přežije smazání člena).
  -- Charset explicitně dle konvence všech migrací projektu (utf8mb4_unicode_ci).
  CREATE TABLE `SplitGroup` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

  -- Backfill: jeden řádek na existující skupinu, id = staré root PK → 0 změn Block řádků.
  INSERT INTO `SplitGroup` (`id`, `createdAt`)
  SELECT DISTINCT `splitGroupId`, NOW(3)
  FROM `Block`
  WHERE `splitGroupId` IS NOT NULL;

  -- Přebodovat FK: self (Block.id) → SplitGroup.id.
  -- POZOR: DDL v MySQL je auto-commit → tyto tři statementy NEJSOU jedna transakce.
  -- Bezpečnost proti half-applied stavu zajišťuje Fáze 7 (app-stop + orphan pre-check
  -- SELECT=0 + UNSIGNED gate PŘED migrací), ne atomicita samotné migrace.
  ALTER TABLE `Block` DROP FOREIGN KEY `Block_splitGroupId_fkey`;
  ALTER TABLE `Block`
    ADD CONSTRAINT `Block_splitGroupId_fkey`
    FOREIGN KEY (`splitGroupId`) REFERENCES `SplitGroup`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
  ```
- [ ] **1.4 Aplikovat na dev + ověřit** (`npx prisma migrate dev` + `npx prisma generate`):
  - `SHOW CREATE TABLE SplitGroup;` → `id INT UNSIGNED`, `DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci` [RT#5].
  - `SHOW CREATE TABLE Block;` → FK `Block_splitGroupId_fkey REFERENCES SplitGroup(id)`.
  - `SELECT COUNT(*) FROM SplitGroup;` = dev otisk z 0.3.
  - **Diff Block řádků před/po** (0.3 snapshot): `startTime/endTime/machine/printMinutes/splitGroupId` IDENTICKÉ.
  - **Orphan check** [RT#14]: `SELECT COUNT(*) FROM Block b LEFT JOIN SplitGroup g ON b.splitGroupId=g.id WHERE b.splitGroupId IS NOT NULL AND g.id IS NULL;` = 0.
- [ ] **1.5** `git diff prisma/schema.prisma` — jen self-split relace → `splitGroup` + nový model, nic jiného přejmenováno.
- [ ] **1.6** `npm run build` (0 chyb).

**Checkpoint 1:** build + testy zelené · dev DB ověřena (charset, UNSIGNED, FK cíl, 0 Block změn, 0 orphanů) → commit `feat(split): tabulka SplitGroup + přebodování FK (B2 fáze 1)` → OK.

> ⚠ Po Checkpointu 1 je dev DB na novém FK. Starý split kód spadne (opraví Fáze 3). Dev app se plně smoke-testuje až po Fázi 5.

---

## Fáze 2 — Undo simplifikace: konec `restoreSplitGroupId` (S)

- [ ] **2.1 Test-first — přepsat `blockPayload.test.ts` split sekci.** Smazat 4 testy `restoreSplitGroupId` (ř. 126–140) + import (ř. 3). Ponechat `:110/:115/:120`. Přidat:
  ```ts
  test("B2: undo posílá splitGroupId bezpodmínečně (SplitGroup řádek přežije deleci)", () => {
    assert.equal(blockToCreatePayload(FULL_BLOCK, { splitGroupId: 42 }).splitGroupId, 42);
    assert.equal(blockToCreatePayload({ ...FULL_BLOCK }, { splitGroupId: null }).splitGroupId, null);
  });
  ```
- [ ] **2.2 Smazat `restoreSplitGroupId`** z `blockPayload.ts` (ř. 166–185). `blockToCreatePayload` + `opts.splitGroupId` beze změny.
- [ ] **2.3 PlannerPage single delete (~ř. 1710):** `blockToCreatePayload(block, { splitGroupId: block.splitGroupId ?? undefined })` + aktualizovat komentář (self-FK logika zaniká; SplitGroup řádek deleci přežije).
- [ ] **2.4 PlannerPage multi delete (~ř. 1778):** `restoreSplitGroupId(b, deletedIds)` → `b.splitGroupId ?? undefined`; komentář dtto. Odstranit import `restoreSplitGroupId` z `PlannerPage.tsx`.
- [ ] **2.5 Dokumentace vazby undo × SplitGroup lifecycle** [RT#17/#22]: do komentáře u undo cest + do CLAUDE.md (fáze 6.3) zapsat, že SplitGroup řádek se NIKDY nemaže dokud může existovat pending undo (jinak by re-POST spadl na FK). Cross-client edge (undo listu, jehož skupinu mezitím jiný klient smazal → obnovený sirotek s ✂1/1) je **known-limit** — přijatelný (lepší než dnešní FK violation), zdokumentovat.
- [ ] **2.6** Run `blockPayload.test.ts` + `undo/commands.test.ts` (`:248` beze změny) + `npm run build`.

**Checkpoint 2:** build + suite zelená (−4 → **381**) → commit `refactor(split): undo bezpodmínečné splitGroupId, restoreSplitGroupId smazán (B2 fáze 2)` → OK.

---

## Fáze 3 — Atomický split endpoint + přepojení klienta (L) — jádro

**Interfaces:** `POST /api/blocks/[id]/split` body `{ splitAt: string, expectedUpdatedAt: string }` → `{ head, tail, shifted }`; `computeSplitPrintMinutes(...)` v `src/lib/splitCompute.ts`.

- [ ] **3.1 `src/lib/splitCompute.ts`** (test-first) — čistá pm math z `TimelineGrid.tsx:2762–2801` + **30min alignment guard** [RT#20]:
  ```ts
  export type SplitPmResult =
    | { ok: true; headPm: number | null; tailPm: number | null }
    | { ok: false; reason: "IN_PAUSE" | "DEGENERATE" | "NOT_ALIGNED" };

  export function computeSplitPrintMinutes(args: {
    type: string; scheduleBypassed: boolean; machine: string;
    startTime: Date; splitAt: Date; totalPrintMinutes: number | null;
    weekShifts: WeekShift[]; companyDayIntervals: CompanyDayInterval[];
  }): SplitPmResult {
    if (args.type !== "ZAKAZKA") return { ok: true, headPm: null, tailPm: null };
    const total = args.totalPrintMinutes ?? 0;
    let headPm: number;
    if (args.scheduleBypassed) {
      headPm = Math.round((args.splitAt.getTime() - args.startTime.getTime()) / 60000);
    } else {
      if (!isMachineRunnableAt(args.machine, args.splitAt, args.weekShifts, args.companyDayIntervals))
        return { ok: false, reason: "IN_PAUSE" };
      headPm = computePrintMinutes(args.machine, args.startTime, args.splitAt, args.weekShifts, args.companyDayIntervals);
    }
    const tailPm = total - headPm;
    if (headPm <= 0 || tailPm <= 0) return { ok: false, reason: "DEGENERATE" };
    // Guard: legacy/bypass blok s nezarovnaným total by dal nenásobek 30 → validateAndComputeEnd
    // tail by spadl na obecné INVALID_INPUT 422; radši doménová hláška předem.
    if (headPm % 30 !== 0 || tailPm % 30 !== 0) return { ok: false, reason: "NOT_ALIGNED" };
    return { ok: true, headPm, tailPm };
  }
  ```
  Testy: ne-ZAKAZKA→null/null; bypass elapsed; runnable; IN_PAUSE; DEGENERATE; **NOT_ALIGNED** (bypass nezarovnaný start).
- [ ] **3.2 TimelineGrid `handleSplitBlockAt`** — nahradit 3-request orchestr (ř. 2762–2941 celý včetně LIFO) voláním endpointu. Klientský pre-guard (runnable) ponechat pro rychlou UX; posílat `splitAt` + `expectedUpdatedAt: block.updatedAt`. **`shifted` připnout POUZE k hlavě, tail bez shifted** [RT#19]:
  ```ts
  const res = await fetch(`/api/blocks/${block.id}/split`, { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ splitAt: splitAt.toISOString(), expectedUpdatedAt: block.updatedAt }) });
  if (!res.ok) { const e = await res.json().catch(()=>({})); callbacksRef.current.onError?.(e.error ?? "Blok se nepodařilo rozdělit."); return; }
  const { head, tail, shifted } = await res.json();
  onBlockUpdate({ ...head, shifted });   // shifted nese JEN head
  onBlockCreate(tail);                    // tail bez shifted
  ```
- [ ] **3.3 Endpoint `src/app/api/blocks/[id]/split/route.ts`** — struktura (composuje existující helpery; VŠECHNY níže uvedené invarianty jsou POVINNÉ, opsané z red-teamu):
  ```
  1. requireRole(["ADMIN","PLANOVAT"])
  2. parse { splitAt, expectedUpdatedAt }
  3. $transaction:
     a. block = tx.$queryRaw(SELECT ... FOR UPDATE) NEBO findUnique + expectedUpdatedAt guard  [RT#21]
        - guard: block existuje; block.updatedAt === expectedUpdatedAt (jinak 409 "Blok byl mezitím změněn")
        - guard: block.printCompletedAt == null (jinak 422 "Nelze rozdělit vytištěný blok")  [RT#9]
          (locked blok split trigger klient negeneruje — server guard je defenzivní)
        - guard: start < splitAt < end na ČERSTVÉM endTime  [RT#21]
     b. loadMachineCalendar(machine, okno) → weekShifts + companyDayIntervals
     c. computeSplitPrintMinutes(...) → 422 IN_PAUSE/DEGENERATE/NOT_ALIGNED s doménovou hláškou  [RT#20]
     d. groupId = block.splitGroupId ?? (await tx.splitGroup.create({ data:{} })).id
     e. HLAVA: schedH = validateAndComputeEnd(tx, machine, block.startTime, headPm, splitAt, type, headBypass)  [RT#1]
        tx.block.update(head): { endTime: schedH.end,  // NIKDY syrový splitAt
                                 splitGroupId: groupId,
                                 ...(ZAKAZKA ? { printMinutes: headPm, scheduleBypassed: schedH.effectivelyBypassed } : {}) }
     f. TAIL: schedT = validateAndComputeEnd(tx, machine, splitAt, tailPm, block.endTime, type, tailBypass)
        tx.block.create(tail): { ...VŠECHNA SPLIT_SHARED_FIELDS zkopírovaná z načteného `block`  [RT#10],
                                 orderNumber, machine, type, blockVariant, startTime: splitAt,
                                 endTime: schedT.end, splitGroupId: groupId,
                                 printMinutes: tailPm, scheduleBypassed: schedT.effectivelyBypassed }
     g. chain push: resolveChainPushFromDb(tx, machine, { id: tail.id, startTime, endTime }) → shiftedMoves
        (locked/vytištěný soused → AppError OVERLAP → rollback celé tx, konkrétní hláška)  [RT#9]
     h. FINÁLNÍ POJISTKA: assertNoOverlapForBlocks(machine, [head.id, tail.id, ...shiftedMoves.map(m=>m.id)], tx)  [RT#2]
     i. audit: tail action "CREATE" + AUTO_SHIFT pro chain push; HLAVA BEZ generického UPDATE(endTime) řádku
        (parita s dneškem — endTime není v AUDITED_FIELDS; UPDATE by znečistil dashboard stability)  [RT#8]
  4. Refetch head + tail + shifted JEDNÍM findMany s `notes` include  [RT#18/#28]
  5. emitSSE("block:updated", serializeBlock(head)); emitSSE("block:created", serializeBlock(tail));
     emitSSE("block:batch-updated", { blocks: shifted.map(serializeBlock) })  — VŠE z téhož refetche  [RT#28]
  6. return { head: strip(head), tail: strip(tail), shifted: shifted.map(strip) }
     kde strip = stripNotesIfDenied(serializeBlock(x), canAccessBlockNotes(role))  [RT#18]
  catch: isAppError → errorStatus; jinak logger.error + 500
  ```
  **Sticky-bypass** [RT#1]: `headBypass`/`tailBypass` odvodit z `block.scheduleBypassed`; ukládat `sched.effectivelyBypassed` (nikdy echo). **Ne-ZAKAZKA** split: headPm/tailPm null, žádný chain push guard specifický pro pm.
- [ ] **3.4 PUT/POST hardening** [RT#6/#7]:
  - `blocks/[id]/route.ts` PUT: přidat `delete allowed.splitGroupId;` (u ADMIN/PLANOVAT větve, kde `allowed=body`) — splitGroupId se přes PUT NEZAPISUJE. Test: PUT `{splitGroupId: 999}` → hodnota se ignoruje (blok skupinu nezmění).
  - `blocks/route.ts` POST: guard — pokud `body.splitGroupId != null` a neexistuje `SplitGroup` s tím id → `AppError VALIDATION_ERROR` (422 „Neznámá split skupina") místo FK crashe. (Undo re-POST posílá platné id → projde; stará stale-client tail POST self-link → čistá 422 místo 500.) Test.
- [ ] **3.5** `npm run build` + `node --test --import tsx src/lib/splitCompute.test.ts`.

**Checkpoint 3** (dev DB je na novém FK): build + suite + splitCompute testy · **dev smoke:** fresh split → SplitGroup řádek vznikl, head+tail `splitGroupId=SplitGroup.id`, ✂2/2 · split existující skupiny → reuse, ✂3/3 · split v pauze → 422 · **split, jehož tail narazí na zamčený soused → čistý 409 + hláška, žádný rozbitý stav** [RT#9] · **bypass blok split** → obě části bypass, endTime sedí na kalendář [RT#1] · **head s vnitřní pauzou:** endTime hlavy = expand end (ne splitAt), žádný okamžitý drift [RT#1] · **tail nese pantone/SKLADEM/materialNote** z hlavy [RT#10] · PUT `{splitGroupId}` ignorován [RT#6] · SSE druhé okno vidí head+tail+shifted, poznámky hlavy nezmizí [RT#18] → commit `feat(split): atomický /split endpoint + PUT/POST hardening (B2 fáze 3)` → OK.

---

## Fáze 4 — Konzumenti: odstranit root-coupling (`OR id`) + namespace odstínů (M)

- [ ] **4.1 Expedice route** — `expedition/route.ts:51–55` a `:111–115`: `where: { OR: [{ splitGroupId }, { id: splitGroupId }] }` → `where: { splitGroupId: currentBlock.splitGroupId }`.
- [ ] **4.2 BlockDetail.tsx:226–228** — odstranit `|| b.id === block.splitGroupId`.
- [ ] **4.3 BlockEdit.tsx:281** — odstranit `|| b.id === block.splitGroupId`.
- [ ] **4.4 PlannerPage.tsx:1529–1534** — odstranit `|| b.id === cleanUpdated.splitGroupId`.
- [ ] **4.5 Ověřit serverovou propagaci `blocks/[id]/route.ts:500–501`** — beze změny (root nese groupId); přidat komentář. **E2E symetrie** [RT#R9]: edit LISTU → propíše se do rootu; edit ROOTU → propíše se do listů (obojí ověřit v 6.1).
- [ ] **4.6 blockShades.ts `orderIdentity` — namespace:**
  ```ts
  function orderIdentity(b: ShadeBlockInput): string {
    return b.splitGroupId != null ? `g${b.splitGroupId}` : `b${b.id}`;
  }
  ```
  + `const lastIdentity = new Map<string, string>();`.
- [ ] **4.7 blockShades.test.ts** — test kolize (standalone `{id:100}` + skupina `{splitGroupId:100}` → různá parita); upravit `:25` (split skupina sdílí `g<groupId>`).
- [ ] **4.8** `node --test --import tsx src/lib/blockShades.test.ts` + `npm run build`.

**Checkpoint 4:** build + suite · dev proklik (edit listu→root, edit root→listy, Expedice, odstíny standalone vedle skupiny) → commit `refactor(split): konzumenti bez OR-id, orderIdentity namespace (B2 fáze 4)` → OK.

---

## Fáze 5 — Seed + finální sweep (S)

- [ ] **5.1 `scripts/seed-shade-alternation-dev.ts:65–93`** — místo self-linku `SplitGroup` řádek: `const grp = await prisma.splitGroup.create({ data: {} });` a všem kusům `splitGroupId = grp.id`. Pořadí mazání: bloky (deleteMany) PŘED osiřelými SplitGroup (nebo je ponechat — dev-only). **Ponechat je bezpečnější** (invariant „nemaž SplitGroup dokud má člena") [RT#26].
- [ ] **5.2** Spustit dev seed, ověřit odstíny.
- [ ] **5.3** Plná suite: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts` — spočítat nové číslo (381 − 4 + splitCompute + blockShades kolize + PUT/POST guard testy), zapsat do CLAUDE.md.
- [ ] **5.4** `npm run build` + `npm run lint`.

**Checkpoint 5:** build + lint + suite → commit `test(split): splitCompute, seed na SplitGroup, sweep (B2 fáze 5)` → OK.

---

## Fáze 6 — Verifikace + dokumentace (M)

- [ ] **6.1 Ruční E2E na dev** (regresní checklist, OBĚ theme kde relevantní):
  - split fresh → ✂2/2; znovu → ✂3/3.
  - **smazat root → Ctrl+Z → 3/3** (jádro bugu); smazat leaf → Ctrl+Z → 3/3; multi-select 2 části → Ctrl+Z → obě zpět.
  - edit deadline/status na LISTU i na ROOTU se propíše do celé skupiny [RT#R9].
  - Expedice publish + reorder skupiny; cut zachová skupinu; copy → standalone; split v pauze → hláška.
  - **split před zamčeným sousedem → čistý 409 rollback** [RT#9]; **bypass blok split** [RT#1]; **tail nese pantone/SKLADEM** [RT#10].
  - **souběh: 2× rychlý split téhož bloku (double-click) → druhý 409, žádný dvojitý tail** [RT#21].
  - **SSE druhé okno:** split/delete/undo se propíše, skupiny sedí i při opačném pořadí eventů; poznámky hlavy nezmizí [RT#11/#18].
  - **cross-client:** undo listu, jehož skupinu jiný klient smazal → ✂1/1 sirotek (known-limit, ne crash) [RT#22].
  - odstíny: standalone blok vedle skupiny stejné barvy [RT#R6].
- [ ] **6.2 Důkazní sonda na KOPII produkce** (ne na živé DB): `mysqldump` prod → restore scratch → aplikovat migraci → doložit: 17 SplitGroup řádků, 0 Block změn (diff plánovacích polí), 34 částí seskupeno, 0 orphanů; **změřit dobu obou `ALTER TABLE Block`** a zapsat do deploy checklistu [RT#15]; přes scratch app split→delete-root→undo=3/3.
- [ ] **6.3 CLAUDE.md** — sekce „Split skupina (B2)": model, endpoint, konec `restoreSplitGroupId`, `orderIdentity` namespace, **invariant „SplitGroup se nemaže dokud má člena / pending undo"**, PUT nezapisuje splitGroupId, known-limit ✂1/1, počet testů; aktualizovat „Prisma konvence relací".
- [ ] **6.4 Memory** — B2 hotovo + deploy postup.

**Checkpoint 6:** E2E + sonda doložena → commit `docs(split): CLAUDE.md + memory B2 (fáze 6)` → OK.

---

## Fáze 7 — Produkční deploy (samostatný gate; Vojta/Michal) (M) — přepsáno po red-teamu

**Pořadí: build → záloha → app-stop → migrace → app-start → ověření → reload klientů.** Zdůvodnění: `deploy.sh` app NEzastavuje [RT#3]; migrace v jednom běhu s buildem riskuje app na starém kódu proti novému FK [RT#4]; DDL není transakce → half-applied bez app-down [RT#14].

- [ ] **7.1 Pre-flight gates** [RT#23/#24/#5]:
  - `mysqldump` produkce jako KROK 0 + PRE snapshot (17 skupin, otisk plánovacích polí).
  - Grep migrace v repu: `SplitGroup`.`id` = `INT UNSIGNED` + `DEFAULT CHARSET utf8mb4` (přežil ruční edit) [RT#5/#23].
  - Ověřit prod `.env` `DATABASE_URL` má `connection_limit` + `pool_timeout` (nový /split je tx-heavy) [RT#24].
- [ ] **7.2 Build PŘED migrací** [RT#4]: `npm ci && npm run build` → **zelený artefakt** dřív, než se sáhne na DB. Když build selže, migrace se vůbec nespustí.
- [ ] **7.3 App-stop** [RT#3/#12/#25]: `pm2 stop planovanivyroby` — app kompletně dole (ne „bez dělení bloků") po celou dobu migrace+start. Jediná garance, že žádný zapisovatel (split PUT, série, undo re-POST, company-days/calendarDrift) nesáhne na DB během ALTERu.
- [ ] **7.4 Migrace** [RT#14/#23]:
  - **Orphan pre-check** (app už stojí): `SELECT COUNT(*) FROM Block b LEFT JOIN (SELECT DISTINCT splitGroupId g FROM Block WHERE splitGroupId IS NOT NULL) x ON b.splitGroupId=x.g WHERE b.splitGroupId IS NOT NULL AND x.g IS NULL;` = **0** (jinak ADD FK spadne → nemigrovat).
  - `npx prisma migrate deploy`.
  - Ověřit: `SHOW CREATE TABLE Block` → FK `REFERENCES SplitGroup(id)`; `SHOW CREATE TABLE SplitGroup` → UNSIGNED + utf8mb4; 17 SplitGroup řádků; 0 orphanů.
- [ ] **7.5 App-start:** deploy nového (už zbuilděného) kódu + `pm2 start planovanivyroby`.
- [ ] **7.6 POST ověření + reload klientů** [RT#6/#12]:
  - 17 skupin, 34 částí seskupeno, 0 změn plánovacích polí (diff vs PRE); prod smoke split→delete-root→undo=3/3.
  - **Vynutit reload klientů** (stará karta drží starý JS): pokyn „všichni obnoví planner" NEBO SSE „server:reloaded" → toast. Pojistka: PUT strip splitGroupId (3.4) + POST 422 guard způsobí, že stale-client split selže ČISTĚ (LIFO revert), ne FK crashem.
- [ ] **7.7 Rollback runbook** [RT#13] — NEspoléhat na „ADD FK atomicky rolluje" (platí jen pro selhání samotného ADD, ne navazujícího deploye):
  - `pm2 stop` → buď (a) konkrétní down-SQL: `ALTER TABLE Block DROP FOREIGN KEY Block_splitGroupId_fkey; DROP TABLE SplitGroup; ALTER TABLE Block ADD CONSTRAINT Block_splitGroupId_fkey FOREIGN KEY (splitGroupId) REFERENCES Block(id) ON DELETE SET NULL ON UPDATE CASCADE;` (Block.splitGroupId hodnoty jsou beze změny → self-FK platí), nebo (b) full restore z 7.1 dumpu (pre-migrační dump SplitGroup NEobsahuje → restore je čistý návrat) → deploy starého buildu → `pm2 start`.

---

## Verifikace etapy

1. `npm run build` — 0 chyb; 2. celá suite (nový počet); 3. regresní proklik 6.1; 4. `npm run lint`; 5. sonda na kopii prod (6.2) doložena PŘED prod deployem.

## Rizika (souhrn, po red-teamu)

- **R1 — migrace × ostrá data:** `SplitGroup.id = root PK` (0 Block změn) + nácvik na kopii + záloha + orphan pre-check + UNSIGNED/charset gate. Migrace NENÍ atomicky fail-safe (DDL auto-commit) → half-applied stav řeší app-down + pre-checky + down-SQL runbook (7.7) [RT#14].
- **R2 — deploy pořadí + stale klienti:** build→app-stop→migrace→start; force-reload; PUT strip + POST 422 guard dělají ze stale-client splitu čisté selhání místo FK crashe [RT#3/#4/#6/#12].
- **R3 — split endpoint korektnost:** head přes validateAndComputeEnd (ne splitAt) [RT#1]; assertNoOverlapForBlocks finální pojistka [RT#2]; tail nese VŠECHNA SPLIT_SHARED_FIELDS [RT#10]; expectedUpdatedAt + FOR UPDATE [RT#21]; printCompleted guard [RT#9]; audit contract bez UPDATE(endTime) [RT#8]; notes refetch+strip+SSE z jednoho zdroje [RT#18/#28]; 30min alignment guard [RT#20].
- **R4 — MDL/timing na Block:** app-down (ne jen split-stop) + změřit ALTER na kopii [RT#15]. 34 řádků = validace rychlá, riziko je MDL-wait.
- **R5 — lifecycle SplitGroup:** invariant „nemaž dokud má člena / pending undo"; žádný cleanup ve scope [RT#17/#22/#26].

## Vědomě mimo scope

- Cleanup osiřelých/jednočlenných `SplitGroup` řádků — backlog; persistence je pro undo žádoucí. Jakýkoli budoucí cleanup NESMÍ mazat řádky s živým členem ani pending undo (FK/regrese).
- Retroaktivní spojení historicky rozpuštěných skupin — 0 bezhlavých dnes, B2 opravuje dopředu.
- Dedikovaná audit akce `SPLIT` na hlavě (traceability) — volitelné vylepšení mimo UPDATE filtr dashboardu; default = bez audit řádku hlavy (parita s dneškem).
- `restore-igvyroba-from-import.sql` — legacy skript (odkazuje zaniklé tabulky); pokud se kdy oživí s ne-null splitGroupId, musí nejdřív naplnit SplitGroup [RT#27].

---

## Red-team zpevnění (28 ověřených nálezů, 2026-07-13)

**CRITICAL:** [#1] head endTime přes validateAndComputeEnd · [#2] assertNoOverlapForBlocks finální pojistka · [#3] pm2 stop app-down · [#4] build před migrací.
**HIGH:** [#5] charset · [#6/#7] PUT/POST splitGroupId hardening · [#8] audit contract · [#9] printCompleted/locked-soused guard · [#10] tail nese SPLIT_SHARED_FIELDS · [#11] SSE opposite-order · [#12] stale klienti · [#13] rollback down-SQL.
**MEDIUM:** [#14] DDL not-transactional / orphan pre-check · [#15] MDL timing · [#16] grep gate · [#17] undo FK konzument · [#18] SSE notes gating · [#19] shifted single-carrier · [#20] 30min alignment · [#21] FOR UPDATE souběh · [#22] cross-client undo known-limit · [#23] UNSIGNED gate · [#24] connection_limit · [#25] app-down vs auto-zapisovatele.
**LOW:** [#26] SplitGroup never-delete invariant · [#27] restore skript legacy · [#28] shifted response=SSE jeden zdroj.
**Vyvráceno (11):** AUTO_INCREMENT kolize (nereused), splitGroupMap/queueDrop (category B — OK), namespace u SET NULL (padá na `b${id}`), edit-root symetrie (funguje), 1-member filtr (OK) aj.
