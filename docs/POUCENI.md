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

---

## P22 — Čitatel a jmenovatel se musí počítat nad touž množinou

**Co se stalo (14. 8. 2026, průzkum `/reporty`):** Průzkum reportů našel čtyři
nezávislé vady, které měly **jeden a týž tvar**: horní a dolní část zlomku se
počítala nad jinou množinou.

- Bloky se do produkčních hodin sčítaly **celé**, i když období jen protínaly,
  kdežto dostupné hodiny ve jmenovateli ořezané byly → na produkci 26 h ze 399 h
  v srpnu (6,5 %), a tytéž hodiny se započetly znovu i v září (až 12 %).
- Celozávodní odstávku respektoval **čitatel** (expanze tisku v ní vrátí
  `START_NOT_RUNNABLE`), ale **jmenovatel** ne → týden dovolené se vykázal jako
  „0 % ze 152 dostupných hodin" místo poctivého „0 z 0". Prosinec 2026: 153,9 h.
- Průtok se počítal nad bloky **protínajícími období**, ne nad **dokončenými**
  v období → zakázka odklepnutá v srpnu, ale naplánovaná na září, se nezapočítala
  nikde. Na produkci 3 ze 43 (7 %).
- Trychtýř rezervací měl v čitateli jen část stavů, které patřily do jmenovatele
  → `CONFIRMED` (koncový úspěch) z čitatele vypadl, zamítnutá rezervace ve
  jmenovateli zůstala. **Konverze tím klesala rychleji, čím lépe proces fungoval.**

Chyba téhle třídy jde vždycky jedním směrem, nejde poznat z jednoho čísla
(zlomek sám o sobě vypadá rozumně) a projeví se až tím, že **součet dvanácti
měsíčních reportů nedá rok**.

**A nejde o vadu, které by byl člověk po pochopení imunní.** Oprava sama ji
dvakrát zopakovala a odhalila ji až adversariální revize:
- Pomocník `mergeIntervals` vznikl osm řádků nad sumací, použil se na odstávky
  a **na směny ne** → překryv dvou směn se do jmenovatele počítal dvakrát
  (nepřetržitý stroj 182 h týdně místo 168, tedy −8 % na vytížení).
- Oprava dvojího započtení hodin přes hranici období ji zároveň **znovu zavedla
  u průtoku** — rozdělená zakázka s kusy po obou stranách hranice se započítala
  v obou obdobích.

**Pravidlo:** U každé metriky tvaru „X z Y" napsat u obou stran **jednou větou,
nad jakou množinou se počítá**, a ověřit, že jsou to tytéž hranice — časové okno,
filtr strojů, filtr stavů. Kde jde součet rozložit (denně, po strojích), přidat
**strážný test parity**: součet částí se musí rovnat celku. Ten test je jediné,
co tuhle třídu vad chytí dřív než uživatel — a chytil by i obě regrese výše.

---

## P23 — Sytá barva umí být dobrý podklad a nepoužitelné písmo zároveň

**Kdy:** 16. 8. 2026, etapa „Reporty R2 — Tokeny a čitelnost".

Projekt měl pravidlo „barvy vždy přes tokeny, nikdy hex" a stránka `/reporty` ho
porušovala na 23 místech. Při opravě se ale ukázalo, že **dodržet ho nestačí** —
špatně čitelné byly i tokeny samotné, změřeno ve světlém režimu jako barva písma:

| Token | kontrast | kde se tak používal |
| --- | --- | --- |
| `--brand` | **1,22 : 1** | odkazy „Otevřít v plánu →", hlavičky sekcí, zámek bloku |
| `--success` | 2,78 : 1 | zelené „✓ 0" v Kontrolním panelu |
| `--warning` | 1,86 : 1 | chip čekání v Monitoru u stroje |
| `--danger` | 3,42 : 1 | červené číslo nálezu |

Všechny čtyři jsou přitom **jako podklad v pořádku** — `--brand` s `--brand-contrast`
je čitelný a tak je zamýšlený. Vada nevzniká v hodnotě tokenu, ale v tom, že se
sytý odstín použije v roli, pro kterou nevznikl. Tomu žádné „používej tokeny"
nezabrání.

Dvě věci to zhoršovaly:
- **V tmavém režimu byly všechny čtyři v pořádku** (5,2–13,4 : 1). Kdo vyvíjí
  v tmavém režimu, vadu nikdy neuvidí.
- **Neexistoval žádný test, který by kontrast počítal.** Hodnoty se volily od oka
  a od oka i kontrolovaly, takže `--brand` na 1,22 : 1 přežil v repu měsíce.

Táž vada dopadla i na barvy míchané ručně: v heatmapě `/reporty` bylo bílé číslo
na čtyřech sytých dlaždicích (2,53–3,68 : 1) — a protože dlaždice byly napevno
zapsané hexy, nečitelné to bylo **v obou režimech**, ne jen ve světlém.

**Pravidlo:** Nová barva se nezavádí od oka. Změř ji (`src/lib/contrast.ts`) **v roli,
ve které bude stát** — text na skutečném podkladu, ne token v izolaci — a **v obou
režimech**. Když sytý odstín neprojde jako písmo, nezesvětluj ho: vznikne sourozenec
`--*-text`, protože jako podklad je správný. Výsledek zapiš do strážného testu, který
hodnoty **čte ze skutečného `globals.css`**, ne z kopie — kopie hlídá sama sebe.

A pro barvu, která něco rozlišuje (série grafu, stupně heatmapy), kontrast nestačí:
dvě barvy se stejným jasem mají poměr 1 : 1 a přesto můžou být dokonale odlišné.
Měř i **vzdálenost po simulaci barvosleposti**. Právě ta ukázala, že semaforová
škála červená · jantarová · zelená je pro dichromata nerozlišitelná (ΔOKLab
0,004–0,059 při prahu 0,12) — proto v heatmapě nese hodnotu **číslo v dlaždici**
a stav volající po zásahu má navíc rámeček.

### Dovětek: měřicí nástroj je taky kód a taky se musí ověřit

Simulace barvosleposti, kterou celá tahle argumentace používala, byla **první
revizi rozbitá**: kombinovala LMS matici z jedné metody s projekčními koeficienty
z druhé. Nespadla — vracela barvy. Rozdíly mezi tokeny vycházely řádově podobně,
takže „červená a zelená splývají víc než modrá a jantarová" platilo i s ní.
Původní čísla ve specu (0,022) byla o řád mimo a designové rozhodnutí se o ně
opíralo.

Odhalil to teprve **invariant, ne kontrola vzorců okem**: u dichromata se nesmí
hnout achromatická osa. Rozbitá verze dělala z bílé azurovou. Jeden řádek testu.

**Pravidlo:** Když si na měření napíšeš nástroj, napiš k němu invariant, který
platí nezávisle na tom, co měříš — něco, co musí vyjít i kdyby všechny vstupní
hodnoty byly jiné. Test typu „A je větší než B" ověří jen pořadí a přežije
i hrubě špatnou implementaci.

---

## P24 — Souhrn přes období zamlčí špičku uvnitř něj

**Kdy:** 16. 8. 2026, etapa „Reporty R3 — přeskládání stránky".

Nový stavový pás měl hlásit, že je stroj přeplánovaný. Postavil jsem verdikt na
**součtu přes třicetidenní horizont**: naplánované hodiny minus dostupná kapacita.

Stroj naplněný příští týden po–pá na **150 % každý den** vyšel proti prázdnému
zbytku horizontu jako `120 h plánu proti 352 h kapacity` — tedy v pořádku. Pás
k tomu napsal **„Nic nevyžaduje pozornost. Oba stroje v kapacitě"**, zatímco
heatmapa přímo pod ním svítila pěti červenými dny.

Volná kapacita v pozdějších týdnech **umazala špičku v tom nejbližším**. Součet
je z definice slepý k rozložení uvnitř sčítaného rozsahu.

Táž vada má víc podob a všechny se objevily v jedné etapě:
- **Pás vs. karta.** Karta „Kapacita" bere rozdíl přes celé zvolené období, pás
  sčítá přetečení po dnech. Na týchž datech řeknou opak a ani jeden se nemýlí —
  jen odpovídají na jinou otázku. Musí to být vidět v textu, jinak to vypadá
  jako chyba.
- **Jmenovatel, na který se nesáhlo.** Den bez kapacity se přeskakuje, takže
  u stroje s nenaseedovanými týdny směn pás neposoudil ani jeden den — a přesto
  psal „ani jeden stroj není v příštích 30 dnech nad kapacitou". Tvrdil výsledek
  třiceti kontrol, z nichž neproběhla žádná.

**Pravidlo:** U metriky, která má hlásit problém, se ptej, **jestli ho neumí
zprůměrovat pryč**. Souhrn přes období se hodí na „kolik nás to stálo", ne na
„je něco špatně" — tam patří maximum nebo počet překročení, ne součet. A když
metrika některé vstupy přeskakuje, **počítej kolik jich přeskočila** a nikdy
netvrď víc, než na kolika jsi je opravdu ověřil.

Vedlejší poučení téže etapy, stejné třídy: **odkaz, který vede na stránku, kde
uživatel právě stojí, je horší než žádný odkaz.** Tři položky pásu měly
`href="/reporty"`, přičemž záložka je lokální stav bez URL — kliknutí tedy
udělalo plný reload a přistálo na výchozí záložce, takže „Kontrolní panel →"
z Výhledu tiše zahodilo záložku, na které člověk byl. Test to nechytil, protože
ověřoval `href.length > 0`. **Test na existenci řetězce není test na to, že
odkaz někam vede** — cíl musí být z uzavřeného seznamu skutečných cest.

---

## P25 — Šířku produkčního sloupce nelze odvodit ze schématu Prismy

**Co se stalo (incident 14. 8. 2026, zdokumentováno 17. 8. 2026):** Undo editace na
produkci padalo na `prisma.auditLog.createMany()` — „value too long for column:
field". `applyUndoOps` (`undoApply.server.ts`) ořezávala sestavený sloupec `field`
funkcí `truncateUtf8` na `AUDIT_MIXED_FIELD_MAX_BYTES = 180`, protože schéma
(`String` bez `@db.VarChar`) předepisuje `VARCHAR(191)`. Produkční sloupec ale měl
ručně založený `varchar(64)` — ověřeno až zpětně přes `information_schema`. Ořez
odvozený z deklarace neudělal proti realitě databáze vůbec nic; rozbilo se to už
při třech vrácených business polích (76 neodvolatelně odsunutých zakázek).

**Pravidlo:** Než se v kódu ořezává hodnota kvůli délce sloupce, ověřit **skutečný**
sloupec (`SHOW COLUMNS FROM <Tabulka>` nebo dotaz do `information_schema.COLUMNS`),
ne jen to, co předepisuje `schema.prisma`. Produkční DB má doložené ruční odchylky
(viz „Produkční DB — známé odchylky od migrací" v `CLAUDE.md`) a nová odchylka může
kdykoliv přibýt bez migrace, která by ji zaznamenala.

---

## P26 — Hodnota z nedotčeného pole formuláře není projev vůle ji změnit

**Co se stalo (14. 8. 2026, incident zakázky 18827):** `BlockEdit` posílal
tiskovou délku (`printMinutes`) při **každém** uložení, bez ohledu na to, jestli
se jí uživatel dotkl — formulář posílá celý svůj stav, ne jen dotčená pole.
Stačilo, aby se blok pod otevřeným panelem změnil (split), a odklepnuté „Uložit
změny", třeba jen kvůli poznámce, vrátilo předsplitovou délku zpátky. Server
k tomu přidal druhou, nezávislou díru: přepočet harmonogramu zapínal podle
`allowed.type !== undefined`, a `type` posílal formulář vždycky, ať už se ho
uživatel dotkl, nebo ne — **přítomnost klíče v payloadu vypadala jako požadavek
na změnu**, i když šlo jen o odraz stavu z otevření panelu. Souhrou obou děr
zmizelo 75 zakázek z pozice, kam je plánovač úmyslně odsunul.

**Pravidlo:** U každého formuláře, který posílá celý svůj stav, rozlišuj „uživatel
na tohle sáhl" od „bylo to v payloadu" — dvě různé věci, které se snadno smíchají.
Serverové rozhodování o tom, co přepočítat, odvozuj z **rozdílu proti uloženému
stavu**, ne z pouhé přítomnosti klíče v requestu.

---

## P27 — Oprava jednoho pole nezavírá celou třídu chyby

**Co se stalo (17. 8. 2026, závěrečná recenze opravné etapy incidentu 18827):**
Oprava z P26 přidala `durationTouched` a přesynchronizaci (efekt 2b/2c v
`BlockEdit.tsx`), ale **jen pro délku**. `buildPayload()` v témže souboru posílá
zhruba **třicet dalších polí** ze stavu zachyceného při otevření panelu a při
přesynchronizaci — přesynchronizaci dostala jen ta jedna hodnota. Když si
plánovač s otevřeným panelem odklepne na kartě bloku SKLADEM/VYDÁNO nebo změní
termín inline pickerem, následné „Uložit změny" mu ten chip tiše vrátí zpátky na
hodnotu z okamžiku otevření panelu. Škoda je dnes omezená — žádné z těch polí
nespouští chain push — ale kořen je **týž** jako u P26 a zbytek povrchu zůstává
nekrytý.

**Tohle je otevřený dluh, ne hotová věc.** Komentáře u efektu 2b/2c v
`BlockEdit.tsx` popisují opravu jen pro délku a úmyslně nepředstírají víc — kdo
je čte jako „formulář je bezpečný celý", čte je špatně. Náprava (rozšířit
touched-tracking na celý `buildPayload()`, nebo formulář přepnout na posílání
jen skutečně dotčených polí jako diff proti mount-snapshotu) v týhle vlně
neproběhla.

**Pravidlo:** Oprava jednoho projevu třídy chyby se nesmí v commit zprávě ani
v komentáři tvářit jako uzavření té třídy. Když oprava pokrývá jen část
povrchu, na který se stejná chyba vejde, napsat to výslovně jako otevřený dluh
— jinak si to za pár týdnů někdo přečte jako hotovou věc a další stejnou vadu
nikdo nebude hledat.

---

## P28 — Pravidlo „umísti prvek na stranu X" platí, jen když se na stranu X vejde

**Co se stalo (13.–17. 8. 2026, hover bublina na kartě bloku):** Na připomínku
tiskařů, že bublina napravo od zakázky v XL 105 zakrývá celý sloupec XL 106,
vzniklo pravidlo „bublina jde **vždy na vnější stranu mřížky**" — u levého
sloupce doleva, u pravého doprava. Odůvodnění v komentáři znělo: „Vlevo od
levého sloupce je časová osa, kde je jen čas: překryv tam nikoho nestojí
informaci."

Nikdo neověřil, že vlevo od sloupce XL 105 je `DATE_COL_W` + `TIME_COL_W` =
**116 px**, zatímco bublina potřebuje **250 px**. Nevešla se tam ani jednou —
pojistka proti odchodu z obrazovky ji pokaždé přiskřípla k levému okraji okna
a zbylých ~134 px přeteklo přes **levou hranu vlastní karty**, tedy přes chipy
D/M/E/P, číslo zakázky a popis. Pravidlo tak od prvního dne dělalo pravý opak
toho, co slibovalo: místo aby překryv odsunulo tam, kde nevadí, přesunulo ho
z cizího sloupce na to nejdůležitější místo vlastní karty. Pre-press a MTZ
nahlásili, že u XL 105 nevidí, co odklepávají; u XL 106 tatáž logika vycházela
na neškodnou pravou část karty, takže vypadala jako „správné chování", a rozdíl
mezi stroji vypadal jako dvě různá pravidla, i když šlo o jedno.

**Pravidlo:** Než se do kódu zapíše umístění prvku podle strany („vlevo",
„vpravo", „na vnější stranu"), spočítej, kolik místa na té straně **skutečně
je**, a porovnej to s rozměrem prvku. Když se nevejde, ořez ho někam přesune —
a to „někam" je pak skutečné chování, ne to napsané v komentáři. Umístění, které
závisí na geometrii, patří do čisté funkce s testem (`plannerHoverTooltip.ts`),
ne do výrazu uvnitř JSX, kde ho nikdo nemůže spočítat ani ověřit.

---

## P29 — Absolutní kontrola vydávaná za diferenční vychová obsluhu k odklikávání

**Co se stalo (do 17. 8. 2026):** Stará kontrola u editace směn
(`findConflictingBlocks.ts`) hlásila „Zkrácení směny" pokaždé, když nová
konfigurace v abstraktní simulaci vycházela hůř než nějaký referenční stav —
bez ohledu na to, jestli konkrétní editace SKUTEČNĚ něco vystěhovala. Simulace
navíc neznala reálnou expanzi tiskových hodin, takže část poplachů byla
falešná od začátku. Alarm, který nekoreluje s realitou, se naučí ignorovat: po
měsících planých hlášení plánovač na dialog klikal „Pokračovat" automaticky
(forenzní tabulka auditu ze 14. 8. ukazuje `[FORCE]` i u zápisů, které nemění
vůbec nic). Až přijde pravá kaskáda, projde bez povšimnutí — habituace je
skutečná škoda, ne jednotlivý falešný dialog.

**S havárií 16:31 to nesouvisí kauzálně** — tu odpálil posun bloku 1335 (uložení
směn proběhlo dřív, ~16:25), ne uložení směn. Vázat tuhle poučku na tu havárii
by navíc bylo věcně špatně i nezávisle na časech: protažení směny je podle
§1.1 specu *přidání*, expanze je ve směnách monotónní, takže spočítaný konec se
mohl jen zkrátit — i kdyby v 16:31 nějaký dialog naskočil, byl by to další
falešný poplach, ne první skutečný.

**Pravidlo:** Kontrola, která má zabránit škodě, musí měřit ROZDÍL způsobený
TOUTO akcí, ne absolutní stav proti libovolné referenci. Diferenční kontrola
(„bylo v pořádku, teď není" — `classifyCascade` v `src/lib/cascadeCheck.ts`)
nahradila absolutní až po incidentu, ne před ním — cena falešných poplachů se
neprojevila jako bug, ale jako naučené chování obsluhy, a to je vidět až
zpětně.

---

## P30 — Než se staví druhá implementace pravidla, ověřit, jestli první neběží o kus dál na téže cestě

**Co se stalo (17. 8. 2026, oprava kaskády směn):** Diferenční kontrola
kaskády mohla vzniknout jako simulace cílové konfigurace (spočítat, jak by
vypadaly bloky PO uložení, a porovnat se stavem PŘED) — přesně tou cestou,
kterou šla stará vadná kontrola. Místo toho `PUT /api/machine-week-shifts`
zavolal `detectCalendarDrift` dvakrát v JEDNÉ transakci — jednou PŘED upserty
směn, jednou PO nich (transakce vidí vlastní zápisy) — a rozdíl jen změřil.
Cílový stav nebylo potřeba simulovat, protože transakci jde v případě problému
odrolovat: zapsat, změřit, a když je zle, vrátit zpátky.

**Pravidlo:** Než se pro nové pravidlo staví simulace cílového stavu, ověřit,
jestli není jednodušší stav skutečně vytvořit uvnitř transakce a změřit ho —
a transakci při problému odrolovat. Platí to všude, kde databázová transakce
dovolí „zkusit a vzít zpátky": stejný vzor použil i `scripts/revert-revision-group.ts`
(simulace kolizí PŘED zápisem, protože skript transakci neotevře, dokud
neprojde), zatímco `PUT /api/machine-week-shifts` cílový stav rovnou zapíše a
transakci odroluje, pokud je zle — obojí je legitimní, volba závisí na tom,
jestli je levnější simulovat, nebo zapsat a případně vrátit.

---

## P31 — Kalendářní veličina se u hranice směny nemění spojitě

**Co se stalo (16:31, 17. 8. 2026):** Blok na XL 105 se posunul o 30 minut.
Šest minut předtím se pondělní odpolední směna protáhla do půlnoci. Kombinace
způsobila, že 30 z 180 tiskových minut bloku přeteklo přes noční pauzu —
spočítaný konec neposkočil o 30 minut, ale o **6,5 hodiny** (24:00 → 6:30),
protože expanze tiskových hodin musela blok natáhnout přes celou pauzu. Chain
push pak odsunul 87 navazujících bloků, některé o týdny dál. Malé vstupní
gesto (posun o jeden 30minutový slot) vyrobilo velký důsledek, protože veličina
(spočítaný konec přes kalendář) není spojitá funkce vstupu — u hranice směny
umí skočit o délku celé pauzy.

**Pravidlo:** Kde takový skok vstupuje do automatiky, která sama posouvá další
bloky (chain push), musí být strop a potvrzení odvozené od VELIKOSTI DŮSLEDKU,
ne od velikosti vstupního gesta — „posunul jsem o 30 minut" neznamená „dopad je
30minutový". Tohle NENÍ vyřešené: zakázka na chain pushi horizont posunu nemá —
`computeChainPush`/`computeChainPushAttempt` (`src/lib/overlapResolver.ts`,
volané z `resolveChainPushFromDb`) mají konstantu `MAX_RIGID_PUSH_MS` jen pro
rezervaci/údržbu, ne pro zakázku — otevřený dluh, zapsaný i v `CLAUDE.md`.

---

## P32 — Umlčení chyby nesmí umlčet informaci

**Co se stalo (recenze etapy 6, 21. 8. 2026, vypínač autoposunu):** Když se
z uživatelské akce udělá „nic se nestalo", je správné nehlásit chybu — ale
jen tehdy, když se opravdu nic nestalo. Recenze etapy 6 našla čtyři místa,
kde se s umlčením zamítnuté kaskády ztratila i informace, kterou uživatel
potřeboval: souhrn dávky hlásil zelené „Uloženo N" i pro výskyty, které se
vůbec nezkusily uložit; a toast o SELHANÉM rollbacku (bloky zůstaly v DB) se
umlčel taky, takže po kliknutí „Zrušit" mohl na plánu tiše zůstat blok navíc.

**Pravidlo:** Ticho patří jen tam, kde se nic nestalo. U částečně provedené
dávky se aplikace musí ozvat — neutrálně, ne červeně, ale musí.

---

## P33 — Nová preference se musí umět přečíst, ne jen zapsat

**Co se stalo (etapa 6, 21. 8. 2026, vypínač autoposunu):** Vypínač
autoposunu ukládal preferenci správně (server i localStorage), ale nikdo
lokální cache po mountu nečetl. Po každém F5 — a při selhání načtení
preferencí ze serveru po celou session — se tedy hlásil jako ZAPNUTÝ, ačkoli
ho uživatel vypnul, a chain push mezitím běžel dál.

**Pravidlo:** U nového nastavení vždy projít celý okruh zápis → obnovení
stránky → čtení, včetně větve, kdy načtení ze serveru selže. Zapsat a
nepřečíst je horší než neuložit vůbec — uživatel věří, že to platí.
