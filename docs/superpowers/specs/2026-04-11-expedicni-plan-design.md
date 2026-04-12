# Expediční plán — Design dokument

Datum: 2026-04-11  
Autor: Vojta Tokán (brainstorming s Claude Code, následně revidováno po UX review)  
Status: V revizi — upravený interaction model před implementací

---

## Stav implementace

Poslední aktualizace: 2026-04-12

Aktuální stav:
- finální produktový a UX/UI návrh pro v1 je uzavřený
- implementační checklist je připravený
- lokální mockup byl použit pro ověření layoutu a interaction modelu
- Etapa A je backendově rozpracovaná a zapsaná v kódu

Hotovo:
- potvrzený model `deadlineExpedice` + `expeditionPublishedAt` + `expeditionSortOrder`
- potvrzený pattern `timeline vlevo + pravý aside vpravo`
- potvrzený `queue-first` flow pro ruční položky
- potvrzená sekce kandidátů z tiskového plánu přímo v expedici
- potvrzený obousměrný sync data mezi tiskovým a expedičním plánem
- potvrzený `publish / unpublish` model bez mazání bloku z výroby
- potvrzené persistentní pořadí položek uvnitř dne
- připravený implementační checklist po etapách A-D
- v `prisma/schema.prisma` doplněná pole `expediceNote`, `doprava`, `expeditionPublishedAt`, `expeditionSortOrder`
- přidaný model `ExpeditionManualItem` + enum `ExpeditionManualItemKind`
- připravená migrace `20260412083000_add_expedition_core`
- přidaný helper `src/lib/expedition.ts` pro day key a přidělování `expeditionSortOrder`
- `PUT /api/blocks/[id]` nově drží expediční invarianty:
  - generic update route neumí přímo nastavovat publish stav
  - změna `deadlineExpedice` u publishnutého bloku drží publish a při změně dne přidělí nové pořadí
  - smazání `deadlineExpedice` nebo změna typu mimo `ZAKAZKA` blok automaticky odpublikuje
  - split propagace nově zahrnuje `expediceNote`, `doprava`, `expeditionPublishedAt`, `expeditionSortOrder`
- přidaná route `POST /api/blocks/[id]/expedition` pro explicitní `publish` / `unpublish`
- audit UI v planneru a adminu zná nové field labely a akce `EXPEDITION_PUBLISH` / `EXPEDITION_UNPUBLISH`
- middleware je explicitně zdokumentované tak, že `/expedice` zůstává dostupné všem přihlášeným rolím

Ověření:
- `npx prisma generate` proběhlo úspěšně
- `npx eslint 'src/app/api/blocks/[id]/route.ts' 'src/app/api/blocks/[id]/expedition/route.ts' src/lib/expedition.ts src/middleware.ts src/app/_components/PlannerPage.tsx src/app/admin/_components/AdminDashboard.tsx` proběhl bez errorů
- zůstaly jen staré nesouvisející warningy:
  - 2x `@next/next/no-img-element` v `PlannerPage.tsx`
  - 1x `@next/next/no-html-link-for-pages` v `AdminDashboard.tsx`
- `git diff --check` je čistý

Otevřené body / známé limity:
- migrace je připravená v repu, ale ještě nebyla aplikovaná na databázi
- plný `npx tsc --noEmit` je teď zablokovaný starými generovanými `.next` typy pro chybějící expediční routes z dřívějšího stavu, takže to není spolehlivý gate pro Etapu A
- UI pro publish / unpublish a samotná stránka `/expedice` ještě neexistují, to je práce Etapy B+

Další doporučený krok:
- dokončit Etapu A aplikací migrace v běžícím prostředí a potom pokračovat `Etapou B — Kandidáti + publish v expedici + read-only expedice`

Pravidlo pro navázání v dalším chatu:
- po každé dokončené etapě aktualizovat tuto sekci o stav, ověření, otevřené problémy a další krok

---

## Přehled

Expediční plán je nový modul v aplikaci Integraf Výrobní plán. Řeší problém ručního přepisování zakázek z plánu tisku do separátního Excelu pro potřeby expedičního plánovače. Namísto automatického zobrazování všech zakázek s vyplněným datem expedice se do nového pohledu `/expedice` dostanou jen ty, které někdo s rolí `ADMIN` nebo `PLANOVAT` explicitně publikuje do expedice.

Současně musí expediční plán umět pracovat i s ručními položkami, které v tiskovém plánu vůbec neexistují:
- ruční zakázka, která se netiskne a žije pouze v expedici
- interní závoz mezi firmou / provozy

Klíčová UX změna proti původnímu návrhu:
- expediční stránka nebude stavět na inline editaci přímo na kartě
- bude používat stejný interaction pattern jako hlavní planner: vlevo timeline, vpravo panel typu `detail / edit / builder`
- vizuálně se má co nejvíc přiblížit hlavní timeline a pravému panelu v `PlannerPage`

### Problém dnes

Expediční plánovač přepisuje čísla zakázek a popisy z plánu tisku do jiného Excelu. Jakákoliv změna data expedice v plánu tisku se do Excelu propaguje ručně a dochází k desynchronizaci.

### Řešení

Jeden zdroj pravdy pro datum expedice tiskových zakázek zůstává `deadlineExpedice` na `Block` modelu. Viditelnost bloku v expedičním plánu je ale oddělená a řídí ji explicitní publish stav.

Expediční plán čte přímo z databáze:
- bloky z výrobního plánu, kde `deadlineExpedice IS NOT NULL` a zároveň `expeditionPublishedAt IS NOT NULL`
- ruční expediční položky z oddělené tabulky

Expediční plán umožní:
- zobrazit vše seřazené podle dne expedice
- editovat u tiskových zakázek jen `expediceNote` a `doprava`
- zakládat ruční expediční položky v pravém `Expedice Builderu` nejdřív do fronty
- zobrazit v expedici kandidáty z tiskového plánu, kteří mají datum expedice, ale ještě nejsou publikovaní
- explicitně publikovat tiskovou zakázku do expedice přímo z expedice
- umožnit stejný publish / unpublish i jako rychlou zkratku z hlavní timeline
- explicitně odebrat tiskovou zakázku z expedice bez smazání bloku z tiskového plánu
- měnit den expedice drag & dropem

Queue-first pravidlo:
- ručně založená položka při vytvoření ještě nedostane skutečné datum expedice
- nejdřív vznikne ve frontě
- datum se doplní až při dropu na konkrétní den v timeline

Pravidla synchronizace data:
- v expedičním plánu se datum mění drag & dropem
- změna `deadlineExpedice` v expedičním plánu se zapisuje zpět na `Block` a okamžitě platí i pro tiskový plán
- změna `deadlineExpedice` v hlavním planneru se u publishnuté zakázky automaticky projeví i v expedici
- odebrání zakázky z expedice nemaže `deadlineExpedice`, pouze zruší publish stav

---

## Rozhodnutí v kostce

- Tiskové zakázky: datum je `Block.deadlineExpedice`, viditelnost v expedici řídí `Block.expeditionPublishedAt`
- Ruční položky: samostatný model `ExpeditionManualItem`
- Publish do expedice: explicitní akce `Zaplánovat do Expedice`
- Odebrání z expedice: explicitní akce `Odebrat z Expedice`, bez smazání bloku z výroby
- Pořadí v rámci dne: persistentní a uložené v DB
- Pravý panel: pouze pro role `ADMIN` a `PLANOVAT`
- Read-only role: vidí jen timeline bez pravého panelu
- Builder vytváří ruční položky do fronty, ne rovnou do timeline
- Kandidáti z tiskového plánu: v pravém panelu jako samostatná sekce pro nepublikované bloky s datem expedice
- Klik na kartu: detail vpravo pro editory
- Dvojklik nebo akce `Upravit`: editace vpravo pro editory
- Když není nic vybráno: vpravo se zobrazuje `Expedice Builder + kandidáti + fronta`
- Inline editace na kartě: ne
- Modal jako hlavní editor: ne

---

## Přístupová práva

| Role | Zobrazení timeline | Pravý panel | Editace bloků (`expediceNote`, `doprava`) | Drag & drop | Fronta ručních položek (add/edit/delete) |
|------|--------------------|-------------|-------------------------------------------|-------------|------------------------------------------|
| ADMIN | ✅ | ✅ | ✅ | ✅ | ✅ |
| PLANOVAT | ✅ | ✅ | ✅ | ✅ | ✅ |
| DTP | ✅ | ❌ | ❌ | ❌ | ❌ |
| MTZ | ✅ | ❌ | ❌ | ❌ | ❌ |
| OBCHODNIK | ✅ | ❌ | ❌ | ❌ | ❌ |
| TISKAR | ✅ | ❌ | ❌ | ❌ | ❌ |
| VIEWER | ✅ | ❌ | ❌ | ❌ | ❌ |

Poznámka:
- pro read-only role se pravý panel vůbec nerenderuje
- timeline se v tom případě roztáhne na plnou šířku stejně jako na hlavní stránce

---

## Databázový model

### Změny v `Block` modelu

Přidána čtyři nová volitelná pole:

```prisma
expediceNote          String?    // poznámka specifická pro expedici
doprava               String?    // destinace / dopravní pokyn, volný text
expeditionPublishedAt DateTime?  // null = blok není v expedičním plánu
expeditionSortOrder   Int?       // pořadí v rámci dne pro expediční timeline
```

Invarianty:
- `expeditionPublishedAt != null` vyžaduje `deadlineExpedice != null`
- `expeditionSortOrder != null` dává smysl jen pro publishnutý blok s datem expedice
- publish stav neříká nic o existenci data; datum zůstává samostatně v `deadlineExpedice`

Migrace: `npx prisma migrate dev --name add_expedice_fields_and_publication`

### Nový model `ExpeditionManualItem`

Ruční položky pro expedici, které nemají vazbu na výrobní blok:

```prisma
enum ExpeditionManualItemKind {
  MANUAL_JOB
  INTERNAL_TRANSFER
}

model ExpeditionManualItem {
  id           Int                       @id @default(autoincrement())
  date         DateTime?                 // null = položka je ve frontě, jinak civilní den uložený jako UTC midnight
  expeditionSortOrder Int?               // pořadí v rámci dne; null pokud je položka ve frontě
  kind         ExpeditionManualItemKind
  orderNumber  String?                   // může být prázdné u interního závozu
  description  String?                   // název / popis položky
  expediceNote String?
  doprava      String?
  createdAt    DateTime                  @default(now())
  updatedAt    DateTime                  @default(now()) @updatedAt

  @@index([date, expeditionSortOrder])
  @@index([kind, date])
  @@index([createdAt])
}
```

Sem patří dva scénáře:
- `MANUAL_JOB` = ruční zakázka, která se v tiskovém plánu vůbec nevyskytuje
- `INTERNAL_TRANSFER` = interní závoz / přesun mezi firmou nebo provozy

API validace:
- alespoň jedno z `orderNumber` nebo `description` musí být vyplněné

Migrace:
- ideálně ve stejné migraci jako přidání polí na `Block`

---

## Architektura

### Přístup: bloky z výroby + ruční expediční položky

- expediční pohled čte `Block` záznamy, kde `deadlineExpedice IS NOT NULL` a `expeditionPublishedAt IS NOT NULL`
- `orderNumber` a `description` se u těchto záznamů berou přímo z `Block`
- `expediceNote` a `doprava` jsou nová pole přímo na `Block`
- `expeditionPublishedAt` říká, jestli je blok opravdu zařazený do expedice
- `expeditionSortOrder` drží jeho pořadí v rámci dne
- ruční položky žijí v tabulce `ExpeditionManualItem`
- klient sloučí do timeline jen:
  - bloky s `deadlineExpedice IS NOT NULL` a `expeditionPublishedAt IS NOT NULL`
  - ruční položky s `date IS NOT NULL`
- ruční položky s `date IS NULL` tvoří frontu v pravém panelu

### Napojení na hlavní planner

Tisková zakázka se do expedice nedostane automaticky jen proto, že má vyplněné datum expedice.

Pravidla:
- blok s `deadlineExpedice != null` a `expeditionPublishedAt = null` je v tiskovém plánu, ale není v expedici
- publish se provádí explicitní akcí `Zaplánovat do Expedice`
- unpublish se provádí explicitní akcí `Odebrat z Expedice`
- expedice zobrazuje tyto nepublikované bloky jako `Kandidáty z tiskového plánu`
- primární publish flow je přímo v expedici nad kandidátem
- context menu bloku v hlavní timeline je volitelná rychlá zkratka, ne jediný vstup
- stejná akce musí existovat i jako fallback v detailu bloku, aby nebyla závislá jen na pravém kliku

Stavy akce v hlavní timeline:
- bez `deadlineExpedice`: disabled `Nejdřív vyplň termín expedice`
- s `deadlineExpedice`, ale bez publish: `Zaplánovat do Expedice`
- publishnutý blok: `Odebrat z Expedice`

Stavy kandidáta v expedici:
- bez `deadlineExpedice`: kandidát se v expedici vůbec nezobrazuje
- s `deadlineExpedice`, ale bez publish: kandidát je v pravém panelu v sekci `Kandidáti z tiskového plánu`
- publishnutý blok: kandidát zmizí ze sekce kandidátů a objeví se v timeline

### Kandidáti z tiskového plánu

Expedice musí umět sama nabídnout nepublikované tiskové zakázky, které jsou připravené k zařazení.

Definice kandidáta:
- `Block.type = ZAKAZKA`
- `deadlineExpedice IS NOT NULL`
- `expeditionPublishedAt IS NULL`

Kandidát se zobrazuje pouze editorům (`ADMIN`, `PLANOVAT`) v pravém panelu.

Obsah kandidátní karty:
- číslo zakázky
- popis
- datum expedice
- `expediceNote`
- `doprava`
- `stroj` jako sekundární orientační údaj
- primární akce `Zaplánovat do Expedice`

Chování:
- publish z kandidáta nevyžaduje potvrzovací dialog
- po publishi kandidát zmizí ze sekce kandidátů a objeví se v timeline na svém dni
- publish nastaví `expeditionPublishedAt` a `expeditionSortOrder` na konec příslušného dne
- změna `deadlineExpedice` v hlavním planneru u nepublikovaného kandidáta se musí propsat i do této sekce
- pokud se kandidátu v hlavním planneru datum smaže, kandidát z této sekce zmizí

### Co se v expedici smí vytvářet

Pravý builder v expedici vytváří pouze ruční expediční položky do fronty:
- ruční zakázku
- interní závoz

Nevytváří nový `Block` v tiskovém plánu.

### Co se v expedici smí editovat

**Blok z tiskového plánu**
- `expediceNote`
- `doprava`
- publish / unpublish stav se needituje formulářově, ale přes explicitní akci
- datum expedice je v expedičním plánu měněné drag & dropem; v hlavním planneru může být změněno stávajícím způsobem

**Ruční položka**
- `kind`
- `orderNumber`
- `description`
- `expediceNote`
- `doprava`

### Split skupiny

Pokud je blok součástí split skupiny, mají se expediční pole chovat jako sdílená order-level data:
- `deadlineExpedice`
- `expediceNote`
- `doprava`
- `expeditionPublishedAt`
- `expeditionSortOrder`

Praktický dopad:
- změna těchto polí na jednom splitu se propaguje na celou split skupinu
- v expedici se tím zabrání nekonzistentnímu stavu jedné zakázky rozdělené do více bloků
- pořadí split skupiny se ukládá sdíleně; sourozenci zůstávají v timeline vedle sebe

### Co se mění drag & dropem

- přetažení publishnutého bloku na jiný den aktualizuje `Block.deadlineExpedice`
- přetažení publishnutého bloku v rámci dne mění `Block.expeditionSortOrder`
- přetažení ruční položky z fronty na den nastaví `ExpeditionManualItem.date` a `ExpeditionManualItem.expeditionSortOrder`
- přetažení naplánované ruční položky na jiný den aktualizuje `ExpeditionManualItem.date` a `ExpeditionManualItem.expeditionSortOrder`
- přeuspořádání ruční položky v rámci dne aktualizuje `ExpeditionManualItem.expeditionSortOrder`
- vrácení ruční položky z timeline zpět do fronty nastaví `ExpeditionManualItem.date = null` a `ExpeditionManualItem.expeditionSortOrder = null`
- odebrání bloku z expedice nemaže datum; nastaví `expeditionPublishedAt = null` a `expeditionSortOrder = null`

---

## UI — Rozvržení

### Navigace

Nové tlačítko v headeru `PlannerPage.tsx`, viditelné pro všechny role:

```text
[Správa]  [Rezervace]  [Expedice ●]
```

Barva a aktivní stav mají navazovat na existující header pattern, ne zavádět nový vizuální jazyk.

### Layout stránky

Stránka `/expedice` použije stejný základní shell jako hlavní planner:

- vlevo expediční timeline
- vpravo resizable aside pouze pro `ADMIN` a `PLANOVAT`

Stavy pravého panelu:
- `builder + queue` — default, když není nic vybrané
- `detail` — po kliknutí na kartu
- `edit` — po dvojkliku nebo kliknutí na `Upravit`

Read-only role:
- nevidí pravý panel
- timeline zabírá celou šířku
- karta nemá otevírat detail vpravo

### Reuse komponent a tokenů

Expedice nesmí zavést vlastní mini design systém. Má reuseovat existující primitiva a vizuální tokeny z hlavní aplikace.

Povinný reuse:
- `Button` pro primární, sekundární i destruktivní akce
- `Input` pro krátká textová pole
- `Textarea` pro delší texty a poznámky
- `Label` pro formulářové popisky
- `DatePickerField` pro všechna datumová pole
- `Badge` pro typové a zdrojové štítky
- `Separator` pro dělící linie v detailu a editoru
- `HoverCard` pro read-only doplňkový preview obsah u zkrácených karet
- `ResizeHandle` pattern z hlavního planneru, pokud bude aside resizable

Styling guardrails:
- používat stávající tokeny z `src/app/globals.css`
- používat stejné surface vrstvy `--surface`, `--surface-2`, `--surface-3`
- používat stejné border, radius a shadow rytmy jako v `PlannerPage`
- nepřidávat nové hardcoded hex barvy pro běžné UI chrome
- nové inline styly připouštět jen tam, kde už aplikace stejný pattern používá i dnes

Form control pravidla:
- pro 2-3 pevné volby preferovat segmented buttons / pill buttons podobně jako v builderu hlavního planneru
- pro typ ruční položky (`Ruční zakázka` / `Interní závoz`) nepoužívat dropdown
- dropdown/select použít jen tam, kde je skutečně více možností a existuje k tomu důvod

### Orientace a toolbar nad timeline

Expediční timeline má mít vlastní zjednodušený toolbar inspirovaný hlavní timeline, ale bez prvků, které dávají smysl jen v hodinovém planneru.

**Ano:**
- `Dnes` tlačítko
- date picker `Přejít na datum…`
- filtry typu:
  - `Vše`
  - `Tiskový plán`
  - `Ruční`
  - `Interní`
- přepínání rozsahu dopředu pomocí explicitních voleb:
  - `7 dní`
  - `14 dní`
  - `30 dní`
- ovládání hustoty zobrazení, aby bylo možné vidět více nebo méně dní v jednom viewportu

**Ne:**
- červená čára aktuálního času
- plynulý hodinový zoom slider převzatý 1:1 z hlavní timeline
- nepojmenovaná tlačítka `+ / -`, pokud není zcela jasné, zda znamenají zoom nebo rozsah

Odůvodnění:
- expediční pohled je organizovaný po dnech, ne po hodinách
- červená čára by vytvářela falešný pocit přesnosti
- toolbar má pomáhat s orientací v kalendářním horizontu, ne simulovat hlavní výrobní grid jedna ku jedné

Doporučení k hustotě:
- pokud použijeme slider, musí být diskrétní, ne plynulý
- ideálně 3 kroky:
  - `Detail`
  - `Standard`
  - `Kompaktní`
- uživatelský význam má být čitelný jako `Více detailu <-> Více dní`

Rozdíl oproti rozsahu:
- `7 / 14 / 30 dní` říká, jak velké období je v timeline načtené / aktivní
- `Detail / Standard / Kompaktní` říká, kolik dní je vidět najednou na obrazovce

Výchozí nastavení pro v1:
- `daysBack = 3`
- `daysAhead = 14`
- hustota = `Standard`

Persistované preference:
- hustota zobrazení do `localStorage`
- šířka aside do `localStorage`
- rozsah dnů není nutné perzistovat mezi návštěvami, pokud se neukáže reálná potřeba

### Timeline layout

Vertikální osa = dny. Neřeší hodiny ani stroje, ale zachovává vizuální disciplínu hlavního planneru:
- jasný denní rytmus
- kompaktní karty
- hover / selected / drag stavy podobné hlavní timeline
- minimální chrome, žádné modaly jako primární flow
- první otevření automaticky scrolluje na dnešní den
- dnešní den je zvýrazněný jako celý pás, ne červenou časovou linkou
- datumový sloupec používá sticky denní label podobně jako hlavní timeline
- výška dne a karet reaguje na zvolenou hustotu zobrazení
- timeline obsahuje pouze reálně naplánované položky:
  - publishnuté bloky z tiskového plánu
  - ruční položky s vyplněným dnem

Mechanika dne:
- každý den je samostatný vertikální blok s vlastním headerem a seznamem položek
- den nemá fixní výšku; výška je odvozena od počtu položek
- uvnitř dne nesmí vznikat vnořený scroll
- hustota mění hlavně:
  - vertikální padding karty
  - gap mezi kartami
  - velikost typografie sekundárních údajů
  - min-height karty
- hustota nemění informační architekturu karty

Praktický důsledek:
- `Kompaktní` režim ukáže více dní hlavně v běžných a středně zaplněných dnech
- u extrémně plných dní se osa přirozeně prodlouží; nesmí se to řešit useknutím obsahu

```text
┌─────────────────────────────────────────────────────────────────┐
│ PO 14                                                         │
│  ├─ [blok] 17521  Colognia – Leaflet – 4 000 ks      [mailing]│
│  │         4 000 ks dle rozděl.                              │
│  ├─ [blok] 17470  Rokrodruck – Mapa – 1 000 ks         [—]    │
│  ├─ [ruční] 17513  ASTRATEX – vložka SKY               [SHV]   │
│  └─ [interní] Přesun palet na firmu B                  [Brno]  │
├─────────────────────────────────────────────────────────────────┤
│ ÚT 15                                                         │
│  └─ ...                                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Karty v timeline

Karty mají být vizuálně co nejblíž kartám z hlavní timeline, jen zjednodušené na denní režim.

**Blok z tiskového plánu**
- jemný modrý akcent
- badge `TISK`
- číslo zakázky
- popis
- `expediceNote`
- `doprava`
- malý indikátor, že zdroj je tiskový plán
- publish stav se na kartě neřeší zvláštní ikonou; v expediční stránce jsou už jen publishnuté bloky

**Ruční zakázka**
- odlišený badge `RUČNÍ`
- téměř stejný layout jako blok, aby timeline působila jednotně

**Interní závoz**
- odlišený badge `INTERNÍ`
- stejné rozvržení, jen jiný badge a jemně odlišný akcent

Důležité:
- žádná inline pole na kartě
- karta zůstává skenovatelná i při větším počtu položek za den
- rozdíl mezi typy se primárně komunikuje badge a zdrojem, ne úplně jinou kartou
- dlouhé texty se line-clampují / truncují
- karta musí mít `min-w-0`, aby truncation fungovalo korektně
- ruční položka se v timeline objeví až po naplánování dropem na den

Read-only fallback pro zkrácený obsah:
- pro role bez pravého panelu musí být dostupný full text přes `HoverCard` nebo ekvivalentní nenásilný preview pattern
- minimální fallback je nativní `title`, preferovaný je `HoverCard`

### Pravý panel

Pravý panel má být vizuálně i interakčně co nejblíž současnému pravému aside v hlavním planneru.

#### 1. `Expedice Builder`

Výchozí stav pro `ADMIN` a `PLANOVAT`, když není nic vybrané.

Použití:
- vytvoření ruční zakázky do fronty
- vytvoření interního závozu do fronty

Pole:
- typ položky: `Ruční zakázka` / `Interní závoz`
- číslo zakázky
- popis
- `expediceNote`
- `doprava`

Builder nikdy nevytváří `Block` do tiskového plánu a ani rovnou neplánuje položku na konkrétní den.

Layout builderu:
- stejné header řešení jako hlavní aside
- obsah rozdělený do sekcí s uppercase micro-labely
- sticky footer s primární akcí
- primární CTA přes `Button`
- sekundární akce přes `Button variant="outline"` nebo `ghost` podle importance

Primární CTA:
- `Přidat do fronty`

Pod builderem je ve výchozím stavu viditelná sekce `Kandidáti z tiskového plánu` a pod ní `Fronta k naplánování`.

#### 1b. `Kandidáti z tiskového plánu`

Sekce kandidátů je součást výchozího pravého panelu mezi builderem a frontou.

Obsah:
- nepublikované tiskové bloky s `deadlineExpedice != null`
- kompaktní karty vizuálně příbuzné blokům v timeline
- základní data: číslo zakázky, popis, datum expedice, `expediceNote`, `doprava`, `stroj`

Chování:
- primární akce na kartě: `Zaplánovat do Expedice`
- publish nevyžaduje potvrzení
- po publishi karta zmizí ze sekce kandidátů a blok se objeví v timeline
- v1 se kandidáti řadí podle `deadlineExpedice ASC`, poté `updatedAt DESC`
- pokud je sekce prázdná, zobrazí se lehký empty state bez dominantního CTA

#### 1c. `Fronta k naplánování`

Fronta je součást výchozího pravého panelu pod builderem.

Obsah:
- ruční položky s `date = null`
- kompaktní queue karty vizuálně příbuzné hlavní queue v planneru
- základní data: typ, číslo zakázky, popis, `expediceNote`, `doprava`

Chování:
- položku lze přetáhnout z fronty na konkrétní den v timeline
- drop na den jí doplní datum a přesune ji z fronty do timeline
- v1 je pořadí fronty podle `createdAt DESC`
- manuální reorder uvnitř fronty není součást v1

#### 2. Detail položky

Po kliknutí na kartu se vpravo otevře detail.

**Detail bloku**
- zdroj: tiskový plán
- stav: `V expedici`
- číslo zakázky
- popis
- datum expedice
- `expediceNote`
- `doprava`
- `stroj` jako sekundární orientační údaj
- nezobrazovat plnou výrobní administrativu typu DATA / materiál / barvy; expediční detail má zůstat lehký
- sekundární akce: `Odebrat z Expedice`

**Detail ruční položky**
- typ položky
- stav:
  - `Ve frontě`, pokud `date = null`
  - konkrétní datum, pokud `date != null`
- číslo zakázky
- popis
- `expediceNote`
- `doprava`

Detail je read-only. Z něj se přechází na `Upravit`.

#### 3. Editace položky

Editace probíhá ve stejném pravém panelu, ne v modalu a ne na kartě.

**Editace bloku**
- editovatelná pole: `expediceNote`, `doprava`
- datum expedice je zobrazené jen informativně
- helper text: změna data expedice pouze přetažením v timeline
- destruktivní akce není `Smazat blok`, ale `Odebrat z Expedice`

**Editace ruční položky**
- editovatelná pole: `kind`, `orderNumber`, `description`, `expediceNote`, `doprava`
- `date` není ručně editovatelné
- možnost smazání
- pokud je položka naplánovaná, editor nabízí akci `Vrátit do fronty`

Action footer v editoru:
- sticky footer dole
- primární akce `Uložit`
- sekundární akce `Zrušit`
- destruktivní akce `Smazat` oddělená vizuálně od primární akce
- mazání musí mít potvrzení nebo undo window; ne okamžité tiché smazání

### Potvrzení destruktivních akcí

Expedice má reuseovat stejný confirm pattern jako hlavní planner.

**Blok z tiskového plánu**
- akce se jmenuje `Odebrat z Expedice`
- potvrzovací dialog používá stejný vizuální a klávesový pattern jako smazání bloku v hlavním planneru
- primární destruktivní tlačítko má autofocus
- `Enter` potvrdí
- `Esc` zruší
- efekt = pouze unpublish, ne delete bloku

**Ruční položka**
- akce `Smazat položku`
- stejný confirm pattern
- efekt = skutečný delete, protože položka existuje jen v expedici

### Doporučené micro-interakce

- hover na kartě zvýrazní celý řádek karty jemně stejně jako v hlavní timeline
- selected karta má jasný selected ring / surface stav
- dnešní den má v date headeru pill `Dnes`
- po kliknutí na `Dnes` se timeline odscrolluje tak, aby byl dnešní den vidět s malým horním offsetem
- filtry a date jump mají fungovat i pro read-only role
- zvolená hustota zobrazení se ukládá do `localStorage` stejně jako jiné osobní UI preference
- při drag & drop se aktivní den zvýrazní bez jitteru a bez poskakování layoutu
- přepnutí hustoty nesmí resetovat scroll pozici víc, než je nutné
- reorder v rámci dne se ukládá persistentně a po reloadu zůstává zachovaný

### Stavy obrazovky

Musí být navržené i netriviální stavy, ne jen happy path.

**Loading**
- timeline loading skeleton po dnech
- aside loading skeleton při načítání detailu / editace, pokud bude detail lazy-loaded

**Empty**
- pokud v daném období nejsou žádné položky, zobrazit prázdný stav
- pro editory obsahuje CTA `Přidat ruční položku do fronty`
- pro read-only role jen informativní text

**Error**
- selhání `GET /api/expedice` musí mít retry akci
- selhání save/update/delete musí mít toast + zachování kontextu formuláře

### Neuložené změny

Při existenci dirty stavu nesmí dojít k tichému zahození editace.

Spouštěče guardu:
- klik na jinou kartu během editace
- klik do prázdna timeline během editace
- přepnutí z `edit` do `builder`
- odchod z route

Chování:
- zobrazit potvrzení `Zahodit změny?`
- doporučený primární výběr: `Pokračovat v editaci`
- sekundární: `Zahodit změny`

### Drag & drop

- přetažení položky na jiný den provede optimistický update + API call
- cílový den se zvýrazní stejně jako drop zóny v hlavním planneru
- drag & drop je povolen pouze pro `ADMIN` a `PLANOVAT`
- u bloku mění `deadlineExpedice`
- u publishnutého bloku při přesunu na jiný den:
  - mění `deadlineExpedice`
  - automaticky nastaví nový `expeditionSortOrder` na konec cílového dne
- u publishnutého bloku při reorderu v rámci dne:
  - mění jen `expeditionSortOrder`
- u ruční položky:
  - drop z fronty na den nastaví `date`
  - drop z fronty na den nastaví i `expeditionSortOrder`
  - drop mezi dny mění `date`
  - drop mezi dny mění i `expeditionSortOrder`
  - reorder v rámci dne mění `expeditionSortOrder`
  - návrat do fronty nastaví `date = null`

Synchronizační pravidla:
- změna data publishnutého bloku v expedici se okamžitě propisuje zpět do tiskového plánu, protože zapisuje stejný `deadlineExpedice`
- změna data publishnutého bloku v hlavním planneru se automaticky projeví v expedici při dalším fetchi / refreshi
- pokud je publishnutému bloku v hlavním planneru datum expedice smazáno, server blok automaticky odebere z expedice

### Interakční pravidla

- single click na kartu: `detail`
- double click nebo tlačítko `Upravit`: `edit`
- klik do prázdna timeline: zavře `detail`/`edit` a vrátí pravý panel do `builder + queue`
- read-only role žádný aside nemají, takže klik na kartu neotevírá detail
- klik na queue kartu: `detail`
- double click na queue kartu: `edit`

### Responsivita

V1 má být desktop-first, ale nesmí se rozbít na menších šířkách.

- široký desktop: timeline + resizable aside
- menší desktop / tablet: aside může mít pevnější minimální a maximální šířku, toolbar může wrapovat do více řádků
- úzká šířka nesmí vytvořit horizontální scrollbar celé stránky
- pokud by se aside už nevešel bez poškození timeline, priorita je zachovat použitelnost timeline; aside může přejít do overlay režimu v navazující implementaci

Minimal acceptance:
- stránka je čitelná a ovladatelná bez horizontálního scrollu
- toolbar se umí zalomit
- karty se nerozpadají při delších textech

---

## Soubory a routes

### Nové soubory

```text
src/app/expedice/
  page.tsx                               -- Server Component, auth check, layout shell
  _components/
    ExpedicePage.tsx                     -- hlavní Client Component, stav selected/editing/builder+candidates+queue
    ExpediceTimeline.tsx                 -- timeline po dnech
    ExpediceCard.tsx                     -- kompaktní karta položky
    ExpediceAside.tsx                    -- přepínač builder/detail/edit panelů
    ExpediceDetailPanel.tsx              -- read-only detail položky
    ExpediceEditorPanel.tsx              -- editace položky v aside
    ExpediceBuilderPanel.tsx             -- výchozí pravý panel pro tvorbu ruční položky do fronty
    ExpediceQueuePanel.tsx               -- fronta k naplánování
    ExpediceQueueCard.tsx                -- karta ruční položky ve frontě
    ExpeditionManualItemForm.tsx         -- sdílený formulář pro builder a edit ruční položky

src/app/api/expedice/
  route.ts                               -- GET: bloky + kandidáti + naplánované ruční položky + fronta
  manual-items/
    route.ts                             -- POST: nová ruční položka do fronty
    [id]/route.ts                        -- PUT: update ruční položky, změna date/null, DELETE: smazání

src/app/api/blocks/[id]/expedition/
  route.ts                               -- POST: publish / unpublish bloku do expedice
```

### Změny v existujících souborech

| Soubor | Změna |
|--------|-------|
| `prisma/schema.prisma` | +4 pole na `Block`, nový model `ExpeditionManualItem`, nový enum `ExpeditionManualItemKind` |
| `src/app/_components/PlannerPage.tsx` | +tlačítko `Expedice` v headeru |
| `src/app/_components/TimelineGrid.tsx` | přidat context menu akce `Zaplánovat do Expedice` / `Odebrat z Expedice` jako rychlou zkratku |
| `src/app/_components/PlannerPage.tsx` | fallback akce v detailu bloku + reuse confirm pattern |
| `src/app/api/blocks/[id]/route.ts` | povolit `expediceNote` a `doprava` pro `ADMIN/PLANOVAT`; u změn `deadlineExpedice` udržet publish/sort invarianty |
| `src/app/api/blocks/[id]/expedition/route.ts` | publish / unpublish endpoint pro tiskové bloky |
| `src/middleware.ts` | přidat `/expedice` do povolených routes pro všechny role |

---

## API

### GET `/api/expedice`

Vrátí:
- sloučené a seřazené záznamy po dnech pro timeline
- samostatný seznam kandidátů z tiskového plánu
- samostatnou frontu ručních položek bez data
- pouze publishnuté bloky z tiskového plánu
- položky v rámci dne seřazené podle `expeditionSortOrder ASC`

**Response:**
```json
{
  "days": [
    {
      "date": "2026-04-14",
      "items": [
        {
          "sourceType": "block",
          "itemKind": "PLANNED_JOB",
          "id": 123,
          "orderNumber": "17521",
          "description": "Colognia – Leaflet – 4 000 ks",
          "expediceNote": "4 000 ks DLE ROZDĚLOVNÍKU",
          "doprava": "na mailing",
          "deadlineExpedice": "2026-04-14",
          "expeditionSortOrder": 1200,
          "machine": "XL_105"
        },
        {
          "sourceType": "manual",
          "itemKind": "MANUAL_JOB",
          "id": 5,
          "orderNumber": "17513",
          "description": "ASTRATEX – vložka SKY",
          "expediceNote": "15 000 ks",
          "doprava": "na SHV",
          "date": "2026-04-14",
          "expeditionSortOrder": 2200
        },
        {
          "sourceType": "manual",
          "itemKind": "INTERNAL_TRANSFER",
          "id": 6,
          "orderNumber": null,
          "description": "Přesun palet na provoz Brno",
          "expediceNote": null,
          "doprava": "Brno",
          "date": "2026-04-14",
          "expeditionSortOrder": 2300
        }
      ]
    }
  ],
  "candidates": [
    {
      "sourceType": "block",
      "itemKind": "PLANNED_JOB",
      "id": 88,
      "orderNumber": "17842",
      "description": "Linet – leták – 12 000 ks",
      "expediceNote": "čeká na zařazení",
      "doprava": "na firmu",
      "deadlineExpedice": "2026-04-15",
      "machine": "SM_102"
    }
  ],
  "queueItems": [
    {
      "sourceType": "manual",
      "itemKind": "MANUAL_JOB",
      "id": 9,
      "orderNumber": "19125",
      "description": "Ruční kompletace mimo tiskový plán",
      "expediceNote": "čeká na zařazení",
      "doprava": "na firmu",
      "date": null,
      "expeditionSortOrder": null
    }
  ]
}
```

### PUT `/api/blocks/[id]`

Existující route. Pro expediční modul se používá pro:
- update `expediceNote`
- update `doprava`
- update `deadlineExpedice` při drag & dropu
- update `deadlineExpedice` z hlavního planneru i z expedice nad stejným zdrojem pravdy

UX pravidlo:
- v expedičním editoru se ručně edituje jen `expediceNote` a `doprava`
- v expedičním modulu se `deadlineExpedice` mění přes drag & drop; hlavní planner si zachovává stávající editaci data

Server invarianty:
- pokud se změní `deadlineExpedice` u publishnutého bloku, publish stav zůstává zachovaný
- pokud se publishnutý blok přesune na jiný den, server mu přidělí nový `expeditionSortOrder` na konec cílového dne
- pokud se `deadlineExpedice` smaže, server automaticky vynuluje `expeditionPublishedAt` a `expeditionSortOrder`
- split skupiny sdílejí `deadlineExpedice`, `expediceNote`, `doprava`, `expeditionPublishedAt`, `expeditionSortOrder`

### POST `/api/blocks/[id]/expedition`

Samostatná route pro explicitní publish / unpublish tiskového bloku do expedice.

Body:

```json
{
  "action": "publish"
}
```

nebo

```json
{
  "action": "unpublish"
}
```

Pravidla:
- auth: `ADMIN` / `PLANOVAT` only
- funguje jen pro `Block.type = ZAKAZKA`
- `publish` vyžaduje `deadlineExpedice != null`
- `publish` nastaví `expeditionPublishedAt` a `expeditionSortOrder` na konec dne
- `unpublish` vynuluje `expeditionPublishedAt` a `expeditionSortOrder`
- `unpublish` nemaže `deadlineExpedice`
- u split skupiny se publish/unpublish propaguje na všechny sourozence
- audit se zapisuje jako explicitní akce `EXPEDITION_PUBLISH` / `EXPEDITION_UNPUBLISH`

### POST `/api/expedice/manual-items`

Body:

```json
{
  "kind": "MANUAL_JOB",
  "orderNumber": "17513",
  "description": "ASTRATEX – vložka SKY",
  "expediceNote": "15 000 ks",
  "doprava": "na SHV"
}
```

Efekt:
- vytvoří ruční položku s `date = null`
- položka se objeví ve frontě, ne v timeline

Auth: `ADMIN` / `PLANOVAT` only.

### PUT `/api/expedice/manual-items/[id]`

Body: stejná pole jako POST + volitelně `date` a `expeditionSortOrder`.  
Používá se pro:
- editaci obsahu položky
- drag & drop z fronty na den (`date = YYYY-MM-DD`)
- přesun mezi dny
- reorder v rámci dne (`expeditionSortOrder`)
- vrácení do fronty (`date = null`)

Auth: `ADMIN` / `PLANOVAT` only.

### DELETE `/api/expedice/manual-items/[id]`

Auth: `ADMIN` / `PLANOVAT` only.

---

## Rozdělení do etap

### Etapa A — Datový základ + explicit publish stav

**Rozsah:**
- DB migrace:
  - `Block`: `expediceNote`, `doprava`, `expeditionPublishedAt`, `expeditionSortOrder`
  - `ExpeditionManualItem`
- `src/app/api/blocks/[id]/expedition/route.ts`
- invarianty v `PUT /api/blocks/[id]`
- middleware: `/expedice` povoleno pro všechny role

**Výsledek:**
- backend umí rozlišit datum expedice a skutečné zařazení do expedice
- publishnutý blok lze bezpečně přesouvat i odpublikovat bez mazání bloku

### Etapa B — Kandidáti + publish v expedici + read-only expedice

**Rozsah:**
- `src/app/expedice/page.tsx`
- `GET /api/expedice`
- `ExpedicePage.tsx` + `ExpediceTimeline.tsx` + `ExpediceCard.tsx`
- tlačítko `Expedice` v headeru `PlannerPage`
- sekce kandidátů z tiskového plánu v pravém panelu expedice
- publish kandidáta přímo z expedice
- context menu akce `Zaplánovat do Expedice` / `Odebrat z Expedice` v hlavní timeline jako shortcut
- fallback stejných akcí v detailu bloku

**Výsledek:**
- expedice umí sama publikovat kandidáty z tiskového plánu bez nutnosti vracet se do hlavní timeline
- read-only expedice ukazuje jen skutečně publishnuté bloky

### Etapa C — Pravý panel pro editory + ruční builder

**Rozsah:**
- pravý aside pouze pro `ADMIN` / `PLANOVAT`
- stavy `builder + candidates + queue / detail / edit`
- `ExpediceBuilderPanel`
- `ExpediceQueuePanel`
- `ExpediceDetailPanel`
- `ExpediceEditorPanel`
- `POST /api/expedice/manual-items`
- `PUT /api/expedice/manual-items/[id]`
- `DELETE /api/expedice/manual-items/[id]`
- editace bloků přes `PUT /api/blocks/[id]` pouze pro `expediceNote` a `doprava`

**Výsledek:**
- editor pracuje v patternu shodném s hlavní timeline
- ruční zakázky a interní závozy vznikají nejdřív ve frontě a pak se plánují na timeline

### Etapa D — Drag & drop + persistentní pořadí

**Rozsah:**
- drag & drop bloku -> `PUT /api/blocks/[id]` s novým `deadlineExpedice`
- reorder publishnutého bloku v rámci dne -> update `expeditionSortOrder`
- drag & drop ruční položky z fronty na den -> `PUT /api/expedice/manual-items/[id]` s novým `date` a `expeditionSortOrder`
- drag & drop ruční položky mezi dny -> `PUT /api/expedice/manual-items/[id]` s novým `date` a `expeditionSortOrder`
- reorder ruční položky v rámci dne -> update `expeditionSortOrder`
- vrácení ruční položky do fronty -> `PUT /api/expedice/manual-items/[id]` s `date = null`
- drop zone highlight
- pouze pro `ADMIN` / `PLANOVAT`

**Výsledek:**
- rychlé přeplánování bez klikání
- pořadí v rámci dne je stabilní i po reloadu a pro ostatní uživatele

---

## Implementační checklist

### 0. Před startem implementace

- založit samostatnou branch pro expedici
- před první změnou zkontrolovat současné reusable primitivy:
  - pravý aside a jeho header / footer pattern v `PlannerPage`
  - `Button`, `Input`, `Textarea`, `HoverCard`, shared date utils
  - existující confirm pattern pro smazání bloku
- potvrdit, že expedice nebude zavádět nový design systém ani nové vlastní formulářové primitivy bez důvodu
- projít `Block` update flow, split propagaci, copy / paste a undo logiku, protože právě tam je největší riziko vedlejších efektů

### 1. Etapa A checklist

#### Implementace

- rozšířit `prisma/schema.prisma` o:
  - `Block.expediceNote`
  - `Block.doprava`
  - `Block.expeditionPublishedAt`
  - `Block.expeditionSortOrder`
  - model `ExpeditionManualItem`
  - enum `ExpeditionManualItemKind`
- vytvořit migraci a zkontrolovat SQL diff
- doplnit `src/app/api/blocks/[id]/expedition/route.ts`
- doplnit invarianty do `src/app/api/blocks/[id]/route.ts`
- doplnit audit log eventy pro publish / unpublish bloků
- upravit middleware tak, aby `/expedice` bylo dostupné všem rolím v read-only režimu

#### Ověření

- publish bez `deadlineExpedice` vrátí validní chybu
- publish s `deadlineExpedice` nastaví `expeditionPublishedAt` a `expeditionSortOrder`
- unpublish smaže jen publish stav, ne `deadlineExpedice`
- změna `deadlineExpedice` u publishnutého bloku zachová publish stav
- smazání `deadlineExpedice` publishnutý blok automaticky odpublikuje
- split skupina propaguje `deadlineExpedice`, `expediceNote`, `doprava`, `expeditionPublishedAt`, `expeditionSortOrder`
- copy / paste bloků nepřenese publish stav na novou kopii

### 2. Etapa B checklist

#### Implementace

- vytvořit `src/app/expedice/page.tsx`
- navrhnout `GET /api/expedice` tak, aby vracel:
  - `days`
  - `candidates`
  - `queueItems`
- postavit read-only shell expedice po vzoru hlavní timeline
- doplnit header vstup `Expedice` do hlavního planneru
- zobrazit kandidáty z tiskového plánu v aside pro editory
- přidat publish kandidáta přímo z expedice
- přidat shortcut akce `Zaplánovat do Expedice` / `Odebrat z Expedice` do context menu v hlavní timeline
- přidat fallback stejné akce do detailu bloku

#### Ověření

- read-only role otevřou `/expedice` bez aside a bez chyb
- `ADMIN` / `PLANOVAT` vidí `Builder + Kandidáti + Fronta`
- kandidát s datem a bez publish se ukáže v kandidátech
- klik na `Zaplánovat do Expedice` kandidáta přesune do timeline správného dne
- po refreshi zůstane publishnutý blok v timeline
- unpublish vrátí blok zpět mezi kandidáty
- změna `deadlineExpedice` v hlavním planneru se po refreshi projeví i u kandidáta nebo publishnutého bloku v expedici

### 3. Etapa C checklist

#### Implementace

- postavit aside stavy:
  - `builder + candidates + queue`
  - `detail`
  - `edit`
- vytvořit builder pro `MANUAL_JOB` a `INTERNAL_TRANSFER`
- implementovat `POST /api/expedice/manual-items`
- implementovat `PUT /api/expedice/manual-items/[id]`
- implementovat `DELETE /api/expedice/manual-items/[id]`
- přidat detail a editor pro blok i ruční položku
- přidat sticky footer akce `Uložit / Zrušit / Smazat`
- přidat confirm pattern pro `Odebrat z Expedice` a `Smazat položku`
- přidat dirty-state guard při opuštění rozeditovaného aside

#### Ověření

- builder vytváří ruční položku jen do fronty, ne rovnou do timeline
- editace bloku dovolí změnit jen `expediceNote` a `doprava`
- editace ruční položky dovolí změnit obsah bez ruční editace `date`
- `Odebrat z Expedice` neodstraní blok z tiskového plánu
- `Smazat položku` skutečně smaže jen ruční položku
- `Enter` potvrdí destruktivní dialog, `Esc` ho zavře
- přepnutí na jinou kartu při dirty stavu neodhodí změny bez varování

### 4. Etapa D checklist

#### Implementace

- doplnit drag & drop pro publishnuté bloky mezi dny
- doplnit reorder publishnutých bloků uvnitř dne
- doplnit drag & drop ručních položek:
  - fronta -> den
  - den -> jiný den
  - den -> fronta
  - reorder uvnitř dne
- navrhnout stabilní přidělování `expeditionSortOrder`
- zajistit, že změna dne v expedici zapisuje zpět `deadlineExpedice`
- zajistit, že změna dne z hlavního planneru publishnutému bloku přidělí nový sort order na konci cílového dne

#### Ověření

- blok přetažený na jiný den změní datum v expedici i v hlavním planneru
- reorder bloků uvnitř dne přežije refresh
- ruční položka z fronty po dropu dostane datum a sort order
- ruční položka vrácená do fronty přijde o `date` i `expeditionSortOrder`
- přetažení mezi dny nepřepisuje jiné položky ani nevytváří duplicitní pořadí
- read-only role drag & drop vůbec nemají aktivní

### 5. Finální hardening před nasazením

- projít hlavní planner a ověřit, že se nerozbily:
  - detail bloku
  - editace bloku
  - context menu
  - split bloky
  - copy / paste
  - undo po delete
  - background refresh / polling
- ověřit, že expedice reuseuje existující komponenty a netahá nový styl bokem
- ověřit truncation a hover preview u dlouhých textů
- ověřit empty, loading a error states
- zkontrolovat mobile / menší desktop šířky bez horizontálního scrollu
- spustit lint a relevantní testy
- ručně projet hlavní workflow:
  - kandidát vznikne po vyplnění `deadlineExpedice`
  - publish v expedici
  - přesun publishnutého bloku na jiný den
  - unpublish
  - ruční položka do fronty
  - ruční položka z fronty na den
  - ruční položka zpět do fronty

### Doporučené pořadí PR

1. Datový model + API invarianty bez UI.
2. Read-only expedice + kandidáti + publish / unpublish.
3. Aside pro editory + ruční builder a fronta.
4. Drag & drop + persistentní pořadí.
5. Hardening, regressions, polish.

---

## Technické poznámky

- **Datum ukládání**: stejný pattern jako jinde v aplikaci pro civilní datum, např. `new Date(datePart + "T00:00:00.000Z")`
- **Prague timezone**: zobrazení dat přes `utcToPragueDateStr()` z `src/lib/dateUtils.ts`
- **Layout shell**: reuse principů z hlavního planneru, hlavně aside width, header panelu, border rhythm a selected/editing stavy
- **Design systém**: nepřinášet nový vizuální jazyk; držet existující tokeny a povrch hlavní timeline
- **Drag & drop implementace**: nativní HTML5 Drag & Drop API, stejný přístup jako v hlavním planneru, snap na celý den
- **Read-only režim**: pro role bez editace se aside nerenderuje
- **Publish invariant**:
  - `deadlineExpedice` určuje datum
  - `expeditionPublishedAt` určuje viditelnost v expedici
  - publish nikdy nesmí tiše vzniknout jen z vyplněného data
- **Bidirectional sync**:
  - expedice i hlavní planner zapisují stejný `deadlineExpedice`
  - publishnutý blok proto mění datum synchronně v obou pohledech
  - smazání data v hlavním planneru auto-unpublikuje blok z expedice
- **Pořadí v rámci dne**:
  - publishnuté bloky i ruční položky používají persistentní `expeditionSortOrder`
  - změna dne z hlavního planneru přidělí publishnutému bloku nový sort order na konci cílového dne
- **Queue-first v1**:
  - builder nevytváří datum
  - fronta je množina `ExpeditionManualItem` s `date = null`
  - fronta má vždy `expeditionSortOrder = null`
  - pořadí fronty v1 = `createdAt DESC`
  - naplánování položky na den = nastavení `date`
- **A11y guardrails**:
  - icon-only tlačítka musí mít `aria-label`
  - formulářová pole musí mít `Label`
  - focus-visible stavy se přebírají ze sdílených komponent, nepoužívat `outline: none` bez náhrady
  - toast container má mít `aria-live="polite"`
- **Long content handling**:
  - karta musí zvládat krátký, běžný i velmi dlouhý text
  - truncation na kartě, plný text v detailu / hover preview
- **Audit log v1**:
  - změny bloků (`expediceNote`, `doprava`, `deadlineExpedice`) se logují přes existující `AuditLog`
  - publish / unpublish bloků se loguje jako explicitní akce `EXPEDITION_PUBLISH` / `EXPEDITION_UNPUBLISH`
  - ruční položky v této verzi nepoužívají stávající `AuditLog`, protože ten je dnes navázán na `blockId`
  - pokud bude potřeba audit i pro ruční položky, je to samostatná navazující vlna s obecným audit modelem

---

## UX/UI rozhodnutí pro implementaci

- pravý panel ano
- inline editace ne
- read-only role bez pravého panelu
- builder vytváří ruční zakázku i interní závoz
- builder přidává ruční položky nejdřív do fronty
- tiskový blok se do expedice dostane jen přes explicitní publish
- kandidát z tiskového plánu se v expedici ukáže automaticky po vyplnění `deadlineExpedice`
- publish je primárně přímo v expedici na kandidátovi, hlavní timeline je jen shortcut
- timeline ukazuje jen publishnuté bloky z tisku a naplánované ruční položky
- pravý aside ve výchozím stavu skládá `Builder + Kandidáti + Fronta`
- fronta ručních položek je součást výchozího aside
- tlačítko `Dnes` ano
- date jump ano
- jednoduché filtry `Vše / Tiskový plán / Ruční / Interní` ano
- červená čára aktuálního času ne
- plynulý zoom slider z hlavní timeline ne
- ovládání hustoty zobrazení ano, ale jen diskrétně `Detail / Standard / Kompaktní`
- výchozí rozsah `3 dny zpět / 14 dní dopředu`
- ruční zakázka má vypadat skoro stejně jako blok, rozdíl komunikuje badge a zdroj
- detail bloku ukazuje expediční minimum + stroj jako sekundární údaj
- blok lze z expedice odebrat bez smazání bloku z výroby
- `Odebrat z Expedice` používá stejný confirm pattern jako delete v hlavním planneru
- `deadlineExpedice` zůstává při unpublishi zachované
- změna data publishnutého bloku je obousměrně synchronní mezi tiskovým a expedičním plánem
- den má auto-height podle obsahu, bez vnořeného scrollu
- pořadí položek uvnitř dne je persistentní
- read-only role dostanou hover preview pro plný obsah zkrácené karty
- dirty state guard je povinný
- reuse existujících UI komponent a tokenů je povinný, ne jen doporučený

## Odložené nápady mimo v1

- audit ručních expedičních položek
- složitější filtry kombinující typ, dopravu a fulltext naráz
- více hustot zobrazení typu `kompaktní / komfortní`
- další orientační stavy typu overdue nebo SLA signalizace na úrovni dne
