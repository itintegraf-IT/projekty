# Etapa „Audit Top 5" — implementační plán

> **Pro agentické workery:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (doporučeno) nebo superpowers:executing-plans, task po tasku. Kroky používají checkbox (`- [ ]`) syntax.

**Cíl:** Realizovat všech 5 doporučení auditu z 11. 7. 2026 (`docs/audits/2026-07-11-audit-kvalita-design.md`) v jedné etapě o 5 fázích — opravit rozbitý light mode, uklidit mrtvý kód (vč. smazání /tiskar), zastavit divergenci doménových map (datový bug #2), zavést sdílené UI stavební kameny a dekomponovat obří soubory.

**Architektura:** Kanonizace existujících CSS tokenů z `globals.css` + malá vrstva sdílených komponent (ConfirmDialog, NativeSelect, PrimaryCta, ModuleHeader) + extrakce logiky z PlannerPage/TimelineGrid do hooků a `src/lib`. Žádný nový framework, žádný big-bang — shadcn `ui/` vrstva zůstává pro to, co už kryje, plošně se NErozšiřuje (schválený směr „tokens + lehký vlastní systém").

**Pořadí fází (validováno):** A hotfixy (nejvyšší hodnota/riziko poměr, nulové závislosti) → B mazání (nikdo neinvestuje do kódu, který zmizí; zjednodušuje C) → C doménové mapy (datový bug co nejdřív; swapy proběhnou v dnešních velkých souborech) → D UI kameny (NativeSelect/ConfirmDialog/zLayers musí existovat PŘED řezáním souborů) → E dekompozice (největší regresní plocha naposled; nejsnáz krátitelná).

## Globální omezení

- Větev `Vojta` (HEAD `dd673f43 Pre audit`, čistý strom). Checkpoint po KAŽDÉ fázi: `npm run build` + celá suite zelená (`node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`, dnes 371) + commit + **OK od Vojty** před další fází.
- CLAUDE.md aktualizovat **per fáze v témže commitu** (smazané moduly, nové soubory, změněný počet testů, konvence) — repo pravidlo; na konci etapy jen konzistenční sweep.
- Žádné změny chování KROMĚ vyjmenovaných vědomých oprav: light-mode barvy, diakritika reportů, stavy v ReservationList (#56), doplnění ztracených polí v payloadech (#2), login redirect tiskaře, sjednocení HTTP statusů (C2 výčet), title tooltip u chipů (#15), module-scope fix v BlockEdit (#30).
- Standardy: AppError + logger v API routes; nové komponenty do `src/components/` jako named export; `if (e.button !== 0) return`; nová lib logika s unit testy vedle zdrojáku.
- `#N` = nálezy auditu (ověřené file:line v docs/audits/…). Rozhodnutí Vojty: **/tiskar SMAZAT**; select = **NativeSelect** (nativní wrapper, vzhled beze změny).
- E nespouštět souběžně s jinou prací na větvi (tisíce přesunutých řádků = merge konflikty) — heads-up před startem.

---

## Fáze A — Theme & light-mode hotfixy (S)

Čistě mechanické 1–6řádkové swapy, triviální revert, „zahřívací" fáze checkpoint procesu.

- [ ] **A0 Dokumentace do repa:** zkopírovat tento plán do `docs/superpowers/plans/2026-07-11-etapa-audit-top5.md`; `git add docs/audits/ docs/superpowers/plans/…` + commit `docs: audit kvality kódu a designu + plán etapy Top 5`.
- [ ] **A1 globals.css — focus-visible + font** (#101, #97): přidat `:where(button, a, [role="button"], input, select, textarea):focus-visible { outline: 2px solid var(--ring) !important; outline-offset: 2px; }` (`!important` nutné — 37× inline `outline:"none"`) a `font-family` na `body` (stack z login/page.tsx:138). Inline `fontFamily` (36×) mazat průběžně při dotyku souborů, ne plošně. POZOR: font na body změní metriky v ui/ portálech (dropdowny/popovery) — vizuálně zkontrolovat.
- [ ] **A2 Expedice light-mode** (#55): `rgba(255,255,255,…)` → `var(--border)`/`var(--text-muted)`/color-mix, ~24 míst v 8 souborech: ExpediceCard:59, ExpediceEditorPanel:219, ExpediceDetailPanel:65, ExpediceTimeline:147, ExpediceQueuePanel:143, ExpediceBuilderPanel:70, ExpediceAside:328, ExpedicePage:494.
- [ ] **A3 OrderSearchSheet + TiskarMachineToggle** (#28): `"white"` → `var(--surface)`, `rgba(0,0,0,…)` → color-mix (OrderSearchSheet:65,127,142; TiskarMachineToggle:40). Obě žijí na „/" — nesouvisí s mazáním /tiskar.
- [ ] **A4 DtpDataPopover** (#40): 6 hodnot → `var(--surface)`/`var(--surface-2)`/`var(--border)`/`var(--text-muted)`.
- [ ] **A5 Delete dialogy — jen barvy, vědomě dočasné** (#3/#105): PlannerPage ~2950, ~2995: `#262630`→`var(--popover)`, `#f1f5f9`→`var(--text)`, `#94a3b8`→`var(--text-muted)`. D2 pak dialogy nahradí celé; swap navíc zdarma pre-testuje tokeny pro ConfirmDialog.
- [ ] **A6 Login CTA** (#65): login/page.tsx:116–118 `#FFE600`+`var(--bg)` → `var(--brand)`+`var(--brand-contrast)` (PrimaryCta až v D).
- [ ] **A7 Diakritika ReportDashboard** (#72/#103): všechny stringy RetroView/OutlookView (KpiCard labely, SectionHeader, pipelineLabels:181–184, DOW_LABELS:109).
- [ ] **A8 BlockDetail:349** (#91): čas split partnera → `formatPragueDateTime` z dateUtils.
- [ ] **A9 ReservationList stavy** (#56): doplnit COUNTER_PROPOSED („Protinávrh"), CONFIRMED („Potvrzena"), WITHDRAWN („Stažena") do STATUS_LABEL/STATUS_COLOR (ř. 19–33); labely/odstíny sladit s ReservationDetail, barvy přes tokeny kde existují (`--warning`/`--success`/`--danger`).
- [ ] **A10 (volitelné — 1. kandidát na škrt)** GitHub paleta ReportDashboard → tokeny (#92; izolovaná v pipelineColors + KpiCard props).

**Checkpoint A:** build + 371 testů (A nemění src/lib) · ručně v OBOU theme: Expedice karty/oddělovače, OrderSearchSheet + toggle v dark, DtpDataPopover, delete dialogy v light, login CTA v light, /reporty diakritika, badge „Protinávrh", tab-walk = viditelný ring / klik = žádný, portály bez font skoku → commit `fix: light-mode hotfixy, focus-visible, diakritika (audit fáze A)` → OK.

---

## Fáze B — Mrtvý kód vč. smazání /tiskar (S–M)

Vědomá změna chování jen: login redirect na „/". Každý mazací task = samostatný commit-atom (levný revert).

- [ ] **B1 Smazat /tiskar** (#71): smazat `src/app/tiskar/` (page.tsx 41 ř. + TiskarMonitor.tsx 742 ř.); middleware.ts — odstranit `/tiskar` segment z podmínky ř. 32 (**TISKAR blokace /admin a /rezervace MUSÍ zůstat doslova**) a celou fallback větev ř. 37–39; login/page.tsx:32 → `router.push("/")`. Blast radius ověřen: žádné další reference; TiskarMonitor volá jen sdílená API — nic neosiří. NEMAZAT: role TISKAR, isTiskar režim PlannerPage, TiskarMachineToggle (PlannerPage:63, :3028), OrderSearchSheet.
- [ ] **B2 PlannerPage:** pushSuggestion state + typ + JSX 4331–4352 (#1); 14 nepoužitých importů (#13).
- [ ] **B3 TimelineGrid:** `dataCanToggle` + mrtvé onClick ternáry ř. 1346/1471/1681 (#16) — **dblclick handlery (kalendář/DTP popover) zachovat**; mrtvé konstanty COMPANY_DAY_CHIP_STYLE, *_STRONG, chipStateBg/Border, MACHINE_GAP_W (#18); BlockedOverlay 5 nečtených polí (#19).
- [ ] **B4 Komponenty:** BlockEdit void blok ř. 34–43 + importy + SECTION 644–645 (#27); BlockNotesDialog prop blockId (#38); ReservationForm currentUser + `valid` (#67); ShiftRoster btnSuccess/ACTION_LABELS/identický ternár (#53).
- [ ] **B5 Lib:** timeSlots.ts zredukovat na živé exporty (#83); shifts.ts 4 mrtvé exporty **+ jejich testy v témže commitu** — počet testů klesne, nové číslo do CLAUDE.md (#87); dateUtils startOfPragueDay/startOfPragueToday (#89).
- [ ] **B6 Mrtvé ui/ + config** (#98/#104): smazat `ui/select.tsx` (nahradí NativeSelect v D), `ui/calendar.tsx` + `react-day-picker` z package.json (po grep = 0 importérů; `npm install` pro lockfile), `ui/tooltip.tsx` (po grep); smazat `tailwind.config.mjs` + zvážit `autoprefixer` z postcss.config.mjs — **build + dev smoke v témže kroku, při problému okamžitý revert**; smazat prázdný untracked `src/app/api/events-test/`.
- [ ] **B7 ⚠ `.tl-morning`/`.tl-day-alt`** (#24): PŘED smazáním re-grep — CLAUDE.md popisuje tl-day-alt jako používaný (pásy směn 9. 7.); pokud se používá, NEMAZAT a opravit poznámku v auditu.

**Checkpoint B:** build + suite (nový počet testů zdokumentován) · grep `tiskar` → zbývá jen role string TISKAR; grep `react-day-picker` = 0 · ručně: login TISKAR → „/" bez double-redirectu, tiskařský režim na „/" funguje (header, toggle, potvrzení tisku), TISKAR nesmí na /admin a /rezervace, jiná role na /tiskar → 404, D chip dblclick funguje, BlockEdit uloží, dev server startuje → CLAUDE.md (odstranit /tiskar poznámku, role tabulka, testy) → commit(y) → OK.

---

## Fáze C — Divergentní doménové mapy (M) — největší hodnota

Vědomé změny: doplněná pole v payloadech (#2), sjednocení HTTP statusů (výčet v C2), správnější render admin auditu, půlnoční fix „Dnes" v expedici (#57).

- [ ] **C1 blockToCreatePayload (#2) — priorita etapy.** Create `src/lib/blockPayload.ts`: explicitní výčet VŠECH polí (superset — queue baseBody ř. 2348 je dnes nejúplnější; přidat pantoneRequiredDate/pantoneOk/pantoneRequired, materialInStock, materialNote, které undo/paste ztrácejí) + `opts` (locked u paste, machine/startTime/printMinutes overrides). PŘED implementací přečíst whitelist POST `/api/blocks` — helper nesmí posílat pole, které server odmítne. Nasadit do 5 cest PlannerPage po jedné: undo single ~1705, undo multi ~1800, paste ~2581, group paste ~2725, queue ~2348.
  **Testy `src/lib/blockPayload.test.ts`:** (1) field-inventory — fixture blok se všemi poli na rozlišitelných non-default hodnotách → deepEqual proti explicitnímu payloadu; (2) exportovaný `EXPECTED_PAYLOAD_KEYS` + assert `Object.keys` — nové pole Blocku se přidává vědomě, nikdy nemizí tiše; (3) opts varianty undo/paste/group/queue — vědomé rozdíly pinovat.
- [ ] **C2 Kanonický errorStatus** (#80): do `src/lib/errors.ts` (VALIDATION_ERROR→400, UNAUTHORIZED→401, FORBIDDEN→403, NOT_FOUND→404, CONFLICT/OVERLAP→409, SCHEDULE_VIOLATION→422…), + test; nahradit kopie v machine-week-shifts, blocks/reflow, blocks/[id]/reflow, me/preferences, notes 2×, shift-assignments. Vědomá sjednocení VYJMENOVAT v commitu: SCHEDULE_VIOLATION 500→422 (machine-week-shifts), VALIDATION_ERROR 500→400 (reflow), NOT_FOUND 400→404 (shift-assignments); před tím grep klientů na větvení podle `res.status` u dotčených endpointů.
- [ ] **C3 requireRole — řízený rozsah** (#81): helper v `src/lib/auth.ts` (čisté jádro testovatelné bez DB, + test) + `UNAUTHORIZED` do AppErrorCode; adopce JEN v ~7 routes otevřených kvůli C2 + pravidlo do CLAUDE.md „nové routes přes requireRole". Plošný rollout mimo etapu.
- [ ] **C4 Admin audit → lib/auditFormatters** (#42): smazat lokální AUDIT_FIELD_LABELS + fmtVal (AuditLogPanel:18), importovat FIELD_LABELS + fmtAuditVal; PRAGUE_TIME_FMT → formatPragueTime. Ověřit vizuální paritu s InfoPanel na stejném řádku (materialInStock, AUTO_SHIFT span).
- [ ] **C5 blockStyles — zrušit zrcadla** (#14, po B1 čistě mechanické): Create `src/lib/blockStyles.ts` — BLOCK_STYLES + getBlockStyleKey + tint přesun 1:1 z TimelineGrid (~406–590); TimelineGrid importuje; blockShades.ts `shadeBucket` odvodit z importu místo zrcadlení. **Nulová vizuální změna bloků povinná** (blockShades.test.ts pinuje + proklik).
- [ ] **C6 dateUtils adopce:** ExpediceTimeline getTodayKey → todayPragueDateStr (#57 — fix půlnočního okna); jobPresets lokální date helpery → dateUtils (#84, testy pinují); blocks/route.ts:288 inline formát → formatPrague* (#88); ReportView formattery (#76); formatDateCs 3× expedice → sdílené (#59); ReportView TYPE_LABELS → plannerTypes (#78); SLOT_MS 5 kopií → 1 export (#90).
- [ ] **C7 machines adopce** (#25/#46/#77): `MACHINE_LABELS` přidat do `src/lib/machines.ts`; importovat v TimelineGrid:74, MachineWorkHoursWeek:34, ReportDashboard (3 vzory), ShiftRoster, DtpPanel; labely 1:1.
- [ ] **C8 (volitelné)** `legacyPrintMinutesFromSpan` helper pro 3 kopie formule (#86; testy printTime/overlapResolver/printTimeClient pinují).

**Checkpoint C:** build + suite (nové testy blockPayload/errors/auth; počet do CLAUDE.md) · **ruční scénář Pantone/SKLADEM:** blok s Pantone + SKLADEM + materialNote → Delete → Ctrl+Z → v BlockEdit všechna pole zachována; totéž Ctrl+C/V a group paste; queue drop regresně · admin Audit vs. planner Aktivita stejný řádek · error smoke (neplatný vstup → 400/422, ne 500) · bloky vizuálně identické · expedice „Dnes" → commit `refactor: jeden zdroj pravdy — blockPayload, errorStatus, requireRole, formattery (audit fáze C)` → OK.

---

## Fáze D — Sdílené UI stavební kameny (M–L)

Viditelné změny jen: hlavičky Expedice/Reportů (ModuleHeader) a kanonizace rozměrů selectů — ukázat u checkpointu.

- [ ] **D1 zLayers** (#21/#95): Create `src/lib/zLayers.ts` — pojmenované konstanty = **přesně dnešní hodnoty** (BADGE 3–4 < DRAG 5–20 < PASTE_MARKER 25 < STICKY/HANDLES 30–31 < HOVER_CARD 200 < NOTE_POPOVER 400 < CONTEXT_MENU 500 < DATEPICKER/TOOLTIP 9998–9999 < CONFIRM 10000) + mini test monotonie. Mechanická náhrada: TimelineGrid (31), PlannerPage, DatePickerField, ToastContainer, AdminDashboard, ShiftEdgeHandles. Mapovací tabulka literál→konstanta do commit message; po náhradě grep `zIndex: [0-9]` na zbytky. Sjednocování hodnot až vědomě u D2.
- [ ] **D2 ConfirmDialog** (#3/#34/#48/#64): Create `src/components/ConfirmDialog.tsx` — tokeny, zIndex ze zLayers, Esc + click-outside + focus na potvrzení, uvnitř ui/Button (dialogy je už používají). Jádro: **oba delete dialogy PlannerPage (2944–3012 komplet pryč vč. A5 swapů)**. Vlna 2 (volitelná): admin window.confirm (#48); expedice #64 jen jako inline variantu — **NEpřepínat expedici na modal** (změna UX).
- [ ] **D3 NativeSelect** (#4/#32/#93): Create `src/components/NativeSelect.tsx` (named export; do src/components/, NE ui/ — shadcn nerozšiřujeme) — wrapper div + nativní select + jeden chevron SVG + tokeny; kanonizovat rozměr (výška 32 / radius 10), odchylka přes prop. Nasazení po souborech s proklikem — ověřená inventura **26 míst / 8 souborů**: PlannerPage 11 (builder 7 + ShutdownManager 305/317/414/424), PlanningForm 6 (215–395), BlockEdit 3 (662/889/1139), ShiftHoursPopover 2 (155/167), DtpPanel 1 (371), DtpDataPopover 1 (88), JobPresetEditor 1 (54). Jádro (odblokuje E): PlannerPage + ShutdownManager + BlockEdit; zbytek vyřaditelný.
- [ ] **D4 PrimaryCta** (#10/#65): Create `src/components/PrimaryCta.tsx` — var(--brand)/var(--brand-contrast), disabled přes color-mix; nasadit: „Naplánovat sérii" ~4142, „+ Přidat do fronty" ~4169, login CTA (nahradí A6 swap).
- [ ] **D5 ModuleHeader** (#60/#102): Create `src/components/ModuleHeader.tsx` — vzor RezervacePage:226–275 (sticky, výška 52, var(--surface), back-link → název → spacer → user badge → ThemeToggle → Odhlásit; sjednotit duplikovaný handleLogout #68). Nasadit: Expedice, Reporty; Rezervace volitelně. PlannerHeader NE (planner-specifický, fáze E). **Screenshot pro Vojtu** — jediná viditelně nová věc etapy.
- [ ] **D6 uiStyles** (#43): Create `src/lib/uiStyles.ts` — btnPrimary/btnSecondary/btnDanger/btnAddAccent/inputStyle/FONT_STACK z AdminDashboard:105–164; adopce ve 4 admin souborech (divergence paddingu sjednotit vědomě). Expedice/Rezervace průběžně mimo etapu.
- [ ] **D7 CLAUDE.md konvence:** sekce „Design tokens a vizuální konvence" — kanonické tokeny, z-škála, zákaz #hex/rgba literálů mimo globals.css, font stupnice, kdy ui/ vs uiStyles vs PrimaryCta/NativeSelect/ConfirmDialog/ModuleHeader.

**Checkpoint D:** build + suite · v OBOU theme: Delete + hromadné mazání (Esc, klik mimo, focus), proklik všech nasazených selectů (hodnoty se ukládají, šířky sedí), CTA disabled/enabled v light, login, hlavičky Expedice/Reporty (toggle + odhlásit), z-vrstvení smoke (context menu × tooltip × hover card × datepicker × ConfirmDialog) → commit `feat: sdílené UI kameny — zLayers, ConfirmDialog, NativeSelect, PrimaryCta, ModuleHeader, uiStyles (audit fáze D)` → OK.

---

## Fáze E — Dekompozice velkých souborů (L; 2 pod-checkpointy)

Čisté přesuny bez změny chování; **každá extrakce = samostatný commit** s build + testy. Pořadí od nejbezpečnější. Vědomé mikro-opravy jen: #30 module-scope fix, #15 title tooltip.

- [ ] **E1 PlannerPage (4 446 → ~2 400–2 600 ř.):** (i) ShutdownManager + MachinePicker + ResizeHandle → `src/components/` (~310 ř., po D už s NativeSelect) (#5); (ii) JobBuilderPanel → `src/components/planner/JobBuilderPanel.tsx` + `src/hooks/useJobBuilder.ts` (~1 200 ř.; extrakce 1:1 se zachováním useState; sloučení draftu #11 jen volitelně potom) (#6); (iii) `src/hooks/useBlockSync.ts` (~215 ř., region 994–1208, SSE invarianty + editingBlockIdsRef) (#7) — **nejcitlivější přesun, lze odložit**; (iv) volitelně useKeyboardShortcuts (#12) + PlannerHeader (#8).
  **Checkpoint E1:** build + testy + plný proklik planneru → commit(y) → OK.
- [ ] **E2 TimelineGrid + BlockEdit + AdminDashboard:** (i) DateChipRow → `src/components/planner/DateChipRow.tsx` — sjednotit 3 kopie (~230 ř.), vrátit chybějící title tooltip (#15); (ii) BlockCard + DateBadge/MiniChip/ProductionChips/InlineDatePicker → `src/components/planner/` (#17; blockStyles už z C5, zIndexy už z D1); (iii) BlockEdit: StatusSelect/SectionLabel/ColLabel na module scope (#30 — vždy) + sekce ven (#29); (iv) AdminDashboard per-tab komponenty (#44 — nezávislé, snadno odložitelné); (v) useTimelineDrag hook — **kandidát na škrt č. 1** (drag = core interakce).
  **Checkpoint E2:** build + testy + proklik editace bloku, admin tabů, D/M/E chipů (vč. dblclick) → commit(y) → OK.

---

## Závěr etapy

- CLAUDE.md konzistenční sweep: nové soubory/hooky, řádkové počty, smazaný /tiskar (role tabulka), počty testů, sekce konvencí.
- Aktualizace paměti (co hotovo; follow-up backlog níže).

## Verifikace etapy (celková)

1. `npm run build` — 0 chyb; 2. celá suite zelená (371 − smazané + nové: blockPayload, errorStatus, requireRole, zLayers); 3. regresní proklik v OBOU theme: planner (drag/resize/split/copy-paste/undo/lasso/queue/builder/série/zámek/potvrzení tisku/SSE druhé okno), rezervace (založení → protinávrh → naplánování), expedice, admin (všechny taby), /reporty, /report/daily, login všech rolí (TISKAR → „/"); 4. `npm run lint` — žádné nové warningy.

## Rizika (souhrn)

- **C1 payload:** mění chování undo/paste vědomě (přenáší víc polí) — tripwire testy + server whitelist přečíst předem + ruční E2E scénář. Helper stavět jako superset queue cesty, ne průnik.
- **B1 middleware = auth vrstva:** měnit jen dva /tiskar segmenty; TISKAR blokace /admin a /rezervace zůstává doslova; manuální test TISKAR účtem. Bookmarky tiskařů na /tiskar → 404 (akceptované, login už tam neposílá — zmínit provozu).
- **B6 tailwind.config/autoprefixer:** build + dev smoke v témže kroku; při problému okamžitý revert.
- **D3 NativeSelect 26 míst:** DOM struktura 1:1 dnešní vzor; po souborech; 2px kanonizace rozměrů odsouhlasit u checkpointu.
- **E:** největší regresní plocha — jedna extrakce = jeden commit; žádné změny signatur; plný regresní checklist; nespouštět souběžně s paralelní prací.

## Škrty, kdyby etapa přetekla

Vždy dokončit: A + B + C1. Dále držet: C2, C4–C7, D2+D3 jádro. Škrtat v pořadí: E2(v) drag hook → E1(iv) → E4/E3(ii) → E1(iii) useBlockSync → D3 zbytek (PlanningForm/DtpPanel/…) → D2 vlna 2 → D5 Rezervace → C8 → A10.

## Vědomě MIMO etapu (follow-up backlog)

Plný requireRole rollout (41 routes); uiStyles adopce Expedice/Rezervace; bridge vrstva slate-* (#96); sjednocení DatePickerField/InlineDatePicker (#9/#22/#99); denní report vstup z UI (#74); builder draft object (#11); 4 zbylé díry auditu (API mutační vrstva, SSE infrastruktura, serverové reportMetrics, cross-cut error/loading stavů).
