# Design: Monitor u stroje (tiskařská domovská obrazovka)

**Datum:** 2026-08-10
**Autor:** Vojta + Claude (brainstorm)
**Stav:** Návrh k odsouhlasení
**Souvislosti:** `2026-08-03-tlacitko-hotovo-tiskar-design.md`, `docs/KIOSK_TERMINAL.md`, artefakt s vizuálem (varianta B)

---

## 1. Kontext a problém

Tiskař u stroje vidí dnes na `/` **stejnou plánovací timeline jako plánovač** — svislou
osu času přes 6 dní se všemi bloky. 3. 8. 2026 se v ní zvětšilo tlačítko Hotovo, což
vyřešilo velikost cíle, ale ne to hlavní: **obrazovka je stavěná na plánování, ne na
obsluhu stroje.** Tiskař musí svou zakázku na ose najít, přestože ho zajímá jen „co
běží teď, co je další a jak jsem na tom se směnou".

Řešením je **Monitor** — domovská obrazovka, kde je běžící zakázka velká a hlavní akce
je jedna. Timeline zůstává dostupná, ale ustupuje o krok zpět.

### Revize dřívějšího rozhodnutí

Specifikace `2026-08-03-tlacitko-hotovo-tiskar-design.md` §2 uvádí samostatnou obrazovku
Monitor jako **vědomý ne-cíl**, protože by znamenala druhou úroveň přepínání nad
kioskovým launcherem (Sběr dat ↔ Plánování). **10. 8. 2026 Vojta rozhodl jinak** a
námitka se řeší návrhem navigace v §3.1: Monitor není rovnocenná záložka, ale domovská
obrazovka, ze které se do plánu **odbočuje a vrací**. Do staré specifikace se doplní
odkaz sem.

## 2. Rozhodnutí (odsouhlasená 10. 8. 2026)

| Otázka | Rozhodnutí |
| --- | --- |
| Podoba | **Varianta B** — vlevo běžící zakázka, vpravo fronta dneška |
| Navigace | Monitor je domov; plán za tlačítkem „Celý plán →", zpět šipkou |
| Když nic neběží | Ukázat nejbližší zakázku s odpočtem, **tlačítko Hotovo aktivní** |
| Split zakázka | Velká karta jen pro vlastní stroj + štítek se stavem druhé půlky |
| Potvrzování | **Bez potvrzení** (převzato z 3. 8. — akce je vratná, ovládá se myší) |

## 3. Architektura

### 3.1 Kde Monitor žije

`PlannerPage` drží nový stav `tiskarView: "monitor" | "plan"`, výchozí `"monitor"`.
Pro `isTiskar` vykreslí buď `<MonitorView />`, nebo dnešní timeline. Pro ostatní role
se nemění **nic** — větev se jich vůbec netýká.

```
/  (role TISKAR)
├── tiskarView = "monitor"  → MonitorView        ← výchozí po přihlášení
└── tiskarView = "plan"     → dnešní TimelineGrid ← tlačítko „Celý plán →"
```

Přepínání je **asymetrické záměrně**: v Monitoru je tlačítko „Celý plán →", v plánu
šipka „← Monitor". Nejde o dvojici rovnocenných záložek — to byla původní námitka.

Kioskový launcher (`public/vyroba-terminal.html`) se **nemění**.

### 3.2 Co se používá znovu

| Existující kus | Role v Monitoru |
| --- | --- |
| `PrintDoneButton` (`src/components/planner/`) | tlačítko Hotovo — přibude velikost `hero` |
| `TiskarMachineToggle` | přepínač XL105 / XL106 v hlavičce (beze změny) |
| `OrderSearchSheet` | hledání zakázky (beze změny) |
| `getSplitChipState`, `findSplitPartner` (`src/lib/splitHelpers.ts`) | štítek druhé půlky |
| `handlePrintComplete` v `PlannerPage` | odklepnutí — stejná cesta jako dnes |
| SSE v `PlannerPage` (`block:print-completed` aj.) | živá aktualizace z jiných stanic |
| `machineLabel` (`src/lib/machines.ts`) | popisek stroje |
| Prague helpery (`src/lib/dateUtils.ts`) | „dnešek" jako civilní pražský den |

Monitor **nenačítá vlastní data** — bloky už `PlannerPage` v paměti má a udržuje je
aktuální přes SSE. Žádný nový fetch, žádný nový časovač (`now` už tiká po 60 s).

### 3.3 Čistá logika — `src/lib/monitorView.ts`

Rozhodovací pravidla jdou mimo React, aby šla pokrýt unit testy (stejný vzor jako
`tiskarBlockView.ts` z 3. 8.).

```ts
/** Která zakázka má být velká na Monitoru, a proč. */
export type HeroPick = {
  block: Block;
  reason: "running" | "overdue" | "upcoming";
} | null;

export function pickHeroBlock(blocks: Block[], machine: string, now: Date): HeroPick;
export function pickNextBlock(blocks: Block[], machine: string, now: Date): Block | null;
export function todayQueue(blocks: Block[], machine: string, now: Date): Block[];
export function runProgress(block: Block, now: Date): { percent: number; remainingMinutes: number };
```

**`pickHeroBlock` — priorita (důležité):**

1. **`running`** — ZAKÁZKA na stroji, `startTime <= now < endTime`, neodklepnutá.
   Při více kandidátech (nemělo by nastat, hlídá overlap guard) vyhrává nejdřívější start.
2. **`overdue`** — žádná neběží, ale je tu **neodklepnutá zakázka, které už uplynul
   čas** (`endTime <= now`) a od jejího konce **neuplynulo víc než 16 hodin**.
   Vezme se ta s nejpozdějším koncem.

   > Okno se počítá od **konce zakázky**, ne podle toho, jestli začala „dnes".
   > Původní návrh vázal `overdue` na pražský den startu a tím shodil noční směnu:
   > zakázka 22:00–6:00 by v 8:00 ráno z Monitoru zmizela, protože „nezačala dnes"
   > (nález review 10. 8., rozhodnuto Vojtou). 16 hodin pokryje celou noční směnu
   > a zároveň zabrání tomu, aby týden zapomenutá zakázka blokovala Monitor.
3. **`upcoming`** — jinak nejbližší budoucí neodklepnutá zakázka (i zítřejší).

Bod 2 je přídavek nad rámec původního zadání a je záměrný: bez něj by zakázka, kterou
tiskař zapomněl odklepnout, z Monitoru **zmizela** ve chvíli, kdy jí vyprší čas — a
tiskař by ji musel hledat v plánu. To je přesně to, čemu se vyhýbáme. Realita u stroje
se od plánu liší a odklepnutí typicky přijde později než naplánovaný konec.

**`todayQueue`** — zakázky na daném stroji, jejichž `startTime` padá do **civilního
pražského dne** hodnoty `now`, seřazené podle `startTime`. Bez rezervací a údržby.

**`runProgress`** — `percent` ořezaný na 0–100; `remainingMinutes` může být **záporné**
(blok přetahuje), UI to zobrazí jako „přetahuje o X min".

### 3.4 Komponenta — `src/components/monitor/MonitorView.tsx`

Named export, klientská komponenta. **Nesmí jít do `PlannerPage`** — ta má 3273 řádků
a už dnes hlásí ESLint `max-lines`.

Props (vše zvenčí, komponenta nic nenačítá):

```ts
type Props = {
  blocks: Block[];
  viewMachine: string;        // stroj, na který se tiskař dívá
  ownMachine: string | null;  // jeho vlastní stroj — řídí, jestli smí odklepnout
  now: Date;
  onPrintComplete: (blockId: number, completed: boolean) => Promise<void>;
  onOpenPlan: () => void;
  onOpenSearch: () => void;
  onMachineChange: (machine: string) => void;
  onSelectBlock: (block: Block) => void;  // otevře detail
};
```

Rozvržení (od 1024 × 768 nahoru, poměr ~1,45 : 1):

- **Hlavička** — logo · `TiskarMachineToggle` · hodiny · Najít · **Celý plán →** · Odhlásit
- **Levý sloupec** — štítek stavu (`TEĎ BĚŽÍ` / `PŘETAHUJE` / `ZAČÍNÁ ZA…`), číslo
  zakázky, popis, specifikace, štítky (OBÁLKA/VNITŘKY, archy, série, stav dat a
  materiálu, Pantone), časová osa s postupem, štítek druhé půlky u splitu, a dole
  **tlačítko Hotovo ve velikosti `hero`**
- **Pravý sloupec** — `Dnes na <stroj>`: řádky fronty; odklepnuté ztlumené se zeleným
  háčkem, právě běžící zvýrazněný. Řádek je klikací → `onSelectBlock` (detail bloku)

## 4. Chování

**Odklepnutí** jde stejnou cestou jako dnes (`handlePrintComplete` → `POST
/api/blocks/[id]/complete`). Bez potvrzení. Po odklepnutí se Monitor sám překreslí na
další zakázku, protože `pickHeroBlock` už tu odklepnutou nevybere.

**Tlačítko jen na vlastním stroji.** Když si tiskař přepne na druhý stroj, Monitor
ukazuje jeho data, ale tlačítko Hotovo se skryje — stejné pravidlo, jaké dnes platí
v timeline (`PlannerPage` předává `onPrintComplete` jen pro vlastní stroj).

**Prázdný stav.** Když `pickHeroBlock` vrátí `upcoming`, karta ukáže zakázku, odpočet
do startu a **aktivní tlačítko Hotovo**. Když nevrátí nic (na stroji nic není),
zobrazí se prostý text „Na tomhle stroji nic naplánováno".

**Split.** Velká karta je vždy jen pro vlastní stroj. Pod časovou osou přibude štítek
`XL 105 · hotovo 11:58` (nebo `· čeká od 12:00`) z `getSplitChipState`.

**Živá aktualizace.** Když odklepne někdo jiný nebo plánovač změní plán, přijde SSE,
`PlannerPage` aktualizuje `blocks` a Monitor se překreslí sám.

## 5. Dotčené soubory

| Soubor | Změna |
| --- | --- |
| `src/lib/monitorView.ts` | **nový** — čistá logika |
| `src/lib/monitorView.test.ts` | **nový** — unit testy |
| `src/components/monitor/MonitorView.tsx` | **nový** — obrazovka |
| `src/components/monitor/MonitorQueue.tsx` | **nový** — pravý sloupec (drží MonitorView štíhlý) |
| `src/components/planner/PrintDoneButton.tsx` | přidat velikost `hero` |
| `src/app/_components/PlannerPage.tsx` | stav `tiskarView`, přepnutí větve pro `isTiskar`, tlačítko zpět v hlavičce plánu |
| `docs/superpowers/specs/2026-08-03-…-design.md` | poznámka, že ne-cíl „Monitor" byl 10. 8. revidován |

Bez zásahu: API, Prisma schéma, migrace, kioskový launcher, role mimo `TISKAR`.

## 6. Ověření

1. `npm run build` — bez TypeScript chyb.
2. `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts` — celá suite zelená, nové testy `monitorView` procházejí.
3. Ruční průchod jako `TISKAR`:
   - po přihlášení naskočí Monitor, ne timeline
   - běžící zakázka je velká, tlačítko Hotovo funguje a po kliknutí se Monitor přepne na další
   - zakázka po termínu a neodklepnutá zůstane velká (stav `PŘETAHUJE`), nezmizí
   - mimo pracovní dobu se ukáže další zakázka s odpočtem a tlačítko jde zmáčknout
   - fronta vpravo ukazuje jen dnešek a jen daný stroj; hotové jsou ztlumené
   - „Celý plán →" otevře timeline, šipka zpět vrátí Monitor
   - přepnutí na druhý stroj: data se změní, tlačítko Hotovo zmizí
   - split zakázka ukáže štítek se stavem druhé půlky
4. Světlý i tmavý režim.
5. Přihlášení jako `PLANOVAT` — planner beze změny.

## 7. Rizika

- **`PlannerPage` u limitu.** Monitor musí být samostatný soubor; do `PlannerPage`
  přibude jen stav a přepnutí větve (odhad pod 30 řádků).
- **„Dnešek" přes půlnoc — pouze u fronty.** Noční směna končí v 6:00, takže po
  půlnoci se fronta vpravo přepne na nový den a ranní část směny v ní bude sama.
  Vědomě přijato — alternativa (fronta podle směny) je složitější a nikdo ji nežádal.
  **Velké karty se to netýká**, ta jede na 16hodinovém okně od konce (§3.3).
- **Priorita `overdue` může být překvapivá.** Když tiskař nechá starou zakázku
  neodklepnutou, bude na Monitoru viset, i když už fyzicky tiskne další. Je to
  záměrné (nutí to k odklepnutí), ale při ověření se na to podívat.
- **Tlačítko `hero` v `PrintDoneButton`.** Komponenta se rozšiřuje, ne kopíruje —
  ať nevznikne čtvrtá varianta tlačítka mimo jediný zdroj vzhledu.

## 8. Ne-cíle

- Změna kioskového launcheru nebo přidání záložky do něj.
- Automatické párování odklepnutí mezi Logicou a plánem (budoucí vize).
- Monitor pro jiné role než `TISKAR`.
- Pás směny v měřítku času (varianta C) — lze doplnit později nad hotové B.
- Odstranění timeline z tiskařského režimu.
