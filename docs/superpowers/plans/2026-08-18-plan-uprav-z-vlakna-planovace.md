# Plán úprav z e-mailového vlákna s plánovačem — etapy

> **Charakter dokumentu:** roadmap etap vzešlý z nočního auditu
> `docs/audits/2026-08-18-audit-vlakna-planovace-lukas.md` (tam jsou důkazy a čísla commitů).
> Etapy 3–5 dostanou před implementací vlastní detailní plán (spec → plan dle
> `docs/superpowers/`), protože závisí na rozhodnutích v sekci „Otevřená rozhodnutí".
> Pořadí etap = doporučená priorita.

**Cíl:** dotáhnout 3 neimplementované připomínky (+1 odloženou), nasadit hotovou, ale nenasazenou opravu falešné hlášky, a zavřít dva vědomě otevřené dluhy, které vlákno obnažilo (P27, P31).

---

## Etapa 0 — Nasazení kaskádové vlny (žádný nový kód) · odhad: hodina + proklik

**Proč první:** oprava falešné hlášky „Zkrácení směny" je hotová a otestovaná (1314/1314), ale žije jen na tomto Macu — není ani na origin. Lukáš přitom směny kvůli poruchám strojů aktivně staví a hlášku dostává dál. Zároveň se tím srovná test (dnes pozadu za produkcí o `9712702a` a `115a815d`), o který si Lukáš řekl.

**Postup:** přesně dle runbooku `docs/DEPLOY_2026-08-17_KASKADA.md`:
1. `git push origin Vojta` (vyžaduje firemní síť / VPN).
2. Deploy na test 3021 (`igvyroba_test`, PM2 `planovani-TEST`) — žádná migrace, rollback `git reset --hard`.
3. Proklik 6.1–6.5 z runbooku. Nejvyšší riziko: **údržba + vypnutá sobota** — nová kontrola měří jen ZAKAZKA (vědomé zúžení; stará kontrola údržbu hlásila aspoň falešně).
4. Po Lukášově potvrzení na testu → produkce (dle `docs/DEPLOY_WORKFLOW.md`, **před zásahem mysqldump záloha**, PRE/POST otisk).

**Akceptace:** přidání sobotní směny na testu nevyhodí žádný dialog, skutečné zkrácení směny s dotčenou zakázkou vyhodí dialog s labelem stroje a důvodem.

---

## Etapa 1 — Stav materiálu „ČÁSTEČNĚ VYDÁNO" · odhad: M (~den) · **ROZHODNUTO 19. 8.: varianta (a) — mini tlačítko „½"** (Vojta, po interaktivním mockupu)

**Korekce 19. 8.:** původní odhad S („přes admin číselník") mířil na špatný mechanismus. Skladníci myslí **stavová tlačítka SKLAD/VYDÁNO** (`materialInStock`/`materialIssued` — dva Booleany na `Block`, `prisma/schema.prisma:128–129`; UI `BlockEdit.tsx:1150–1155`; chip „M SKLAD/VYD." na kartě). Nový stav = změna kódu.

**Datový model:** nový Boolean `materialPartiallyIssued` (částečně a plně vydáno se vzájemně vylučují — nastavení jednoho vypne druhý). Dotčená místa (grep `materialInStock|materialIssued` → ~35 souborů):
- schéma + ruční migrace (migrate dev je rozbité) — pozor, `Block` je na produkci velká tabulka
- `blockPayload.ts` (P26/P27 — nové pole vstupuje do buildPayload!), `splitSharedFields.ts` (propagace na split sourozence — stavy materiálu tam už jsou), `seriesPropagation.ts`
- audit: `auditedFields.ts` + `auditFormatters.ts`; revize: `revision/blockColumns.ts` (strážný test nový Boolean vynutí sám); undo: `undo/restoreFields.ts`
- UI: `BlockEdit.tsx`, `BlockCard.tsx` (chip „M ČÁST." — nový stav do `mStateKey`), `BlockDetail.tsx`, `JobBuilderPanel.tsx` + rezervační `PlanningForm.tsx`, `monitorChips.ts`

**Prostor v BlockEdit (znovu tatáž bolest jako u Pantone):** řádek tlačítek se vešel jen se zkratkami „P!/SKL./VYD." (~137 px, komentář `BlockEdit.tsx:1168–1171`). Varianty k rozhodnutí V2:
- **(a) mini tlačítko „½"** vedle VYDÁNO (doporučeno): plné vydání zůstává 1 klik (nejčastější případ beze změny), šířka ~24 px, na úzkém panelu se řádek zalomí (flexWrap už existuje). Zobrazený stav: „Část. vydáno ➜" (oranžová/amber místo modré).
- **(b) cyklus na tlačítku VYDÁNO** (nic → ČÁSTEČNĚ → VYDÁNO → nic): nulová šířka navíc, ale plné vydání = 2 kliky — penalizuje nejčastější akci a cyklus je neobjevitelný.
- **(c) select místo tlačítek** (— / SKLAD / ČÁSTEČNĚ VYDÁNO / VYDÁNO): nejčistší stavový model, ale mění zaběhnutý workflow MTZ a je to největší zásah.

**Akceptace:** MTZ označí materiál jako částečně vydaný jedním gestem; karta ukazuje „M ČÁST."; stav se propaguje na split sourozence, přežije undo a je vidět v historii bloku.

---

## Etapa 2 — Reporty pro roli PLANOVAT · odhad: S/M (½ dne s testy)

**Blokováno rozhodnutím V1 (viz níže).** Doporučená varianta: PLANOVAT dostane celou stránku `/reporty` read-only (jmenovitý žebříček byl odstraněn `f3332283`, citlivost nízká).

**Rozsah — všech 6 vynucovacích míst (žádný centrální seznam neexistuje):**
| Místo | Soubor | Změna |
|---|---|---|
| stránka (redirect) | `src/middleware.ts:60–64` | podmínku rozšířit o PLANOVAT |
| dashboard API (403) | `src/middleware.ts:66–71` | dtto |
| server guard stránky | `src/app/reporty/page.tsx:8` | dtto |
| `ALLOWED_ROLES` | `src/app/api/report/dashboard/route.ts:25` | přidat PLANOVAT |
| attention + health API | `src/app/api/report/attention/route.ts:48`, `.../health/route.ts:10` | `requireRole(["ADMIN","PLANOVAT"])` |
| tlačítko „Reporty" | `src/app/_components/PlannerPage.tsx:3094–3105` | podmínka jako u tlačítka „Správa" |

**Zvážit:** zavést jednu konstantu `REPORT_ROLES` (např. v `src/lib/authz.ts`) a všech 6 míst na ni napojit, ať příště nejde o šestibodovou změnu. Strážný test: route testy na 200/403 pro ADMIN/PLANOVAT/VIEWER.

**Akceptace:** účet `l.lukes` (ověřit roli, otázka P1) vidí `/reporty` včetně vytížení a stability plánu; VIEWER/TISKAR dál dostávají redirect/403.

---

## Etapa 3 — Skupinový přesun zakázek přes noc · odhad: M (1–2 dny)

**Kořen (z analýzy, detaily v auditu §2, e-mail 12. 8. bod 1):** skupina se posouvá o jedinou společnou deltu; snap `snapGroupDeltaStartOnly` (`src/lib/printTimeClient.ts:71–101`) koriguje jen dopředu („rohatka"). Důsledky: tažení zpět přes hranici směny = tichý no-op (hlavní „nefunguje"); tažení dopředu = teleport celé skupiny o den; falešné 409 z expanze; nediagnostické 422.

**Krok 3a — okamžitá UX záplata (S, nasaditelná samostatně):**
V `TimelineGrid.tsx:1128–1138` rozlišit výsledky snapu: beze změny delty nic nehlásit; `delta ≈ 0` při nenulovém návrhu → „Skupinu nelze posunout zpět přes hranici směny — přesuňte bloky jednotlivě"; jinak `onInfo` (ne `onError`) „Bloky posunuty o X h kvůli noci/víkendu". Jen texty a kanál toastů, riziko nulové.

**Krok 3b — vlastní oprava: per-blok snap se zachováním pořadí (M):**
- Seřadit vybrané bloky dle původního startu; první snapnout `snapStartToNextRunnableSlot` z `start + delta`; každý další na `max(vlastní posunutý start, konec-v-tiskovém-čase předchůdce)` — klientská expanze `expandPrintTime` už existuje (používá ji preview cache).
- **Server beze změny** — `POST /api/blocks/batch` už přijímá per-blok `startTime` a end si počítá sám.
- Smíšený výběr analogicky s rigidní délkou (`snapToNextValidStartWithTemplates`, vzor `chainPushGeometry`).
- `scheduleBypassed` členy nesnapovat (posunout doslova) — jinak by lasso odloženou zakázku re-expandovalo (chrání to sticky-OR na serveru).

**Krok 3c — volitelné dotažení:** preview kreslit všechny vybrané bloky na snapnutých pozicích (dnes jen kotva s hrubou deltou) — pozor na výkon v mousemove (cache).

**Rizika / kontroly:**
- Parita klientské a serverové expanze (`expandPrintTime` vs. `expandPrintTimeFromDb`) — tabulkový test parity po vzoru `calendarDrift.server.test.ts`.
- Nepřeskládat pořadí split sourozenců (chain push s nimi počítá jako `frozenIds`).
- Undo beze změny tvaru `updates`; ověřit, že no-op dávka nezakládá prázdný undo záznam.
- Po opravě zůstanou `snapGroupDeltaStartOnly`/`snapGroupDeltaWithTemplates` bez volajících → smazat (grep potvrdil jediného konzumenta TimelineGrid).

**Akceptace:** (1) tažení skupiny zpět přes 22:00 skupinu stáhne k nejbližším platným slotům; (2) tažení dopředu přes noc nechá přední bloky na místě a jen ocas přeteče za pauzu; (3) žádný falešný 409/„teleport"; (4) jeden krok zpět vrátí celou skupinu.

---

## Etapa 4 — Zavřít třídu P26/P27: zastaralá pole z otevřeného panelu · odhad: M/L (2–3 dny)

**Stav:** incident 14. 8. opraven jen pro tiskovou délku; `buildPayload()` (`src/components/BlockEdit.tsx`) posílá ~30 dalších polí ze snapshotu při otevření panelu. Riziko dnes: tiché vrácení chipů/termínů na starou hodnotu (žádné z polí nespouští chain push) — ale je to výslovný otevřený dluh (`docs/POUCENI.md` P26/P27: „Tohle je otevřený dluh, ne hotová věc").

**Přístup (P27 nabízí dvě cesty — vybrat ve specu):**
- (a) rozšířit touched-tracking (vzor `blockEditDuration.ts` / `durationTouched`) na všechna pole `buildPayload()`, nebo
- (b) diff proti mount-snapshotu: payload = jen pole, kde se aktuální hodnota liší od stavu při otevření panelu (méně kódu na pole, ale nutná opatrnost u polí odvozených/normalizovaných).
Doporučení: (b) diff proti snapshotu — jeden mechanismus pro všechna pole, žádné zapomenuté `touched` u budoucích polí. Pozor na interakci se `SPLIT_SHARED_FIELDS` propagací (sourozenci) a s flipem rezervace (flip payload záměrně posílá vše — zachovat).

**Akceptace:** editace popisu u bloku, kterému mezitím jiná session změnila chip MATERIÁL, chip nevrátí; strážný test vyjmenovává pole payloadu proti allowlistu (obdoba `revisionWiring.test.ts`).

---

## Etapa 5 — Strop chain pushe pro ZAKAZKA (P31, havárie 17. 8. 16:31) · odhad: M

**Stav:** posun jednoho bloku o slot smí dnes přes tiskovou re-expanzi odsunout desítky zakázek bez limitu a bez potvrzení (88 bloků, 17. 8. 16:31). Rigidní bloky strop mají (`MAX_RIGID_PUSH_MS` = 7 dní), zakázky ne. Backlog č. 1 kaskádového specu.

**Náčrt (spec před implementací):** v `resolveChainPushFromDb`/`chainPushGeometry` (`src/lib/overlapResolver.server.ts`) zavést práh — např. počet odsunutých bloků > N nebo součet posunů > X h → 409 s výčtem dotčených zakázek a klientský potvrzovací dialog („Tento přesun odsune 23 zakázek, poslední až na 17. 9. Provést?"). Musí platit na všech zápisových cestách s `resolveChain` (PUT, batch), ne jen na dragu. Souvisí s pravidlem „minimum automatiky bez vědomí plánovače".

**Akceptace:** reprodukce scénáře 16:31 (posun bloku, jehož 30 minut přeteče přes noční pauzu) skončí dialogem s počtem dotčených bloků, ne tichou kaskádou.

---

## Čekárna (není co stavět, dokud nepřijde vstup)

| Bod | Čeká na |
|---|---|
| Odlišení dnů a směn (3. 8. bod 5) | osobní dovysvětlení od Lukáše (sám nabízí) — pásy směn a denní oddělovače existují od 7/2026, zjevně nestačí |
| Odstávky ve frontě Monitoru | odpověď Lukáše: myslel kalendářní odstávky? (typ bloku ODSTÁVKA neexistuje; kdyby ano → nová etapa: syntetické řádky fronty z `CompanyDay`/`MachineWeekShifts`) |
| Velikost písma Monitoru | zpětná vazba tiskařů po instruktáži o přepínači M/L/XL (default se záměrně neměnil); kdyby XL nestačilo → zvednout `PLANNER_FONT_SCALES.XL` nebo přidat stupeň |

## Otevřená rozhodnutí (blokují etapy)

1. **V1 → etapa 2:** povolit PLANOVAT celé `/reporty`? (doporučení: ano)
2. **V2 → etapa 1:** ČÁSTEČNĚ VYDÁNO přes admin + seedy? (doporučení: obojí; nejdřív ověřit prod číselník)
3. **V3 → pořadí etap 3/4/5:** doporučené pořadí je 3 (viditelná bolest plánovače) → 5 (zábrana další havárie) → 4 (tichý dluh) — ale 4 a 5 se dotýkají stejných míst jako případný budoucí vývoj rezervací, lze přehodnotit.

---

*Vzniklo nočním auditem 17.→18. 8. 2026; důkazová část v `docs/audits/2026-08-18-audit-vlakna-planovace-lukas.md`.*
