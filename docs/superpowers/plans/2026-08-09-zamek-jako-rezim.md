# Zámek jako režim aplikace — implementační plán

> **Stav: HOTOVO 9. 8. 2026, ale ČTI TOHLE PRVNÍ.** Plán se od Tasku 1 nesplnil
> doslova a nemá se. **Task 1 celý (serverový detektor + `STALE_BYPASS` na serveru)
> se ZAHODIL** — review ukázala, že by každé vědomě odložené zakázce nasadil trvalý
> poplach a hromadné „Přepočítat" by ji nevratně vystěhovalo. Serverový filtr
> `scheduleBypassed: false` zůstává; odložené zakázky posuzuje jen klient (Task 2)
> a rozlišuje `PARKED` / `STALE_BYPASS`. Task 2 navíc nepoužil kopii
> `expandForDriftOnly`, ale opt-in parametr `includeBypassed` sdíleného guardu.
> Tasky 3–5 platí, jak jsou napsané. Skutečný výsledek: `docs/vyvoj-historie.md`;
> proč: `docs/POUCENI.md` P11 a P12.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `scheduleBypassed` přestane být štítem, který zakázku schová před každou kontrolou, a stane se viditelnou dočasnou značkou „odložená mimo pracovní dobu", kterou jde jedním kliknutím zrušit.

**Architecture:** Žádný nový systém. Mechanismus „ukaž, co nesedí, a nabídni srovnání" (štítek ⚠ KALENDÁŘ + pruh Přepočítat) v aplikaci už existuje a je otestovaný — odložené zakázky z něj byly jen vyňaté. Etapa tedy z velké části **odstraňuje výjimky**. Přibývá jediný nový pojem: důvod `STALE_BYPASS` = „značka je zbytková, geometrie sedí".

**Tech Stack:** TypeScript (strict) · Next.js 16 · Prisma 5 / MySQL · `node:test` + `tsx`

**Návrh:** `docs/superpowers/specs/2026-08-09-zamek-jako-rezim-design.md` — závazný, čti ho jako zdroj požadavků.

## Global Constraints

- **Nasazení nesmí pohnout plánem.** Žádná migrace, žádný startovací ani cron skript, který by měnil data. Všechny změny jsou buď čtení, nebo se spouští na kliknutí. (Spec 7.1 — tvrdý požadavek Vojty.)
- **Nic se nepřeplánuje samo.** Aplikace ukáže a nabídne akci; nepřesune nic bez kliknutí. Cvaknutí zámku nespouští přepočet.
- **Žádná změna schématu.** `prisma/schema.prisma` se v téhle etapě nemění.
- **NESAHAT na `tryExpandForBlock`** (`printTimeClient.ts`) — sdílí ho `getBlockSegments`; uvolnění guardu by kreslilo pauzy dovnitř odložených zakázek (past popsaná v Z1 specu, poučení P6 v `docs/POUCENI.md`).
- **Beze změny zůstávají:** chování zámku, geometrie autoposunu (`chainPushGeometry`), sticky OR v `batch/route.ts`, zápis příznaku přes `effectivelyBypassed`, undo, guard rozdělení bloku.
- Chyby v API přes `AppError`, logování přes `logger`, mutace v `$transaction` s auditem, mutace bloku uvnitř `withRevision`.
- Barvy a rozměry přes CSS tokeny z `globals.css`, nikdy hex literál v komponentě.
- Po každém tasku `npm run build` zelený a celá sada zelená:
  `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
- Commit po každém tasku. Větev `Vojta`.

---

### Task 1: Serverový detektor — nový důvod `STALE_BYPASS`

**Files:**
- Modify: `src/lib/calendarDrift.server.ts`
- Test: `src/lib/calendarDrift.server.test.ts`

**Interfaces:**
- Produces: `DriftedBlock.reason` rozšířený o `"STALE_BYPASS"`. Konzumují Task 2 (klient musí klasifikovat stejně) a Task 5 (nápověda štítku).

- [ ] **Step 1: Napsat padající testy**

```typescript
test("odložený blok mimo pracovní dobu se nově hlásí jako END_MISMATCH", async () => {
  // blok s scheduleBypassed = true, uložený konec = start + printMinutes (slitě přes noc),
  // kalendářní expanze by dala jiný konec
  const drifted = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
  const hit = drifted.find((d) => d.id === 1323);
  assert.ok(hit, "odložený blok už nesmí být z kontroly vyřazen");
  assert.equal(hit.reason, "END_MISMATCH");
});

test("odložený blok, jehož rozpětí kalendáři ODPOVÍDÁ → STALE_BYPASS (případ 18447)", async () => {
  const drifted = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
  const hit = drifted.find((d) => d.id === 1323);
  assert.equal(hit?.reason, "STALE_BYPASS");
  assert.equal(hit?.expectedEnd, null, "není co posouvat, jen zrušit značku");
});

test("NEOZNAČENÝ blok se shodným rozpětím nehlásí nic — STALE_BYPASS je vázaný na značku", async () => {
  // MUTAČNÍ POJISTKA: kdyby se STALE_BYPASS testoval jen podle shody konců
  // a ne podle scheduleBypassed, hlásil by se u každého zdravého bloku v plánu.
  const drifted = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
  assert.equal(drifted.length, 0);
});

test("neoznačený driftující blok se dál hlásí jako END_MISMATCH (žádná regrese)", async () => {
  const drifted = await detectCalendarDrift(db, ["XL_105"], windowStart, windowEnd, now);
  assert.equal(drifted[0].reason, "END_MISMATCH");
});
```

- [ ] **Step 2: Spustit, ověřit že padají**

Run: `node --test --import tsx src/lib/calendarDrift.server.test.ts`
Expected: FAIL — první tři testy nenajdou nic (blok je vyřazený filtrem).

- [ ] **Step 3: Implementace**

V `detectCalendarDrift`:
- z `where` odstranit řádek `scheduleBypassed: false`
- do `select` přidat `scheduleBypassed: true`
- typ `DriftedBlock.reason` rozšířit o `"STALE_BYPASS"`
- klasifikaci upravit v tomhle pořadí (pořadí je závazné):

```typescript
const expanded = expandPrintTime(machine, b.startTime, printMinutes, cal.weekShifts, cal.companyDays, false);
if (!expanded.ok) { /* dosavadní větev: START_NOT_RUNNABLE / HORIZON_EXCEEDED */ continue; }
if (expanded.end.getTime() === b.endTime.getTime()) {
  // Konec sedí na kalendář. U neoznačeného bloku je to zdravý stav (nic se nehlásí),
  // u označeného to znamená, že značka je zbytková — geometrie je v pořádku.
  if (b.scheduleBypassed) {
    drifted.push({ id: b.id, orderNumber: b.orderNumber, machine: b.machine,
      startTime: b.startTime, endTime: b.endTime, expectedEnd: null, reason: "STALE_BYPASS" });
  }
  continue;
}
drifted.push({ ..., expectedEnd: expanded.end, reason: "END_MISMATCH" });
```

- [ ] **Step 4: Spustit, ověřit že prochází**

Run: `node --test --import tsx src/lib/calendarDrift.server.test.ts`
Expected: PASS

- [ ] **Step 5: Mutační kontrola**

Dočasně změnit podmínku `if (b.scheduleBypassed)` na `if (true)` a ověřit, že padá **právě** test „NEOZNAČENÝ blok … nehlásí nic". Pak vrátit.

- [ ] **Step 6: Commit**

```bash
git add src/lib/calendarDrift.server.ts src/lib/calendarDrift.server.test.ts
git commit -m "feat(kalendar): detektor přestane přehlížet odložené zakázky, nový důvod STALE_BYPASS"
```

---

### Task 2: Klientský detektor — stejná klasifikace, sdílený guard beze změny

**Files:**
- Modify: `src/lib/printTimeClient.ts` (funkce `blockCalendarDrift`)
- Test: `src/lib/printTimeClient.test.ts`

**Interfaces:**
- Consumes: hodnota `"STALE_BYPASS"` zavedená v Tasku 1 — klasifikace musí být pro tentýž vstup shodná.
- Produces: `CalendarDriftInfo.reason` rozšířený o `"STALE_BYPASS"`. Konzumuje Task 5.

- [ ] **Step 1: Napsat padající testy**

```typescript
test("odložený blok mimo pracovní dobu → END_MISMATCH (dřív null)", () => {
  const d = blockCalendarDrift(parkedBlock, SHIFTS, NO_CD, now);
  assert.equal(d?.reason, "END_MISMATCH");
});

test("odložený blok s rozpětím odpovídajícím kalendáři → STALE_BYPASS", () => {
  const d = blockCalendarDrift(staleFlagBlock, SHIFTS, NO_CD, now);
  assert.equal(d?.reason, "STALE_BYPASS");
  assert.equal(d?.expectedEnd, null);
});

test("getBlockSegments u odloženého bloku dál vrací null", () => {
  // MUTAČNÍ POJISTKA proti uvolnění tryExpandForBlock (past Z1 / poučení P6):
  // kdyby se guard uvolnil ve sdílené funkci, začal by se odložené zakázce
  // kreslit dovnitř pás „⏸ PAUZA — mimo provoz", přestože tiskne slitě.
  assert.equal(getBlockSegments(parkedBlock, SHIFTS, NO_CD), null);
});

test("klient a server klasifikují tentýž vstup shodně", () => {
  // Tabulka vstupů → očekávaný důvod, sdílená s calendarDrift.server.test.ts.
  // Rozejití obou stran = štítek na kartě tvrdí něco jiného než pruh nad strojem.
  assert.equal(blockCalendarDrift(parkedBlock, SHIFTS, NO_CD, now)?.reason, "END_MISMATCH");
  assert.equal(blockCalendarDrift(staleFlagBlock, SHIFTS, NO_CD, now)?.reason, "STALE_BYPASS");
  assert.equal(blockCalendarDrift(healthyBlock, SHIFTS, NO_CD, now), null);
});
```

- [ ] **Step 2: Spustit, ověřit že padají**

Run: `node --test --import tsx src/lib/printTimeClient.test.ts`
Expected: FAIL na prvních dvou (vrací `null`), poslední dva projdou už teď.

- [ ] **Step 3: Implementace**

**`tryExpandForBlock` NEMĚNIT.** V `blockCalendarDrift` přidat před voláním sdíleného
guardu vlastní větev pro odložené zakázky:

```typescript
export function blockCalendarDrift(b, weekShifts, companyDays, now): CalendarDriftInfo | null {
  if (b.printCompletedAt) return null;
  const endTime = new Date(b.endTime);
  if (endTime.getTime() <= now.getTime()) return null;

  // Odložená zakázka: sdílený guard ji vypouští (a musí — getBlockSegments by jí
  // jinak kreslil pauzu dovnitř), takže si expanzi uděláme vlastní cestou.
  if (b.scheduleBypassed) {
    const exp = expandForDriftOnly(b, weekShifts, companyDays);
    if (!exp) return null;                       // stejné ostatní guardy jako sdílený
    if (!exp.ok) return { reason: exp.reason, expectedEnd: null };
    return exp.end.getTime() === endTime.getTime()
      ? { reason: "STALE_BYPASS", expectedEnd: null }
      : { reason: "END_MISMATCH", expectedEnd: exp.end };
  }

  const exp = tryExpandForBlock(b, weekShifts, companyDays);
  if (!exp) return null;
  if (!exp.ok) return { reason: exp.reason, expectedEnd: null };
  if (exp.end.getTime() !== endTime.getTime()) return { reason: "END_MISMATCH", expectedEnd: exp.end };
  return null;
}
```

`expandForDriftOnly` je nová privátní funkce v témže souboru — kopie `tryExpandForBlock`
**bez** podmínky `b.scheduleBypassed` (ostatní guardy: `type !== "ZAKAZKA"`, neplatné
`printMinutes`, nezarovnaný start, `try/catch`). Duplicita je záměrná a musí být
okomentovaná: obě funkce mají jiného adresáta a jejich sloučení je právě ta past.

- [ ] **Step 4: Spustit, ověřit že prochází**

Run: `node --test --import tsx src/lib/printTimeClient.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/printTimeClient.ts src/lib/printTimeClient.test.ts
git commit -m "feat(kalendar): štítek na kartě se objeví i u odložených zakázek"
```

---

### Task 3: Přepočet přijme odloženou zakázku a zruší značku

**Files:**
- Modify: `src/lib/reflow.server.ts`
- Test: `src/lib/reflow.server.test.ts`

**Interfaces:**
- Consumes: nic z Tasků 1–2 (běží nezávisle).
- Produces: po úspěšném přepočtu má blok `scheduleBypassed = false`. Konzumuje Task 6 (ruční ověření).

- [ ] **Step 1: Napsat padající testy**

```typescript
test("odložený blok se přepočítá, posune a značka zmizí", async () => {
  const out = await reflowBlockInTx(tx, 1323, actor, deps);
  assert.equal(out.ok, true);
  assert.equal(out.changed, true);
  const data = updateMock.mock.calls[0].arguments[0].data;
  assert.equal(data.scheduleBypassed, false, "přepočet značku ruší");
  assert.ok(data.startTime && data.endTime);
});

test("zbytková značka: značka zmizí, časy se NEZMĚNÍ, chain push se nevolá", async () => {
  // MUTAČNÍ POJISTKA na opravenou podmínku `changed`: dnešní zkratka
  // `changed = posun` by u zbytkové značky vrátila changed:false a příznak
  // by v DB zůstal, přestože tlačítko hlásí úspěch.
  const out = await reflowBlockInTx(tx, 1323, actor, deps);
  assert.equal(out.ok, true);
  const data = updateMock.mock.calls[0].arguments[0].data;
  assert.equal(data.scheduleBypassed, false);
  assert.ok(!("startTime" in data), "časy se nesmí přepisovat, když se nic nepohnulo");
  assert.equal(chainPushMock.mock.callCount(), 0, "nic se nepohnulo → není co odsouvat");
});

test("zamčený odložený blok se dál odmítá", async () => {
  const out = await reflowBlockInTx(tx, 1, actor, deps);   // locked: true, scheduleBypassed: true
  assert.equal(out.ok, false);
  assert.equal(out.code, "LOCKED");
});

test("vytištěný odložený blok se dál odmítá", async () => {
  const out = await reflowBlockInTx(tx, 2, actor, deps);   // printCompletedAt != null
  assert.equal(out.ok, false);
  assert.equal(out.code, "PRINTED");
});
```

- [ ] **Step 2: Spustit, ověřit že padají**

Run: `node --test --import tsx src/lib/reflow.server.test.ts`
Expected: FAIL — první dva testy dostanou `{ ok: false, code: "BYPASS" }`.

- [ ] **Step 3: Implementace**

V `reflowBlockInTx`:
- odstranit celou větev `if (block.scheduleBypassed) { return { ok: false, code: "BYPASS", … } }`
- podmínku bez změny rozšířit:

```typescript
const moved = newStart.getTime() !== oldStart.getTime() || newEnd.getTime() !== oldEnd.getTime();
const clearsFlag = block.scheduleBypassed === true;
if (!moved && !clearsFlag) {
  return { ok: true, changed: false, startTime: oldStart, endTime: oldEnd, moves: [] };
}
await tx.block.update({
  where: { id: blockId },
  data: {
    ...(moved ? { startTime: newStart, endTime: newEnd } : {}),
    ...(clearsFlag ? { scheduleBypassed: false } : {}),
  },
});
```

- chain push, finální pojistka `assertNoOverlapForBlocks` i `AUTO_SHIFT`/`AUTO_REFLOW`
  auditní řádky spouštět **jen když `moved`** — při pouhém zrušení značky se nic
  nepohnulo, takže není co odsouvat ani co zapisovat jako přesun. Změnu příznaku
  zaznamená revize (Task 4).
- ponechat beze změny: odmítnutí pro ne-ZAKAZKA, zamčený, vytištěný, bez `printMinutes`,
  nezarovnaný start, `NO_SLOT`, `HORIZON`.

- [ ] **Step 4: Spustit, ověřit že prochází**

Run: `node --test --import tsx src/lib/reflow.server.test.ts`
Expected: PASS

- [ ] **Step 5: Mutační kontrola**

Vrátit podmínku na `if (!moved)` a ověřit, že padá **právě** test „zbytková značka…".
Pak vrátit.

- [ ] **Step 6: Commit**

```bash
git add src/lib/reflow.server.ts src/lib/reflow.server.test.ts
git commit -m "feat(reflow): přepočet přijme odloženou zakázku a zruší její značku"
```

---

### Task 4: Změna značky je vidět v historii

**Files:**
- Modify: `src/lib/revisionFormat.ts`
- Test: `src/lib/revisionFormat.test.ts`

**Interfaces:**
- Consumes: nic. Produces: české věty v historii bloku.

- [ ] **Step 1: Napsat padající testy**

```typescript
test("nastavení značky odloženo → česká věta", () => {
  const lines = formatRevisionLines({ scheduleBypassed: false }, { scheduleBypassed: true });
  assert.deepEqual(lines, ["Označeno jako odložené mimo pracovní dobu"]);
});

test("zrušení značky odloženo → česká věta", () => {
  const lines = formatRevisionLines({ scheduleBypassed: true }, { scheduleBypassed: false });
  assert.deepEqual(lines, ['Zrušeno označení „odložené mimo pracovní dobu"']);
});
```

- [ ] **Step 2: Spustit, ověřit že padají**

Run: `node --test --import tsx src/lib/revisionFormat.test.ts`
Expected: FAIL — vrací prázdné pole (sloupec je mezi vyloučenými).

- [ ] **Step 3: Implementace**

- `scheduleBypassed` **odstranit** z `REVISION_SKIPPED_COLUMNS`. Dosavadní odůvodnění
  („vnitřní příznak validace, mění se jako důsledek změny časů") přestává platit:
  nově je to stav, který uživatel vidí a který se mění i bez změny časů.
- Přidat mezi sloupce s vlastní větou, obě znění přesně podle testů výše.
- Strážný test proti schématu (`revisionFormat` má kontrolu pokrytí všech sloupců
  `Block`) musí projít — ověřit, že se počty sedí.

- [ ] **Step 4: Spustit, ověřit že prochází**

Run: `node --test --import tsx src/lib/revisionFormat.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/revisionFormat.ts src/lib/revisionFormat.test.ts
git commit -m "feat(historie): změna značky odloženo dostane českou větu"
```

---

### Task 5: Nápověda štítku podle důvodu a poctivý náhled při tažení

**Files:**
- Modify: `src/components/planner/BlockCard.tsx` (nápověda štítku ⚠ KALENDÁŘ)
- Modify: `src/app/_components/TimelineGrid.tsx` (dvě podmínky náhledu — drag a resize)
- Modify: `src/components/BlockDetail.tsx` (popisky důvodů driftu)

**Interfaces:**
- Consumes: `"STALE_BYPASS"` z Tasků 1–2.

- [ ] **Step 1: Nápověda štítku**

V `BlockCard.tsx` u štítku `⚠ KALENDÁŘ` rozšířit `title` o novou větev:

```typescript
calendarDrift.reason === "STALE_BYPASS"
  ? "Zakázka je značená jako odložená mimo pracovní dobu, ale kalendáři odpovídá — značku lze zrušit tlačítkem Přepočítat"
  : calendarDrift.reason === "END_MISMATCH" && calendarDrift.expectedEnd
    ? `Konec nesedí na aktuální kalendář (správně do ${formatPragueDateTime(calendarDrift.expectedEnd)})`
    : /* dosavadní větve beze změny */
```

Text štítku i barvy zůstávají — žádný nový prvek, žádný hex literál.

- [ ] **Step 2: Popisek v detailu bloku**

V `BlockDetail.tsx` doplnit `STALE_BYPASS` do mapy popisků důvodů (vedle
`START_NOT_RUNNABLE` atd.) se zněním: `Zbytková značka „odložené mimo pracovní dobu"`.

- [ ] **Step 3: Poctivý náhled při tažení**

V `TimelineGrid.tsx` odstranit `&& !sourceBlock.scheduleBypassed` ze **dvou** podmínek
(drag ghost a resize ghost). Doplnit komentář: server při zamčeném zámku odloženou
zakázku re-expanduje (`[id]/route.ts` bere bypass z requestu, ne z bloku), takže náhled
s naivní výškou ukazoval něco jiného, než co se stane — nesoulad, který tu byl už dřív.

- [ ] **Step 4: Ověření**

Run: `npm run build`
Expected: zelený. Vizuální kontrola až v Tasku 6 (nápovědy a náhledy unit testem
neověříme; nic z toho nemění data).

- [ ] **Step 5: Commit**

```bash
git add src/components/planner/BlockCard.tsx src/app/_components/TimelineGrid.tsx src/components/BlockDetail.tsx
git commit -m "feat(planner): nápověda štítku podle důvodu, náhled při tažení přestane lhát"
```

---

### Task 6: Ověření, review a předdeployové měření

**Files:** žádné produkční změny; případné opravy z review.

- [ ] **Step 1: Celá sada a build**

```bash
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
npm run build
```
Expected: 0 fail, build zelený.

- [ ] **Step 2: Multi-agent review**

Jedno kolo nad diffem celé etapy, nezávislé pohledy: (a) korektnost klasifikace driftu
a shoda klient/server, (b) reflow a jeho no-op větev, (c) soulad s Global Constraints —
zvlášť „nasazení nesmí pohnout plánem" a nedotčenost `tryExpandForBlock`, (d) kvalita
testů a existence mutace, která by prošla. Nálezy adversariálně ověřit, pak fix wave
a cílené re-review jen nad opravami.

- [ ] **Step 3: Přenasadit testovací instanci**

```bash
cd /var/www/planovanivyroby-test && git pull && npm run build && pm2 restart planovani-TEST
```
Po restartu **tvrdý refresh prohlížeče** — jinak běží starý klientský balík.

- [ ] **Step 4: Proklikat pět scénářů ze specu, části 3**

Odložení · srovnání · skutečná noční přes kalendář směn · odsunutí autoposunem
(délka se nesmí změnit) · zbytková značka u 18447 (značka zmizí, plán se nepohne).

- [ ] **Step 5: Předdeployové měření nad OSTROU databází (jen čte)**

```bash
sudo mysql igvyroba -e "SELECT COUNT(*) AS objevi_se_stitku FROM Block WHERE type='ZAKAZKA' AND scheduleBypassed=1 AND printMinutes>0 AND printCompletedAt IS NULL AND endTime > NOW();"
```
Očekávání: **1** (zakázka 18447). Jiné číslo → zjistit které bloky a proč, než se nasadí.

- [ ] **Step 6: Dokumentace a commit**

Doplnit `docs/vyvoj-historie.md` o sekci etapy. Do `CLAUDE.md` doplnit pravidlo
o dvojí (server + klient) detekci driftu a o zákazu uvolňovat `tryExpandForBlock`.
Nové poučení, pokud během implementace nějaké vznikne, dopsat do `docs/POUCENI.md`.

```bash
git add docs/ CLAUDE.md
git commit -m "docs: etapa zámek jako režim aplikace — historie, konvence, poučení"
```
