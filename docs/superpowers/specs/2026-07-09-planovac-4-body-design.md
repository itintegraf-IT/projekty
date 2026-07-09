# Design: 4 body z auditu e-mailu plánovače (15, 17, 18, 19)

Datum: 2026-07-09 · Stav: schváleno Vojtou (chat) · Navazuje na audit e-mailu Lukáše Lukeše ze 4. 6. 2026.

## Kontext

Audit e-mailu plánovače proti stavu repa identifikoval 4 otevřené body:

| Bod | Požadavek | Dnešní stav |
| --- | --- | --- |
| 15 | Popis zakázky viditelný i při odzoomovaném nadhledu | Popis se zobrazuje od 24 px výšky bloku (FULL ≥48, COMPACT 44–47, TINY 24–43); pod 24 px („micro tečky") nic |
| 17 | Ctrl+X → Ctrl+V split bloku ztrácí vazbu na skupinu | Cut+paste = POST nový blok + DELETE originálu; `splitGroupId` se nepřenáší, ztrácí se i historie auditu a vazba na rezervaci. Stejná třída chyby ve skupinovém cut (lasso Ctrl+X) |
| 18 | U rozdělených bloků zobrazit celkový čas všech částí | ✂2/5 chip existuje (TimelineGrid ~1533, 1587), součet času nikde |
| 19 | Pásy pozadí ranní/odpolední/noční směna | CSS třídy `tl-morning/afternoon/night` existují (globals.css:262–269), ale nikde se neaplikují; funguje jen střídání dnů (`tl-day-alt`) |

Schválená rozhodnutí (AskUserQuestion, 2026-07-09):
1. Bod 17: cut = **PUT přesun** (ne POST+DELETE s přenosem splitGroupId).
2. Bod 18: **chip + detail + tooltip** (všechna tři místa).
3. Bod 19: **fixní časy směn 6–14–22** (ne dynamické hranice z provozu).
4. Bod 15: **jednořádkový MICRO text režim od ~14 px** (pod 14 px zůstávají tečky).

## Bod 17 — Cut+paste jako přesun (PUT), ne smazat+vytvořit

### Jednoblokový cut (Ctrl+X → Ctrl+V)

`handlePasteWithTarget` (PlannerPage.tsx ~2492): když `isCutRef.current === true`, místo POST `/api/blocks` + DELETE zdroje poslat **PUT `/api/blocks/${src.id}`** s:

```
{ machine: target.machine, startTime: newStart.toISOString(),
  endTime: newEnd.toISOString(),                    // fallback, server přepočítá
  ...(isZakazka ? { printMinutes: blockPrintMinutes(src) } : {}),
  bypassScheduleValidation: !workingTimeLockRef.current,
  resolveChain: true }
```

- Identická serverová cesta jako drag — `validateAndComputeEnd`, chain push, audit UPDATE.
- Zachová se samo od sebe: `splitGroupId`, historie auditu, vazba na rezervaci, tiskařské poznámky, ✂ chip, `locked` stav.
- Response zpracovat jako u dragu (updated blok + `shifted` sousedé → `handleBlockUpdate`).
- **Undo:** `buildMoveCommand` (before = původní pozice + odsunutí sousedé, after = nové) — stejný vzor jako drag. Ne `buildCreateCommand`.
- **Ctrl+C (kopie) beze změny** — kopie je záměrně nový nezávislý blok bez `splitGroupId`.
- **Guardy:** vytištěný (`printCompletedAt`) a zamčený (`locked`) blok nevyjmout — toast při Ctrl+X (dnes žádný guard není; server by PUT stejně odmítl, ale UI má selhat srozumitelně a dřív).
- Po úspěchu: `setCopiedBlock(null)`, `setIsCut(false)` (dnešní chování po cut-paste zachovat).

### Skupinový cut (lasso Ctrl+X → Ctrl+V)

`handleGroupPasteWithTarget` (PlannerPage.tsx ~2599): když `isGroupCutRef.current === true`, místo N× POST + N× DELETE provést **batch přesun** (`POST /api/blocks/batch` — stejná cesta jako lasso drag): každý blok na `target.machine` s offsetem zachovaným vůči anchoru (dnešní sémantika skupinového paste — vše na cílový stroj — zůstává).

- ZAKAZKA bloky posílají `printMinutes` (etapa 4 konvence), snap start-only.
- Undo: `buildMoveCommand` (batch vzor).
- Skupinová **kopie** (Ctrl+C) beze změny — POST nových bloků bez `splitGroupId`.
- Rollback logika POSTů se pro cut větev nepoužije (batch je transakční na serveru).

### Co se nemění

- Queue drop (`handleQueueDrop`) — položky fronty nejsou split bloky, `splitGroupId` se jich netýká.
- Right-click „Vložit zde" — volá tytéž `handle*PasteWithTarget`, opraví se automaticky.

## Bod 18 — Celkový čas split skupiny

1. **Čistý helper** `splitGroupTotalPrintMinutes(siblings: Block[]): number` v `src/lib/printTimeClient.ts` — Σ `blockPrintMinutes()` přes členy skupiny (tiskové minuty, konzistentní s etapou 5–7). Unit testy v `printTimeClient.test.ts`.
2. **Chip na bloku:** rozšířit `✂{part}/{total}` na `✂{part}/{total} · {Σ}h` (FULL/COMPACT/TINY, TimelineGrid ~1533 a ~1587). Výpočet u `splitSiblings` (~3865), předat novým propem `splitTotalMinutes?: number`. Formát: celé hodiny „27h", půlhodiny „27,5h".
3. **BlockEdit** (~719, má `splitGroup`): hlavička „✂ Část 2 / 5 · celkem 27 h tisku".
4. **BlockDetail** (má `allBlocks` prop): u split bloku řádek „Celkem skupina: 27 h tisku (5 částí)".
5. **Hover tooltip bloku** (TimelineGrid ~1916): přidat řádek „Skupina: Σ 27 h (5 částí)" pro `splitTotal > 1`.

## Bod 19 — Pásy směn na pozadí

V dayshade smyčce (TimelineGrid ~3668–3687), pro každý **pracovní** den (stejný guard jako `tl-day-alt`: `!d.isWeekend && !d.isCompanyDay`, ale KAŽDÝ den, ne jen lichý):

- `tl-night` pás 0:00–6:00 a 22:00–24:00,
- `tl-afternoon` pás 14:00–22:00,
- ranní 6:00–14:00 je v CSS `transparent` → div se nevykresluje (úspora DOM).

Hranice z `SHIFT_HOURS` v `src/lib/shifts.ts` (MORNING 6–14, AFTERNOON 14–22, NIGHT 22–6) — žádná magická čísla. Pozice: `top = d.y + hodina × (slotHeight × 2)`. `pointerEvents: "none"`, stejná vrstva jako `tl-day-alt` — alfa pozadí se vrství (alt-den zůstane o odstín tmavší, dle Lukášova přání „každý druhý den + směny").

## Bod 15 — MICRO text režim (14–23 px)

Nový výškový mód v BlockCard (TimelineGrid ~1064–1066):

```
const MODE_MICRO_TEXT = !MODE_FULL && !MODE_COMPACT && !MODE_TINY && layoutHeight >= 14;
```

Render: jediný řádek `{orderNumber} · {description}` — font 8 px, `whiteSpace: nowrap`, ellipsis, bez chipů, bez badge (PO DEADLINE/KALENDÁŘ zůstávají skryté pod TINY jako dnes, řádek ~1210). Zámek/hourglass ikonky vynechat (nevejdou se čitelně). Pod 14 px beze změny (tečky).

## Testování (goal: 100% jistota, multi-agent kontrola)

1. Unit testy `splitGroupTotalPrintMinutes` + celá suite (366 testů) zelená.
2. `npm run build` + `npm run lint` po každé etapě.
3. Vizuální ověření na běžící appce (dev server, screenshoty): pásy směn, MICRO text, Σ chip.
4. Funkční scénář bodu 17 na dev DB: split blok → cut části → paste jinam → `splitGroupId` zachován, audit ukazuje UPDATE (ne CREATE+DELETE); cut root části; regrese: cut obyčejného bloku, copy split bloku (nesmí zdědit skupinu), skupinový cut, undo obou cest.
5. Multi-agent review implementace z více úhlů (korektnost, regrese, best practices) + fix wave.

## Pořadí implementace

19 → 15 → 18 → 17 (od nejizolovanějšího k nejcitlivějšímu; každá etapa samostatně buildnutelná a commitnutelná).

## Mimo scope

- Zbylé body auditu (undo na statusy, DTP fulltext, text poznámky na bloku) — samostatné featury.
- Serverový atomický split endpoint (vědomý v2 backlog z etapy 8).
