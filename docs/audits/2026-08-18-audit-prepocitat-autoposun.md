# Audit: „Přepočítat" → autoposun bez čísla a bez undo

Datum: 18. 8. 2026 · Podnět: Vojta — *„někdy tím přepočítáním může vzniknout autoposun,
což není nutně špatně, ale neukáže mi to kolik bloků se kvůli tomu posune a pak na to
už nefunguje ani undo."*
Stav: **prozkoumáno, neopraveno.** Měřeno na testovací instanci nad kopií produkčních dat.

---

## 1. Závěr

Obě poloviny stížnosti platí a jsou doložené kódem i měřením. Navíc jsou horší, než jak
zněly:

- **Číslo dopadu server VRACÍ, klient ho zahodí.** Není to chybějící funkce, je to
  zahozená informace.
- **Undo nejenže nefunguje — je zavádějící.** Reflow se do historie nezapisuje vůbec,
  takže Ctrl+Z po přepočtu tiše vrátí **předchozí, nesouvisející** akci.

Data se ale ztratit nemůžou: každý odsunutý blok má řádek v `BlockRevision` se společným
`groupId`, takže `scripts/revert-revision-group.ts` je umí vrátit. Náprava existuje, jen
je ruční a mimo aplikaci.

## 2. Měření na reálných datech (simulace, bez zápisu)

Hypotetická, zcela běžná změna: **XL 105, odpolední 22:00 → 20:00, po–pá**, týden 17. 8.
Spočítáno lokálně čistými funkcemi `blockCalendarDrift` + `computeChainPush` nad daty
z testovací instance:

| Zakázka | Posun konce | Odsune bloků | Nejdál do |
| --- | --- | --- | --- |
| 18580/1 | +2,0 h | **20** | 21. 8. 2026 |
| 18778 | +2,0 h | 10 | 21. 8. 2026 |
| 18580/6 | +2,0 h | 5 | 21. 8. 2026 |
| 17310/1 | +2,0 h | 0 | — |

Jedno kliknutí na „Přepočítat" u první zakázky tedy pohne **dvaceti bloky**. Uživatel se
dozví: *„Blok přepočítán podle aktuálního kalendáře."*

**Důležité pro interpretaci:** tenhle výpočet šel udělat **na klientovi, z dat, která
planner už má**. Náhled dopadu tedy není otázka nové infrastruktury.

## 3. Zjištění po jednotlivých vrstvách

### 3.1 Před akcí — potvrzení buď chybí, nebo mluví o jiném čísle

| Cesta | Potvrzení | Co říká |
| --- | --- | --- |
| Hromadné „Přepočítat" nad strojem (`TimelineGrid.tsx:1276`) | `window.confirm` | *„Přepočítat N bloků na XL 105? Bloky se posunou na nejbližší platné sloty (zamčené se přeskočí)."* — `N` je počet **rozejitých** bloků, ne počet těch, které se posunou. V měření výše: N = 4, reálně se hne přes 30. |
| Adresné „Přepočítat" v detailu bloku (`BlockDetail.tsx:345-362`) | **žádné** | jedno kliknutí, žádný dotaz |

Ani jedna hláška nezmiňuje, že se posunou **navazující** zakázky.

### 3.2 Po akci — server pošle číslo, klient ho zahodí

- Hromadná cesta: endpoint vrací `movedCount` (`api/blocks/reflow/route.ts:75-79`).
  `handleReflowMachine` (`PlannerPage.tsx:2099-2103`) ho **nepoužije** — toast hlásí jen
  `reflowed` a `skipped`.
- Adresná cesta: endpoint vrací pole `moves` (`api/blocks/[id]/reflow/route.ts:61-85`).
  `handleReflowBlock` (`PlannerPage.tsx:2126-2135`) je promítne do stavu, ale **počet
  neuvede**.

Kontrast: ruční přetažení bloku hlásí *„Posunuto 87 navazujících bloků — zkontroluj
timeline."* (`PlannerPage.tsx:1150`). Aplikace ten vzor má, reflow ho nepoužívá.

### 3.3 Undo — nezapisuje se, a tím mate

`recordUndo` se volá u editace, přesunu, mazání i vkládání (`PlannerPage.tsx` na deseti
místech), ale **u `handleReflowMachine` ani `handleReflowBlock` ne**.

Důsledek není „Ctrl+Z nic neudělá", ale horší: `undo()` v `useUndoManager.ts` vezme
**poslední záznam zásobníku**. Po přepočtu je jím ta akce, která reflow předcházela —
Ctrl+Z tedy tiše vrátí něco jiného, než co uživatel právě viděl měnit.

K tomu: zásobník je **jen v paměti**, strop `MAX_HISTORY = 30`
(`useUndoManager.ts:5`), takže refresh stránky ho vymaže celý.

### 3.4 Chain push u zakázky nemá strop

- Rigidní blok (rezervace, údržba) má horizont `MAX_RIGID_PUSH_MS` = **7 dní**
  (`overlapResolver.ts:39`).
- Zakázka horizont **nemá** — v kódu doslova *„Zakázka horizont nemá, u ní je to skutečné
  selhání"* (`overlapResolver.ts:161`).
- Okno načtených bloků je **90 dní** za kotvou (`overlapResolver.server.ts:89-91`).

Tahle asymetrie není nikde obhájená a je to táž vlastnost, která 17. 8. v 16:31 pustila
kaskádu 87 bloků až do poloviny září.

### 3.5 Co naopak funguje — data jsou zachranitelná

Chain push zapisuje posuny přes `tx.block.update` (`overlapResolver.server.ts:242`)
uvnitř transakce obalené `withRevision` (obě reflow routy jsou v tabulce
`revisionWiring.test.ts:58-59`). Každý odsunutý blok tedy má řádek v `BlockRevision`
se společným `groupId`, plus auditní řádek `AUTO_SHIFT` per blok
(`reflow.server.ts:168-182`).

`scripts/revert-revision-group.ts --group <groupId>` to umí vrátit (dry-run bez
`--apply`). To je dnes jediná fungující cesta zpět — ruční, mimo aplikaci, a člověk o ní
musí vědět.

## 4. Návrh nápravy, seřazeno podle poměru cena/účinek

1. **Doplnit počet do hlášky po akci** (nejlevnější, hodiny práce). Server čísla už
   posílá. „Přepočteno 4 bloky, **odsunuto 31 navazujících**." U adresné cesty totéž
   z `moves.length`. Uzavře půlku stížnosti okamžitě a nemění žádné chování.
2. **Náhled PŘED akcí** (§2 dokládá, že je spočitatelný na klientovi). U adresné cesty
   dotaz *„Přepočítat 18580/1? Odsune 20 navazujících bloků, nejdál do 21. 8."*,
   u hromadné součet přes všechny. Bez toho je i potvrzený souhlas neinformovaný.
3. **Zapsat reflow do historie** (`recordUndo`). Endpointy vracejí nový stav bloku
   i `moves`; aby šel krok vrátit, musí odpověď nést i **původní** hodnoty (server je
   v `AppliedMove` má — `oldStartTime`/`oldEndTime`). Tím zmizí i to, že Ctrl+Z dnes
   vrací cizí akci.
4. **Strop chain pushe u zakázky** — parita se 7 dny u rigidních bloků, nebo strop na
   počet posunutých. Při překročení 409 + potvrzení. Jedno místo
   (`resolveChainPushFromDb`) kryje všech šest zápisových cest, tedy i ruční přetažení,
   které způsobilo havárii 16:31.

Body 1–3 jsou o **informovanosti a vratnosti** a nemění, co aplikace dělá. Bod 4 mění
chování a zaslouží si vlastní rozhodnutí.

## 5. Co tenhle audit NEŘEŠIL

Undo pro reflow na serveru (endpoint „vrať revizní skupinu" jako funkce aplikace místo
skriptu) — to je samostatná etapa, v backlogu specu kaskádové vlny jako bod 4.
