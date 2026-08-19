# Plán úprav z e-mailového vlákna s plánovačem — etapy

> **Charakter dokumentu:** roadmap etap vzešlý z nočního auditu
> `docs/audits/2026-08-18-audit-vlakna-planovace-lukas.md` (tam jsou důkazy a čísla commitů).
> **Rozšířeno 19. 8. o druhou vlnu připomínek** — audit `docs/audits/2026-08-19-audit-pripominky-planovace-druha-vlna.md`
> (etapy 6–9, sloučení etapy 5 do 6, Task 6b v etapě 1).
> Etapy 3–4 a 6–9 dostanou před implementací vlastní detailní plán (spec → plan dle
> `docs/superpowers/`), protože závisí na rozhodnutích v sekci „Otevřená rozhodnutí".
> Pořadí etap = doporučená priorita. Etapa 1 už detailní plán má:
> `docs/superpowers/plans/2026-08-19-material-castecne-vydano.md`.

**Cíl:** dotáhnout 3 neimplementované připomínky (+1 odloženou), nasadit hotovou, ale nenasazenou opravu falešné hlášky, a zavřít dva vědomě otevřené dluhy, které vlákno obnažilo (P27, P31).

---

## Etapa 0 — Nasazení rozpracovaných vln · **aktualizováno 19. 8.**

**Stav:** kaskádová kontrola směn (falešná hláška „Zkrácení směny") byla **18. 8. nasazena na test `91546a3d` a prokliknuta** — zbývá Lukášovo potvrzení a produkce. Mezitím ale vznikla **autoposunová vlna** (počty v toastech, Ctrl+Z přepočtu, potvrzení velkého autoposunu — zatím v režimu měření, viz etapa 6) a undo rozdělení; ta je jen na branchi `Vojta` (origin je o 3 commity pozadu). **Lukášův incident z 18. 8. („nevědomky posunul desítky zakázek") proběhl na produkci, která z těchto vln nemá nic** — nasazení je tedy nejúčinnější jednotlivý krok proti opakování.

**Postup:**
1. `git push origin Vojta` (firemní síť).
2. Deploy autoposunové vlny na test 3021 → proklik (dialog „Velký autoposun" se v režimu měření neukáže — proklik ověřuje toasty s počty a Ctrl+Z).
3. Po Lukášově potvrzení kaskádové kontroly směn na testu → **produkce** (dle `docs/DEPLOY_WORKFLOW.md`, mysqldump záloha, PRE/POST otisk): kaskádová kontrola + autoposunová vlna v jedné dávce.

**Akceptace:** na testu přidání sobotní směny nevyhodí dialog; přesun s kaskádou ukáže toast s počtem odsunutých a Ctrl+Z je vrátí.

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

**Rozšířeno 19. 8. (druhá vlna, bod 3): + Task 6b — textové štítky stavu materiálu a pantone na Monitoru.** `buildMonitorChips` (`src/lib/monitorChips.ts`) dnes stav vydání neukazuje textově vůbec (flagy jen barví podklad chipu druhu materiálu; při nevyplněném druhu není vidět nic; pantone má jen pevné slovo s tónem). Doplnit chipy `MAT. VYDÁNO ➜ / SKLADEM ✓ / ČEKÁ` a `PANTONE VYDÁNO / SKLADEM / ČEKÁ` — od začátku včetně `MAT. ČÁST. ½`. Stejný soubor jako Task 6 detailního plánu → dělá se v téže etapě, jedním dotykem. Typografie přes `ts.chipHero/chipQueue`; NEDODĚLÁNO zůstává bez chipů (záměr); ověřit ořez hero karty na XL.

**Akceptace:** MTZ označí materiál jako částečně vydaný jedním gestem; karta ukazuje „M ČÁST."; stav se propaguje na split sourozence, přežije undo a je vidět v historii bloku; tiskař na Monitoru čte textově „na co má vydáno" (materiál i pantone).

---

## Etapa 2 — Reporty pro roli PLANOVAT · **ROZHODNUTO 19. 8. (V1, Vojta): ODLOŽENO — reporty zatím zůstávají jen pro ADMIN**

Etapa se teď nestavi; podklad níže zůstává pro případné budoucí otevření (6 vynucovacích míst + doporučení konstanty `REPORT_ROLES`). Lukášovi se do e-mailu odpoví, že přístup zvažujeme.

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

## Etapa 5 — ~~Strop chain pushe pro ZAKAZKA~~ · **19. 8.: POKRYTO autoposunovou vlnou → sloučeno do etapy 6**

Přesně tohle mezitím postavila autoposunová vlna (plán `2026-08-18-autoposun-viditelny-a-vratny.md`, etapy A/B/C/S): práh `CASCADE_CONFIRM_MAX_BLOCKS = 5` NEBO posun jednoho bloku > 7 dní, dialog „Velký autoposun" na všech 6 zápisových cestách, Ctrl+Z vratnost. Zbývající práce viz etapa 6.

---

## Etapa 6 — Dokončení autoposunové vlny (druhá vlna, bod 1) · odhad: S–M · čeká na rozhodnutí V4

**Stav:** potvrzovací dialog je napsaný, ale `CASCADE_CONFIRM_ENFORCED = false` — běží tichý režim měření do logu; Lukáš zatím nevidí nic. Jeho prosba: „deaktivovat, případně omezit na 3–4 bloky".

**Zbývá (dle Task B4 plánu autoposunové vlny + nové zadání):**
1. Po nasazení (etapa 0) týden měření → rozhodnout hodnotu prahu (Lukáš navrhuje 3–4; default 5).
2. Dodělat před zapnutím: once-per-gesture wrapper pro `putFlip`/`handleSaveAll`/sérii z fronty (jinak až 12 dialogů za sebou), fokus na „Zrušit", odmítnutou kaskádu nehlásit červeným toastem, strážný test párování `skipCascadeCheck`.
3. Zapnout `CASCADE_CONFIRM_ENFORCED = true` samostatným commitem.
4. **ROZHODNUTO 19. 8. (V4, Vojta): obojí — dotáhnout potvrzovací dialog A přidat vypínač autoposunu.** Náčrt vypínače (detaily ve specu etapy):
   - Přepínač „Autoposun" v hlavičce planneru (vedle zámku pracovní doby); **per-uživatel přes `savePreference`**, ne localStorage — Lukáš ho má mít na každém počítači ([[nastaveni-zarizeni-vs-uzivatel]]).
   - Vypnuto ⇒ klient posílá `resolveChain: false` na všech mutačních cestách; kolize řeší overlap guard → 409 s hláškou „Posun koliduje s navazující zakázkou — autoposun je vypnutý, uvolni místo ručně."
   - Pozor: split route dnes pouští chain push **bezpodmínečně** (`split/route.ts:191`) — vypínač musí projít i tam; server musí `resolveChain: false` respektovat na všech 6 cestách (strážný test).
   - Vypínač se týká chain pushe (odsouvání CIZÍCH bloků); snap vlastního taženého bloku mimo pracovní dobu zůstává (to je zámek pracovní doby, jiná funkce).
   - Potvrzovací dialog zůstává aktivní pro stav „zapnuto" — obě pojistky se doplňují.

**Akceptace:** posun s kaskádou > práh se bez výslovného potvrzení neprovede; Lukáš potvrdí, že se „nevědomky posunuté desítky zakázek" už nemohou opakovat.

---

## Etapa 7 — Vyjmout/Odstranit v menu + fokusová past + QWERTZ (druhá vlna, bod 2) · odhad: S–M

**Tři opravy v jedné etapě (audit druhé vlny §2):**
1. **Kontextové menu:** položky „✂ Vyjmout" a „🗑 Odstranit" do `BlockCard.tsx:1664+` — akce už existují (cut = Ctrl+X větev `PlannerPage.tsx:2849–2865`, extrahovat sdílenou funkci; delete = `handleDeleteBlock` + existující potvrzovací/force dialogy, sytit z bloku menu místo z `selectedBlock` — nový stav `menuDeletePending`). Guardy: `canEdit && !locked`, cut navíc `!printCompletedAt`.
2. **Fokusová past (kořen „zkratky nefungují"):** `handleBlockMouseDown` (`TimelineGrid.tsx:1209`) dělá `preventDefault()` → klik na blok nevytáhne fokus z hledacího pole → keydown guard zahodí všechny zkratky. Oprava: při mousedownu na blok blur aktivního INPUT/TEXTAREA/SELECT.
3. **QWERTZ regrese (ověřeno):** `shortcutLetter` (`keyboardShortcuts.ts:45–51`) preferuje `e.code` → na české QWERTZ Ctrl+Z (fyzická pozice KeyY) provede REDO místo UNDO. Oprava: pro pár Z/Y preferovat `e.key`, `e.code` nechat jako fallback; doplnit QWERTZ test.

**Akceptace:** cut/delete jdou myší z menu bez ohledu na fokus; po hledání a kliknutí na blok funguje Ctrl+X hned; Ctrl+Z na české klávesnici dělá undo.

---

## Etapa 8 — Hover bublina vertikálně (druhá vlna, bod 4) · odhad: S · **ROZHODNUTO 19. 8. (V5): varianta (a) — pod kartu**

**Geometrický fakt (audit §2, bod 4):** nezakrývat sousední stroj + chipy vlevo + vlastní blok je horizontálně nesplnitelné (volný pás mimo karty = 78 px časové osy vs. bublina 240 px). **Rozhodnutá varianta:** bublina pod kartou (`top = rect.bottom + 6`), u spodního okraje okna flip nad kartu — vzor notepopover `BlockCard.tsx:1384`; horizontálně zůstává zarovnání ke sloupci. Malá změna v `plannerHoverTooltip.ts` + `BlockCard.tsx` + testy; dát Lukášovi vyzkoušet na testu.

**Akceptace:** bublina nezakrývá hovorovanou kartu, sousední sloupec ani chipy; u spodního okraje okna se přehoupne nad kartu.

---

## Etapa 9 — Rezervace: PLNÉ tiskové hodiny (druhá vlna, bod 5) · odhad: L · **ROZHODNUTO 19. 8. (V6, Vojta): „jako u zakázky, se vším všudy"**

**Rozhodnutí:** rezervace se má lámat přes noc stejně jako zakázka — mechanika tiskových hodin se překlopí i na typ REZERVACE. Vizuální-only varianta zamítnuta. Před implementací **vlastní spec + detailní plán** (největší etapa vlny).

**Dobrá zpráva (ověřeno 19. 8.):** všechny délky rezervací jsou už dnes násobky 30 min — jediný selektor délky je `DURATION_OPTIONS` (`src/lib/plannerTypes.ts:49–54`, kroky po 30 min, sdílí builder, BlockEdit i rezervační `PlanningForm`). Mřížková podmínka tiskových hodin (`printMinutes % 30`) tedy existující data nerozbije; backfill = inverze spanu přes pauzy (`computePrintMinutes`).

**Rozsah (9 rozhodovacích míst z auditu §2 bod 5 + navazující):**
1. **Prerekvizita — dluh `Reservation.scheduled*`** ([[rezervace-chain-push-dluh]]): chain push, drift ani reflow dnes `scheduledStartTime/EndTime` nesynchronizují; s tiskovými hodinami se konec rezervace začne měnit při každé změně kalendáře → **vyřešit PŘED překlopením** (zrcadlit scheduled* při každém zápisu bloku s `reservationId`, ideálně uvnitř `withRevision` cest).
2. Migrace/backfill `printMinutes` existujících REZERVACE bloků (span − pauzy) + zápisové cesty přestat nulovat (`POST route.ts:286`, `PUT [id]/route.ts:220`).
3. `validateAndComputeEnd` — zrušit early-return pro REZERVACE (`scheduleValidationServer.ts:100`); **UDRZBA zůstává rigidní** (vznikne třetí kategorie — všude, kde je dnes dichotomie `type !== "ZAKAZKA"`, rozlišit REZERVACE vs UDRZBA).
4. Chain push: `chainPushGeometry` přepnout REZERVACE na tiskovou větev. **Rozhodnout ve specu:** ponechat rezervacím strop posunu (dnes 7 dní přes `MAX_RIGID_PUSH_MS`), nebo zdědí bezhorizontové chování zakázek? (Pojistka: potvrzovací dialog z etapy 6 kryje obě.)
5. Klientské snapy (~6 míst: PlannerPage ×3, TimelineGrid ×2, paste marker) → start-only větev i pro REZERVACE; `durationPayload` v BlockEdit; resize.
6. Kreslení: uvolnit typ v `tryExpandForBlock`/`getBlockSegments` pro REZERVACE — s revizí všech konzumentů (`blockReportSegments` — reporty R1–R4a začnou rezervace počítat jinak; ověřit dopad na vytížení).
7. Drift: `detectCalendarDrift` + klientský `blockCalendarDrift` rozšířit o REZERVACE (+ tabulkový test parity) a `classifyCascade` u editace směn přestane rezervace tiše přeskakovat (ruší se vědomé zúžení — aktualizovat CLAUDE.md).
8. Reflow („Přepočítat") povolit pro REZERVACE (`reflow.server.ts:110`).
9. Undo: klientská historie rezervační bloky dnes záměrně vynechává (`PlannerPage.tsx:1678–1680`) — rozhodnout ve specu, zda to překlopení mění.

**Akceptace:** rezervace položená přes noc se roztáhne přes pauzu s pásem „⏸ PAUZA" a drží plnou délku v pracovní době; chain push, drift, „Přepočítat" i editace směn s ní zacházejí jako se zakázkou; obchodník v `/rezervace` vidí po každém posunu aktuální termín (scheduled* synchronní).

---

## Čekárna (není co stavět, dokud nepřijde vstup)

| Bod | Čeká na |
|---|---|
| Odlišení dnů a směn (3. 8. bod 5) | osobní dovysvětlení od Lukáše (sám nabízí) — pásy směn a denní oddělovače existují od 7/2026, zjevně nestačí |
| Odstávky ve frontě Monitoru | odpověď Lukáše: myslel kalendářní odstávky? (typ bloku ODSTÁVKA neexistuje; kdyby ano → nová etapa: syntetické řádky fronty z `CompanyDay`/`MachineWeekShifts`) |
| Velikost písma Monitoru | zpětná vazba tiskařů po instruktáži o přepínači M/L/XL (default se záměrně neměnil); kdyby XL nestačilo → zvednout `PLANNER_FONT_SCALES.XL` nebo přidat stupeň |

## Otevřená rozhodnutí (blokují etapy)

1. ~~V1~~ **ROZHODNUTO 19. 8.:** reporty zatím zůstávají jen pro ADMIN — etapa 2 odložena.
2. ~~V2~~ **ROZHODNUTO 19. 8.:** ČÁSTEČNĚ VYDÁNO = varianta (a), mini tlačítko „½" (detailní plán `2026-08-19-material-castecne-vydano.md`).
3. **V3 → pořadí velkých etap:** doporučení po druhé vlně: **0 (nasazení) → 6 (dokončení autoposunu) → 1 (materiál + Monitor štítky) → 7 (menu+zkratky) → 3 (skupinový přesun) → 8/9 (po rozhodnutích) → 2 → 4**.
4. ~~V4~~ **ROZHODNUTO 19. 8.:** dotáhnout potvrzovací dialog A přidat vypínač autoposunu (obojí, viz etapa 6 bod 4).
5. ~~V5~~ **ROZHODNUTO 19. 8.:** bublina pod kartu s flipem (etapa 8).
6. ~~V6~~ **ROZHODNUTO 19. 8.:** rezervace dostanou PLNÉ tiskové hodiny „jako u zakázky, se vším všudy" (etapa 9, L, vlastní spec; prerekvizita dluh `Reservation.scheduled*`).

**Otázky na Lukáše (v konceptu e-mailu):** hodnota prahu autoposunu (~4?) · + starší: kalendářní odstávky ve frontě, dny/směny osobně. (Otázka „vidět pauzu vs. garantovaná délka" ODPADÁ — rozhodnuto V6 plné lámání; dodatek e-mailu upravit.)

---

*Vzniklo nočním auditem 17.→18. 8. 2026; rozšířeno 19. 8. o druhou vlnu (`docs/audits/2026-08-19-audit-pripominky-planovace-druha-vlna.md`).*
