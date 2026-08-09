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

## P7 — Test nad umělou fixture může schovat, na čem oprava stojí

**Co se stalo (9. 8. 2026):** Testy řazení historie používaly auditní razítka `.000Z`.
Review upozornila, že to nemusí odpovídat realitě. Po přepsání na realistická
sub-sekundová razítka zůstaly zelené — takže na tom oprava nestála. Kdyby stála,
odhalilo by se to až v provozu.

**Pravidlo:** Fixture stavět z **tvarů, které se v datech opravdu vyskytují**. Když
test závisí na kulaté hodnotě, ověřit, že s realistickou taky projde.
