# Audit e-mailového vlákna s plánovačem (3. 8. – 17. 8. 2026)

**Datum auditu:** noc 17.→18. 8. 2026
**Auditovaný stav:** branch `Vojta`, HEAD `15aa8b5a` · produkce = `115a815d` (branch `michal`, nasazeno 17. 8. 14:19) · test (3021) = `34c0b01d`
**Metoda:** 5 nezávislých auditorských subagentů po skupinách připomínek + 2 verifikační subagenty na sporné nálezy. Každý verdikt je doložen čtením kódu (soubor:řádek) a commitem v gitu — nic není z paměti. Zařazení „nasazeno na test/produkci" je ověřeno přes `git merge-base --is-ancestor` proti `34c0b01d` (test) a `115a815d` (produkce).

---

## 1. Souhrnná tabulka

Legenda: ✅ hotovo · ⚠️ částečně · ❌ neimplementováno · ⏸ vědomě odloženo (čeká na vstup)
Nasazení: **P** = na produkci, **T** = na testu, **L** = jen lokálně (nenasazeno, nepushnuto)

| # | Připomínka | Verdikt | Klíčový commit | Nasazení |
|---|---|---|---|---|
| **E-mail 3. 8.** | | | | |
| 1 | Zvýraznění pole Specifikace | ✅ | `fd82eab5` (4. 8.) | P+T |
| 2 | OBÁLKA/VNITŘKY u rezervací | ✅ | `be770f67` (4. 8.) | P+T |
| 3 | Default délka tisku 1 h | ✅ | `0bd314ea` (4. 8.) | P+T |
| 4 | Flip rezervace→zakázka: default „Bez technologie" | ✅ | `0bd314ea` (4. 8.) | P+T |
| 5 | Odlišení dnů a směn | ⏸ čeká na Lukáše | — | — |
| 6 | OBÁLKA/VNITŘKY vzájemně výlučné | ✅ | `c645b483` (4. 8.) | P+T |
| 7 | Překlopení celé rezervace (všech bloků) najednou | ✅ | `3fc61fd2` (4. 8.) + `dc1a7d7a` (6. 8.) | P+T |
| 8 | Undo vrátí i řetězově odsunuté zakázky | ✅ | `3fc61fd2` (4. 8.) + `60582974` (5. 8.) | P+T |
| 9 | Termínová kolize DATA/MATERIÁL/PANTONE od 14:00 | ✅ | `0bd314ea` + `e5ff405b` (4. 8.) | P+T |
| **E-mail 12. 8.** | | | | |
| 0 | Zvětšit i časy a datum (Novohrad nevidí) | ✅ přes M/L/XL | `bcfa84e5` (17. 8.) | P+T |
| 1 | Skupinový přesun zakázek přes noc | ❌ | — | — |
| 2 | Fronta ukáže i dny staré nevytištěné zakázky | ✅ (14 dní) | `d027e0ca` (13. 8.) | P+T |
| 3 | Červené odlišení zpožděných nevytištěných | ✅ | `9db05e75` (13. 8.) → `9712702a` (17. 8.) | P (finále na T chybí) |
| 4 | Zrušení hledání kliknutím do plánu | ✅ | `6b61756f`+`da72ff0a`+`38ec7a96` (13. 8.) | P+T |
| 5 | DTP: hledání podle čísla zakázky v Přehledu | ✅ | `9db05e75` (13. 8.) | P+T |
| 6 | Stav materiálu ČÁSTEČNĚ VYDÁNO | ❌ v repu (ověřit prod číselník) | — | — |
| **E-mail 13. 8.** | | | | |
| a | Všechny nedodělané zakázky viditelné bez hledání | ✅ | `d027e0ca` + `66861d17` (13. 8.) | P+T |
| b | Velká karta drží zakázku do HOTOVO | ✅ | `f9d70267` (13. 8.) + `9712702a` (17. 8.) | P (finále na T chybí) |
| c | Hover okno nepřekrývá důležité informace | ✅ (2. iterace) | `115a815d` (17. 8.) | P (na T chybí) |
| **E-mail 17. 8. 10:00** | | | | |
| A | Přístup Lukáše do reportů (vytížení, posuny) | ❌ (dnes jen ADMIN) | — | — |
| B | Incident: prodloužení při úpravě TA + nefunkční undo | ✅ opraveno | `a203e716`+`81c17ed7`+`fe197c0c`+`a112779a` (17. 8.) | P+T |
| C | Falešná hláška „Zkrácení směny" | ✅ v kódu, ❌ nasazení | `9c67d752`…`3de43525` (17. 8. večer, 13 commitů) | **L** |
| **E-mail 17. 8. 10:27** | | | | |
| I | Neproduktivní operace (údržby…) ve frontě Monitoru | ⚠️ (ÚDRŽBA ano, kalendářní odstávky ne) | `bcfa84e5` (17. 8.) | P+T |
| II | Tiskaři vidí min. 5 dní historie | ✅ | `bcfa84e5` (17. 8.) | P+T |
| III | Větší písmo zakázek ve frontě | ✅ přes M/L/XL | `bcfa84e5` (17. 8.) | P+T |

**Bilance: 19× hotovo · 2× částečně/s výhradou nasazení · 3× neimplementováno (přesun přes noc, ČÁSTEČNĚ VYDÁNO, reporty) · 1× vědomě odloženo (dny/směny).**

Poznámka k Lukášovu „Body 1, 4, 6 jsem ve změnách nezaznamenal" (13. 8. 11:53): bod 4 (rušení hledání) byl implementován až týž den odpoledne (13:04–15:18), takže ho dopoledne vidět nemohl; body 1 a 6 nejsou implementované dodnes — jeho pozorování bylo přesné.

---

## 2. Detailní nálezy s důkazy

### E-mail 3. 8. (9 bodů)

**Bod 1 — zvýraznění Specifikace.** `src/components/planner/SpecBand.tsx` (amber pás, `SPEC_HIGHLIGHT` v `src/lib/blockStyles.ts:144`), render `BlockCard.tsx:1269`. Tři podoby podle výšky karty (pás / chip „S" / svislý proužek), hover tooltip specifikaci vypisuje. U tiskaře pás ustupuje tlačítku HOTOVO (`tiskarBlockView.ts`, `specBandFits`). Známá zdokumentovaná výjimka: u víceřádkového popisu na vysoké kartě se pás může oříznout. V panelu `BlockDetail` je specifikace nezvýrazněná — připomínka ale mířila na kartu v plánu.

**Bod 2 — OBÁLKA/VNITŘKY u rezervací.** Opraveno na 3 místech: rezervační modul (`src/app/rezervace/_components/PlanningForm.tsx:85–86, 392–394`), builder (`JobBuilderPanel.tsx:461–470` — rezervace ano, jen údržba a opakovaná série ne) a přenos rezervace do fronty (`useJobBuilder.ts`, `reservationToQueueItem`). Verifikováno navíc: **flip rezervace→zakázka štítky zachovává** — kotva je posílá v payloadu (`BlockEdit.tsx:699–702`), sourozencům se nepřepisují (PUT zapisuje štítky jen jsou-li v payloadu, `api/blocks/[id]/route.ts:468–471`; `SPLIT_SHARED_FIELDS` je záměrně neobsahuje).

**Bod 3 — default 1 h.** `DEFAULT_DURATION_HOURS = 1` (`plannerTypes.ts:47`), výchozí stav i reset formuláře po přidání (`useJobBuilder.ts:177, 383` — komentář cituje přesně reklamovaný symptom „každý další záznam zdědil délku naposledy přidaného").

**Bod 4 — flip → „Bez technologie".** `RESERVATION_FLIP_VARIANT = "BEZ_TECHNOLOGIE"` (`src/lib/blockVariants.ts:17`), vynuceno v `buildFlipPayload()` (`BlockEdit.tsx:727–731`). Terminologická poznámka: „KLASICKÁ"/„BEZ TECHNOLOGIE" jsou labely **blockVariant** (sekce „Stav zakázky"), ne `JobPreset` — tyto stringy v systému jinde neexistují, výklad je téměř jistě správný (potvrzuje commit reagující den po e-mailu). `JobPreset` se při flipu nenastavuje žádný.

**Bod 5 — odlišení dnů a směn: ODLOŽENO.** V kódu existují už od 7/2026 (tedy PŘED připomínkou): směnové pásy podle skutečného provozu (`TimelineGrid.tsx:1919–1941`, `.tl-afternoon`/`.tl-night` v `globals.css:341–348`), 1px denní oddělovače (`:2013–2019`), barevný sloupec data (dnes/svátek/víkend). Formulace „viz předchozí prosby" naznačuje, že tohle Lukášovi nestačí. Plán ze 4. 8. bod výslovně vede jako „odloženo — čeká na Lukáše" (`docs/superpowers/plans/2026-08-04-pripominky-planovace.md:29`), Lukáš sám nabízí „kdyžtak dovysvětlím osobně". Žádný commit po 4. 8. na tento bod necílí.

**Bod 6 — exkluzivita OBÁLKA/VNITŘKY.** `toggleProductionVariant` (`src/lib/productionTags.ts:83–95`) — kliknutí na jednu variantu vypne druhou (radio-like, jedno kliknutí), sdíleno všemi třemi konzumenty přes `ProductionTagsRow.tsx:28–35`.

**Bod 7 — překlopení celé rezervace.** `findReservationSiblings` (`src/lib/reservationSiblings.ts`) páruje přes `orderNumber` NEBO `reservationId`; dialog v `BlockEdit.tsx:1527+` nabízí „jen tento blok / celá rezervace" a rozlišuje povinné (split skupina) a volitelné (kopie na druhém stroji) sourozence; provedení `handleFlipReservation` (`PlannerPage.tsx:1281+`) — jeden společný undo krok. Verifikováno: server při dropu rezervace z fronty **vynucuje** `orderNumber = kód rezervace` (`api/blocks/route.ts:163, 275`). Známá omezení párování (nejde o vady, ale o hranice): ručně založený blok typu REZERVACE bez kódu, ruční přepnutí typu existujícího bloku, přejmenování `orderNumber` rezervačního bloku.

**Bod 8 — undo řetězově odsunutých.** Celý řetěz doložen: server vrací odsunuté bloky (`shifted`, `api/blocks/[id]/route.ts:576–658`) → klient je snapshotuje (`PlannerPage.tsx:1210–1263`) → `buildMoveOrResizeCommand` (`src/lib/undo/commands.ts:91–117`) je přidá do jedné atomické dávky `POST /api/blocks/undo`. Týž vzor u multi-edit, create i paste. Souvislost s incidentem 14. 8.: undo tehdy padalo na produkčním `AuditLog.field varchar(64)` — opraveno migrací `20260817120000` (viz bod B níže), takže „nešlo to vzít zpět" z Lukášova e-mailu bylo selhání této (jinak implementované) funkce na DB odchylce, ne chybějící funkce.

**Bod 9 — deadline 14:00.** `DEADLINE_HOUR = 14` (`src/lib/deadlineState.ts:16`), `danger` až od 14:00 pražského času, `warning` v den termínu; konzumenti přesně chipy DATA/MATERIÁL/PANTONE (`BlockCard.tsx:404–414`) + expedice (`e5ff405b`). Pokryto testy (`deadlineState.test.ts`).

### E-mail 12. 8. (7 bodů)

**Bod 0 — větší časy a datum.** Vyřešeno až 17. 8. škálou M/L/XL (`monitorTypography.ts` — `headClock`, `heroTimingRow/Label`, `queueTime*`; přepínač `FontScaleSwitch` přímo v hlavičce Monitoru, `MonitorView.tsx:306`). **Základní velikost (M) se nezměnila** — zvětšení nastane až přepnutím na L/XL (max +35 %). Zda to Novohradovi stačí, kód nedoloží → ověřit u tiskařů.

**Bod 1 — skupinový přesun přes noc: NEIMPLEMENTOVÁNO.** Žádný commit po 12. 8. se této cesty nedotkl (batch route naposledy 8. 8., `snapGroupDeltaStartOnly` naposledy 14. 7.); bod není ani v žádném specu/backlogu. Analýza kořenové příčiny (verifikační subagent, detail v plánu úprav):
- Kořen: skupina se posouvá o **jedinou společnou deltu** a snap (`snapGroupDeltaStartOnly`, `printTimeClient.ts:71–101`) je „rohatka", která umí korigovat jen dopředu.
- **Scénář B = hlavní symptom „nefunguje":** tažení skupiny ZPĚT přes hranici směny rohatka vždy sežere na `delta = 0` → tichý no-op s HTTP 200, na obrazovce se nic nestane, jen zavádějící červený toast.
- Scénář A: tažení dopředu, kdy jeden blok spadne do noci → **teleport celé skupiny o den** (sdílená delta neumí nechat část skupiny na místě).
- Scénář C: klient kontroluje jen starty, server end přepočítá expanzí přes noční pauzu → falešný 409 „bloky se překrývají", ačkoli na obrazovce se nepřekrývaly.
- Scénář D: nekonvergence 5pokusové smyčky → 422 „Začátek bloku leží mimo provoz" bez určení kterého bloku; dávka spadne atomicky celá.
- Náčrt opravy: per-blok snap se zachováním pořadí místo společné delty (server beze změny — batch route už per-blok starty přijímá), odhad **M**. Detaily a rizika v plánu úprav (etapa 3).

**Bod 2 — staré nevytištěné ve frontě.** `UNFINISHED_LOOKBACK_DAYS = 14` (`monitorView.ts:38`) — scénář pátek→středa přes 2 svátky (5 dní) je hluboko v okně. Sekce NEDODĚLÁNO bez stropu počtu položek, řádek nese i den+datum („pá 9. 8. 22:00").

**Bod 3 — červené zpožděné.** `isOverdueUnacknowledged` (`src/lib/overdueState.ts:28–40`): červená právě když nikdo neodklepl a `now > endTime`. Dvě etapy: 13. 8. dvoustupňová verze (alarm ≤16 h / stale), 17. 8. (`9712702a`) dvoustupňovost zrušena — **vždy rudé** (rozhodnutí Vojty). Finální verze je na produkci, **na testu chybí**.

**Bod 4 — rušení hledání klikem.** `clearSearch()` (`PlannerPage.tsx:1065`) volané z křížku, Esc i kliknutí kamkoliv do mřížky (`onPlanClick`, `TimelineGrid.tsx:1630`) s pojistkou proti syntetickému kliku po drag/resize/lasu (`gestureEndedAtRef`, 150 ms). Třídílná sekvence 13. 8. — dopoledne (v době Lukášova e-mailu) ještě nebyla.

**Bod 5 — DTP hledání v Přehledu.** `selectDtpOverviewBlocks` (`src/lib/dtpOverview.ts:61–102`): s dotazem se 30denní okno zahazuje, hledá se napříč vším přes sdílený `blockMatchesQuery` (pokrývá orderNumber), výsledky mimo přehled dostávají štítek „mimo přehled". UI `DtpPanel.tsx` (SearchField + hlášky nenalezení).

**Bod 6 — ČÁSTEČNĚ VYDÁNO: NEIMPLEMENTOVÁNO v repu.** Grep celého repa: 0 výskytů; seedy `MATERIAL_OPTIONS` (`prisma/seed.ts:24–35`, `prisma/bootstrap-prod.ts:29–40`) hodnotu nemají; žádný commit ji nikdy nepřidal. **Důležité:** číselník `CodebookOption` je za běhu editovatelný v adminu (role ADMIN/PLANOVAT) — hodnotu lze na produkci přidat bez kódu a repo by o tom nevědělo → před akcí ověřit produkční číselník (`SELECT label FROM CodebookOption WHERE category='MATERIAL'`). Terminologie: „skladníci" v aplikaci neexistují jako role — stav materiálu edituje MTZ.

### E-mail 13. 8.

**a — nedodělané viditelné bez hledání.** Sekce NEDODĚLÁNO (`monitorQueue`, `monitorView.ts:141–184`; render `MonitorQueue.tsx:47–60`, kompaktní řádky, sekce nahoře). Záměrné výjimky: starší 14 dní, `POZASTAVENO` (výrobní stopka), zakázky se startem dnes/zítra (jsou v sekcích DNES/ZÍTRA). Doplňující oprava `66861d17` zavřela díru, kvůli které nebyla noční směna dohledatelná nikde.

**b — karta drží do HOTOVO.** `pickHeroBlock` (`monitorView.ts:80–110`): priorita `overdue` PŘED `running`, žádné časové okno — karta drží zakázku, dokud tiskař nedá HOTOVO nebo „Přeskočit →". Komentář v kódu cituje přesně tuto připomínku (13. 8.). Jediné meze: 14denní podlaha a `POZASTAVENO`.

**c — hover okno.** Dvě iterace: první pokus 13. 8. (`66861d17`, zarovnání k vnější straně mřížky) byl vadný — vlevo od XL 105 je jen 116 px na 250px prvek (poučení P28). Finální řešení 17. 8. (`115a815d`): `hoverTooltipLeft` (`src/lib/plannerHoverTooltip.ts`) zarovnává bublinu pravou hranou ke sloupci vlastního stroje — nezakryje sousední stroj ani chipy D/M/E/P na levé hraně karty. Na produkci ano, **na testu chybí**. Přiznaný okraj: sloupec užší než ~260 px (tři otevřené panely na malé obrazovce) → bublina přeteče, drží se jen „neopustí obrazovku".

### E-mail 17. 8. 10:00

**A — přístup do reportů: NEIMPLEMENTOVÁNO (vyžaduje rozhodnutí).** Sekce existuje — `/reporty`: vytížení XL 105/106 (`RetroView.tsx:64–73`, `computeUtilization`), počty zásahů a posunutých bloků + stabilita plánu z `BlockRevision` (`PlanningSection.tsx:70–92`). Přístup je **výhradně ADMIN**, vynucený na 6 nezávislých místech: `middleware.ts:60–71` (stránka + dashboard API), `reporty/page.tsx:8`, `api/report/dashboard/route.ts:25` (`ALLOWED_ROLES`), `api/report/attention` + `api/report/health` (`requireRole(["ADMIN"])`), tlačítko „Reporty" v hlavičce (`PlannerPage.tsx:3094–3105`). Žádný centrální seznam rolí neexistuje — povolení = koordinovaná změna všech šesti. Lukášova role: účet `l.lukes` ukládá směny (vyžaduje ADMIN/PLANOVAT) a na reporty se ptá → téměř jistě **PLANOVAT** (ověřit v prod DB `User`). Pro rozhodnutí: reporty už neobsahují jmenovitý žebříček uživatelů (odstraněn `f3332283`, 16. 8.) — citlivost dat je nižší.

**B — incident „prodloužení + nefunkční undo": OPRAVENO (nasazeno na produkci 17. 8.).** Dvě kořenové příčiny, obě zavřené:
1. Zastaralá délka z otevřeného panelu: `81c17ed7` (délka se posílá jen když se jí uložení týká — `blockEditDuration.ts` + touched-tracking), `fe197c0c` (efekt nereaguje na lokální přepnutí typu), `a112779a` (server: PUT přepočítá harmonogram jen při SKUTEČNÉ změně — `shouldRecomputeSchedule`).
2. Pád undo: migrace `20260817120000_widen_audit_and_order_columns` (`a203e716`) — `AuditLog.field`/`username`, `Block.orderNumber` na varchar(191).
**Třída chyby ale uzavřená NENÍ** (P26/P27 v `docs/POUCENI.md`): touched-tracking dostala jen tisková délka; `buildPayload()` posílá ~30 dalších polí ze stavu při otevření panelu. Riziko dnes omezené (žádné z těch polí nespouští chain push; maximum škody je tiché vrácení chipu/termínu na starou hodnotu) — ale je to výslovně vedený otevřený dluh → plán, etapa 4.

**C — falešná hláška „Zkrácení směny": OPRAVENO V KÓDU, NENASAZENO.** Kořenové příčiny (forenzně prokázané nad produkčními daty, `docs/audits/2026-08-17-falesna-kaskada-zkraceni-smeny.md`):
- Kontrola volala validátor z dubna 2026, který neuměl **tiskové pauzy uvnitř bloku** — každá zakázka přetékající přes 22:00 měla ve dvousměnném provozu 8h pauzu → falešný „KONFLIKT" (na produkci 15 takových zakázek).
- Kontrola byla **absolutní, ne diferenční** — přidání sobotní směny nemůže staré „porušení" odstranit, dialog vyskočil při každém uložení téhož týdne; titulek „Zkrácení směny" byl konstanta.
Oprava (13 commitů `9c67d752`…`3de43525` + runbook `15aa8b5a`, 17. 8. 18:20–21:40): diferenční měřená kontrola — `detectCalendarDrift` dvakrát v jedné transakci (před/po zápisu směn), rozdíl klasifikuje `classifyCascade` (`src/lib/cascadeCheck.ts`): nově-bezdomovec blokuje (409 + rollback), pouhé prodloužení konce jen informuje; pravdivý dialog s labelem stroje a sloupcem „Proč nesedí"; force jen za stroj z dialogu; starý vadný `findConflictingBlocks.ts` smazán. Testy: 1314/1314 zelených, `tsc --noEmit` čistý.
**Stav nasazení: pouze lokálně — ani pushnuto na origin** (Mac byl 17. 8. večer mimo firemní síť; ověřeno `git status`: ahead 14). Runbook `docs/DEPLOY_2026-08-17_KASKADA.md` je připraven k provedení 18. 8.: push → test (3021) → proklik 6.1–6.5 → produkce. Nejvyšší riziko prokliku: údržba + vypnutá sobota (nová kontrola měří jen ZAKAZKA — vědomé zúžení, regrese proti staré kontrole, která údržbu hlásila aspoň falešně).
**Pozor — nezaměňovat s havárií 17. 8. 16:31** (posun bloku 1335 → konec skočil o 6,5 h přes noční pauzu → chain push 87–88 bloků): spec dokazuje, že s falešnou hláškou kauzálně nesouvisí. Chain push zakázky **nemá strop posunu** (P31) — to tahle vlna vědomě nezavírá → plán, etapa 5.

### E-mail 17. 8. 10:27

**I — neproduktivní operace ve frontě: ČÁSTEČNĚ.** Bloky ÚDRŽBA ve frontě DNES/ZÍTRA jsou (`monitorView.ts:153`, neklikatelný řádek „🔧 Údržba", `MaintenanceRow`); do sekce NEDODĚLÁNO záměrně nikdy nevstupují (neodklepávají se, uvázly by tam 14 dní). **Typ bloku ODSTÁVKA neexistuje** — celozávodní/strojové odstávky jsou kalendářní entity (`CompanyDay`/`MachineWeekShifts`) a ve frontě se jako řádek nezobrazí (do Monitoru vstupují jen jako drift značka). Zda Lukáš „odstávkami" myslel servis-jako-blok (pokryto), nebo kalendářní odstávky (nepokryto), z kódu rozhodnout nelze → otázka na Lukáše.

**II — 5 dní historie.** `TISKAR_DAYS_BACK = 5` (`src/lib/tiskarViewRange.ts:16`, komentář „Zvednuto z 1 na 5 (17. 8. 2026, prosba tiskařů)"), vynucené přepsání uložené preference (`viewDaysBack`, zapojeno `PlannerPage.tsx:934`).

**III — větší písmo fronty.** `monitorTypeScale` (`monitorTypography.ts`) — všechny velikosti fronty přes sdílenou škálu M/L/XL, přepínač přímo na Monitoru, klíč localStorage sdílený s plánem. **Default (M) beze změny** — hlídá strážný test („zavedení škály nikomu nepřemalovalo výchozí vzhled"); zvětšení = přepnout na L/XL. Tlačítka velké karty mají záměrně pevnou výšku (dotykové cíle).

**Poznámka k A18822** (Lukáš smazal páteční půlku a protáhl dnešní): od 8/2026 vede aplikace `BlockRevision` — černou skříňku všech změn bloků s retencí 90 dní, která přežije i smazání bloku. Historii lze rekonstruovat bez zálohy; navíc existuje (zatím jen lokálně) zobecněný nástroj `scripts/revert-revision-group.ts` na vracení celých revizních skupin.

---

## 3. Stav nasazení — co kde chybí

| Prostředí | Stav | Co chybí |
|---|---|---|
| **Produkce** (3020, `michal` = `115a815d`) | vše z vlákna kromě ❌ bodů | kaskádová vlna (falešná hláška), drift značka Monitoru, revert nástroje |
| **Test** (3021, `34c0b01d`) | pozadu za produkcí | `9712702a` (vždy-červená), `115a815d` (hover bublina) + vše co produkce |
| **origin/Vojta** | `4590c612` | posledních 14 commitů (kaskádová vlna) — **nepushnuto** |

Jediný krok „push + deploy dle runbooku `docs/DEPLOY_2026-08-17_KASKADA.md`" srovná test nad produkci a přinese opravu falešné hlášky — přesně to, co Lukáš potřebuje otestovat.

---

## 4. Otevřené otázky

**Na Vojtu (rozhodnutí):**
1. **Reporty pro PLANOVAT** — povolit roli PLANOVAT celou stránku `/reporty` (doporučení: ano; jmenovitý žebříček už tam není), nebo jen vybrané záložky? Změna = 6 míst, viz bod A.
2. **ČÁSTEČNĚ VYDÁNO** — přidat hodnotu (a) hned přes admin číselník na produkci (2 minuty, bez deploye) a (b) do seedů pro dev/test paritu? Doporučuji obojí. Předtím ověřit, jestli už na produkci není.
3. **Priorita opravy skupinového přesunu přes noc** (etapa 3 plánu) vs. uzavření třídy P27 (etapa 4).

**Na Lukáše (do e-mailu):**
4. **Odstávky v Monitoru** — myslel i celozávodní/strojové odstávky z kalendáře (dnes se nekreslí), nebo jen servisní bloky ÚDRŽBA (hotovo)?
5. **Dny/směny (bod 5 z 3. 8.)** — domluvit slíbené osobní dovysvětlení; pásy směn a denní oddělovače existují, zjevně nestačí.
6. **Písmo na Monitoru** — instruovat tiskaře o přepínači M/L/XL v hlavičce (výchozí velikost se nezměnila); ověřit, že XL stačí Novohradovi.

**Provozní ověření (nejde z repa):**
7. Role účtu `l.lukes` v produkční tabulce `User` (předpoklad PLANOVAT).
8. Obsah produkčního číselníku MATERIAL (jestli tam ČÁSTEČNĚ VYDÁNO někdo nepřidal ručně).

---

## 5. Příloha — koncept odpovědi Lukášovi

*(K Vojtově revizi — nic neodesláno. Předpokládá, že ranní deploy na test proběhne; jinak upravit odstavec o testu.)*

> Lukáši,
>
> díky za zpětnou vazbu — a hlavně za zprávu, že se Vám v plánu při té zátěži s oběma rozbitými stroji pracovalo dobře. Prošel jsem celé naše vlákno a tady je stav všech Vašich připomínek:
>
> **Tři prosby k Monitoru — hotové a nasazené:**
> 1. Údržby a opravy jsou ve frontě DNES/ZÍTRA (řádek „🔧 Údržba"). Pozor — celozávodní odstávky z kalendáře směn se ve frontě nezobrazují, protože nejsou „operace", ale vlastnost kalendáře. Pokud jste myslel i je, dejte vědět, jak by si je tiskaři představovali.
> 2. Tiskaři vidí 5 dní do historie.
> 3. Písmo se zvětšuje přepínačem **M / L / XL** přímo v hlavičce Monitoru — výchozí velikost jsme neměnili, ať si každý stroj nastaví svou. Prosím ukažte tiskařům (a panu Novohradovi) přepínač; kdyby ani XL nestačilo, řešení najdeme.
>
> **Chybová hláška „Zkrácení směny" při přidávání sobotních směn:** našli jsme příčinu — kontrola směn byla z dubna a neuměla novější „tiskové hodiny" (zakázka obtékající noc pro ni vypadala jako konflikt), a navíc hlásila pořád dokola i to, co jste nezpůsobil. Přepsali jsme ji celou: nově porovnává stav před a po Vaší změně a hlásí jen to, co skutečně způsobila vaše úprava, s konkrétním důvodem u každé zakázky. Nasazujeme na testovací stránku — budu rád, když to při nejbližší úpravě směn vyzkoušíte.
>
> **Páteční zakázka A18822:** to byla naše chyba, ne Vaše — úprava v otevřeném okně zakázky poslala na server zastaralou délku tisku, zakázka se protáhla a odsunula ostatní; a krok zpět tehdy spadl na technické odchylce produkční databáze. Obojí je od 17. 8. opravené (proto už se Vám to od pondělního odpoledne nemělo stát). Historii zakázky umíme od srpna rekonstruovat i bez zálohy — aplikace si 90 dní vede záznam každé změny, takže kdyby se něco podobného opakovalo, dohledáme to.
>
> **Přístup do sekce s naplněností strojů a počty posunů:** připravujeme — ozvu se, jakmile bude aktivní.
>
> **Skupinový přesun zakázek přes noc:** potvrzuji, je to chyba (přesun skupiny „couváním" přes hranici směny se tiše zahodí). Máme zmapovanou příčinu a oprava je naplánovaná jako samostatná etapa.
>
> **Odlišení dnů a směn:** tady bych využil Vaši nabídku dovysvětlit osobně — pásy směn a oddělovače dnů v plánu jsou, ale zjevně ne tak, jak potřebujete. Zastavím se / zavolejme si.
>
> Díky,
> V.

---

*Vypracováno autonomním nočním auditem (Claude, 5 auditorských + 2 verifikační subagenti). Navazující dokument: `docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md`.*
