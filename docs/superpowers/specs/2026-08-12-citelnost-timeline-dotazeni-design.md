# Čitelnost timeline — dotažení po zavedení stupňů písma

Datum: 12. 8. 2026 · Stav: k odsouhlasení · Navazuje na `2026-08-11-citelnost-timeline-velikost-pisma-design.md`

## Proč tenhle spec vznikl

Etapa, která zavedla přepínač velikosti písma `M · L · XL`, nechala za sebou nálezy, které závěrečné review označilo za nepřekážející nasazení. Než se pustíme do jejich opravy, proběhl **průzkum kódu** — čtyři nezávislí agenti přečetli dotčená místa a dopočítali skutečné hodnoty. Ukázalo se, že:

- předchozí plán obsahoval **čtyři věcné chyby**, protože jsem ho psal z cizích shrnutí místo z kódu,
- v kódu je **kritická regrese**, kterou nezpůsobila původní etapa, ale její vlastní oprava (už opravena, commit `2c01e8e`),
- z jedenácti nálezů jsou **dva nesmyslné** (opravovat by je bylo horší než nechat), **tři širší, než se zdálo**, a přibyly **čtyři nové**.

Tenhle spec proto nestaví na review, ale na naměřených číslech. U každého rozhodnutí je uvedeno, z čeho vychází.

## Zásada, která platí pro celý spec

**Prvek, který roste s písmem, musí mít strop odvozený od místa, kde stojí.** Tři z dosavadních vad měly týž tvar: velikost se navázala na stupeň, ale mez, do které se má vejít, zůstala pevná. Kde nelze strop odvodit, prvek se škálovat nebude.

---

## Co se udělá

### A. Dotáhnout škálování textu na kartě

Průzkum vytvořil úplný soupis. Škálovat se budou tyto prvky, protože stojí vedle textu, který už roste, a dnes rostou o 0 %:

| Prvek | Dnes | Kde se kreslí | Nová velikost |
| --- | --- | --- | --- |
| Produkční chip `OBÁLKA` / `VNITŘKY` / archy·série | 8 px | všechny hustoty | `8 × fontFactor` |
| Badge počtu poznámek tiskaře `📝 N` | 10 px | všechny hustoty | `10 × fontFactor`, **se stropem** — viz níž |
| Popisek `⏸ PAUZA — mimo provoz` | 10 px | uvnitř pásu pauzy | `10 × fontFactor` |
| Pilulka rozdělené zakázky (`SplitChip`) | 10 px | plný a kompaktní layout | `10 × fontFactor` |
| Pruh `⚠ N nesedí na kalendář` v hlavičce stroje | 10 px | hlavička stroje | `10 × fontFactor` |
| Tlačítko `Přepočítat` v hlavičce stroje | 10 px | hlavička stroje | `10 × fontFactor` |

**Badge poznámek dostane strop navíc.** Průzkum zjistil, že se nekreslí podle hustoty, ale bezpodmínečně — a na nejnižší kartě (14 px) má box 14 px posazený 7 px od horní hrany, takže **přetéká už dnes**. Zvětšení písma by to zhoršilo. Dostane tedy tentýž strop podle výšky karty, jaký mají chipy.

**Popisek pauzy je bezpečný bez stropu** — kreslí se jen v segmentu vysokém aspoň 40 px.

### B. Co se škálovat NEBUDE

| Prvek | Důvod |
| --- | --- |
| Čtvercové tlačítko „Hotovo" (`square`) | Má **pevný box 26 × 26 px** nezávislý na velikosti písma. Zvětšit v něm písmo z 15 na 20 px by znamenalo přetečení. Buď se škáluje i box, nebo nic — a škálovat box je samostatná úvaha, ne drobnost. |
| Popisek „✓ Hotovo HH:MM" u pruhu | Má vlastní strop `Math.min(size.fontSize, 13)`, vědomou ochranu proti přetečení v úzkém sloupci. Jeho zrušení je rozhodnutí, ne úklid. |
| Tooltip karty, popover poznámky MTZ, kontextové menu | Žijí mimo kartu, portálované do `document.body` s vlastní pevnou šířkou. Se stupněm písma na timeline nesouvisí. |
| Produkční chip — **jeho `maxWidth: 132 px`** | Šířka se odvodí z písma spolu s ním, jinak se s rostoucím textem ořízne dřív. |

### C. Stropy v jednořádkovém layoutu

Průzkum ukázal, že mnou uváděné prvky byly **špatně**. `Clock` a zelená fajfka se v jednořádkovém layoutu vůbec nekreslí — existují jen v kompaktním. Naopak chybí dva prvky, o kterých jsem nevěděl.

Strop podle výšky karty dostanou:

| Prvek | Dnes při XL a kartě 14 px | Číslo zakázky ve stejné situaci |
| --- | --- | --- |
| Ikony `Lock` a `Hourglass` | 12 px | 9,8 px |
| Značky `↻` a `✂` | 10,6 px | 9,8 px |

Obě skupiny jsou dnes větší než číslo, které doprovázejí. U ikon problém začíná už na stupni `L` (10 px proti 9,8).

**Nic dalšího se stropovat nebude.** Průzkum ověřil, že ostatní prvky v té větvi strop mají, nebo ho nepotřebují.

**Vedlejší zjištění, které se nechává být:** stropy u `SpecChip` a `MiniChip` jsou na výchozím stupni `M` nefunkční — kritická výška vychází 13,85 px, ale nejnižší karta má 14. Na `L` a `XL` fungují. Není to vada, jen to nikdo nesmí považovat za pojistku platnou vždy; zapíše se to do komentáře.

### D. Časová osa

Ředění popisků se naváže na velikost jejich písma. Dnešní prahy (14 / 7 / 4 px) byly odhadnuté pro nescalované písmo.

Naměřené případy, kdy je osa nepříjemně hustá — **oba na stupni XL**:

| Zoom | Výška slotu | Rozteč popisků | Písmo | Rezerva |
| --- | --- | --- | --- | --- |
| 6 | 7 px | 14 px | 12,15 px | **1,85 px** |
| 13 | 15 px | 15 px | 12,15 px | **2,85 px** |

Na `M` je minimum 5 px, na `L` 3,65 px. Nová podmínka bude porovnávat rozteč s velikostí písma a požadovat aspoň 5 px volného místa, čímž se `M` chová přesně jako dnes.

**Důležité, co plán dřív nevěděl:** stejná podmínka řídí i **vodorovné čáry mřížky**, nejen text popisků. Změna tedy překreslí i rastr — je to žádoucí (řidší popisky s hustým rastrem by vypadaly rozbitě), ale musí se to ověřit okem.

### E. Sticky hlavička

Zde se **nejdřív ověří v prohlížeči**, teprve pak opraví. Průzkum zjistil dvě věci, které mění zadání:

1. **Pruh s driftem výšku hlavičky nemění.** Jméno stroje má řádkování 1,5, takže je vždy vyšší (18 px při `M`, 24,3 při `XL`) než pruh (16) i tlačítko (18). Můj předchozí závěr, že se hlavička musí měřit, byl **špatný** — výška je deterministická a spočítat ji lze.
2. **Konstanta 33 px možná nemá být vůbec.** Hlavička není uvnitř scrollovacího kontejneru, je to jeho sourozenec. Sticky štítek dne s `top: 33` si tedy rezervuje 33 px pod hlavičkou, ačkoliv s nulou by se zarovnal přesně pod ni. Průzkum neumí bez prohlížeče rozhodnout, jestli je ten odstup záměr nebo pozůstatek.

**Rozhodnutí:** implementace začne tím, že se v běžící aplikaci porovná chování při `top: 33` a `top: 0`. Pokud je odstup zbytečný, konstanta se smaže — to je lepší výsledek než ji opravovat. Pokud je záměrný, nahradí se výrazem `machineHead × 1,5 + 17`. `ResizeObserver` se nepoužije; byl by v projektu první svého druhu a není potřeba.

### F. Pilulka rozdělené zakázky u tiskaře

Tohle byl v původním seznamu „drobný nález M12". Průzkum ukázal, že je **podstatně větší**.

Před etapou: kompaktní layout kreslil klikatelnou pilulku bezpodmínečně od 32 px. Pilulka nese jméno partnerského stroje, stav (čeká / hotovo), čas — a hlavně **klik, který přepne na partnerský stroj a doskočí na navazující blok**.

Po etapě: karta se od 46 px překlápí do plného layoutu, kde se pilulka kreslí jen když se vejde do výškového rozpočtu. Ten ji propustí **až od 80 px**. V pásmu **46–79 px** tak tiskaři zbyde jen neklikatelná textová značka `✂1/2` bez jména stroje, bez stavu, bez času a bez akce.

**Rozhodnutí:** pilulka se v plném layoutu zpřístupní i pod 80 px. Rozpočtová funkce `splitChipFits` se **neupravuje** — chrání tlačítko „Hotovo" a její výpočet je správný. Místo toho se zařídí, aby pilulka měla kam jít i na nižší kartě.

### G. Šířky — co se změří a co se nechá být

Průzkum spočítal skutečné šířky sloupce stroje z reálného layoutu (osa 44 px, sloupec času 72 px na každý stroj, panel 200–600 px, výchozí 320).

**Chip Pantone se při `XL` ořízne na 1366px obrazovkách.** I s výchozím panelem chybí zhruba 9 px, s roztaženým panelem zmizí celý a ubere se i kus chipu expedice. Od 1600 px je to bezpečné, od 1920 px s velkou rezervou.

**Rozhodnutí:** neopravuje se v této etapě. Bylo už jednou vědomě rozhodnuto, že se chipy zalamovat nebudou, a zúžení chipů při úzkém sloupci je samostatná úvaha o tom, co má ustoupit dřív. Zapíše se do dokumentace jako známé omezení: *plánovači na 1366px notebooku se při stupni `XL` ořízne čtvrtý datumový chip*.

**Pravý shluk se nezalomí** — na rozdíl od toho, co tvrdil původní plán. Má `flexShrink: 0`, takže ho flexbox nikdy nezmenší; místo toho ustoupí popis a v krajním případě se elipsou zkrátí **i číslo zakázky**. To je horší chování, ale je **předexistující** a se stupni písma souvisí jen okrajově. Neřeší se.

---

## Co se nechává být a proč

| Nález | Rozhodnutí |
| --- | --- |
| Čtvercové tlačítko „Hotovo" má 26 px v kartě, která může mít 14 | Předexistující, netýká se stupňů písma. Vlastní úvaha. |
| Popisek „✓ Hotovo" nepřeroste 13 px | Vědomá ochrana, ne opomenutí. |
| Rok v datu (`13.8.` místo `13.08.26`) | Rozhodnutí předchozího specu, plné datum je v tooltipu. |
| Ořez chipu Pantone na 1366 px při `XL` | Známé omezení, zapíše se do dokumentace. |
| Ořez čísla zakázky, když je pravý shluk dlouhý | Předexistující chování flexboxu. |
| Prahy `height >= 18` a `h >= 14` u popisků firemního dne a časů v zamčeném bloku | Táž třída vady, ale obsah se stupněm neroste, takže nevzniká nekonzistence. Zapíše se jako dluh. |

---

## Rizika

**Nejvyšší riziko je tiskařská cesta.** Dvě z posledních tří vážných vad byly právě tam a ani jedna se nedala najít z diffu. Každý zásah, který se dotkne výškového rozpočtu karty nebo prahů, musí být doprovázen strážným testem, který projede **celý obor hodnot** a tvrdí, co má platit — ne co funkce vrátila.

**Druhé riziko je, že se opravou něco zhorší, jako se to stalo u pruhu „Hotovo".** Proto u každé změny prahu platí: dohledat všechny konzumenty a projít, co se vykreslí, ne jen co se vrátilo.

**Vizuální ověření je součástí zadání, ne bonus.** Tři body (osa a rastr, sticky hlavička, pilulka u tiskaře) nelze uzavřít dopočtem.

## Otevřené body pro Vojtu

1. **Čtvercové tlačítko „Hotovo" v kartě 14 px** — chceš ho řešit v této etapě, nebo zvlášť? Je to předexistující vada, ale je v tiskařské cestě.
2. **Ořez chipu Pantone na 1366px obrazovkách při `XL`** — stačí zapsat jako známé omezení, nebo chceš, aby se s tím něco dělalo? Pracuje někdo z plánovačů na notebooku s takovou obrazovkou?
