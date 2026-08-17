# Reporty R4a — Kaskáda kapacity

**Datum:** 17. 8. 2026
**Navazuje na:** R1 (správnost) · R2 (čitelnost) · R3 (rozvržení)
**Podklad:** `docs/audits/2026-08-16-reporty-pruzkum-metrik.md`, kap. 5.4

---

## 1. Proč zrovna tohle a proč teď

Průzkum našel sedm ukazatelů spočitatelných z dnešních dat. **Šest z nich stojí na
nepovinných polích**, jejichž vyplněnost na produkci neznáme — a dokud ji neznáme,
je pořadí prací dohad. Změřil jsem dev databázi a potvrdilo se, že odpověď nedá:
`jobPresetId` má 0 %, `printCompletedAt` 6 %. Jsou to seedovaná testovací data.

**Kaskáda kapacity je jediná, která na žádném nepovinném poli nestojí.** Počítá se
z `MachineWeekShifts`, `CompanyDay` a z bloků — tedy z dat, která v aplikaci existují
vždycky, protože bez nich by nefungoval samotný plánovač.

A je to zároveň ta, na které se nezávisle shodly dvě rešerše: oborová ji navrhla jako
„kaskádu kalendář → směny → plán → odklepnuto", finanční jako **TEEP** a **CAM-I model**.
Německý bvdm ji učí jako `1 750 h × B° 84 % × N° 86 % = 1 264 fakturovatelných hodin`.

---

## 2. Otázka, na kterou má odpovědět

**„Chybí nám stroj, nebo chybí nám směna?"**

Dnešní report umí jen `vytížení = produkce / obsazené hodiny`. To je poměr **třetího
kroku ke druhému** — a nikdy neřekne, jakou část kalendáře vůbec obsazujeme lidmi.

Před investicí 140 M Kč do IML stroje je to špatně položená otázka. Doložený příklad
z rešerše: linka na jednu směnu Po–Pá může mít **OEE 85 % a TEEP 20 %**. Provoz
s TEEP 65 % by teoreticky zvýšil produkci o 54 % **bez jediného nového stroje**.

Druhá strana téže mince: při cíli redukovat počet zaměstnanců o 10 % je to číslo,
které řekne, kolik kapacity tím reálně zmizí.

---

## 3. Co se počítá

Čtyři čísla na stroj a zvolené období:

| Krok | Vzorec | Zdroj |
| --- | --- | --- |
| **Kalendář** | `dny × 24 h` | délka období |
| **Obsazeno směnami** | `computeAvailableHours()` | `MachineWeekShifts`, `CompanyDay` |
| **Naplánováno** | `Σ printOverlapMinutes` přes ZAKAZKA | bloky, `segMap` |
| **Odklepnuto** | totéž, jen přes bloky s `printCompletedAt ≠ null` | bloky |

První tři jsou **existující funkce** — nic nového se nepočítá, jen se poprvé ukáže
celý řetěz místo jednoho poměru na jeho konci.

### 3.1 Čtvrtý krok se NESKRÝVÁ, jen říká přesně, co je

Původní návrh chtěl krok schovat, když pokrytí `printCompletedAt` klesne pod 50 %.
**Zamítnuto:** skrývání dat pod prahem je jen další tichý ořez — přesně to, co tahle
řada etap odstraňuje — a ten práh by se navíc volil od oka.

Řeší to formulace, ne práh. Řádek se nejmenuje „odklepnuto", jako by šlo o vyrobené
hodiny, ale **„potvrzeno tiskařem"**, a jeho procento se vztahuje k **naplánovaným
hodinám**, ne ke kalendáři:

> potvrzeno tiskařem **287 h** · 84 % naplánovaných hodin

Při pokrytí 6 % pak řádek říká „tiskaři nepotvrzují", ne „nevyrobili jsme nic". Číslo
je poctivé při jakémkoli pokrytí a nic se neschovává.

### 3.2 Co kaskáda NEbude počítat

**Ne TEEP jako jedno číslo.** TEEP = OEE × utilizace, a OEE potřebuje data ze stroje
(rychlost, makulatura), která aplikace nemá a mít nemá. Kaskáda dává **jmenovatele
a mezikroky**, tedy tu část, která jde poctivě spočítat. Heidelberg vlastní OEE už umí
— průmyslový průměr ~20 %, XL 106 Push-to-Stop ~27 % — a je to rozhodnutí o integraci
Prinectu, ne o vývoji.

**Ne benchmark.** Report neukáže žádnou cílovou hodnotu. Publikované normativy jsou
buď kalkulační (bvdm `Nutzungsgrad` 86–88 % je podklad pro hodinovou sazbu, ne měřený
výkon), nebo z jiného odvětví. Ukázat vedle vlastního čísla cizí konstantu by svádělo
k závěrům, které data neunesou.

---

## 4. Jak to bude vypadat

Nová sekce **VYUŽITÍ KALENDÁŘE** v Retrospektivě, pod VÝROBOU.

> Nesmí se jmenovat „KAPACITA" — tak se jmenuje sekce ve **Výhledu** a znamená něco
> jiného. Dvě stejnojmenné sekce na dvou záložkách jsou přesně ten zmatek, který R3
> odstraňovala. Vodorovný pás na stroj —
každý krok jako podíl kalendáře, aby byly ztráty vidět jako plochy, ne jako čísla
v tabulce:

```
XL 105 · období 1.–31. 8. (744 h kalendáře)

 kalendář      ████████████████████████████████████████  744 h
 obsazeno      ██████████████████████░░░░░░░░░░░░░░░░░░  392 h   53 %
 naplánováno   ███████████████████░░░░░░░░░░░░░░░░░░░░░  341 h   46 %
 potvrzeno     ████████████████░░░░░░░░░░░░░░░░░░░░░░░░  287 h   39 %   ·  84 % naplánovaných
 
 nevyužitý kalendář  352 h  =  víkendy 208 h  ·  odstávky 24 h  ·  neobsazené směny 120 h
```

**Poslední řádek je pointa celé sekce** a rozpad na tři části je jeho jádro:

| Část | Co to je | Kdo o tom rozhoduje |
| --- | --- | --- |
| **víkendy** | soboty a neděle bez směn | vedení — otázka nákladů na víkendový provoz |
| **odstávky** | `CompanyDay` — datované celozávodní zavření | vedení, plánované dopředu |
| **neobsazené směny** | **pracovní dny, kdy směna neběží** | **tohle je to číslo** |

Třetí řádek je jediný, který jde zvednout bez nové investice a bez víkendů — a dnešní
report ho neukazuje nikde. CAM-I model tenhle rozpad nazývá rozdílem mezi *idle*
(rozhodnutí vedení) a *nonproductive* (věc provozu); jsou to **různé adresy
odpovědnosti**, a proto nesmí splynout do jednoho čísla.

---

## 5. Co se NEmění

Žádné existující číslo. Kaskáda je nová sekce, která používá funkce, jež už report
volá — `computeAvailableHours` a `printOverlapMinutes`. Karta „Vytížení" zůstává jak je,
protože odpovídá na jinou otázku (naplněnost plánu vůči obsazeným směnám).

**Kontrolní panel, stavový pás ani Výhled se nedotýkají.**

---

## 6. Rizika

**Kaskáda může ukázat nepříjemné číslo.** Když vyjde, že obsazujeme 50 % kalendáře,
je to argument proti nákupu stroje — a pro debatu o směnách. To je smysl toho čísla,
ne jeho vada. Zmiňuji to proto, že spec, který nepočítá s tím, že výsledek může být
nepohodlný, se pak ohýbá.

**Lazy seeding `MachineWeekShifts`.** Řádky vznikají, až někdo týden otevře v administraci.
Týden bez řádku vypadá jako nulová kapacita — a v kaskádě by se to projevilo jako
„neobsazeno", i když jde jen o nevyplněný rozvrh. Na dev je řádků 735 na stroj (~14 let),
takže tam problém není; **na produkci se to musí ověřit dřív, než se sekce nasadí**.
Když se ukáže mezera, kaskáda musí umět říct „rozvrh chybí" místo „neobsazeno".

**Období volí uživatel**, takže kalendář je délka období × 24 h. U období „Dnes" to dá
24 h a kaskáda bude vypadat divně. Návrh: sekce se **nevykresluje pro období kratší
než týden** a řekne proč.

---

## 7. Rozhodnuto (17. 8. 2026)

1. **Žádný práh pokrytí.** Čtvrtý krok se ukazuje vždy, jen se jmenuje „potvrzeno
   tiskařem" a jeho procento je z naplánovaných hodin. Viz §3.1.
2. **Staví se hned.** První tři kroky produkční měření nepotřebují. **Před nasazením**
   se ale musí ověřit pokrytí `MachineWeekShifts` na produkci — je to jediná věc,
   která by kaskádu donutila lhát (týden bez řádku = nulová kapacita = vypadá jako
   neobsazeno, přestože jde jen o nevyplněný rozvrh).
3. **Retrospektiva, sekce „VYUŽITÍ KALENDÁŘE".**

---

## 8. Hotovo, když

- [ ] kaskáda ukazuje čtyři kroky na stroj s podílem kalendáře
- [ ] čtvrtý krok se jmenuje „potvrzeno tiskařem" a jeho procento je z NAPLÁNOVANÝCH hodin
- [ ] nevyužitý kalendář je rozpadlý na víkendy · odstávky · neobsazené směny
- [ ] sekce se nejmenuje „KAPACITA" (kolize s Výhledem)
- [ ] sekce se nekreslí pro období kratší než týden a řekne proč
- [ ] žádné existující číslo se nezměnilo
- [ ] celá sada testů zelená, `tsc --noEmit` bez chyby
