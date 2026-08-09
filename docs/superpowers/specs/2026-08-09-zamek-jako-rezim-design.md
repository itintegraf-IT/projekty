# Zámek jako režim aplikace — návrh

**Datum:** 9. 8. 2026 · **Autor rozhodnutí:** Vojta Ťokan
**Stav:** schválený návrh, čeká na implementační plán

---

## 1. Problém

Zámek pracovní doby v hlavičce plánovače (oranžový visací zámek) je **stav jedné
záložky prohlížeče**. Když je odemčený, každý přesun, vložení i drop z fronty posílá
na server příznak „ignoruj pracovní dobu" a server u bloku, který se do kalendáře
nevejde, natrvalo zapíše `Block.scheduleBypassed = true`.

Plánovač tedy jedním cvaknutím zapne režim — a ten se propíše do **trvalé vlastnosti
každé zakázky, které se v něm dotkne**. Příznak přežije zamčení zámku a v plánu není
nijak vidět.

Horší je, co příznak dělá. Není to poznámka, je to **štít**:

| Mechanismus | Chování k označené zakázce |
| --- | --- |
| Detektor rozjetého kalendáře (`calendarDrift.server.ts`) | **vyřazuje ji z kontroly** (`scheduleBypassed: false` ve `where`) |
| Přepočet „Přepočítat" (`reflow.server.ts`) | **odmítá ji** — „Blok s vypnutým zámkem se nepřepočítává." |
| Autoposun (`chainPushGeometry`) | posouvá ji jako **rigidní interval**, bez roztažení přes pauzy |
| Lasso / hromadný přesun (`batch/route.ts`) | příznak **přičítá** (`bypass = požadavek \|\| stávající`) |
| Krok zpět (`undoApply.server.ts`) | zapisuje ho **doslova ze snapshotu** |
| Historie bloku (`revisionFormat.ts`) | je mezi **vyloučenými sloupci**, nezobrazuje se |

Tři vrstvy neviditelnosti nad sebou: zakázka není vidět v plánu, není vidět v kontrole
kalendáře a není vidět v historii.

### Doložená škoda

Zakázka **18447** na XL 106 dostala příznak 5. 8. 2026 při zachraňování rozhozeného
plánu. Uložené rozpětí (22 h) přitom bylo správné — výsledek roztažení 14 hodin tisku
přes noční pauzu. Když ji 9. 8. zasáhl autoposun, řídil se příznakem, **scvrknul ji
na 14 hodin** a přestala dosahovat k navazujícímu PŘEMYTÍ. V plánu vznikla **tichá
3,5hodinová díra uvnitř pracovní doby**. Nikde o tom nebyla zmínka.

Na produkci je takových zakázek 70; **69 z nich je z doby před červencem** (než se
nastavily šablony směn) a nekonzistentní je jediná — právě 18447. V běžném provozu
tedy příznak prakticky nevzniká, což potvrzuje, že jde o vedlejší produkt, ne o funkci.

---

## 2. Rozhodnutí

### 2.1 Co příznak znamená

`scheduleBypassed` **přestane znamenat** „tahle zakázka je výjimka, nesahat na ni"
a **začne znamenat** „tahle zakázka je právě teď odložená mimo pracovní dobu".

Dočasný, **viditelný** stav, který jde **jedním kliknutím srovnat** — ne doživotní
výjimka.

### 2.2 Nic se nepřeplánuje samo

Když aplikace zjistí, že něco nesedí na kalendář, **ukáže to a nabídne akci**.
Nepřesune nic, dokud uživatel neklikne. Platí i pro okamžik zamčení zámku: cvaknutí
zámku **nespustí žádný přepočet**.

Zdůvodnění (Vojta, 9. 8. 2026): plánovač si stěžoval na přílišnou automatiku a jeden
posun umí odsunout desítky bloků — u 18447 jich bylo 71. Automatická akce, kterou
uživatel nečekal, přeskládá plán způsobem, který nejde snadno přehlédnout ani vrátit.

### 2.3 Kde se zapisuje rozhodnutí „pojede se v noci"

**Do kalendáře směn** (`MachineWeekShifts`, má per týden a per den ranní/odpolední/noční),
ne na blok. Zakázka pak sedí v pracovní době normálně a žádná výjimka není potřeba.

Příznak na bloku slouží **výhradně pracovnímu odložení** — plánovač si potřebuje
zakázku někam hodit, když s plánem pracuje (zvyk z Excelu). Není to rozhodnutí
o nočním provozu.

---

## 3. Jak se s tím pracuje

**Odložení.** Odemkneš zámek, přetáhneš zakázku na šrafování. Chová se jako dnes —
nic tomu nebrání. Nově dostane na kartu štítek a nad sloupcem stroje naskočí pruh
„2 zakázky nesedí na kalendář — Přepočítat". Nic se nehne.

**Srovnání.** Klikneš „Přepočítat" (u jedné zakázky v detailu, nebo hromadně pro celý
stroj). Zakázky se roztáhnou přes pauzy na správná místa a **štítek zmizí**. Co nejde
(zamčené, vytištěné, nevejde se), zůstane a hláška to vypíše zvlášť.

**Skutečná noční.** Nekliká se „Přepočítat". Místo toho se v kalendáři směn zapne na
ten týden noční směna. Šrafování zmizí, zakázka sedí v pracovní době a **štítek zmizí
sám** — už není co srovnávat.

**Odsunutí autoposunem.** Odložená zakázka se posune, ale **nezmění délku**. Štítek
zůstane, dokud se to nedořeší.

**Stará značka.** Zakázka, která vypadá normálně, ale nese příznak z dřívějška, se
ozve stejně jako ostatní. „Přepočítat" u ní **jen zruší značku a s plánem nehne**.

---

## 4. Změny

### Z1 — Detektor kalendáře přestane odložené zakázky přehlížet

Detekce běží **na dvou nezávislých místech** a obě se musí změnit, jinak se objeví jen
půlka výsledku:

| Kde | Co pohání | Soubor |
| --- | --- | --- |
| server | pruh nad strojem („2 zakázky nesedí na kalendář — Přepočítat") | `src/lib/calendarDrift.server.ts` |
| klient | štítek „⚠ KALENDÁŘ" na kartě bloku a v detailu | `src/lib/printTimeClient.ts` (`blockCalendarDrift`) |

**PAST — nesahat na sdílený guard.** `blockCalendarDrift` si expanzi bere přes
`tryExpandForBlock`, který **sdílí s `getBlockSegments`** (kreslení pauz uvnitř bloku)
a který na `scheduleBypassed` vypadává. Uvolnit ho je nejnabízenější jednořádková
změna a je **špatně**: `getBlockSegments` by začal kreslit pás „⏸ PAUZA — mimo provoz"
dovnitř odložené zakázky, přestože ta tiskne slitě a žádnou pauzu uvnitř nemá. Byla by
to regrese přesně toho zmatku, který se opravoval 9. 8. 2026 (nález O7).

Správně: `blockCalendarDrift` dostane pro odložené zakázky **vlastní expanzní větev**;
`tryExpandForBlock` i `getBlockSegments` zůstávají beze změny.

**Serverová část** (`calendarDrift.server.ts`):

- Z `where` odstranit `scheduleBypassed: false`.
- Vyhodnocení zůstává stejné: `expandPrintTime(..., bypass = false)`, tedy „jak by
  blok vypadal podle kalendáře".
- Přibývá nový důvod `"STALE_BYPASS"` do unie `DriftedBlock.reason`:
  blok má `scheduleBypassed = true`, ale uložený konec **odpovídá** kalendářní expanzi.
  Značka je zbytková — geometrie je v pořádku, jen příznak lže. (Bez tohohle důvodu by
  18447 nebyla nahlášená vůbec: její rozpětí kalendáři odpovídá.)
- Ostatní důvody (`END_MISMATCH`, `START_NOT_RUNNABLE`, `HORIZON_EXCEEDED`) se
  nemění; odložená zakázka spadne typicky do `END_MISMATCH`.

Pořadí vyhodnocení pro blok s `scheduleBypassed = true`:
1. expanze selhala → dosavadní důvod (`START_NOT_RUNNABLE` / `HORIZON_EXCEEDED`)
2. expanze sedí na uložený konec → `STALE_BYPASS`
3. jinak → `END_MISMATCH`

**Klientská část** (`printTimeClient.ts`, `blockCalendarDrift`): stejná klasifikace
i stejné pořadí, aby štítek na kartě a pruh nad strojem nikdy netvrdily jiné věci.
Ostatní guardy (ne-ZAKAZKA, neplatné `printMinutes`, nezarovnaný start, potvrzený tisk,
konec v minulosti) platí pro odložené zakázky beze změny.

### Z2 — „Přepočítat" začne fungovat a maže značku

`src/lib/reflow.server.ts`

- Odstranit časnou návratovou větev `if (block.scheduleBypassed) return { code: "BYPASS" }`.
- Zápis po přepočtu doplnit o `scheduleBypassed: false`.
- **Pozor na zkratku bez změny:** dnešní `const changed = newStart !== oldStart || newEnd !== oldEnd`
  by u zbytkové značky (Z1 bod 2) vrátil `changed: false` a příznak by zůstal.
  Podmínka musí být `changed = posun NEBO block.scheduleBypassed`.
- Když se mění **jen příznak** (žádný posun): zapsat ho, **nespouštět chain push**
  (nic se nepohnulo) a nezapisovat `AUTO_REFLOW` řádek se shodným starým i novým
  spanem — změnu příznaku nese revize (viz Z3).
- Zamčený / vytištěný / bez tiskových minut / nezarovnaný start zůstávají důvodem
  k odmítnutí beze změny.

### Z3 — Změna značky je vidět v historii

`src/lib/revisionFormat.ts`

`scheduleBypassed` je dnes v `REVISION_SKIPPED_COLUMNS` s odůvodněním „vnitřní příznak
validace, ne uživatelské nastavení; mění se jako důsledek změny časů". **To přestává
platit** — nově je to stav, který uživatel vidí a který se může změnit i **bez** změny
časů (zrušení zbytkové značky).

- Přesunout ho z vyloučených sloupců mezi sloupce s vlastní větou.
- Věty (přesné znění):
  - `false → true`: `Označeno jako odložené mimo pracovní dobu`
  - `true → false`: `Zrušeno označení „odložené mimo pracovní dobu"`

### Z4 — Popisky štítku podle důvodu

`src/components/planner/BlockCard.tsx`

Štítek „⚠ KALENDÁŘ" zůstává (žádný nový prvek), mění se jen text nápovědy podle důvodu:

| Důvod | Nápověda |
| --- | --- |
| `END_MISMATCH` | dosavadní: `Konec nesedí na aktuální kalendář (správně do …)` |
| `STALE_BYPASS` | `Zakázka je značená jako odložená mimo pracovní dobu, ale kalendáři odpovídá — značku lze zrušit tlačítkem Přepočítat` |
| `START_NOT_RUNNABLE` / `HORIZON_EXCEEDED` | dosavadní |

### Z5 — Náhled při tažení přestane lhát

`src/app/_components/TimelineGrid.tsx` (dvě místa: drag a resize)

Podmínka `workingTimeLockRef.current && type === "ZAKAZKA" && !sourceBlock.scheduleBypassed`
vypíná „poctivý náhled" u odložené zakázky, takže se táhne s naivní výškou. Server ji
přitom při **zamčeném** zámku re-expanduje (`[id]/route.ts` bere bypass z requestu, ne
z bloku) — náhled tedy ukazuje něco jiného, než co se stane. **Je to nesoulad už dnes.**

Odstranit `&& !sourceBlock.scheduleBypassed` z obou podmínek.

### Z6 — Jednorázová oprava zakázky 18447

Po nasazení už není potřeba zásah do databáze: zakázka se ohlásí jako `STALE_BYPASS`
a **opraví se kliknutím na „Přepočítat"** — značka zmizí, plán se nepohne. Ověřit, že
po kliknutí je `scheduleBypassed = 0` a rozpětí zůstalo 1320 minut.

---

## 5. Co se schválně nemění

| Věc | Proč zůstává |
| --- | --- |
| **Chování zámku** | Plánovač potřebuje pokládat zakázky kamkoliv, když s plánem pracuje. Omezovat ho by řešilo něco jiného, než co je vadné. |
| **Geometrie autoposunu** (`chainPushGeometry`) | Odložená zakázka se dál posouvá jako rigidní interval se zachovanou délkou. Přepsat jí délku bez ptaní je přesně ta automatika, kterou nechceme. |
| **Sticky OR v `batch/route.ts`** | Přesun skupiny lasem nemá být zamaskovaný přepočet. Lepivost sama o sobě neškodí, jakmile je značka vidět a jde zrušit. |
| **Zápis příznaku** (`effectivelyBypassed`) | Vzniká správně — jako spočítaná pravda, ne echo požadavku. |
| **Undo** | Vrací stav, který v DB prokazatelně existoval, včetně značky. Nová věta v historii (Z3) to zviditelní. |
| **Guard rozdělení bloku** (`TimelineGrid.tsx`, split) | Odloženou zakázku musí jít rozdělit i uvnitř pauzy — leží tam vědomě. |

---

## 6. Testy

**`calendarDrift.server.test.ts`**
- odložený blok mimo pracovní dobu → `END_MISMATCH` (dřív se nehlásil vůbec)
- odložený blok, jehož rozpětí kalendáři **odpovídá** → `STALE_BYPASS` (případ 18447)
- neoznačený blok se shodným rozpětím → **žádný** nález (mutační pojistka: `STALE_BYPASS`
  se nesmí hlásit u bloku bez značky)
- neoznačený driftující blok → `END_MISMATCH` beze změny

**`reflow.server.test.ts`**
- odložený blok se přepočítá, posune a značka zmizí
- blok se zbytkovou značkou: **značka zmizí, start ani konec se nezmění, chain push
  se nevolá** (mutační pojistka na opravenou podmínku `changed`)
- zamčený / vytištěný odložený blok se dál odmítá

**`printTimeClient.test.ts`**
- odložený blok mimo pracovní dobu → `END_MISMATCH` (dřív `null`)
- odložený blok s rozpětím odpovídajícím kalendáři → `STALE_BYPASS`
- **`getBlockSegments` u odloženého bloku vrací dál `null`** — mutační pojistka proti
  uvolnění sdíleného guardu (past popsaná v Z1); jinak by se do bloku kreslila pauza
- klasifikace klienta a serveru dává pro tentýž vstup shodný důvod

**`revisionFormat.test.ts`**
- obě věty (nastavení i zrušení značky) — strážný test proti schématu musí projít
  s `scheduleBypassed` mimo vyloučené sloupce

**Ruční ověření na testovací instanci** (kopie ostré DB): pět scénářů z části 3.

---

## 7. Nasazení

### 7.1 Nasazení nesmí pohnout plánem — tvrdý požadavek

Vojta 9. 8. 2026: *„až tento build dáme na produkci, nechci nic měnit ani přepočítávat.
Prostě to už takhle je a tak to má být. Nesmí se nic hnout samo."*

Po nasazení musí plán vypadat **přesně jako předtím**. Ověřitelné vlastnosti návrhu:

| Změna | Chování při nasazení |
| --- | --- |
| Z1 detektor | jen ČTE (`findMany` + výpočet), nikdy nezapisuje |
| Z2 přepočet | běží výhradně z `POST /api/blocks/reflow` a `…/[id]/reflow`, tedy na kliknutí |
| Z3 věta v historii | jen formátování textu |
| Z4 nápověda štítku | jen text |
| Z5 náhled při tažení | jen náhled pod myší, žádný zápis |
| Z6 oprava 18447 | ruční kliknutí, a mění jen příznak |

Etapa **nepřidává žádnou migraci**, žádný startovací ani cron skript, který by data
měnil. Jediná viditelná změna je, že se objeví štítky u zakázek, které dosud byly
před kontrolou schované.

**Před nasazením změřit, kolik štítků přibude** (dotaz kopíruje filtr detektoru):

```sql
SELECT COUNT(*) FROM Block
WHERE type='ZAKAZKA' AND scheduleBypassed=1 AND printMinutes>0
  AND printCompletedAt IS NULL AND endTime > NOW();
```

Očekávání podle měření z 9. 8. 2026: **1** (zakázka 18447). Historických 69 zakázek
s příznakem má konec v minulosti, takže je detektor nebere.

### 7.2 Rozšířený dosah tlačítka „Přepočítat"

Hromadné „Přepočítat" nad strojem po nasazení zabírá i na odložené zakázky, které dosud
přeskakovalo. Samo se nespustí, ale **udělá víc než dřív** — uživatele na to upozornit
při předávání. Hláška hlásí počet přepočtených i přeskočených a krok zpět funguje.

### 7.3 Postup

Nasazuje se **společně s etapou B1** jako jeden celek (rozhodnutí Vojty 9. 8. 2026).

Postup podle `docs/DEPLOY_WORKFLOW.md`: záloha → deploy → `prisma migrate deploy`
(dvě migrace z B1, tahle etapa **žádnou migraci nepřidává**) → cron na
`scripts/prune-revisions.ts` → oprava 18447 přes „Přepočítat" (Z6).

**Migrace dat není potřeba.** 69 historických zakázek s příznakem se po nasazení
začne hlásit jen tehdy, když leží v budoucnu — detektor bere pouze bloky s koncem
po aktuálním čase. Podle měření z 9. 8. 2026 je taková jediná (18447).

---

## 8. Mimo rozsah

- **Chování autoposunu obecně.** Vojta 9. 8. 2026 vědomě odložil; plánovači možná vadí,
  ale je to samostatné téma.
- **Odstranění sloupce `scheduleBypassed`.** Zůstává jako záznam; mění se jen jeho
  význam a to, že přestává být štítem.
- **Přepínání směn přímo z plánu.** Cesta „zapni na ten týden noční" vede dnes přes
  správu pracovní doby a tak zůstává.
