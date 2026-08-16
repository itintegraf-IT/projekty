# Reporty R2 — Tokeny a čitelnost

**Datum:** 16. 8. 2026
**Navazuje na:** `2026-08-14-reporty-spravnost-cisel-design.md` (R1 — správnost čísel)
**Následuje:** R3 — přeskládání stránky

---

## 1. Proč

R1 srovnala čísla. Tahle etapa řeší, že **správné číslo je k ničemu, když ho není vidět**.

Stránka `/reporty` obchází designové tokeny na 23 místech napevno zapsanou barvou a používá 12 velikostí písma a 12 poloměrů. Není to kosmetika — změřeno:

| Co | Kontrast (světlý režim) | Požadavek | |
| --- | --- | --- | --- |
| `--brand` jako barva písma | **1,22 : 1** | 4,5 : 1 | prakticky neviditelné |
| `#3fb950` na KPI kartě (26 px) | 2,34 : 1 | 3,0 : 1 | pod AA i pro velké písmo |
| `#f0883e` na KPI kartě (26 px) | 2,33 : 1 | 3,0 : 1 | pod AA |
| bílé číslo na červené dlaždici | 3,35 : 1 | 4,5 : 1 | pod AA |
| bílé číslo na zelené dlaždici | 2,54 : 1 | 4,5 : 1 | pod AA |
| bílé číslo na oranžové dlaždici | 2,53 : 1 | 4,5 : 1 | pod AA |
| bílé číslo na modré dlaždici | 3,68 : 1 | 4,5 : 1 | pod AA |

Barvy dlaždic jsou napevno, takže **čísla v heatmapě jsou nečitelná v obou režimech**, ne jen ve světlém.

Dvě věci navíc:

- **Legenda heatmapy vypisuje `#f85149` dvakrát** — pro „nad 100 %" i „pod 50 %". Odliší je jen rámeček, který jsem do R1 dal výslovně jako provizorium („aniž by se do R1 tahala nová barva").
- **Série grafu se liší jen odstínem.** Modrá `#3b82f6` a oranžová `#f0883e` mají jasový poměr 1,45 : 1 — v odstínech šedi splynou.

`--brand` jako text postihuje **5 míst a všechna jsou v /reporty**, mimo jiné odkazy „Otevřít v plánu →" v Kontrolním panelu, tedy funkci dokončenou před dvěma dny. Táž vada je na dvou místech mimo /reporty (`BlockEdit`, `MonitorChips`) — Vojta rozhodl zahrnout je.

**`PlanningSection.tsx` je čistá** (jen tokeny). Nepořádek je soustředěný v `ReportDashboard.tsx` a `HealthPanel.tsx`.

---

## 2. Co se NEmění

Tahle etapa **nesahá na rozvržení stránky ani na žádné číslo**. Žádná sekce se nepřesouvá, neruší ani nepřidává — to je R3. Jediná vizuální změna rozměru je výška dlaždic heatmapy (24 → 28 px), a to jen proto, aby se do nich vešlo čitelné číslo.

**Padding se nesjednocuje.** Dnes je 19 různých hodnot. Zavádět odsazovací škálu teď znamená sáhnout na každý řádek dvakrát — jednou tady a podruhé v R3, kde se rozvržení stejně mění. Odkládá se do R3 vědomě.

---

## 3. Paleta

Všechny hodnoty jsou **naměřené, ne odhadnuté**. Kritéria:

- text ≥ 4,5 : 1 vůči nejtěsnějšímu podkladu, na kterém se reálně vyskytuje (`--surface`, `--bg`, `--surface-2`);
- výplň grafu ≥ 3,0 : 1 vůči kartě (WCAG 1.4.11, netextový obsah);
- dvě série grafu odlišitelné i po simulaci deuteranopie a protanopie (ΔOKLab ≥ 0,12).

### 3.1 Nové tokeny — světlý režim

| Token | oklch | hex | jako text | číslo na výplni |
| --- | --- | --- | --- | --- |
| `--brand-text` | `oklch(0.48 0.14 102)` | `#6e5e00` | 5,39 : 1 | 6,42 : 1 |
| `--status-bad` | `oklch(0.50 0.20 25)` | `#bb061e` | 5,60 : 1 | 6,67 : 1 |
| `--status-ok` | `oklch(0.48 0.13 152)` | `#007136` | 5,14 : 1 | 6,12 : 1 |
| `--status-warn` | `oklch(0.50 0.14 70)` | `#945000` | 5,17 : 1 | 6,15 : 1 |
| `--status-idle` | `oklch(0.50 0.05 250)` | `#4d667f` | 5,01 : 1 | 5,97 : 1 |
| `--series-a` | `oklch(0.45 0.17 262)` | `#194cb1` | — | 6,46 : 1 vůči kartě |
| `--series-b` | `oklch(0.62 0.15 60)` | `#c66c00` | — | 3,49 : 1 vůči kartě |
| `--status-on` | `#ffffff` | | | barva čísla na syté výplni |
| `--type-zakazka` | `oklch(0.46 0.15 262)` | `#2552aa` | 6,70 : 1 | 4,74 : 1 na pilulce |
| `--type-rezervace` | `oklch(0.46 0.17 310)` | `#75329d` | 7,15 : 1 | 5,00 : 1 na pilulce |
| `--type-udrzba` | `oklch(0.43 0.14 150)` | `#00631f` | 6,84 : 1 | 4,81 : 1 na pilulce |

### 3.2 Nové tokeny — tmavý režim

| Token | oklch | hex | jako text | číslo na výplni |
| --- | --- | --- | --- | --- |
| `--brand-text` | alias `var(--brand)` | `#f8e100` | 12,34 : 1 | 14,85 : 1 |
| `--status-bad` | `oklch(0.70 0.19 25)` | `#ff645f` | 5,65 : 1 | 6,80 : 1 |
| `--status-ok` | `oklch(0.76 0.17 152)` | `#47cf79` | 8,19 : 1 | 9,85 : 1 |
| `--status-warn` | `oklch(0.80 0.15 75)` | `#f5ae39` | 8,63 : 1 | 10,38 : 1 |
| `--status-idle` | `oklch(0.70 0.04 250)` | `#8ca1b7` | 6,18 : 1 | 7,44 : 1 |
| `--series-a` | `oklch(0.62 0.16 262)` | `#4e82e5` | — | 4,44 : 1 vůči kartě |
| `--series-b` | `oklch(0.82 0.14 65)` | `#ffb059` | — | 9,08 : 1 vůči kartě |
| `--status-on` | `oklch(0.145 0 0)` | `#0a0a0a` | | barva čísla na syté výplni |
| `--type-zakazka` | `oklch(0.74 0.15 262)` | `#75a9ff` | 7,57 : 1 | 5,33 : 1 na pilulce |
| `--type-rezervace` | `oklch(0.74 0.17 310)` | `#cb89fa` | 7,26 : 1 | 5,16 : 1 na pilulce |
| `--type-udrzba` | `oklch(0.74 0.15 150)` | `#5ac576` | 8,24 : 1 | 5,70 : 1 na pilulce |

### 3.3 Nález při měření: `--danger`, `--success` a `--info` selhávají taky

Při psaní strážného testu vyšlo najevo, že vada není jen u `--brand`. Ve **světlém** režimu jako barva písma:

| Token | `--surface` | `--bg` | `--surface-2` |
| --- | --- | --- | --- |
| `--danger` | 3,74 : 1 | 3,91 : 1 | **3,42 : 1** |
| `--success` | 3,04 : 1 | 3,18 : 1 | **2,78 : 1** |
| `--info` | 4,45 : 1 | 4,65 : 1 | **4,07 : 1** |

Všechny tři jsou pod AA a všechny tři Kontrolní panel používá jako text — červené číslo nálezu, zelené „✓ 0", chybová hláška. V tmavém režimu jsou v pořádku (4,79 – 8,58 : 1). Komentář u `--info` v `globals.css` tvrdí, že token vznikl právě proto, aby byl čitelný jako písmo; měření říká, že se to nepovedlo docela.

**Řešení bez dalších tokenů:** stavová čtveřice se pojmenuje podle **závažnosti**, ne podle pásem heatmapy — `--status-bad` / `--status-ok` / `--status-warn` / `--status-idle`. Slouží pak obojímu: dlaždici heatmapy i „tady je problém" v Kontrolním panelu. `heatToneFor` jen mapuje procenta na tuhle čtveřici.

Kdyby se místo toho zavedly sourozenci `--danger-text` a `--success-text` (jak to udělal `--warning-text`), vznikly by dvě jména pro tutéž tmavě červenou a tmavě zelenou. Dvě jména pro jednu hodnotu je přesně to, co se za rok rozejde.

**`--danger` a `--success` jako PODKLAD zůstávají** (odznak, pilulka, `color-mix`) — tam jsou v pořádku a nic se na nich nemění.

**Mimo `/reporty` se vada neopravuje.** Táž trojice se jako text používá i v planneru, Monitoru a admin sekci. Sáhnout na ně plošně znamená změnit vzhled celé aplikace, což je vlastní etapa, ne přílepek k reportu. Strážný test proto **stav zapíše jako tvrzení** (stejný trik jako u `--brand`): jakmile je někdo opraví, test spadne a vynutí si vědomé rozhodnutí. Do té doby je fakt aspoň v kódu, ne jen v paměti.

**Proč jedna rodina pro text i výplň:** ve světlém režimu je stavová barva tmavá, takže funguje jako písmo na světlé kartě **i** jako podklad pod bílým číslem. V tmavém režimu je světlá, takže funguje jako písmo na tmavé kartě **i** jako podklad pod tmavým číslem. `--status-on` se převrací spolu s režimem. Dvě rodiny tokenů (zvlášť text, zvlášť výplň) by nepřinesly nic než osm tokenů místo pěti.

**Série grafu:** ΔOKLab mezi A a B je 0,372 (světlý) / 0,355 (tmavý); po **opravené** simulaci deuteranopie 0,354 / 0,365, protanopie 0,298 / 0,303 — všechno vysoko nad prahem 0,12. Modrá vs. jantarová je kanonická bezpečná dvojice a jako jediná z palety obstála i po opravě matematiky (viz §3.4).

### 3.4 Rámeček u „nad 100 %" ZŮSTÁVÁ

Vojta u volby heatmapy uvedl, že rámeček „může zmizet, barva stačí sama". **Měření říká, že nestačí** — a po opravě simulace (viz níž) je to horší, než jsem tvrdil původně.

Nejtěsnější dvojice dlaždic po simulaci deuteranopie a protanopie:

| dvojice | světlý | tmavý |
| --- | --- | --- |
| `bad` / `warn` | **0,004** | 0,112 |
| `bad` / `ok` | **0,059** | 0,057 |
| `ok` / `warn` | **0,059** | 0,065 |
| `ok` / `idle` | 0,111 | 0,130 |

Práh, který si etapa uložila u sérií grafu, je 0,12. Škála červená · jantarová · zelená ho neplní **v žádné z těchto dvojic** — a nejde to spravit volbou odstínů, protože všechny tři leží na téže konfuzní ose. Spravitelné je to jedině opuštěním semaforové škály, což byla volba B, kterou Vojta odmítl (a právem: „zelená = dobře" je okamžitě čitelné pro drtivou většinu).

**Proto barva není nositelem hodnoty — číslo v dlaždici ano.** Každá barevná dlaždice se vykresluje s číslem, takže WCAG 1.4.1 („barva není jediný prostředek") je splněné. Rámeček dostává navíc jediný stav, který volá po okamžitém zásahu; u něj se nespoléháme ani na to, že si člověk to číslo přečte. Kreslí ho `--status-on`, ne `--text` — na vlastní výplni dá 6,67 : 1 místo 2,71 : 1, tedy nad prahem 3 : 1 pro netextový obsah.

> **Původní čísla v tomhle odstavci (0,022 / 0,106) byla neplatná.** Simulace barvosleposti v `contrast.ts` kombinovala LMS matici z jedné metody s projekčními koeficienty z druhé. Vracela barvy, ne chybu, a rozdíly mezi tokeny vycházely řádově podobně, takže to prošlo. Odhalil to až invariant „šedá zůstane šedá" (rozbitá verze dělala z bílé azurovou) při závěrečné revizi 16. 8. 2026. Ten invariant je od té doby v `contrast.test.ts`.

---

## 4. Heatmapa

| Stav | Dnes | Po |
| --- | --- | --- |
| stroj nejede (`null`) | `--surface-3`, bez čísla | beze změny |
| 0 % | `--surface-2`, bez čísla | beze změny |
| pod 50 % | `#f85149` **červená** | `--status-idle` modrošedá |
| 50–79 % | `#f0883e` | `--status-warn` |
| 80–100 % | `#3fb950` | `--status-ok` |
| nad 100 % | `#f85149` + rámeček | `--status-bad` + rámeček |
| číslo v dlaždici | `#fff` (2,53–3,68 : 1) | `--status-on` (5,97–10,38 : 1) |
| výška dlaždice | 24 px, číslo 8 px | 28 px, číslo 10 px |

Legenda pak vypisuje pět různých čtverečků místo dnešních čtyř různých a jednoho zdvojeného.

**„Pod 50 % je modrošedá, ne červená"** je věcná oprava, ne jen barevná: nevytížený den není havárie stejného řádu jako přeplánovaný. Dnešní stránka je varuje stejně naléhavě.

---

## 5. Škály

### 5.1 Písmo — `reportTypeScale`

Podlaha **10 px** (rozhodl Vojta). Ze současných 12 velikostí zbude 7.

| Krok | px | Kde |
| --- | --- | --- |
| `xs` | 10 | popisky os, legendy, čísla v dlaždicích |
| `sm` | 11 | popisky KPI, drobný meta text |
| `base` | 12 | běžný text, hlavičky sekcí |
| `md` | 13 | odkazy, položky seznamů |
| `lg` | 14 | název karty kontroly |
| `hero` | 22 | souhrnné číslo Kontrolního panelu |
| `display` | 26 | hodnota KPI karty |

Mimo škálu zůstávají **dvě velikosti piktogramu** (16 px v kolečku 32 px, 20 px v kolečku 42 px). Nejsou to stupně písma, ale rozměr vázaný na průměr kolečka — v modulu jsou jako `glyph: { sm: 16, lg: 20 }` s komentářem.

Reálná změna je tedy **jen 8 → 10 a 9 → 10** na pěti místech. Ostatní hodnoty už na škálu sedí. Etapa je proto vizuálně klidná; roste jen to, co bylo pod podlahou.

### 5.2 Poloměry — `reportRadius`

Ze současných 12 hodnot (2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 999) zbude 5.

| Krok | px | Kde | Nahrazuje |
| --- | --- | --- | --- |
| `xs` | 3 | čtverečky legendy, dlaždice | 2, 3, 4 |
| `sm` | 6 | chipy, malá tlačítka | 5, 6 |
| `md` | 8 | tlačítka, vstupy (shoda s `uiStyles.ts`) | 8 |
| `lg` | 10 | karty | 9, 10, 11, 12 |
| `pill` | 999 | odznaky | 999 |

---

## 6. Strážný test

**Tohle je hlavní trvalá hodnota etapy.** V repu dnes není žádný test, který by kontrast měřil — proto mohl `--brand` na 1,22 : 1 přežít, proto se `--warning` musel odhalit až ručně při Kontrolním panelu a proto se do heatmapy dostala čtveřice barev, na kterých bílé číslo nikdy nefungovalo.

`src/lib/contrast.ts` — čistý modul: OKLCH → sRGB, relativní jas, kontrastní poměr, simulace deuteranopie/protanopie (Viénot), vzdálenost v OKLab.

`src/lib/reportTokens.test.ts` — **čte skutečný `src/app/globals.css`**, ne kopii hodnot. Pro každý tokenový pár tvrdí:

1. každý `--status-*`, `--brand-text`, `--info`, `--danger`, `--success`, `--warning-text` má ≥ 4,5 : 1 vůči `--surface`, `--bg` i `--surface-2`, v obou režimech;
2. každý `--status-*` má ≥ 4,5 : 1 vůči `--status-on` téhož režimu;
3. `--series-a` i `--series-b` mají ≥ 3,0 : 1 vůči `--surface`;
4. `--series-a` a `--series-b` jsou po simulaci deuteranopie i protanopie od sebe ≥ 0,12 ΔOKLab;
5. `--brand` **není** dost kontrastní jako text ve světlém režimu — test to tvrdí **schválně**, aby bylo v kódu zapsané, proč `--brand-text` existuje. Kdyby někdo `--brand` ztmavil, test spadne a donutí ho oba tokeny sjednotit vědomě.

Bod 5 je pojistka proti tichému rozejití, ne kontrola kvality. Stejný trik, jaký hlídá `blockColumns.ts` proti schématu.

---

## 7. Dotčené soubory

| Soubor | Co |
| --- | --- |
| `src/app/globals.css` | 8 nových tokenů ve světlé i tmavé větvi, s komentářem u každého |
| `src/lib/contrast.ts` | **nový** — měřicí modul |
| `src/lib/reportTokens.ts` | **nový** — `reportTypeScale`, `reportRadius`, `heatStatusFor()` |
| `src/lib/reportTokens.test.ts` | **nový** — strážný test nad `globals.css` |
| `src/app/reporty/_components/ReportDashboard.tsx` | 19 literálů → tokeny, škála, heatmapa, legenda |
| `src/app/reporty/_components/HealthPanel.tsx` | 3× `--brand` → `--brand-text`, chipy typu, škála |
| `src/app/reporty/_components/IntegrityRow.tsx` | odkaz → `--brand-text`, škála |
| `src/app/reporty/_components/KpiCard.tsx` | škála |
| `src/components/BlockEdit.tsx` | 1 řádek — štítek „Zamčený blok" |
| `src/components/monitor/MonitorChips.tsx` | 1 řádek — chip „wait" na `--warning-text` |

### Chipy typu bloku v `HealthPanel` — a jedna nalezená nesrovnalost

`TYPE_CHIP` drží `#1a6bcc` / `#7c3aed` / `#c0392b` jako podklad s bílým textem. Naměřeno: bílá na nich dává 4,81 / 5,24 / 5,00 : 1 ve světlém režimu, ale **3,43 / 3,15 / 3,30 : 1 v tmavém** — tam jsou pod AA.

Při hledání správných odstínů vyšlo najevo víc: **v plánu je údržba zelená** (`blockStyles.ts`, `UDRZBA.accentBar = #22c55e`), **v Kontrolním panelu červená**. Týž typ bloku má dvě barvy podle toho, na které obrazovce se člověk dívá — a červená k tomu v celém zbytku aplikace znamená „problém".

Proto tři vyhrazené tokeny s odstíny podle plánovače (modrá 262 / fialová 310 / zelená 150), ne převzetí `--series-a` nebo `--status-ok`. Sdílet token mezi „série grafu A" a „zakázka" by ušetřilo řádek v CSS a stálo srozumitelnost. Chip se překlopí na `color-mix(in oklab, <token> 22 %, transparent)` s písmem z téhož tokenu — vzor, který už používají `HealthBadge` i `MonitorChips`.

### Tečky pipeline rezervací

Osm stavů má dnes osm napevno zapsaných barev. Nebudou to čtyři nové tokeny navíc — stavy se mapují na **existující stavovou čtveřici podle významu**: čeká na zásah → `--status-warn`, rozpracované → `--status-idle`, úspěšné → `--status-ok`, zamítnuté → `--status-bad`, stažené → `--text-muted`.

Tečka pak nese informaci (skupinu stavu), ne jen dekoraci. Identitu stavu drží popisek vedle ní, který tam už je.

---

## 8. Rizika

**Monitor u stroje je produkční obrazovka.** Změna `MonitorChips` je jednořádková, ale ta obrazovka visí u tiskového stroje. Před nasazením proklik.

**Zelená a oranžová ztmavnou.** Ve světlém režimu byly dosud světlé a špatně čitelné; nově budou tmavé a čitelné. Vojta uvidí viditelně jinou stránku — je to záměr, ne regrese.

**Nic z toho nemění žádné číslo.** Když se po nasazení liší hodnota, je to chyba téhle etapy, ne vlastnost.

---

## 9. Hotovo, když

- [ ] v `src/app/reporty/` nezůstal žádný hex ani `rgba()` literál kromě `--status-on` v `globals.css`
- [ ] strážný test měří kontrast z `globals.css` a je zelený
- [ ] `--brand` se nikde v repu nepoužívá jako barva písma
- [ ] heatmapa má pět rozlišitelných stavů a legenda je vypisuje všechny
- [ ] žádná hodnota na stránce se nezměnila
- [ ] celá sada testů zelená, `tsc --noEmit` bez chyby
