# Spec: autoposun viditelný a vratný

Datum: 18. 8. 2026 · Autor: Vojta + Claude · Stav: **navrženo, neimplementováno**
Podklad: `docs/audits/2026-08-18-audit-prepocitat-autoposun.md`

---

## 1. Problém

Autoposun (chain push) je sám o sobě v pořádku — plán se musí umět srovnat. Špatné je,
že se děje **potichu a nevratně**:

- **Číslo dopadu server posílá, klient ho zahodí.** Hromadný reflow vrací `movedCount`,
  adresný vrací pole `moves`; toast neuvede ani jedno.
- **Potvrzení buď chybí, nebo mluví o jiném čísle.** Adresné „Přepočítat" nemá potvrzení
  žádné. Hromadné se ptá na počet *rozejitých* bloků, ne posunutých.
- **Undo je zavádějící.** Reflow se do historie nezapisuje, ale `undo()` bere poslední
  záznam zásobníku — Ctrl+Z tedy tiše vrátí **předchozí, cizí** akci.
- **Zakázka nemá strop posunu.** Rigidní blok má 7 dní (`MAX_RIGID_PUSH_MS`), zakázka
  podle komentáře v `overlapResolver.ts:161` „horizont nemá". Okno je 90 dní.

**Změřeno na testovací instanci** (simulace bez zápisu, XL 105, odpolední 22:00 → 20:00):
rozejdou se 4 zakázky a přepočet **té první odsune 20 bloků** až do 21. 8. Uživatel dnes
uvidí „Blok přepočítán podle aktuálního kalendáře."

Táž mechanika stojí za havárií 17. 8. 16:31 — posun o 30 minut odsunul 87 bloků do září
a undo už nešlo, protože sedmi z nich se mezitím dotkli jiní.

## 2. Rozhodnutí

| # | Otázka | Rozhodnutí |
| --- | --- | --- |
| 1 | Rozsah stropu | **Všechny cesty přes `resolveChainPushFromDb`** — reflow, drag, resize, batch, split |
| 2 | Práh | **Víc než 5 posunutých bloků NEBO posun dál než 7 dní** (parita s `MAX_RIGID_PUSH_MS`) |
| 3 | Vratnost | **Obojí** — reflow do Ctrl+Z historie **i** serverové „vrátit revizní skupinu" |
| 4 | Kde se počítá dopad | **Server** — odmítne, vrátí čísla, klient je zobrazí a zopakuje s potvrzením |
| 5 | Rozsah vlny | **Tři etapy, dvě nasazení** (viz §5) |

### 2.1 Proč rozhodnutí #4

Je to týž vzor, jaký právě funguje u kaskády směn (`SHIFT_SHRINK_CASCADE` + `?force=1`):
akce se zkusí, server transakci odrolluje a vrátí 409 s čísly, uživatel potvrdí a
požadavek se zopakuje. Jediný zdroj pravdy — `computeChainPush` zůstane v jedné
implementaci. Klientský výpočet by byl rychlejší, ale vyrobil by **druhou implementaci
téhož pravidla**, což je přesně třída vady, kterou minulá vlna odstraňovala.

## 3. Návrh

### 3.1 Etapa A — říct číslo (nemění chování)

Server čísla už posílá; klient je začne zobrazovat.

- `handleReflowMachine` (`PlannerPage.tsx`): toast doplní `data.movedCount` →
  *„Přepočteno 4 bloky, odsunuto 31 navazujících."*
- `handleReflowBlock`: z `data.moves.length` → *„Blok přepočítán, odsunuto 20 navazujících."*
  Když `moves` je prázdné, věta o odsunutí se vynechá — ne „odsunuto 0".
- Skloňování řešit stejně jako dnešní hláška u dragu (`PlannerPage.tsx:1150`), ať se
  texty nerozejdou.

### 3.2 Etapa C — reflow do historie (Ctrl+Z)

Aby šel krok vrátit, musí odpověď nést i **původní** hodnoty. `AppliedMove`
(`overlapResolver.server.ts:14-19`) je už má (`oldStartTime`, `oldEndTime`) — dnes se jen
neserializují.

- Obě reflow routy rozšíří odpověď o `before` (pole `{ id, startTime, endTime, updatedAt }`)
  vedle dnešního `moves`/`blocks`.
- Klient složí krok přes **existující** `buildMoveCommand(label, before, after)`
  (`src/lib/undo/commands.ts:57`) a zapíše ho `recordUndo`. Žádná nová undo infrastruktura
  nevzniká.
- Label: „Přepočet bloku" / „Přepočet stroje", ať je v historii poznat, co se vrací.

**Vědomé omezení:** zásobník je v paměti, 30 kroků, mizí refreshem, a krok selže, když se
dotčených bloků mezitím dotkl někdo jiný (optimistický zámek). U hromadného přepočtu přes
365 dní je to nejslabší — proto etapa D.

### 3.3 Etapa B — strop a potvrzení

**Vynucení na jednom místě.** `resolveChainPushFromDb` spočítá `result.moves` **dřív**,
než je zapíše (`overlapResolver.server.ts:240-254`). Tam se vloží kontrola:

```
movedCount = result.moves.length
farthest   = max(move.endTime) − původní endTime téhož bloku
if (!confirmed && (movedCount > CASCADE_CONFIRM_MAX_BLOCKS || farthest > MAX_RIGID_PUSH_MS))
    throw new AppError("CASCADE_CONFIRM", …)   // → rollback celé transakce
```

- `CASCADE_CONFIRM_MAX_BLOCKS = 5`; horní hranice vzdálenosti je **existující**
  `MAX_RIGID_PUSH_MS` (7 dní) — nezavádí se nové číslo.
- Parametr `confirmed` se protáhne všemi **pěti** volajícími místy: `POST /api/blocks`,
  `PUT /api/blocks/[id]`, `batch`, `split`, `reflow` (obě vstupní cesty).
- Klient při 409 `CASCADE_CONFIRM` ukáže dotaz *„Tato změna odsune 20 navazujících bloků,
  nejdál do 21. 8. Potvrdit?"* a požadavek zopakuje s příznakem.

**Nejdřív se týden jen měří.** Konstanta `CASCADE_CONFIRM_ENFORCED = false` znamená, že se
překročení prahu **jen zaloguje** (`logger.info` s počtem, vzdáleností a cestou), ale
transakce projde. Po týdnu z logu poznáme, jak často by se aplikace ptala, a teprve pak se
konstanta přepne. Není to feature flag za běhu — je to jeden commit tam a druhý zpět.

**Riziko, které tím vzniká:** drag dnes maluje výsledek **optimisticky** na klientovi.
Když server nově odmítne, klient musí optimistický stav vrátit — jinak uživatel uvidí blok
na novém místě, které v DB není. Tohle je nová třída chyby a patří k ní vlastní test.

### 3.4 Etapa D — „vrátit revizní skupinu" jako funkce aplikace

Dnes to umí jen ručně pouštěný `scripts/revert-revision-group.ts`. Etapa z něj udělá
endpoint + tlačítko v historii bloku.

- `POST /api/blocks/revert-group` s `{ groupId }`, role ADMIN/PLANOVAT.
- Jádro **sdílí se skriptem** — tatáž pravidla, jinak vzniknou dvě implementace obnovy:
  cíle z `BlockRevision.before`, guard „blok stojí tam, kam ho posun dal" (včetně stroje),
  jen čistě poziční skupiny, zamykající čtení jako první dotaz transakce, `withRevision`,
  `assertNoOverlapForBlocks` na konci.
- UI: v historii bloku u řádku `AUTO_SHIFT` / `AUTO_REFLOW` tlačítko „Vrátit tuto změnu",
  které nejdřív ukáže **dry-run** (co se vrátí, jaké kolize hrozí) a teprve pak zapíše.
- Funguje po refreshi, pro jiného člověka i tehdy, když do bloků někdo sáhl — protože
  nestojí na optimistickém zámku z prohlížeče, ale na revizi.

## 4. Co se NEmění

Chain push sám (geometrie, pořadí, zdi) · `MAX_RIGID_PUSH_MS` u rigidních bloků ·
`validateAndComputeEnd`, `shouldRecomputeSchedule` · kaskádová kontrola směn z minulé vlny ·
`scripts/revert-revision-group.ts` zůstává (etapa D ho nenahrazuje, jen sdílí jádro) ·
**žádná migrace DB** · žádný feature flag za běhu.

## 5. Etapy a nasazení

| Etapa | Obsah | Nasazení |
| --- | --- | --- |
| **A** | číslo odsunutých v hlášce | společně s C |
| **C** | reflow do Ctrl+Z historie | **1. nasazení** — nemění chování, jen přestane mlčet |
| **B** | strop + potvrzení, nejdřív v režimu měření | **2. nasazení**, samostatně |
| **B2** | přepnutí `CASCADE_CONFIRM_ENFORCED` na `true` | po týdnu měření, vlastní commit |
| **D** | „vrátit revizní skupinu" jako funkce aplikace | **3. nasazení** / další PR |

Proč dělené: kdyby se zároveň změnilo chování dragu a přibyla nová zápisová cesta, nedalo
by se poznat, co případný problém způsobilo.

## 6. Testy

**Etapa A:** hláška s počtem i bez něj (prázdné `moves`), skloňování.
**Etapa C:** reflow zapíše krok · Ctrl+Z vrátí blok i odsunuté · Ctrl+Z **nevrací cizí
akci** (regrese dnešního stavu) · redo.
**Etapa B:** pod prahem projde beze změny · nad prahem 409 s počtem a datem · potvrzení
zapíše · rollback při odmítnutí nezanechá nic · **měřicí režim jen loguje** · drag po 409
vrátí optimistický stav · práh se počítá stejně na všech pěti volajících místech.
**Etapa D:** dry-run nezapisuje · guard odmítne blok, který mezitím někdo posunul jinam ·
odmítne skupinu, která není čistě poziční · obnova projde `assertNoOverlapForBlocks`.

## 7. Rizika

| Riziko | Jak ho držíme |
| --- | --- |
| Práh 5 je moc nízko → nový dialog na odklikávání | týden měření **před** vynucením (§3.3) |
| Drag zůstane s optimistickým stavem po 409 | vlastní test v etapě B |
| Dvě implementace obnovy (skript vs. endpoint) | etapa D sdílí jádro se skriptem, nekopíruje ho |
| Hromadný reflow je pro Ctrl+Z moc velký | proto etapa D; v C se to výslovně přizná |
| Zavlečení regrese do chain pushe samotného | geometrie se nemění, jen se přidává kontrola PŘED zápisem |

## 8. Co tahle vlna NEŘEŠÍ

Toast na cizí `schedule:changed` (plánovač se dodnes nedozví, že mu někdo změnil směny
pod rukama) · perzistentní historie napříč refreshem · zvětšení `MAX_HISTORY` nad 30.
