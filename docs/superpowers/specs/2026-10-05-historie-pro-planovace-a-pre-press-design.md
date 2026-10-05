# Etapa 3 — historie pro plánovače a pre-press

**Datum:** 5. 10. 2026
**Vlna:** připomínky plánovače 9/2026, etapa 3 ze tří (volba P1 = A: Monitor + bublina → reporty → historie)
**Předchůdci:** `docs/superpowers/specs/2026-09-14-monitor-stitky-a-bublina-design.md` (etapa 1),
`docs/superpowers/specs/2026-09-16-reporty-pro-planovace-design.md` (etapa 2)

---

## Co se řeší

Tři body ze zářijové vlny, všechny o historii změn:

1. **„historie změn pro pre-press"** (plánovač) — DTP nevidí, kdo a kdy zakázku změnil.
2. **„historie je omezená"** (plánovač) — historie v detailu zakázky končí po dvaceti řádcích
   z každého zdroje; u nejrušnějších zakázek, tedy přesně u těch, které někdo po havárii
   vyšetřuje, to nestačí.
3. **„zprovoznit audit log plánovači"** (Vojtův dodatek) — plný audit log je dnes jen pro ADMINa.

Čtvrtý bod vlny, retence černé skříňky, zůstává beze změny (volba H4 = A, 90 dní).

## Rozhodnutí, ze kterých spec vychází

Volby z rozhodovacího artefaktu ze 14. 9. 2026
(`https://claude.ai/code/artifact/a89302af-6975-40c1-95a3-1ea4ba74c82d`, kolekce `volby`):

| ID | Otázka | Volba |
| --- | --- | --- |
| H1 | Podoba úplné historie plánu | A — odkrýt Audit log ve Správě |
| H2 | Kdo historii uvidí | B — plánovač + pre-press + MTZ |
| H3 | Historie jedné zakázky | C — jen zvednout limit |
| H4 | Jak dlouho držet černou skříňku | A — 90 dní (dnes) |
| Q1 | Kterou historii plánovač myslí jako omezenou | A — historie v detailu zakázky |
| Q2 | Pre-press = role DTP | A — ano |

Volby z 5. 10. 2026 (po průzkumu kódu):

| ID | Otázka | Volba |
| --- | --- | --- |
| E1 | Jak dostane pre-press a MTZ historii změn | A — historie u konkrétní zakázky, plný audit log zůstává ADMIN + PLANOVAT |
| E2 | Co uvidí v panelu u zakázky | A — jen sekci historie změn, nic jiného |

### Proč H1 a H2 nejsou v rozporu

Záznam v paměti projektu tvrdil, že si H1 a H2 odporují: H1 posílá úplnou historii do Správy,
kam DTP ani MTZ nesmí. Při průzkumu se ukázalo, že každá z těch dvou voleb odpovídá **jinému
bodu zadání a jinému adresátovi**:

- H1 je odpověď na Vojtův dodatek — **plánovač** chce plný audit log, a plánovač už ve Správě je.
- H2 pokrývá plánovačův bod „historie změn pro pre-press". Co pre-press reálně potřebuje, je
  historie **jedné zakázky** (což potvrzuje Q1 = A, „omezená historie" = historie v detailu
  zakázky) — ne filtrovatelný log celé firmy.

Rozpor vzniká jen tehdy, když se oba body nacpou do jedné plochy. Volba E1 = A je proto rozdělí:
plný audit log ve Správě pro ADMIN + PLANOVAT, historie u zakázky pro všechny čtyři role.
Cesta `/admin` se tím **nemění** a klientské skrývání záložek nikdy nezačne nést autorizaci.

## Výchozí stav (ověřeno v kódu 5. 10. 2026)

- **Audit log ve Správě existuje** — `src/components/admin/AuditLogPanel.tsx` (1071 řádků):
  filtry na uživatele, akci, rozsah dat, fulltext, stránkování kurzorem, segmentovaný přepínač
  skupin akcí. Plánovači se skrývá klientsky ve `src/app/admin/_components/AdminDashboard.tsx`
  (`visibleTabs` + render guard, oba přes `isPlanovat`).
- **Obě jeho API pouští jen ADMINa** — `src/app/api/audit/route.ts` (seznam) a
  `src/app/api/audit/filters/route.ts` (fasety pro rozbalovátka filtrů).
- **Historie jedné zakázky** je sekce „Historie změn" v `src/components/BlockDetail.tsx`
  (dnes cca ř. 592–700) a vlastní fetch `/api/blocks/[id]/audit` (dnes cca ř. 138–143).
- **DTP ani MTZ k té sekci nemají cestu.** Pravý panel planneru se renderuje jen pro `canEdit`
  (`src/app/_components/PlannerPage.tsx`, dnes ř. 3668) a kliknutí na blok jim blok ani nevybere
  (`onBlockClick`, dnes ř. 3522). Přitom `GET /api/blocks/[id]/audit` roli DTP i MTZ **už dnes
  povoluje** (výčet `["ADMIN", "PLANOVAT", "DTP", "MTZ"]`).
- **`PER_SOURCE_LIMIT = 20`** v `src/app/api/blocks/[id]/audit/route.ts` — limit na KAŽDÝ zdroj
  zvlášť (audit, revize), odpověď tedy unese dvojnásobek.
- **Všechna admin API se hlídají sama** (`/api/users` ADMIN, `/api/login-log` ADMIN,
  `/api/codebook` ADMIN + PLANOVAT, …), takže skrývání záložek ve Správě je dnes kosmetika.
- **Kontextové menu karty bloku už existuje** — `showMenu` v `src/components/planner/BlockCard.tsx`
  (dnes ř. 687) a sada položek pod ním (kopírovat, vyjmout, rozdělit, poznámka MTZ,
  poznámka tiskaře, upozornit, expedice).

## Co se postaví

### (A) Audit log pro plánovače

Plánovač uvidí ve Správě záložku „Audit log" se stejným panelem, jaký má dnes ADMIN. Záložka
„Přihlášení" (login log) mu zůstává skrytá a `/api/login-log` dál pouští jen ADMINa — rozsah
dodatku je audit log, ne přihlašovací záznamy.

Mění se tři místa:

1. `AdminDashboard.tsx` — `audit` vypadne z filtru `isPlanovat` ve `visibleTabs` a render guard
   `activeTab === "audit" && !isPlanovat` ztratí druhou podmínku.
2. `src/app/api/audit/route.ts` — `session.role !== "ADMIN"` → allowlist `["ADMIN", "PLANOVAT"]`.
3. `src/app/api/audit/filters/route.ts` — totéž.

**Bod 3 je ten, který se rozpojí tiše.** Kdyby se otevřel jen seznam a ne fasety, plánovač by
dostal log s prázdnými rozbalovátky uživatelů a akcí a nikde by nevznikla chyba — stejná třída
vady, jakou etapa 2 našla u tří reportových API (`/api/report/attention` a `/api/report/health`
middleware nejmenuje). Proto strážný test níž.

`maxWidth` obsahu ve `AdminDashboard.tsx` už `"audit"` jmenuje (1280 px), nic dalšího se v shellu
neupravuje.

### (B) Historie u zakázky pro DTP a MTZ

**Extrakce.** Sekce „Historie změn" se z `BlockDetail.tsx` vytáhne do nové komponenty
`src/components/BlockHistoryPanel.tsx` (named export, podle konvence „nové standalone komponenty
do `src/components/`"). Komponenta si **sama dělá fetch** podle `blockId` — tím zmizí duplicita,
která by jinak vznikla mezi detailem a dialogem. `BlockDetail` ji vyrenderuje na stejném místě
a se stejným rámem jako dnes; pro plánovače se vizuálně nesmí změnit nic.

**Dialog.** `src/components/BlockHistoryDialog.tsx` obalí ten panel do modálu podle vzoru
`BlockNotesDialog` (overlay přes `Z_OVERLAY`, zavření Escapem i kliknutím mimo, v hlavičce číslo
zakázky a stroj). Modál, ne boční panel: DTP má vlevo `DtpPanel` (výchozí 260 px) a na 1366 px
by další boční panel časovou osu udusil. Dialog navíc funguje identicky pro MTZ, který žádný
vlastní panel nemá.

**Spouštěč.** Nová položka „🕘 Historie změn" v kontextovém menu karty bloku, řízená novým
nepovinným callbackem `onOpenHistory`:

- `showMenu` v `BlockCard.tsx` se rozšíří o `|| !!onOpenHistory`, aby se menu vyrenderovalo i
  rolím, které dnes žádnou jeho položku nemají (DTP).
- `PlannerPage` předá `onOpenHistory` rolím `ADMIN`, `PLANOVAT`, `DTP`, `MTZ`.
- Položka platí pro **všechny typy bloků**, ne jen ZAKAZKA — plánovač vyšetřující odsunutou
  údržbu potřebuje historii stejně.

Kontextové menu je záměrná volba proti novému prvku na kartě: karta má rozpočty v
`src/lib/tiskarBlockView.ts`, které chrání tlačítko „Hotovo", a každý nový prvek v kartě je musí
zároveň opravit. Položka v menu žádný rozpočet neovlivní.

**Filtr poznámek tiskaře.** `GET /api/blocks/[id]/audit` bude rolím `DTP` a `MTZ` odstraňovat
řádky s akcemi `NOTE_CREATE`, `NOTE_UPDATE` a `NOTE_DELETE`. Text poznámky tiskaře je v
`AuditLog.newValue` a panel ho dnes vypisuje; poznámky tiskaře smí podle
`canAccessBlockNotes` (`src/lib/blockNotePermissions.ts`) vidět jen ADMIN, PLANOVAT a TISKAR.
Bez filtru by etapa byla únikem poznámek tiskařů — je to tedy podmínka, ne volba.

Filtr je **čistá funkce v `src/lib/blockHistory.ts`**, ne `if` uvnitř routy:

```ts
/** Akce, jejichž obsah je text poznámky tiskaře (`BlockNote`). */
const TISKAR_NOTE_ACTIONS = new Set(["NOTE_CREATE", "NOTE_UPDATE", "NOTE_DELETE"]);

export function visibleHistoryFor(entries: BlockHistoryEntry[], role: string): BlockHistoryEntry[] {
  if (canAccessBlockNotes(role as NoteRole)) return entries;
  return entries.filter((e) => !(e.source === "audit" && TISKAR_NOTE_ACTIONS.has(e.action)));
}
```

Aplikuje se **jako poslední krok** v routě, těsně před `NextResponse.json`, tedy až za
`sortHistoryEntries`. To je záměr: potlačování pokrytých sloupců (`suppressCoveredColumns`) i
mapa `byGroup` zůstanou pro všechny role shodné, takže DTP a MTZ vidí přesně to, co plánovač,
minus řádky `NOTE_*`. Kdyby se filtrovalo dřív, změnila by se jim i pokrytí revizí a vznikly by
věty, které plánovač nevidí.

Predikát se odvozuje od `canAccessBlockNotes`, ne od vlastního výčtu rolí — jinak by se dvě
definice „kdo smí na poznámky tiskaře" mohly rozejít.

**Poznámka MTZ se nefiltruje.** `Block.materialNote` je sloupec bloku a jeho obsah je na kartě
vidět každému, kdo kartu vidí (`BlockCard.tsx`, dnes ř. 222), tedy i DTP. Filtr by tam nic
nechránil, jen by zakryl, co je o dva centimetry vedle.

### (C) Limit historie jedné zakázky 20 → 100

`PER_SOURCE_LIMIT` v `src/app/api/blocks/[id]/audit/route.ts` se zvedne z 20 na 100. Dál je to
limit na zdroj, takže odpověď unese až 200 položek; panel má `maxHeight: 220` + `overflowY: auto`,
vizuálně se tedy nic nerozjede. Bez stránkování a bez tlačítka „Načíst další" — volba H3 = C je
výslovně „jen zvednout limit".

Součástí je **přepsání JSDoc komentáře nad konstantou**. Dnes argumentuje konkrétními dvaceti
řádky („horní mez je 23 řádků", „víc než 20 auditních řádků mělo 6 bloků", „ani při plných
40 položkách"). Po změně by lhal, a komentář, který přestal být pravdivý, je v tomto projektu
vada (POUCENI P19). Zachová se v něm to, co platí dál: **proč tu nesmí být společný strop na
sloučený seznam** (auditních řádků je řádově víc než revizních, společný ořez by revize
systematicky vytlačil, a u přesunu bloku na jiný stroj je revize jediný existující záznam).

## Mapa autorizace po etapě

| Plocha | Kdo | Kde to drží |
| --- | --- | --- |
| Plný audit log (Správa, záložka) | ADMIN + PLANOVAT | `AdminDashboard.tsx` (viditelnost záložky) |
| `GET /api/audit` | ADMIN + PLANOVAT | allowlist v routě |
| `GET /api/audit/filters` | ADMIN + PLANOVAT | allowlist v routě |
| `GET /api/blocks/[id]/audit` | ADMIN + PLANOVAT + DTP + MTZ | allowlist v routě (beze změny) |
| `NOTE_*` řádky v historii bloku | ADMIN + PLANOVAT (+ TISKAR, ten historii nemá) | `visibleHistoryFor` v routě |
| Položka menu „Historie změn" | ADMIN + PLANOVAT + DTP + MTZ | `onOpenHistory` v `PlannerPage` |
| Přihlášení (login log) | ADMIN | beze změny |
| `/admin` jako celek | ADMIN + PLANOVAT | **beze změny** |

Middleware se v této etapě **nemění**. Cesta `/admin` už dnes stojí na allowlistu
`["ADMIN", "PLANOVAT"]` a nová plocha žádnou novou cestu nezavádí — dialog i panel jsou uvnitř
planneru, který všechny čtyři role vidí.

## Testy

**Strážný test zapojení** — `src/lib/historieAccessWiring.test.ts`, ve stejném duchu jako
`src/lib/reportAccessWiring.test.ts` (čte zdrojové texty přes `stripComments` z
`@/lib/sourceTextTestUtils`):

1. `/api/audit` jmenuje `ADMIN` i `PLANOVAT`.
2. `/api/audit/filters` jmenuje `ADMIN` i `PLANOVAT` — a test tvrdí, že **oba výčty jsou shodné**,
   takže rozpojení jednoho z nich spadne.
3. Záložka `audit` není ve `AdminDashboard.tsx` skrytá pro `isPlanovat` (ani ve `visibleTabs`,
   ani v render guardu).
4. `/api/blocks/[id]/audit` dál jmenuje všechny čtyři role.
5. `visibleHistoryFor` je v block-audit routě skutečně **použitá** na návratové cestě, ne jen
   naimportovaná — stejná přísnost jako u `autoShiftWiring.test.ts`, který hlídá místo použití.
6. `PER_SOURCE_LIMIT` je 100.

**Jednotkové testy `visibleHistoryFor`** — přibydou do existujícího `src/lib/blockHistory.test.ts`:

- DTP nedostane auditní řádky `NOTE_CREATE`/`NOTE_UPDATE`/`NOTE_DELETE`.
- MTZ taktéž.
- ADMIN a PLANOVAT dostanou všechno, tedy vstup beze změny (identita, ne kopie se stejným obsahem).
- Řádky ostatních akcí a všechny revizní položky zůstávají, včetně pořadí.
- Revizní položka s `action === "NOTE_CREATE"` (teoretická, revize akci poznámky nenese) se
  **nefiltruje** — predikát je vázaný na `source === "audit"`, aby filtr nikdy nesnědl revizi,
  která je u některých změn jediným záznamem.

**Co se netestuje jednotkově:** vzhled dialogu a položky v menu. Ověří se proklikem (níž).

## Rizika

1. **Únik poznámek tiskaře.** Hlavní riziko etapy: DTP a MTZ začnou reálně volat endpoint, který
   jim byl dosud povolený jen na papíře. Ošetřeno filtrem `visibleHistoryFor` + strážným testem na
   místo jeho použití.
2. **Rozpojení dvou audit API.** Plánovač by dostal log s prázdnými filtry a bez chybové hlášky.
   Ošetřeno bodem 2 strážného testu (shodnost obou výčtů).
3. **Výkon při stovce `groupId`.** Dotazy `coveringRows` a `groupRows` dostanou `in` se stovkou
   `groupId` místo dvaceti. Jdou přes `BlockRevision_groupId_idx` a `AuditLog`, ale **změří se na
   kopii produkční DB**, ne odhadem — stejně jako se v etapě 2 měřil dvojitý průchod rozpisu.
   Mez přijatelnosti: nejrušnější blok v kopii produkce pod 300 ms na celý endpoint.
4. **Regrese vzhledu detailu u plánovače.** Extrakce sekce z `BlockDetail.tsx` nesmí nic změnit.
   Ošetřeno tím, že se stěhuje JSX i styly beze změny, a proklikem plánovače.
5. **Objem odpovědi.** 200 položek místo 40. Auditní řádek je krátký; revizní položka nese
   seznam vět. Měří se spolu s bodem 3.

## Co v etapě NENÍ

- Retence revizí (H4 = A, 90 dní zůstává; první mazání ~7. 11. 2026).
- Stránkování historie bloku ani „Načíst další" (H3 = C je výslovně jen zvednutí limitu).
- Plný audit log pro DTP a MTZ (E1 = A).
- Pouštění DTP a MTZ do `/admin`.
- Login log pro plánovače.
- Záložka Aktivita pod zvonkem (`/api/audit/today`, dnes ADMIN + PLANOVAT) — beze změny.
- Export historie do CSV.

## Proklik před nasazením

Na dev serveru (port 3001), po implementaci:

1. **Jako PLANOVAT** — Správa → záložka Audit log se zobrazí, seznam se načte, rozbalovátka
   uživatelů a akcí nejsou prázdná, filtr podle data i fulltext zúží seznam, „načíst další"
   stránkuje. Záložky Uživatelé a Přihlášení se nezobrazí.
2. **Jako DTP** — pravý klik na kartu zakázky → „Historie změn" → dialog se otevře, osa má řádky,
   **žádný řádek nenese text poznámky tiskaře**. Escape i klik mimo dialog zavřou. Totéž na
   bloku údržby a rezervace.
3. **Jako MTZ** — totéž; navíc ověřit, že poznámka MTZ v historii vidět JE.
4. **Jako PLANOVAT v planneru** — detail zakázky má sekci Historie změn vizuálně shodnou s dnešní
   a v ní i řádky `NOTE_*`; položka v kontextovém menu otevře tentýž obsah v dialogu.
5. **Zakázka s dlouhou historií** — ověřit, že se zobrazí víc než 40 položek a panel scrolluje.

## Dokumenty, které se musí upravit ve stejné vlně

- **`CLAUDE.md`** — tabulka rolí: sloupec „Admin" u `PLANOVAT` dnes říká
  „omezený admin (číselníky/presety/prac. doba)", po etapě musí jmenovat i audit log. Role `DTP`
  a `MTZ` potřebují zmínku, že historii jedné zakázky vidí (bez poznámek tiskaře), ačkoli do
  Správy nesmí. Přidat odstavec o čtyřech místech, která drží historii na rolích, s odkazem na
  `historieAccessWiring.test.ts` — obdoba odstavce o reportech.
- **`docs/vyvoj-historie.md`** — datovaný záznam etapy.
- **`docs/POUCENI.md`** — jen pokud implementace odkryje novou třídu chyby. Předem se tam nic
  nepřidává.
