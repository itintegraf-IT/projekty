# Audit kvality kódu a vizuálního designu — Výrobní plán

**Datum:** 11. 7. 2026 · **Rozsah:** celá aplikace (Planner, Rezervace, Admin, Expedice, Reporty, Tiskař, Login, `src/lib`, API vzorky) · **Režim:** read-only, žádné změny v repu

**Bilance: 105 ověřených nálezů — 21 Vysoká · 63 Střední · 21 Nízká.** Kategorie: Duplicita 37 · Komponenty 21 · Mrtvý kód 17 · Struktura 16 · Vizuál 14.

## Shrnutí

Aplikace **jeden reálný vizuální systém má** — aplikační CSS tokeny v `globals.css` (light i dark paleta), inline styly a iOS-like interakce — a většina modulů jím mluví. Problém není chybějící systém, ale **~60 míst s `#hex`/`rgba`/`"white"` literály mimo něj**. Protože `defaultTheme="system"` (light mode je legitimní běžný stav), je ve světlém režimu reálně rozbitá Expedice (bílé okraje na bílém), OrderSearchSheet a TiskarMachineToggle, login CTA a oba delete dialogy. (#55, #28, #65, #3, #105, #92)

**Nejzávažnější třída nálezů kvality kódu: ručně kopírované doménové mapy, které už divergovaly.** Byznysový dopad má #2 — undo (Ctrl+Z) a paste dnes **tiše ztrácejí stav Pantone / SKLADEM / materialNote**, protože 4 kopie mapování Block→payload nejsou synchronizované. Dál: dvojí vizuální identita bloků grid vs. tiskař, která už se rozjela (#14), admin audit tab s vlastní chudší kopií formatterů — stejný audit řádek vypadá v planneru správně a v adminu rozbitě (#42), 7 kopií mapy errorStatus s různými HTTP statusy pro tutéž chybu (#80) a auth boilerplate ve 41 z 43 API routes (#81).

**Struktura:** `PlannerPage.tsx` (4 446 ř.) a `TimelineGrid.tsx` (4 216 ř.) dál rostou proti vlastnímu pravidlu projektu z CLAUDE.md. Audit dává konkrétní mapu extrakcí s odhady: JobBuilderPanel + useJobBuilder ~1 200 ř. (#6), useBlockSync ~215 ř. (#7), PlannerHeader ~265 ř. (#8), ShutdownManager ~310 ř. (#5), DateChipRow ruší ~230 ř. triplikace (#15).

**Mrtvý kód mate na frekventovaných místech:** nedosažitelný modul `/tiskar` — 783 ř., na které login stále routuje (#71); banner `pushSuggestion`, který se nikdy nevykreslí (#1); mrtvé onClick větve `dataCanToggle` na nejviditelnějším prvku planneru (#16); komentář v BlockEdit, který mrtvé importy vydává za používané (#27); mrtvé ui/ primitivy calendar/tooltip/select (#98) a `tailwind.config.mjs`, který se v Tailwind v4 vůbec nenačítá (#104).

**Komponentová konzistence:** shadcn `ui/` vrstvu používá jen okruh Planneru (10 souborů). Rezervace, Expedice, Reporty a Login si inputy, selecty a tlačítka staví ručně, každý trochu jinak — 5+ nezávislých definic inputu (#62, #93), ~11 kopií ručně stylovaného nativního selectu (#4, #32), 4 kopie admin button stylů (#43).

Každý nález prošel nezávislou adversarial verifikací proti souboru (**105/105 potvrzeno, 0 zamítnuto**; u části verifikátoři opravili čísla řádků). Audit je statický — bez běžící aplikace; co pokryto nebylo, je explicitně v sekci „Co audit nepokryl".

## Top 5 doporučení pro příští etapu

**1. Theme hotfixy + focus-visible (pracnost S, okamžitá viditelnost)**

Mechanická náhrada barevných literálů za tokeny tam, kde je light mode reálně rozbitý: Expedice (#55), OrderSearchSheet + TiskarMachineToggle (#28), DtpDataPopover (#40), delete dialogy (#3, #105), login CTA (#65). K tomu globální `:focus-visible` pravidlo a `font-family` na `body` v `globals.css` (#101, #97) — kroky 1 a 3 design návrhu. Žádná změna chování, každý krok samostatně commitnutelný.

**2. Zastavit divergenci doménových map (pracnost M, největší dopad na data)**

Helper `blockToCreatePayload` a nasazení do všech 4–5 cest (#2 — jediný nález s dopadem na data: undo/paste ztrácí Pantone/SKLADEM). Dále sdílené `blockStyles` pro grid + tiskaře (#14), admin audit tab na `lib/auditFormatters` (#42), kanonický `errorStatus` v `lib/errors` + helper `requireRole` (#80, #81), adopce `dateUtils` (#57, #76, #84, #88) a `lib/machines` (#25, #46, #77).

**3. Sdílené UI stavební kameny (pracnost M)**

Podle design návrhu (cesta a+c): `ConfirmDialog` (#3, #34, #48, #64), jeden sdílený select — `NativeSelect` nebo oživená `ui/select` (#4, #32), `PrimaryCta` s brand tokeny (#10, #65), `ModuleHeader` s ThemeToggle + Odhlásit (#60, #102, #8). Pravidlo pro nové formuláře mimo Planner: sahat po `ui/Input`/`ui/Button` (#93, #62). Shadcn vrstvu plošně NErozšiřovat — big-bang přepis denního nástroje je nepřiměřené riziko.

**4. Rozhodnout a uklidit mrtvé větve (pracnost S)**

Rozhodnutí o osudu `/tiskar` — smazat vs. oživit; minimálně hned sjednotit login redirect (#71). Smazat: `pushSuggestion` banner (#1), mrtvé `dataCanToggle` větve (#16), void-imports blok v BlockEdit (#27), `timeSlots.ts` z 12/14 mrtvý (#83), 4 mrtvé exporty `shifts.ts` (#87), mrtvé ui/ primitivy (#98), zavádějící `tailwind.config.mjs` (#104) a prázdný untracked adresář `src/app/api/events-test/`.

**5. Dekompozice velkých souborů podle hotové mapy + doplnění děr auditu (pracnost M–L, průběžně)**

PlannerPage: JobBuilderPanel + useJobBuilder (#6), useBlockSync (#7), PlannerHeader (#8), ShutdownManager (#5), useKeyboardShortcuts (#12) — dohromady ~2 100 ř. ven. TimelineGrid: DateChipRow (#15), inline komponenty (#17). BlockEdit sekce (#29), AdminDashboard taby (#44). Následující audit-iteraci začít 5 zdokumentovanými děrami: API mutační vrstva bloků, SSE infrastruktura, serverové reportMetrics, TiskarMonitor celý, příčný řez loading/empty/error stavů.

---

## Nálezy — Vysoká (21)

### #1 — Mrtvý banner „Blok vrácen — zamknutý blok" — pushSuggestion se nikdy nenastaví

**Soubor:** `src/app/_components/PlannerPage.tsx:661` · **Kategorie:** Mrtvý kód · **Závažnost:** Vysoká

```
const [pushSuggestion, setPushSuggestion] = useState<PushSuggestion | null>(null);
```

**Dopad:** Jediné volání setteru v celém souboru je setPushSuggestion(null) (řádek 4346) — fixed banner na řádcích 4331–4352 se tedy NIKDY nevykreslí. Typ PushSuggestion (ř. 112) i ~25 řádků JSX je zavádějící mrtvý kód: kdo bude ladit UX kolizí se zamčeným blokem, bude si myslet, že tento banner funguje.

**Doporučení:** Smazat state pushSuggestion, typ PushSuggestion a JSX blok 4331–4352 (hlášky o zamčeném bloku dnes chodí přes error toasty ze serverových odpovědí). Pokud má banner žít, musí ho někdo reálně setovat — ale to je nová featura, ne úklid.

**Další výskyty:** `src/app/_components/PlannerPage.tsx:112`, `src/app/_components/PlannerPage.tsx:4331`, `src/app/_components/PlannerPage.tsx:4346`

*Verifikace: Grep celého src/ potvrzuje, že jediný setter je setPushSuggestion(null) na ř. 4346 — banner na ř. 4331–4352 se nikdy nemůže vykreslit, typ PushSuggestion (ř. 112) i state (ř. 661) jsou mrtvé.*

### #2 — Čtyři ručně psané Block→payload mapy se už rozjely (pantone, materialInStock, materialNote)

**Soubor:** `src/app/_components/PlannerPage.tsx:1800` · **Kategorie:** Duplicita · **Závažnost:** Vysoká

```
const payloads = deletedStandalone.map((b) => ({
```

**Dopad:** Stejné ~25polí mapování bloku na API payload existuje 4× (undo smazání single ř. 1705, undo multi ř. 1800, paste ř. 2581, group paste ř. 2725) + příbuzná queue baseBody (ř. 2348). Už teď divergují: undo-payloady NEobsahují pantoneRequiredDate/pantoneOk/pantoneRequired ani materialInStock; paste payloady navíc ztrácejí materialNote — zatímco queue drop pantone i SKLADEM přenáší. Vrácený (Ctrl+Z) nebo vložený blok tak tiše ztratí stav SKLADEM/Pantone a každé nové pole Blocku se musí doplnit na 4–5 místech.

**Doporučení:** Extrahovat helper blockToCreatePayload(block, opts) (např. do src/lib/blockPayload.ts) s explicitním výčtem polí a použít ho ve všech čtyřech cestách; vědomé rozdíly (locked: false u paste) řešit přes opts. Sjednotit tím i chybějící pantone/materialInStock pole.

**Další výskyty:** `src/app/_components/PlannerPage.tsx:1705`, `src/app/_components/PlannerPage.tsx:2581`, `src/app/_components/PlannerPage.tsx:2725`, `src/app/_components/PlannerPage.tsx:2348`

*Verifikace: Všech 5 míst existuje a divergence sedí: undo mapy (1705, 1800) nemají pantone*/materialInStock, paste mapy (2581, 2725) navíc ztrácejí materialNote, zatímco queue baseBody (2348) pantone i materialInStock přenáší.*

### #3 — Dva copy-paste inline confirm modaly s natvrdo tmavou paletou a z-index 10000

**Soubor:** `src/app/_components/PlannerPage.tsx:2946` · **Kategorie:** Duplicita · **Závažnost:** Vysoká

```
position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.7)"
```

**Dopad:** Potvrzení smazání (Delete) a hromadného smazání jsou dvě téměř identické kopie overlay+karta+tlačítka (ř. 2944–2987 vs 2989–3012), už mírně rozjeté (šířka 340/300, gap 10 vs 8). Karta má hardcoded #262630/#f1f5f9/#94a3b8 — v light theme (aplikace má ThemeToggle) zůstane modal tmavý a vypadá jako cizí prvek; z-index 10000 je mimo jakoukoli škálu (DatePickerField má 9999, banner 200). Mazání bloků je denní operace plánovačů.

**Doporučení:** Extrahovat sdílený ConfirmDialog do src/components/ (per standard z CLAUDE.md „nové UI komponenty do src/components/"), barvy převést na CSS proměnné (var(--surface), var(--text)…) a obě místa nahradit jeho použitím; volitelný slot pro input důvodu zamítnutí rezervace.

**Další výskyty:** `src/app/_components/PlannerPage.tsx:2989`, `src/app/_components/PlannerPage.tsx:2950`, `src/app/_components/PlannerPage.tsx:2995`

*Verifikace: Dva téměř identické modaly (2944–2987 vs 2989–3012) s hardcoded #262630/#f1f5f9/#94a3b8, zIndex 10000, šířka 340/300 vs 300 a gap 10 vs 8 — přesně jak nález tvrdí.*

### #4 — 7× ručně stylovaný nativní \<select> + kopírovaný chevron SVG místo sdílené select komponenty

**Soubor:** `src/app/_components/PlannerPage.tsx:3770` · **Kategorie:** Komponenty · **Závažnost:** Vysoká

```
appearance: "none", width: "100%", height: 32,
```

**Dopad:** Builder obsahuje 7 nativních selectů s opakovaným inline stylem (appearance:none + border-radius + focus/hover handlery) a 7× zkopírovaným chevron SVG (path M5 8l5 5 5-5); ShutdownManager má vlastní čtvrtou variantu (hourSelectStyle, ř. 207). Styly už divergují (height 32 vs 30, radius 10 vs 8 vs 6, padding 36/32/28/22 px) — každá změna vzhledu selectu znamená ruční úpravu ~11 míst. Přitom existuje nepoužitá shadcn komponenta src/components/ui/select.tsx (grep: žádný import v celém repu).

**Doporučení:** Extrahovat jednu komponentu (např. src/components/ui/NativeSelect.tsx se současným vzhledem přes CSS proměnné, nebo oživit ui/select) a nahradit jí všech 7 výskytů v builderu + 4 v ShutdownManageru. Zároveň rozhodnout osud mrtvé ui/select.tsx (smazat, nebo se stát tím sdíleným řešením).

**Další výskyty:** `src/app/_components/PlannerPage.tsx:3692`, `src/app/_components/PlannerPage.tsx:3811`, `src/app/_components/PlannerPage.tsx:3869`, `src/app/_components/PlannerPage.tsx:3914`, `src/app/_components/PlannerPage.tsx:3982`, `src/app/_components/PlannerPage.tsx:4067`, `src/app/_components/PlannerPage.tsx:207`

*Verifikace: 7 selectů s appearance:none (3692, 3770, 3811, 3869, 3914, 3982, 4067) + 7 chevron SVG, hourSelectStyle v ShutdownManageru na ř. 207 (4 užití) a src/components/ui/select.tsx existuje bez jediného importu v repu.*

### #14 — BLOCK_STYLES a pomocné funkce zduplikované mezi TimelineGrid a TiskarMonitor

**Soubor:** `src/app/_components/TimelineGrid.tsx:406` · **Kategorie:** Duplicita · **Závažnost:** Vysoká

```
const BLOCK_STYLES: Record<string, {
```

**Dopad:** Kompletní vizuální identita bloků (6 gradientů, bordery, accenty) + getBlockStyleKey + tint + MiniChip existují ve dvou kopiích — TiskarMonitor.tsx:70 to sám přiznává komentářem „shodné s TimelineGrid". Divergence už reálně nastala: BLOCK_OVERDUE je v gridu oranžový (rgba(251,146,60,…)), u tiskaře šedý; BLOCK_PRINT_DONE modrý vs. zelený — nikde není zaznamenáno, zda jde o záměr. Třetí zrcadlo je shadeBucket v blockShades.ts:28 („musí zrcadlit getBlockStyleKey"). Změna barvy typu bloku dnes vyžaduje 2–3 souběžné editace.

**Doporučení:** Extrahovat BLOCK_STYLES, getBlockStyleKey a tint do src/lib/blockStyles.ts a MiniChip do src/components/; TimelineGrid i TiskarMonitor je importují. Vědomé odchylky tiskaře (done=zelená, overdue=šedá) předat jako explicitní override konstanty vedle sdílené mapy. shadeBucket pak importovat getBlockStyleKey místo zrcadlení.

**Další výskyty:** `src/app/tiskar/_components/TiskarMonitor.tsx:72`, `src/app/tiskar/_components/TiskarMonitor.tsx:144`, `src/app/tiskar/_components/TiskarMonitor.tsx:149`, `src/app/tiskar/_components/TiskarMonitor.tsx:153`, `src/lib/blockShades.ts:28`, `src/app/_components/TimelineGrid.tsx:493`

*Verifikace: BLOCK_STYLES na ř. 406 i v TiskarMonitor.tsx:72 (komentář „shodné s TimelineGrid“ ř. 70), divergence OVERDUE/PRINT_DONE i zrcadlení shadeBucket v blockShades.ts:28 ověřeny; nikde nezdokumentováno jako záměr.*

### #16 — dataCanToggle = false — mrtvé onClick větve ve 3 kopiích na nejfrekventovanějším místě

**Soubor:** `src/app/_components/TimelineGrid.tsx:1014` · **Kategorie:** Mrtvý kód · **Závažnost:** Vysoká

```
const dataCanToggle = false;
```

**Dopad:** Konstanta je natvrdo false, takže celé onClick handlery D chipu (včetně setTimeout logiky pro rozlišení klik/dvojklik) na řádcích 1346, 1471 a 1681 jsou nedosažitelný kód — vyhodnotí se vždy na undefined. Kdo ladí chování datového chipu (nejviditelnější prvek planneru), čte a mentálně vykonává logiku, která nikdy neproběhne; kurzor je vždy default, ale kód slibuje toggle.

**Doporučení:** Smazat konstantu a mrtvé ternární větve: onClick={undefined} zjednodušit na vynechání propu, v dateChip factory předávat clickable=false přímo. Dvojklikové handlery (kalendář/DTP popover) ponechat beze změny.

**Další výskyty:** `src/app/_components/TimelineGrid.tsx:1346`, `src/app/_components/TimelineGrid.tsx:1471`, `src/app/_components/TimelineGrid.tsx:1681`

*Verifikace: dataCanToggle je natvrdo false na ř. 1014 a grep celého src/ ukazuje jen 6 užití v témže souboru — onClick handlery na 1346/1471/1681 se vždy vyhodnotí na undefined, mrtvý kód.*

### #15 — Řádek datum chipů D/M/E/P je v BlockCard implementován 3× téměř identicky

**Soubor:** `src/app/_components/TimelineGrid.tsx:1448` · **Kategorie:** Duplicita · **Závažnost:** Vysoká

```
const chipStyle = (stateKey: string, fieldAccent: string, clickable: boolean): React.CSSProperties => ({
```

**Dopad:** Style factory (dateChip/chipStyle/cs), odvození stateKey, ikonky (dIcon/mIcon/pIcon) i click-vs-dblclick logika s 350ms timerem jsou zkopírované pro MODE_COMPACT (ř. 1318–1438), MODE_TINY/MICRO (1444–1556) a showDatesCompact (1656–1704) — ~230 řádků triplikace. Divergence už nastala: varianta 48–59 px (showDatesCompact, ř. 1677–1690) ztratila title tooltip „Start zakázky před dodáním dat/materiálu", který COMPACT (1345) i TINY (1470) mají. Každá oprava chování chipu se musí ručně replikovat 3×.

**Doporučení:** Extrahovat jednu komponentu (např. DateChipRow s props size: "compact"|"tiny", showPantone…) do src/components/planner/ a nahradit všechny tři inline bloky. Sjednotit přitom chybějící title atributy.

**Další výskyty:** `src/app/_components/TimelineGrid.tsx:1323`, `src/app/_components/TimelineGrid.tsx:1661`, `src/app/_components/TimelineGrid.tsx:1334`, `src/app/_components/TimelineGrid.tsx:1459`, `src/app/_components/TimelineGrid.tsx:1672`

*Verifikace: Tři téměř identické kopie chip řádku (1318–1438, 1444–1556, 1656–1704) ověřeny včetně chybějícího title atributu ve variantě showDatesCompact (ř. 1677/1686), který COMPACT (1345) i TINY (1470) mají.*

### #81 — Auth + role check boilerplate ve 41 z 43 API routes, dva tvary a tři varianty hlášek

**Soubor:** `src/app/api/blocks/route.ts:48` · **Kategorie:** Duplicita · **Závažnost:** Vysoká

```
if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
```

**Dopad:** getSession se volá na 55 místech ve 41 route souborech a inline check role ADMIN/PLANOVAT existuje ve 24+ kopiích ve dvou nekompatibilních tvarech: return NextResponse 401/403 s anglickým textem (43× "Unauthorized") vs throw AppError("FORBIDDEN") s českým textem (9× "Nepřihlášený uživatel.", 2× "Nepřihlášen."). Důsledek: nepřihlášený uživatel dostane v blocks 401, ale v shift-assignments 403 (FORBIDDEN ternary na řádku 39) — nekonzistentní kontrakt pro klientský error handling a re-login logiku.

**Doporučení:** Přidat helper (např. requireRole v src/lib/auth.ts): vrátí SessionUser, nebo hodí AppError s jednotnou českou hláškou; 401 pro nepřihlášeného řešit vlastním kódem (rozšířit AppErrorCode o UNAUTHORIZED). Nasazovat inkrementálně route po route, začít u nových.

**Další výskyty:** `src/app/api/blocks/route.ts:47`, `src/app/api/shift-assignments/route.ts:12`, `src/app/api/shift-assignments/route.ts:13`, `src/app/api/shift-assignments/route.ts:39`, `src/app/api/machine-week-shifts/route.ts:216`

*Verifikace: Řádek 48 sedí přesně; grep potvrdil 41 route souborů s getSession, 43× anglické Unauthorized a shift-assignments vrací nepřihlášenému 403 přes AppError(FORBIDDEN) místo 401.*

### #80 — Mapování AppError kódu na HTTP status duplikováno 7×, mapy se už rozjely

**Soubor:** `src/app/api/machine-week-shifts/route.ts:16` · **Kategorie:** Duplicita · **Závažnost:** Vysoká

```
function errorStatus(code: string): number {
```

**Dopad:** Stejná chyba vrací jiný HTTP status podle endpointu: SCHEDULE_VIOLATION je 422 v reflow routes, ale 500 v machine-week-shifts; VALIDATION_ERROR je 400 skoro všude, ale 500 v reflow; NOT_FOUND je 404 jinde, ale 400 v shift-assignments (inline ternary). Klient nemůže spolehlivě rozlišovat chyby a každá nová route opisuje vlastní verzi mapy pod jedním ze dvou jmen (errorStatus vs statusForCode). CLAUDE.md coding standard přitom cituje errorStatus(err.code), jako by byl sdílený — v src/lib/errors.ts ale neexistuje.

**Doporučení:** Přidat do src/lib/errors.ts jednu kanonickou funkci errorStatus(code: AppErrorCode): number pokrývající všechny kódy (vč. SCHEDULE_VIOLATION→422, CONFLICT/OVERLAP→409) a v 7 místech nahradit lokální kopie importem. Čistě mechanická náhrada bez změny chování tam, kde se mapy shodují; rozdíly (422 vs 500) sjednotit vědomě.

**Další výskyty:** `src/app/api/blocks/reflow/route.ts:23`, `src/app/api/blocks/[id]/reflow/route.ts:15`, `src/app/api/me/preferences/route.ts:7`, `src/app/api/blocks/[id]/notes/route.ts:10`, `src/app/api/blocks/[id]/notes/[noteId]/route.ts:10`, `src/app/api/shift-assignments/route.ts:39`

*Verifikace: Ověřeno 6 lokálních kopií funkce (machine-week-shifts:16, reflow:23, [id]/reflow:15, me/preferences:7, notes:10, notes/[noteId]:10) + inline ternary v shift-assignments = 7 míst; mapy skutečně divergují (SCHEDULE_VIOLATION 422 v reflow vs 500 v machine-week-shifts, VALIDATION_ERROR 500 v reflow, NOT_FOUND 400 v shift-assignments) a errors.ts žádný sdílený errorStatus neexportuje.*

### #58 — Formulář ruční položky je kompletně zduplikovaný mezi ExpediceBuilderPanel a ExpediceEditorPanel

**Soubor:** `src/app/expedice/_components/ExpediceBuilderPanel.tsx:119` · **Kategorie:** Duplicita · **Závažnost:** Vysoká

```
placeholder={kind === "INTERNAL_TRANSFER" ? "Volitelné" : "Např. 17521"}
```

**Dopad:** Builder (řádky 88-162) a Editor (řádky 329-404) obsahují identickou sadu polí (toggle Typ položky, Číslo zakázky, Popis, Poznámka, Doprava) včetně stejných placeholderů, stejné mapy KIND_LABELS (Builder:6-9, Editor:7-10), stejné definice inputStyle (Builder:68-75, Editor:217-224) a stejného injektovaného <style> bloku .expedice-input:focus (Builder:79-84, Editor:228-233). Každá změna formuláře (nové pole, validace, texty) se musí dělat 2× a už teď se drobně rozjíždějí (sectionLabel marginBottom 8 vs 4).

**Doporučení:** Extrahovat sdílenou komponentu (např. src/components/ManualItemFields.tsx s props value/onChange) používanou oběma panely; minimálně přesunout KIND_LABELS a inputStyle do jednoho modulu (expediceTypes.ts nebo lokální shared.ts) a <style> blok vložit jen jednou v ExpediceAside.

**Další výskyty:** `src/app/expedice/_components/ExpediceEditorPanel.tsx:360`, `src/app/expedice/_components/ExpediceEditorPanel.tsx:7`, `src/app/expedice/_components/ExpediceBuilderPanel.tsx:80`, `src/app/expedice/_components/ExpediceEditorPanel.tsx:229`

*Verifikace: Formulář je doslovně zduplikovaný (Builder 88–162 vs Editor 329–404) včetně KIND_LABELS, inputStyle a <style> bloku; divergence sectionLabel marginBottom 8 vs 4 potvrzena.*

### #55 — Expedice používá hardcoded bílé rgba barvy — v light mode je UI rozbité

**Soubor:** `src/app/expedice/_components/ExpediceCard.tsx:59` · **Kategorie:** Vizuál · **Závažnost:** Vysoká

```
hovered ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.07)"
```

**Dopad:** Aplikace má light theme jako systémový default (providers.tsx: defaultTheme="system", globals.css definuje světlou paletu v :root:not(.dark)). Celý modul expedice ale kreslí okraje karet, oddělovače, prázdné hodnoty a pomocné texty přes bílé rgba — na světlém pozadí jsou neviditelné (bílá na bílé). Planner i Rezervace používají var(--border)/var(--text-muted) a fungují v obou režimech; expedice je jediný denně používaný modul, který se v light modu vizuálně rozpadne.

**Doporučení:** Nahradit rgba(255,255,255,…) theme tokeny: okraje → var(--border) nebo color-mix(in oklab, var(--text) X%, transparent), tlumené texty → var(--text-muted). Jde o mechanickou náhradu ~15 míst bez změny logiky.

**Další výskyty:** `src/app/expedice/_components/ExpediceEditorPanel.tsx:219`, `src/app/expedice/_components/ExpediceDetailPanel.tsx:65`, `src/app/expedice/_components/ExpediceTimeline.tsx:147`, `src/app/expedice/_components/ExpediceQueuePanel.tsx:143`, `src/app/expedice/_components/ExpediceBuilderPanel.tsx:70`, `src/app/expedice/_components/ExpediceAside.tsx:328`, `src/app/expedice/_components/ExpedicePage.tsx:494`

*Verifikace: Ř. 59 sedí přesně, defaultTheme=system + světlá paleta v :root:not(.dark) potvrzeny a rgba(255,255,255,…) je ve všech 8 expedice souborech (~24 výskytů) — v light modu bílá na bílé.*

### #57 — getTodayKey v ExpediceTimeline počítá „dnes“ v UTC — duplikuje a diverguje od todayPragueDateStr

**Soubor:** `src/app/expedice/_components/ExpediceTimeline.tsx:21` · **Kategorie:** Duplicita · **Závažnost:** Vysoká

```
return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}
```

**Dopad:** src/lib/dateUtils.ts:117 exportuje todayPragueDateStr() (Europe/Prague), ale timeline si dnešek počítá lokálně přes getUTC*. Mezi 00:00 a 01:00/02:00 pražského času (UTC+1/+2) tak zvýraznění „Dnes“, modrý rámeček dne i auto-scroll na dnešek míří na včerejší den — a XL_106 jede noční směny, takže noční použití expedice je reálné. Zároveň klasický vzor divergence: sdílená utilita existuje, lokální kopie se odchýlila.

**Doporučení:** Smazat getTodayKey a importovat todayPragueDateStr z @/lib/dateUtils (jeden řádek). Při té příležitosti zvážit i utcDayOfWeek → civilDateDayOfWeek z téže knihovny.

**Další výskyty:** `src/app/expedice/_components/ExpediceTimeline.tsx:9`, `src/lib/dateUtils.ts:117`

*Verifikace: getTodayKey (ř. 19–22) počítá dnešek v UTC přes getUTC*, zatímco todayPragueDateStr existuje v src/lib/dateUtils.ts:117 — evidence sedí na ř. 21.*

### #93 — Dva formulářové jazyky: shadcn ui/ primitivy používá jen okruh Planneru, ostatní moduly re-implementují inputy inline

**Soubor:** `src/app/login/page.tsx:66` · **Kategorie:** Komponenty · **Závažnost:** Vysoká

```
onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
```

**Dopad:** Login ručně napodobuje ui/Input (onFocus/onBlur žonglování s borderColor, outline: none), PlanningForm má 6 native <select>, Reporty raw <input type=date> — zatímco Planner/BlockEdit používají ui/Input s focus-visible ringem. V modulech Rezervace/Expedice/Reporty/Tiskar/Login je jediný ui/ import LoadingSpinner (RezervacePage:9). Obchodník tak denně vidí jiné výšky, radiusy a focus chování než plánovač; každá oprava vzhledu formulářů se dělá dvakrát.

**Doporučení:** Pro nové a upravované formuláře mimo Planner sahat po ui/Input, ui/Button, ui/Textarea (v souladu s pravidlem CLAUDE.md „před stavbou nového UI použij existující komponenty"); začít loginem (2 inputy) — je malý a nejviditelnější.

**Další výskyty:** `src/app/rezervace/_components/PlanningForm.tsx:215`, `src/app/reporty/_components/ReportDashboard.tsx:558`, `src/app/rezervace/_components/RezervacePage.tsx:9`

*Verifikace: Login na ř. 66 ručně žongluje borderColor přes onFocus/onBlur, PlanningForm má 6 native <select>, ReportDashboard:558 raw <input type=date> a jediný ui/ import v modulech mimo Planner je LoadingSpinner (RezervacePage:9).*

### #65 — Hardcoded hex barvy místo theme tokenů; login CTA #FFE600 s color var(--bg) je v light modu nečitelné

**Soubor:** `src/app/login/page.tsx:116` · **Kategorie:** Vizuál · **Závažnost:** Vysoká · *(nezávisle nalezeno 2 lens agenty)*

```
background: "#FFE600",
```

**Dopad:** Login tlačítko má fixní žlutou a text color: var(--bg) (řádek 118) — v dark modu tmavý text na žluté (OK), ale v light modu je --bg téměř bílá (globals.css:117,152), takže vznikne bílý text na žlutém podkladu. Přitom existuje pár --brand/--brand-contrast přesně pro tento účel. Stejný vzor v rezervacích: míchání var(--danger) s natvrdo #dc2626/#10b981/#7c3aed (ReservationDetail, ReservationList, PlanningForm) — hex ignoruje jemné rozdíly light/dark odstínů tokenů.

**Doporučení:** Login CTA přepnout na background: var(--brand) + color: var(--brand-contrast). V rezervacích postupně nahradit #10b981→var(--success), #dc2626→var(--danger) (btnStyle už barvu bere parametrem, stačí měnit volání).

**Další výskyty:** `src/app/rezervace/_components/ReservationDetail.tsx:253`, `src/app/rezervace/_components/ReservationList.tsx:28`, `src/app/rezervace/_components/ReservationForm.tsx:317`, `src/app/rezervace/_components/PlanningForm.tsx:454`, `src/app/login/page.tsx:118`

*Verifikace: Login CTA má background #FFE600 (ř. 116) s color var(--bg) (ř. 118), přičemž light --bg je oklch(0.985…) ≈ bílá → bílý text na žluté; tokeny --brand/--brand-contrast existují (globals.css:158-159) a hex míchání v rezervacích sedí (#7c3aed PlanningForm:454 i ReservationForm:317, #10b981 ReservationDetail:253, #3b82f6 ReservationList:28).*

### #92 — Trojí barevný systém: sémantické tokeny existují, ale statusové barvy jsou natvrdo hex — v Reportech dokonce jiná paleta

**Soubor:** `src/app/reporty/_components/ReportDashboard.tsx:178` · **Kategorie:** Duplicita · **Závažnost:** Vysoká

```
SUBMITTED: "#f0883e", ACCEPTED: "#3b82f6", QUEUE_READY: "#a371f7",
```

**Dopad:** Stejná sémantika má v každém modulu jiný odstín: zelená úspěchu je #22c55e (29×), #10b981 (16×) i #3fb950, červená #ef4444 (24×) i #f85149 — a tokeny --success/--danger/--warning z globals.css:155-157 leží skoro nevyužité. Celkem 437 hex barev v .tsx; změna palety nebo doladění light mode znamená ruční hledání po celé aplikaci.

**Doporučení:** Zavést pravidlo „nové barvy jen přes var(--danger|success|warning|primary)" a jako první inkrement nahradit GitHub paletu (#f0883e/#3fb950/#f85149/#a371f7) v ReportDashboard tokeny — je izolovaná v pipelineColors a KpiCard props.

**Další výskyty:** `src/app/_components/PlannerPage.tsx:3243`, `src/app/_components/PlannerPage.tsx:3256`, `src/app/reporty/_components/ReportDashboard.tsx:200`, `src/app/globals.css:155`

*Verifikace: Řádek 178 má natvrdo hex paletu #f0883e/#3b82f6/#a371f7/#3fb950/#f85149 (dále 200, 220, 299-301, 363-369, 406), zatímco globals.css:155-157 definuje tokeny --danger/--success/--warning, které tu nejsou využité.*

### #72 — ReportDashboard: tělo dashboardu psáno češtinou bez diakritiky, header téhož souboru s diakritikou

**Soubor:** `src/app/reporty/_components/ReportDashboard.tsx:197` · **Kategorie:** Vizuál · **Závažnost:** Vysoká · *(nezávisle nalezeno 2 lens agenty)*

```
label="Vytizeni XL 105"
```

**Dopad:** Všechny KPI karty, sekce a legendy retro/outlook pohledu jsou bez diakritiky („Vytizeni", „Prutok zakazek", „Prumerna lead time", „Zadna aktivita", DOW_LABELS „Ut/Ct/Pa"), zatímco header stejné stránky má správné „Výhled", „Týden", „Období". Manažerský report tak vypadá neprofesionálně a nekonzistentně se zbytkem aplikace (TimelineGrid:402 má správné DAY_ABBR „Út/Čt/Pá").

**Doporučení:** Doplnit diakritiku do všech řetězců v RetroView/OutlookView (labely KpiCard, SectionHeader, pipelineLabels, DOW_LABELS) — čistě textová úprava bez změny logiky.

**Další výskyty:** `src/app/reporty/_components/ReportDashboard.tsx:109`, `src/app/reporty/_components/ReportDashboard.tsx:182`, `src/app/reporty/_components/ReportDashboard.tsx:208`, `src/app/reporty/_components/ReportDashboard.tsx:213`, `src/app/reporty/_components/ReportDashboard.tsx:238`, `src/app/reporty/_components/ReportDashboard.tsx:260`, `src/app/reporty/_components/ReportDashboard.tsx:400`, `src/app/reporty/_components/ReportDashboard.tsx:178`, `src/app/reporty/_components/ReportDashboard.tsx:299`, `src/app/reporty/_components/ReportDashboard.tsx:406`

*Verifikace: Řádek 197 obsahuje přesně label Vytizeni XL 105 a všechny citované řádky (109 DOW_LABELS, 182 pipelineLabels, 208-209, 238, 260, 400, 406) jsou skutečně bez diakritiky, zatímco header téhož souboru (Výhled, Týden, Období, Načítám data) diakritiku má.*

### #56 — ReservationList badge neumí stavy COUNTER_PROPOSED/CONFIRMED/WITHDRAWN — zobrazí raw DB string

**Soubor:** `src/app/rezervace/_components/ReservationList.tsx:104` · **Kategorie:** Komponenty · **Závažnost:** Vysoká

```
{STATUS_LABEL[r.status] ?? r.status}
```

**Dopad:** API bucket "active" reálně vrací i COUNTER_PROPOSED a bucket "archive" vrací CONFIRMED a WITHDRAWN (src/app/api/reservations/route.ts:30-31), ale STATUS_LABEL/STATUS_COLOR (řádky 19-33) tyto stavy nemají. Obchodník tak v záložce Moje aktivní vidí u protinávrhu anglický technický text „COUNTER_PROPOSED“ v šedém fallback stylu, zatímco ReservationDetail má pro tytéž stavy plné české UI (Protinávrh od plánovače, Potvrzeno, Rezervace stažena). Denně viditelná nekonzistence pro klíčový workflow protinávrhů.

**Doporučení:** Doplnit do STATUS_LABEL a STATUS_COLOR tři chybějící stavy: COUNTER_PROPOSED (např. „Protinávrh“, oranžová #f59e0b jako v detailu), CONFIRMED („Potvrzena“, zelená) a WITHDRAWN („Stažena“, červená).

**Další výskyty:** `src/app/rezervace/_components/ReservationList.tsx:46`

*Verifikace: STATUS_LABEL/STATUS_COLOR (ř. 19–33) opravdu postrádají COUNTER_PROPOSED/CONFIRMED/WITHDRAWN, fallback na raw string je přesně na ř. 104 a API buckety tyto stavy vracejí (reservations/route.ts:30-36).*

### #42 — AuditLogPanel má vlastní kopii audit formátovačů, která už divergovala od lib/auditFormatters

**Soubor:** `src/components/admin/AuditLogPanel.tsx:18` · **Kategorie:** Duplicita · **Závažnost:** Vysoká

```
const AUDIT_FIELD_LABELS: Record<string, string> = {
```

**Dopad:** Sdílený zdroj pravdy `src/lib/auditFormatters.ts` (FIELD_LABELS, 21 polí + fmtAuditVal) používají InfoPanel i BlockDetail, ale admin Audit log tab má vlastní AUDIT_FIELD_LABELS (jen 10 polí) a vlastní fmtVal. Divergence je už reálná: v admin auditu se pole materialInStock, materialIssued, pantoneRequired, blockVariant, obalka, vnitrky, tiskoveArchy, serie zobrazí surově (klíč pole + "true"/"false" nebo raw JSON) a AUTO_SHIFT en-dash spany se neformátují — tentýž AuditLog řádek vypadá v planneru správně a v adminu rozbitě. Každé nové auditované pole se musí přidávat na dvě místa.

**Doporučení:** Smazat lokální AUDIT_FIELD_LABELS a fmtVal a importovat FIELD_LABELS + fmtAuditVal z @/lib/auditFormatters (fmtAuditVal je nadmnožina se stejnou signaturou). Lokální PRAGUE_TIME_FMT lze nahradit formatPragueTime z @/lib/dateUtils.

**Další výskyty:** `src/components/admin/AuditLogPanel.tsx:1087`, `src/lib/auditFormatters.ts:3`, `src/components/admin/AuditLogPanel.tsx:1078`

*Verifikace: AUDIT_FIELD_LABELS na řádku 18 má jen 10 polí a lokální fmtVal (ř. 1087) neumí en-dash spany ani novější pole, zatímco lib/auditFormatters.ts má 21 polí a plný fmtAuditVal.*

### #27 — Mrtvé importy potlačené přes void se zavádějícím komentářem v BlockEdit

**Soubor:** `src/components/BlockEdit.tsx:34` · **Kategorie:** Mrtvý kód · **Závažnost:** Vysoká

```
// Suppress unused import warnings for re-exported symbols used in JSX
```

**Dopad:** 9 symbolů (TYPE_LABELS, Unlock, CalendarDays, Badge, Separator, Popover, PopoverContent, PopoverTrigger, JOB_PRESET_TONE_PALETTE) je importováno a nikde v JSX použito — komentář tvrdí opak. Kdo soubor edituje (nejčastěji upravovaná satelitní komponenta), z komentáře usoudí, že symboly odstranit nesmí; lint je kvůli void neodhalí. Navíc mrtvá konstanta SECTION (ř. 644–645) — string se styly, který nic nedělá.

**Doporučení:** Smazat void blok (ř. 34–43), nepoužívané importy (ř. 9–12, 27, 30) a SECTION + void SECTION (ř. 644–645). npm run build ověří, že nic nechybělo.

**Další výskyty:** `src/components/BlockEdit.tsx:644`

*Verifikace: Všech 9 symbolů je v souboru jen v importu a ve void bloku (ř. 34–43), nikde v JSX; mrtvá konstanta SECTION + void SECTION na ř. 644–645 taky sedí.*

### #28 — Hardcoded bílé pozadí v tiskařských komponentách rozbíjí dark mode

**Soubor:** `src/components/OrderSearchSheet.tsx:65` · **Kategorie:** Vizuál · **Závažnost:** Vysoká

```
background: "white",
```

**Dopad:** App má defaultTheme="system" a ThemeToggle přímo v tiskař headeru (PlannerPage:3055). V dark módu je sheet vyhledávání bílý, texty výsledků ale dědí světlou barvu z body a input má tmavé var(--surface-2) — nečitelná kombinace. Totéž TiskarMachineToggle: aktivní pill background "white" + color var(--text) → v dark módu světlý text na bílé. Obě komponenty tiskaři používají denně.

**Doporučení:** Nahradit "white" za var(--surface) a rgba(0,0,0,…) hover/badge barvy za color-mix s var(--text)/var(--border), jak to dělají ostatní komponenty (např. MultiSelectDropdown).

**Další výskyty:** `src/components/TiskarMachineToggle.tsx:40`, `src/components/OrderSearchSheet.tsx:127`, `src/components/OrderSearchSheet.tsx:142`

*Verifikace: background:"white" na ř. 65 potvrzen, stejně rgba hover/badge (ř. 127/142) a TiskarMachineToggle:40 (white pill + color var(--text)); app má defaultTheme=system a ThemeToggle v tiskař headeru, takže dark mode je reálně rozbitý.*

### #71 — Modul /tiskar je nedosažitelný pro všechny role — 783 řádků mrtvého kódu

**Soubor:** `src/middleware.ts:32` · **Kategorie:** Mrtvý kód · **Závažnost:** Vysoká

```
if (pathname.startsWith("/admin") || pathname.startsWith("/tiskar") || pathname.startsWith("/rezervace")) {
```

**Dopad:** Middleware blokuje /tiskar roli TISKAR (ř. 32) i všem ostatním (ř. 38) — TiskarMonitor.tsx (742 ř.) + tiskar/page.tsx (41 ř.) se nikdy nevykreslí. Login přitom TISKAR na /tiskar stále posílá (login/page.tsx:32), takže každé přihlášení tiskaře projde zbytečným double-redirectem a vývojář čtoucí login uvěří, že tiskaři žijí na /tiskar, a bude tam ladit kód, který se nikdy nezobrazí. CLAUDE.md stav zmiňuje jen jako poznámku („middleware vede tiskaře přes /"), rozhodnutí o osudu modulu chybí.

**Doporučení:** Rozhodnout osud modulu: buď smazat src/app/tiskar/ + větev `data.role === "TISKAR" ? "/tiskar" : "/"` v loginu + obě /tiskar větve v middleware, nebo modul oživit (povolit TISKAR v middleware). Minimální okamžitý krok: sjednotit login redirect na "/".

**Další výskyty:** `src/middleware.ts:38`, `src/app/login/page.tsx:32`, `src/app/tiskar/page.tsx:10`, `src/app/tiskar/_components/TiskarMonitor.tsx:194`

*Verifikace: Middleware ř. 32 blokuje /tiskar roli TISKAR a ř. 38 všem ostatním, login (login/page.tsx:32) tam TISKAR stále posílá — 782 řádků modulu je nedosažitelných; CLAUDE.md to zmiňuje jen jako poznámku bez rozhodnutí, ne jako záměr.*

## Nálezy — Střední (63)

### #9 — DatePickerField: sdílený datepicker 5 modulů žije v app/_components a duplikuje mrtvou ui/calendar

**Soubor:** `src/app/_components/DatePickerField.tsx:44` · **Kategorie:** Komponenty · **Závažnost:** Střední

```
export default function DatePickerField({
```

**Dopad:** DatePickerField importuje 7 souborů napříč moduly (rezervace ReservationForm/PlanningForm, expedice, BlockEdit, BlockDetail, admin AuditLogPanel), ale žije v privátní složce planneru src/app/_components/ — porušuje konvenci „standalone komponenty do src/components/" a je hůř dohledatelný. Zároveň ručně reimplementuje kalendářní grid + portál, zatímco shadcn src/components/ui/calendar.tsx není importována nikde v repu (ověřeno grep) — dvě kalendářní implementace, z toho jedna mrtvá. Navíc hardcoded #3b82f6 pro vybraný den (ř. 232–234) a zIndex 9999 mimo škálu.

**Doporučení:** 1) Přesunout DatePickerField.tsx do src/components/ (named export) a přepsat 7 importů. 2) Rozhodnout osud ui/calendar.tsx: smazat jako mrtvý kód, nebo (větší krok, volitelný) postavit DatePickerField nad ui/calendar + ui/popover. Krok 1 je bezrizikový a stačí sám o sobě.

**Další výskyty:** `src/app/_components/PlannerPage.tsx:42`, `src/app/_components/DatePickerField.tsx:191`, `src/app/_components/DatePickerField.tsx:232`

*Verifikace: DatePickerField (default export na ř. 44) žije v app/_components, importuje ho 7 souborů napříč moduly a ui/calendar.tsx nemá v repu žádný import (grep 0 výskytů).*

### #101 — Focus-visible mimo ui/ neexistuje: 0 výskytů v aplikačním kódu, 37× inline outline:"none" bez náhrady

**Soubor:** `src/app/_components/DatePickerField.tsx:164` · **Kategorie:** Vizuál · **Závažnost:** Střední

```
cursor: "pointer", outline: "none", whiteSpace: "nowrap",
```

**Dopad:** Grep: focus-visible se mimo ui/ primitivy nevyskytuje ani jednou (v globals.css jen .audit-input/.audit-chip); 37 prvků si outline vypíná inline bez náhrady — trigger DatePickerFieldu tak při tab navigaci nemá žádnou viditelnou indikaci fokusu. Aplikace přitom na klávesnici stojí (Ctrl+C/V/X, Esc, Enter v hledání).

**Doporučení:** Přidat do globals.css jedno globální pravidlo :where(button, a, [role="button"], input, select, textarea):focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; } — pokryje i inline-stylované prvky bez zásahu do komponent; poté postupně mazat lokální outline:"none".

**Další výskyty:** `src/app/login/page.tsx:64`, `src/app/globals.css:278`

*Verifikace: Grep potvrdil přesně 37 výskytů outline:"none" v .tsx a focus-visible mimo ui/ jen u .audit-input/.audit-chip v globals.css; trigger DatePickerFieldu (ř. 164/172) nemá žádnou focus indikaci.*

### #99 — DatePickerField je kompletní custom kalendář duplikující mrtvý ui/calendar — s natvrdo modrou #3b82f6 místo --primary

**Soubor:** `src/app/_components/DatePickerField.tsx:232` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
background: isSelected ? "#3b82f6" : isToday && !isSelected ? "rgba(59,130,246,0.15)" : "transparent",
```

**Dopad:** V repu existují dvě implementace kalendáře: mrtvá shadcn (react-day-picker, tokeny, klávesová a11y) a živá ruční (vlastní grid, portál, zIndex 9999). Custom výběr dne je natvrdo #3b82f6, dnešek #3b82f6 border — ignoruje --primary/--ring, takže případná změna primární barvy kalendář nezasáhne.

**Doporučení:** Minimálně nahradit #3b82f6 a rgba(59,130,246,…) v DatePickerField za var(--primary)/color-mix s var(--primary); dlouhodobě zvolit jedinou kalendářovou implementaci (viz nález o mrtvých ui/ primitivech).

**Další výskyty:** `src/app/_components/DatePickerField.tsx:234`, `src/app/_components/DatePickerField.tsx:233`

*Verifikace: Řádek 232 sedí přesně — vybraný den natvrdo #3b82f6, dnešek rgba(59,130,246,0.15) a border #3b82f6 (ř. 233–234), žádný var(--primary); ui/calendar je mrtvá duplicita.*

### #5 — ShutdownManager (~266 řádků), MachinePicker a ResizeHandle žijí inline v orchestrátoru

**Soubor:** `src/app/_components/PlannerPage.tsx:181` · **Kategorie:** Struktura · **Závažnost:** Střední

```
function ShutdownManager({
```

**Dopad:** Tři standalone UI komponenty (ShutdownManager ř. 181–446, MachinePicker ř. 161, ResizeHandle ř. 449) jsou definované přímo v PlannerPage.tsx — v rozporu s vlastním standardem projektu v CLAUDE.md („Nové UI komponenty — do src/components/, ne inline… soubor byl záměrně dekomponován"). Přidávají ~310 řádků do už tak 4446řádkového souboru a nejsou dohledatelné tam, kde je vývojáři hledají.

**Doporučení:** Přesunout ShutdownManager (i s MachinePicker a typem EditState) do src/components/ShutdownManager.tsx a ResizeHandle do src/components/ jako named exporty; PlannerPage je jen importuje. Čistě mechanická extrakce, props už jsou definované (~-310 řádků).

**Další výskyty:** `src/app/_components/PlannerPage.tsx:161`, `src/app/_components/PlannerPage.tsx:449`

*Verifikace: MachinePicker (ř. 161), ShutdownManager (ř. 181–446) a ResizeHandle (ř. 449) jsou definované inline v PlannerPage.tsx v rozporu se standardem CLAUDE.md o komponentách v src/components/.*

### #6 — Job Builder = ~1200 řádků state + logiky + JSX uvnitř PlannerPage — extrahovat panel a hook

**Soubor:** `src/app/_components/PlannerPage.tsx:574` · **Kategorie:** Struktura · **Závažnost:** Střední

```
// Builder form fields
```

**Dopad:** Builder je největší souvislý region souboru: ~20 useState polí (ř. 574–616), preset/queue/series logika (buildBuilderPresetDraft, applyPresetToBuilder, resetBuilderForm, handleAddToQueue, handleScheduleSeries, generateSeriesPreview — ř. 1893–2221) a ~820 řádků JSX pravého aside (ř. 3509–4326). Dohromady ~1200 řádků, které s orchestrací timeline nesouvisí, ale nafukují každý diff a re-render úvahy v PlannerPage.

**Doporučení:** Extrahovat komponentu src/components/planner/JobBuilderPanel.tsx (JSX 3509–4326 + fronta/rezervační fronta) a hook useJobBuilder (state + preset/series logika). Rozhraní: showToast, blocks/companyDays/machineWeekShifts (preview série), onBlockCreate, queue settery. Odhad: PlannerPage klesne o ~1100–1200 řádků na ~3300.

**Další výskyty:** `src/app/_components/PlannerPage.tsx:1893`, `src/app/_components/PlannerPage.tsx:3509`, `src/app/_components/PlannerPage.tsx:4196`

*Verifikace: Builder state začíná na ř. 574 (komentář „Builder form fields"), logika buildBuilderPresetDraft/applyPresetToBuilder/resetBuilderForm/handleAddToQueue/handleScheduleSeries/generateSeriesPreview leží na ř. 1893–2221 a JSX aside končí na ř. 4327 — rozsahy sedí.*

### #7 — SSE + reconnect + 5min polling + applyServerBlocks (~215 řádků) patří do custom hooku

**Soubor:** `src/app/_components/PlannerPage.tsx:1014` · **Kategorie:** Struktura · **Závažnost:** Střední

```
const handleSSEEvent = useCallback((msg: SSEMessage) => {
```

**Dopad:** Region ř. 994–1208 (applyServerBlocks, handleSSEEvent s 9 typy událostí, handleSSEReconnect, heartbeat/offline interval, pollBlocks) je uzavřená synchronizační mašinerie s vlastními invarianty (merge vs. autoritativní fetch, editingBlockIdsRef guard) zadrátovaná mezi UI handlery. Kdo ladí sync bugy, musí je hledat uprostřed 4400řádkového souboru; invarianty popsané v komentářích se snadno rozbijí nesouvisejícím zásahem.

**Doporučení:** Extrahovat hook src/hooks/useBlockSync.ts (vstup: setBlocks/setSelectedBlock/setEditingBlock, editingBlockIdsRef, clipboard refy, showToast; výstup: sseOffline, applyServerBlocks). useSSE hook už existuje — jde jen o přesun orchestrační vrstvy nad ním (~-215 řádků).

**Další výskyty:** `src/app/_components/PlannerPage.tsx:994`, `src/app/_components/PlannerPage.tsx:1125`, `src/app/_components/PlannerPage.tsx:1175`

*Verifikace: Region ř. 994–1208 obsahuje applyServerBlocks (1002), handleSSEEvent (1014), handleSSEReconnect (1125) a 5min pollBlocks interval (1206) a hook src/hooks/useSSE.ts existuje — přesun orchestrační vrstvy je proveditelný.*

### #11 — Tři 13–19řádkové kaskády setterů builder draftu (apply/clear/reset) nad ~20 useState

**Soubor:** `src/app/_components/PlannerPage.tsx:1936` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
function clearBuilderPresetSelection() {
```

**Dopad:** applyPresetToBuilder (ř. 1912), clearBuilderPresetSelection (ř. 1936) a resetBuilderForm (ř. 1954) opakují tutéž kaskádu setBlockVariant/setBSpecifikace/…setBJobPresetLabel nad ~20 samostatnými useState poli builderu. Nové builder pole = 3–4 místa k doplnění (state, apply, clear, reset, buildBuilderPresetDraft) — přesně ten typ divergence, kde jedno místo zapomene resetovat.

**Doporučení:** Sloučit builder draft do jednoho useState<JobPresetDraftValues & {…}> (typ už existuje v src/lib/jobPresets.ts): apply/clear/reset se stanou jedním setDraft(next) a kaskády zmizí. Přirozeně zapadá do extrakce useJobBuilder hooku (viz nález Job Builder).

**Další výskyty:** `src/app/_components/PlannerPage.tsx:1912`, `src/app/_components/PlannerPage.tsx:1954`, `src/app/_components/PlannerPage.tsx:1893`

*Verifikace: Tři kaskády ~14 setterů (applyPresetToBuilder ř. 1912, clearBuilderPresetSelection ř. 1936, resetBuilderForm ř. 1954) nad samostatnými useState builderu skutečně existují a duplikují se s buildBuilderPresetDraft (ř. 1893).*

### #95 — z-index bez škály: ~20 ad-hoc hodnot od 2 do 10000, ui/ portály (z-50) dva řády pod app overlay vrstvami

**Soubor:** `src/app/_components/PlannerPage.tsx:2946` · **Kategorie:** Struktura · **Závažnost:** Střední

```
position: "fixed", inset: 0, zIndex: 10000
```

**Dopad:** Inline zIndex hodnoty: 2, 4, 5, 8, 9, 10, 16, 20, 30, 31, 50, 100, 200, 400, 500, 600, 1000, 9998, 9999, 10000 — bez jakéhokoli systému. Shadcn portály (Popover, ContextMenu, Select) mají z-50, takže jakýkoli ui/ portál otevřený nad vrstvou 9998–10000 skončí pod ní. Každá nová vrstva se dnes volí odhadem a riskuje překryv.

**Doporučení:** Definovat škálu jako CSS custom properties v globals.css (např. --z-sticky:50, --z-overlay:100, --z-modal:200, --z-toast:300) a při každém dotyku souboru mapovat inline hodnoty na tokeny; nové overlaye nesmí zavádět další ad-hoc čísla.

**Další výskyty:** `src/components/ToastContainer.tsx:29`, `src/app/_components/TimelineGrid.tsx:624`, `src/app/admin/_components/AdminDashboard.tsx:193`, `src/app/_components/DatePickerField.tsx:191`

*Verifikace: Inline zIndex napříč src/ pokrývá ~26 ad-hoc hodnot od 1 do 10000 (vč. 9998/9999/10000 v PlannerPage ř. 2946/2991), zatímco shadcn portály (popover, select, context-menu, tooltip) mají z-50.*

### #105 — Potvrzovací dialogy mazání mají natvrdo tmavé pozadí #262630 — ve světlém tématu zůstávají tmavým ostrovem

**Soubor:** `src/app/_components/PlannerPage.tsx:2950` · **Kategorie:** Vizuál · **Závažnost:** Střední

```
background: "#262630", borderRadius: 16, padding: "24px 28px"
```

**Dopad:** Dialog „Smazat blok?" i hromadné mazání (ř. 2995) mají hardcoded #262630 + texty #f1f5f9/#94a3b8 — v light mode se uprostřed světlé aplikace otevře tmavý panel. Mazání je pro plánovače častá akce; tokeny --popover/--card-foreground/--text-muted pro všechny tři hodnoty existují.

**Doporučení:** Nahradit #262630 za var(--popover), #f1f5f9 za var(--text) a #94a3b8 za var(--text-muted) — vizuál v dark mode zůstane prakticky stejný, light mode se srovná.

**Další výskyty:** `src/app/_components/PlannerPage.tsx:2995`, `src/app/_components/PlannerPage.tsx:2954`

*Verifikace: Oba delete dialogy mají hardcoded #262630 (ř. 2950, 2995) + texty #f1f5f9/#94a3b8, přičemž tokeny --popover, --text a --text-muted v globals.css existují pro light i dark režim.*

### #94 — V jedné toolbar liště Planneru se míchá raw \<button style> s ui/Button, jehož variantu popírá style override

**Soubor:** `src/app/_components/PlannerPage.tsx:3050` · **Kategorie:** Komponenty · **Závažnost:** Střední

```
🔍 Najít
```

**Dopad:** Raw tlačítko „🔍 Najít" (inline styl, žádný focus-visible, emoji ikona) stojí hned vedle ui/Button „Dnes" (ř. 3052), který zase dostává style={{ borderColor, background, color }} přepisující variant systém. Dvě generace tlačítek vedle sebe = jiný focus ring, jiná výška, jiné hover chování; variant systém CVA ztrácí smysl, když se obchází přes style.

**Doporučení:** Sjednotit toolbar na ui/Button (variant="outline", size="sm"); opakované style overridy povýšit na novou CVA variantu (např. „toolbar") v buttonVariants místo inline objektů.

**Další výskyty:** `src/app/_components/PlannerPage.tsx:3052`, `src/app/_components/PlannerPage.tsx:3056`, `src/app/_components/PlannerPage.tsx:3034`

*Verifikace: Raw <button> „🔍 Najít" s inline stylem (ř. 3034–3051) stojí vedle ui/Button „Dnes" (ř. 3052), jehož outline variantu přepisuje style={{borderColor, background, color}}; třetí raw button „Odhlásit" na ř. 3056.*

### #8 — Plný header (~265 řádků JSX) se 4× zkopírovaným stylem nav odkazů — extrahovat PlannerHeader

**Soubor:** `src/app/_components/PlannerPage.tsx:3063` · **Kategorie:** Struktura · **Závažnost:** Střední

```
{!isTiskar && <header className="flex-shrink-0 px-4 py-2 flex items-center gap-4"
```

**Dopad:** Header pro ne-tiskaře (ř. 3063–3328) je monolit: search + navigace + přepínače. Odkazy Správa/Reporty/Rezervace/Expedice (ř. 3237–3284) mají 4× identický inline styl lišící se jen hardcoded hex barvou (#3b82f6, #10b981, #7c3aed, #f97316); TISKAR header (ř. 3014–3060) k tomu duplikuje Odhlásit/Dnes/ThemeToggle. V témže headeru se míchá ui/Button („Dnes", ř. 3127) s raw <button> („Odhlásit" ř. 3318, zámek ř. 3203) — vizuálně podobné, ale jiné hover/focus chování.

**Doporučení:** Extrahovat src/components/planner/PlannerHeader.tsx (props: search stav, daysAhead/Back settery, role flagy, callbacky) a uvnitř zavést malý lokální NavLink helper (barva jako prop) místo 4 kopií stylu. Nerušit rozhodnutí „žádná globální AppNav" — navigace zůstane v headeru planneru.

**Další výskyty:** `src/app/_components/PlannerPage.tsx:3237`, `src/app/_components/PlannerPage.tsx:3250`, `src/app/_components/PlannerPage.tsx:3262`, `src/app/_components/PlannerPage.tsx:3275`, `src/app/_components/PlannerPage.tsx:3014`

*Verifikace: Header ne-tiskaře začíná na ř. 3063 a končí ř. 3329, 4 nav odkazy s hardcoded barvami #3b82f6/#10b981/#7c3aed/#f97316 (ř. 3243/3256/3268/3281), TISKAR header (3014–3060) duplikuje Odhlásit/ThemeToggle a mix ui/Button (3127) s raw <button> (3203, 3318) sedí.*

### #10 — CTA tlačítka builderu: hardcoded #FFE600 a rgba disabled stav mimo theme systém

**Soubor:** `src/app/_components/PlannerPage.tsx:4175` · **Kategorie:** Vizuál · **Závažnost:** Střední

```
background: orderNumber.trim() ? "#FFE600" : "rgba(255,255,255,0.06)",
```

**Dopad:** Obě hlavní CTA („+ Přidat do fronty" ř. 4169 a „Naplánovat sérii" ř. 4142) jsou dvě téměř identické kopie s natvrdo #FFE600/#111, přestože systém má var(--brand)/var(--brand-contrast) (používané hned vedle na ř. 4201 u badge fronty a ř. 3163 u 30/60/90 přepínače). Disabled stav rgba(255,255,255,0.06) + text rgba(255,255,255,0.2) je kalibrovaný jen na dark theme — v light módu je disabled tlačítko téměř neviditelné. Duplicitní inline scale-on-press handlery (onMouseDown/Up/Leave) 2×.

**Doporučení:** Extrahovat jedno PrimaryCta tlačítko (nebo variantu ui/Button) s background var(--brand), color var(--brand-contrast) a disabled barvami z CSS proměnných; použít na obou místech. #FFE600 nechat pouze jako hodnotu --brand v globálním CSS.

**Další výskyty:** `src/app/_components/PlannerPage.tsx:4148`, `src/app/_components/PlannerPage.tsx:4142`

*Verifikace: Ř. 4175 obsahuje přesně #FFE600/rgba disabled, duplicitní CTA na ř. 4142–4157 vč. scale-on-press handlerů, zatímco var(--brand)/var(--brand-contrast) se používá na ř. 4201 i 3163.*

### #18 — Nepoužité vizuální konstanty a helpery (COMPANY_DAY_CHIP_STYLE, *_STRONG, chipStateBg/Border, MACHINE_GAP_W)

**Soubor:** `src/app/_components/TimelineGrid.tsx:56` · **Kategorie:** Mrtvý kód · **Závažnost:** Střední

```
const COMPANY_DAY_CHIP_STYLE: CSSProperties = {
```

**Dopad:** COMPANY_DAY_CHIP_STYLE se tváří jako „sdílený styl pro label chip company day overlaye", ale nikde se nepoužívá — skutečné chipy odstávky jsou inline duplikáty na ř. 3495 a 3740. Stejně mrtvé jsou MACHINE_GAP_W (66), SUCCESS/WARNING/DANGER/EARLY_START_STRONG (566–569, komentář ironicky říká „eliminace duplicity") a chipStateBg/chipStateBorder (572–585). Kdo mění barvu chipu, upraví mrtvou konstantu a diví se, že se nic nestalo.

**Doporučení:** Buď konstanty skutečně zapojit (COMPANY_DAY_CHIP_STYLE aplikovat na ř. 3495/3740), nebo všech šest deklarací smazat — jednořádkový úklid bez rizika.

**Další výskyty:** `src/app/_components/TimelineGrid.tsx:66`, `src/app/_components/TimelineGrid.tsx:566`, `src/app/_components/TimelineGrid.tsx:572`, `src/app/_components/TimelineGrid.tsx:579`, `src/app/_components/TimelineGrid.tsx:3495`, `src/app/_components/TimelineGrid.tsx:3740`

*Verifikace: Grep potvrzuje, že COMPANY_DAY_CHIP_STYLE, MACHINE_GAP_W, čtyři *_STRONG konstanty i chipStateBg/Border existují jen v místě definice; skutečné company-day chipy jsou inline duplikáty na ř. 3495 a 3740.*

### #25 — Lokální kopie MACHINES obchází deklarovaný jediný zdroj pravdy v lib/machines.ts

**Soubor:** `src/app/_components/TimelineGrid.tsx:74` · **Kategorie:** Duplicita · **Závažnost:** Střední · *(nezávisle nalezeno 2 lens agenty)*

```
const MACHINES = ["XL_105", "XL_106"] as const;
```

**Dopad:** src/lib/machines.ts se komentářem prohlašuje za „jediný zdroj pravdy pro seznam tiskových strojů" (etapa 7 sjednotila 5 serverových kopií), ale klientská kopie v TimelineGrid zůstala. Při přidání stroje je to další skryté místo k objevení; blockedOverlays (ř. 3254) navíc klíčuje literály XL_105/XL_106 natvrdo.

**Doporučení:** Importovat MACHINES z @/lib/machines (čistá konstanta bez DB závislostí, klient-safe) a lokální deklaraci smazat.

**Další výskyty:** `src/lib/machines.ts:2`, `src/app/_components/TimelineGrid.tsx:3254`, `src/components/admin/MachineWorkHoursWeek.tsx:34`, `src/components/admin/ShiftRoster.tsx:42`, `src/components/admin/MachineWorkHoursWeek.tsx:35`, `src/components/admin/ShiftRoster.tsx:43`

*Verifikace: Lokální `const MACHINES = ["XL_105", "XL_106"] as const` je na ř. 74, src/lib/machines.ts se deklaruje jako jediný zdroj pravdy (klient-safe, bez DB) a blockedOverlays na ř. 3254 navíc klíčuje literály natvrdo; TimelineGrid z @/lib/machines neimportuje.*

### #22 — InlineDatePicker je ručně psaný kalendář vedle existující ui/calendar komponenty

**Soubor:** `src/app/_components/TimelineGrid.tsx:591` · **Kategorie:** Komponenty · **Závažnost:** Střední

```
function InlineDatePicker({
```

**Dopad:** ~120 řádků vlastního kalendáře (výpočet mřížky, měsíční navigace, dnešek/výběr) včetně inline SVG šipek (ř. 638), přestože projekt má shadcn Calendar nad react-day-picker (src/components/ui/calendar.tsx) a lucide-react ChevronLeft/Right je k dispozici. Dva kalendáře v aplikaci = dva vzhledy a dvojí údržba (lokalizace, focus stavy, klávesnice).

**Doporučení:** Inkrementálně: 1) přesunout InlineDatePicker do src/components/planner/ (soulad s pravidlem CLAUDE.md), 2) v dalším kroku vnitřek nahradit ui/calendar + Popover se zachováním tlačítek Skladem/Vydáno a fixed pozicování.

**Další výskyty:** `src/app/_components/TimelineGrid.tsx:638`, `src/components/ui/calendar.tsx:14`

*Verifikace: InlineDatePicker je ručně psaný kalendář na ř. 591 s inline SVG šipkami na ř. 638, zatímco src/components/ui/calendar.tsx (shadcn nad react-day-picker s lucide Chevron ikonami) existuje.*

### #17 — TimelineGrid.tsx má 4216 řádků a 6 inline komponent — proti vlastnímu pravidlu projektu

**Soubor:** `src/app/_components/TimelineGrid.tsx:913` · **Kategorie:** Struktura · **Závažnost:** Střední

```
function BlockCard({
```

**Dopad:** Regiony: konstanty+typy (1–302), geometrie/svátky (304–399), vizuální config (401–590), InlineDatePicker (591–711), DateBadge/MiniChip/ProductionChips/MaterialNoteAffordance (713–910), BlockCard (913–2218, ~1300 ř.), pak orchestrátor: drag/mouse engine (2450–2823, ~375 ř.), split flow (2869–3069), header+reflow (3071–3151), precompute overlayů (3153–3406), render sloupců (3408–4126). CLAUDE.md přitom ukládá „standalone UI komponenty do src/components/, ne inline do velkých souborů". Review, hotfixy i merge mezi větvemi Vojta/Michal jsou v jednom 4k souboru zbytečně drahé.

**Doporučení:** Postupná extrakce čistým přesunem bez změny chování: 1) BlockCard + pomocné komponenty (DateBadge, MiniChip, ProductionChips, MaterialNoteAffordance, InlineDatePicker) do src/components/planner/ (~1800 řádků pryč), 2) globální mouse/drag useEffect do hooku useTimelineDrag (~375 ř.), 3) vizuální config do src/lib/blockStyles.ts (viz nález o duplicitě s TiskarMonitor).

**Další výskyty:** `src/app/_components/TimelineGrid.tsx:591`, `src/app/_components/TimelineGrid.tsx:714`, `src/app/_components/TimelineGrid.tsx:2450`, `src/app/_components/TimelineGrid.tsx:406`, `src/app/_components/TimelineGrid.tsx:2221`

*Verifikace: Soubor má přesně 4216 řádků, BlockCard začíná přesně na ř. 913, 6 inline komponent existuje a pravidlo CLAUDE.md o komponentách v src/components/ platí; extrakce není zdokumentována jako vědomě odložená.*

### #21 — z-index hodnoty bez centrální škály (1–31, 200, 400, 500, 9998–9999)

**Soubor:** `src/app/_components/TimelineGrid.tsx:1933` · **Kategorie:** Vizuál · **Závažnost:** Střední

```
zIndex: 9999,
```

**Dopad:** V gridu se vrství ~15 různých z-index hodnot rozesetých inline: badge 3–4, drag stavy 5–20, queue preview 15, landing 16, paste marker 25, header/handles 30–31, hover card 200, note popover 400, context menu 500, tooltip/lasso/datepicker 9998–9999. Jediná dokumentace je komentář u deadline badge (ř. 1214). Přidání nového overlaye znamená licitaci pokus–omyl a riziko, že tooltip překryje menu (9999 > 500).

**Doporučení:** Zavést pojmenované konstanty v jednom modulu (např. src/lib/zLayers.ts: Z.BADGE, Z.DRAG, Z.PASTE_MARKER, Z.POPOVER…) a literály mechanicky nahradit — žádná změna chování, jen čitelná škála (platí i pro ShiftEdgeHandles 30/31).

**Další výskyty:** `src/app/_components/TimelineGrid.tsx:624`, `src/app/_components/TimelineGrid.tsx:887`, `src/app/_components/TimelineGrid.tsx:1824`, `src/app/_components/TimelineGrid.tsx:2096`, `src/app/_components/TimelineGrid.tsx:3849`, `src/components/planner/ShiftEdgeHandles.tsx:55`, `src/app/_components/TimelineGrid.tsx:4141`

*Verifikace: Inline z-index hodnoty 1–31, 200, 400, 500, 9998–9999 ověřeny grepem (vč. zIndex: 9999 přesně na ř. 1933 a ShiftEdgeHandles 30/31), jediná dokumentace je komentář u ř. 1213.*

### #23 — Tmavý styl ContextMenu definovaný inline 4× místo v sdílené ui komponentě

**Soubor:** `src/app/_components/TimelineGrid.tsx:2096` · **Kategorie:** Komponenty · **Závažnost:** Střední

```
background: "#1c1c1e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "4px", minWidth: 180
```

**Dopad:** ContextMenuContent/SubContent dostávají identický dark-glass styl na 3 místech (2096, 2105, 4098) a položky mají dvě kopie stylu — menuItemStyle v BlockCard (1154) a menuItemStyleEmpty (2326, komentář sám přiznává „analogie BlockCard.menuItemStyle"). Sdílená src/components/ui/context-menu zůstává nestylovaná, takže použití jinde v aplikaci by vypadalo jinak než v planneru.

**Doporučení:** Přesunout vzhled do ui/context-menu.tsx (default className na Content/Item) nebo aspoň exportovat sdílené konstanty MENU_CONTENT_STYLE/MENU_ITEM_STYLE z jednoho místa a všechna 4+2 místa na ně napojit.

**Další výskyty:** `src/app/_components/TimelineGrid.tsx:2105`, `src/app/_components/TimelineGrid.tsx:4098`, `src/app/_components/TimelineGrid.tsx:1154`, `src/app/_components/TimelineGrid.tsx:2326`

*Verifikace: Identický inline dark styl ContextMenuContent/SubContent je na ř. 2096, 2105 a 4098 a styly položek jsou duplikované v menuItemStyle (ř. 1154) a menuItemStyleEmpty (ř. 2326 s komentářem přiznávajícím analogii); sdílená ui/context-menu.tsx existuje nestylovaná.*

### #19 — BlockedOverlay vláčí 5 polí, která render nečte — pozůstatek zrušeného modelu výjimek

**Soubor:** `src/app/_components/TimelineGrid.tsx:3291` · **Kategorie:** Mrtvý kód · **Závažnost:** Střední

```
const isException = false;
```

**Dopad:** Typ BlockedOverlay (ř. 159–163) definuje overlayType, effectiveStartSlot/EndSlot, isException a exceptionId; všech 10 push míst je poctivě plní (isException/excId jsou konstanty false/null), ale render overlaye (ř. 3756–3760) čte jen key/top/height. Jde o relikt MachineScheduleException modelu zrušeného ve Sprintu E — čtenář hledá výjimkovou logiku, která už neexistuje.

**Doporučení:** Zredukovat BlockedOverlay na { key, top, height } (příp. machine pro klíčování), smazat konstanty isException/excId a zúžit všechna push volání — mechanická změna, TypeScript ji ohlídá.

**Další výskyty:** `src/app/_components/TimelineGrid.tsx:159`, `src/app/_components/TimelineGrid.tsx:3298`, `src/app/_components/TimelineGrid.tsx:3374`

*Verifikace: isException=false na ř. 3291, typ BlockedOverlay (153–163) nese 5 polí, která render na 3756–3759 nečte (jen key/top/height); jediná drobnost: push míst je 7, ne 10, jádro nálezu ale platí.*

### #20 — Lock/Hourglass/CompanyDay overlaye časových sloupců duplikované verbatim 2–3×

**Soubor:** `src/app/_components/TimelineGrid.tsx:3610` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
{viewStart && (lockedBlocksByMachine.get(visibleMachines[colIdx]) ?? []).map((lb) => {
```

**Dopad:** Amber lock overlay a fialový hourglass overlay jsou zkopírované mezi prvním časovým sloupcem (3508–3550) a mezisloupcem druhého stroje (3610–3652) — identické JSX vč. výpočtu clampu, liší se jen prefix klíče. Chip odstávky (company day) existuje dokonce 3× (3481, 3736 + duplikát stylů viz mrtvá COMPANY_DAY_CHIP_STYLE). Úprava vzhledu zámkového pruhu se snadno provede jen na jednom místě.

**Doporučení:** Extrahovat malou komponentu (např. TimeColumnOverlays s props machine/blocks) a použít ji v obou sloupcích; company-day chip vytáhnout jako CompanyDayChip sdílený časovým i strojovým sloupcem.

**Další výskyty:** `src/app/_components/TimelineGrid.tsx:3508`, `src/app/_components/TimelineGrid.tsx:3530`, `src/app/_components/TimelineGrid.tsx:3632`, `src/app/_components/TimelineGrid.tsx:3481`, `src/app/_components/TimelineGrid.tsx:3726`

*Verifikace: Lock overlay (3508–3528 vs. 3610–3630) a hourglass overlay (3530–3550 vs. 3632–3652) jsou verbatim duplikáty lišící se jen prefixem klíče; company-day chip je duplikován na 3481/3495 a 3726/3740 plus mrtvá sdílená konstanta.*

### #43 — Zkopírované btnPrimary/btnSecondary/btnDanger/btnAddAccent/inputStyle ve 4 admin souborech, kopie už divergují

**Soubor:** `src/app/admin/_components/AdminDashboard.tsx:131` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
const btnSecondary: React.CSSProperties = {
```

**Dopad:** Tytéž style konstanty jsou definované ve 4 souborech (AdminDashboard, PrinterCodebook, ShiftRoster, MachineWorkHoursWeek) — memory konvence říká „kopíruj z AdminDashboard", což vede k tiché divergenci: btnSecondary má v AdminDashboard/PrinterCodebook padding "7px 16px", v MachineWorkHoursWeek/ShiftRoster "7px 14px". Změna vzhledu tlačítek adminu = editace 4 míst, sdílené SEPARATOR/FONT_STACK/TEXT_* konstanty jsou duplikované jakbysmet.

**Doporučení:** Extrahovat konstanty do sdíleného modulu src/components/admin/adminStyles.ts (btnPrimary, btnSecondary, btnDanger, btnAddAccent, inputStyle, SEPARATOR, FONT_STACK) a importovat je — zachová stávající inline-style konvenci, jen odstraní kopie. Aktualizovat memory konvenci z „kopíruj" na „importuj".

**Další výskyty:** `src/components/admin/PrinterCodebook.tsx:45`, `src/components/admin/ShiftRoster.tsx:52`, `src/components/admin/MachineWorkHoursWeek.tsx:44`

*Verifikace: btnSecondary aj. jsou skutečně zkopírované ve 4 souborech a kopie divergují — padding "7px 16px" (AdminDashboard:131, PrinterCodebook:45) vs "7px 14px" (ShiftRoster:52, MachineWorkHoursWeek:44), SEPARATOR/FONT_STACK duplikované rovněž.*

### #97 — fontFamily „-apple-system…" se opakuje 36× v 15 souborech místo jediného globálního nastavení

**Soubor:** `src/app/admin/_components/AdminDashboard.tsx:186` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
```

**Dopad:** globals.css ani layout.tsx font nenastavují — každý modul si stack kopíruje inline (někde s 'SF Pro Text', jinde bez, viz ExpedicePage:503). Prvky bez override (obsah ui/ portálů renderovaných do body, nové komponenty) padají na jiný default Tailwind stack → drobné typografické rozdíly a 36 míst k údržbě.

**Doporučení:** Nastavit font jednou v globals.css (body { font-family: … } nebo @theme --font-sans) a inline fontFamily deklarace při dotyku souborů mazat.

**Další výskyty:** `src/app/expedice/_components/ExpedicePage.tsx:503`, `src/app/login/page.tsx:138`, `src/app/rezervace/_components/RezervacePage.tsx:223`, `src/app/_components/DatePickerField.tsx:197`

*Verifikace: Inline fontFamily s "-apple-system" má 36 výskytů v 15 souborech (vč. 7 FONT_STACK kopií), globals.css ani layout.tsx font-family nenastavují a varianty se liší — ExpedicePage:503 bez 'SF Pro Text', AdminDashboard:186 s ním.*

### #44 — AdminDashboard.tsx (1478 řádků) drží 3 taby a 5 pomocných komponent inline

**Soubor:** `src/app/admin/_components/AdminDashboard.tsx:292` · **Kategorie:** Struktura · **Závažnost:** Střední

```
function UsersSection({ currentUserId }: { currentUserId: number }) {
```

**Dopad:** Taby audit/pracovní doba/rozpis už jsou extrahované do src/components/admin/, ale UsersSection (+UserRow, RoleSelect), CodebookSection (+CodebookRow, ColorPicker, WarningToggle) a PresetSection žijí inline v jednom 1478řádkovém souboru. Porušuje to vlastní standard z CLAUDE.md („Nové UI komponenty — do src/components/, ne inline") a každá změna jednoho tabu prochází přes obří soubor s rizikem konfliktů při paralelních sessions.

**Doporučení:** Inkrementálně přesunout per-tab: UsersSection.tsx, CodebookSection.tsx a PresetSection.tsx do src/components/admin/ (spolu s jejich pomocnými komponentami), v AdminDashboard nechat jen shell s top barem a tab switcherem. Sdílené styly viz nález o adminStyles.ts.

**Další výskyty:** `src/app/admin/_components/AdminDashboard.tsx:770`, `src/app/admin/_components/AdminDashboard.tsx:1283`, `src/app/admin/_components/AdminDashboard.tsx:441`, `src/app/admin/_components/AdminDashboard.tsx:1152`

*Verifikace: Soubor má přesně 1478 řádků a inline drží UsersSection (292), UserRow (441), RoleSelect (740), CodebookSection (770), CodebookRow (948), ColorPicker (1152), WarningToggle (1252) a PresetSection (1283) — v rozporu se standardem z CLAUDE.md, nikde nezdokumentováno jako záměr.*

### #47 — Mutace uživatelů a číselníků selhávají tiše — chybí kontrola res.ok a zpětná vazba

**Soubor:** `src/app/admin/_components/AdminDashboard.tsx:502` · **Kategorie:** Komponenty · **Závažnost:** Střední

```
await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
```

**Dopad:** Smazání uživatele, změna role (ř. 472), změna hesla (ř. 491), toggle isWarning/isActive číselníku (ř. 981), smazání položky (ř. 989) i swap pořadí (ř. 815) nekontrolují res.ok — při 4xx/5xx se jen zavolá refresh a uživatel vidí nezměněný stav bez jakéhokoli vysvětlení; handleColorChange chybu loguje jen do console.error (ř. 999). PresetSection přitom ve stejném souboru error banner má — chování admin formulářů je nekonzistentní a chyby serveru se ztrácejí.

**Doporučení:** Doplnit do handlerů kontrolu res.ok a zobrazení chyby stejným vzorem jako PresetSection/PrinterCodebook (error banner s color-mix danger), případně přes existující useToast. Inkrementálně — jeden malý helper `apiFetch(url, init): Promise<string | null>` vracející chybovou hlášku by pokryl všechny handlery.

**Další výskyty:** `src/app/admin/_components/AdminDashboard.tsx:472`, `src/app/admin/_components/AdminDashboard.tsx:491`, `src/app/admin/_components/AdminDashboard.tsx:981`, `src/app/admin/_components/AdminDashboard.tsx:989`, `src/app/admin/_components/AdminDashboard.tsx:999`, `src/app/admin/_components/AdminDashboard.tsx:815`

*Verifikace: Handlery na ř. 502 (DELETE user), 472 (role), 491 (heslo), 981 (toggle), 989 (delete položky) a 815/832 (swap) nekontrolují res.ok; handleColorChange (998–1000) chybu jen loguje do console.error, zatímco PresetSection ve stejném souboru má setError banner.*

### #48 — Nekonzistentní potvrzování destruktivních akcí: window.confirm vs inline confirm řádek

**Soubor:** `src/app/admin/_components/AdminDashboard.tsx:1348` · **Kategorie:** Komponenty · **Závažnost:** Střední

```
if (!window.confirm(`Opravdu smazat preset '${preset.name}'?`)) return;
```

**Dopad:** Uvnitř jednoho admin modulu existují tři vzory potvrzení: elegantní inline confirm řádek (smazání uživatele ř. 722, smazání číselníkové položky ř. 1136), nativní window.confirm/confirm (smazání presetu, deaktivace tiskaře, přepsání rozpisu, opuštění neuložených změn) a custom modal (ShiftCascadeDialog). Nativní browser dialog vypadá v každém prohlížeči jinak, nejde stylovat a působí vedle zbytku UI lacině — denní uživatel (plánovač) naráží na dva světy.

**Doporučení:** Sjednotit na inline confirm vzor z UserRow/CodebookRow — extrahovat ho jako malou komponentu ConfirmRow do src/components/admin/ a použít v PresetSection (Smazat) a PrinterCodebook (Deaktivovat). window.confirm ponechat max. pro navigační guard neuložených změn.

**Další výskyty:** `src/components/admin/PrinterCodebook.tsx:147`, `src/components/admin/ShiftRoster.tsx:235`, `src/components/admin/MachineWorkHoursWeek.tsx:406`

*Verifikace: V modulu koexistují tři vzory: window.confirm (AdminDashboard:1348) resp. confirm (PrinterCodebook:147, ShiftRoster:235, MachineWorkHoursWeek:406/414), inline confirm řádky (UserRow ~722–732, CodebookRow ~1136–1145) a custom dialog (onConfirm ShiftCascadeDialog, MachineWorkHoursWeek:671).*

### #88 — Inline Praha formátování datumů/časů obchází hotové formatPrague* helpery z dateUtils

**Soubor:** `src/app/api/blocks/route.ts:288` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
startTime.toLocaleString("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "short", timeStyle: "short" })
```

**Dopad:** dateUtils.ts exportuje cachované formatPragueTime/formatPragueDateTime/formatPragueDateShort (+ princip „vždy Praha čas“), ale API i komponenty si opakovaně staví vlastní toLocaleString/Intl.DateTimeFormat kopie s ručně vypsaným timeZone — jen v TimelineGrid.tsx je 6 inline fmtTime lambd, další kopie v ReportView, TiskarMonitor, DtpPanel, AuditLogPanel, ReservationDetail, ShiftCascadeDialog. Každá kopie je místo, kde jde zapomenout timeZone (viz samostatný nález BlockDetail) nebo se odchýlit formátem; Intl.DateTimeFormat se navíc zbytečně konstruuje opakovaně.

**Doporučení:** Postupně nahrazovat inline formátování importem formatPrague* z @/lib/dateUtils; chybějící varianty (např. den+měsíc krátce s časem) přidat jako nové cachované formattery do dateUtils místo dalších lokálních kopií. Začít u api/blocks/route.ts:288 a TimelineGrid fmtTime lambd.

**Další výskyty:** `src/app/_components/TimelineGrid.tsx:1908`, `src/app/report/daily/ReportView.tsx:31`, `src/app/tiskar/_components/TiskarMonitor.tsx:51`, `src/components/DtpPanel.tsx:48`, `src/components/admin/AuditLogPanel.tsx:1078`, `src/app/rezervace/_components/ReservationDetail.tsx:7`, `src/components/admin/ShiftCascadeDialog.tsx:15`

*Verifikace: Řádek 288 sedí přesně (inline toLocaleString s Europe/Prague); formatPrague* helpery v dateUtils existují a inline kopie v TimelineGrid:1908, ReportView:31 i DtpPanel:48 jsou potvrzené.*

### #59 — formatDateCs + CS_MONTHS_SHORT zkopírované ve 3 souborech expedice

**Soubor:** `src/app/expedice/_components/ExpediceDetailPanel.tsx:9` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
return `${d.getUTCDate()}. ${CS_MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
```

**Dopad:** Tři nezávislé kopie téhož datového formatteru (Aside, EditorPanel, DetailPanel). Změna formátu (např. přidání dne v týdnu nebo vypuštění roku) vyžaduje tři úpravy a snadno se zapomene; src/lib/dateUtils.ts navíc už má formatCivilDate() se stejným účelem (civil string → české zobrazení s „—“ fallbackem).

**Doporučení:** Přesunout formatDateCs do jednoho místa (ideálně použít/rozšířit formatCivilDate v src/lib/dateUtils.ts, případně export z src/lib/expediceTypes.ts) a ve třech komponentách jen importovat.

**Další výskyty:** `src/app/expedice/_components/ExpediceAside.tsx:12`, `src/app/expedice/_components/ExpediceEditorPanel.tsx:15`

*Verifikace: formatDateCs + CS_MONTHS_SHORT jsou identické kopie ve 3 souborech (DetailPanel:7-10, Aside:10-12, EditorPanel:13-15) a formatCivilDate existuje v dateUtils.ts:229.*

### #64 — Confirm „Odebrat zakázku z expedice?“ implementován dvakrát — a už se chováním rozjíždí

**Soubor:** `src/app/expedice/_components/ExpediceDetailPanel.tsx:174` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
Zakázka zůstane v tiskovém plánu, ale zmizí z expedice.
```

**Dopad:** DetailPanel (163-206) i EditorPanel (237-283) mají vlastní inline confirm banner se stejnými texty a styly. Verze v EditorPanelu má klávesové ovládání (Enter = potvrdit, Esc = zrušit, focus na confirm tlačítko), verze v DetailPanelu ne — tedy stejná akce se na dvou místech UI potvrzuje odlišně. Každá změna textace či chování se musí dělat 2×.

**Doporučení:** Extrahovat malou komponentu ConfirmBanner({ title, description, confirmLabel, onConfirm, onCancel }) do src/components/ (vč. keyboard handleru z EditorPanelu) a použít v obou panelech.

**Další výskyty:** `src/app/expedice/_components/ExpediceEditorPanel.tsx:253`

*Verifikace: Confirm banner je implementován 2× se stejnými texty (DetailPanel:163-206 bez klávesnice vs EditorPanel:237-283 s autoFocus + Enter/Esc handlerem na ř. 77–91) — chování se rozjíždí.*

### #63 — ExpedicePage (652 ř.) nese ~96 řádků čisté datové logiky bez testů — kandidát na src/lib

**Soubor:** `src/app/expedice/_components/ExpedicePage.tsx:24` · **Kategorie:** Struktura · **Závažnost:** Střední

```
function computeInsertSortOrder(
```

**Dopad:** computeInsertSortOrder (řádky 24-51) a applyOptimisticMove (55-119) jsou čisté funkce bez UI/DOM závislostí — výpočet sort orderu (půlení intervalů, kroky +1000, kraje −500) a optimistický přesun položek. Inline v page komponentě jsou netestovatelné bez mountu, přitom projekt má zavedený vzor klient-safe lib helperů s node --test testy (pasteTarget.ts, printTimeClient.ts). Chyba v půlení sort orderu by se projevila až tichým přeskládáním expedičního dne.

**Doporučení:** Přesunout obě funkce do src/lib/expediceSort.ts (žádný DB import) a přidat expediceSort.test.ts dle vzoru pasteTarget.test.ts (prázdný den, vložení na začátek/konec, same-day reorder, přesun do fronty). ExpedicePage se zkrátí pod ~550 řádků bez změny chování.

**Další výskyty:** `src/app/expedice/_components/ExpedicePage.tsx:55`

*Verifikace: computeInsertSortOrder (ř. 24–51) a applyOptimisticMove (ř. 55–119) jsou čisté funkce inline v 652řádkové page komponentě bez jakýchkoli testů.*

### #66 — onResizeMouseDown v ExpedicePage nekontroluje e.button — porušení coding standardu

**Soubor:** `src/app/expedice/_components/ExpedicePage.tsx:321` · **Kategorie:** Struktura · **Závažnost:** Střední

```
function onResizeMouseDown(e: React.MouseEvent) {
```

**Dopad:** CLAUDE.md standard vyžaduje, aby drag/resize mouse-down handlery začínaly if (e.button !== 0) return;. Zde handler rovnou volá e.preventDefault() a nastaví isResizingRef — pravé či prostřední tlačítko na resize handle aside panelu tak spustí resize a mousemove listener zůstane „přilepený“ do dalšího mouseup. Jediné mouse-down místo v auditovaných modulech, které standard nesplňuje.

**Doporučení:** Přidat na první řádek handleru if (e.button !== 0) return; — jednořádková oprava dle vzoru z planneru.

*Verifikace: onResizeMouseDown na ř. 321 volá rovnou e.preventDefault() bez kontroly e.button, v rozporu s coding standardem v CLAUDE.md.*

### #60 — Hlavička expedice postrádá ThemeToggle, Odhlásit a user info; back-link pojmenován jinak než v rezervacích

**Soubor:** `src/app/expedice/_components/ExpedicePage.tsx:516` · **Kategorie:** Komponenty · **Závažnost:** Střední

```
← Výrobní plán
```

**Dopad:** Planner (PlannerPage.tsx:3286, 3056) i Rezervace (RezervacePage.tsx:267, 268-273) mají v headeru ThemeToggle, Odhlásit a identifikaci uživatele — expedice nic z toho (header řádky 506-563). Uživatel v expedici nemůže přepnout téma ani se odhlásit bez návratu do planneru. Cesta zpět je navíc pojmenovaná pokaždé jinak: „← Planner“ v rezervacích vs „← Výrobní plán“ v expedici — tentýž cíl, dva názvy.

**Doporučení:** Doplnit do headeru ExpedicePage ThemeToggle + tlačítko Odhlásit (vzor RezervacePage:267-273, potřebuje jen fetch /api/auth/logout) a sjednotit label back-linku na jeden text v obou modulech. Globální AppNav dle poznámky v paměti projektu není potřeba — stačí lokální doplnění.

**Další výskyty:** `src/app/rezervace/_components/RezervacePage.tsx:254`, `src/app/rezervace/_components/RezervacePage.tsx:267`

*Verifikace: Header expedice (ř. 506–563) opravdu nemá ThemeToggle, Odhlásit ani user info a back-link „← Výrobní plán“ (ř. 516) se liší od „← Planner“ v RezervacePage:254.*

### #102 — ThemeToggle chybí v hlavičkách Expedice a Reportů — přepnout téma jde jen v Planneru, Adminu a Rezervacích

**Soubor:** `src/app/expedice/_components/ExpedicePage.tsx:519` · **Kategorie:** Vizuál · **Závažnost:** Střední · *(nezávisle nalezeno 2 lens agenty)*

```
<span style={{ fontSize: 13, fontWeight: 600 }}>Expediční plán</span>
```

**Dopad:** Grep: ThemeToggle je jen v PlannerPage (2×), AdminDashboard a RezervacePage; v src/app/expedice, reporty, report a tiskar 0 výskytů. Hlavička Expedice (ř. 506–563) nemá ani uživatele/odhlášení — chrome aplikace se modul od modulu liší v tom, jaké systémové akce nabízí.

**Doporučení:** Přidat ThemeToggle (a blok uživatel + Odhlásit v Expedici) do hlaviček Expedice a Reportů — komponenta src/app/_components/ThemeToggle.tsx existuje, jde o import + 1 řádek na modul.

**Další výskyty:** `src/app/reporty/_components/ReportDashboard.tsx:542`, `src/app/admin/_components/AdminDashboard.tsx:215`, `src/app/rezervace/_components/RezervacePage.tsx:254`

*Verifikace: Grep potvrzuje ThemeToggle jen v PlannerPage/AdminDashboard/RezervacePage — v expedici, reportech a tiskaři 0 výskytů; komponenta src/app/_components/ThemeToggle.tsx existuje.*

### #96 — Bridge substring selektory v globals.css chytají i variantní třídy — v light mode přepíší enabled stav přes !important

**Soubor:** `src/app/globals.css:259` · **Kategorie:** Struktura · **Závažnost:** Střední

```
:root:not(.dark) [class*="border-slate-7"] { border-color: var(--border) !important; }
```

**Dopad:** Selektor [class*="border-slate-7"] matchne i „disabled:border-slate-700" — purple tlačítko „Naplánovat vše" (PlannerPage:329, třídy border-purple-400/35 + disabled:border-slate-700/disabled:text-slate-600) tak v light mode ztrácí fialový border i text ve VŠECH stavech, ne jen disabled. Stejně bg-slate-800/40 (BlockDetail:243) dostane plnou --surface-2 bez alfa. Každé nové použití slate třídy s variantním prefixem je tichá past.

**Doporučení:** Nahradit substring pravidla (ř. 248–259) výčtem přesných tříd včetně potřebných variant; dlouhodobě dotčené slate-* třídy v .tsx převádět na tokeny a bridge vrstvu zmenšovat (její komentář ji sám deklaruje jako dočasnou).

**Další výskyty:** `src/app/_components/PlannerPage.tsx:329`, `src/components/BlockDetail.tsx:243`, `src/app/globals.css:250`

*Verifikace: Substring selektor na ř. 259 skutečně matchne i disabled:border-slate-700 na purple tlačítku (PlannerPage:329) a [class*="bg-slate-80"] přepíše bg-slate-800/40 (BlockDetail:243) na plnou --surface-2 přes !important.*

### #76 — Vlastní Intl.DateTimeFormat formattery duplikují existující formatPragueTime/formatPragueDateTime z dateUtils

**Soubor:** `src/app/report/daily/ReportView.tsx:31` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
const PRAGUE_TIME_FMT = new Intl.DateTimeFormat("cs-CZ", {
```

**Dopad:** ReportView (3 formattery) i TiskarMonitor (3 formattery) si definují vlastní PRAGUE_TIME_FMT/fmtTime, přestože src/lib/dateUtils.ts exportuje formatPragueTime (ř. 221) se shodnou konfigurací (cs-CZ, Europe/Prague, 2-digit). Stejný vzor je rozsetý v dalších 5+ souborech (rezervace, DtpPanel, AuditLogPanel, DatePickerField). Změna formátu času se musí udělat na 10+ místech — reálné riziko, že report a planner časem zobrazí čas různě.

**Doporučení:** V ReportView a TiskarMonitor nahradit lokální PRAGUE_TIME_FMT/PRAGUE_DATE_TIME_FMT importem formatPragueTime/formatPragueDateTime z dateUtils; specifické formáty (REPORT_DATE, PRINTED_AT, DAY_LABEL) přidat do dateUtils jako další exporty a postupně přepnout i ostatní soubory.

**Další výskyty:** `src/app/tiskar/_components/TiskarMonitor.tsx:51`, `src/app/tiskar/_components/TiskarMonitor.tsx:56`, `src/app/tiskar/_components/TiskarMonitor.tsx:63`, `src/lib/dateUtils.ts:221`, `src/app/rezervace/_components/ReservationList.tsx:5`, `src/app/rezervace/_components/ReservationDetail.tsx:7`, `src/components/DtpPanel.tsx:48`, `src/components/admin/AuditLogPanel.tsx:1078`, `src/app/_components/DatePickerField.tsx:9`

*Verifikace: ReportView ř. 31 i TiskarMonitor ř. 51/56/63 definují vlastní Intl formattery se shodnou konfigurací jako formatPragueTime/formatPragueDateTime exportované z dateUtils.ts:221/225 a stejný vzor je i v dalších uvedených souborech (ReservationList:5, DtpPanel:48, AuditLogPanel:1078, DatePickerField:9).*

### #74 — Denní report nemá žádný vstupní bod v UI — dostupný jen ručně napsanou URL

**Soubor:** `src/app/report/daily/ReportView.tsx:140` · **Kategorie:** Struktura · **Závažnost:** Střední

```
setError("Chybí parametr date.");
```

**Dopad:** V celém src/ neexistuje odkaz, tlačítko ani window.open na /report/daily (grep na „report/daily" i „window.open" nic nenašel; header PlannerPage má jen Správa/Reporty/Rezervace/Expedice). Plánovač musí URL /report/daily?date=YYYY-MM-DD znát zpaměti nebo mít záložku a datum ručně přepisovat; bez parametru stránka skončí chybou. Funkce z etapy 7 je pro nové uživatele neobjevitelná.

**Doporučení:** Přidat vstupní bod — např. tlačítko v headeru PlannerPage (vedle „Reporty", pro ADMIN/PLANOVAT) nebo položku v context menu dne v gridu, která otevře /report/daily?date=<vybraný den>.

**Další výskyty:** `src/app/_components/PlannerPage.tsx:3251`

*Verifikace: Grep celého src/ nenašel žádný odkaz, tlačítko ani window.open na /report/daily mimo samotný modul (header PlannerPage má jen Správa/Reporty/Rezervace/Expedice) a bez parametru date stránka končí chybou na ř. 140.*

### #103 — ReportDashboard je česky bez diakritiky („Vytizeni", „Prijate", „Ut/Ct/Pa")

**Soubor:** `src/app/reporty/_components/ReportDashboard.tsx:182` · **Kategorie:** Vizuál · **Závažnost:** Střední

```
SUBMITTED: "Nove", ACCEPTED: "Prijate", QUEUE_READY: "Ve fronte",
```

**Dopad:** KPI karty („Vytizeni XL 105", „Prutok zakazek", „Prumerna lead time"), pipeline labely i zkratky dnů (DOW_LABELS „Ut","Ct","Pa") jsou ASCII bez diakritiky, zatímco zbytek stejné obrazovky („Období:", „Načítám data…", „Výhled") diakritiku má. Report čte ADMIN denně — působí to jako nedodělek.

**Doporučení:** Doplnit diakritiku ve stringových konstantách ReportDashboardu (pipelineLabels, DOW_LABELS, labely KpiCard a SectionHeader) — čistě textová změna bez rizika.

**Další výskyty:** `src/app/reporty/_components/ReportDashboard.tsx:109`, `src/app/reporty/_components/ReportDashboard.tsx:197`, `src/app/reporty/_components/ReportDashboard.tsx:208`

*Verifikace: Řádek 182 obsahuje přesně SUBMITTED: Nove, ACCEPTED: Prijate, QUEUE_READY: Ve fronte a DOW_LABELS (109) i KPI labely (197-209) jsou bez diakritiky — duplikuje nález 72, ale fakticky platí.*

### #77 — Label stroje řešen třemi vzory na 7+ místech — MACHINE_LABELS mapa, replace("_"," ") i hardcoded string

**Soubor:** `src/app/reporty/_components/ReportDashboard.tsx:344` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
>{m.replace("_", " ")}</div>
```

**Dopad:** MACHINE_LABELS mapa {XL_105: "XL 105"} je zkopírovaná v 5 souborech (TiskarMonitor, AdminDashboard, DtpPanel, MachineWorkHoursWeek, ShiftRoster), ReportDashboard místo ní používá m.replace("_"," ") a ReportView má „XL 105" natvrdo. src/lib/machines.ts je zdroj pravdy jen pro ID strojů, label helper chybí. Přidání či přejmenování stroje znamená úpravu 7+ míst třemi různými způsoby.

**Doporučení:** Přidat do src/lib/machines.ts vedle MACHINES i MACHINE_LABELS mapu (nebo helper machineLabel(id)) a postupně na ni přepnout všechny výskyty — začít soubory v aktivním vývoji.

**Další výskyty:** `src/app/tiskar/_components/TiskarMonitor.tsx:45`, `src/app/admin/_components/AdminDashboard.tsx:68`, `src/components/DtpPanel.tsx:25`, `src/components/admin/MachineWorkHoursWeek.tsx:35`, `src/components/admin/ShiftRoster.tsx:43`, `src/app/report/daily/ReportView.tsx:269`, `src/app/reporty/_components/ReportDashboard.tsx:386`

*Verifikace: Řádek 344 obsahuje m.replace("_", " ") (další na 386), MACHINE_LABELS mapa je skutečně zkopírovaná v 5 uvedených souborech a ReportView.tsx:269 má XL 105 natvrdo — src/lib/machines.ts label helper nemá.*

### #75 — ReportDashboard nevyužívá sdílené komponenty LoadingSpinner/ErrorMessage/Button

**Soubor:** `src/app/reporty/_components/ReportDashboard.tsx:607` · **Kategorie:** Komponenty · **Závažnost:** Střední

```
<div style={{ color: "var(--text-muted)", fontSize: 13 }}>Načítám data…</div>
```

**Dopad:** Loading je prostý text místo existujícího LoadingSpinner, error je vlastní div bez možnosti opakování, přestože sdílená ErrorMessage má onRetry a fetchData je k dispozici; přepínače režimu/období jsou vlastní BTN_BASE/BTN_ACTIVE objekty místo ui/button. Stavy načítání a chyb tak vypadají v každém modulu jinak — porušuje pravidlo „před stavbou nového UI najdi existující komponenty".

**Doporučení:** Nahradit loading za <LoadingSpinner label="Načítám data…"/>, error div za <ErrorMessage message={error} onRetry={fetchData}/> a tlačítka převést na komponentu ui/button — inkrementální náhrada bez změny logiky.

**Další výskyty:** `src/app/reporty/_components/ReportDashboard.tsx:87`, `src/app/reporty/_components/ReportDashboard.tsx:610`, `src/components/ui/LoadingSpinner.tsx:8`, `src/components/ui/ErrorMessage.tsx:8`

*Verifikace: Řádek 607 je prostý text Načítám data, error div (610-623) nemá retry, a src/components/ui/LoadingSpinner.tsx (prop label) i ErrorMessage.tsx (prop onRetry) existují a v místě dávají smysl.*

### #62 — Formuláře rezervací, expedice a loginu obcházejí ui/ primitivy — 5 nezávislých definic inputu

**Soubor:** `src/app/rezervace/_components/ReservationForm.tsx:118` · **Kategorie:** Komponenty · **Závažnost:** Střední

```
const inputStyle: React.CSSProperties = {
```

**Dopad:** Projekt má shadcn-style ui/input, ui/textarea, ui/label i ui/select a planner je používá (PlannerPage.tsx:32,35). Rezervace, expedice i login si ale definují vlastní inline input styly — každý s jinou výškou (32 vs 40 px), radiusem (7/8/10) a jiným focus mechanismem (onFocus/onBlur přepis borderColor v PlanningForm a loginu, injektovaná .expedice-input CSS class v expedici, nic v ReservationForm). Výsledkem jsou viditelně odlišná form pole mezi moduly a neexistující kanonický vzor pro nové formuláře.

**Doporučení:** Inkrementálně: nové/upravované formuláře psát s ui/ primitivy; jako první krok migrovat pole v ExpediceBuilderPanel/ExpediceEditorPanel (kde se to potká s odstraněním duplicit formuláře) a sjednotit tak focus styl na jednom místě.

**Další výskyty:** `src/app/rezervace/_components/PlanningForm.tsx:29`, `src/app/expedice/_components/ExpediceBuilderPanel.tsx:68`, `src/app/expedice/_components/ExpediceEditorPanel.tsx:217`, `src/app/login/page.tsx:59`

*Verifikace: inputStyle je na ReservationForm.tsx:118, ui/input+textarea+label+select existují a PlannerPage je importuje (řádky 32-35), zatímco rezervace/expedice/login mají vlastní inline styly s odlišnou výškou, radiusem i focus mechanismem (ověřeno i na PlanningForm:29, ExpediceBuilderPanel:68, ExpediceEditorPanel:217).*

### #73 — TiskarMonitor kopíruje vizuální systém bloků z TimelineGrid a kopie už divergovala

**Soubor:** `src/app/tiskar/_components/TiskarMonitor.tsx:70` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
Vizuální styly bloků (shodné s TimelineGrid)
```

**Dopad:** Komentář „shodné s TimelineGrid" už neplatí: BLOCK_OVERDUE je v planneru oranžová (TimelineGrid:465, rgba(251,146,60)) vs. šedá v monitoru (ř. 126); BLOCK_PRINT_DONE modrá (TimelineGrid:474) vs. zelená (ř. 135); isOverdue má jinou podmínku (ZAKAZKA-only vs. vše kromě UDRZBA, ř. 479 vs. TimelineGrid:1000); MODE_TINY práh 20 vs. 24 a chybí MODE_MICRO_TEXT z 9. 7. (ř. 494 vs. TimelineGrid:1071). Pokud by se modul oživil, tiskaři uvidí zastaralé vizuály; každá změna stylu bloků dnes znamená dvojí údržbu.

**Doporučení:** Pokud modul přežije nález o nedosažitelnosti /tiskar, extrahovat BLOCK_STYLES + getBlockStyleKey + prahy výškových módů do sdíleného modulu (např. src/lib/blockStyles.ts) a importovat na obou místech; pokud ne, smazat spolu s modulem.

**Další výskyty:** `src/app/tiskar/_components/TiskarMonitor.tsx:126`, `src/app/tiskar/_components/TiskarMonitor.tsx:135`, `src/app/tiskar/_components/TiskarMonitor.tsx:479`, `src/app/tiskar/_components/TiskarMonitor.tsx:494`, `src/app/_components/TimelineGrid.tsx:465`, `src/app/_components/TimelineGrid.tsx:474`, `src/app/_components/TimelineGrid.tsx:1000`, `src/app/_components/TimelineGrid.tsx:1071`

*Verifikace: Komentář „shodné s TimelineGrid" na ř. 70 už neplatí: BLOCK_OVERDUE šedá (ř. 126) vs oranžová (TimelineGrid:465), BLOCK_PRINT_DONE zelená (ř. 135) vs modrá (474), isOverdue !== UDRZBA (ř. 479) vs === ZAKAZKA (1000), MODE_TINY práh 20 vs 24 a chybí MODE_MICRO_TEXT (ř. 494 vs 1071–1072).*

### #46 — Lokální kopie MACHINES/MACHINE_LABELS místo src/lib/machines.ts

**Soubor:** `src/components/admin/MachineWorkHoursWeek.tsx:34` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
const MACHINES = ["XL_105", "XL_106"] as const;
```

**Dopad:** Etapa 7 zavedla src/lib/machines.ts jako „jediný zdroj pravdy pro seznam strojů" a nahradila 5 serverových kopií — klientské admin komponenty ale dál drží vlastní MACHINES a MACHINE_LABELS (MachineWorkHoursWeek, ShiftRoster, AdminDashboard; grep ukazuje další kopie labelů i mimo admin v TiskarMonitor a DtpPanel). Přidání/přejmenování stroje znamená ruční editaci mnoha souborů s rizikem opomenutí.

**Doporučení:** Importovat MACHINES z @/lib/machines (soubor je klient-safe, žádná DB) a přidat tam exportovaný MACHINE_LABELS: Record<MachineId, string>; lokální kopie v admin komponentách smazat.

**Další výskyty:** `src/components/admin/ShiftRoster.tsx:42`, `src/components/admin/MachineWorkHoursWeek.tsx:35`, `src/components/admin/ShiftRoster.tsx:43`, `src/app/admin/_components/AdminDashboard.tsx:68`

*Verifikace: Řádek 34 drží lokální kopii MACHINES, přestože src/lib/machines.ts existuje, je klient-safe a exportuje MACHINES/MachineId; další kopie v ShiftRoster, AdminDashboard a DtpPanel (MACHINE_LABELS).*

### #45 — Week-grid infrastruktura duplikovaná mezi MachineWorkHoursWeek a ShiftRoster

**Soubor:** `src/components/admin/MachineWorkHoursWeek.tsx:78` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
function formatCzechDate(d: Date): string {
```

**Dopad:** Obě týdenní tabulky (Pracovní doba, Rozpis směn) kopírují: isoDateStr, CZ_MONTHS + formatCzechDate, DAY_LABELS, typ WeekShiftsRow, navigační header (← Předchozí / KT · datumy / Další → / Dnes / Zkopírovat z KT) i celý thead se dny a víkendovým podbarvením. isoDateStr je potřetí i v ShiftRosterCell. Oprava chyby v česke datové logice nebo změna hlavičky tabulky se musí dělat 2–3×; vzhled obou tabů se může nepozorovaně rozjet.

**Doporučení:** Vytvořit src/components/admin/weekGridShared.tsx: helpery (isoDateStr, formatCzechDate, DAY_LABELS), sdílený typ WeekShiftsRow a komponentu WeekNavigator (props: kt, weekDates, onNavigate, onToday, extraActions). Oba taby ji použijí beze změny chování.

**Další výskyty:** `src/components/admin/ShiftRoster.tsx:99`, `src/components/admin/ShiftRoster.tsx:90`, `src/components/admin/ShiftRosterCell.tsx:29`, `src/components/admin/MachineWorkHoursWeek.tsx:69`, `src/components/admin/ShiftRoster.tsx:31`, `src/components/admin/ShiftRoster.tsx:277`, `src/components/admin/MachineWorkHoursWeek.tsx:426`

*Verifikace: isoDateStr, CZ_MONTHS, formatCzechDate, DAY_LABELS, WeekShiftsRow i navigační header včetně 'Zkopírovat z KT' jsou zkopírované v MachineWorkHoursWeek i ShiftRoster a isoDateStr potřetí v ShiftRosterCell.*

### #51 — Hardcoded amber hex barvy mimo theme proměnné (Uložit CTA v popoveru hodin)

**Soubor:** `src/components/admin/ShiftHoursPopover.tsx:7` · **Kategorie:** Vizuál · **Závažnost:** Střední

```
const AMBER_BG = "#d97706";
```

**Dopad:** Primární tlačítko „Uložit" v popoveru hodin směny je natvrdo amber (#d97706), zatímco všechna ostatní primární CTA adminu používají var(--brand)/btnPrimary; override štítek hodin používá hex #f59e0b místo var(--warning). Porušuje to závaznou admin konvenci „barvy jen přes CSS proměnné, nikdy hex" (memory project_admin_ui_style.md) — hex hodnoty nereagují na dark/light theme a primární akce vypadá v tomto jednom místě jinak než ve zbytku správy.

**Doporučení:** Nahradit AMBER_BG za var(--brand) (nebo, pokud má amber signalizovat „override", za color-mix(in oklab, var(--warning) 90%, transparent)) a AMBER_TEXT v MachineWorkHoursWeek za var(--warning).

**Další výskyty:** `src/components/admin/MachineWorkHoursWeek.tsx:28`, `src/components/admin/ShiftHoursPopover.tsx:219`

*Verifikace: AMBER_BG=#d97706 na ř. 7 použitý pro Uložit (ř. 219) a AMBER_TEXT=#f59e0b v MachineWorkHoursWeek:28 jsou hardcoded hex mimo theme proměnné, zatímco ShiftRoster používá var(--brand).*

### #50 — Dvě ruční popover implementace vedle Radix Popoveru — duplicitní outside-click mechanika

**Soubor:** `src/components/admin/ShiftHoursPopover.tsx:54` · **Kategorie:** Komponenty · **Závažnost:** Střední

```
document.addEventListener("mousedown", handler);
```

**Dopad:** Admin používá tři popover mechaniky: Radix ui/popover (ColorPicker v AdminDashboard ř. 1161, ShiftRosterCell ř. 105), ručně psaný fixed-position popover s vlastním outside-click + Escape + clamp k viewportu (ShiftHoursPopover) a ručně psaný absolute popover s vlastním outside-click (role popover v UserRow, AdminDashboard ř. 465). Ruční verze nemají focus management ani kolizní logiku Radixu a každá se chová/vypadá trochu jinak (stín, zaoblení, klávesnice).

**Doporučení:** Převést ShiftHoursPopover a role popover v UserRow na existující ui/popover (PopoverTrigger asChild + PopoverContent) — odpadne vlastní positioning i event listenery; vizuální styl ponechat přes style prop jako u ColorPickeru.

**Další výskyty:** `src/app/admin/_components/AdminDashboard.tsx:465`, `src/app/admin/_components/AdminDashboard.tsx:1161`, `src/components/admin/ShiftRosterCell.tsx:105`

*Verifikace: Ruční outside-click listener na ř. 54 sedí, Radix ui/popover existuje a je použit v ColorPickeru i ShiftRosterCell, role popover v AdminDashboard (~465) má vlastní duplicitní mousedown mechaniku.*

### #49 — ShiftRosterCell hlásí chyby přes alert(), ačkoli rodič ShiftRoster používá toasty

**Soubor:** `src/components/admin/ShiftRosterCell.tsx:49` · **Kategorie:** Komponenty · **Závažnost:** Střední

```
alert(body.error ?? "Chyba při přiřazení.");
```

**Dopad:** Chyba při přiřazení/odebrání tiskaře vyskočí jako blokující nativní alert, zatímco chyby kopírování týdne a publikace ve stejné tabulce (ShiftRoster) jdou přes showToast z ToastContainer. Tentýž workflow (rozpis směn) tak míchá dva chybové mechanismy — alert navíc blokuje celé okno.

**Doporučení:** Předat do ShiftRosterCell callback onError (nebo rovnou showToast z rodiče, který už useToast má) a alert() nahradit — dvouřádková změna props bez zásahu do logiky.

**Další výskyty:** `src/components/admin/ShiftRosterCell.tsx:65`

*Verifikace: alert() na řádcích 49 a 65, zatímco rodič ShiftRoster používá useToast/showToast pro chyby kopírování a publikace — smíšené chybové mechanismy potvrzeny.*

### #29 — BlockEdit má 1413 řádků — chybí dekompozice na sekce

**Soubor:** `src/components/BlockEdit.tsx:65` · **Kategorie:** Struktura · **Závažnost:** Střední

```
export function BlockEdit({
```

**Dopad:** Jedna komponenta drží ~30 useState, resolver termínů série, jejich ukládání, split logiku, preset picker, výrobní sloupečky i tři vnořené dialogy. Každá změna vyžaduje orientaci v celém souboru; při paralelních sessions (zdokumentovaný pracovní vzor projektu) roste riziko konfliktů a review je pomalé.

**Doporučení:** Vytáhnout postupně samostatné soubory do src/components/ (dle vlastního pravidla projektu): SeriesOccurrencesEditor (ř. 1062–1202 + resolver 225–291 + save 317–423), SeriesConfirmDialog (1205–1268), OrderNumberPromptDialog (1353–1410), ProductionColumnsSection (914–1046), PresetPicker (754–830). Stav nechat v BlockEdit, sekce dostávají value/onChange props. Duplicitní kaskádu 14 setterů v applyPreset vs clearPresetSelection (531–544 vs 549–562) sjednotit do jedné applyDraft(next) funkce.

**Další výskyty:** `src/components/BlockEdit.tsx:1062`, `src/components/BlockEdit.tsx:531`

*Verifikace: Soubor má přesně 1413 řádků, export function BlockEdit na ř. 65 a duplicitní 14-setterové kaskády applyPreset/clearPresetSelection na ř. 531–562 sedí.*

### #30 — Komponenty definované uvnitř těla BlockEdit (StatusSelect, SectionLabel, ColLabel)

**Soubor:** `src/components/BlockEdit.tsx:655` · **Kategorie:** Komponenty · **Závažnost:** Střední

```
function StatusSelect({ value, onChange, opts }: {
```

**Dopad:** Při každém re-renderu BlockEdit (tj. každém stisku klávesy ve formuláři) vznikne nová identita komponenty → React celý podstrom odmountuje a postaví znovu. U 4× použitého StatusSelect to znamená zahazování DOM a možnou ztrátu fokusu nativního selectu; zároveň jde o porušení pravidla projektu „nové UI komponenty do src/components/, ne inline".

**Doporučení:** Přesunout StatusSelect, SectionLabel a ColLabel na module scope (mimo tělo BlockEdit) — nemají žádné closure závislosti kromě props, jde o čistý přesun bez změny chování.

**Další výskyty:** `src/components/BlockEdit.tsx:647`, `src/components/BlockEdit.tsx:651`

*Verifikace: StatusSelect (ř. 655), SectionLabel (ř. 647) a ColLabel (ř. 651) jsou definované uvnitř těla BlockEdit před returnem a nemají closure závislosti mimo props.*

### #32 — Custom native select s chevron SVG kopírovaný 13× místo sdílené komponenty

**Soubor:** `src/components/BlockEdit.tsx:686` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
<path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
```

**Dopad:** Vzor „select s appearance:none + absolutně pozicovaná SVG šipka + focus/blur přebarvení borderu" je v BlockEdit 3× a dalších 10× napříč aplikací (MultiSelectDropdown, JobPresetEditor, PlanningForm, PlannerPage 7×). Rozměry a radius se už rozjíždějí (výška 30/32/34, radius 8/10) a každé vizuální doladění znamená 13 úprav.

**Doporučení:** Vytvořit src/components/ui/NativeSelect.tsx zapouzdřující wrapper + šipku + focus styly (nativní select záměrně zachovat — Radix ui/select má v projektu zdokumentované dark-mode gotchas) a nahrazovat výskyty postupně při dotyku souboru.

**Další výskyty:** `src/components/BlockEdit.tsx:908`, `src/components/BlockEdit.tsx:1157`, `src/components/MultiSelectDropdown.tsx:66`, `src/components/job-presets/JobPresetEditor.tsx:87`, `src/app/rezervace/_components/PlanningForm.tsx:54`, `src/app/_components/PlannerPage.tsx:3722`

*Verifikace: Chevron path se v src/ vyskytuje přesně 13× (3× BlockEdit ř. 686/908/1157, 7× PlannerPage, MultiSelectDropdown, JobPresetEditor, PlanningForm) a všechny uvedené řádky sedí.*

### #34 — Tři různé ručně psané modal shelly (overlay, zavírání, z-index, potvrzení)

**Soubor:** `src/components/BlockNotesDialog.tsx:120` · **Kategorie:** Komponenty · **Závažnost:** Střední

```
if (e.target === e.currentTarget) onClose();
```

**Dopad:** BlockNotesDialog = centrovaný fixed overlay (zIndex 1000, bez portalu, Esc přes window listener), OrderSearchSheet = portalový bottom-sheet (zIndex 100, Esc přes document listener), prompt v BlockEdit = absolute overlay v panelu (zIndex 50, Esc jen na inputu). K tomu tři vzory potvrzení: native confirm() (BlockNotesDialog:98), window.confirm (BlockEdit:527) a inline confirm UI (BlockDetail/BlockEdit). Chování Esc/kliku mimo se mezi dialogy liší a z-indexy nejsou koordinované.

**Doporučení:** Zavést jeden ModalShell (portal + overlay + Esc + click-outside + jednotný z-index token) v src/components/ui/ a podložit jím dialogy při nejbližším zásahu; potvrzování sjednotit na inline confirm vzor, který už BlockDetail má.

**Další výskyty:** `src/components/OrderSearchSheet.tsx:56`, `src/components/BlockEdit.tsx:1354`, `src/components/BlockNotesDialog.tsx:98`

*Verifikace: Tři různé modal shelly ověřeny (zIndex 1000/100/50, odlišné Esc/click-outside) i tři vzory potvrzení (confirm:98, window.confirm:527, inline).*

### #35 — Drag handlery bez kontroly e.button (DtpPanel resize, ZoomSlider)

**Soubor:** `src/components/DtpPanel.tsx:96` · **Kategorie:** Komponenty · **Závažnost:** Střední

```
function handleResizeMouseDown(e: React.MouseEvent) {
```

**Dopad:** Coding standard projektu (CLAUDE.md) vyžaduje `if (e.button !== 0) return;` na začátku drag/resize mouse-down handlerů. Resize handle DTP panelu i track ZoomSlideru reagují i na pravé/prostřední tlačítko — pravý klik spustí drag souběžně s context menu (u ZoomSlideru navíc okamžitě skočí zoom na pozici kliku).

**Doporučení:** Doplnit `if (e.button !== 0) return;` jako první řádek handleResizeMouseDown a onMouseDown na tracku ZoomSlideru.

**Další výskyty:** `src/components/ZoomSlider.tsx:51`

*Verifikace: handleResizeMouseDown (DtpPanel:96) ani onMouseDown tracku ZoomSlideru (ř. 51) nemají povinný check e.button !== 0 dle CLAUDE.md standardu.*

### #31 — Mapa audit akcí → český label/barva duplikovaná mezi AuditList a historií v BlockDetail

**Soubor:** `src/components/InfoPanel.tsx:62` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
{log.action === "EXPEDITION_PUBLISH" && <span style={{ color: "#22c55e" }}> · Zařazena do expedice</span>}
```

**Dopad:** Sedm shodných větví (UPDATE/CREATE/DELETE/EXPEDITION_*/AUTO_SHIFT/AUTO_REFLOW) je opsáno 1:1 na dvou místech a sady se už rozešly — InfoPanel má navíc PRINT_*, BlockDetail navíc NOTE_*. Nová audit akce se snadno přidá jen do jednoho seznamu a druhý ji pak vykreslí bez popisu (jen jméno uživatele bez textu akce).

**Doporučení:** Vytáhnout sdílenou mapu action → {text, color} (nebo komponentu AuditActionLabel) vedle fmtAuditVal do src/lib/auditFormatters.ts a použít v obou seznamech; rozdílné sady akcí řešit filtrem.

**Další výskyty:** `src/components/BlockDetail.tsx:580`, `src/components/BlockDetail.tsx:582`

*Verifikace: Sedm shodných action větví je opsáno 1:1 v InfoPanel (ř. 54–69) a BlockDetail (~ř. 575–596) a sady se už rozešly — InfoPanel má navíc PRINT_*, BlockDetail navíc NOTE_*.*

### #52 — JobPresetEditor: theme-blind text-slate-400 a hex barvy, mix shadcn Button + raw button v jednom footeru

**Soubor:** `src/components/job-presets/JobPresetEditor.tsx:349` · **Kategorie:** Vizuál · **Závažnost:** Střední

```
<Button variant="ghost" size="sm" onClick={onClose} className="text-xs text-slate-400">Zavřít</Button>
```

**Dopad:** Tlačítka Zavřít/Zrušit mají natvrdo Tailwind text-slate-400 — v light theme má šedá #94a3b8 na světlém pozadí slabý kontrast a ignoruje var(--text-muted), kterým se řídí zbytek adminu. Ve stejném footeru stojí shadcn <Button> vedle raw <button> s inline styly pro „Uložit preset" (ř. 522) a výběr stroje používá hex #16a34a/#3b82f6 (ř. 392) — tři stylovací režimy v jedné komponentě, každý s jiným focus/hover chováním.

**Doporučení:** Nahradit text-slate-400 za style={{ color: "var(--text-muted)" }} (nebo CSS proměnnou v className přes arbitrary value), hex barvy strojů převést na proměnné/konstanty sdílené s ostatními místy, a „Uložit preset" sjednotit na tentýž mechanismus jako Zrušit (Button variant default) nebo na btnPrimary konvenci.

**Další výskyty:** `src/components/job-presets/JobPresetEditor.tsx:521`, `src/components/job-presets/JobPresetEditor.tsx:392`, `src/components/job-presets/JobPresetEditor.tsx:522`

*Verifikace: Ř. 349 sedí přesně (text-slate-400 na Zavřít), footer mixuje shadcn Button (ř. 521) s raw button + inline styly (ř. 522) a stroje mají hex #3b82f6/#16a34a na ř. 392.*

### #33 — Hlavička panelu s tlačítkem „Zpět" zkopírovaná 4× — gradient už diverguje

**Soubor:** `src/components/NotificationsPanel.tsx:66` · **Kategorie:** Komponenty · **Závažnost:** Střední

```
><polyline points="15 18 9 12 15 6"/></svg> Zpět</Button>
```

**Dopad:** Stejný blok (eyebrow + titulek + ghost Button se šipkou „Zpět" + gradientní pozadí hlavičky) je v BlockEdit, BlockDetail, NotificationsPanel a PlannerPage. Gradient se už tiše rozjel (BlockDetail má color-mix 96 %, ostatní 95 %) — přesně typ divergence, kterou sdílená komponenta eliminuje.

**Doporučení:** Vytáhnout src/components/PanelHeader.tsx s props {eyebrow, title, onClose, children?} a nahradit 4 výskyty.

**Další výskyty:** `src/components/BlockEdit.tsx:725`, `src/components/BlockDetail.tsx:204`, `src/components/BlockDetail.tsx:181`, `src/app/_components/PlannerPage.tsx:279`

*Verifikace: Řádek 66 sedí přesně; hlavička s „Zpět“ je 4× a gradient skutečně diverguje (BlockDetail 96 %, ostatní 95 %).*

### #98 — Mrtvé ui/ primitivy: calendar, tooltip a select mají 0 importů — calendar drží závislost react-day-picker

**Soubor:** `src/components/ui/calendar.tsx:9` · **Kategorie:** Mrtvý kód · **Závažnost:** Střední

```
import { DayButton, DayPicker, getDefaultClassNames } from "react-day-picker"
```

**Dopad:** Složka ui/ slibuje 15 živých primitivů, ale ui/select.tsx, ui/tooltip.tsx a ui/calendar.tsx nikdo neimportuje — místo nich žije 7 souborů s native <select>, title= tooltipy a custom DatePickerField. Vývojář (i AI řídící se pravidlem „použij existující komponenty") nepozná, co je závazné; react-day-picker ^9.14.0 je dependency jen kvůli mrtvému souboru.

**Doporučení:** Rozhodnout per primitiv: adoptovat (ui/select v PlanningForm se 6 native selecty je přirozený první krok), nebo soubor smazat — u calendar.tsx spolu s react-day-picker z package.json.

**Další výskyty:** `src/components/ui/tooltip.tsx:14`, `src/components/ui/select.tsx:9`, `package.json:39`

*Verifikace: Grep celého src/ nenašel žádný import ui/calendar, ui/tooltip ani ui/select mimo jejich definiční soubory a react-day-picker (package.json:39) drží jen mrtvý calendar.tsx s importem na řádku 9.*

### #100 — ContextMenuItem má JS hover s natvrdo bílou rgba(255,255,255,0.12) — v light mode neviditelné zvýraznění a žádný keyboard highlight

**Soubor:** `src/components/ui/context-menu.tsx:101` · **Kategorie:** Komponenty · **Závažnost:** Střední

```
backgroundColor: hovered ? "rgba(255,255,255,0.12)" : undefined,
```

**Dopad:** Popover pozadí je v light mode bílé (--popover: oklch(1 0 0)) — bílý 12% overlay na bílé = hover položek kontextového menu planneru je prakticky neviditelný. Navíc useState hover nahradil Radixové focus:bg-accent, takže klávesnicová navigace šipkami položky vůbec nezvýrazňuje. Ve stejném souboru CheckboxItem/RadioItem (ř. 119) používají správně focus:bg-accent — dva mechanismy v jednom primitivu.

**Doporučení:** Vrátit ContextMenuItem a ContextMenuSubTrigger na focus:bg-accent focus:text-accent-foreground (vzor je o pár řádků níž v témže souboru) a smazat useState hover mechaniku i inline transition.

**Další výskyty:** `src/components/ui/context-menu.tsx:38`, `src/components/ui/context-menu.tsx:119`

*Verifikace: Řádek 101 má natvrdo rgba(255,255,255,0.12) přes useState hover (stejně SubTrigger na ř. 38), zatímco CheckboxItem na ř. 119 správně používá focus:bg-accent, a light --popover je bílá oklch(1 0 0) v globals.css:121.*

### #61 — ErrorMessage.tsx v ui/ je mrtvá komponenta; ExpedicePage má její inline reimplementaci

**Soubor:** `src/components/ui/ErrorMessage.tsx:8` · **Kategorie:** Mrtvý kód · **Závažnost:** Střední

```
export default function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
```

**Dopad:** Komponenta ErrorMessage (message + volitelný onRetry s tlačítkem „Zkusit znovu“) nemá v celém src/ jediný import. Přitom ExpedicePage.tsx:574-590 řeší přesně tento use-case vlastním inline blokem s vlastním „Zkusit znovu“ tlačítkem a hardcoded #ef4444. Mrtvá sdílená komponenta ve frekventované složce ui/ mate: vývojář neví, zda je kanonická, a mezitím vznikají paralelní implementace.

**Doporučení:** Použít ErrorMessage v error stavu ExpedicePage (message=error, onRetry=() => { setLoading(true); fetchData(); }) — tím komponenta ožije; pokud se tým rozhodne jinak, soubor smazat.

**Další výskyty:** `src/app/expedice/_components/ExpedicePage.tsx:588`

*Verifikace: ErrorMessage nemá v celém src/ jediný import (grep našel jen nesouvisející raceErrorMessage) a ExpedicePage.tsx:574-590 má vlastní inline error blok s tlačítkem Zkusit znovu a #ef4444.*

### #84 — Duplicitní date helpery v jobPresets.ts vč. identické funkce stejného jména jako v dateUtils

**Soubor:** `src/lib/jobPresets.ts:87` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
export function todayPragueDateStr(): string {
```

**Dopad:** jobPresets.ts exportuje todayPragueDateStr s tělem znak po znaku identickým s dateUtils.ts:117 (return utcToPragueDateStr(new Date())) — přitom utcToPragueDateStr už z dateUtils importuje. Dva exporty téhož jména ve dvou modulech = editor auto-import snadno sáhne po špatném zdroji. Navíc privátní addDaysToDateStr (ř. 73) duplikuje addDaysToCivilDate (dateUtils:164) a dateStrToOffsetDays (ř. 79) reimplementuje diffCivilDateDays (dateUtils:179) — kopie nemají validaci vstupu, kterou dateUtils verze mají (civilDateToUTCNoon hází na neplatné datum).

**Doporučení:** V jobPresets.ts smazat lokální todayPragueDateStr a addDaysToDateStr, importovat todayPragueDateStr + addDaysToCivilDate + diffCivilDateDays z @/lib/dateUtils. Žádný jiný soubor todayPragueDateStr z jobPresets neimportuje, náhrada je bezpečná.

**Další výskyty:** `src/lib/jobPresets.ts:73`, `src/lib/jobPresets.ts:79`, `src/lib/dateUtils.ts:117`, `src/lib/dateUtils.ts:164`, `src/lib/dateUtils.ts:179`

*Verifikace: todayPragueDateStr v jobPresets.ts:87 je znak po znaku identická s dateUtils.ts:117, addDaysToDateStr/dateStrToOffsetDays duplikují addDaysToCivilDate/diffCivilDateDays bez validace a nikdo todayPragueDateStr z jobPresets neimportuje.*

### #86 — Legacy printMinutes fallback formule (zarovnání na 30min grid) ve 3 kopiích s ručním sync požadavkem

**Soubor:** `src/lib/overlapResolver.server.ts:141` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
Math.max(30, Math.round((r.endTime.getTime() - r.startTime.getTime()) / 60000 / 30) * 30)
```

**Dopad:** Normativní pravidlo „elapsed → zaokrouhlit na 30 min, minimum 30“ žije ve 3 kopiích: computeChainPush (overlapResolver.ts:82–84), pojistka v overlapResolver.server.ts:141 a blockPrintMinutes (printTimeClient.ts:34). Komentáře výslovně vyžadují ruční synchronizaci („musí souhlasit s fallbackem v computeChainPush… jinak by pojistka falešně hlásila drift“) a rozjetí se už jednou reálně stalo — fix wave etapy 8 musela „legacy pm fallback v chain pushi zarovnat na 30 min“. Další tichá divergence = falešné SCHEDULE_VIOLATION nebo špatné umístění legacy bloků.

**Doporučení:** Extrahovat sdílený helper (např. legacyPrintMinutesFromSpan(startMs, endMs) v printTime.ts — je klient-safe) a volat ho ze všech tří míst. Nezávislost pojistky v overlapResolver.server zůstává zachována — spočívá v re-expanzi přes expandPrintTime, ne v samotné formuli.

**Další výskyty:** `src/lib/overlapResolver.ts:84`, `src/lib/printTimeClient.ts:34`

*Verifikace: Formule Math.max(30, round(elapsed/30)*30) je doslova ve 3 kopiích (overlapResolver.server.ts:141, overlapResolver.ts:82–84, printTimeClient.ts:34) s komentáři výslovně vyžadujícími ruční synchronizaci; jako záměrné to CLAUDE.md nevede.*

### #85 — Smyčka výpočtu weekStarts okna (kotva −1d + DST guard) copy-paste ve 4 kopiích

**Soubor:** `src/lib/printTime.server.ts:53` · **Kategorie:** Duplicita · **Závažnost:** Střední

```
for (let t = from.getTime() - DAY_MS; t <= to.getTime(); t += DAY_MS) {
```

**Dopad:** Jemná logika (denní krok, kotva o den dřív kvůli noční směně přes půlnoc, explicitní přidání posledního týdne kvůli DST fall-back) existuje ve 4 kopiích: printTime.server.ts, overlapResolver.server.ts a 2× scheduleSlotFinder.ts. Kopie se na sebe odkazují komentáři a odkaz už driftuje — printTime.server.ts:56 cituje „vzor scheduleSlotFinder.ts:86“, reálně smyčka leží na ř. 95. Oprava chyby typu fix 5c se musí ručně propagovat do všech kopií; vynechání jedné = tichý fallback na hardcoded rozvrh.

**Doporučení:** Extrahovat helper weekStartsForRange(from, to): Date[] (např. do machineWeekShifts.ts) a použít ho ve všech 4 místech; overlapResolver.server.ts a DB wrappery v scheduleSlotFinder.ts mohou navíc rovnou volat existující loadMachineCalendarRange (printTime.server.ts:43, bere PrismaClientLike, tx vyhovuje) místo vlastního fetch bloku kalendáře.

**Další výskyty:** `src/lib/scheduleSlotFinder.ts:95`, `src/lib/scheduleSlotFinder.ts:215`, `src/lib/overlapResolver.server.ts:51`, `src/lib/printTime.server.ts:56`

*Verifikace: Smyčka weekStarts existuje ve 4 kopiích přesně na uvedených řádcích (printTime.server.ts:53, overlapResolver.server.ts:51, scheduleSlotFinder.ts:95 a 215) a driftující komentářový odkaz „:86“ vs. reálný ř. 95 sedí.*

### #82 — scheduleSlotFinder.ts míchá pure funkce s DB wrappery — prisma import v klientském bundlu

**Soubor:** `src/lib/scheduleSlotFinder.ts:5` · **Kategorie:** Struktura · **Závažnost:** Střední

```
import { prisma } from "@/lib/prisma";
```

**Dopad:** Modul importuje prisma na module scope a zároveň ho importují "use client" komponenty (PlannerPage, BlockEdit) kvůli pure findNextFreeSlot — Prisma browser stub se tak přibaluje do klientského bundlu nejfrekventovanější stránky. new PrismaClient() v browseru dnes nespadne jen proto, že stub hází až při přístupu na property (Proxy) — omylem zavolaný DB wrapper z téhož modulu na klientu selže až za runtime záhadnou chybou, ne při buildu. Je to jediný modul porušující zavedený pure/.server split (printTime vs printTime.server, overlapResolver vs overlapResolver.server) — i jeho test se už jmenuje scheduleSlotFinder.server.test.ts. Netýká se dokumentovaného rozhodnutí ponechat duration-based finder (TODO Plán 4) — jde jen o umístění DB wrapperů.

**Doporučení:** Vytáhnout findNextFreeSlotFromDb a findNextFreePrintSlotFromDb do nového src/lib/scheduleSlotFinder.server.ts (po vzoru overlapResolver.server.ts) a upravit importy v api/blocks/route.ts. Pure funkce zůstanou v scheduleSlotFinder.ts bez prisma importu.

**Další výskyty:** `src/app/_components/PlannerPage.tsx:22`, `src/components/BlockEdit.tsx:21`, `src/app/api/blocks/route.ts:12`

*Verifikace: prisma import je na řádku 5, klientské PlannerPage.tsx:22 a BlockEdit.tsx:21 modul importují, test se jmenuje .server.test.ts — a TODO(Plán 4) se týká duration-based finderu, ne umístění DB wrapperů, takže nejde o zdokumentovaný záměr.*

### #87 — shifts.ts: 4 mrtvé exporty, jeden se zavádějícím docstringem o užití na klientu i serveru

**Soubor:** `src/lib/shifts.ts:136` · **Kategorie:** Mrtvý kód · **Závažnost:** Střední

```
export function deriveHoursFromShifts(flags: ShiftFlags): { startHour: number; endHour: number } {
```

**Dopad:** deriveHoursFromShifts a activeShiftsForDay nemají žádného volajícího nikde v src/ (ani v testech to nezachraňuje — pravidlo nulového užití mimo definici platí); shiftFromHour a isSlotInShift se volají jen navzájem uvnitř souboru. Docstring deriveHoursFromShifts tvrdí „Used both on client (grid UI) and server (normalizeDayInput)“ — ani jedno není pravda, což je v centrálním modulu směn (shifts.ts je jádro flag-only modelu) aktivně zavádějící: láká odvozovat legacy startHour/endHour místo práce se směnovými flagy.

**Doporučení:** Smazat deriveHoursFromShifts, activeShiftsForDay, isSlotInShift a shiftFromHour (příp. shiftFromHour ponechat privátní, pokud by se isSlotInShift někdy vracel); odpovídající testy v shifts.test.ts odstranit ve stejném commitu.

**Další výskyty:** `src/lib/shifts.ts:30`, `src/lib/shifts.ts:40`, `src/lib/shifts.ts:49`

*Verifikace: Repo-wide grep potvrdil nulové reálné užití všech 4 exportů mimo definici a shifts.test.ts (deriveHoursFromShifts nemá ani test) a docstring na ř. 131–132 nepravdivě tvrdí užití na klientu i serveru.*

### #83 — timeSlots.ts: 12 ze 14 exportů bez jediného užití — pozůstatek slot-based modelu

**Soubor:** `src/lib/timeSlots.ts:71` · **Kategorie:** Mrtvý kód · **Závažnost:** Střední

```
export function legacyHoursFromSlots(startSlot: number, endSlot: number)
```

**Dopad:** Mimo soubor žijí jen DAY_SLOT_COUNT (TimelineGrid, ShiftEdgeHandles) a slotFromHourBoundary (scheduleValidation). Zbylých 12 exportů (slotToHour, slotToTimeParts, formatHourValue, formatSlot, getSlotRange, isValidStartSlot, isValidEndSlot, isValidSlotWindow, legacyHoursFromSlots, durationHoursFromSlots, SLOT_MINUTES, SLOTS_PER_HOUR) nemá žádného importéra v src/ ani test — je to API zrušeného startSlot/endSlot modelu pracovní doby (Sprint E přešel na flag-only MachineWeekShifts). ~60 řádků mrtvého povrchu svádí nový kód k zastaralému modelu (getSlotRange validuje startHour/endHour vstupy, které už neexistují).

**Doporučení:** Zredukovat timeSlots.ts na DAY_SLOT_COUNT a slotFromHourBoundary (příp. SLOT_MINUTES jako sdílenou konstantu granularity), zbytek smazat. Build ověří, že nic nechybí.

**Další výskyty:** `src/lib/timeSlots.ts:16`, `src/lib/timeSlots.ts:40`, `src/lib/timeSlots.ts:59`

*Verifikace: Grep celého src/ potvrdil, že mimo soubor se používají jen DAY_SLOT_COUNT a slotFromHourBoundary; zbylých 12 exportů nemá žádného importéra a legacyHoursFromSlots je skutečně na řádku 71.*

### #104 — tailwind.config.mjs se v Tailwind v4 vůbec nenačítá — prázdný theme.extend je past na vývojáře

**Soubor:** `tailwind.config.mjs:8` · **Kategorie:** Mrtvý kód · **Závažnost:** Střední

```
extend: {}
```

**Dopad:** Tailwind v4 je CSS-first a JS config načte jen přes direktivu @config — ta v repu neexistuje (globals.css je jediný CSS soubor a začíná pouze @import "tailwindcss"). Kdo přidá barvy/spacing do theme.extend nebo upraví content globy, nezmění vůbec nic a bude hledat proč. Skutečný zdroj pravdy je @theme blok v globals.css.

**Doporučení:** Soubor tailwind.config.mjs smazat (tokeny patří do @theme v globals.css); zároveň z postcss.config.mjs odebrat autoprefixer — @tailwindcss/postcss vendor prefixy řeší sám.

**Další výskyty:** `postcss.config.mjs:4`, `src/app/globals.css:1`

*Verifikace: Projekt je na Tailwind v4 (@tailwindcss/postcss ^4.2.1), globals.css začíná @import "tailwindcss" bez @config direktivy, takže tailwind.config.mjs s prázdným extend: {} na ř. 8 se nikdy nenačte; postcss.config.mjs navíc obsahuje redundantní autoprefixer.*

## Nálezy — Nízká (21)

### #13 — 14 nepoužitých importů (Badge, Popover×3, TYPE_LABELS, audit formattery, dateUtils…)

**Soubor:** `src/app/_components/PlannerPage.tsx:39` · **Kategorie:** Mrtvý kód · **Závažnost:** Nízká

```
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
```

**Dopad:** Grep v souboru potvrdil, že tyto importy nemají žádné použití: formatCivilDate, formatPragueDateShort, formatPragueDateTime, formatPragueTime (ř. 10–13), snapGroupDeltaWithTemplates (ř. 21), Badge (ř. 37), Popover+PopoverContent+PopoverTrigger (ř. 39), Toast (ř. 43), FIELD_LABELS+fmtAuditVal+formatPragueMaybeToday (ř. 58), TYPE_LABELS (ř. 68), JOB_PRESET_TONE_PALETTE (ř. 71). Zavádějí čtenáře (soubor vypadá, že renderuje audit/popovery) a maskují skutečné závislosti souboru.

**Doporučení:** Smazat uvedené importy (mechanická změna, build ověří). Zvážit zapnutí ESLint pravidla no-unused-vars/unused-imports jako error pro *.tsx, aby se znovu nehromadily.

**Další výskyty:** `src/app/_components/PlannerPage.tsx:10`, `src/app/_components/PlannerPage.tsx:21`, `src/app/_components/PlannerPage.tsx:37`, `src/app/_components/PlannerPage.tsx:43`, `src/app/_components/PlannerPage.tsx:58`, `src/app/_components/PlannerPage.tsx:68`, `src/app/_components/PlannerPage.tsx:71`

*Verifikace: Grep celého souboru potvrdil nulové užití všech 14 vyjmenovaných importů mimo import blok (Toast se vyskytuje jen v komentáři na ř. 561).*

### #12 — Keyboard shortcuts efekt (Ctrl+C/X/V/Z, Delete, Esc — ~110 řádků) extrahovat do hooku

**Soubor:** `src/app/_components/PlannerPage.tsx:2823` · **Kategorie:** Struktura · **Závažnost:** Nízká

```
const handler = (e: KeyboardEvent) => {
```

**Dopad:** Efekt ř. 2822–2932 obsahuje kompletní klávesovou mapu planneru včetně clipboard sémantiky (single vs. group precedence, cut guardy na locked/printed). Je to uzavřený celek závislý jen na refech a callbaccích — v orchestrátoru zabírá místo a mapa zkratek není dohledatelná jako celek.

**Doporučení:** Extrahovat hook usePlannerHotkeys({ selectedBlockRef, selectedBlockIdsRef, blocksRef, clipboard refy, undoMgr/redoMgr, showToast, akce }) do src/hooks/ (~-110 řádků). Čistě mechanický přesun, binding zůstane jednorázový na mount.

**Další výskyty:** `src/app/_components/PlannerPage.tsx:2822`, `src/app/_components/PlannerPage.tsx:2930`

*Verifikace: Efekt ř. 2822–2932 (~110 řádků) obsahuje celou klávesovou mapu (Esc/Delete/Ctrl+Z/Y/C/X/V vč. cut guardů) závislou jen na refech a callbaccích, handler přesně na ř. 2823.*

### #26 — Landing-zone colorMap definovaná 2× v jednom renderu a mimo centrální barvy typů

**Soubor:** `src/app/_components/TimelineGrid.tsx:4000` · **Kategorie:** Duplicita · **Závažnost:** Nízká

```
const colorMap: Record<string, string> = { ZAKAZKA: "#1a6bcc", REZERVACE: "#7c3aed", UDRZBA: "#22c55e" };
```

**Dopad:** Identická mapa barev drag landing zón je vytvořená dvakrát uvnitř renderu (multi-move ř. 3982 a anchor ř. 4000). Hodnoty ZAKAZKA/REZERVACE kopírují TYPE_BUILDER_CONFIG z plannerTypes.ts, UDRZBA se od něj liší (#22c55e vs #c0392b) — změna barvy typu se do landing zón nepropíše.

**Doporučení:** Vytáhnout mapu na module-level konstantu (nebo odvodit z TYPE_BUILDER_CONFIG/BLOCK_STYLES accentů) a obě místa na ni odkázat.

**Další výskyty:** `src/app/_components/TimelineGrid.tsx:3982`, `src/lib/plannerTypes.ts:24`

*Verifikace: Identická colorMap je vytvořená dvakrát uvnitř renderu (ř. 3982 a 4000) a UDRZBA #22c55e se skutečně liší od #c0392b v TYPE_BUILDER_CONFIG (plannerTypes.ts ř. 26).*

### #54 — Trojmo zkopírovaná swap logika řazení (sortOrder) v CodebookSection a PresetSection

**Soubor:** `src/app/admin/_components/AdminDashboard.tsx:811` · **Kategorie:** Duplicita · **Závažnost:** Nízká

```
async function handleMoveUp(index: number) {
```

**Dopad:** handleMoveUp a handleMoveDown v CodebookSection jsou copy-paste s prohozenými indexy a handleMove v PresetSection (ř. 1313) dělá totéž potřetí nad jiným endpointem — vzor „prohoď sortOrder dvou položek přes dva paralelní PUTy a refetchni". Změna vzoru (např. optimistický update nebo jeden batch endpoint) se musí propsat na tři místa.

**Doporučení:** Sjednotit na parametrizovanou variantu z PresetSection (direction: -1 | 1) a extrahovat helper swapSortOrder(baseUrl, a, b) do sdíleného admin modulu; handleMoveUp/Down nahradit jeho voláním.

**Další výskyty:** `src/app/admin/_components/AdminDashboard.tsx:828`, `src/app/admin/_components/AdminDashboard.tsx:1313`

*Verifikace: handleMoveUp (811) a handleMoveDown (828) jsou copy-paste swap přes dva paralelní PUTy na /api/codebook a handleMove (1313) dělá identický vzor potřetí nad /api/job-presets.*

### #69 — Loading stav expedice je plain text „Načítám...“ místo sdíleného LoadingSpinner

**Soubor:** `src/app/expedice/_components/ExpedicePage.tsx:572` · **Kategorie:** Komponenty · **Závažnost:** Nízká

```
Načítám...
```

**Dopad:** Rezervace používají komponentu ui/LoadingSpinner (animace + typografická elipsa „Načítám…“), expedice statický text s ASCII tečkami. Dva moduly vedle sebe tak mají různý loading vzhled, přestože sdílená komponenta existuje přesně pro tento účel.

**Doporučení:** Nahradit text v loading větvi ExpedicePage komponentou <LoadingSpinner /> z @/components/ui/LoadingSpinner.

**Další výskyty:** `src/app/rezervace/_components/RezervacePage.tsx:319`

*Verifikace: Loading větev renderuje plain text „Načítám...“ (ř. 572), zatímco sdílená komponenta src/components/ui/LoadingSpinner.tsx existuje a RezervacePage:319 ji používá.*

### #24 — Mrtvé CSS třídy .tl-morning a .tl-day-alt pro pásy směn

**Soubor:** `src/app/globals.css:265` · **Kategorie:** Mrtvý kód · **Závažnost:** Nízká

```
.tl-day-alt    { background-color: rgba(0,0,0,0.05); }
```

**Dopad:** Kód kreslí jen tl-night/tl-afternoon (TimelineGrid ř. 3703; MORNING intervaly se filtrují na ř. 3699). Třídy .tl-morning a .tl-day-alt nikde v src nejsou použité — grep 0 výskytů — přitom CLAUDE.md tl-day-alt popisuje jako živou část featury pásů. Navíc .dark .tl-morning je bílá 0.07, což odporuje komentáři v kódu „ranní je v CSS transparentní" — latentní past při budoucím zapnutí.

**Doporučení:** Smazat obě mrtvé třídy z globals.css (light i .dark varianty) a opravit zmínku o tl-day-alt v CLAUDE.md, ať dokumentace sedí na kód.

**Další výskyty:** `src/app/globals.css:263`, `src/app/globals.css:268`, `src/app/globals.css:270`, `src/app/_components/TimelineGrid.tsx:3703`

*Verifikace: Třídy .tl-morning a .tl-day-alt mají 0 užití mimo globals.css (TimelineGrid ř. 3703 kreslí jen tl-night/tl-afternoon, MORNING filtrován na ř. 3699) a .dark .tl-morning bílá 0.07 odporuje komentáři o transparentní ranní.*

### #78 — ReportView si drží lokální kopii TYPE_LABELS vedle sdílené v plannerTypes

**Soubor:** `src/app/report/daily/ReportView.tsx:52` · **Kategorie:** Duplicita · **Závažnost:** Nízká

```
const TYPE_LABELS: Record<string, string> = {
```

**Dopad:** Stejné tři klíče (ZAKAZKA/REZERVACE/UDRZBA) existují v src/lib/plannerTypes.ts:17, jen s jinou velikostí písmen. Při přidání nového typu bloku dostane planner label, ale denní report vytiskne surový enum string (fallback ?? block.type) — tichá divergence číselníku.

**Doporučení:** Importovat TYPE_LABELS z plannerTypes a malá písmena řešit přes .toLowerCase() (nebo CSS text-transform) v badge — lokální kopii smazat.

**Další výskyty:** `src/lib/plannerTypes.ts:17`

*Verifikace: ReportView ř. 52 drží lokální TYPE_LABELS (zakázka/rezervace/údržba malými písmeny), zatímco plannerTypes.ts:17 exportuje sdílenou verzi se stejnými třemi klíči — nový typ bloku by v reportu propadl na surový enum.*

### #79 — ReportDashboard reimplementuje kalendářní aritmetiku mimo dateUtils

**Soubor:** `src/app/reporty/_components/ReportDashboard.tsx:40` · **Kategorie:** Struktura · **Závažnost:** Nízká

```
function getWeekStart(dateStr: string): string {
```

**Dopad:** getWeekStart/getWeekEnd/getMonthStart/getMonthEnd počítají civil-date posuny vlastní Date.UTC aritmetikou uvnitř komponenty, přestože dateUtils nabízí civilDateDayOfWeek, addDaysToCivilDate, daysInCivilMonth atd. Datumová logika tak žije na dalším místě, kde se dá udělat off-by-one v definici týdne (pondělní start).

**Doporučení:** Přesunout tyto čtyři helpery do src/lib/dateUtils.ts (nebo je přepsat přes existující civilDate* funkce) a v komponentě je jen importovat.

**Další výskyty:** `src/app/reporty/_components/ReportDashboard.tsx:49`, `src/app/reporty/_components/ReportDashboard.tsx:53`, `src/app/reporty/_components/ReportDashboard.tsx:59`

*Verifikace: getWeekStart začíná přesně na řádku 40 (getMonthStart 49, getMonthEnd 53, getWeekEnd 59) s vlastní Date.UTC aritmetikou, přestože dateUtils.ts nabízí addDaysToCivilDate, civilDateDayOfWeek i daysInCivilMonth.*

### #70 — PlanningForm definuje lokální interface CodebookOption — subset typu z plannerTypes

**Soubor:** `src/app/rezervace/_components/PlanningForm.tsx:13` · **Kategorie:** Duplicita · **Závažnost:** Nízká

```
interface CodebookOption {
```

**Dopad:** src/lib/plannerTypes.ts:5 exportuje kanonický typ CodebookOption (id, category, label, sortOrder, isActive, shortCode, isWarning, badgeColor); PlanningForm si deklaruje vlastní třípolíčkovou verzi (id, label, isWarning) pro tatáž data z /api/codebook. Při rozšíření číselníku (např. badgeColor pro barevné odlišení možností jako v planneru) lokální typ zamlčí dostupná pole.

**Doporučení:** Importovat CodebookOption z @/lib/plannerTypes (nebo Pick<CodebookOption, "id" | "label" | "isWarning">) a lokální interface smazat.

*Verifikace: PlanningForm.tsx:13 deklaruje lokální třípolíčkový interface CodebookOption (id, label, isWarning), zatímco src/lib/plannerTypes.ts:5 exportuje kanonický osmipolíčkový typ téhož jména.*

### #68 — Drobné copy-paste duplikáty: formatBytes 2× a handleLogout 2×

**Soubor:** `src/app/rezervace/_components/ReservationForm.tsx:23` · **Kategorie:** Duplicita · **Závažnost:** Nízká

```
function formatBytes(bytes: number): string {
```

**Dopad:** Identická funkce formatBytes je v ReservationForm i ReservationDetail; identický handleLogout (fetch /api/auth/logout + redirect) je v RezervacePage:74-77 i PlannerPage:1457-1460. Malé, ale zbytečné dvojité údržby — např. změna zaokrouhlení velikostí příloh nebo logout flow se musí dělat na dvou místech.

**Doporučení:** formatBytes přesunout do src/lib (např. formatters.ts) a importovat; handleLogout extrahovat do malého helperu (src/lib/logout.ts) sdíleného oběma stránkami.

**Další výskyty:** `src/app/rezervace/_components/ReservationDetail.tsx:34`, `src/app/rezervace/_components/RezervacePage.tsx:74`, `src/app/_components/PlannerPage.tsx:1457`

*Verifikace: formatBytes je identicky v ReservationForm:23 i ReservationDetail:34 a handleLogout (fetch /api/auth/logout + redirect) je doslovně stejný v RezervacePage:74 i PlannerPage:1457.*

### #67 — ReservationForm: nepoužitá prop currentUser a mrtvá proměnná valid

**Soubor:** `src/app/rezervace/_components/ReservationForm.tsx:29` · **Kategorie:** Mrtvý kód · **Závažnost:** Nízká

```
export default function ReservationForm({ onCreated }: Props) {
```

**Dopad:** Props deklarují currentUser (řádek 7) a RezervacePage ji předává (řádek 313), ale komponenta ji vůbec nedestrukturuje — čtenář hledá roli/oprávnění, která se nikde nepoužívají. V handleFileAdd navíc pole valid (řádek 47) dostává push(...arr) (řádek 61), ale nikdy se nečte — pozůstatek starší validační logiky.

**Doporučení:** Odstranit currentUser z Props i z volání v RezervacePage a smazat obě řádky s valid.

**Další výskyty:** `src/app/rezervace/_components/ReservationForm.tsx:47`, `src/app/rezervace/_components/ReservationForm.tsx:61`, `src/app/rezervace/_components/RezervacePage.tsx:313`

*Verifikace: Props deklarují currentUser (ř. 7), komponenta na ř. 29 destrukturuje jen onCreated, RezervacePage ji předává (ř. ~313), a pole valid (ř. 47) dostává push (ř. 61), ale nikde se nečte.*

### #53 — Mrtvý kód: nepoužitý btnSuccess, nepoužité ACTION_LABELS a ternár s identickými větvemi

**Soubor:** `src/components/admin/ShiftRoster.tsx:77` · **Kategorie:** Mrtvý kód · **Závažnost:** Nízká

```
const btnSuccess: React.CSSProperties = {
```

**Dopad:** btnSuccess (12 řádků stylu) se v ShiftRoster nikde nepoužívá (grep: jediný výskyt = definice) — tlačítko Publikovat používá btnPrimary. ACTION_LABELS v AuditLogPanel (ř. 31) je také jen definice bez použití — ActionContent má texty natvrdo, takže mapa mate: úprava labelů v ní nic nezmění. Ternár na ShiftRoster ř. 437 má obě větve identické (`1px solid SEPARATOR`). Zavádí to čtenáře při úpravách.

**Doporučení:** Smazat btnSuccess a ternár zjednodušit na prostou hodnotu; ACTION_LABELS buď smazat, nebo skutečně použít v ActionContent místo hardcoded textů.

**Další výskyty:** `src/components/admin/AuditLogPanel.tsx:31`, `src/components/admin/ShiftRoster.tsx:437`

*Verifikace: Grep src/ potvrzuje: btnSuccess má jediný výskyt (definice ř. 77), ACTION_LABELS jediný výskyt (AuditLogPanel:31) a ternár na ShiftRoster ř. 437 má obě větve identické.*

### #36 — Logika „tisk vs. celkem" délky bloku implementovaná dvakrát s různými formátovači

**Soubor:** `src/components/BlockDetail.tsx:47` · **Kategorie:** Duplicita · **Závažnost:** Nízká

```
return `${minsToHuman(pm)} tisku (${minsToHuman(elapsedMins)} celkem)`;
```

**Dopad:** Guard (elapsed vs blockPrintMinutes, jen ZAKAZKA) je opsán v blockLengthLabel (BlockDetail) i blockDurationLabel (DtpPanel), každý s vlastním formátovačem minut (minsToHuman „2 hod 30 min" vs fmtHours „2.5 hod"). Změna pravidla (např. zohlednění bypass bloků) se musí provést na více místech a snadno se zapomene.

**Doporučení:** Přidat do src/lib/printTimeClient.ts sdílený helper (např. blockDurationParts(block) → {printMins, elapsedMins, differs}); lokálně ponechat jen prezentaci textu — konkrétní znění obou textů je v CLAUDE.md zdokumentované, měnit ho není potřeba.

**Další výskyty:** `src/components/DtpPanel.tsx:76`

*Verifikace: Guard elapsed vs blockPrintMinutes je duplicitně v blockLengthLabel (BlockDetail:42–48) i blockDurationLabel (DtpPanel:71–77) s různými formátovači.*

### #39 — toLocaleString místo Prague-TZ helperů z dateUtils

**Soubor:** `src/components/BlockDetail.tsx:349` · **Kategorie:** Duplicita · **Závažnost:** Nízká

```
const timeStr = time.toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" });
```

**Dopad:** Sekce „Druhá část" v BlockDetail a časy poznámek v BlockNotesDialog formátují čas v timezone prohlížeče, zatímco zbytek BlockDetail používá formatPragueDateTime (dateUtils.ts:225). Na stroji s jinou TZ ukáže jeden detail dva různé časy pro tentýž okamžik, a formát zápisu se liší i v Praze.

**Doporučení:** Nahradit oba výskyty voláním formatPragueDateTime z @/lib/dateUtils.

**Další výskyty:** `src/components/BlockNotesDialog.tsx:208`

*Verifikace: BlockDetail:349 i BlockNotesDialog:208 formátují přes toLocaleString bez timeZone, zatímco zbytek souboru používá formatPragueDateTime (dateUtils:225).*

### #91 — BlockDetail formátuje čas split partnera bez timeZone — poruší zásadu „vždy Praha čas“

**Soubor:** `src/components/BlockDetail.tsx:349` · **Kategorie:** Vizuál · **Závažnost:** Nízká

```
time.toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" })
```

**Dopad:** Jediné místo z prohlédnutých formátování, kde chybí timeZone: "Europe/Prague" — čas split chipu se vykreslí v timezone prohlížeče. dateUtils.ts přitom hlavičkou deklaruje, že vše se zobrazuje v Praha čase bez ohledu na TZ prohlížeče/serveru. Pro uživatele s jinou TZ (notebook na cestách, VPN, změněné systémové nastavení) ukáže detail bloku posunutý čas druhé části zakázky.

**Doporučení:** Nahradit řádek voláním formatPragueDateTime(time) z @/lib/dateUtils — jednořádková změna.

*Verifikace: Řádek 349 přesně sedí — toLocaleString bez timeZone: Europe/Prague poruší Praha-TZ konvenci u času split partnera.*

### #37 — Mix ui/Button a ručně stylovaných \<button> ve stejných akčních řadách

**Soubor:** `src/components/BlockEdit.tsx:1298` · **Kategorie:** Komponenty · **Závažnost:** Nízká

```
<Button type="button" variant="ghost" onClick={onClose} disabled={saving} className="text-slate-400 text-xs">
```

**Dopad:** Primární CTA „Uložit změny" je raw <button> s ~25 řádky inline stylů, zatímco „Zrušit" hned vedle je ui/Button; BlockNotesDialog a rezervační akce v BlockDetail ui/ primitivy nepoužívají vůbec. Hover/disabled stavy se chovají pokaždé trochu jinak a nové varianty tlačítek vznikají ad hoc.

**Doporučení:** Rozšířit ui/button o brand-CTA variantu (CVA variant s var(--brand) gradientem) a při dotyku souborů nahrazovat raw tlačítka; nová tlačítka psát výhradně přes ui/Button.

**Další výskyty:** `src/components/BlockEdit.tsx:1273`, `src/components/BlockNotesDialog.tsx:355`, `src/components/BlockDetail.tsx:418`

*Verifikace: Primární CTA 'Uložit změny' je raw button s ~25 řádky inline stylů (ř. 1273–1297) vedle ui/Button 'Zrušit' na ř. 1298; BlockNotesDialog (ř. 355) i rezervační akce v BlockDetail (ř. 418) používají raw buttony, přestože BlockDetail ui/Button importuje.*

### #38 — BlockNotesDialog: povinný prop blockId se nikdy nepoužije

**Soubor:** `src/components/BlockNotesDialog.tsx:9` · **Kategorie:** Mrtvý kód · **Závažnost:** Nízká

```
blockId: number;
```

**Dopad:** Props interface blockId vyžaduje a PlannerPage ho předává (ř. 4367), ale destrukturace v komponentě (ř. 21–32) ho vynechává — hodnota se nikde nepoužije. TypeScript nutí callery posílat mrtvý údaj a čtenář marně hledá, k čemu slouží.

**Doporučení:** Odstranit blockId z Props i z call situ v PlannerPage (onCreate/onUpdate/onDelete už blok identifikují v closure).

**Další výskyty:** `src/app/_components/PlannerPage.tsx:4367`

*Verifikace: Prop blockId je v Props (ř. 9) a PlannerPage ho předává, ale destrukturace ho vynechává — v komponentě se nikde nepoužívá.*

### #40 — DtpDataPopover má hardcoded tmavou paletu mimo theme tokeny

**Soubor:** `src/components/DtpDataPopover.tsx:76` · **Kategorie:** Vizuál · **Závažnost:** Nízká

```
background: "#1c1c1e",
```

**Dopad:** Popover ignoruje theme tokeny (#1c1c1e, #2c2c2e, rgba(255,255,255,…) texty) — v light módu zůstane tmavý ostrov nekonzistentní s DtpPanelem, který var(--surface)/var(--border) používá.

**Doporučení:** Vyměnit 6 hardcoded hodnot v souboru za var(--surface), var(--surface-2), var(--border) a var(--text-muted).

**Další výskyty:** `src/components/DtpDataPopover.tsx:93`

*Verifikace: Řádek 76 má background '#1c1c1e', řádek 93 '#2c2c2e' a soubor obsahuje další hardcoded rgba/hex hodnoty mimo theme tokeny.*

### #41 — InfoPanel.tsx a InboxPanel.tsx už neobsahují komponenty, po nichž se jmenují

**Soubor:** `src/components/InfoPanel.tsx:18` · **Kategorie:** Struktura · **Závažnost:** Nízká

```
export function AuditList({ logs, onJumpToBlock }: {
```

**Dopad:** Soubory exportují jen AuditList/InboxList + typy; komponenty InfoPanel/InboxPanel neexistují (všechny importy v repu berou jen listy a typy — BlockDetail, NotificationsPanel, useNotifications). Název souboru i popis v CLAUDE.md („audit log panel") navádí při hledání špatně.

**Doporučení:** Přejmenovat na AuditList.tsx / InboxList.tsx, upravit 4 importy a odpovídající řádky v CLAUDE.md.

**Další výskyty:** `src/components/InboxPanel.tsx:21`

*Verifikace: InfoPanel.tsx exportuje jen AuditList + AuditLogEntry a InboxPanel.tsx jen InboxList + NotificationItem (ř. 21); komponenty podle názvů souborů neexistují a všechny importy berou jen listy/typy.*

### #89 — Mrtvé exporty startOfPragueDay a startOfPragueToday v dateUtils.ts

**Soubor:** `src/lib/dateUtils.ts:205` · **Kategorie:** Mrtvý kód · **Závažnost:** Nízká

```
export function startOfPragueDay(date: Date): Date {
```

**Dopad:** Obě funkce mají nulové užití v celém src/ včetně testů a vlastního souboru (nevolají se ani interně). Mrtvý povrch v nejimportovanějším utility modulu zvětšuje API, které musí čtenář mentálně udržovat.

**Doporučení:** Smazat startOfPragueDay i startOfPragueToday. Volitelně ve stejném úklidu odebrat export keyword u civilDateToUTCNoon a formatPragueDate (užívané jen interně v dateUtils).

**Další výskyty:** `src/lib/dateUtils.ts:209`, `src/lib/dateUtils.ts:158`, `src/lib/dateUtils.ts:213`

*Verifikace: startOfPragueDay (ř. 205) a startOfPragueToday (ř. 209) nemají žádné užití v celém repu včetně testů a vlastního souboru.*

### #90 — Konstanta SLOT_MS (30min grid) definovaná v 5 kopiích

**Soubor:** `src/lib/workingTime.ts:7` · **Kategorie:** Duplicita · **Závažnost:** Nízká

```
const SLOT_MS = 30 * 60 * 1000;
```

**Dopad:** Granularita plánovací mřížky je definovaná 5× — printTime.ts ji exportuje (a printTimeClient/scheduleValidationServer ji odtud importují), ale workingTime.ts, pasteTarget.ts, TimelineGrid.tsx a inline scheduleValidation.ts mají vlastní kopie. Hodnota se reálně nezmění, ale roztroušené kopie zamlžují, že jde o jeden systémový invariant svázaný s pm % 30 validací.

**Doporučení:** Importovat SLOT_MS z @/lib/printTime ve workingTime.ts, pasteTarget.ts, TimelineGrid.tsx a scheduleValidation.ts (printTime je klient-safe, cyklický import nehrozí — workingTime → printTime směr ověřit: printTime už importuje workingTime, takže pro workingTime.ts vzít konstantu ze společného timeSlots.SLOT_MINUTES místo printTime).

**Další výskyty:** `src/lib/printTime.ts:4`, `src/lib/pasteTarget.ts:3`, `src/app/_components/TimelineGrid.tsx:75`, `src/lib/scheduleValidation.ts:105`

*Verifikace: SLOT_MS má 4 lokální kopie (workingTime.ts:7, pasteTarget.ts:3, TimelineGrid.tsx:75, scheduleValidation.ts:105) vedle exportu v printTime.ts:4 — všechna čísla řádků sedí přesně.*

---

## Vizuální jazyk — návrh sjednocení (výstup design-system architekta)

### Sjednocení vizuálního jazyka aplikace „Výrobní plán" — návrh design systému

### 1) Současný stav v kostce

Zdrojem pravdy vizuálu dnes **nejsou komponenty, ale CSS proměnné v `globals.css` — a ty jsou dvoje**:

- **Aplikační tokeny** — `--surface`, `--surface-2`, `--surface-3`, `--text`, `--text-muted`, `--brand`, `--brand-contrast`, `--danger`, `--success`, `--warning`, `--timeline-bg`, `--badge-*` — definované pro light (`globals.css:148–170`) i dark (`globals.css:205–227`). Tohle je slovník, kterým reálně mluví většina aplikace: AdminDashboard má nad nimi postavený lokální mini-systém `btnPrimary`/`btnSecondary`/`btnDanger`/`inputStyle` (`AdminDashboard.tsx:98–164`), stejně tak Rezervace (`RezervacePage.tsx:226–309`), Expedice (`ExpedicePage.tsx:474–497` — vlastní `pillBtn`/`outlineBtn`/`divider`) a ReportDashboard (`BTN_ACTIVE` s `var(--brand)`, `ReportDashboard.tsx:102–107`).
- **shadcn tokeny** — `--background`, `--card`, `--primary`, `--ring`… mapované do Tailwind v4 přes `@theme inline` (`globals.css:74–113`). Používá je vrstva `src/components/ui/` (button/badge/input/select/tooltip — CVA + Radix, `ui/button.tsx:7–35`) a `layout.tsx:13` (`bg-background text-foreground`).

Klíčová fakta o adopci:

- `tailwind.config.mjs` je prázdný (`theme: { extend: {} }`) — vše žije v CSS, což je pro Tailwind v4 správně; theme je `defaultTheme="system"` (`providers.tsx:10`), takže **light mode je legitimní runtime stav**, ne teoretický.
- `ui/` primitivy importuje jen **10 souborů** v celém `src/`; `ui/button` jen 6. Zbytek staví tlačítka ručně.
- Dominantní stylovací režim je **inline `style={{}}`**: PlannerPage 262 výskytů, TimelineGrid 201; ExpedicePage nemá ani jeden `className`. To není chyba k „opravě" — je to vědomý iOS-like vizuální jazyk celé aplikace.
- **Bridge vrstva** `:root:not(.dark) .bg-slate-900 { … !important }` (`globals.css:232–259`) přemapovává staré `slate-*` utility na tokeny — přiznaný dočasný hack.
- Systém má i dobré globální vzory: pressed-state pro všechna tlačítka (`globals.css:29–35`), `theme-transition` helpery (`globals.css:56–72`), radius škálu (`globals.css:75–81`).

Kde se jazyk láme (potvrzeno auditem):

- **Brand barva existuje dvakrát**: `var(--brand)` (badge fronty `PlannerPage.tsx:4201`, `btnPrimary` adminu) vs. natvrdo `#FFE600` na 9 místech (grep) — obě hlavní CTA builderu (`PlannerPage.tsx:4148, 4175`), login CTA (`login/page.tsx:116` — s `color: var(--bg)`, což je v light modu bílý text na žluté), selection outline v TimelineGrid.
- **Tmavé/bílé ostrovy mimo theme**: delete dialogy `#262630` (`PlannerPage.tsx:2950, 2995`), `DtpDataPopover` (`#1c1c1e`), naopak bílé `OrderSearchSheet.tsx:65` a `rgba(255,255,255,…)` napříč Expedicí (`ExpediceCard.tsx:59`) — v light modu neviditelné.
- **Z-index bez škály**: ~15 hodnot 1–9999 inline v TimelineGrid (31 výskytů `zIndex`), delete overlay 10000 (`PlannerPage.tsx:2946`).
- **Focus-visible mimo `ui/` neexistuje** — jediné výskyty jsou `.audit-input`/`.audit-chip` (`globals.css:278–285`); 37× inline `outline: "none"` bez náhrady.
- **Typografie**: `fontFamily: "-apple-system, …"` se opakuje inline (login:138, Rezervace:223, Expedice:503, AdminDashboard:112…) místo jednoho pravidla na `body`.
- **Jazyk**: ReportDashboard má tělo bez diakritiky („Vytizeni", „Prutok zakazek", `DOW_LABELS` `ReportDashboard.tsx:109`), header téže stránky diakritiku má.
- **Chrome modulů se rozchází**: ThemeToggle je jen v Planneru, Adminu a Rezervacích; Expedice (`ExpedicePage.tsx:506–563`) a Reporty ho nemají, Expedice nemá ani uživatele/odhlášení.

### 2) Cílový stav — principy

**Jedna kanonická sada tokenů = aplikační sada.** `--surface/-2/-3`, `--text`, `--text-muted`, `--border`, `--brand`, `--brand-contrast`, `--danger/--success/--warning`, `--badge-*`. shadcn sada (`--card`, `--popover`, `--primary`…) zůstává jako interní jazyk `ui/` primitiv, mapovaná na tutéž paletu — nerozšiřovat její použití do aplikačního kódu. Pravidlo: **žádný barevný literál (`#hex`, `rgba(255,255,255,…)`, `"white"`) v komponentách; hex smí existovat jen v definici tokenu v `globals.css`** (rozšíření stávající admin konvence z `project_admin_ui_style.md` na celou aplikaci). Odstíny odvozovat přes `color-mix(in oklab, var(--x) N%, transparent)` — vzor, který už admin i login používají.

**Typografie a spacing.** Font jednou na `body` v `globals.css` (`-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif`), inline `fontFamily` postupně mazat. Velikostní stupnice, kterou aplikace de facto už má, jen ji pojmenovat v dokumentaci: 9/10/11 (mikro-labely, uppercase + letter-spacing), 12/13 (běžný UI text), 15 (nadpisy panelů), 26 (KPI čísla). Radius: používat existující škálu z `@theme` (`globals.css:75–81`) — de facto konvence je 6–8 (malé prvky), 10 (tlačítka/inputy), 12–16 (karty/dialogy).

**Z-index škála.** Jeden modul s pojmenovanými konstantami (obsah bloku 1–5 < drag stavy < preview/markery < sticky header/handles < hover card < popover < context menu < modal < tooltip/datepicker). Literály se nahrazují mechanicky, chování se nemění.

**Focus + kontrast standard.** Globální `:focus-visible` pravidlo v `globals.css` s `outline: 2px solid var(--ring)` — s `!important`, aby přebilo inline `outline: "none"` (inline styl jinak vyhrává). Kontrastní pravidlo: každá komponenta musí být čitelná v obou theme — tj. žádná barva „kalibrovaná jen na dark" (disabled stavy CTA, bílé okraje Expedice).

**Komponentní vrstva — malá a sdílená.** Ne „všechno přes shadcn", ale: co existuje v `ui/`, to se používá (Select, Tooltip, Popover, Button pro dialogová tlačítka — jak už dělají delete dialogy `PlannerPage.tsx:2976–2983`); co se v aplikaci opakuje 3×+ napříč moduly, dostane sdílenou komponentu nebo sdílený style-objekt (PrimaryCta, hlavička modulu, pill/segmented control). Emoji chipy na blocích (⏸ ✂ ⚠ 📝) jsou zavedený doménový jazyk — zůstávají beze změny.

### 3) Tři cesty

#### (a) Design tokens: dotažení CSS proměnných + postupná adopce

**Co obnáší:** Kanonizovat aplikační tokeny (žádné nové netřeba — sada v `globals.css` je úplná, chybí jen `--font-ui` a z-škála), napsat je do dokumentace jako závazné, a mechanicky nahradit ~60 míst s literály (hitlist z auditu: Expedice, OrderSearchSheet, DtpDataPopover, delete dialogy, login CTA, ShiftHoursPopover, JobPresetEditor). Přidat globální focus-visible pravidlo a `zLayers.ts`.

- **Pracnost: S–M** (náhrady jsou mechanické, žádná změna logiky).
- **Rizika:** minimální — každá náhrada je vizuálně ověřitelná v obou theme; `color-mix` odstíny nemusí sedět na pixel přesně (u dark modu je to žádoucí sblížení, ne regrese).
- **Co NEřeší:** duplicitu komponent — každý modul si dál ručně staví tlačítka a pilly, jen ze správných barev. Neřeší ani vynucení do budoucna (nový kód může literály zavléct zpět).

#### (b) Plnohodnotné rozšíření shadcn/ui vrstvy

**Co obnáší:** Doplnit `ui/dialog` (nahradí ruční delete overlaye), `ui/tabs` (segmented controly Rezervací/Adminu/Reportů), `ui/table`, `ui/dropdown-menu`, `ui/sheet` (OrderSearchSheet), případně `ui/sonner` místo vlastního ToastContaineru; existující ruční vzory na ně přemapovat. Znamená to přepis JSX z inline stylů na Tailwind třídy ve všech dotčených místech.

- **Pracnost: L.**
- **Rizika:** vysoká — vizuální jazyk aplikace je inline-style, iOS-like, s vlastními animacemi a pressed-staty; shadcn default vzhled by ho změnil, takže by se stejně musel přestylovat. Bridge vrstva `slate-*` (`globals.css:232–259`) je památka na to, že Tailwind třídy a theme se tu už jednou rozjely. Přepis denně používaných dialogů/tabů v produkčním nástroji = regresní riziko neúměrné přínosu. ToastContainer a context-menu už fungují a mají doménové chování.
- **Co NEřeší:** jádro aplikace — TimelineGrid, bloky, queue karty — je bespoke a shadcn pro něj nic nenabízí. Neřeší ani barevné literály (ty jsou v inline stylech, ne v chybějících komponentách).

#### (c) Lehký vlastní systém: dokumentované konvence + pár sdílených komponent

**Co obnáší:** Povýšit to, co už v aplikaci organicky vzniklo, na explicitní systém: vzor `btnPrimary`/`btnSecondary`/`inputStyle` z AdminDashboardu (`AdminDashboard.tsx:105–153`) přesunout do sdíleného modulu (např. `src/lib/uiStyles.ts`) a nechat z něj čerpat Expedici, Rezervace i Reporty; extrahovat 2–4 skutečné komponenty (`PrimaryCta` — brand CTA s disabled stavem z tokenů; `ModuleHeader` — logo/název/ThemeToggle/odhlásit; `PillGroup` — segmented control). Konvence sepsat do CLAUDE.md, kde je AI asistenti při každé session čtou a vynucují.

- **Pracnost: S–M.**
- **Rizika:** systém stojí na disciplíně (žádný lint to nehlídá) — v tomto týmu to ale reálně hlídá CLAUDE.md + review; sdílený style-objekt nemá varianty/focus chování Radixu, takže na komplexní primitivy (Select, Popover) dál potřebuje `ui/`.
- **Co NEřeší:** samo o sobě barevné literály (to je cesta a) ani accessibility Radix primitiv — je to nadstavba, ne náhrada.

### 4) Doporučení: kombinace (a) + (c), shadcn vrstvu zachovat, ale nerozšiřovat

Pro tento tým (2 vývojáři-amatéři + AI asistenti, interní produkce na firemním serveru, aplikace v denním provozu) je rozhodující, že **aplikace už jeden konzistentní vizuální jazyk má** — aplikační tokeny + inline styly + iOS-like interakce. Problém není chybějící systém, ale ~60 míst, která z něj vypadla, a chybějící pojmenování (z-index, font, brand CTA). Proto:

1. **Cesta (a) jako základ** — mechanická, nízkoriziková, každý krok samostatně nasaditelný a AI asistent ji zvládne provést i uhlídat. Opravuje reálné bugy (light mode rozbitý v Expedici, loginu, dialozích), ne jen estetiku.
2. **Cesta (c) jako nadstavba** — sdílený `uiStyles.ts` + `PrimaryCta` + `ModuleHeader` zabrání tomu, aby další modul (a další AI session) znovu vynalézal tlačítka. Konvence do CLAUDE.md je v tomto workflow efektivnější vynucení než ESLint pravidlo, které nikdo neumí ladit.
3. **Cestu (b) vědomě odmítnout jako etapu** — `ui/` primitivy zůstávají pro to, co už kryjí (Select, Tooltip, Popover, dialogová tlačítka), nové se přidá jen když konkrétní feature narazí na díru (kandidát do budoucna: `ui/dialog` pro delete overlaye — ale až jako refaktor při nejbližší úpravě té funkce, ne samoúčelně). Big-bang přepis denního nástroje je pro dvoučlenný tým bez QA nepřiměřené riziko.

### 5) Prvních 6 kroků příští etapy

Seřazené od nejnižšího rizika; každý krok je samostatně commitnutelný a žádný nemění chování obrazovek.

1. **`src/app/globals.css` — focus-visible + font.** Přidat globální pravidlo `:where(button, a, [role="button"], input, select, textarea):focus-visible { outline: 2px solid var(--ring) !important; outline-offset: 2px; }` (`!important` je nutné — inline `outline:"none"` by jinak vyhrálo) a `font-family` na `body` (hodnota z `login/page.tsx:138`). Čistě aditivní, nic nerozbije; inline `fontFamily` se pak mažou průběžně.
2. **Nový `src/lib/zLayers.ts` + mechanická náhrada v `src/app/_components/TimelineGrid.tsx`** (31 výskytů `zIndex`, vč. ShiftEdgeHandles 30/31) a delete overlayů v `PlannerPage.tsx:2946, 2991`. Konstanty = přesně dnešní hodnoty, žádná změna chování — jen se škála stane čitelnou a komentovatelnou na jednom místě.
3. **Light-mode hotfixy — mechanická náhrada literálů za tokeny:** `src/app/expedice/_components/ExpediceCard.tsx` (~15 míst `rgba(255,255,255,…)` → `var(--border)`/`var(--text-muted)`), `src/components/OrderSearchSheet.tsx` (`"white"` → `var(--surface)`), `src/components/DtpDataPopover.tsx` (6 hodnot → `var(--surface)`/`var(--surface-2)`/`var(--border)`/`var(--text-muted)`), `src/app/_components/PlannerPage.tsx:2950, 2995` (`#262630` → `var(--popover)`, `#f1f5f9` → `var(--text)`, `#94a3b8` → `var(--text-muted)`). Dark mode zůstane vizuálně prakticky totožný, light mode se opraví.
4. **Nová `src/components/PrimaryCta.tsx`** (background `var(--brand)`, color `var(--brand-contrast)`, disabled přes `color-mix` s `var(--text)` — funkční v obou theme; pressed-state už řeší globální pravidlo `globals.css:32–35`, inline mouse handlery odpadnou). Nasadit na tři místa: `PlannerPage.tsx:4142` („Naplánovat sérii"), `PlannerPage.tsx:4169` („+ Přidat do fronty"), `login/page.tsx:110` (login CTA — tím se opraví i nečitelný light-mode text). `#FFE600` pak zbývá jen jako selection akcent v TimelineGrid (samostatný, pozdější krok).
5. **Textové opravy bez rizika:** diakritika ve všech stringách `src/app/reporty/_components/ReportDashboard.tsx` (KpiCard/SectionHeader labely, `pipelineLabels:181–184`, `DOW_LABELS:109`) a `src/components/BlockDetail.tsx:349` přepnout na `formatPragueDateTime` z `@/lib/dateUtils` (jednořádková oprava timezone). Zároveň import `ThemeToggle` do hlaviček `src/app/expedice/_components/ExpedicePage.tsx` (ř. ~506, plus blok uživatel + Odhlásit po vzoru `RezervacePage.tsx:257–274`) a `ReportDashboard.tsx`.
6. **Kanonizace do dokumentace:** nová sekce „Design tokens a vizuální konvence" v `CLAUDE.md` (a rozšíření memory `project_admin_ui_style.md` z adminu na celou aplikaci): seznam kanonických tokenů, z-škála z `zLayers.ts`, pravidlo „žádný hex/rgba literál mimo `globals.css`", velikostní stupnice písma, kdy použít `ui/` vs. `uiStyles.ts` vs. `PrimaryCta`. Tím se systém stane vynutitelným pro každou další AI session — což je v tomto týmu hlavní mechanismus údržby.

Návazně (mimo prvních 6 kroků): extrakce sdíleného `src/lib/uiStyles.ts` z `AdminDashboard.tsx:105–153` a adopce v Expedici/Rezervacích, sjednocení `ROLE_COLORS`/`pipelineColors`/hex barev strojů do tokenů či sdílených konstant, a postupné odbourání bridge vrstvy `slate-*` (`globals.css:232–259`) po doběhnutí náhrad.

---

## Co audit nepokryl

Audit je **statická analýza kódu** — aplikace nebyla spuštěna, vizuální nálezy vycházejí z kódu (tokeny, literály, class names), ne ze screenshotů. Completeness critic po verifikaci identifikoval 5 děr pokrytí; místo dalšího kola agentů jsou zdokumentované zde jako vstup pro příští iteraci:

**1. Mutační API vrstva bloků nikdy plně přečtena — největší route v repu (blocks/[id], 704 ř.) nikdo neotevřel celý**

Lens lib-dup-dead četl jen blocks/route.ts a pod-routes (reflow/notes); PUT /api/blocks/[id], batch a expedition sdílejí role-filter → validateAndComputeEnd → audit → refetch → SSE broadcast pipeline, která je dle CLAUDE.md implementovaná ve 3+ cestách paralelně — duplicita a divergence těchto kopií (role whitelisty, audit řádky, refetch selecty) není auditovaná. Nálezy z API jsou jen 2 povrchové (AppError mapa, auth boilerplate).

*Soubory k prošetření:* `src/app/api/blocks/[id]/route.ts`, `src/app/api/blocks/batch/route.ts`, `src/app/api/blocks/[id]/expedition/route.ts`, `src/app/api/blocks/[id]/complete/route.ts`, `src/app/api/blocks/route.ts`

**2. SSE infrastruktura kompletně mimo pokrytí: events/route.ts (218 ř.), eventBus.ts, useSSE.ts, useNotifications.ts — 0 přečtených řádků napříč všemi lens**

Ověřeno: adresář src/hooks/ (useSSE 95 ř., useNotifications 68 ř.) nefiguruje v žádném filesRead a events/route.ts drží connection-tracking + per-role event filtering. Přitom existují TŘI nezávislí SSE konzumenti (PlannerPage inline ~215 ř., TiskarMonitor vlastní handleSSEEvent + vlastní polling s console.error, useNotifications) — konzistence/duplicita těchto tří implementací není hodnocena, nález o extrakci hooku z PlannerPage pokrývá jen jednu z nich.

*Soubory k prošetření:* `src/app/api/events/route.ts`, `src/lib/eventBus.ts`, `src/hooks/useSSE.ts`, `src/hooks/useNotifications.ts`, `src/app/tiskar/_components/TiskarMonitor.tsx`

**3. Serverové výpočty reportů (reportMetrics.ts + report/dashboard/route.ts, dohromady ~590 ř.) — lens reporty-tiskar výslovně přiznává, že je nečetl**

Duplicitu metrik server vs. klient (ReportDashboard si reimplementuje kalendářní aritmetiku a MACHINE_LABELS — potvrzené nálezy) nelze bez přečtení serverové strany uzavřít; reportMetrics.ts sdílí fallback-na-span vzory s printTimeClient.ts a hrozí třetí kopie téže logiky (blockDurationHours vs blockPrintMinutes vs legacy pm formule, která už má potvrzené 3 kopie jinde).

*Soubory k prošetření:* `src/lib/reportMetrics.ts`, `src/app/api/report/dashboard/route.ts`, `src/lib/printTimeClient.ts`, `src/app/reporty/_components/ReportDashboard.tsx`

**4. TiskarMonitor.tsx přečten jen z ~13 % (ř. 60–159 ze 742) — modul se 742 řádky má fakticky 1,5 nálezu**

Ověřeno čtením ř. 160–260: soubor obsahuje vlastní geometrii dateToY (duplikát slot-aritmetiky TimelineGrid), vlastní sadu formatterů, vlastní polling + SSE merge logiku a console.error na klientu. Vzhledem k tomu, že jde o celý samostatný modul (a middleware ho dle jiného nálezu činí nedosažitelným = potenciálně 742 ř. mrtvého kódu, což zvyšuje prioritu rozhodnutí smazat vs. opravit), zaslouží plné přečtení.

*Soubory k prošetření:* `src/app/tiskar/_components/TiskarMonitor.tsx`, `src/app/tiskar/page.tsx`, `src/app/_components/TimelineGrid.tsx`

**5. Systematicky minutý typ: konzistence zpětné vazby uživateli — loading/empty/error stavy a tón toast hlášek napříč moduly**

Jednotlivé symptomy jsou potvrzené izolovaně (alert() v ShiftRosterCell, tiché mutace v AdminDashboard, plain-text „Načítám..." v Expedici, mrtvý LoadingSpinner/ErrorMessage), ale nikdo neprošel příčný řez: PlannerPage má 73 toast call-sites bez auditu jednotného tónu/formy hlášek, empty stavy (prázdná fronta, žádné rezervace, žádné notifikace) nebyly hodnoceny vůbec a error stavy fetchů se řeší minimálně čtyřmi vzory (toast, alert, tiché ignorování, inline text).

*Soubory k prošetření:* `src/components/ToastContainer.tsx`, `src/app/_components/PlannerPage.tsx`, `src/app/rezervace/_components/RezervacePage.tsx`, `src/app/expedice/_components/ExpedicePage.tsx`, `src/components/ui/LoadingSpinner.tsx`, `src/app/admin/_components/AdminDashboard.tsx`

Navíc: adresář `src/app/api/events-test/` je prázdná, gitem nesledovaná lokální složka — stačí smazat (nelze doložit nálezem s file:line, proto není ve findings).

### Přiznané mezery jednotlivých lens agentů

**planner-page** (3 souborů, 13 nálezů): Scope byl pokryt celý: PlannerPage.tsx přečten kompletně (řádky 1–4446) a DatePickerField.tsx celý. Nepokryto zůstává: (1) protistrany komponent — TimelineGrid, BlockEdit, BlockDetail, DtpPanel, ToastContainer, useUndoManager, ThemeToggle — ověřoval jsem je jen grepem pro křížové reference, ne čtením, takže duplicity PŘES hranici PlannerPage↔TimelineGrid (např. filterText predikát) nemohu potvrdit; (2) runtime chování a výkon (per-render výpočty searchMatches/outOfRangeBlocks/badgeColorMap bez useMemo jsem vědomě nereportoval — kategorie na perf necílí); (3) duplicitu série-smyčky handleScheduleSeries vs handleQueueDrop jsem vědomě vynechal — CLAUDE.md ji dokumentuje jako záměrné zrcadlení (spec 3.11, etapa 8).

**timeline-grid** (10 souborů, 13 nálezů): Read-only audit bez spuštění aplikace — žádné runtime/vizuální ověření v prohlížeči (skutečné vrstvení z-indexů, chování módů MODE_* při reálném zoomu). PlannerPage.tsx (orchestrátor, ~3525 ř.) jsem nečetl — vzory předávané do TimelineGrid (pasteTarget, callbacky) hodnotím jen z props strany. TiskarMonitor.tsx čten pouze v rozsahu ř. 60–159 (důkaz duplicity BLOCK_STYLES), zbytek souboru nehodnocen. productionTags.ts (PRODUCTION_CHIP_COLORS) a workingTime.ts jsem neotevřel — centralizaci chipů OBÁLKA/VNITŘKY jsem nesrovnával. Drobnější interní duplicity (3× stylované tlačítko Hotovo pro TISKAR na ř. 1418/1547/1723, 3 různé formátovače délky fmtHoursTip/fmtHm/formatPrintHoursShort, opakovaný filtr halfHourMarkers) jsem vědomě vynechal z limitu nálezů — zmínka zde pro úplnost.

**planner-sat** (16 souborů, 15 nálezů): Soubory mimo scope jsem nečetl celé: PlannerPage.tsx jen bodově (výřez 3014–3063 + grep call sites BlockEdit/BlockNotesDialog/OrderSearchSheet), TimelineGrid/DatePickerField/JobPresetEditor/PlanningForm/dateUtils pouze přes grep s obsahem řádků — „also" odkazy do nich vychází z grep výstupu, ne z plného čtení. Neověřoval jsem runtime vzhled (light/dark) v prohlížeči — přísně read-only audit. Business logiku komponent (správnost výpočtů série, save flow, resolver kolizí) jsem neauditoval, jen UI vzory, duplicitu a strukturu dle zadání.

**admin** (13 souborů, 13 nálezů): Nečetl jsem serverové API routes admin endpointů (/api/admin/users, /api/codebook, /api/printers, /api/shift-assignments, /api/machine-week-shifts, /api/job-presets, /api/audit) — audit byl čistě UI vrstva dle scope. Neověřoval jsem runtime vzhled (žádný běžící server/screenshot) — vizuální nálezy vycházejí jen z kódu. Z importovaných závislostí jsem nečetl DatePickerField, ThemeToggle, ToastContainer, useSSE, lib/shifts, lib/shiftRoster ani ui/ primitivy kromě button.tsx (popover, input, switch, textarea jen dle použití). globals.css jsem pouze grepnul na .audit-row/auditShimmer (existují), nečetl celý. InfoPanel/BlockDetail ověřeny jen grepem na použití auditFormatters, ne plným čtením. Accessibility (klávesnice u hover-reveal delete tlačítek, focus trap custom modalů) jsem nehodnotil — mimo zadané kategorie.

**moduly** (27 souborů, 16 nálezů): Nepokryto: (1) runtime/vizuální ověření v prohlížeči — audit byl přísně read-only, light-mode dopady jsou odvozené z kódu (hardcoded rgba + defaultTheme=\"system\"), ne ze screenshotu; (2) PlannerPage.tsx jsem četl jen ve výsecích headeru (ř. ~3020–3300) a handleLogout pro cross-module srovnání, ne celý soubor; (3) API routes rezervací/expedice jen bodově přes grep (množiny statusů) — nehodnotil jsem jejich kód; (4) DatePickerField a ThemeToggle (src/app/_components) používané auditovanými moduly jsem nečetl; (5) moduly Admin, Tiskař, Reporty a middleware — mimo můj přidělený scope; (6) accessibility (aria, focus trap v confirm dialozích) jsem systematicky neauditoval.

**reporty-tiskar** (17 souborů, 10 nálezů): Nečetl jsem serverové výpočty reportů (src/app/api/report/dashboard/route.ts a src/lib/reportMetrics.ts) — auditoval jsem jen klientské konzumenty; duplicitu metrik server vs. klient tedy nemohu vyloučit. K bodu (b) events-test: src/app/api/events-test/ je PRÁZDNÝ adresář bez jediného souboru (lokální artefakt z 18. 4., git ho nesleduje) — žádný testovací endpoint neexistuje, ale bez souboru/řádku ho dle pravidel nelze uvést jako nález; stačí adresář smazat. Obsluhu role TISKAR na \"/\" (TiskarMachineToggle, TISKAR větve uvnitř PlannerPage/TimelineGrid) jsem ověřil jen přes page.tsx a CLAUDE.md, ne čtením celého PlannerPage. Světlý A4 vzhled denního reportu (vlastní TYPE_COLORS, tiskové CSS) hodnotím jako záměrnou odlišnost tiskového výstupu — nereportováno; stejně tak vědomě zdokumentované věci z CLAUDE.md (fixní SHIFTS_105/106 sekce, TISKAR 403 na daily API, neklipující retro/outlook totals). Soubory v \"also\" u formatterů a MACHINE_LABELS mimo můj scope (ReservationList, ReservationDetail, DtpPanel, AuditLogPanel, DatePickerField, AdminDashboard, MachineWorkHoursWeek, ShiftRoster) jsem ověřil jen grep výstupem s čísly řádků, ne plným čtením.

**lib-dup-dead** (34 souborů, 13 nálezů): 1) src/app/api/events-test/ — adresář na disku existuje, ale je PRÁZDNÝ (žádný route.ts; git ls-files i git log pro tuto cestu prázdné → nikdy trackovaný). Jde o lokální prázdnou složku vhodnou ke smazání, ale nelze ji doložit nálezem s file+line+evidence, proto není ve findings. 2) Vnitřní logika PlannerPage.tsx/TimelineGrid.tsx (~3500+ řádků) — čteny jen bodově (importy, konstanty, formattery); systematický audit duplicit uvnitř těchto souborů neproběhl. 3) UI komponenty v src/components/ mimo bodové sondy (BlockDetail, BlockEdit, admin trio) — importy komponent z COMPONENTS seznamu (bonus úkol) jsem neprocházel. 4) npm run lint jsem nespouštěl (pokusný cílený eslint běh nevrátil výstup); unused-vars vodítka tedy nevyužita — dead-code závěry stojí na vlastních grep sweepech přes celé src/. 5) Menší serializační moduly (blockSerialization, reservationSerialization, expediceTypes, companyDaySerialization) ověřeny jen na úrovni modulů (všechny mají importéry), ne per-export. 6) Staré snap funkce workingTime.ts a duration-based findNextFreeSlot: mají živé volající, ale jejich ponechání pro preview a ne-ZAKAZKA bloky je výslovně dokumentované rozhodnutí (CLAUDE.md „Klientské mutační cesty“ + TODO(Plán 4) v scheduleSlotFinder.ts:31) — záměrně nereportováno, stejně jako dokumentované mezistavy (smíšené lasso, série preview).

**vizual-tokens** (30 souborů, 16 nálezů): Řádkový audit TimelineGrid.tsx (129 hex výskytů — hodnoceno jen grep vzorky; barvy typů bloků beru jako doménový jazyk, ne chybu), report/daily ReportView a TiskarMonitor (jen počty hexů), admin subkomponenty (MachineWorkHoursWeek, ShiftRoster, AuditLogPanel, PrinterCodebook), expedice panely (Card/Editor/Detail/Aside/Queue/Builder), systematický audit cursor-pointer na klikatelných divech, měřený kontrast jednotlivých text-slate-400/500 míst (bridge je v light mode remapuje, dark hodnoty vypadají ≥4.5:1, ale neměřil jsem každý výskyt), spacing/max-width kontejnerů mimo hlavičky modulů. Transition hodnoty jsem kvantifikoval (dominuje 120ms, mix zápisů 0.12s/120ms/100ms) — konzistentně rychlé, nereportováno jako samostatný nález.

## Metodika

Read-only multi-agent audit (Claude Code Workflow, 11. 7. 2026, větev `Vojta`, HEAD `cf627217`). Pipeline: **8 lens finderů** (PlannerPage · TimelineGrid · satelitní komponenty · Admin · Rezervace+Expedice+Login · Reporty+Tiskař · lib/duplicita/mrtvý kód · vizuální tokeny) → dedup → **nezávislá adversarial verifikace každého nálezu** proti skutečnému obsahu souboru (u mrtvého kódu povinný grep celého `src/`, oprava čísel řádků, zamítnutí nepodložených) → completeness critic (díry pokrytí) + design-system architekt (návrh sjednocení).

Bilance: 109 surových nálezů → 105 po dedupu → **105 potvrzeno / 0 zamítnuto / 0 neověřeno**. 36 úspěšných agentů (8 finderů, 26 verifikátorů, critic, design architekt), ~3,1 M tokenů, ~34 min čistého běhu. Do repa se nezapisovalo — žádný soubor nebyl změněn.

Vyloučeno záměrně: stavy zdokumentované v CLAUDE.md jako vědomá rozhodnutí („vědomě odloženo", „známé limity", „vědomý v2 backlog"), `*.test.ts`, `prisma/migrations`, emoji chipy bloků (⏸ ✂ ⚠ — zavedený doménový jazyk).

---
*Vygenerováno multi-agent auditem (Claude Code) · 11. 7. 2026 · read-only*