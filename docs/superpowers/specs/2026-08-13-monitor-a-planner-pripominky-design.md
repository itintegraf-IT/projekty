# Připomínky tiskařů a plánovače (13. 8. 2026) — návrh řešení

Čtyři nezávislé připomínky z provozu. Tři se týkají Monitoru u stroje, jedna
plánu. Spojuje je jediné téma: **aplikace nesmí sama rozhodnout, že zakázka,
kterou má tiskař rozdělanou, přestala být důležitá.**

Zadavatel: Vojta Ťokan, na základě zpětné vazby tiskařů a plánovače.
Rozhodnutí majitele jsou v textu označena datem.

---

## 1. Sekce NEDODĚLÁNO musí ukázat všechno

### Problém

Sekce ukazuje nejvýš tři nejnovější nedodělané zakázky a zbytek shrne do řádku
„…a dalších X starších — najdeš je přes „Najít““.

Ověření nad ostrou databází 12. 8. 2026: XL 105 má 4 nedodělané zakázky,
**XL 106 devět**. Na XL 106 by tedy šest z devíti leželo za souhrnným řádkem.

Odkaz na „Najít“ je slepá ulička ze dvou důvodů:

1. **Tiskař nemá jak vědět, co hledat.** Vyhledávání pracuje s číslem zakázky a
   popisem; zakázka, kterou nikdy neviděl, pro něj neexistuje.
2. **Čísla zakázek se opakují.** V ostrých datech je `17927/1` třikrát (tři
   bloky téže zakázky) a `HARM` figuruje na obou strojích. I kdyby hledat uměl,
   dostane několik nerozlišitelných řádků.

### Řešení

Strop `OVERDUE_VISIBLE_COUNT` a souhrnný řádek se ruší. Sekce ukáže **všechny**
nedodělané zakázky v okně `UNFINISHED_LOOKBACK_DAYS` (14 dní).

Aby devět položek nezatlačilo nadpis „DNES“ pod okraj obrazovky, dostane sekce
NEDODĚLÁNO **zúžený tvar řádku** (rozhodnutí majitele 13. 8. 2026):

| | Dnes / Zítra (beze změny) | Nedoděláno (nové) |
| --- | --- | --- |
| Číslo zakázky | ano | ano |
| Popis | ano | ano |
| Čas | ano (`14:30`) | ano, **s dnem** (`st 5. 8. 7:30`) |
| Amber pás specifikace | ano | **ne** |
| Výrobní a stavové chipy | ano | **ne** |
| Výška řádku | ~90–110 px | ~36 px |

Devět zúžených řádků zabere ~330 px místo ~900 px, takže „DNES“ zůstane
viditelné bez rolování.

Ztráta informace je zdánlivá: kliknutím na řádek se zakázka vytáhne na velkou
kartu, která nese specifikaci i všechny chipy. Zúžený řádek odpovídá na otázku
„co mi zbývá“, velká karta na otázku „co s tím“.

### Co se nemění

Řazení (vzestupně podle začátku), okno 14 dní, vyloučení pozastavených zakázek,
ztlumení odklepnutých, zvýraznění zakázky ležící na velké kartě.

---

## 2. Karta se nesmí sama přepnout na další zakázku

### Problém

`pickHeroBlock` dává absolutní přednost zakázce, která **právě běží podle
plánu**, před zakázkou, které vypršel čas a nikdo ji neodklepl:

```
1. running  — start ≤ teď < konec
2. overdue  — konec ≤ teď, a zároveň teď − konec ≤ OVERDUE_WINDOW_MS (16 h)
3. upcoming — nejbližší budoucí
```

V okamžiku, kdy začne následující blok, karta odskočí — i když tiskař pořád
tiskne tu předchozí. Zakázka, kterou fyzicky drží v ruce, mu zmizí i s tlačítkem
HOTOVO, a jediná cesta zpátky je ruční klik do fronty.

Je to přesně ten druh automatiky, který projekt jinde odmítá (viz
`docs/POUCENI.md` a „minimum automatiky bez vědomí plánovače“) — jenže tady
rozhoduje aplikace za tiskaře, ne za plánovače.

### Řešení

**Prohození priority** (rozhodnutí majitele 13. 8. 2026):

```
1. overdue  — konec ≤ teď, neodklepnutá, nepřeskočená   ← nově první
2. running  — start ≤ teď < konec
3. upcoming — nejbližší budoucí
```

Zakázka, které vypršel čas a není odklepnutá, tedy **přebije** nově začínající.
Z několika takových vyhrává ta, která skončila nejpozději — to je ta, kterou má
tiskař rozdělanou.

**Bez časového omezení.** Šestnáctihodinové okno se z tohoto výběru vypouští:
karta drží zakázku, dokud tiskař nerozhodne. Zůstává ale omezení stejné, jaké má
sekce NEDODĚLÁNO — 14 dní zpět. Bez něj by po zavedení featury na kartě navěky
seděl blok, který v datech leží od loňska.

> **`OVERDUE_WINDOW_MS` se NEMĚNÍ.** Od 12. 8. 2026 tímtéž oknem hasne červený
> alarm na kartě bloku v plánu (`overdueState.ts`, sdílené plánem i Monitorem).
> Změna té konstanty by změnila i chování plánu. Hero karta si napříště bere
> vlastní, samostatně pojmenované okno.

### Úniková cesta: „Přeskočit →“

Bez omezení karta drží donekonečna, takže tiskař musí mít čím se pohnout dál,
aniž by lhal do dat (odklepnutí zakázky, kterou nevytiskl, je lež v evidenci —
`printCompletedAt` je podklad pro reporty).

Na kartě s `reason === "overdue"` proto přibude vedle HOTOVO druhé, vedlejší
tlačítko **„Přeskočit →“**. Zakázka tím z karty zmizí a Monitor pokračuje
doporučeným pořadím; ve frontě zůstane — typicky v sekci NEDODĚLÁNO, výjimečně
v DNES/ZÍTRA, pokud tam zakázka podle svého startu patří (viz `monitorQueue`).

> Finální review 13. 8. 2026 (Important nález I1) odhalilo, že do opravy `monitorQueue`
> a `pickHeroBlock` používaly RŮZNÉ horní hranice pro „konec zakázky" (fronta
> `endTime < dnešní půlnoc`, karta `end <= teď`), takže mezi nimi byla díra —
> typicky noční směna 22:00–6:00, ráno neodklepnutá. Taková zakázka byla NA
> KARTĚ, ale ve frontě NIKDE, takže by ji „Přeskočit →“ odstranilo z Monitoru
> beze stopy až do půlnoci. Opraveno sladěním obou hranic (`docs/vyvoj-historie.md`,
> sekce „Nedodělané zakázky na Monitoru tiskaře" → „Aktualizace pozdě 13. 8. 2026").

Přeskočení se ukládá do `localStorage` pod klíčem odvozeným od stroje. Je to
vlastnost té obrazovky u stroje, ne uživatele (viz paměť „Nastavení: zařízení vs.
uživatel“): kiosek se restartuje a bez uložení by po každém restartu naskočila
táž zakázka znovu. Na serveru se nic nemění — přeskočení není stav zakázky.

### Známý důsledek prvního spuštění

Na XL 106 leží devět neodklepnutých zakázek, nejstarší z 30. 7. Po nasazení bude
na kartě nejnovější z nich (`17927/5` ze 6. 8.), ne dnešní práce. Tiskař se
k dnešku dostane odklepnutím nebo přeskočením — v nejhorším devětkrát.

Je to **jednorázový úklid**, ne trvalý stav: díky `localStorage` se přeskočené
zakázky po restartu kiosku nevrátí. Zároveň je to jediný okamžik, kdy se ten
nepořádek stane viditelným — dosud ho neviděl nikdo.

### Co se nemění

Ruční výběr z fronty pořád přebíjí všechno. Držení odklepnuté zakázky
(`stickyId` + „Další →“ / „Vrátit“) zůstává beze změny. Odklepnout jde pořád jen
na vlastním stroji.

---

## 3. Hover bublina nesmí zakrývat druhý stroj

### Problém

Bublina s náhledem bloku se umisťuje pravidlem „vejde-li se vpravo od bloku, dej
ji vpravo“ (`BlockCard.tsx`). Mřížka má ale sloupce strojů vedle sebe — vpravo od
bloku v XL 105 je sloupec XL 106. Bublina tedy u levého sloupce spolehlivě
zakryje celý pruh druhého stroje včetně sousedních zakázek.

### Řešení

Bublina jde **vždy na vnější stranu mřížky** (rozhodnutí majitele 13. 8. 2026):

- blok v levé polovině mřížky → bublina **vlevo** (přes časovou osu, kde je jen čas)
- blok v pravé polovině mřížky → bublina **vpravo**

Rozhoduje vodorovný střed bloku vůči středu **mřížky**, ne počet sloupců —
pravidlo tak platí i kdyby strojů přibylo.

> Původní návrh porovnával se středem OKNA. Finální review 13. 8. 2026 (nález I3)
> ukázalo, že mřížka okno nevyplňuje: napravo od ní stojí editační `<aside>`,
> notifikační panel i DTP panel. Při otevřených panelech na 1440 px vyšel střed
> okna doprostřed pravého sloupce a bublina se vykreslila přes sloupec levý —
> tedy přesně ta vada, kterou má featura odstranit. Rozhoduje proto střed
> kontejneru se sloupci (`[data-timeline-grid]`), ne `window.innerWidth`.

Ořez na okraje okna zůstává; když se bublina na vnější stranu nevejde celá,
překryje část **vlastního** sloupce, což je pořád lepší než zakrýt cizí stroj.

### Co se nemění

Obsah bubliny, zpoždění otevření, `pointerEvents: none`, portálování mimo
stacking context.

---

## 4. Hledání se má zrušit klikem do plánu

### Problém

Plánovač musí po každém hledání trefit malý křížek v poli, aby se vrátil pohled
na všechny zakázky (nesouhlasící bloky jsou ztlumené).

**Featura byla dřív ohlášena jako hotová, ale nikdy nefungovala.** V kódu jsou
dva komentáře, které tvrdí opak skutečnosti:

- `clearSearch` má u sebe „jediné místo pravdy (křížek v poli, Esc, klik do
  prázdna v plánu)“ — přitom ji volá **jen** křížek.
- `onGridClickEmpty` má komentář vysvětlující, proč se hledání rušit **nemá** —
  ten vznikl 12. 8. 2026, když jsem zapojení odstranil z obavy, že klik do
  prázdna přijde i při dotažení lasa. Obava byla lichá vůči zadání: uživatel
  napsaný dotaz smazat chce.
- Obsluha klávesy Esc ruší výběr, schránku a cíl vložení, `clearSearch` ale
  nevolá.

### Řešení

`clearSearch()` se zapojí na dvě další místa:

1. **klik kamkoliv do mřížky** (`onPlanClick` na `[data-timeline-grid]`) — tedy
   i na blok, na časovou osu a na sloupec s datem
2. **klávesa Esc** (do existující obsluhy, k rušení výběru a schránky)

Oba komentáře, které lžou, se opraví na skutečný stav.

> **Opraveno 13. 8. 2026 po zpětné vazbě.** První verze zapojila `clearSearch`
> jen na `onGridClickEmpty`, tedy na prázdné místo ve sloupci stroje, s
> odůvodněním, že rušení při kliku na blok by znemožnilo proklikat další shodu.
> To odůvodnění neobstálo: mezi shodami se přepíná šipkami v hlavičce, které jsou
> MIMO mřížku. Zato nejčastější pohyb plánovače — najdi zakázku, klikni na ni —
> dotaz nezrušil, takže featura působila jako rozbitá. Zadání znělo doslova
> „vynulovat kliknutím kamkoliv do plánu“ a to zúžení bylo chybný výklad.

**Stavové chipy uvnitř bloku hledání neruší** — zastavují propagaci samy
(`stopPropagation`). Je to správně: odklepnutí DATA nebo MATERIÁL uprostřed
hledání není opuštění hledání.

**Gesta hledání neruší.** Laso, přetažení bloku, resize i tažení hranice směny
končí `mouseup`, po kterém prohlížeč pošle ještě `click` — bez pojistky by
tažení nalezeného bloku smazalo dotaz uprostřed úkonu. Mřížka si proto
poznamená čas konce gesta (`gestureEndedAtRef`) a klik do 150 ms po něm
`onPlanClick` nespustí.

Volba cíle pro vložení (`onGridClick` → `setPasteTarget`) hledání **ruší** —
je to týž klik do prázdna a uživatel v tu chvíli hledání opustil.

---

## Testování

| Oblast | Jak |
| --- | --- |
| Fronta Monitoru (bod 1) | Unit testy `monitorView.test.ts` beze změny; zúžený řádek je vizuální — proklik. |
| `pickHeroBlock` (bod 2) | Unit testy: overdue přebije running; nejnovější overdue vyhrává; přeskočená se vynechá; blok starší než 14 dní se nevrátí; hranice ±1 ms. |
| Bublina (bod 3) | Vizuální proklik v obou sloupcích. |
| Hledání (bod 4) | Vizuální proklik: dotaz + klik do prázdna, dotaz + Esc, dotaz + laso (nesmí zrušit), dotaz + klik na blok (nesmí zrušit). |

Komponentní testovací harness projekt nemá — logika se testuje v čistých
funkcích (`monitorView.ts`), React vrstva prokliknutím.

---

## Co tento spec ZÁMĚRNĚ neřeší

- **Notifikace ani přeplánování nedodělaných zakázek.** Rozhodnutí majitele
  12. 8. 2026 platí dál: nedodělanou zakázku řeší výhradně tiskař u stroje.
- **Zkreslení reportů.** Zakázka odklepnutá se zpožděním nese `printCompletedAt`
  z okamžiku stisku, ne z okamžiku tisku. Vedeno jako známé omezení.
- **`OVERDUE_WINDOW_MS`.** Zůstává 16 h pro červený alarm v plánu.
- **Duplicitní čísla zakázek ve vyhledávání.** Reálný problém (`17927/1` třikrát),
  ale po zrušení stropu už není na kritické cestě.
