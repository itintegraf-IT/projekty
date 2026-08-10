# Design: Monitor — ruční výběr zakázky

**Datum:** 2026-08-10
**Autor:** Vojta + Claude (brainstorm)
**Stav:** Návrh k odsouhlasení
**Souvislosti:** `2026-08-10-monitor-u-stroje-design.md`, `2026-08-10-monitor-potvrzeni-odklepnuti-design.md`

---

## 1. Problém

Plánovač navrhne **optimální pořadí** zakázek. Tiskař u stroje ale ví věci, které plán
neví — typicky že na následující zakázku nemá materiál — a proto ji **přeskočí** a pustí
jinou. Monitor to dnes neumožňuje:

- velkou kartu vybírá výhradně automatika (`pickHeroBlock`: běžící → přetahující → nejbližší budoucí),
- klik na řádek ve frontě vpravo tiskaře **vyhodí z Monitoru do plánu** (`jumpToBlockFromMonitor`),
  což je nástroj plánovače, ne obsluhy stroje,
- fronta ukazuje jen **dnešek**, takže když tiskař potřebuje sáhnout po zítřejší
  zakázce, nemá ji odkud vzít.

## 2. Rozhodnutí (odsouhlasená 10. 8. 2026)

| Otázka | Rozhodnutí |
| --- | --- |
| Klik na zakázku ve frontě | Vytáhne ji na **velkou kartu**, žádný skok do plánu |
| „Začít tisknout" v datech | **Nic se nezapisuje** — bez migrace, bez nového pole |
| Rozsah fronty | **Dnešek + zítřek**, oddělené nadpisem |
| Potvrzení u nezačaté zakázky | **Platí dál**, i pro ručně vybranou |

### Proč se nic nezapisuje do databáze

Vojtova úvaha, ověřená v kódu: když tiskař zakázku přeskočí, **zůstane neodklepnutá**,
a jakmile jí uplyne čas, `BlockCard` ji vyhodnotí jako `isOverdue`
(`src/components/planner/BlockCard.tsx:389`) a vykreslí oranžovým stylem `BLOCK_OVERDUE`.
Plánovač tedy přeskočenou zakázku v plánu **uvidí sám od sebe**, bez jakékoli nové značky.

Vědomé omezení: plánovač vidí „tahle není hotová", ne „tiskař ji záměrně přeskočil a jel
místo ní jinou". Kdyby ten rozdíl byl někdy potřeba, je to samostatná etapa se značkou
začátku tisku v databázi — teď ji nestavíme (YAGNI).

## 3. Chování

### 3.1 Výběr

Klik na kterýkoli řádek fronty vytáhne zakázku na velkou kartu se vším, co karta ukazuje
(číslo, popis, specifikace, výrobní štítky, stav dat a materiálu, Pantone, split partner).
Tlačítko HOTOVO pak platí **pro ni**.

Výběr je čistě věc obrazovky — nikam se neukládá a po reloadu je pryč.

### 3.2 Priorita karty

```
odklepnutá (drží, čeká na „Další →")  →  ručně vybraná  →  automatický výběr
```

Držení po odklepnutí má přednost, protože je to rozdělaná akce. Ruční výběr přebíjí
automatiku, protože tiskař ví víc než plán.

### 3.3 Označení ručního výběru

Když se ručně vybraná zakázka **liší** od té, kterou by navrhla automatika, přibude pod
stavovým štítkem řádek `vybráno ručně` s tlačítkem **zpět na doporučené**. Tiskař se tak
vždycky dostane zpátky k pořadí od plánovače.

Když si vybere právě tu zakázku, kterou automatika navrhuje sama, řádek se nezobrazí —
nemá co označovat.

### 3.4 Stav ručně vybrané zakázky

Štítek nad kartou se počítá **z času vybrané zakázky**, ne z toho, jak ji vybral plán:

| Situace | Štítek |
| --- | --- |
| čas zakázky právě běží | `TEĎ BĚŽÍ` |
| čas už uplynul a není odklepnutá | `PŘETAHUJE` |
| ještě nezačala | `ZAČÍNÁ …` |
| je odklepnutá | `✓ ODKLEPNUTO` (karta nabídne Vrátit / Další) |

Šestnáctihodinové okno (`OVERDUE_WINDOW_MS`) se na ruční výběr **nevztahuje** — to je
pravidlo pro automatický výběr, ne pro zobrazení. Když si tiskař vytáhne týden starou
zakázku, `PŘETAHUJE` je pořád pravdivý popis.

Kliknutí na **odklepnutou** zakázku ve frontě ji zobrazí ve stavu `✓ ODKLEPNUTO`, takže
z Monitoru jde vzít zpět i starší odklepnutí — tím odpadá backlogová položka **M6**.
Chrání ho stávající potvrzení na dvě kliknutí u tlačítka Vrátit.

### 3.5 Potvrzení platí dál

Ručně vybraná zakázka, která ještě nezačala, chce **dvě kliknutí** stejně jako dosud.
Bez toho bychom si znovu otevřeli díru, kvůli které potvrzení vzniklo — tiskař si může
ručně vytáhnout zítřejší zakázku úplně stejně, jako ji dřív dostal automaticky.

### 3.6 Kdy výběr zaniká

| Cesta | Chování |
| --- | --- |
| **Další →** po odklepnutí | zruší držení i výběr → karta se vrátí k automatice |
| **zpět na doporučené** | zruší jen výběr |
| **přepnutí stroje** | zruší výběr (karta patří jinam) |
| zakázka zmizí z dat nebo se přesune na jiný stroj | výběr se zahodí |
| reload | výběr je jen v paměti, takže zaniká |

### 3.7 Fronta

Dva oddíly pod sebou: **Dnes** a **Zítra**, každý s vlastním nadpisem. Řazení podle
začátku, odklepnuté ztlumené se zeleným háčkem, zakázka na kartě zvýrazněná. Prázdný
oddíl se nevykreslí.

Rozsah zůstává u dvou dnů záměrně: delší seznam by se na terminálu špatně procházel
a na vzdálenější zakázky je tlačítko **Najít**.

## 4. Co se nemění

- **Tlačítko Najít** hledá napříč celým plánem, a proto dál skáče do plánu
  (`jumpToBlockFromMonitor`). Fronta je pro nejbližší dva dny, hledání pro zbytek.
- Automatický výběr (`pickHeroBlock`) i šestnáctihodinové okno.
- Chování tlačítka HOTOVO, držení po odklepnutí, potvrzení u Vrátit.
- Karta bloku v plánovací timeline a všechny role mimo `TISKAR`.

## 5. Architektura

### 5.1 Čistá logika — `src/lib/monitorView.ts`

```ts
/** Fronta Monitoru: dnešek a zítřek zvlášť, obojí seřazené podle začátku. */
export function monitorQueue(blocks: Block[], machine: string, now: Date):
  { today: Block[]; tomorrow: Block[] };

/** Ručně vybraná zakázka, nebo null, když výběr přestal platit. */
export function resolveSelectedBlock(blocks: Block[], selectedId: number | null, machine: string): Block | null;

/** Stav zakázky podle jejího času — bez ohledu na to, jak se na kartu dostala. */
export function reasonForBlock(block: Block, now: Date): HeroReason;
```

`monitorQueue` **nahrazuje** dosavadní `todayQueue` (stejná logika, jen rozšířená o zítřek);
její dva testy se převedou.

`reasonForBlock` je záměrně bez šestnáctihodinového okna — viz §3.4.

### 5.2 Komponenty

- `src/components/monitor/MonitorQueue.tsx` — props `{ today, tomorrow, heroId, onSelect }`,
  dva oddíly s nadpisy.
- `src/components/monitor/MonitorView.tsx` — nový stav `selectedId`, priorita karty dle §3.2,
  řádek „vybráno ručně", zánik výběru dle §3.6.
- `src/app/_components/PlannerPage.tsx` — prop `onSelectBlock` na `MonitorView` **zanikne**;
  výběr si řeší Monitor sám. `jumpToBlockFromMonitor` zůstává pro `OrderSearchSheet`.

## 6. Ověření

1. `npm run build`, `npx tsc --noEmit`, `npm run lint` bez chyb.
2. Celá test suite zelená včetně nových testů `monitorView`.
3. Ruční průchod jako `TISKAR`:
   - klik na zakázku ve frontě ji vytáhne na kartu a **nevyhodí do plánu**,
   - objeví se `vybráno ručně` + `zpět na doporučené`, které vrátí automatiku,
   - HOTOVO odklepne vybranou zakázku, ne tu doporučenou,
   - ručně vybraná zítřejší zakázka chce dvě kliknutí,
   - klik na odklepnutou zakázku ukáže `✓ ODKLEPNUTO` a jde ji vrátit,
   - fronta má oddíly Dnes a Zítra,
   - přepnutí stroje výběr zruší,
   - **Najít** dál skáče do plánu,
   - přihlášení jako `PLANOVAT` — planner beze změny.

## 7. Ne-cíle

- Značka začátku tisku v databázi (§2).
- Výběr, který přežije reload nebo se sdílí mezi stanicemi.
- Změna chování tlačítka Najít.
- Fronta delší než dva dny.
