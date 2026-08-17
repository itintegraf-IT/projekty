# Opravy z incidentu zakázky 18827 (14. 8. 2026)

## Kontext

Audit nad produkčními daty 17. 8. 2026 doložil dvě nezávislé vady, které dohromady
stály plánovače den práce:

1. **Zakázka se sama prodloužila a odsunula 76 bloků.** V 10:37:58 rozdělil plánovač
   blok 1479 (split snížil `printMinutes` z 360 na 120). O 77 sekund později uložil
   v otevřeném editačním panelu změnu popisu, specifikace a tiskových archů — a s ní
   odešla i **délka 6 hodin z okamžiku otevření panelu**. Server ji vzal jako
   autoritativní (`api/blocks/[id]/route.ts:223`), konec dopočítal a chain push
   odsunul 75 navazujících bloků. Doloženo revizí 3536: `printMinutes` 120 → 360,
   `endTime` 17. 8. 19:30Z → 18. 8. 07:30Z.

2. **Krok zpět selhal a nešlo nic vrátit.** Undo editace skládá auditní řádek
   `startTime/endTime/machine+fields:` (33 znaků) + abecední seznam vrácených polí.
   Tady `description, specifikace, tiskoveArchy` = 38 znaků, celkem **71 znaků do
   sloupce `AuditLog.field`, který má na produkci `varchar(64)`** místo `varchar(191)`
   podle schématu. Prisma 500, rollback celé transakce, nevrátil se ani jeden ze 76
   bloků. Doloženo serverovým logem (třikrát: 08:39:20, 08:39:40, 08:41:17 UTC).

Cíl: zavřít obě příčiny tak, aby se plánovači nemohlo znovu stát, že mu jedno uložení
textu přeplánuje měsíc dopředu a nepůjde to vrátit.

Poznámka k rozsahu: oprava kliku na zakázku (commit `24b5bd17`) je hotová a nasazená
na testovací instanci; s tímhle plánem nesouvisí a čeká jen na proklik.

---

## Etapa 1 — Rozšířit produkční sloupce (odblokuje undo)

Nejmenší a nejcennější krok: bez něj zůstává záchranná brzda rozbitá.

**Ruční migrace** `prisma/migrations/20260817120000_widen_audit_and_order_columns/migration.sql`
(`prisma migrate dev` je v tomhle repu rozbité — shadow-replay padá na historické
migraci, viz paměť; migrace se píšou ručně a aplikují přes `migrate deploy`).

Tři sloupce, u všech je to při utf8mb4 změna **bez přestavby tabulky** (64 i 191 znaků
mají dvoubajtový délkový prefix), tedy bez zámku a bez výpadku:

```sql
ALTER TABLE `AuditLog` MODIFY `field`       VARCHAR(191) NULL;
ALTER TABLE `AuditLog` MODIFY `username`    VARCHAR(191) NOT NULL;
ALTER TABLE `Block`    MODIFY `orderNumber` VARCHAR(191) NOT NULL;
```

Na dev i testovací DB je to no-op (tam už 191 mají), takže migrace je idempotentní.

**Před napsáním migrace ověřit collation** (ať `MODIFY` tiše nepřevede znakovou sadu
na výchozí hodnotu tabulky) — na serveru, jen čtení:

```
sudo mysql igvyroba -e "SELECT TABLE_NAME,COLUMN_NAME,CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='igvyroba' AND ((TABLE_NAME='AuditLog' AND COLUMN_NAME IN ('field','username')) OR (TABLE_NAME='Block' AND COLUMN_NAME='orderNumber'));"
```

Pokud vyjde jiná než `utf8mb4_unicode_ci`, doplní se do `MODIFY` explicitně.

**Ověřit, že nevisí jiná neaplikovaná migrace** (`migrate deploy` by je vzal s sebou):
```
cd /var/www/planovanivyroby && npx prisma migrate status
```

**Ostatní odchylky se NEOPRAVUJÍ** a zapíšou se jako vědomě přijaté:
`Block.machine` varchar(16), `Block.type`/`recurrenceType`/`User.role` varchar(32)
— jejich rozšíření mění délkový prefix z jednoho bajtu na dva, tedy **přestavba celé
tabulky `Block`** za nulový přínos (drží krátké výčtové hodnoty). Sloupce širší než
schéma (`*StatusLabel`, `CompanyDay.label`, `User.passwordHash` = 255) jsou neškodné.

**Strážný test** `src/lib/undoApply.server.test.ts`: složit `field` pro realistickou
undo dávku editace (pozice + `description, specifikace, tiskoveArchy`) a ověřit, že se
vejde do 191 bajtů. Dnes žádný test neměří, že se ta hodnota vůbec někam vejde.

**Dokumentace:** sekci „Produkční DB — známé odchylky od migrací" v `CLAUDE.md`
přepsat podle skutečnosti (dnes jmenuje jen `AuditLog.action` a `Block.doprava`)
a přidat řádek do `docs/POUCENI.md`: *šířku produkčního sloupce nelze odvodit ze
schématu — `truncateUtf8` na 180 bajtů byla ochrana proti hodnotě, kterou sloupec
stejně nepobral.*

---

## Etapa 2 — Formulář nesmí poslat délku, které se nikdo nedotkl

Jádro incidentu. `BlockEdit` posílá `printMinutes` (u ne-ZAKAZKA `endTime`) **při každém
uložení**, i když plánovač sáhl jen na popis — a hodnota pochází z `useState`
inicializovaného jednou při otevření panelu (`BlockEdit.tsx:162`). Panel se přitom
odmountuje jen při změně **id** (`key={editingBlock.id}`, `PlannerPage.tsx:3305`),
takže split pod otevřeným panelem stav nepřegeneruje.

Tři vrstvy, každá malá:

**2a. Délka jde do payloadu jen když ji uživatel změnil.**
Nový stav `durationTouched`, nastavený v `onChange` selectu délky (`BlockEdit.tsx:968`).
Rozhodnutí vytáhnout jako **čistou funkci do `src/lib/blockPayload.ts`** (dnešní „jediný
zdroj" pro payload bloku) a otestovat — `BlockEdit.tsx` sám žádný test nemá a mít
nebude, ale tahle jedna funkce je testovatelná triviálně:

```
durationPayload({ type, touched, durationHours, startTime }) →
  {} | { printMinutes } | { endTime }
```

Když se délka neposílá, server u ZAKAZKY sáhne po `oldBlock.printMinutes`
(`route.ts:233`) a konec dopočítá ze skutečné uložené délky — tedy beze změny.

**2b. Neupravená délka se přesynchronizuje, když se blok pod panelem změní.**
`useEffect` na spočítanou `currentDurationHours`; přepíše stav jen pokud
`durationTouched === false`. Efekt se spustí výhradně při **skutečné změně délky na
serveru** — cizí odklepnutí chipu, které mění jen `updatedAt`, panel nerozhodí.
Záměrně tedy NE `key` odvozený z `updatedAt`: to by při šesti lidech v aplikaci
zahazovalo rozepsanou editaci kdykoliv někdo jiný sáhne na tutéž zakázku.

**2c. Když délku uživatel změnil A zároveň se změnila na serveru, upozornit.**
Zbytkový případ: plánovač si nastaví 8 h, mezitím proběhne split, uloží → jeho 8 h
se zapíše. Je to vědomá akce na zastaralém předpokladu, takže ji neblokovat, ale
zobrazit v panelu inline hlášku „délka bloku se mezitím změnila na X h".

**Optimistický zámek se ZÁMĚRNĚ nemění.** `doSave` ho posílá (`BlockEdit.tsx:718`),
ale bere čerstvou verzi z `allBlocks`, takže posplitovou změnu neodhalí. Ukotvit ho
k verzi z okamžiku otevření panelu by znamenalo odmítnout uložení po každém chain
pushi pod otevřeným panelem — to je při 79 odsunutých blocích denně častější než
incident, který řešíme. Vrstvy 2a–2c problém zavírají bez falešných konfliktů.
Rozhodnutí i důvod zapsat do komentáře, ať se k němu někdo nevrací naslepo.

*Známá mezera, kterou tenhle plán NEŘEŠÍ:* cesta „Celou sérii" (`handleSaveAll`,
`PlannerPage.tsx:1889`) neposílá `expectedUpdatedAt` vůbec. Vrstvy 2a–2c ji kryjí
taky (payload je týž), takže se sem nepřidává — jen se to pojmenuje v komentáři.

---

## Etapa 3 — PUT nepřepočítává harmonogram, když se harmonogram nemění

**Volitelná, rozhodne Vojta.** Etapy 1 a 2 zavírají doložený incident; tahle zavírá
jeho obecnější tvar.

`needsScheduleComputation` (`route.ts:149`) je pravdivé už jen proto, že payload
obsahuje `type` — a `BlockEdit` ho posílá vždycky. Každé uložení jakéhokoliv pole tedy
konec bloku přepočítá. U bloku, jehož uložený `endTime` nesedí na aktuální kalendář
(stav `END_MISMATCH`, `calendarDrift.server.ts:157`), se blok tichým přepočtem
**posune** — a `CLAUDE.md` přitom výslovně vyjmenovává tři cesty, které smí značku
driftu zrušit, a všechny vycházejí z akce uživatele. Editace textu je nezdokumentovaná
čtvrtá.

Změna: podmínku odvodit z **rozdílu proti `oldBlock`**, ne z pouhé přítomnosti klíče
v payloadu. Musí se proto přesunout dovnitř transakce, kde je `oldBlock` k dispozici.
Jádro vytáhnout jako čistou funkci `shouldRecomputeSchedule(oldBlock, allowed)` do
`src/lib/scheduleValidationServer.ts` (kde už testy jsou) a pokrýt tabulkovým testem:
změna typu · změna startu/stroje/konce · explicitní jiná `printMinutes` · a hlavně
**čistě textová editace = žádný přepočet**.

Důsledek, který je třeba vyslovit: rozejitý blok se editací textu přestane „sám
spravovat". To je záměr — od toho je adresné tlačítko „Přepočítat".

---

## Ověření

**Automatické** (po každé etapě):
```bash
npx tsc --noEmit
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
npm run build && npm run lint
```

**Proklik v běžící aplikaci** (Playwright ve scratchpadu, účet `planovac`, recept
v paměti `screenshot_bezici_appky`) — reprodukce incidentu krok za krokem:
1. Otevřít detail zakázky, **nechat panel otevřený**.
2. V jiné záložce/gestem blok rozdělit.
3. V otevřeném panelu změnit jen popis a uložit.
4. **Očekávání: konec bloku se nezmění a žádný soused se neodsune.** Před opravou se
   délka vrátí na předsplitovou hodnotu.
5. Změnit délku ručně → uloží se (2a nesmí zablokovat legitimní změnu).
6. Undo editace se třemi změněnými poli → **projde** (etapa 1).

**Nasazení:** vždy nejdřív testovací instance (`/var/www/planovanivyroby-test`, port
3021, DB `igvyroba_test`, PM2 `planovani-TEST`), teprve po prokliku produkce. U obou
`mysqldump` jako první krok a PRE/POST otisk `COUNT(*) / SUM(TIMESTAMPDIFF(SECOND,
startTime, endTime)) / SUM(printMinutes)` — u etapy 1 se **nesmí lišit**, migrace mění
jen šířku sloupců.

---

## Jak se to bude provádět (subagent-driven development)

Klasický superpowers postup: **na každou etapu čerstvý implementační subagent**, po
něm **recenzní subagent** (soulad se zadáním + kvalita kódu), případné nálezy v opravné
smyčce, a na konci **široká recenze celé větve** na nejsilnějším modelu. Průběh se
zapisuje do ledgeru v `.superpowers/sdd/`, aby se práce neztratila při kompakci kontextu.

**Jedna vědomá odchylka od skillu:** ten předepisuje projet všechny úkoly bez zastavení.
Tvoje pravidlo „zastav po každé etapě a počkej na OK" má přednost, takže **po každé
etapě zastavím** — po recenzi, s hotovým commitem, a čekám. Vidíš tak tři čisté
zastávky místo jedné velké hromady na konci.

**Bez worktree, přímo na větvi `Vojta`.** Worktree by si vyžádal vlastní `node_modules`
(u Nextu řádově minuty a stovky MB) a deploy postup stejně počítá s `Vojta` → `michal`.
Riziko souběhu s tvými paralelními sessions pokrývá kontrola `git log` na začátku každé
etapy a to, že každá etapa sahá na jiné soubory.

**Modely:** implementace etap 1 a 2 na standardním modelu (mechanické, jasně zadané),
etapa 3 na nejsilnějším (zásah do transakční PUT cesty). Recenze etap standardní,
závěrečná recenze celé větve na nejsilnějším.

Plán se před spuštěním překlopí do repa jako `docs/superpowers/plans/2026-08-17-opravy-incidentu-18827.md`
— tam ho projekt čeká a subagenti z něj budou číst zadání.

## Pořadí a zastávky

| # | Etapa | Rozsah | Zastávka |
| --- | --- | --- | --- |
| 1 | Migrace sloupců + strážný test + dokumentace | migrace, 1 test, 2 dokumenty | commit, čekat na OK |
| 2 | Formulář neposílá nesáhnutou délku (2a–2c) | `BlockEdit.tsx`, `blockPayload.ts` + test | commit, čekat na OK |
| 3 | PUT přepočítává jen při skutečné změně | `route.ts`, `scheduleValidationServer.ts` + test | commit, čekat na OK |

Etapy 1 a 2 jsou na sobě nezávislé a dají se nasadit zvlášť. Etapa 3 se dá odložit
nebo zahodit, aniž by 1 a 2 přestaly dávat smysl.
