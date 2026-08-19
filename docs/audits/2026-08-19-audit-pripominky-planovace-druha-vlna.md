# Audit připomínek plánovače — druhá vlna (e-mail 19. 8. 2026)

**Datum auditu:** 19. 8. 2026 (navazuje na noční audit `2026-08-18-audit-vlakna-planovace-lukas.md`)
**Auditovaný stav:** branch `Vojta`, HEAD `0aba57a1` · produkce = `115a815d` (17. 8.) · test = `91546a3d` (18. 8., diferenční kontrola směn) · `origin/Vojta` = `3dd39cc7` (3 commity pozadu za lokálem)
**Metoda:** 5 paralelních auditorských subagentů + vlastní verifikace klíčových tvrzení (QWERTZ regrese ověřena přímým čtením `keyboardShortcuts.ts`). Každý verdikt doložen souborem:řádkem a commitem.

---

## 1. Souhrn

| # | Prosba Lukáše | Verdikt | Náprava |
|---|---|---|---|
| 1 | Deaktivovat / omezit automatické posunutí (na 3–4 bloky) | **Z větší části už postavené** (autoposunová vlna vedlejší session, lokálně) — ale potvrzení je vypnuté (režim měření), práh je 5, vypínač neexistuje | dokončit B4 + rozhodnutí V4 → etapa 6 |
| 2 | Tlačítka Vyjmout a Odstranit („zkratky často nefungují") | **Tlačítka chybí; skutečný kořen selhávání zkratek nalezen** (fokusová past hledacího pole) + bonus: reálná QWERTZ regrese Ctrl+Z→redo | etapa 7 (S–M) |
| 3 | Štítky stavu materiálu a pantone na Monitoru | **Textově nikde** — flagy jen barví podklad chipu druhu materiálu; při nevyplněném druhu není vidět nic | sloučeno do etapy 1 (Task 6b) |
| 4 | Bublina nezasahovat do bloku (napravo od bloku) | **Překryv vlastní karty je vědomý trade-off ze 17. 8.**; „napravo od bloku" je ale matematicky neslučitelné s dřívější stížností tiskařů | rozhodnutí V5 → etapa 8 (S) |
| 5 | Rezervace se nelámou přes noc | **Konzistentní architektura, ne bug** (rezervace nemá tiskové hodiny — 9 rozhodovacích míst); plné lámání = L+ přestavba, vizuální lámání = S/M | rozhodnutí V6 + dotaz na Lukáše → etapa 9 |

---

## 2. Detailní nálezy

### Bod 1 — automatické posunutí (chain push)

**Co se Lukášovi stalo:** dvě různé věci spolupracovaly. Toast z jeho screenshotu („Blok přesunut mimo pracovní dobu…", `TimelineGrid.tsx:1101`) je klientský snap JEN taženého bloku. „Desítky zakázek" odsunul **chain push** — drag posílá vždy `resolveChain: true` (`TimelineGrid.tsx:1103–1108`) a **ZAKAZKA nemá na chain pushi žádný horizont** (`MAX_RIGID_PUSH_MS` 7 dní platí jen pro rezervace/údržbu, `overlapResolver.ts:39`; P31). Řádek historie „Automaticky posunuto" = audit `AUTO_SHIFT` se jménem uživatele, jehož gesto push vyvolalo. **Incident proběhl na produkci `115a815d`, která nemá vůbec nic z nové vlny.**

**Co už je postavené (autoposunová vlna, plán `2026-08-18-autoposun-viditelny-a-vratny.md`, commity `be1ee201`…`0aba57a1`, jen lokálně):**
- Etapa A: toasty s počtem odsunutých bloků. Etapa C: přepočet vratný Ctrl+Z (serverový snapshot `before`, `reflowBefore.server.ts`). Etapa S: undo rozdělení zakázky.
- Etapa B: práh `CASCADE_CONFIRM_MAX_BLOCKS = 5` NEBO posun jednoho bloku > 7 dní (`cascadeLimit.ts:12,84`) na všech 6 zápisových cestách; při překročení dialog **„Velký autoposun: Tato změna odsune N navazujících bloků, nejdál do DD. MM. Potvrdit?"** s tlačítky „Posunout i přesto"/„Zrušit"; potvrzení zopakuje požadavek s `cascadeConfirmed: true`.
- **ALE: `CASCADE_CONFIRM_ENFORCED = false`** — dnes běží jen tiché měření do logu (`cascadeLimit.server.ts:47–49`); uživatel nic nevidí. Zapnutí = samostatný commit po týdnu měření (Task B4).

**GAP vůči prosbě:** (a) práh je 5, ne 3–4 — hodnota se má rozhodnout z logů; (b) je to potvrzovací dialog, ne tvrdý limit (po potvrzení se posune cokoli); (c) **úplná deaktivace autoposunu neexistuje** — znamenala by návrat k chování před 31. 7. (drop do obsazeného místa → 409 odmítnuto) a je to nové designové rozhodnutí (V4); (d) žádná per-user/per-role konfigurace. Z Task B4 dále zbývá: once-per-gesture wrapper pro flip/handleSaveAll/sérii (jinak až 12 dialogů za sebou), fokus na „Zrušit", odmítnutou kaskádu nehlásit červeným toastem, strážný test `skipCascadeCheck`.

### Bod 2 — Vyjmout/Odstranit + proč zkratky nefungují

**Menu:** kontextové menu bloku (`BlockCard.tsx:1664–1797`) položky Vyjmout/Odstranit nemá — cut i delete jdou dnes výhradně klávesnicí. Obě akce ale **kompletně existují**: Ctrl+X (`PlannerPage.tsx:2849–2865`; vložení = PUT přesun se zachováním historie a vazeb, ř. 2505–2530) a Delete → potvrzovací dialogy včetně force-flow (ř. 2889–2953). Přidání do menu = protažení props + sdílená funkce; položky vážou akci na blok z menu, ne na výběr/fokus → **řeší Lukášův problém i bez opravy zkratek**. Odhad S–M.

**Skutečný kořen „zkratky často nefungují": fokusová past.** Keydown handler (`PlannerPage.tsx:2767–2768`) zahodí všechny zkratky, když je fokus v INPUT/TEXTAREA/SELECT. Jenže `handleBlockMouseDown` (`TimelineGrid.tsx:1209`) volá `e.preventDefault()` na mousedown — a tím **potlačí i odebrání fokusu z hledacího pole**. Typický workflow „najdi zakázku → klikni na ni → Ctrl+X" tak skončí s fokusem stále v inputu → všechny zkratky tiše mrtvé, myš funguje, aplikace „vypadá zdravě". Sedí i „refresh nepomáhá" (po reloadu začne zase hledáním) a „caps lock si hlídám" — **CapsLock příčina je opravená a na produkci od 16. 8.** (`d9b5b495`, `keyboardShortcuts.ts` preferuje `e.code`), Lukáš hlídá mrtvou příčinu. Oprava: blur aktivního inputu při mousedownu na blok (jednořádková).

**Bonus — reálná regrese (ověřeno přímo):** preference `e.code` v `shortcutLetter` (`keyboardShortcuts.ts:45–51`) na české QWERTZ prohazuje Z↔Y: stisk klávesy, která píše „z", má fyzický kód `KeyY` → **Ctrl+Z provede REDO místo UNDO** (a Ctrl+Y undo). Týká se každého českého QWERTZ rozložení (softwarového i hardwarového); C/X/V jsou pozičně shodné, těch se to netýká. Oprava: pro pár Z/Y dát přednost `e.key`, `e.code` nechat jako fallback (CapsLock ochrana zůstane — CapsLock nemění `e.key` mapování písmene, jen velikost, kterou řeší `toLowerCase`). Test doplnit o QWERTZ případ.

### Bod 3 — štítky stavu materiálu a pantone na Monitoru

Jediný zdroj chipů Monitoru je `buildMonitorChips` (`monitorChips.ts:22–67`; sdílená komponenta → hero karta i fronta DNES/ZÍTRA; NEDODĚLÁNO je záměrně bez chipů). **Stav vydání není textově nikde:** `materialInStock/Issued` jen barví podklad chipu `materialStatusLabel` (zelená = skladem NEBO vydáno NEBO odklepnuto — tiskař nepozná „na co má vydáno"), a **když druh materiálu není vyplněný, chip se nevykreslí vůbec** (gate `if (block.materialStatusLabel)`, ř. 43). Pantone má jen pevný text „PANTONE" s tónem (commit `8c653e07` dal texty Skladem/Vydáno jen do BlockDetail). Rozклíč screenshotu: VYSVÍCENO/U SCHVÁLENÍ = číselník DATA; ROLE = číselník MATERIÁL (druh!); „Bez technologie" = blockVariant; „4 hod" = také volný text číselníku, ne délka.

**Náprava (S):** rozšířit `buildMonitorChips` o textové chipy `MAT. VYDÁNO ➜ / SKLADEM ✓ / ČEKÁ` a `PANTONE VYDÁNO / SKLADEM / ČEKÁ` (gate viditelnosti pantone už je správně); od začátku včetně chystaného `MAT. ČÁST. ½`. **Stejný soubor jako Task 6 etapy 1 → sloučeno do etapy 1 jako Task 6b** (jinak se `monitorChips.ts` sahá dvakrát). Typografie přes `ts.chipHero/chipQueue` (strážný test na holé fontSize). Tlačítko HOTOVO ohrozit nejde (oddělený kontejner s pevnou výškou od 17. 8.); riziko jen ořez obsahu hero karty na XL — ověřit. Rozhodnout drobnost: tone chipu druhu materiálu pak signalizuje totéž dvakrát (ponechat/zplošnit na plain).

### Bod 4 — hover bublina zasahuje do bloku

**Dnešní stav (`115a815d`):** bublina (240 px) se zarovnává pravou hranou ke sloupci stroje (`plannerHoverTooltip.ts:60–74`), jenže **karta vyplňuje celý sloupec** (šířka sloupce − 6 px) — bublina tedy VŽDY leží na pravých ~247 px karty, vertikálně od jejího horního okraje (`top = rect.top`, `BlockCard.tsx:1484`). Commit to vědomě akceptoval („vpravo na kartě nic podstatného není") — Lukášova stížnost míří na tento trade-off.

**Proč nejde „napravo od bloku" (předešlá verze):** napravo od karty XL 105 je jen 3 px sloupce + 72 px časové osy = 75 px; bublina 240 px tam překryla ~165 px sloupce XL 106 — přesně stížnost tiskařů 13. 8. **Tři historické požadavky (nezakrývat souseda · nezakrývat chipy vlevo · nezakrývat vlastní blok) jsou v horizontální rovině dohromady nesplnitelné** — jediný volný pás mimo karty je 78 px časové osy.

**Řešení, která vyhoví všem třem (rozhodnutí V5):**
- **(a) Vertikálně pod kartu** (`top = rect.bottom + 6`, u spodního okraje flip nad kartu) — vzor už v repu (notepopover, `BlockCard.tsx:1384`); překryje přechodně kartu POD hovorovanou (`pointerEvents: none`, zmizí s myší). Potřebuje znát/odhadnout výšku bubliny. **Doporučeno** — zachová prostorovou vazbu.
- **(b) Pevný dok** (bublina vždy na stejném místě, např. v aside panelu 320 px) — nikdy nic nepřekryje, ztrácí vazbu na kartu.
- Zamítnuté: návrat „napravo od bloku" (= zpět stížnost tiskařů), sledování kurzoru (překryv neodstraní), zúžení bubliny (muselo by pod 78 px).

### Bod 5 — rezervace se nelámou přes noc

**Není to bug, ale konzistentní architektura:** REZERVACE systémově nemá tiskové hodiny — 9 rozhodovacích míst tvaru `type !== "ZAKAZKA"`: server ji nevaliduje (`scheduleValidationServer.ts:100`), POST/PUT jí `printMinutes` aktivně nulují, snapuje se duration-based (celý souvislý interval; smyčka po 20 pokusech vzdá a nechá interval přes noc — přesně Lukášův screenshot), chain push ji posouvá rigidně s horizontem 7 dní (vědomé rozhodnutí `a79a0346`: „jinak by 45min rezervace zkrátila na 30 a přes víkend se natáhla"), nekreslí pauzy (`tryExpandForBlock`, `printTimeClient.ts:127`), reflow ji odmítá.

**Dvě cesty (rozhodnutí V6 + dotaz na Lukáše):**
- **(a) Vizuální lámání (S/M, doporučeno jako první krok):** nová čistá funkce `rigidBlockSegments` (průnik intervalu s blokovaným časem) → rezervace dostane overlay „⏸ PAUZA — mimo provoz" jako zakázka; start/end, snap, chain push, validace i DB beze změny; `tryExpandForBlock` se NEuvolňuje (zákaz z CLAUDE.md se neporuší — jiný výpočet). Nezhorší žádný dluh.
- **(b) Plné tiskové hodiny pro rezervace (L+):** zopakování celé vlny „tiskové hodiny" pro druhý typ — migrace dat (rezervace mají 45min délky, jádro chce násobky 30), ztráta rigidního horizontu (zdědí třídu havárie 88 bloků), reporty, drift, kaskádová kontrola směn, a **tvrdá prerekvizita**: dosud odložený dluh synchronizace `Reservation.scheduled*` (chain push dnes `scheduledStartTime/EndTime` neaktualizuje — obchodník by viděl staré termíny při každé změně kalendáře).
- **Klíčová otázka na Lukáše:** chce pauzu VIDĚT (→ a), nebo chce, aby rezervace držela garantovanou délku V PRACOVNÍ době (→ b)? Vizuální lámání mu zviditelní, že 12h rezervace přes noc drží jen ~8 h provozu.

---

## 3. Dopad na etapový plán

Promítnuto do `docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md`:
- **Etapa 0** (nasazení) se rozšiřuje: na test/produkci musí kromě kaskádové kontroly směn doputovat i autoposunová vlna (Lukášův incident 18. 8. proběhl bez ní).
- **Etapa 1** (ČÁSTEČNĚ VYDÁNO) +Task 6b: štítky MAT./PANTONE na Monitoru (bod 3).
- **Etapa 5** (strop chain pushe, P31) je z větší části pokrytá autoposunovou vlnou → slučuje se s bodem 1 do **etapy 6** (dokončení B4, rozhodnutí prahu, případný vypínač).
- Nové: **etapa 7** (Vyjmout/Odstranit + fokusová past + QWERTZ Z/Y), **etapa 8** (bublina vertikálně, po V5), **etapa 9** (vizuální lámání rezervací, po V6 a odpovědi Lukáše).

## 4. Otevřené otázky

**Na Vojtu:**
1. **V4 — autoposun:** stačí zapnout potvrzovací dialog (a práh snížit z 5 na 4?), nebo přidat i skutečný vypínač „žádný autoposun — kolizní drop se odmítne" (návrat k chování před 31. 7., např. jako přepínač vedle zámku pracovní doby)? Doporučení: nejdřív zapnout potvrzení s prahem 4 a dát Lukášovi týden zkušebního provozu; vypínač stavět až kdyby nestačilo.
2. **V5 — bublina:** pod kartu s flipem (doporučeno) vs. pevný dok?
3. **V6 — rezervace:** vizuální lámání jako první krok (doporučeno)?

**Na Lukáše (do e-mailu):**
4. Rezervace: stačí pauzy VIDĚT, nebo má rezervace držet garantovanou délku v pracovní době?
5. Autoposun: vyhovoval by práh 4 bloky s potvrzovacím dialogem?

## 5. Dodatek ke konceptu odpovědi Lukášovi

> **K automatickému posouvání:** máte pravdu a mrzí mě to — přesně na tomhle už pár dní pracujeme. Připravená (a brzy nasazená) verze: každý posun řekne, kolik bloků odsunul; jde vzít zpět Ctrl+Z; a posun většího počtu zakázek se bez Vašeho výslovného potvrzení vůbec neprovede — ukáže se dialog „Tato změna odsune N bloků, nejdál do …". Úplné vypnutí zvažujeme také; napište prosím, jestli by Vám stačil limit ~4 bloky s potvrzením, nebo chcete funkci vypnout úplně (posun by se pak při kolizi prostě odmítl).
>
> **Tlačítka Vyjmout a Odstranit** do menu pravého tlačítka přidáme. A našli jsme i skutečnou příčinu, proč Vám zkratky „umírají": po hledání zůstane kurzor v hledacím poli a klik na zakázku ho odtud nevytáhne — zkratky pak nefungují, dokud neklepnete jinam. Opravíme; do té doby pomůže po hledání stisknout Esc. (Caps Lock už příčinou není — ten jsme opravili 16. 8.)
>
> **Štítky materiálu a pantone na Monitoru** přidáme — tiskaři uvidí přímo „MAT. VYDÁNO / SKLADEM / ČEKÁ" a totéž pro pantone, na velké kartě i ve frontě.
>
> **K vyskakovacímu oknu:** ono „napravo od bloku" z dřívějška bohužel zakrývalo sousední stroj — přesně na to si tiskaři 13. 8. stěžovali, proto se to měnilo. Vpravo od bloku místo fyzicky není (bloky vyplňují celý sloupec). Navrhujeme okno zobrazovat POD blokem (nezakryje ani Váš blok, ani sousední stroj) — dáme Vám to vyzkoušet na testovací stránce.
>
> **Rezervace přes noc:** zakázky se „lámou", protože mají tiskové hodiny; rezervace je záměrně pevný blok času. Než to předěláme, potřebuji vědět: stačí Vám pauzu v rezervaci VIDĚT (vykreslíme ⏸ pás jako u zakázek), nebo potřebujete, aby rezervace reálně držela svou délku jen v pracovní době (větší zásah)? Podle toho zvolíme řešení.

---

*Vypracováno 19. 8. 2026, 5 auditorských subagentů + vlastní verifikace. Důkazová hloubka v úložišti auditů; navazuje na `2026-08-18-audit-vlakna-planovace-lukas.md`.*
