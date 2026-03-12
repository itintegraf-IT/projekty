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
| Resize bloku — dolní limit 30 min | post-9 |
| Lasso selection — hint (floating pill, zmizí po prvním použití) | post-9 |
| Entrance animace bloků (scale + opacity, 220ms spring) | post-9 |
| Glassmorphism sticky header (blur + opacita reaguje na scroll) | post-9 |
| Active/pressed stav tlačítek (scale 0.96, brightness) | post-9 |
| BlockCard typografie — weight hierarchy (orderNumber 700, desc opacity 0.58) | post-9 |

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

## Grafické / iOS pocit

### 🟢 Aside scroll — edge fade
Scrollovatelný obsah aside nemá fade u horní/dolní hrany.
iOS pattern: gradient mask `linear-gradient(transparent, #111318)` na spodní hraně.
Implementace: `mask-image` CSS na scroll kontejneru.

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

### ✅ MySQL — hotovo (2026-03)
Projekt běží na MySQL (IGvyroba, localhost, root/mysql). Viz `CLAUDE.md` a `DOKUMENTACE.md` → Databáze MySQL.
Pro produkční nasazení: `CLAUDE.md` sekce "Přechod na produkci — MySQL".

---

*Poslední aktualizace: 2026-03 (přechod na MySQL)*
