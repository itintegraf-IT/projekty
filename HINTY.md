# Hinty pro zlepšení — Integraf Výrobní plán

Tento soubor neslouží jako dokumentace. Je to seznam věcí, které by aplikaci zlepšily,
ale zatím nebyly implementovány. Označeno prioritami a přibližnou náročností.

---

## Hotovo (reference)

| Věc | Kdy |
|-----|-----|
| Undo/Redo (Ctrl+Z / Ctrl+Shift+Z) — pohyb a resize bloků | Etapa post-9 |
| Toast/notification systém — API chyby viditelné uživateli | Etapa post-9 |
| Keyboard shortcuts (Del, Ctrl+C/X/V) | Etapa 8 |
| Státní svátky — ponechat hardcoded, extra dny řeší CompanyDay | Rozhodnutí |

---

## Funkční

### 🔴 Etapa 10 — Audit log
Naplánovaný detailně v `CLAUDE.md`. Loguje: CREATE/DELETE bloku, změna DATA/MATERIÁL stavu, toggle ok, změna expedice.
**Neloguje:** drag & drop, resize, popis, barvy, lak, zámek.
Model `AuditLog { id, blockId (bez FK), userId, username, action, field?, oldValue?, newValue?, createdAt }`.
UI: tabulka v admin dashboardu + mini-historie v BlockEdit.
Routes: `GET /api/audit?limit=50` (ADMIN) + `GET /api/blocks/[id]/audit`.

---

### 🟡 Export plánu
Možnost stáhnout přehled zakázek nebo plán na daný týden.
- **Jednodušší:** CSV export bloků (filtrovatelný dle stroje / období)
- **Náročnější:** PDF/tisk — týdenní pohled, formátovaný pro tisk A4

---

### 🟡 Duplikace bloku z fronty
Aktuálně musí uživatel znovu vyplnit celý builder, i když zakázka je stejná (jen jiný termín).
Přidat tlačítko "Duplikovat" na kartičkách fronty → klonuje položku se stejnými parametry.

---

### 🟡 Rozšířený filtr
Aktuální filtr je jen textový (číslo zakázky). Přidat:
- Filtr dle stroje (XL_105 / XL_106 / oba)
- Filtr dle stavu DATA nebo MATERIÁL (ok / not-ok / všechny)
- Filtr dle data (od–do)
Lze jako collapse panel pod search inputem.

---

### 🟢 Resize bloku — dolní limit
Blok lze zmenšit na 0 px (méně než 30 min). Přidat minimální výšku = 1 slot = 30 min.
Snap logika už existuje (`minEnd = originalStart + SLOT_MS`), ale vizuálně to nejde.

---

## UX

### 🟡 Lasso selection — žádný hint
Uživatel nemá jak zjistit, že Alt+drag vybere více bloků.
Přidat: tooltip nebo jeden řádek nápovědy v záhlaví timeline (skrytý dokud nebyl lasso nikdy použit).
Alternativa: onboarding tooltip při prvním přihlášení.

---

### 🟡 Empty state na timeline
Když nejsou žádné bloky (nová instalace, prázdný filtr), grid je prázdný bez textu.
Přidat: centered text "Žádné bloky — přetáhni zakázku z fronty" s ikonou šipky doleva.

---

### 🟢 Filtrem skryté bloky — vizuální hint
Když je filtrText aktivní a skrývá většinu bloků, není jasné kolik bloků je skryto.
Přidat počítadlo: "Zobrazeno 3 z 47 bloků" vedle search inputu.

---

## Grafické / iOS pocit

### 🟡 Entrance animace bloků
Při přidání bloku z fronty na timeline se blok "objeví" bez animace.
Přidat: `scale(0.9) → scale(1)` + `opacity 0 → 1`, 150 ms ease-out.
Stejně tak při delete: fade-out + slight scale-down před odebráním z DOM (200 ms).

---

### 🟡 Glassmorphism sticky header
Při vertikálním scrollu timeline se header ztratí do pozadí.
iOS pattern: při scrollu header získá `backdrop-filter: blur(16px)` + `background: rgba(10,10,15,0.8)`.
Aktuálně header má `backdrop-blur` ale jen staticky. Přidat dynamické zesílení při scroll > 0.

---

### 🟡 Active/pressed stav tlačítek
Tlačítka nemají `active` stav — na klik nereagují vizuálně.
iOS standard: při stisku `scale(0.97)` + mírné ztmavení, 80 ms.
Týká se: všechna tlačítka v aside, header buttony, queue kartičky.

---

### 🟢 Aside scroll — edge fade
Scrollovatelný obsah aside nemá fade u horní/dolní hrany.
iOS pattern: gradient mask `linear-gradient(transparent, #111318)` na spodní hraně.
Implementace: `mask-image` CSS na scroll kontejneru.

---

### 🟢 BlockCard typografie — weight hierarchy
Číslo zakázky a popis mají podobnou vizuální váhu.
Návrh: číslo zakázky `font-weight: 700`, popis `font-weight: 400, opacity: 0.7`.
Malá změna, velký vizuální efekt.

---

### 🟢 Role badge — jemnější design
Badge role v headeru (ADMIN, PLANOVAT…) je plochý chip.
Vylepšit: `border: 1px solid rgba(255,255,255,0.1)` + very subtle background per role (admin=žlutá, planovat=modrá…).

---

### 🟢 Contextual menu redesign
Context menu (pravý klik → rozdělit blok) má základní styling.
iOS pattern: tmavé `#2c2c2e` menu s `backdrop-blur`, zaoblené 12px, jemné separator linky.

---

## Performance

### 🟢 React.memo na BlockCard
BlockCard se re-renderuje při každém drag přes state, i když se blok sám nezměnil.
`React.memo(BlockCard)` + `useCallback` na inline handlery by eliminovalo většinu zbytečných re-renderů.
Dopad je znatelný až při 100+ blocích.

---

### 🟢 useMemo pro filtrované bloky
`filterText` změní opacity všech bloků přes state update → full re-render.
`useMemo(() => filteredIds, [blocks, filterText])` by omezilo rozsah.

---

### 🔴 Virtualizace (budoucnost)
Při 200+ blocích začne timeline lagovat — všechny bloky jsou v DOM najednou.
Řešení: `react-window` nebo `@tanstack/virtual` pro virtualizovaný scroll.
**Zatím nepotřebné** — při běžném provozu (desítky bloků) výkon stačí.

---

## Infrastruktura

### 🟡 Přechod na MySQL (produkce)
Detailní postup je v `CLAUDE.md` sekce "Přechod na produkci".
Klíčové: změnit `provider` v schema, vygenerovat nové migrace, použít `prisma migrate deploy`.
Spouštět pouze `npm run prisma:bootstrap` (ne seed) pro první inicializaci.

---

*Poslední aktualizace: po etapě post-9 (undo/redo + toast)*
