# AGENT.md — UI/UX Kritická Revize a Implementační Roadmapa

Tento soubor slouží jako trvalý plán pro postupné zlepšení aplikace po stránce UI/UX, přístupnosti, robustnosti a zavedení light/dark režimu.

---

## Cíl

Z aktuální funkčně silné aplikace vytvořit:

- konzistentní a škálovatelný design systém,
- UI použitelné i na menších displejích,
- přístupné ovládání (klávesnice, čitelnost, stavy),
- předvídatelný feedback při chybách,
- stabilní light/dark theme bez chaosu v barvách.

---

## Stav realizace (aktualizováno 11. 3. 2026)

| Etapa | Stav | Poznámka |
|------|------|----------|
| Etapa 0 — Audit a baseline | ✅ Hotovo | Prošla kritická místa (`PlannerPage`, `TimelineGrid`, `Login`, `AdminDashboard`) a seznam problémů. |
| Etapa 1 — Theme infrastruktura | ✅ Hotovo | `next-themes`, tokeny, helper transitions, přepínač theme v headeru. |
| Etapa 2 — Migrace největších ploch | ✅ Hotovo | Hlavní plochy běží korektně v light/dark; sjednoceny CTA, headery, badge/chips a kontrastní stavy. |
| Etapa 3 — Responsivita a layout ergonomie | ⏸️ Odloženo | Záměrně přeskočeno (cíloví uživatelé jedou primárně fullscreen desktop). |
| Etapa 4 — Přístupnost (a11y) | ⏸️ Odloženo | Záměrně odloženo před dokončením Etapy 5. |
| Etapa 5 — UX feedback a error handling | ✅ Hotovo | Nahrazeny tiché `catch`, sjednocené chyby/toasty, přidány loading/disabled stavy u kritických akcí. |

### Co bylo v etapách 1–2 dokončeno navíc

- iOS-style switch pro light/dark (`☀️/🌙`) bez redundantního badge.
- Segmented `30/60/90` rozsah s jasným aktivním stavem.
- Opravený tmavý header v `BlockDetail` pro light mode.
- Deadline logika ve 3 stavech:
  - `OK` = zelená,
  - `dnes bez OK` = žlutá,
  - `po termínu bez OK` = červená.
- Sjednocené barevné akcenty DATA/MATERIÁL/EXPEDICE (tyrkysový základ) + stavová barva přebíjí základ.
- Oprava kontrastu tlačítka `Uložit změny` v `Upravit blok` (dark i light).

### Co bylo dokončeno v etapě 5 (UX feedback + error handling)

- Nahrazení tichých `catch {}` v klíčových flow (`PlannerPage`, `TimelineGrid`, login, admin/codebook API, `auth`) kombinací:
  - `console.error(...)` pro diagnostiku,
  - uživatelský feedback (`toast` / lokální error text).
- Sjednocené chybové texty pro nejdůležitější akce (uložení, přesun/resize/split, mazání, načtení číselníků).
- Přidané loading/disabled stavy do kritických potvrzovacích akcí (zejména série a editace bloku), aby se zabránilo double-submit.

---

## Aktuální slabé stránky (prioritizace)

### P0 — Kritické

1. **Theme architektura není připravená na light/dark switch**
   - App je vynuceně `dark` přes root layout.
   - Velké množství hardcoded barev v inline stylech.
   - Důsledek: změna tématu bude drahá a nekonzistentní.

2. **Responsivita a adaptace na menší viewporty**
   - Fixní šířky a desktop-first split layout.
   - Header přetížený množstvím akcí v jedné řadě.
   - Důsledek: slabá použitelnost na menších notebookách/tabletech.

### P1 — Vysoké

3. **Přístupnost (a11y)**
   - Velmi malé fonty u části prvků (8–10 px).
   - Interakce orientované primárně na myš/drag/context menu.
   - Není jednotný focus/aria standard.

4. **Chybová komunikace**
   - Některé chyby jsou potlačené (`catch {}`) bez feedbacku.
   - Důsledek: uživatel neví, co se nepovedlo a proč.

### P2 — Střední

5. **Nekonzistentní stylování**
   - Mix Tailwind + inline stylů + manuální hover/focus mutace.
   - Vysoké riziko vizuální divergence.

6. **Duplicitní datové načítání a UI logika**
   - Codebook fetch řešen na více místech stejným způsobem.
   - Důsledek: vyšší maintenance náklady.

7. **Dokumentační dluh**
   - README obsahuje zastaralé informace o běhu projektu.
   - Důsledek: slabší onboarding a vyšší riziko chyb při nasazení.

---

## Etapový plán

> Doporučení: postupovat striktně po etapách. Neskákat na vizuální polishing dřív, než je hotová theme infrastruktura (Etapa 1).

---

## Etapa 0 — Audit a baseline

### Cíl
Získat kontrolní seznam a metriku, od které se bude měřit zlepšení.

### Kroky

1. Sepsat „kritická UI místa“: `PlannerPage`, `TimelineGrid`, `Login`, `AdminDashboard`.
2. U každého místa označit:
   - hardcoded barvy,
   - fixní rozměry,
   - interakce bez klávesnicové alternativy,
   - chyby bez user feedbacku.
3. Udělat screenshot baseline (desktop + menší šířka).

### Výstup

- krátký interní checklist (co se bude migrovat první),
- vizuální baseline pro porovnání po každé etapě.

### Definition of Done

- existuje seznam prioritních komponent a problémů,
- existuje baseline screenshot set.

---

## Etapa 1 — Theme infrastruktura (light/dark základ)

### Cíl
Připravit bezpečný základ pro theme switch bez velkého refaktoru naráz.

### Kroky

1. Přidat theme provider (`next-themes`) a odstranit natvrdo `.dark` na `<html>`.
2. Definovat skutečně odlišné tokeny pro `:root` (light) a `.dark` (dark):
   - `--bg`, `--surface`, `--surface-2`, `--text`, `--text-muted`, `--border`, `--accent`, `--danger`, `--success`, `--warning`.
3. Přidat globální helper utility třídy pro přechod barev.
4. Přidat jednoduchý přepínač theme (header).
5. Persistovat volbu theme (localStorage přes provider).

### Výstup

- funkční přepínač light/dark,
- centrální tokeny použitelné pro další etapy.

### Definition of Done

- změna theme je okamžitá a konzistentní alespoň na základních plochách,
- žádné blikání theme při načtení stránky.

---

## Etapa 2 — Migrace největších ploch na tokeny

### Cíl
Omezit hardcoded barvy tam, kde to nejvíc bolí.

### Kroky

1. Migrace barev u:
   - `PlannerPage` (shell, header, aside),
   - `TimelineGrid` (pozadí, grid, overlaye, selected stavy),
   - `Login`,
   - `AdminDashboard`.
2. Nahradit přímé hex/rgba barvy tokeny (`var(--...)`).
3. Přestat přidávat nové inline barvy; nové barvy pouze přes tokeny.

### Výstup

- hlavní UI funguje ve světlém i tmavém režimu bez zásadních vizuálních chyb.

### Definition of Done

- na hlavních stránkách není kritický kontrastní problém,
- major komponenty nepoužívají hardcoded barvy pro základní plochy/text.

---

## Etapa 3 — Responsivita a layout ergonomie

### Cíl
Zlepšit použitelnost na menších šířkách bez rozbití desktop workflow.

### Kroky

1. Header rozdělit na dvě úrovně:
   - primární akce (hledání, datum, dnes),
   - sekundární utility (undo/redo, lock, rozsah, user menu).
2. Přidat breakpoint chování:
   - část akcí přesunout do „More“ menu na menších šířkách,
   - right panel přepnout z fixního aside na overlay/drawer pod určitou šířkou.
3. Opravit fixní šířky kritických prvků (`w-40`, `width:150`, login card 380 px).
4. U `100vh` layoutu ošetřit mobilní viewport (`svh/dvh` fallback).

### Výstup

- UI je čitelné a ovladatelné i na menších noteboocích/tabletech.

### Definition of Done

- žádný horizontální overflow v hlavních view,
- všechny klíčové akce zůstávají dostupné i v užším viewportu.

---

## Etapa 4 — Přístupnost (a11y) a ovladatelnost

### Cíl
Zajistit minimální profesionální standard přístupnosti.

### Kroky

1. Zvýšit minimální velikost textu interaktivních prvků (12 px+).
2. Přidat konzistentní focus style (token-based).
3. Doplnit `aria-label` a title pro icon-only tlačítka.
4. Přidat klávesnicové alternativy ke kritickým akcím:
   - multi-select hint i bez `Alt` only workflow,
   - context menu akce dostupné i přes tlačítko v detailu.
5. Opravit custom checkbox/switch pattern tak, aby byl semanticky čitelný.

### Výstup

- aplikace je použitelná i bez myši,
- čitelnost klíčových prvků je výrazně lepší.

### Definition of Done

- klávesnicí projdeš hlavní flow bez dead-endu,
- icon-only prvky mají jasné popisky.

---

## Etapa 5 — UX feedback a error handling

### Cíl
Uživatel musí vždy vědět, co se stalo.

### Kroky

1. Nahradit tiché `catch {}` za:
   - toast pro uživatele,
   - `console.error` pro diagnostiku.
2. Sjednotit texty chybových hlášek (krátké, akční, česky).
3. U kritických akcí doplnit loading/disabled stavy:
   - editace bloku,
   - split/copy/paste,
   - admin user management.
4. Přidat jednoduché retry patterny tam, kde dává smysl.

### Výstup

- předvídatelné chování při failu API.

### Definition of Done

- žádná významná uživatelská akce nekončí bez feedbacku.

---

## Etapa 6 — Konsolidace komponent a datové logiky

### Cíl
Snížit technický dluh a připravit základ pro další funkce.

### Kroky

1. Zavést hook `useCodebooks()` a odstranit duplicity fetch logiky.
2. Vytvořit sdílené style helpers pro opakované UI patterny:
   - section label,
   - select wrapper,
   - inline chip/button variants.
3. Omezit přímé mutace stylů v event handlerech (`onMouseEnter` měnící style objekt).

### Výstup

- menší duplicita, jednodušší maintenance.

### Definition of Done

- codebook loading je centralizovaný,
- opakované UI patterny nejsou kopírované na více místech.

---

## Etapa 7 — Login + Admin polish

### Cíl
Dorovnat kvalitu vedle hlavního planneru.

### Kroky

1. Login:
   - responsivní card (max-width + fluid padding),
   - token-based barvy,
   - konzistentní focus/error states.
2. Admin:
   - lepší typografická hierarchie,
   - sjednocené komponenty tlačítek/inputs,
   - mobilnější tab switch a seznamy.

### Výstup

- konzistentní look & feel napříč celou app.

### Definition of Done

- Login a Admin působí jako součást stejného design systému.

---

## Etapa 8 — QA, stabilizace a dokumentace

### Cíl
Uzavřít změny a připravit bezpečný provoz.

### Kroky

1. Otestovat klíčové scénáře v light i dark režimu:
   - create/edit/delete blok,
   - drag/drop/resize/multi-select,
   - admin users + codebook.
2. Otestovat viewporty (min. 3 šířky).
3. Opravit README (správné příkazy, port, stack realita).
4. Dopsat stručný changelog „co se změnilo“.

### Výstup

- stabilní release bez regresí v core workflow.

### Definition of Done

- hlavní flow bez kritických vizuálních a funkčních regresí,
- dokumentace odpovídá realitě projektu.

---

## Doporučené pořadí implementace (praktické)

1. Etapa 1  
2. Etapa 2  
3. Etapa 3  
4. Etapa 5  
5. Etapa 4  
6. Etapa 6  
7. Etapa 7  
8. Etapa 8

> Poznámka: Etapa 5 je schválně před Etapou 4, protože rychle zlepší důvěru v systém (feedback při chybách) s relativně nízkým rizikem.

---

## Mimo scope (zatím)

- Kompletní redesign timeline interakcí od nuly.
- Radikální změna IA (informační architektury) aplikace.
- Přepis všech inline stylů v jedné mega-iteraci (vysoké riziko regresí).

---

## Pracovní pravidlo pro další vývoj

Od této chvíle:

1. žádná nová hardcoded barva bez tokenu,
2. žádná nová klíčová akce bez user feedbacku při failu,
3. žádná nová UI feature bez ověření v obou theme režimech.
