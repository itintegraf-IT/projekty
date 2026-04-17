# DATA chip — nová logika jednoho stavu (design spec)

Datum: 2026-04-17
Autor: Vojta Ťokan + Claude

---

## Problém

Blok má 3 nezávislá pole pro DATA: `dataRequiredDate` (datum dodání), `dataStatusId`/`dataStatusLabel` (status chip), `dataOk` (boolean potvrzení). Tato pole jsou na sobě nezávislá, takže blok může mít současně datum, status chip i dataOk — výsledek je matoucí. Uživatel vidí na timeline jen jednu informaci (buď datum, nebo chip label), ale neví, co se skrývá pod tím.

Příklad: Zakázka má status "Připraveno" (dataOk=true), ale klient zavolá s chybou a avizuje nové datum. Plánovač musí ručně odškrtnout dataOk, změnit status, změnit datum — tři kroky pro jednu logickou operaci.

## Řešení

Data mají vždy právě **jeden vizuální stav** — buď zobrazují datum (kalendář), nebo chip (status label). Přechod mezi stavy je automatický.

---

## Vizuální pravidlo na timeline

| Stav DB | Co se zobrazí na chipu |
|---------|----------------------|
| `dataStatusId !== null` | Label chipu (např. "Připraveno", "K DTP") |
| `dataStatusId === null`, `dataRequiredDate` existuje | `D 15.4.` (datum s deadline barvou) |
| `dataStatusId === null`, `dataRequiredDate === null` | `D —` (prázdný) |

Dnes řídí vizuál `dataOk`. Nově řídí vizuál `dataStatusId`.

---

## Auto-derivace `dataOk`

`dataOk` zůstává v DB (žádná migrace), ale **zmizí z UI** — žádný checkbox, žádný toggle klikem. Hodnota se derivuje automaticky:

| Akce | `dataOk` výsledek |
|------|-------------------|
| `dataStatusId` nastaven (jakýkoli non-null) | `true` |
| `dataStatusId` vymazán (null) | `false` |
| `dataRequiredDate` změněn | `false` (protože chip se současně maže) |

Důvod zachování: `deadlineState()` v TimelineGrid používá `dataOk` pro výpočet deadline barvy. Auto-derivace zajistí zpětnou kompatibilitu bez refaktoru deadline logiky.

---

## Automatická provázanost polí

### Pravidlo 1: Změna data maže chip

Když uživatel změní `dataRequiredDate` (v BlockEdit nebo inline datepickeru):
- `dataStatusId` → `null`
- `dataStatusLabel` → `null`
- `dataOk` → `false`

Platí na client-side (okamžitý feedback v UI) i server-side (pojistka v API).

### Pravidlo 2: Výběr chipu nemaže datum

Když uživatel vybere status chip:
- `dataOk` → `true`
- `dataRequiredDate` **zůstává** v DB beze změny (ale na timeline se nezobrazuje — chip ho vizuálně nahradí)

Důvod: Datum může být potřeba znovu zobrazit pokud se chip vymaže.

### Pravidlo 3: Smazání chipu obnoví datum

Když uživatel smaže status (vybere "— bez statusu —"):
- `dataStatusId` → `null`
- `dataStatusLabel` → `null`
- `dataOk` → `false`
- `dataRequiredDate` zůstává → zobrazí se na timeline

---

## Interakce na timeline

| Role | Single klik na DATA chip | Double klik na DATA chip |
|------|-------------------------|-------------------------|
| ADMIN / PLANOVAT | nic | inline datepicker (beze změny oproti dnes) |
| DTP | nic | DTP popover (status dropdown, beze změny) |
| MTZ, VIEWER, TISKAR, OBCHODNIK | nic | nic |

Oproti dnes: **single klik** na DATA chip **nic nedělá** pro žádnou roli. Dnes toggleoval `dataOk` — to se odstraní, protože `dataOk` je auto-derivovaný.

---

## BlockEdit panel — změny

### Odstraněno
- Checkbox `dataOk` ("OK") pod DATE polyčkem v sekci DATA

### Zachováno
- `DatePickerField` pro `dataRequiredDate` (editovatelný ADMIN/PLANOVAT, read-only DTP)
- `StatusSelect` dropdown pro `dataStatusId` (editovatelný ADMIN/PLANOVAT/DTP)

### Nová client-side logika
- Když uživatel změní datum v DatePickerField → `setDataStatusId("")` (vymaže chip)
- Když uživatel vybere status v StatusSelect → žádná automatická akce na datum

### Save payload
- `dataOk` se v save payloadu nastaví automaticky: `dataOk: dataStatusId ? true : false`
- Uživatel ho neovlivňuje přímo

---

## API — serverová pojistka

### PUT `/api/blocks/[id]`

Po stávající roli-based filtraci přidat auto-derivaci:

```
// Porovnání: body.dataRequiredDate přichází jako string|null, existingBlock jako DateTime|null
// Porovnávat normalizovaně (ISO date string) nebo jen přítomnost změny (field je v payloadu)
if (allowed.dataRequiredDate !== undefined) {
  // Datum se změnil → vymazat chip
  allowed.dataStatusId = null;
  allowed.dataStatusLabel = null;
  allowed.dataOk = false;
}

if (allowed.dataStatusId !== undefined) {
  // Chip se nastavuje → auto-derivovat dataOk
  allowed.dataOk = allowed.dataStatusId !== null;
}
```

### POST `/api/blocks` a POST `/api/blocks/batch`

Stejná auto-derivace pro nově vytvářené / batch-updatované bloky.

---

## DTP popover — změny

Stávající `DtpDataPopover` komponenta:
- Odstraní se toggle `dataOk` (iOS switch) — dataOk se derivuje automaticky
- Zůstane jen status dropdown
- Hint text "ukládá se automaticky při zavření" zůstává
- Při uložení: `dataOk` se nastaví na `statusId !== null`

---

## Deadline barva chipu

Funkce `deadlineState()` v TimelineGrid zůstává beze změny — stále pracuje s `dataOk` a `dataRequiredDate`. Díky auto-derivaci `dataOk`:

| Vizuální stav | deadline výpočet |
|--------------|-----------------|
| Chip zobrazen (`dataStatusId` set) | `dataOk = true` → `deadlineState` vrací `"ok"` → žádné varování |
| Datum zobrazen (`dataStatusId` null) | `dataOk = false` → `deadlineState` počítá warning/danger normálně |

Barva chipu při zobrazení labelu: použije se `badgeColorMap` barva z CodebookOption (stávající logika pro status chips), ne deadline barva.

---

## Co se nemění

- Materiál, Pantone, Expedice — beze změny, zachovávají stávající logiku
- ADMIN/PLANOVAT dvojklik na DATA chip = datepicker — beze změny
- DTP dvojklik na DATA chip = DTP popover — beze změny (jen se odstraní dataOk toggle)
- `deadlineState()` funkce — beze změny
- DB schema — žádná migrace, `dataOk` zůstává v tabulce Block
- DTP serverová pojistka (`dataRequiredDate` není v DTP allowed) — beze změny

---

## Soubory k úpravě

| Soubor | Změna |
|--------|-------|
| `src/app/_components/TimelineGrid.tsx` | Vizuální pravidlo: `dataStatusId` místo `dataOk` řídí zobrazení. Odstranit single-klik toggle `dataOk`. |
| `src/components/BlockEdit.tsx` | Odstranit `dataOk` checkbox. Přidat auto-clear chipu při změně data. Auto-derivovat `dataOk` v save payloadu. |
| `src/components/DtpDataPopover.tsx` | Odstranit `dataOk` toggle (iOS switch). Auto-derivovat `dataOk` při uložení. |
| `src/app/_components/PlannerPage.tsx` | Upravit handlery: `handleDtpPopoverSave` auto-derivuje `dataOk`. Odstranit `toggleField("dataOk")` volání pro DATA. |
| `src/app/api/blocks/[id]/route.ts` | Serverová pojistka: auto-derivace `dataOk`, auto-clear chipu při změně data. |
| `src/app/api/blocks/route.ts` | Auto-derivace `dataOk` při POST (vytvoření bloku). |
| `src/app/api/blocks/batch/route.ts` | Auto-derivace `dataOk` při batch update. |
