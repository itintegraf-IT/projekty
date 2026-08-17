# Spec: pravdivá kontrola kaskády směn

Datum: 17. 8. 2026 · Autor: Vojta + Claude · Stav: **navrženo, neimplementováno**
Verze: **v3** — po druhém kole multi-agent review (3 adversariální perspektivy). Proti v2 se
**zmenšil rozsah** a **opravila jedna věcná chyba**; viz §8.
Podklady: `docs/audits/2026-08-17-falesna-kaskada-zkraceni-smeny.md` · incidentní commity
`1cb95cc0`, `4590c612`

---

## 1. Co opravujeme a co ne

**Opravujeme:** dialog „Zkrácení směny ovlivní existující bloky" je falešný poplach. Hlásí se
smí jen blok, který **touto** změnou směn ztratí místo v pracovní době.

**Neopravujeme tím dnešní havárii z 16:31** (88 bloků) a nesmí se to tak nikde napsat. Řetěz
příčin té havárie je jiný a zůstává otevřený — viz §6.

### 1.1 Věcná oprava proti v2: havárie nevznikla z latentního driftu

Expanze tiskových hodin je **monotónní ve směnách** — `expandPrintTime` spotřebuje 30 minut za
každý runnable slot od startu. Z toho plyne:

| Změna směn | Runnable slotů | Spočítaný konec | Riziko kaskády |
| --- | --- | --- | --- |
| **přidání** | víc | **dřív** nebo stejně | žádné — kratší blok nemá koho odsunout |
| **zkrácení** | méně | **později** | latentní: příští dotek bloku ho nafoukne a odsune navazující |

Protažení odpolední směny do 24:00 tedy mohlo konec bloku 18424 jen **zkrátit**. Že se posunulo
87 bloků, je proto **důkaz, že ten blok rozejitý nebyl** — jeho uložený konec 24:00 kalendáři
odpovídal. Skutečná mechanika: blok končil **přesně na hraně směny** (180 tiskových minut od
21:00), posun o jeden slot přesunul 30 z nich za osmihodinovou noční pauzu, konec skočil o délku
pauzy na 6:30 a dosedl na následníka. To není vada, ale **definiční nelinearita tiskových hodin**.

Vada je, co se stalo pak: 87 bloků se posunulo bez potvrzení, bez stropu a bez použitelné cesty
zpět. A tvrdý důkaz, že dialog na to není odpověď: podle forenzní tabulky auditu vyžadovalo na
XL 105 každé skutečné uložení směn `[FORCE]` — dialog v 16:25 tedy skoro jistě vyskočil a byl
odkliknut.

## 2. Rozhodnutí

| # | Otázka | Rozhodnutí |
| --- | --- | --- |
| 1 | Význam alarmu | **Diferenčně** — jen bloky, které rozbije tato změna |
| 2 | Co blokuje uložení | **Jen „blok nemá kde být".** Posun spočítaného konce neblokuje |
| 3 | Jak zjistit cílový stav | **Měřit, ne simulovat** — `detectCalendarDrift` uvnitř transakce před a po upsertech |
| 4 | Ukládání strojů | Force **jen za stroj z dialogu** |
| 5 | Rozsah typů | **Jen `ZAKAZKA`** (co umí `detectCalendarDrift`). Rezervace/údržba → backlog |
| 6 | `SHIFTED` | Rozlišit **podle směru**; „konec se prodloužil" dostane neblokující větu |
| 7 | Monitor u stroje | **Označit čas**, o kterém aplikace ví, že nesedí |

### 2.1 Proč rozhodnutí #3 (klíčová změna proti v2)

V2 navrhovala postavit nový predikát a **simulovat** cílový kalendář. Zbytečně:
`detectCalendarDrift` už **běží ve stejné transakci** (`route.ts:406`, komentář výslovně říká
„tx vidí vlastní upserty") a už dnes umí pět ze šesti věcí, které v2 vydávala za nové:

| v2 tvrdila, že je potřeba postavit | Kde už to je |
| --- | --- |
| filtry `type` / `scheduleBypassed` / `printMinutes` / `printCompletedAt` | `calendarDrift.server.ts:100-108` |
| `endTime > now` (minulost neblokuje) | tamtéž, `activeAfter = max(windowStart, now)` |
| kotva kalendáře podle nejstaršího bloku | `calendarDrift.server.ts:124-128` |
| `logger.warn` u vadné expanze | `:138-144` |
| rozlišení „nemá kde být" od „skončí jinde" | `!expanded.ok` vs. `reason: "END_MISMATCH"` |

Chybí jediné: detektor nedostane *navrhované* řádky směn. Ale cílový stav není potřeba
simulovat — **stačí ho změřit po zápisu a při konfliktu transakci odrolovat.** Tím zaniká celý
nový modul, skládání kalendáře, DB vrstva, TOCTOU re-check i strážný test pořadí. A hlavně
nevznikne **druhá implementace** pravidla „sedí blok na kalendář", před kterou `CLAUDE.md` varuje.

Degradace je navíc bezpečná: kdyby někdo `before` omylem načetl až po upsertech, vyjde
`before == after` → **mlčení**, ne falešný poplach. V2 degradovala do nebezpečného směru.

## 3. Návrh

### 3.1 Kontrola v transakci (`route.ts`)

```
const now = new Date(); const { from, to } = computeConflictWindow(parsedWeek);
let cascade: CascadeDiff | null = null;

$transaction(async (tx) => {
  const before = await detectCalendarDrift(tx, [machine], from, to, now);   // NOVÉ
  …7× upsert směn…                                                          // beze změny
  const after  = await detectCalendarDrift(tx, [machine], from, to, now);   // JIŽ TAM JE
  cascade = classifyCascade(before, after);                                  // čistá funkce
  if (!force && cascade.newlyHomeless.length > 0)
    throw new AppError("CONFLICT", "SHIFT_SHRINK_CASCADE");                  // → rollback
  …auditLog…
  await notifyCalendarDrift(tx, after, session, …);                          // beze změny
});
```

`cascade` je proměnná v uzávěru — rollback ji nesmaže, takže catch blok z ní složí `409`
s výčtem. Pre-transakční `findConflictingBlocks` i `assertNoConflictingBlocks` **zanikají**.

### 3.2 Čistá funkce `classifyCascade`

```ts
export type CascadeDiff = {
  newlyHomeless: DriftedBlock[];  // ztratil místo TOUTO změnou → BLOKUJE
  newlyLonger: DriftedBlock[];    // konec se prodloužil → NEBLOKUJE, jen se pojmenuje
};
```
- `homeless(d) = d.reason !== "END_MISMATCH"` (tj. `!expanded.ok`)
- `longer(d) = d.reason === "END_MISMATCH" && d.expectedEnd > d.endTime`
- „newly" = je v `after` a **nebyl v téže kategorii** v `before` (porovnání podle `id`)

Salámová díra je tím krytá zdarma: blok, který byl `END_MISMATCH` a po změně je `HOMELESS`,
v `before.homeless` není → ohlásí se.

### 3.3 Dialog

- Titulek pravdivý: `Změna směn na XL 106 vystěhuje z pracovní doby bloky (3)` — počet v závorce,
  **bez skloňování** (žádné `czPlural`, to je samostatný úklid).
- Stroj přes `machineLabel` (`machines.ts`), nikdy `machine.replace("_"," ")`.
- Tabulka: **Zakázka · Popis · Od–Do · Proč nesedí**. Sloupec typu netřeba — kontrola vrací
  výhradně `ZAKAZKA` (rozhodnutí #5). Mapa důvodů jako `Record` nad `DriftedBlock["reason"]`,
  aby nová hodnota nešla přidat bez textu.
  → `detectCalendarDrift` dostane do `select` **`description`** (aditivní, +1 pole v typu a ve
  fake klientovi testu).
- Pod tabulkou **neblokující věta**, když `newlyLonger` není prázdné:
  *„Žádný další blok se nevystěhuje. U N zakázek se ale tímto zkrácením prodlouží spočítaný
  konec — jejich příští úprava odsune navazující zakázky."* To je jediná věta v celém specu,
  která má vztah k riziku kaskády.
- Escape → zrušit; počáteční fokus na **„Zrušit změnu"**; potvrzovací tlačítko přes `btnDanger`
  (`uiStyles.ts:50-53`) místo `--danger` + `white` (4,08 : 1 light / 3,43 : 1 dark, pod AA).
  Zbytek přístupnostního dluhu (focus trap, aria, sticky hlavička, `busy`) → backlog.
- Text nesmí slibovat „Přepočítat" jako univerzální nápravu ani říkat „DB".

### 3.4 Force jen za stroj z dialogu

`MachineWorkHoursWeek.submitSave` dnes posílá `?force=1` ve smyčce **za všechny stroje**, takže
potvrzení kaskády na XL 105 **přeskočí kontrolu XL 106** a jeho konflikty se uloží, aniž je kdo
viděl. Je to jediná díra, kterou dnes projde **pravá** kaskáda. Oprava: 409 nese `machine`,
dialog si ho pamatuje, force jde jen za něj; ostatní stroje se ukládají dál bez force.

`changedMachines` (posílat jen změněné stroje) → **backlog**: po opravě kontroly je hodnota
těch no-op zápisů kosmetická a jeho hraniční případy (`copyFromPrev`, `emptyWeek` fallback) jsou
právě tam, kde v tomhle repu vznikají nové vady.

### 3.5 Monitor u stroje

Dnes `MonitorQueue.tsx:209` a `MonitorHeroTiming.tsx:62` tisknou `block.endTime` **natvrdo** a o
driftu nevědí nic (grep nad `src/components/monitor/` je prázdný). Tiskař navíc není v
`INBOX_ROLES` (`useNotifications.ts:9`), takže **nemá žádný kanál**, jak se to dozvědět.
Důsledek: člověk, který podle toho času rozhoduje, co pustí do stroje, čte číslo, o kterém
aplikace sama ví, že je špatné — a je to jediný člověk, který to nemůže spravit.

- `MonitorView` dostane `machineWeekShifts` + `companyDays` v props (v `PlannerPage` už jsou) a
  předá je frontě i velké kartě. **Dnes je nemá vůbec**, takže drift spočítat nemůže.
- Rozsah z **klientského** detektoru `blockCalendarDrift` (`printTimeClient.ts:244`), protože ten
  jediný umí posoudit jeden blok. **Odložené bloky vyloučit** (`isParkedDrift` z
  `calendarDriftUi.ts`) — vědomé odložení není porucha, kterou má tiskař vidět.
- Zobrazení: doplnit značku `⚠ nesedí na kalendář` (`MonitorDriftNote`). **Ztlumení textu
  NEPŘIDÁVAT** — bylo by no-op: rodičovský řádek osy na Monitoru už je celý `--text-muted`,
  takže vlastní barva na časovém spanu by nic neměnila (ověřeno implementací, `MonitorHeroTiming.tsx`,
  M3 fix roundu finální recenze). Signál nese výhradně značka. Velikosti **výhradně** přes
  `monitorTypeScale` (`monitorTypography.ts`) — hlídá to strážný test regulárem nad zdrojáky.
  Nesmí to vytlačit tlačítko HOTOVO (rozpočty `tiskarBlockView.ts`).

### 3.6 Zobecnit záchranný skript

`scripts/revert-cascade-20260817.ts` je dnes jednorázový, ale veškerá mechanika je hotová a
ostře prověřená: cíle z `BlockRevision.before`, guard „blok musí stát tam, kam ho havárie
posunula", simulace cílového stavu se **všemi** kolizemi (`4590c612`), `withRevision`,
`assertNoOverlapForBlocks`. Zobecnit na `scripts/revert-revision-group.ts`:

```
npx tsx scripts/revert-revision-group.ts --group <groupId> [--also <id>:endTime=…,printMinutes=…] [--apply]
```
Bez `--apply` jen dry-run. Doplnit odstavec do `docs/OPS_ZALOHY.md`. Příští kaskáda pak bude
desetiminutová operace, ne psaní skriptu pod tlakem.

## 4. Co se NEmění

`?force=1` a „Uložit i přesto" · driftové notifikace po zápisu (zůstávají **absolutní** — dříve
rozejité bloky tak nezmizí ze světa, jen z jednoho dialogu) · počítadlo nad strojem · štítek na
kartě · `/reporty` · `checkScheduleViolationWithTemplates` · `shouldRecomputeSchedule` a
`validateAndComputeEnd` (v havárii se zachovaly správně; zúžení recompute by vrátilo lživou
geometrii do DB) · **žádná migrace DB** · žádný feature flag.

## 5. Testy

| # | Scénář | Očekávání |
| --- | --- | --- |
| 1 | `classifyCascade`: prázdné vstupy | prázdný diff |
| 2 | Blok `HOMELESS` v `after`, chybí v `before` | `newlyHomeless` = 1 |
| 3 | Blok `HOMELESS` v `before` i `after` | `newlyHomeless` = 0 (už byl rozbitý) |
| 4 | `END_MISMATCH` v `before` → `HOMELESS` v `after` (salám) | `newlyHomeless` = 1 |
| 5 | `END_MISMATCH` s `expectedEnd > endTime` nově | `newlyLonger` = 1, `newlyHomeless` = 0 |
| 6 | `END_MISMATCH` s `expectedEnd < endTime` (přidání směny) | oba prázdné |
| 7 | Titulek dialogu — 1 / 3 bloky, label stroje, žádné surové `XL_106` | pravdivý |
| 8 | Mapa důvodů je vyčerpávající nad `DriftedBlock["reason"]` | drží |
| 9 | Monitor: blok s driftem nese značku, **odložený nikoli** | drží |
| 10 | Monitor: velikosti jen z `monitorTypeScale` | drží (existující strážný test) |

**Ruční proklik na dev**: přidat sobotní směnu k víkendové zakázce → **žádný dialog** · vypnout
směnu pod zakázkou → dialog s pravdivým titulkem · uložit bez změny → žádný dialog · zkrátit
směnu tak, aby se konec prodloužil → **bez dialogu**, ale s větou o prodloužení.

**Zaniká** 11 testů v `findConflictingBlocks.test.ts` spolu s modulem (zůstane
`computeConflictWindow`, který používá route). Geometrii už kryje `calendarDrift.server.test.ts`
(13 testů) včetně `END_MISMATCH`, odložených, vytištěných, `endTime < now` a parity klient↔server.

## 6. Co zůstává otevřené (backlog, seřazeno podle hodnoty)

1. **Strop a potvrzení kaskády** v `resolveChainPushFromDb` — zakázka dnes **nemá horizont
   posunu** (`overlapResolver.ts:161` doslova „Zakázka horizont nemá"), zatímco rigidní blok má
   `MAX_RIGID_PUSH_MS` = 7 dní (`:39`). Nad ~5 posunutými bloky nebo posunem přes 7 dní vrátit
   409 s počtem a nejvzdálenějším datem a nechat uživatele potvrdit. Jedno místo kryje **všech
   šest zápisových cest**. *Toto je skutečná náprava havárie 16:31.*
2. **Toast na `schedule:changed`** — cizí změna směn dnes dorazí do otevřeného plánu **mlčky**
   (`PlannerPage.tsx:670`). Jediná chvíle, kdy by signál dopadl na správného člověka ve správné
   sekundě.
3. **Náhled kaskády při dropu** — počet odsunutých bloků se dnes dozví až toastem **po** zápisu
   (`PlannerPage.tsx:1150`).
4. **Undo z `BlockRevision` jako funkce aplikace** — zásobník je v paměti, 30 kroků
   (`useUndoManager.ts:5`), při konfliktu se záznam zahodí. Data v černé skříňce jsou.
5. **Směr driftu v notifikacích a na kartě** — `END_MISMATCH` nerozlišuje „dřív" od „později".
6. **Rezervace/údržba v kontrole kaskády** — `detectCalendarDrift` měří jen `ZAKAZKA`; stará
   (smazaná) `findConflictingBlocks.ts` běžela BEZ filtru typu, takže REZERVACI i ÚDRŽBU hlásila
   taky. Tohle je proto **REGRESE proti stavu před touto vlnou, ne nikdy nepokrytá oblast** — dřív
   se o zkrácení směny pod víkendovou údržbou operátor aspoň (falešně poplašně) dozvěděl, dnes
   ne vůbec, a rigidní blok mimo kalendář je navíc zeď pro chain push (`CLAUDE.md`), takže se to
   projeví 409 bez varování až při příštím dropu vedle něj. · `changedMachines` · zbytek
   přístupnostního dluhu dialogu · `czPlural` sjednocení.
7. **Částečné uložení napříč stroji** — `MachineWorkHoursWeek.tsx` ukládá stroje v `MACHINES`
   pořadí jeden po druhém (`submitSave`). Když 409 přijde na k-tém stroji, stroje PŘED ním jsou
   už zapsané a „Zrušit změnu" nic nevrátí ani o tom neřekne. Předexistující stav, ale tahle vlna
   dialog zpravdivěla („po uložení v ní ležet přestanou" je teď věcně přesné) — uživatel mu bude
   víc věřit, takže ta tichá díra teď podražila.
8. **`checkScheduleViolationWithTemplates` (`src/lib/scheduleValidation.ts:99`) ztratila
   jediného produkčního volajícího** zánikem `findConflictingBlocks.ts` (viz bod 6) — zbyl jen
   vlastní test a dev seed skript. Rozhodnutí této vlny: **ponechat** (dev seed ji používá a má
   vlastní testy pokrytí), ale zapsat jako dluh k rozhodnutí, ne mlčky smazat.

## 7. Dokumentace

1. `CLAUDE.md` — kontrola kaskády měří skutečný stav v transakci (ne simulaci) a `before` se
   proto čte **před** upserty; `machine-week-shifts` nemutuje `Block`, proto force nic neposouvá.
2. `docs/POUCENI.md` — tři řádky:
   - *Absolutní kontrola vydávaná za diferenční („Zkrácení směny") — alarm, který nekoreluje
     s realitou, vychová obsluhu k odklikávání.*
   - *Než postavíš druhou implementaci pravidla, ověř, jestli první neběží o šedesát řádků níž
     na téže cestě. Cílový stav se často nemusí simulovat — stačí ho změřit a transakci odrolovat.*
   - *Veličina počítaná přes kalendář se u hranice směny nemění spojitě — posun o jeden slot umí
     konec bloku posunout o délku pauzy. Kde takový skok vstupuje do automatiky (chain push),
     musí být strop a potvrzení odvozené od DŮSLEDKU, ne od velikosti gesta.*
3. `docs/OPS_ZALOHY.md` — `revert-revision-group.ts`.
4. `docs/vyvoj-historie.md` — etapa + zánik `findConflictingBlocks`.
5. **V commitu ani v POUCENI netvrdit, že se tím uzavírá třída chyby z 16:31.** Dokud neexistuje
   bod 1 backlogu, je kaskáda otevřená.

## 8. Změny proti v2

**Zmenšeno:** zaniká `calendarConformance.ts`, `composeCalendars`, `detectConflictsPure`, celá DB
vrstva, `ConflictCheckClient`, strážný test pořadí, TOCTOU re-check, přepis 8 testů, `czPlural`,
`changedMachines`, E5 (přepojení driftu), většina přístupnostního dluhu. Z 11 tasků zbývá 6.

**Opraveno věcně:** tvrzení, že havárie 16:31 vznikla z latentního `SHIFTED` — **je nepravdivé**
(monotonie expanze, §1.1). Rozhodnutí „posun konce neblokuje" tím ale zesílilo, ne oslabilo.

**Přibylo:** rozlišení `SHIFTED` podle směru + neblokující věta · značka na Monitoru · zobecnění
záchranného skriptu · `description` do driftového selectu · backlog s pořadím podle hodnoty.
