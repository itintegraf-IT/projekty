# CLAUDE.md — Integraf Výrobní plán

Štíhlý soubor pravidel (živé konvence + gotchy). Historie featur a implementační detaily → `docs/vyvoj-historie.md`; plány → `docs/superpowers/plans/`. Změny konvencí commituj ve stejném PR, co je vyvolal.

**Stack:** Next.js 16 (App Router) · React · TypeScript · Tailwind CSS v4 · Prisma 5 · MySQL.

## Příkazy

```bash
npm run build        # build (spustit lokálně před pushem — chytí TS chyby dřív než server)
npm run lint         # vrací warningy, 0 chyb je OK
# celá test suite (1060 testů, node:test + tsx) — glob NEJDE do podsložek,
# proto se každá složka s testy musí uvést zvlášť (jinak tiše nepoběží):
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

`--experimental-test-module-mocks` je nutný jen kvůli `sessionVersion.test.ts` (`mock.module`); ostatní ho nepotřebují. (`scheduleSlotFinder.server.test.ts` ho potřeboval do 8. 8. 2026 — od zapojení revizí si finder bere Prisma klienta povinným parametrem, takže si test podstrkuje fake přímo, bez mockování modulu.)

## Role a přístup

| Role | Planner | Rezervace | Admin | Notifikace |
| --- | --- | --- | --- | --- |
| `ADMIN` | plný edit | ano | plný | audit + historie |
| `PLANOVAT` | plný edit | ano | omezený admin (číselníky/presety/prac. doba) | audit + historie |
| `DTP` | edit DATA | ne | ne | vlastní inbox |
| `MTZ` | edit MATERIÁL | ne | ne | vlastní inbox |
| `OBCHODNIK` | read-only | vlastní rezervace | ne | vlastní inbox |
| `TISKAR` | read-only + tisk (režim `isTiskar` na `/`) | ne | ne | ne |
| `VIEWER` | read-only | ne | ne | ne |

Modul `/tiskar` byl zrušen (mrtvý kód) — tiskař jede na `/`.

## Data & DB

- Zdroj pravdy schématu: `prisma/schema.prisma` (datasource `mysql`); migrace v `prisma/migrations/`.
- Modely: `Block`, `Reservation`, `ReservationAttachment`, `Notification`, `JobPreset`, `CodebookOption`, `CompanyDay`, `MachineWeekShifts`, `MachineWorkHours` (jen bootstrap/legacy), `User`, `AuditLog`, `SplitGroup`, `BlockRevision`.
- **`BlockRevision`** = „černá skříňka" změn plánu (etapa B1, 8/2026). Ke každé změně bloku drží, jak řádek vypadal předtím a potom. Retence 90 dní, úklid `scripts/prune-revisions.ts` (cron, `docs/OPS_ZALOHY.md`). ZÁMĚRNĚ bez cizího klíče na `Block` — revize musí přežít smazání bloku a produkční `Block.id` je `INT UNSIGNED`. Vzniklo proto, že `AUDITED_FIELDS` neobsahuje `startTime`/`endTime`/`machine`/`printMinutes`, takže jednoblokový přesun nezanechával v historii stopu (viz havárie plánu 5. a 6. 8. 2026).
- Přílohy: metadata v `ReservationAttachment`, obsah na disku `data/reservation-attachments/<reservationId>/<storageKey>`.
- **Pracovní doba**: runtime jede na `MachineWeekShifts`. **Řádek je na DEN, ne na týden** — klíč je `(machine, weekStart, dayOfWeek)` a nese i `isActive`. Kdo si `weekStart` splete s identitou řádku, dostane pro všech sedm dní tentýž první záznam (naletěl tomu plán etapy R4a, 17. 8. 2026). Výchozí časy směn MORNING 6–14, AFTERNOON 14–22, NIGHT 22–6, **ale NEJSOU fixní** — každá směna má volitelný override `*StartMin`/`*EndMin` (minuty od půlnoci) a rozřešení dělá `resolveShiftBounds` (`src/lib/shifts.ts`), nikdy ne přímé čtení flagu.
- **Datum na serveru**: vždy `new Date(datePart + "T00:00:00.000Z")`, nikdy `getFullYear/Month/Date`. Prague helpery v `src/lib/dateUtils.ts`.

## Bezpečné a nebezpečné příkazy

```bash
npx prisma migrate deploy     # bezpečné
npm run prisma:bootstrap      # bezpečné (idempotentní seed číselníků)
npm run prisma:seed           # DESTRUKTIVNÍ dev-only — maže data. NIKDY na produkci.
```

Produkce běží na firemním serveru (spravuje Michal); deploy postup a prod-DB gotchy (název DB `igvyroba` malými, `sudo mysql`, host) → `docs/DEPLOY_WORKFLOW.md`. **Před každým zásahem na produkci VŽDY nejdřív `mysqldump` záloha.**

## Prisma — konvence relací (KRITICKÉ)

`prisma db pull` a `prisma format` přejmenují relační pole podle názvu modelu a **rozbijí kód**. **Nikdy je nespouštět bez kontroly.** Kanonická relační pole (kód je na nich závislý):

| Model | Pole | Typ |
| --- | --- | --- |
| `Reservation` | `blocks` | `Block[]` |
| `Reservation` | `attachments` | `ReservationAttachment[]` |
| `ReservationAttachment` | `reservation` | `Reservation` |

Pokud je formátovač přepíše na `Block`/`ReservationAttachment`/`Reservation`, vrátit zpět. Po změně schématu spustit `npm run build`.

## Coding standards (POVINNÉ pro nový kód)

**Chyby v API routes → vždy `AppError`** (`src/lib/errors.ts`), nikdy string-prefix `Error`. V catch bloku:
```typescript
} catch (err) {
  if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
  logger.error("[route] neočekávaná chyba", err);
  return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
}
```
`errorStatus` je kanonická mapa kód→HTTP v `errors.ts` (žádné lokální kopie).

**Auth v nových API routes → `requireRole([...])`** (`src/lib/auth.ts`) UVNITŘ try (hází `UNAUTHORIZED`/`FORBIDDEN` → catch výše). Čisté jádro `assertRole` v `src/lib/authz.ts`. Jediné záměrně veřejné cesty: `/api/auth/*`, `/api/health` (liveness probe pro monitoring) a `/vyroba-terminal.html` (kioskový launcher u strojů, `docs/KIOSK_TERMINAL.md`) — všechny tři výjimkou v middleware přesnou shodou (`src/middleware.ts`) — žádné další nepřidávat.

**Logování → vždy `logger`** (`src/lib/logger.ts`), nikdy `console.*` v API routes.

**Validace harmonogramu → vždy `validateAndComputeEnd`** (`src/lib/scheduleValidationServer.ts`, jediný zdroj pravdy). Pro každý ZAKAZKA blok s `startTime` (POST/PUT/batch): ulož **end vrácený funkcí** (nikdy z klienta) a do `Block.scheduleBypassed` ulož **`sched.effectivelyBypassed`** (spočítaná pravda), nikdy echo request flagu. Klientské mutační cesty posílají `printMinutes` a snapují **jen start** (`snapStartToNextRunnableSlot`), end dopočítá server. Detaily „tiskových hodin" → `docs/vyvoj-historie.md`.
**Jediná vědomá výjimka: `POST /api/blocks/undo`** (`src/lib/undoApply.server.ts`) tohle záměrně NEDĚLÁ — zapisuje `startTime`/`endTime`/`printMinutes`/`scheduleBypassed` doslova ze snapshotu, bez `validateAndComputeEnd`/`expandPrintTime`. Undo vrací stav, který v DB prokazatelně existoval; měřit ho dnešní mřížkovou validací je kategorická chyba — přesně to dřív rozbíjelo návrat bloků mimo 30minutovou mřížku (nešlo je vrátit vůbec, selhávalo to pokaždé). Nerozšiřuj tuhle výjimku na žádnou jinou cestu — je vázaná na to, že undo obnovuje již-existující stav, ne nový vstup od uživatele.

**Overlap guard platí pro VŠECHNY typy bloků** (ZAKAZKA, REZERVACE, UDRZBA — ne jen ZAKAZKA), na všech 6 zápisových cestách (POST/PUT/batch/split/reflow/undo). `assertNoOverlapForBlocks`/`checkBlockOverlap` (`src/lib/overlapCheck.ts`) jsou type-agnostické odjakživa — nový kód, který mění `startTime`/`endTime`/`machine` bloku libovolného typu, musí na konci transakce zavolat `assertNoOverlapForBlocks` se seznamem ID dotčených bloků. Reflow endpointy (`src/lib/reflow.server.ts`) tuto pojistku dřív nevolaly vůbec (reálný bug, opraven 16. 7. 2026) — nepřidávat žádnou novou mutační cestu bez ní. Detaily → `docs/vyvoj-historie.md`.

**Chain push (odsouvání navazujících bloků) platí pro VŠECHNY typy** — od 31. 7. 2026 si rezervace i údržba udělají místo stejně jako zakázka (dřív byly pevná zeď a drop se odmítl 409). Geometrie posunu se ale liší a je v jediném zdroji pravdy `chainPushGeometry` (`src/lib/overlapResolver.server.ts`), který volá jak push, tak jeho nezávislá pojistka:
- **ZAKAZKA** → tiskové hodiny: délka z `printMinutes`, re-expanze přes pauzy směn.
- **REZERVACE/UDRZBA** → rigidní interval: PŘESNÁ délka (žádné zaokrouhlení na 30 min, žádné roztažení), start přes `snapToNextValidStartWithTemplates` (týž helper, jaký používá ruční drag na klientovi), horizont posunu `MAX_RIGID_PUSH_MS` = 7 dní.

**Zdí (neposouvá se, drop se odmítne) zůstává:** zamčený blok · blok s potvrzeným tiskem · **rigidní blok, který na své současné pozici nevyhovuje kalendáři** (leží mimo pracovní dobu nebo v odstávce — typicky víkendová údržba či servis naplánovaný na celozávodní odstávku; posun by ho vystěhoval do výroby) · sourozenci z téže dávky v batchi (`frozenIds` — načtou se jako překážka, ale neposouvají se).

**Drift kalendáře počítají DVĚ nezávislé implementace s RŮZNÝM rozsahem** (nastaveno 9. 8. 2026): server `detectCalendarDrift` (`calendarDrift.server.ts`) pohání souhrnné kanály — notifikace, provozní report, hromadné „Přepočítat"; klient `blockCalendarDrift` (`printTimeClient.ts`) kreslí štítek na kartě jedné zakázky.
- **U NEODLOŽENÝCH bloků musí klasifikovat shodně** — rozejití = štítek na zakázce tvrdí něco jiného než pruh nad strojem. Změna guardu na jedné straně se vždy promítá na druhou; hlídá to tabulkový test parity v `calendarDrift.server.test.ts` (obsahuje i vstupy, které si každá strana počítá sama — odstávky, zarovnání startu).
- **Odložené bloky (`scheduleBypassed`) posuzuje JEN klient.** Server je vyřazuje už ve `where` a je to záměr: příznak je *spočítaná pravda* (`effectivelyBypassed = !conforms`), takže odložená zakázka je z definice nekonformní. Bez toho filtru by každé vědomé odložení trvale svítilo jako „nesedí na kalendář" — notifikace z každé úpravy směn, nikdy nenulový report, a hromadné „Přepočítat" by ji nevratně vystěhovalo (reflow nemá undo). Vlastní důvody `PARKED`/`STALE_BYPASS` proto na serveru NIKDY nevzniknou. Souhrnné počítadlo nad strojem (`driftCountByMachine` v `TimelineGrid.tsx`) je musí vynechávat taky, jinak slibuje akci, která u nich neproběhne.
- **`tryExpandForBlock` (`printTimeClient.ts`) se NESMÍ uvolnit** — sdílí ho `getBlockSegments`/`blockReportSegments` (kreslení pauz uvnitř bloku). Odložená zakázka tiskne slitě, takže by se jí dovnitř kreslil pás „⏸ PAUZA — mimo provoz". Kdo potřebuje expandovat i odloženou zakázku, řekne si o to parametrem `includeBypassed` (dnes jediný takový volající je klientský detektor); výchozí stav zůstává přísný.
- **Značku dnes ruší tři cesty a všechny vycházejí z akce uživatele:** adresné tlačítko „Přepočítat" (`reflowBlockInTx`), přetažení/resize při ZAMČENÉM zámku (`[id]/route.ts` bere příznak z requestu, `effectivelyBypassed` ho pak vynuluje) a undo, které zapisuje doslova ze snapshotu. Odložený blok navíc NENÍ zeď pro autoposun — chain push ho posune jako každý jiný, geometrii i značku si přitom ponechá (`chainPushGeometry`). Nepřidávat žádnou **další** cestu, obzvlášť ne takovou, která by značku rušila nebo blok přesouvala bez akce uživatele (viz `docs/POUCENI.md` a „minimum automatiky bez vědomí plánovače“). Od 17. 8. 2026 je ten výčet **vynucený, ne jen popsaný**: `PUT /api/blocks/[id]` přepočítává harmonogram jen při SKUTEČNÉ změně typu/stroje/startu/konce/tiskové délky proti DB (`shouldRecomputeSchedule`, `scheduleValidationServer.ts`) — dřív stačila přítomnost `type` v payloadu, kterou `BlockEdit` posílá při každém uložení, takže uložení popisu u rozejitého bloku tiše přepsalo `endTime` a chain push odsunul navazující zakázky. Důsledek je záměrný: rozejitý blok se sám nespraví, spraví ho jen „Přepočítat".

**Audit → každá mutace v `$transaction`** společně se zápisem do `AuditLog` (jinak nekonzistentní stav).

**Mouse handlery na blocích** začínají `if (e.button !== 0) return;` (jen levé tlačítko).

**Bezpečnostní ENV bez fallbacku**: `JWT_SECRET` chybí → `throw`, nikdy `?? "dev-secret"`.

**Split-skupiny**: členství dotazuj VÝHRADNĚ `where: { splitGroupId: X }`, NIKDY `id === splitGroupId` — `Block.id` a `SplitGroup.id` jsou nezávislé id-prostory. Split vzniká atomicky přes `POST /api/blocks/[id]/split`.

**Undo → vždy `POST /api/blocks/undo`** (tenká route `src/app/api/blocks/undo/route.ts`, jádro `src/lib/undoApply.server.ts`). Undo vrací stav, který v DB prokazatelně existoval, takže endpoint zapisuje doslova ze snapshotu a NEspouští validaci harmonogramu (viz výjimka výše). Co běží VŽDY: optimistic lock (`expectedUpdatedAt`, kontrolovaný pro všechny cíle najednou před prvním zápisem) a `assertNoOverlapForBlocks` na konci transakce. Nové undo cesty nesmí obcházet `sanitizeUndoOps` (allowlist sloupců `UNDO_RESTORABLE_FIELDS`, `src/lib/undo/restoreFields.ts`).
- **`SELECT ... FOR UPDATE` musí být PRVNÍ dotaz v transakci** — platí pro undo, ale i pro každou budoucí transakci v repu, která nejdřív čte a pak zapisuje pod optimistic lockem. Pod MySQL REPEATABLE READ založí obyčejný `findMany`/`SELECT` jen consistent-read snapshot bez zámků; teprve zamykající čtení jako první dotaz zajistí, že se zámek i vidění dat kryjí (jinak TOCTOU mezera — souběžný zápis odjinud by proklouzl mezi kontrolou verze a update/delete).
- **`SPLIT_SHARED_FIELDS` (`src/lib/splitSharedFields.ts`) se přes undo NEPROPAGUJÍ.** PUT route propaguje sdílená pole na split sourozence automaticky (`updateMany`); atomický undo endpoint zapisuje doslova a nic neodvozuje ani nepropaguje. Každý sourozenec, kterého má undo vrátit, musí být v `ops` ADRESNĚ (vlastní `upsert`), typicky přes `buildSplitEditTargets`/`buildSplitEditTargetsWithShifted`/`buildPassiveSiblingTargets` (`src/lib/undo/splitSiblingFields.ts`). Zapomenutý sourozenec = split skupina se sdílenými poli tiše rozejde (šlo o Critical nález go/no-go auditu 5. 8. 2026, tři nezávislé cesty).
- **Strop 200 operací** v jedné undo dávce (`sanitizeUndoOps`) — nad tím 400 `VALIDATION_ERROR`.
- **`Block.id` po undo obnově zůstává PŮVODNÍ** (žádný remap) — undo mazání smaže řádek, undo vzkříšení ho vytvoří zpátky se STEJNÝM id (MySQL `AUTO_INCREMENT` se explicitním vložením nižší hodnoty nesnižuje). Mění to předpoklad „smazaný blok je pryč navždy" — `AuditLog.blockId` i `Notification` na něj mohou po redu znovu ukazovat platný řádek.

**Každá mutace bloku běží uvnitř `withRevision`** (`src/lib/revision.server.ts`). Pomocník otevírá transakci SÁM a tělu předá klient s podstrčenými delegáty `block` a `auditLog`; zachycení „před" stavu se řídí `where` samotného zápisu, takže volající nikde nevyjmenovává pole ani bloky. Zapojeno je všech 9 cest (POST · PUT · DELETE · batch · split · reflow ×2 · undo · complete · expedition) a hlídá to `src/lib/revisionWiring.test.ts`.
- **Uvnitř těla je jakékoliv `prisma.*` ZAKÁZANÉ, i pro čtení.** Zápis přes globální klient přežije rollback a revizi nevytvoří. Pozor na NEPŘÍMÉ nosiče — funkce, které si klienta berou z importu; `scheduleSlotFinder.ts` a `jobPresetServer.ts` proto klienta přijímají parametrem. Před každou novou cestou: `grep -rn 'from "@/lib/prisma"' src/lib/`.
- **Vnořený relační zápis do `Block` je zakázaný** (`data: { splitGroup: { … } }`, `data: { other_Block_… : { … } }` apod.) — jádro ho odmítne výjimkou. Prošel by i skrz povolený `rtx.block.update` a změnil cizí blok bez revize.
- **Delegát zakazuje vše, co výslovně nepovolí.** Neznámá zápisová metoda (dnes `createManyAndReturn`, zítra cokoliv nového v Prismě) spadne s hláškou místo aby tiše obešla skříňku. `block.createMany` hází — MySQL nevrací id, takže revizi nejde přiřadit.
- **`withRevision` NEJDE vnořit** (hlídá `AsyncLocalStorage`) — obaluj ROUTU, ne sdílený helper.
- **Co pomocník uzavřít NEUMÍ:** globální klient `prisma` v uzávěru těla (hlídá jen code review), kaskády referenční integrity a DML uvnitř migrací. `ON DELETE SET NULL` nad `recurrenceParentId` se proto v DELETE i v undu **výslovně provádí přes `rtx` před smazáním** — bez toho rozpadne sérii bez jediné stopy.
- **Nový `Boolean`/`DateTime` sloupec na `Block`** MUSÍ přibýt do `src/lib/revision/blockColumns.ts` — hlídá strážný test proti schématu.
- **Nová hodnota `AuditLog.action`/`field`** MUSÍ přibýt do `src/lib/auditCoverage.ts`, jinak se řádek v historii zdvojí. Pozor: `field` u undo neurčuje pokrytí sám — seznam sloupců je v `newValue`.

## Design tokens a vizuální konvence

- Barvy/rozměry **vždy přes CSS tokeny** z `src/app/globals.css`, **nikdy hex/rgba literál** v komponentě (rozbíjí light mode): `--bg`/`--text`/`--text-muted`, `--surface`/`--surface-2`/`--surface-3`, `--border`, `--ring`, `--brand`/`--brand-contrast`, `--danger`/`--success`/`--warning`/`--info`.
- **Sytý token je barva PODKLADU, ne písma.** `--brand` (žlutá) dává ve světlém režimu jako `color:` **1,22 : 1**, `--warning` 1,86 : 1 — text prakticky neviditelný, zatímco jako podklad s `--brand-contrast` jsou oba v pořádku. Pro písmo existují `--brand-text` a `--warning-text`. **Nový barevný token se nezavádí od oka** — kontrast se změří (`src/lib/contrast.ts`: OKLCH → sRGB, WCAG poměr, simulace deuteranopie/protanopie) a zapíše do `src/lib/reportTokens.test.ts`, který hodnoty čte ze skutečného `globals.css`, ne z kopie. Test drží i **obrácená tvrzení**: `--brand`, `--danger`, `--success` a `--info` jsou zatím jako písmo ve světlém režimu pod AA (2,78–4,45 : 1) a používají se tak v planneru, Monitoru i adminu — až to někdo opraví, test spadne a vynutí si projít seznam. Uvnitř `/reporty` už tam nejsou, tam je nahradila čtveřice `--status-bad`/`-ok`/`-warn`/`-idle` (slouží textu i výplni; `--status-on` je barva čísla na syté výplni).
- **Velikosti v `/reporty`** vždy přes `src/lib/reportTokens.ts` (`reportTypeScale` s podlahou 10 px, `reportGlyph`, `reportRadius`), nikdy holé číslo — obdoba `plannerTypography.ts` pro planner, `monitorTypography.ts` pro Monitor a `uiStyles.ts` pro admin.
- **Velikosti na Monitoru u stroje** vždy přes `src/lib/monitorTypography.ts` (`monitorTypeScale`), nikdy holý `fontSize` — hlídá to strážný test, který zdrojáky `src/components/monitor/*.tsx` prochází regulárem. Stupeň M/L/XL i klíč v localStorage Monitor SDÍLÍ s plánem (`PLANNER_FONT_SCALES`, `FONT_SCALE_STORAGE_KEY`); vlastní škála existuje jen kvůli jiným rozměrům (46px číslo přes půl obrazovky vs. 12px v mřížce). **Tlačítka velké karty mají pevnou výšku `MONITOR_HERO_BUTTON_HEIGHT`** a neroste jim s písmem — jsou to dotykové cíle. Obsah karty leží ve VLASTNÍM `flex: 1; minHeight: 0; overflow: hidden` kontejneru odděleně od tlačítek: ořez tak sebere obsah, nikdy tlačítko HOTOVO (do 17. 8. 2026 držel tlačítko dole jen `marginTop: auto` a přerostlý obsah ho vystrčil pod ořez — táž třída vady jako havárie rozpočtů 3. a 12. 8. 2026).
- **Z-index** výhradně přes `src/lib/zLayers.ts` (`Z_TIMELINE`/`Z_LAYOUT`/`Z_OVERLAY`), nikdy magické číslo.
- **Sdílené UI kameny** (`src/components/`, ne `ui/` — shadcn plošně nerozšiřujeme): `NativeSelect`, `PrimaryCta`, `ConfirmDialog`, `ModuleHeader`; admin tlačítka/inputy z `src/lib/uiStyles.ts`. Kdy co viz `docs/vyvoj-historie.md`.
- **Nové standalone komponenty** jako named export do `src/components/` — **NEpsat inline do velkých souborů** (PlannerPage/TimelineGrid byly záměrně dekomponovány). Než přidáš do souboru u limitu, nejdřív navrhni extrakci a ohlas rozhodnutí (ESLint `max-lines` warn hlídá).
- **Focus**: neodstraňovat viditelný focus ring; globální `:focus-visible` používá `--ring`.
- **Tailwind v4**: `@import "tailwindcss"`; dynamické třídy nepodporuje → inline style.
- **Clipboard**: vždy `copyTextToClipboard` (`src/lib/clipboardCopy.ts`), nikdy přímo `navigator.clipboard.*` (prod běží přes HTTP → crash).
- **Velikost písma v planneru** vždy přes `src/lib/plannerTypography.ts` (`plannerTypeScale`), nikdy napevno zapsaný `fontSize` v kartě bloku ani na časové ose. Prahy hustoty (`full`/`compact`/`tiny`/`micro`) se z písma POČÍTAJÍ — kdo přidá do karty nový prvek, musí ověřit, že se vejde i ve stupni XL (hlídá strážný test `plannerTypography.test.ts`). Dva různé koeficienty: `fontFactor` pro písmo, `slotFactor` pro výšky mřížky — nezaměňovat. `src/lib/tiskarBlockView.ts` je na týchž hodnotách závislý a nesmí se rozejít. `plannerTypeScale` pokrývá i drobné štítky karty a hlavičky stroje (`production`/`noteBadge`/`splitChip`/`pauseLabel`/`driftBadge`) a `thresholds.descMultiline` — od jaké výšky smí mít popis v Řádku 1 víc než jeden řádek (`descLineClampFor`, `tiskarBlockView.ts`).
- **Prvek, který roste se stupněm písma, musí mít strop odvozený od místa, kde stojí** — samotný růst nestačí. Tři vady etapy „dotažení čitelnosti" (12. 8. 2026) měly týž tvar: velikost se navázala na stupeň, mez zůstala pevná (ikony v jednořádkovém layoutu, pilulka rozdělené zakázky, čtvercové tlačítko „Hotovo" bez dolní meze).
- **Rozpočty v `src/lib/tiskarBlockView.ts` chrání tlačítko „Hotovo"** (jediná cesta, kterou tiskař odklepne tisk). Smí se **zpřesnit, nikdy obejít**. Kdo změní velikost prvku, který do rozpočtu vstupuje (písmo, chip, pás specifikace), musí zároveň opravit jeho odhad v rozpočtu — jinak rozpočet tiše lže a tlačítko zmizí pod ořez (havárie 3. 8. 2026, opakovaně 12. 8. 2026).

## Klíčové soubory (index — detail čti v kódu)

**Sdílené jádro:** `src/lib/errors.ts` (AppError/errorStatus) · `authz.ts`+`auth.ts` (requireRole) · `logger.ts` · `scheduleValidationServer.ts` (validateAndComputeEnd) · `printTime.ts`/`printTime.server.ts`/`printTimeClient.ts` (tiskové hodiny) · `blockPayload.ts` (Block→POST payload, jediný zdroj) · `blockStyles.ts` · `machines.ts` · `zLayers.ts` · `dateUtils.ts` · `plannerTypes.ts` · `uiStyles.ts` · `reflow.server.ts` · `calendarDrift.server.ts` · `findConflictingBlocks.ts` · `undoApply.server.ts` (atomické undo/redo, `sanitizeUndoOps`+`applyUndoOps`) · `splitSharedFields.ts` (`SPLIT_SHARED_FIELDS`, sdílené serverem i klientem) · `undo/restoreFields.ts` (`UNDO_RESTORABLE_FIELDS` allowlist) · `undo/splitSiblingFields.ts` (`buildSplitEditTargets`/`buildSplitEditTargetsWithShifted`/`buildPassiveSiblingTargets`) · `prismaTx.ts` (`PrismaTransactionClient`, jediný zdroj) · `orderSearch.ts` (`blockMatchesQuery` — co znamená shoda při hledání zakázky; sdílí hlavičkové hledání, ztlumení v `TimelineGrid`, tiskařský `OrderSearchSheet` i DTP přehled) · `overdueState.ts` (`overdueAlarmState` + `OVERDUE_WINDOW_MS` — dva stupně zpoždění; okno řídí **jen červený alarm zpoždění v PLÁNU** — velká karta Monitoru se jím od 13. 8. 2026 neřídí, drží zakázku, dokud tiskař nedá HOTOVO nebo „Přeskočit →" (`pickHeroBlock`), `monitorView.ts` konstantu jen re-exportuje jako záruku pro test parity) · `dtpOverview.ts` (výběr a řazení zakázek v DTP přehledu).

**Revize bloků (černá skříňka, etapa B1):** `src/lib/revision.server.ts` (`withRevision`, podstrčené delegáty, allow-list metod) · `revision/blockColumns.ts` (Boolean/DateTime sloupce `Block`) · `revision/rowNormalize.ts` (raw řádek → typovaný) · `revision/diff.ts` (`computeRevisionDiff`, BEZ `updatedAt`) · `auditCoverage.ts` (`coveredColumns` — co už pokrývá audit) · `revisionFormat.ts` (`formatRevisionLines` — české věty) · `blockHistory.ts` (`BlockHistoryEntry`, sloučená osa) · `revisionWiring.test.ts` (strážný test zapojení všech 9 cest) · `scripts/prune-revisions.ts` (retence 90 dní).

**Planner:** `src/app/_components/PlannerPage.tsx` (orchestrátor ~3109 ř.) · `TimelineGrid.tsx` (~2355 ř.) · `src/components/planner/BlockCard.tsx` (render bloku) · `src/hooks/useJobBuilder.ts` + `src/components/planner/JobBuilderPanel.tsx` (builder) · `src/components/planner/ProductionTagsRow.tsx` (sdílený řádek výrobních štítků OBÁLKA/VNITŘKY + archy/série — BlockEdit i builder) · `src/lib/monitorView.ts` (pravidla Monitoru u stroje — `pickHeroBlock`, `monitorQueue` včetně sekce nedodělaných, `UNFINISHED_LOOKBACK_DAYS`; **fronta DNES/ZÍTRA nese od 17. 8. 2026 i ÚDRŽBU**, sekce NEDODĚLÁNO zůstává jen na zakázkách — údržba se neodklepává, uvázla by tam napořád) · `src/lib/monitorTypography.ts` (`monitorTypeScale`, `MONITOR_HERO_BUTTON_HEIGHT`) · `src/components/monitor/MonitorHeroTiming.tsx` (osa běhu na velké kartě) · `src/lib/tiskarViewRange.ts` (`viewDaysBack`/`viewDaysAhead` — jediný vynucovací bod „tiskař nedědí uložený rozsah plánu"; historie 5 dní zpět od 17. 8. 2026, dřív 1) · `ShutdownManager.tsx` · `ResizeHandle.tsx` · `src/components/BlockEdit.tsx`/`BlockDetail.tsx`/`NativeSelect.tsx`/`PrimaryCta.tsx`/`ModuleHeader.tsx`/`ConfirmDialog.tsx`.

**Admin:** `src/app/admin/_components/` — `AdminDashboard.tsx` (shell) + `UsersSection.tsx`/`CodebookSection.tsx`/`PresetSection.tsx` + `adminShared.ts`.

**Entry:** `src/app/page.tsx` · `rezervace/page.tsx` · `admin/page.tsx` · `report/daily/page.tsx`. **Auth:** `src/lib/auth.ts` · `src/middleware.ts`.

## Produkční DB — známé odchylky od migrací

Prod DB `igvyroba` měla historicky ručně vytvořené sloupce (opraveno 12. 4. 2026): `AuditLog.action` `varchar(16)`→`varchar(191)`; `Block.doprava` a `Block.expediceNote` doplněny jako `varchar(191) NULL`. Při deploy chybě `P2022`/`P2000` nejdřív ověřit skutečný typ sloupce v DB (`SHOW COLUMNS FROM <Tabulka>`).

**Opraveno migrací `20260817120000_widen_audit_and_order_columns` (etapa 1 opravy incidentu 18827):** `AuditLog.field` a `AuditLog.username` byly `varchar(64)`, `Block.orderNumber` byl `varchar(64)` — stejná třída odchylky jako `AuditLog.action` výše, jen odhalená později. Právě `AuditLog.field` způsobilo incident 14. 8. 2026 — undo editace skládá smíšený audit řádek, který schéma (`String` bez `@db.VarChar`, tedy `VARCHAR(191)`) i kód (`AUDIT_MIXED_FIELD_MAX_BYTES = 180` v `undoApply.server.ts`) počítaly proti 191 znakům, ale produkční sloupec měl jen 64 → `PrismaClientKnownRequestError` a 76 neodvolatelně odsunutých zakázek. Všechny tři na `varchar(191)`, ověřeno 17. 8. 2026 přes `information_schema`.

**Vědomě ponecháno** (rozšíření by u těchto sloupců změnilo délkový prefix z 1 na 2 bajty, tedy přestavbu celé tabulky `Block` za nulový přínos — drží krátké výčtové hodnoty): `Block.machine` varchar(16), `Block.type` varchar(32), `Block.recurrenceType` varchar(32), `User.role` varchar(32), `User.username` varchar(64).

**Širší než schéma, neškodné** (varchar(255) proti schématovým 191, ničemu nevadí): `Block.dataStatusLabel`, `Block.materialStatusLabel`, `Block.barvyStatusLabel`, `Block.lakStatusLabel`, `CompanyDay.label`, `User.passwordHash`.

**Produkce je MariaDB, ne MySQL 8** — projevuje se např. `bigint(20)` s display width a `current_timestamp()` s malým písmenem v `information_schema`, kde MySQL 8 píše `CURRENT_TIMESTAMP`.

**`AuditLog.createdAt` i `Block.updatedAt` jsou na produkci `datetime` (přesnost 0), ne `datetime(3)`, jak předepisuje migrace** — ověřeno přes `information_schema` 9. a 17. 8. 2026 nad ostrou DB i její kopií; dev DB `datetime(3)` skutečně má. Auditní razítka se tam tedy zaokrouhlují dolů na celou sekundu, kdežto `BlockRevision.createdAt` má milisekundy. **Nikdy neporovnávat časy z těch dvou tabulek na rovnost ani z nich neodvozovat pořadí** (viz `sortHistoryEntries` v `blockHistory.ts`, které kvůli tomu řadí podle `groupId`). Odchylka je neškodná, dopad má jen na řazení — schéma se kvůli ní neupravuje. **Důsledek u `Block.updatedAt`: optimistický zámek (`expectedUpdatedAt`) má na produkci rozlišení jedné sekundy** — dvě změny téhož bloku ve stejné sekundě od sebe nerozezná (na dev DB s `datetime(3)` se to nikdy neprojeví).

**Doměřeno 17. 8. 2026 při opravné vlně incidentu 18827 (ať se to neměří potřetí):**
- `AuditLog.orderNumber` = `varchar(191)` — v pořádku, migrace `20260817120000_widen_audit_and_order_columns` ho neřešila a řešit nemá.
- `Block.description` a `Block.specifikace` jsou na produkci **`TEXT`**, zatímco schéma je vede jako `String?` bez `@db.Text`, tedy `varchar(191)`. **Opačný směr téže třídy odchylky** než řádky výš: tady je produkce ŠIRŠÍ než dev, takže dlouhý popis spadne až na devu, na produkci projde bez potíží.
- Přesnost `datetime` je uvnitř `Block` smíšená, ne jen mezi tabulkami: `Block.startTime`, `endTime`, `createdAt` a `updatedAt` jsou bez milisekund (`datetime(0)`, viz odstavec výš), zatímco `Block.printCompletedAt`, `pantoneRequiredDate` a `expeditionPublishedAt` mají `datetime(3)`. Stejné varování platí i tady — neporovnávat je na rovnost napříč sloupci s různou přesností.

## Dokumenty v repu

- **`docs/POUCENI.md` — rejstřík chyb, které v tomhle projektu SKUTEČNĚ nastaly, a pravidel, která je příště znemožní. Přečíst před psaním specu nebo plánu; po každé nové chybě sem přibude řádek.**
- `docs/vyvoj-historie.md` — souhrn featur + implementační reference (tiskové hodiny, split-skupiny B2, copy/paste, reporty, dekompozice fáze E) a historie etap
- `docs/DEPLOY_WORKFLOW.md` — deploy postup + prod gotchy
- `docs/OPS_ZALOHY.md` — provozní skripty (denní záloha DB+příloh, health-check à 15 min, CSV export) + restore postup; **NIKDY `git clean -x` v produkční složce** (smaže přílohy v gitignored `data/`)
- `docs/KIOSK_TERMINAL.md` — kioskový launcher u strojů (přepínač plán ↔ Logica); **pozor na `COOKIE_SECURE`** — na HTTP nasazení musí být `false`, jinak se nikdo nepřihlásí
- `docs/superpowers/plans/` — detailní plány jednotlivých etap
- `README.md` · `DOKUMENTACE.md` · `DATABAZE_DOKUMENTACE.md`
