# Plánovací aplikace — Projektová dokumentace

> **Jak pracovat s tímto souborem:**
> - Tento soubor je živá dokumentace projektu. Neupravuj ho ručně přímo v Cursoru.
> - Změny a doplnění vždy konzultuj s Claude (claude.ai), který zajistí konzistenci celého dokumentu.
> - V Cursoru ho používej pouze ke čtení — odkazuj na něj přes `@DOKUMENTACE.md`.
> - Po každé úpravě přepiš soubor novou verzí od Claude.

---

## Přehled projektu

Webová aplikace pro plánování výroby na strojích XL 105 a XL 106. Umožňuje plánovat zakázky, rezervace a údržbu na časové ose, spravovat termíny a řídit přístupová práva různých oddělení.

**Stack:** Next.js + React + TypeScript + Tailwind + Prisma + MySQL

---

## Stav implementace

| Etapa | Název | Stav |
|-------|-------|------|
| 1 | Skeleton a běh aplikace | ⬜ Nezačato |
| 2 | Timeline render (grid + scroll + filtry) | ⬜ Nezačato |
| 3 | Drag & drop + resize + rozdělení | ⬜ Nezačato |
| 4 | Směny + svátky + background | ⬜ Nezačato |
| 5 | Stavy, šednutí, overdue | ⬜ Nezačato |
| 6 | Opakování | ⬜ Nezačato |
| 7 | Hromadné posuny + zámečky | ⬜ Nezačato |
| 8 | Uživatelé, role a přihlašování | ⬜ Nezačato |

> Stav měň na: ⬜ Nezačato / 🔄 Rozpracováno / ✅ Hotovo / 🐛 Chyba

---

## Funkcionalita k doplnění / nápady

> Sem si piš věci, které chceš časem přidat. Když bude seznam delší, přineseme ho do Claude a zapracujeme do dokumentace.

- [ ] ...

---

## Hlavní layout

- **Split view:** vlevo plánovací timeline, vpravo builder formulář
- **Nahoře:** globální filtr (číslo zakázky + skok na datum)
- **Plán:** až 1 rok dopředu

---

## Timeline

- **Stroje na ose X:** XL 105, XL 106
- **Čas + datum na ose Y**
- **Grid:** 30 minut
- **Scroll:** minimálně 30 dní dopředu, ideálně 1 rok; sticky header
- Drag & drop + resize + snap na 30 min

---

## Bloky (zakázky / rezervace / údržba)

Každý blok obsahuje:
- Číslo zakázky
- Stroj (XL 105 nebo XL 106)
- Začátek a konec (start / end)
- Typ: `zakázka` / `rezervace` / `údržba`
- Termíny: DATA, Materiál, Expedice
- Nastavení opakování
- Zámek (lock/pin)

---

## Builder (pravý panel)

Formulář pro vytvoření nového bloku. Pole:
- Číslo zakázky
- Stroj (výběr XL 105 / XL 106)
- Délka trvání (intervaly po 30 min)
- Typ bloku (zakázka / rezervace / údržba)
- Termíny: DATA, Materiál, Expedice
- Po potvrzení se blok okamžitě zobrazí na timeline

---

## Etapa 1 — Skeleton a běh aplikace

- Next.js + React + TypeScript + Tailwind + Prisma + MySQL
- Strom projektu + všechny soubory nutné pro spuštění
- Seed s mock daty
- Jedna stránka s layoutem: vlevo placeholder timeline (bez DnD), vpravo builder formulář
- Builder ukládá blok do DB a na timeline se hned zobrazí
- API: CRUD pro bloky + termíny DATA / Materiál / Expedice
- README se spuštěním

---

## Etapa 2 — Timeline render (grid + scroll + filtry)

- Bloky renderovány ve 2 sloupcích (XL 105, XL 106) na ose Y (čas + datum)
- Grid 30 minut
- Scroll na dny (min. 30 dní dopředu, ideálně 1 rok), sticky header
- Horní filtr: číslo zakázky + skok na datum
- Klik na blok otevře detail (side panel / modal) s termíny a nastavením opakování

---

## Etapa 3 — Drag & drop + resize + rozdělení (split)

- Drag & drop přesuny bloků mezi stroji i v čase
- Resize start/end se snapem na 30 min
- Nástroj „Rozdělení zakázky":
  - U dlouhého bloku lze provést „říznutí" (split) v zvoleném čase → vzniknou 2 bloky se zachováním metadat
  - Split nesmí vytvořit část kratší než 30 min
  - UX: kontextové menu „Rozdělit", nebo klávesa S + klik na čas v bloku, nebo ikonka nůž
- Kolize: zabránit, nebo vizuální konflikt s potvrzením

---

## Etapa 4 — Směny + svátky + background

**XL 106:**
- 3 směny
- Nepracuje se pouze o víkendech

**XL 105:**
- 2 směny, bez noční
- Ranní začíná v 06:00

- Nepracovní čas zvýrazněn na pozadí (jako víkendy v Excelu)
- Státní svátky ČR zvýrazněny stejně jako víkendy (statický seznam nebo knihovna, více let dopředu)

---

## Etapa 5 — Stavy, šednutí, overdue

**Barvy bloků:**
- 🔵 Modrá → zakázka OK
- 🟣 Fialová → rezervace
- 🔴 Červená → údržba / oprava
- ⚫ Šedá → blok, který už měl být hotový (end < now a není údržba)

**Termíny v detailu bloku:**
- DATA, Materiál, Expedice — zadání ve formátu `1.1` (interně ukládáno jako datum s rokem)
- DATA a Materiál mají checkbox OK
- Pokud dnešní datum > termín a checkbox není OK → červené zvýraznění (overdue)

---

## Etapa 6 — Opakování

- Opakování operace: každý den / každý týden / každý měsíc
- Nastavitelné v detailu zakázky jedním zaškrtnutím (checkbox/radio)
- Série: vytvoření instancí dopředu (6–12 měsíců) nebo generování „on the fly"
- Při editaci výběr: upravit jen tuto instanci, nebo celou sérii

---

## Etapa 7 — Hromadné posuny + zámečky bloků

**Multi-select:**
- Tažením myši výběrový obdélník (lasso/box select) označí více bloků
- Celou skupinu lze posunout v čase (drag) se snapem na 30 min

**Posun navazujících bloků (push/shift chain):**
- Při vložení nové zakázky nebo prodloužení bloku a vzniku kolize nabídne akci: „Posunout všechny následující navazující zakázky"
- Posun respektuje směny a nepracovní časy (posun na nejbližší pracovní slot)

**Zámeček (lock/pin):**
- Zamknutý blok se nesmí pohnout při hromadném posunu ani při posunu navazujících bloků
- Pokud je zamknutý blok v cestě:
  - Systém zastaví posun a zobrazí hlášku „Nelze posunout přes zamknutý blok"
  - Nebo nabídne alternativu (posun jen do okamžiku před lockem)
- UX: ikona zámku přímo na bloku + přepínač v detailu

---

## Etapa 8 — Uživatelé, role a přihlašování

### Přihlašování
- Každý uživatel má vlastní přihlašovací jméno a heslo
- Hesla jsou bezpečně uložena v databázi (hashována, nikdy v plaintextu)
- Přihlašovací obrazovka při startu aplikace
- Uživatelé jsou předem nadefinovaní v databázi (seed) — žádná veřejná registrace

### Správa uživatelů
- Admin spravuje uživatelské účty a celý systém
- Uživatelé jsou zakládáni přes seed nebo admin rozhraní
- Plánovač nemá přístup ke správě uživatelů

### Role a oprávnění

| Role | Popis | Co může dělat |
|------|-------|---------------|
| **Admin** | Správce systému | Vše — včetně správy uživatelů, jejich zakládání, editace a mazání; má přístup ke všem funkcím aplikace |
| **Plánovač** | Plánování výroby | Vytváření, editace, mazání bloků, správa termínů DATA / Materiál / Expedice, drag & drop, split, zámečky, hromadné posuny |
| **MTZ** | Oddělení materiálu | Vidí celou timeline, edituje pouze kolonku **Materiál** (datum + checkbox OK) |
| **DTP** | Oddělení dat | Vidí celou timeline, edituje pouze kolonku **DATA** (datum + checkbox OK) |
| **Viewer** | Jen čtení | Vidí celou timeline, nemůže nic editovat |

### Detailní matice práv

| Akce | Admin | Plánovač | MTZ | DTP | Viewer |
|------|-------|----------|-----|-----|--------|
| Vidět timeline | ✅ | ✅ | ✅ | ✅ | ✅ |
| Vytvořit / smazat blok | ✅ | ✅ | ❌ | ❌ | ❌ |
| Přesunout / resize blok | ✅ | ✅ | ❌ | ❌ | ❌ |
| Rozdělit blok (split) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Editovat termín DATA | ✅ | ✅ | ❌ | ✅ | ❌ |
| Editovat termín Materiál | ✅ | ✅ | ✅ | ❌ | ❌ |
| Editovat termín Expedice | ✅ | ✅ | ❌ | ❌ | ❌ |
| Zamknout / odemknout blok | ✅ | ✅ | ❌ | ❌ | ❌ |
| Hromadné posuny | ✅ | ✅ | ❌ | ❌ | ❌ |
| Správa uživatelů | ✅ | ❌ | ❌ | ❌ | ❌ |

### UX přihlašování
- Vpravo nahoře zobrazeno jméno přihlášeného uživatele a jeho role
- Tlačítko odhlášení
- Prvky UI, které uživatel nemá právo používat, jsou skryté nebo zašedlé (ne jen zamčené)

---

*Dokument naposledy aktualizován: 2025 — verze V
