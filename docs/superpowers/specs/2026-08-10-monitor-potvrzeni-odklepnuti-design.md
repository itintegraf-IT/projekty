# Design: Monitor — potvrzení odklepnutí a ochrana budoucí zakázky

**Datum:** 2026-08-10
**Autor:** Vojta + Claude (brainstorm)
**Stav:** Návrh k odsouhlasení
**Souvislosti:** `2026-08-10-monitor-u-stroje-design.md` (základní Monitor), backlog M6 a M9

---

## 1. Problém

Nález z testování Monitoru na běžící aplikaci (Vojta, 10. 8. 2026):

> Zmáčknu HOTOVO, karta hned přeskočí na další zakázku — a tu můžu odklepnout taky,
> přestože se ještě netiskla a začíná třeba za 27 hodin.

Nejde o jednu chybu, ale o **tři rozhodnutí, která se sečetla**:

1. **Tlačítko je aktivní i u budoucí zakázky.** Spec `2026-08-10-monitor-u-stroje-design.md`
   §2: *„Když nic neběží → ukázat nejbližší zakázku s odpočtem, tlačítko Hotovo aktivní."*
   Zdůvodnění bylo „realita se od plánu liší, tiskař může skončit dřív" — to platí pro
   zakázku za dvacet minut, ne za sedmadvacet hodin. Pravidlo ten rozdíl nerozlišovalo.
2. **Karta po odklepnutí okamžitě přeskočí na další zakázku.** Zámek 800 ms (nález I2
   závěrečné kontroly) chrání jen před **nechtěným** dvojklikem, ne před druhým vědomým
   kliknutím do stejného místa.
3. **Z Monitoru nejde odklepnutí vzít zpět** — backlogová položka **M6**. Oklika přes
   frontu a plán existuje, ale nefunguje, když tiskař netuší, že něco odklepl špatně.

Dohromady: dvě kliknutí označí za hotové dvě zakázky, z nichž jedna se ještě netiskla,
a tiskař to nemá jak vrátit.

## 2. Rozhodnutí (odsouhlasená 10. 8. 2026)

| Otázka | Rozhodnutí |
| --- | --- |
| Co po odklepnutí | Karta **zůstane** na odklepnuté zakázce s tlačítky **Vrátit** a **Další →** |
| Automatický přechod | **Ne** — karta čeká vždy na kliknutí, nikdy se nepřepne sama |
| Budoucí zakázka | Jde odklepnout, ale **s potvrzením na dvě kliknutí** |
| Běžící a přetahující | Beze změny — jedno kliknutí, bez potvrzování |

**Vědomě zamítnutá pojistka:** návrh, aby se karta přepnula sama, jakmile se na stroji
rozeběhne jiná zakázka. Vojta zvolil předvídatelnost. Důsledek je zapsaný v §6.

## 3. Stav „odklepnuto" na velké kartě

Po úspěšném odklepnutí zůstane karta na téže zakázce a přepne se do stavu `completed`:

- zelený rám karty, kicker **`✓ ODKLEPNUTO`**,
- pod popisem řádek **`✓ Hotovo 15:20`** (čas přes `formatPragueTime`),
- místo velkého tlačítka HOTOVO **dvě tlačítka vedle sebe**:
  **`Vrátit`** (neutrální, `--surface-3`) a **`Další →`** (výrazné, `--brand`).

### 3.1 Jak se z toho stavu vyjde

Karta se vrátí k běžnému výběru (`pickHeroBlock`) jen těmito cestami:

| Cesta | Co se stane |
| --- | --- |
| **Další →** | stav se zahodí, karta ukáže další zakázku dle `pickHeroBlock` |
| **Vrátit** | zavolá `onPrintComplete(id, false)`; stav se zahodí, zakázka se vrátí mezi neodklepnuté a karta ji typicky ukáže znovu jako běžící |
| **přepnutí stroje** | stav se zahodí (karta patří jinému stroji) |
| **zrušení odklepnutí zvenčí** | když blok přes SSE přestane být odklepnutý (nebo z dat zmizí), stav se zahodí — jinak by karta tvrdila „hotovo" o zakázce, která hotová není |
| **reload stránky** | stav žije jen v paměti komponenty, takže se přirozeně zahodí |

Přepnutí Monitor ↔ plán stav **nemaže** — je to jen prohlídka plánu, ne odbavení zakázky.

### 3.2 Ochrana proti dvojkliku zůstává

Velké tlačítko HOTOVO nahradí v témž místě obrazovky dvě menší. Rychlý dvojklik by tedy
druhým kliknutím trefil `Vrátit` nebo `Další →`. Existující zámek (800 ms po odklepnutí)
proto **platí i pro nová tlačítka** — po dobu zámku jsou neaktivní.

## 4. Potvrzení u budoucí zakázky

Když `pickHeroBlock` vrátí `reason === "upcoming"`, chová se velké tlačítko na dvě doby:

1. **první kliknutí** zakázku neodklepne — tlačítko zežloutne (`--warning`) a napíše
   **`ZAČÍNÁ ZÍTRA 6:00 — POTVRDIT`** (den se vypustí, když zakázka začíná dnes),
2. **druhé kliknutí do 5 sekund** ji odklepne a karta přejde do stavu `completed` dle §3,
3. **po 5 sekundách** se tlačítko samo vrátí do klidového stavu.

Potvrzení se **netýká** stavů `running` a `overdue` — tam je odklepnutí očekávaný úkon
a dohoda „bez potvrzování" ze základní specifikace platí dál.

Potvrzovací stav se zruší i při přepnutí stroje nebo když se změní zakázka na kartě.

## 5. Den u budoucí zakázky (backlog M9)

Řádek s odpočtem dnes ukazuje jen `Začíná v 6:00 · za 27 h`. Právě absence data je to,
co umožnilo přehlédnout, jak daleko zakázka je. Nově:

- začíná **dnes** → `Začíná v 14:30 · za 58 min` (beze změny),
- začíná **zítra** → `Začíná zítra v 6:00 · za 27 h`,
- **později** → `Začíná 13. 8. v 6:00 · za 3 dny` (datum přes `formatPragueDateShort`).

## 6. Známé omezení (vědomě přijaté)

Bez automatického přechodu může karta **viset na odklepnuté zakázce libovolně dlouho**.
Scénář: tiskař dotiskne v 15:20, zmáčkne HOTOVO, odejde a na `Další →` nezmáčkne. Ráno
přijde jiný tiskař a vidí zakázku dotištěnou předešlý den.

Vojta to zvolil vědomě kvůli předvídatelnosti (nic se nikdy nepřepne samo). Kdyby to
v provozu vadilo, doplnění pojistky je malá změna: přepnout kartu, jakmile se podle
plánu rozeběhne jiná zakázka.

## 7. Architektura

### 7.1 Čistá logika — `src/lib/monitorView.ts`

```ts
/** Zakázka držená na kartě po odklepnutí, nebo null, když už držení neplatí. */
export function resolveStickyBlock(blocks: Block[], stickyId: number | null): Block | null;

/** „zítra" / „13. 8." pro start mimo dnešek; null, když zakázka začíná dnes. */
export function startDayLabel(startTime: string | Date, now: Date): string | null;
```

`resolveStickyBlock` vrátí blok jen tehdy, když **v datech pořád je** a **pořád je
odklepnutý**. Tím je §3.1 (poslední dva řádky tabulky) vyřešená jedním pravidlem, které
jde pokrýt testy.

`startDayLabel` porovnává civilní pražské dny (`utcToPragueDateStr`), ne rozdíl v hodinách
— „zítra v 6:00" je zítra i v 5:00 ráno, kdy je to za hodinu.

### 7.2 Komponenty

- `src/components/monitor/MonitorView.tsx` — nový stav `stickyId`, `confirmingId`;
  footer karty se rozvětví na tři podoby (normální / potvrzení / odklepnuto).
- `src/components/planner/PrintDoneButton.tsx` — přibude volitelná prop pro **potvrzovací
  podobu** (žluté pozadí `--warning`, vlastní popisek). Karta bloku v plánu ji nepoužívá,
  takže se pro plánovače nic nemění.

Nový footer pro stav `completed` se vykreslí přímo v `MonitorView` jako dvojice tlačítek —
`PrintDoneButton` se do něj netahá, protože jeho `isDone` větev řeší jiný případ (toggle
na kartě bloku v plánu) a mísením obou by vznikla komponenta, která dělá dvě věci.

## 8. Dotčené soubory

| Soubor | Změna |
| --- | --- |
| `src/lib/monitorView.ts` | `resolveStickyBlock`, `startDayLabel` |
| `src/lib/monitorView.test.ts` | testy k oběma |
| `src/components/planner/PrintDoneButton.tsx` | potvrzovací podoba |
| `src/components/monitor/MonitorView.tsx` | stavy `stickyId`/`confirmingId`, tři podoby footeru, den u odpočtu |

Bez zásahu: API, Prisma schéma, migrace, `PlannerPage`, `MonitorQueue`, role mimo `TISKAR`.

## 9. Ověření

1. `npm run build` bez chyb, `npx tsc --noEmit` čisté.
2. Celá test suite zelená, nové testy `monitorView` procházejí.
3. Ruční průchod jako `TISKAR`:
   - odklepnutí běžící zakázky → karta zůstane, ukáže `✓ Hotovo HH:MM` a dvě tlačítka,
   - **rychlý dvojklik na HOTOVO** → odklepne se jen jedna zakázka a nic dalšího se nespustí,
   - `Další →` → karta přejde na následující zakázku,
   - `Vrátit` → odklepnutí se zruší a karta ukáže zakázku zase jako běžící,
   - budoucí zakázka: první kliknutí jen zežloutne s textem a časem startu, druhé odklepne,
   - po 5 s bez druhého kliknutí se tlačítko vrátí do klidu,
   - zakázka zítra/později má u odpočtu den,
   - přepnutí stroje během stavu „odklepnuto" stav zruší,
   - přihlášení jako `PLANOVAT` — planner beze změny.
4. Světlý i tmavý režim (žluté potvrzení i zelený stav „odklepnuto").

## 10. Ne-cíle

- Automatický přechod na další zakázku (§2, vědomě zamítnuto).
- Vracení starších odklepnutí přímo z Monitoru — jde přes frontu a plán.
- Potvrzování u běžící a přetahující zakázky.
- Změna chování tlačítka Hotovo na kartě bloku v plánu.
