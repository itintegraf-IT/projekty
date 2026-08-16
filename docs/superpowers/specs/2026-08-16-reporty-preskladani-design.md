# Reporty R3 — Přeskládání stránky

**Datum:** 16. 8. 2026
**Navazuje na:** R1 (správnost čísel) · R2 (tokeny a čitelnost)
**Podklad:** `docs/audits/2026-08-16-reporty-pruzkum-metrik.md`
**Vizuální návrh:** https://claude.ai/code/artifact/4a80d403-051c-4346-9307-a1a388e12c79

---

## 1. Proč

R1 srovnala čísla, R2 je udělala čitelnými. Zbývá poslední vrstva: **stránka má 16 KPI karet a nikde neodpovídá na otázku, se kterou ji člověk otevírá — „musím dnes něco řešit?"**

Tři konkrétní vady rozvržení:

- **Není hierarchie.** Čtyři nesourodé karty nahoře (dva stroje, průtok, lead time), pak sekce. Kdo chce vědět, jestli je něco v nepořádku, musí přečíst všechno.
- **Tiché ořezy.** Heatmapa bere `dailyCapacity.slice(0, 14)`, ačkoli API vrací celé zvolené období — při měsíčním pohledu **zmizí 17 dní bez jediné zmínky**. Totéž `upcomingMaintenance.slice(0, 5)`. Kontrolní panel přiznaný strop řeší od etapy z 13. 8. („Zobrazeno X z Y"), report na to zapomněl.
- **Dlaždice jsou koncová čísla.** „Přeplánováno o 26 h" a dál nic — nedá se s tím nic udělat bez otevření jiné obrazovky.

Průzkum sedmi konkurenčních nástrojů to potvrdil: **prakticky každá dlaždice Prinectu vede na seznam zakázek.** Je to nejlevnější zlepšení použitelnosti v celém průzkumu — nulová nová data.

---

## 2. Co se NEmění

**Žádné číslo se nesmí změnit.** R3 mění rozvržení a přidává navigaci; výpočty zůstávají přesně takové, jaké je nastavila R1.

**Kontrolní panel se nedotýká.** Prošel vlastní etapou 13. 8.

**Nepřidávají se nové metriky.** Průzkum jich našel sedm spočitatelných z dnešních dat (OTD, kalibrace normy, kaskáda kapacity, připravenost, podíl IML, …) — všechny patří do **R4** a mají vlastní blokující krok: změřit vyplněnost `deadlineExpedice` a `jobPresetId` na produkci. Míchat je do rozvržení, které ještě není postavené, by spojilo dvě nezávislá rozhodnutí.

---

## 3. Stavový pás

Nový pás nad záložkami, na obou datových záložkách. Vypisuje **jen položky vyžadující pozornost**, každou s odkazem tam, kde se řeší. Když je klid, řekne to jednou větou.

### 3.1 Proč vlastní endpoint

Pás **není vázaný na zvolené období** — že je XL 106 příští týden přeplánovaný, platí i při pohledu na minulý měsíc. A má být i na Retrospektivě, která si výhledová data nestahuje.

Nový **`GET /api/report/attention`**. Je to jediný kus R3, který přidává serverovou plochu.

```ts
type AttentionItem = {
  key: string;                       // stabilní id položky, pro React klíč
  severity: "bad" | "warn";
  title: string;                     // tučná část věty
  detail: string;                    // zbytek věty
  when: string;                      // pravý sloupec — rozsah dat nebo doba čekání
  href: string;                      // kam vede odkaz
  linkLabel: string;                 // text odkazu
};
type AttentionResponse = { checkedAt: string; items: AttentionItem[] };
```

Věty skládá **server**, ne klient — jinak by se pravidla rozešla mezi místy, která je vyhodnocují, a místy, která je vypisují. Táž chyba, jakou měla legenda heatmapy před R2.

### 3.2 Zdroje položek a prahy

| Zdroj | Podmínka | Závažnost |
| --- | --- | --- |
| Přeplánovaný stroj | `overbookedHours > 0` ve výhledu na 30 dní dopředu | `bad` |
| Čekající rezervace | `SUBMITTED` starší než **3 dny** | `warn` |
| Nálezy Kontrolního panelu | `total > 0` | `bad` |
| Nespočtené kontroly | `uncomputed > 0` | `warn` |

Prahy jsou návrh, ne dogma — Vojta je u otázek označil za věc k doladění po prokliku. Musí být **na jednom místě v kódu jako pojmenované konstanty**, ne rozeseté v podmínkách.

**Horizont přeplánování je 30 dní dopředu**, nezávisle na zvoleném období. Bez pevného horizontu by pás hlásil něco jiného podle toho, co má člověk zrovna vybrané — a to je přesně ta vlastnost, kterou nemá mít.

### 3.3 Prázdný stav

Není to chybějící obsah, ale odpověď:

> ✓ **Nic nevyžaduje pozornost.** Oba stroje v kapacitě, žádná rezervace nečeká déle než 3 dny, kontroly bez nálezu.

Věta se skládá z týchž zdrojů jako položky — když se přidá nový zdroj, musí se objevit i tady. Hlídá to test.

---

## 4. Přeskládání

### 4.1 Retrospektiva

| Dnes | Po |
| --- | --- |
| 4 karty nahoře: Vytížení ×2, Průtok, Lead time | **VÝROBA**: Vytížení ×2 (hodiny v podtitulku) + Údržba · denní graf |
| VÝROBA: graf + Údržba ratio + Produkce ×2 | **PRŮCHOD ZAKÁZEK**: Průtok · Lead time |
| PLÁNOVÁNÍ: 4 karty + žebříček | **PLÁNOVÁNÍ**: Zásahy · Posunuté bloky · Stabilita · Přihlášení |
| OBCHOD: pipeline | **OBCHOD**: beze změny |

**Karty „Produkce XL 105/106" se ruší** — hodiny jdou do podtitulku karty Vytížení (`341,2 z 392,0 h dostupných`), kde dávají větší smysl, protože jsou vidět vedle procenta, které z nich vzniklo.

**Žebříček „Aktivita plánovačů" se ruší** (rozhodl Vojta). Počet uložení není výkon — kdo řeší jednu složitou přestavbu, má jedno uložení; kdo šťouchá bloky, desítky. Jmenovitý žebříček se přitom čte jako hodnocení lidí. Souhrnná čísla o zásazích a stabilitě zůstávají.

**„Přihlášení za období" ZŮSTÁVÁ** — Vojta z rušení vybral jen duplicitní karty.

### 4.2 Výhled

| Dnes | Po |
| --- | --- |
| 4 karty: Kapacita ×2, Volné hod. ×2 | **KAPACITA**: Kapacita ×2 (volné hodiny v podtitulku) |
| Heatmapa 14 dní | Heatmapa **celé období** |
| RIZIKA: údržby (5) \| počty rezervací | RIZIKA: údržby **s přiznaným stropem** \| **seznam rezervací s čísly zakázek** |

**Karty „Volné hod." se ruší.** Duplicita — v kódu už je u `freeHoursValue` poznámka, že je R3 ruší. Podtitulek karty Kapacita nese `34,2 h volných z 392,0 h`, u přeplánovaného stroje `přeplánováno o 26,4 h`.

---

## 5. Heatmapa na celé období

`slice(0, 14)` mizí. Mřížka pojme celý zvolený rozsah.

| Šířka dlaždice | Chování |
| --- | --- |
| ≥ 22 px | číslo v dlaždici (dnešní stav) |
| < 22 px | číslo jen v `title`; dlaždice nese barvu |

Práh se počítá z `days.length`, ne z měření DOM — report se nesmí rozejít mezi serverovým a klientským renderem. Při velmi dlouhém období (vlastní rozsah přes několik měsíců) se mřížka posouvá vodorovně **uvnitř vlastního kontejneru** (`overflow-x: auto`), nikdy nesmí posouvat stránku.

Legenda zůstává, jak ji nastavila R2 — protahuje zástupné procento touž funkcí `heatToneFor`, jakou kreslí mřížka, takže se od ní nemůže rozejít.

---

## 6. Rizika se stanou akčními

### 6.1 Plánované údržby

Zůstává strop 5, ale **přiznaný**: `Zobrazeny 3 z 7 nejbližších údržeb.` Věta se vykresluje jen když je co skrývat (`total > shown`), stejně jako `Truncated` v Kontrolním panelu.

### 6.2 Rezervace čekající na zpracování

Místo dvou karet s počty **seznam** — číslo zakázky, popis, doba čekání:

```
25-1043   Alimpex — IML etikety      čeká 5 dní
25-1051   Nowaco — kartonáž          čeká 3 dny
25-1055   Bidfood — IML              čeká 1 den
2 nové · 1 ve frontě k plánování
```

**Vyžaduje změnu API**: `pendingReservations` dnes vrací jen `{ newCount, queueCount, oldestWaitingDays }`. Přibude `items: Array<{ id, orderNumber, description, waitingDays, status }>`, strop 5 s přiznaným zbytkem.

Rozsah zůstává týž — otevřené rezervace jsou stav k dnešku, nezávislý na období, jak to R1 nastavila a jak to říká popisek.

---

## 7. Prokliknutí z dlaždic

Nejlevnější zlepšení z průzkumu. Každá dlaždice, za kterou stojí množina zakázek, na ni vede.

**Ověřeno v kódu: `/` umí JEDINÝ parametr — `?highlight=<blockId>`** (`src/app/page.tsx:13`, `:49`). A ani ten není skok na blok: id se přeloží na `orderNumber` a předá plánovači jako **textový filtr**. `machine` ani `date` neexistují.

Rozsah prokliků se tím zmenšuje na to, co reálně funguje:

| Dlaždice / řádek | Vede na | Stav |
| --- | --- | --- |
| Řádek plánované údržby | `/?highlight=<blockId>` | ✅ funguje |
| Řádek čekající rezervace | `/rezervace` | ✅ funguje |
| Položka stavového pásu | `href` ze serveru (jedna z výše uvedených cest) | ✅ funguje |
| Vytížení / Kapacita stroje | filtr na stroj | ❌ **parametr neexistuje** |
| Dlaždice heatmapy | plán na konkrétní den | ❌ **parametr neexistuje** |
| Průtok zakázek | množina zakázek, není kam vést | ❌ mimo dosah |

**Kde odkaz nevede na nic konkrétního, se nedělá.** Mrtvý odkaz je horší než žádný — přesně to řeší `canJump` v `IntegrityRow`, který u prázdného `orderNumber` a u neplatného stroje odkaz záměrně nenabízí. Totéž pravidlo platí tady.

**Doplnění parametrů `machine` a `date` do `/` NENÍ součástí R3.** Znamenalo by to sáhnout na `PlannerPage.tsx`, který nemá žádné pokrytí testy (známé riziko od etapy atomického undo), kvůli navigační vymoženosti v reportu. Nepoměr rizika a užitku. Zapsáno jako kandidát na samostatnou drobnou etapu — až se na plánovač bude sahat z jiného důvodu.

---

## 8. Odsazovací škála

Odloženo z R2, protože se čekalo přesně na tohle rozvržení. Dnes je v `/reporty` **19 různých hodnot paddingu**.

| Krok | px | Kde |
| --- | --- | --- |
| `xs` | 4 | těsné vnitřky chipů |
| `sm` | 8 | řádky seznamu |
| `md` | 12 | vnitřek panelu |
| `lg` | 16 | vnitřek karty |
| `xl` | 24 | mezera mezi sekcemi |

Doplní se do `src/lib/reportTokens.ts` jako `reportSpace` a strážný test rozšíří o kontrolu, že v `/reporty` nezůstal holý `padding:` s číslem — stejně jako dnes hlídá `fontSize` a `borderRadius`.

---

## 9. Dotčené soubory

| Soubor | Co |
| --- | --- |
| `src/app/api/report/attention/route.ts` | **nový** — zdroj stavového pásu |
| `src/lib/attentionItems.ts` | **nový** — čisté skládání položek a prahy jako konstanty |
| `src/lib/attentionItems.test.ts` | **nový** — prahy, prázdný stav, pokrytí zdrojů |
| `src/components/report/AttentionBand.tsx` | **nový** — pás (do `src/components/`, ne inline) |
| `src/app/api/report/dashboard/route.ts` | `pendingReservations.items` |
| `src/app/reporty/_components/ReportDashboard.tsx` | přeskládání, heatmapa, rizika, prokliky |
| `src/app/reporty/_components/PlanningSection.tsx` | zrušení žebříčku |
| `src/app/reporty/_components/KpiCard.tsx` | volitelný `href` |
| `src/lib/reportTokens.ts` | `reportSpace` |

`ReportDashboard.tsx` má dnes ~700 řádků a ESLint u něj hlásí `max-lines`. Přeskládání ho zvětší. **Součástí etapy je vytáhnout `RetroView` a `OutlookView` do vlastních souborů** — konvence projektu to vyžaduje („než přidáš do souboru u limitu, nejdřív navrhni extrakci").

---

## 10. Rizika

**Stavový pás je nová serverová cesta.** Musí mít `requireRole` uvnitř `try` a `AppError` v catch, jako každá jiná route.

**Pás nesmí shodit stránku, když jeho fetch selže.** Kontrolní panel to řeší tím, že selhání jedné kontroly neshodí zbylých sedm; pás musí být stejně defenzivní — když nedojede, stránka se vykreslí bez něj.

**Heatmapa na 31 dní se musí vejít i na užší obrazovku.** Vodorovný posun uvnitř kontejneru, ne stránky.

**Zrušené karty nesou data, která jinam nepřenáším.** „Produkce XL 105" a „Volné hod." mizí — jejich hodnoty musí být v podtitulcích, jinak se informace ztratí. Hlídat při prokliku.

---

## 11. Hotovo, když

- [ ] stavový pás je na obou datových záložkách a je nezávislý na zvoleném období
- [ ] prázdný stav vypisuje větu, ne prázdno
- [ ] heatmapa pokrývá celé zvolené období; nikde není tichý ořez
- [ ] údržby i rezervace přiznávají, kolik položek skrývají
- [ ] rezervace mají čísla zakázek
- [ ] každý vygenerovaný odkaz někam vede
- [ ] v `/reporty` nezůstal holý `padding:` s číslem
- [ ] `ReportDashboard.tsx` je rozdělený a pod `max-lines`
- [ ] **žádná hodnota na stránce se nezměnila**
- [ ] celá sada testů zelená, `tsc --noEmit` bez chyby
