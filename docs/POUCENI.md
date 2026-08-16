# Poučení — rejstřík chyb a jejich pravidel

Živý seznam chyb, které při práci na tomhle projektu **skutečně nastaly**, i těch,
které se podařilo chytit těsně před tím, než napáchaly škodu. Účel není zápis viny,
ale **pravidlo, které tu chybu příště znemožní**.

Zakládá se na tom, co se opravdu stalo — ne na obecných dobrých radách. Když se objeví
nová chyba, přibude sem řádek. Pravidla, která dozrají do závazné konvence, se stěhují
do `CLAUDE.md`; tenhle soubor si nechává příběh, protože příběh se pamatuje líp než
odrážka.

---

## P1 — Tvrdit něco o datech bez dotazu

**Co se stalo (9. 8. 2026):** Prohlásil jsem, že zakázky 18447 se testování nedotklo,
a nabídl jako důkaz dotaz, který to měl potvrdit. Vrátil 6 revizí — dotklo.

**Pravidlo:** Tvrzení o datech vyslovit **až po** dotazu, ne před ním. Když už dotaz
posílám jako důkaz, počkat na výsledek a teprve pak formulovat závěr.

---

## P2 — Ověřit schéma v jiném prostředí, než o kterém mluvím

**Co se stalo (9. 8. 2026):** Zdůvodnil jsem řazení historie rozdílnou přesností
sloupců `AuditLog.createdAt` a `BlockRevision.createdAt`. Review to vyvrátila měřením
na **dev** DB (obě `datetime(3)`) a já zdůvodnění přepsal. Pak se ukázalo, že na
**produkci** je `AuditLog.createdAt` opravdu `datetime(0)` — nezdokumentovaná odchylka.
Pravda byla obojí a obě opravy byly zpola chybné.

**Pravidlo:** Když tvrzení stojí na schématu, ověřit ho **v tom prostředí, o kterém
mluvím**. Dev DB vzniká z migrací, produkční má doložené ruční odchylky
(viz „Produkční DB — známé odchylky od migrací" v `CLAUDE.md`). Napsat do závěru,
které prostředí se měřilo.

---

## P3 — Když verdikt odporuje viditelným datům, chyba je ve verdiktu

**Co se stalo (9. 8. 2026):** Kontrolní dotaz hlásil `NESEDÍ` u patnácti řádků, kde
byly obě porovnávané hodnoty **viditelně stejné**. Příčina byla v `<=>` nad výstupem
`JSON_EXTRACT`, ne v datech. Málem to vypadalo jako vada atomického undo.

**Pravidlo:** Než ohlásím vadu, porovnat verdikt s tím, co je vidět v datech. Když si
odporují, podezřelý je nástroj. Kontrolní dotazy psát tak, aby vedle verdiktu **vždy
vypisovaly i porovnávané hodnoty** — jinak se chyba v dotazu neodhalí.

---

## P4 — Domyslet kaskádu, než doporučím zásah do produkce

**Co se stalo (9. 8. 2026):** Doporučil jsem opravit zakázku 18447 ručním přetažením
místo zásahu do databáze — „bezpečnější, bez SQL". Test na kopii produkce ukázal, že
přetažení odsune **71 dalších bloků**, které se při vrácení zpátky samy nevrátí
(autoposun je jednosměrný). Na ostrém plánu by to byla škoda, ne oprava.

**Pravidlo:** U každého doporučeného zásahu do produkce se zeptat, **co ještě se tím
pohne**. „Ruční" není totéž co „bezpečné"; jeden drag umí přeskládat desítky bloků.
Když to jde, zásah napřed vyzkoušet na kopii.

---

## P5 — Před psaním specu najít VŠECHNA místa, která jev počítají

**Co se stalo (9. 8. 2026):** Spec etapy „zámek" mířil na serverový detektor kalendáře.
Štítek na kartě bloku ale počítá **klient** (`printTimeClient.ts`). Podle původního
znění by naskočil pruh nad strojem, ale zakázka v plánu by zůstala neoznačená — půlka
funkce. Chyceno až při kontrole před psaním plánu.

**Pravidlo:** Grepovat **symbol**, ne soubor. Než napíšu „uprav X", ověřit, jestli
tentýž jev nepočítá ještě někdo jiný — v tomhle repu má víc věcí serverovou
i klientskou variantu (validace harmonogramu, tiskové hodiny, drift kalendáře).

---

## P6 — Sdílený helper se neuvolňuje bez seznamu volajících

**Co se stalo (9. 8. 2026, chyceno před implementací):** Nejpřímější cesta ke splnění
specu byla uvolnit guard v `tryExpandForBlock`. Ten ho ale sdílí `getBlockSegments`
(kreslení pauz uvnitř bloku) — odloženým zakázkám by se začal dovnitř kreslit pás
„⏸ PAUZA — mimo provoz", přestože tisknou slitě. Byla by to regrese nálezu O7 z téhož
dne.

**Pravidlo:** Než uvolním podmínku ve sdílené funkci, **vypsat všechny volající**
a u každého se zeptat, co ta podmínka drží právě pro něj. Když se sémantika volajících
liší, správně je větev u volajícího, ne uvolnění sdíleného guardu.

---

## P7 — Test nad umělou fixture může schovat, na čem oprava stojí

**Co se stalo (9. 8. 2026):** Testy řazení historie používaly auditní razítka `.000Z`.
Review upozornila, že to nemusí odpovídat realitě. Po přepsání na realistická
sub-sekundová razítka zůstaly zelené — takže na tom oprava nestála. Kdyby stála,
odhalilo by se to až v provozu.

**Pravidlo:** Fixture stavět z **tvarů, které se v datech opravdu vyskytují**. Když
test závisí na kulaté hodnotě, ověřit, že s realistickou taky projde.

---

## P8 — Zpětné apostrofy v commit message uvnitř uvozovek

**Co se stalo (9. 8. 2026):** Commit message psaný jako
`git commit -m "… podmínka \`changed\` v reflow …"` — shell zpětné apostrofy vyhodnotil
jako příkaz (`command not found: changed`) a slovo z hlášky **zmizelo**. Commit prošel
zmrzačený a byl už pushnutý, takže se opravovat nevyplatilo.

**Pravidlo:** Commit message psát **výhradně přes heredoc s uvozeným oddělovačem**
(`git commit -F - <<'EOF'`). V něm shell nic nevyhodnocuje, takže zpětné apostrofy,
`$`, uvozovky i diakritika projdou doslova. Totéž platí pro každý delší text posílaný
přes `-m`.

---

## P9 — Fake databáze v testu musí promítat `select`

**Co se stalo (9. 8. 2026, chyceno při psaní testu):** Fake `block.findMany`
v `calendarDrift.server.test.ts` vracel celé testovací řádky bez ohledu na `select`.
Implementace tedy mohla zapomenout nový sloupec do `select` přidat a test by prošel —
na produkci by ale Prisma sloupec nevrátila, hodnota by byla `undefined` (falsy)
a klasifikace by tiše nikdy nefungovala.

**Pravidlo:** Fake Prisma klient musí napodobit i **projekci podle `select`**, nejen
filtrování podle `where`. Jinak testy pinují jen tvar výstupu, ne dotaz, který se
doopravdy odešle.

---

## P10 — České uvozovky uvnitř dvojitě uvozeného řetězce v kódu

**Co se stalo (9. 8. 2026):** Popisek `"Zbytková značka „odložené…“"` se při zápisu
do souboru normalizoval — koncová česká uvozovka se změnila na ASCII `"` a ukončila
řetězec dřív (`TS1002: Unterminated string literal`). Stálo to jedno kolo buildu.

**Pravidlo:** České uvozovky v řetězcových literálech psát v **jednoduše uvozeném**
řetězci (`'… „text“ …'`). Případná normalizace pak literál neukončí.

---

## P11 — „Mutační pojistka" musí padnout na mutaci, kterou hlídá

**Co se stalo (9. 8. 2026):** Test `getBlockSegments: bypass blok → null` měl v komentáři
napsáno MUTAČNÍ POJISTKA a v commitu jsem se na něj odvolal jako na ochranu proti regresi
z poučení P6. Jeho fixtura ale ležela **na sobotě, kdy je stroj celý den vypnutý** —
expanze selhala dřív, než se hlídaný guard vůbec vyhodnotil. Test procházel se zapnutým
i vypnutým guardem. Odhalila to až review, která mutaci skutečně aplikovala.

**Pravidlo:** U testu, který má hlídat konkrétní řádek, **fixturu ověřit z druhé strany**:
bez toho řádku musí test PADNOUT. Nejlevnější způsob je přidat do téhož testu i pozitivní
větev („bez značky segmenty s pauzou vzniknou") — pak je vidět, že vstup projde až tam,
kam má. Tvrzení „hlídá to test X" nepsat do commitu dřív, než jsem mutaci opravdu spustil.

---

## P12 — Příznak, který zapisuje server, není přání uživatele

**Co se stalo (9. 8. 2026):** Celá etapa „zámek" stála na tom, že se z kontroly kalendáře
odstraní výjimka pro odložené zakázky — „konečně je někdo zkontroluje". Přehlédl jsem, že
`scheduleBypassed` zapisuje server jako **spočítanou pravdu** (`effectivelyBypassed = !conforms`),
takže odložená zakázka je z definice nekonformní. Odstraněním filtru by každé vědomé
odložení natrvalo svítilo jako porucha ve třech kanálech a hromadné „Přepočítat" by ho
nevratně vystěhovalo. Spec i plán tuhle vazbu minuly; našla ji až review.

**Pravidlo:** Než změním, kdo se dívá na nějaký příznak, dohledat **kdo a podle čeho ho
zapisuje**. Když ho počítá server z geometrie, není to uživatelské nastavení a nesmí se
číst jako „uživatel si to přál" ani jako „něco je rozbité" — je to důsledek, a jeho
význam určuje ta funkce, která ho nastavuje.

---

## P13 — Chyba, kterou aplikace jen ukáže a nikam nezapíše, je nediagnostikovatelná

**Co se stalo (9. 8. 2026):** Po nasazení hlásil plánovači krok zpět „Vrácení zpět
selhalo". Serverový log přitom u téhož kroku psal „krok historie proveden" (44 bloků) —
protože ta cesta má dvě tiché díry naráz: `AppError` route vrátí klientovi a **nezaloguje**,
a klient chybu odchytí do bubliny a **taky ji nikam nezapíše**. Jediný důkaz byl text
bubliny, který zmizel dřív, než se stihl přečíst. Než jsme se dostali k ladění, problém
sám zmizel (nejspíš starý balík javascriptu v prohlížeči) a příčinu **už nešlo zjistit**.

**Pravidlo:** Odchycená chyba musí zanechat stopu, která přežije zmizení bubliny —
na klientovi `console.error` s kontextem, na serveru řádek v logu i u `AppError`, pokud
je ta cesta pro uživatele kritická. **Bez toho se ladí jen to, co se povede zopakovat.**
Druhá půlka pravidla je provozní: po každém nasazení **napřed tvrdý refresh**, teprve
potom ladění (viz `docs/DEPLOY_WORKFLOW.md`, oddíl 8) — jinak se hledá chyba v kódu,
který v prohlížeči neběží.

---

## P14 — Metrika, která nikdy nic nenapočítá, vypadá jako zdravé KPI

**Co se stalo (10. 8. 2026):** Karta „Stabilita plánu" na reportu vedení ukazovala
100 % a číslo „0 přeplánování". Vypadalo to jako mimořádně stabilní provoz. Ve
skutečnosti metrika nedokázala napočítat **vůbec nic** a měla přitom tři nezávislé
vady najednou:

1. Porovnávala **přesnou shodu** názvu sloupce (`startTime`) proti hodnotám, které
   se do `AuditLog.field` reálně zapisují ve **složeném tvaru** (`startTime/endTime`,
   `startTime/endTime/machine`). Dávkový přesun deseti bloků dal nulu.
2. Visela na zdroji, který nejběžnější akci nezaznamenává vůbec — přetažení jednoho
   bloku myší nemá v `AuditLog` řádek, protože poziční sloupce nejsou
   v `AUDITED_FIELDS` (táž díra jako havárie 5.–6. 8. 2026).
3. Čitatel a jmenovatel počítaly **různé množiny**: bloky editované v období proti
   blokům naplánovaným v období. Podíl mohl vyjít i záporný.

Testy byly přitom zelené — pět kusů, všechny nad vymyšlenými vstupy tvaru
`{ field: "startTime" }`, který ale žádná zápisová cesta nepíše. Jeden z nich
dokonce **aktivně bránil** správnému chování: vylučoval tvar `startTime/endTime`
jako „automatické odsunutí", jenže ten tvar píše i vědomý dávkový přesun. Záměr
byl správný, provedení na špatné ose — filtrovat se mělo podle **akce**, ne podle
názvu pole.

**Pravidlo:** U každé metriky napsat aspoň jeden test nad **skutečným tvarem dat**,
jaký do databáze píše produkční kód, a ověřit, že vrací **nenulovou** hodnotu.
Zelené testy nad vymyšlenými vstupy tuhle třídu vady neodhalí — a metrika, která
tiše vrací nulu, je horší než chybějící metrika, protože se podle ní rozhoduje.
Než se metrika napojí na zdroj, ověřit křížovou tabulkou nad reálnou databází
(`GROUP BY action, field`), že ten zdroj měřenou událost vůbec obsahuje.

---

## P15 — První záznam není začátek nahrávání

**Co se stalo (10. 8. 2026):** Nová metrika „Stabilita plánu" má poctivý guard —
za období, které černá skříňka nepokrývá, ukáže `—` místo vymyšleného čísla.
Jenže jsem jako začátek pokrytí vzal `MIN(createdAt)` z tabulky `BlockRevision`,
tedy **datum první zaznamenané změny**. To je něco jiného než **odkdy se nahrává**.

Důsledek se ukázal hned při ručním prokliku: Vojta přesunul blok, revize
prokazatelně vznikly (tři bloky, jeden `groupId` — přetažení plus chain push),
a karta pořád ukazovala `—`. První změna dne je totiž z definice mladší než
půlnoc toho dne, takže období „dnes" nebylo nikdy pokryté.

Horší podoba téže vady by se projevila až v provozu: kdyby se celý týden nic
nepřesunulo, metrika by to přečetla jako **„nemám data"** místo správného
**„nic se nepohnulo"** — a zamlčela by tím nejlepší možnou odpověď, jakou ten
report umí dát.

Správný signál je, kdy na daném prostředí **doběhla migrace**, která tabulku
založila (`_prisma_migrations.finished_at`), oříznutý retencí. Na devu 7. 8.
19:17, na produkci 9. 8. večer — dvě různá data pro tentýž kód, což je přesně
důvod, proč to nejde zapsat konstantou.

**Pravidlo:** U každého „odkdy o tom něco víme" rozlišit **začátek sběru** od
**prvního záznamu**. Prázdno v datech má dvě různé příčiny — *nesbíralo se*
a *nic se nedělo* — a metrika je nesmí splést, protože každá vede k opačnému
závěru. Zdrojem prvního je vždy něco vně sbíraných dat (migrace, konfigurace,
datum nasazení), nikdy `MIN()` nad nimi.

**Druhá půlka:** Testy byly zelené a chybu neodhalily, protože čistá funkce
dostávala správný vstup — záměna byla o patro výš, ve volajícím. Kde se logika
takhle rozpadá mezi funkci a její napojení, patří strážný test nad zdrojákem
volajícího (vzor `revisionWiring.test.ts`); ověřit ho mutací, jinak hlídá vzduch.

---

## P16 — Testovací seed musí zapisovat přes tytéž serializační helpery jako aplikace

**Co se stalo (11. 8. 2026):** Fronta Monitoru dostala chipy a mezi nimi tiskové
archy a sérii. `buildMonitorChips` sáhla na `Block.tiskoveArchy` a `Block.serie`
a vypsala je rovnou jako popisek chipu. Jenže ty dva sloupce nejsou lidský text —
ukládají se jako JSON pole labelů (`'["1. TA","5. TA"]'`), jak popisuje hlavička
`src/lib/productionTags.ts`. Všechny tři zápisové cesty jdou přes
`serializeProductionTags`, všichni ostatní čtenáři před zobrazením formátují.
Monitor byl jediný, kdo sloupec tiskl doslova — tiskaři by u stroje svítil chip
`["1. TA","5. TA"]`.

Vada se zdědila z `HeroChips` na velké kartě (nasazeno 10. 8.), ale tahle etapa
ji násobila do každého řádku fronty a zabetonovala pod nové testy.

**Proč to neodhalil proklik:** `prisma/seed-monitor.ts` psal holé labely
(`tiskoveArchy: arch3.label`) — tvar, jaký aplikace nikdy nezapíše. Na seedu
chip vypadal správně (`3. TA`), takže položka kontrolního seznamu „MON-2404 má
OBÁLKA + archy + sérii" prošla. Stejný špatný tvar převzala i testovací fixture
v plánu, takže ani testy nemohly nic chytit — obojí měřilo neexistující realitu.

**Pravidlo:** Seed je testovací dvojník produkčních dat, ne volný zápis do
tabulky. Každý sloupec, který aplikace zapisuje přes helper (serializace,
normalizace, výpočet), musí seed zapisovat **týmž helperem**. Seed, který píše
tvar, jaký žádná zápisová cesta nevyrobí, neochrání nic — naopak dává prokliku
i testům falešné zelené světlo, a to tím spolehlivěji, čím pečlivěji se podle
něj ověřuje. Než se nový sloupec objeví v seedu: `grep` zápisové cesty a použij,
co používají ony.

**Druhá půlka:** Chybu nenašly ani testy, ani proklik, ani review jednotlivých
tasků — až závěrečné review celé větve, které si dohledalo, jak se sloupec
zapisuje jinde v aplikaci. Když nová komponenta čte sloupec, který dosud četl
někdo jiný, patří do review otázka „jak to čtou ostatní a proč jinak než já".

---

## P17 — Review nad diffem nenajde vadu, kterou způsobí součinnost dvou modulů

**Co se stalo (12. 8. 2026):** Oprava v `tiskarBlockView.ts` zvedla práh pruhu
„Hotovo" ze 46 na 50 px — sama o sobě správná, prošla scoped re-review. Jenže
`BlockCard.tsx` překlápí kartu do plného layoutu už při 46 px a v plném
layoutu kreslí **výhradně pruhovou** variantu tlačítka. V pásmu 46–49 px tak
tiskař nedostal žádné tlačítko. Našel to až průzkumný agent, který se neptal
„co se v diffu změnilo", ale „za jakých podmínek se který prvek vykreslí".

**Pravidlo:** U změny prahu, konstanty nebo výčtové hodnoty, kterou čte jiný
modul, dohledat všechny konzumenty a projít celý obor hodnot. U prahů napsat
strážný test, který projede celý rozsah a tvrdí, co má platit.

---

## P18 — Závěr „vada je teoretická" musí být doložený, ne pravděpodobný

**Co se stalo (12. 8. 2026):** Měření u čtvercového tlačítka „Hotovo" došlo
k závěru, že tiskař na problematické pásmo nedosáhne, protože nemá zoom
slider. Nezávislé ověření našlo dvě cesty: `localStorage` zařízení i
serverová preference účtu se čtou pro každou roli a zpětně zapisují při
každém mountu (tiskař tak zdědí cizí zoom natrvalo a nemá ho čím vrátit),
a výška obsahu karty u bloku přes odstávku obcházela podlahu 20 px.

**Pravidlo:** Když závěr stojí na provozním předpokladu, který kód
nevynucuje, není to závěr — je to domněnka. Buď ten předpoklad vynuť v kódu,
nebo vadu považuj za reálnou.

---

## P19 — Komentář, který popisuje zamýšlené chování místo skutečného, je horší než žádný

**Co se stalo (13. 8. 2026):** `clearSearch()` v `PlannerPage.tsx` měla u sebe
komentář „jediné místo pravdy — volá se z křížku v poli, z Esc a z kliknutí do
prázdné plochy plánu". Ve skutečnosti visela jen na křížku. Kdo komentář
přečetl, si zapojení odškrtl jako hotové; nikdo se dál neptal, proč Esc
rozepsaný dotaz nemaže. Chybu nenašel build ani test suite (`PlannerPage.tsx`
v tomhle rozsahu dedikovaný test nemá), ani review vlastního implementačního
tasku — až samostatné navazující review, které se ptalo „platí to, co
komentář tvrdí", ne „odpovídá diff zadání".

**Pravidlo:** Komentář, který popisuje CÍL místo AKTUÁLNÍHO stavu kódu, je
past — dává čtenáři falešnou jistotu a sám sebe tím chrání před kontrolou
(kdo věří hotové věci, neprokliká ji). U tvrzení „volá se odsud, odsud a
odsud" ověřit `grep` na místě, ne důvěřovat textu. Chybějící komentář by
aspoň nelhal.

---

## P20 — Zúžit zadání kvůli vlastní obavě je stejná vada jako ho nesplnit

**Co se stalo (13. 8. 2026, dvakrát na téže featuře):** Majitel napsal, že
hledání v plánu se má „vynulovat kliknutím kamkoliv do plánu".

Poprvé jsem zapojení `clearSearch` na klik do plánu **úplně odstranil** —
z obavy, že klik přijde i po dotažení lasa a smaže plánovači rozepsaný dotaz.
Obava byla technicky správná, řešení špatné: správná odpověď byla pojistka
(`gestureEndedAtRef`), ne vypnutí featury. Podruhé jsem „kamkoliv" vyložil
jako „do prázdné plochy" a klik na blok vyňal s odůvodněním, že by to
znemožnilo proklikat další shodu. Odůvodnění bylo mylné (mezi shodami se
přepíná šipkami v hlavičce, mimo mřížku) a vyňatý případ byl přitom ten
NEJČASTĚJŠÍ: plánovač najde zakázku a klikne na ni. Featura tak podruhé
působila jako rozbitá — a chybu nenašel build, 1062 testů, pět kol
subagentního review ani finální adversariální review, protože všechny měřily
kód proti specu, a spec už to zúžení obsahoval.

**Pravidlo:** Když z vlastní obavy zužuji rozsah toho, co si zadavatel řekl,
je to **rozhodnutí zadavatele, ne moje** — buď to zúžení do zadání nedávat,
nebo se na ně výslovně zeptat. Zúžení zapsané do specu se stává nedotknutelnou
pravdou pro každé další review; od té chvíle už ho nikdo nezpochybní. A obava
z vedlejšího efektu se řeší pojistkou proti tomu efektu, ne vypnutím
požadované funkce.

---

## P21 — Zkratka porovnávaná přes `e.key` je vypnutelná Caps Lockem

**Co se stalo (13. 8. 2026, produkce):** Plánovači přestaly z ničeho nic
fungovat VŠECHNY klávesové zkratky (Ctrl+C/X/V/Z/Y). Nespravil to reload
stránky ani restart Chromu, druhému uživateli přitom všechno fungovalo. Vypadalo
to na poškozený účet nebo rozbitá data — audit produkční DB ale ukázal roli
`PLANOVAT` v pořádku, `tokenVersion` netknutý, preference normální, serverové
logy čisté a poslední deploy dva dny starý. Příčinou byl **zapnutý Caps Lock**:
handler porovnával `e.key === "c"` doslova s malým písmenem, jenže
`KeyboardEvent.key` nese znak tak, jak by se NAPSAL — s Caps Lockem `"C"`.
Každá písmenná zkratka tím tiše propadla, zatímco `Delete` a `Esc` (pojmenované
klávesy) fungovaly dál a myš také, takže aplikace působila zdravě.

Diagnózu zdržel předpoklad „přežije reload ⇒ je to na serveru nebo v datech".
Ve skutečnosti přežije reload i **stav klávesnice**, protože ten není součástí
stránky. Rozhodl až test za deset sekund: napsat `c` do hledacího pole a
podívat se, jestli se objeví `c`, nebo `C`.

**Pravidlo:** Písmennou zkratku odvozovat z `e.code` (fyzická klávesa `KeyC`,
nezávislá na Caps Locku i na rozložení), s `e.key.toLowerCase()` jako zálohou —
jediný zdroj pravdy je `shortcutLetter`/`isShortcut` v
`src/lib/keyboardShortcuts.ts`. **Nikde nepsat `e.key === "<malé písmeno>"`.**
A při hledání příčiny nesmí seznam „co přežije reload" obsahovat jen server,
DB a `localStorage` — patří tam i stav klávesnice a prohlížeče u uživatele.
