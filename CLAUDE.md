# CLAUDE.md — Integraf Výrobní plán

Tento soubor čte Claude Code automaticky. Udržuj ho aktuální po každé etapě.

---

## O projektu

Interní webová aplikace pro plánování výroby na strojích XL 105 a XL 106.
Umožňuje plánovat zakázky, rezervace a údržbu na časové ose.

**Stack:** Next.js + React + TypeScript + Tailwind CSS v4 + Prisma 5 + SQLite (dev) → MySQL (produkce)

---

## Stav etap

| Etapa | Název | Stav |
|-------|-------|------|
| 1 | Skeleton, databáze, API, builder formulář | ✅ Hotovo |
| 2 | Timeline render (grid + scroll + filtry) | ⬜ Nezačato |
| 3 | Drag & drop + resize + rozdělení | ⬜ Nezačato |
| 4 | Směny + svátky + background | ⬜ Nezačato |
| 5 | Stavy, šednutí, overdue | ⬜ Nezačato |
| 6 | Opakování | ⬜ Nezačato |
| 7 | Hromadné posuny + zámečky | ⬜ Nezačato |
| 8 | Uživatelé, role a přihlašování | ⬜ Nezačato |

---

## Spuštění projektu

```bash
npm run dev        # dev server → http://localhost:3000
npx prisma studio  # prohlížeč databáze → http://localhost:5555
```

Po čistém klonu nebo smazání databáze:
```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
```

---

## Důležitá rozhodnutí

- **Databáze:** MySQL (IT specialista zná MySQL). Dev = SQLite (zero-config).
- **Prisma verze:** `^5` — záměrně ne `latest` (v7 má breaking changes s novým config systémem)
- **Enumy:** uloženy jako string (SQLite kompatibilita), při přechodu na MySQL Prisma vytvoří ENUM sloupce automaticky
- **Tailwind:** verze 4, používá `@import "tailwindcss"` (ne `@tailwind base`)

---

## Klíčové soubory

| Soubor | Účel |
|--------|------|
| `prisma/schema.prisma` | DB schema — Block + User modely pro všech 8 etap |
| `src/lib/prisma.ts` | Prisma singleton klient |
| `src/app/page.tsx` | Server Component — načítá bloky z DB |
| `src/app/_components/PlannerPage.tsx` | Client Component — builder formulář + seznam bloků |
| `src/app/api/blocks/route.ts` | GET all + POST |
| `src/app/api/blocks/[id]/route.ts` | GET + PUT + DELETE |
| `DOKUMENTACE.md` | Plná projektová dokumentace (neupravuj ručně) |

---

## Komunikace

- Vždy komunikuj česky
- Uživatel nerozumí databázím — vysvětlovat jednoduše
- Před větší implementací vždy použij EnterPlanMode
