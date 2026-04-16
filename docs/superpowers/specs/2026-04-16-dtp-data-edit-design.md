# DTP — editace DATA sloupce (design spec)

Datum: 2026-04-16  
Autor: Vojta Ťokan + Claude

---

## Kontext

Role DTP má dnes `canEditData = true`, což jí technicky umožňuje editovat i datum dodání dat (`dataRequiredDate`) v `BlockEdit` panelu i přes inline datepicker (dvojklik na chip). To je příliš — datum smí měnit pouze ADMIN a PLANOVAT.

Zároveň DTP nemá žádný pohodlný způsob, jak rychle změnit DATA status (dropdown: Chybná data / Připraveno / Vysvíceno…) bez otevírání celého edit panelu.

Tento spec definuje:
1. Zúžení oprávnění DTP (odebrat editaci datumu)
2. Nový UX: popover přímo z DATA chipu na timeline bloku

---

## Oprávnění po změně

| Akce | ADMIN / PLANOVAT | DTP | MTZ | ostatní |
|------|-----------------|-----|-----|---------|
| Změnit `dataRequiredDate` | ✓ | ✗ | ✗ | ✗ |
| Změnit `dataStatusId` | ✓ | ✓ | ✗ | ✗ |
| Přepnout `dataOk` | ✓ | ✓ | ✗ | ✗ |
| Číst DATA chip (read-only) | ✓ | ✓ | ✓ | ✓ |

---

## UX — interakce s DATA chipem pro DTP

### Klik (beze změny)
Klik na DATA chip toggleuje `dataOk` — stejné chování jako dnes.  
Podmínka: `dataCanToggle = block.dataOk || !!block.dataRequiredDate` — beze změny.

### Dvojklik → popover
Dvojklik na DATA chip otevře malý popover ukotvený pod chipem.

**Obsah poporveru:**
- Dropdown: DATA status (`dataStatusId`) — zobrazuje hodnoty z `CodebookOption` kategorie `DATA`
- Toggle (iOS-style switch nebo checkbox): `dataOk`
- Žádný nadpis — blok je vidět v pozadí

**Ukládání:** auto-save při zavření poporveru (klik mimo = dismiss + PATCH na API).  
Bez explicitního tlačítka Uložit / Zrušit.

**Pozice:** popover se otevírá pod chipem (stejný ukotvovací mechanismus jako existující inline datepicker — `getBoundingClientRect()` + `onInlineDatePick` callback vzor).

---

## Technická změna oprávnění

### `canEditData` se rozdělí na dvě příznaky

Dnes:
```typescript
const canEditData = canEdit || currentUser.role === "DTP";
```

Po změně:
```typescript
const canEditData      = canEdit || currentUser.role === "DTP"; // status + ok (beze změny)
const canEditDataDate  = canEdit; // datum — pouze ADMIN a PLANOVAT
```

### `BlockEdit` panel
Sekce DATA datum (`DatePickerField` pro `dataRequiredDate`) se řídí `canEditDataDate` místo `canEditData`.  
DTP vidí datum jako read-only text (nebo skrytý `DatePickerField` s `pointerEvents: none`).

### `BlockCard` / `TimelineGrid`
`dataCanOpenCalendar` (inline datepicker při dvojkliku) se změní na:
```typescript
const dataCanOpenCalendar = !block.dataOk && canEditDataDate && !!onInlineDatePick;
```
DTP tak dvojklikem neotvírá datepicker, ale nový popover.

`dataCanOpenDtpPopover`:
```typescript
const dataCanOpenDtpPopover = canEditData && !canEditDataDate && !!onDataChipDoubleClick;
```
Pro DTP platí bez podmínky `!block.dataOk` — status chce DTP měnit i když je data.ok = true.

### Nový callback `onDataChipDoubleClick`
Přidá se callback do `BlockCard` props:
```typescript
onDataChipDoubleClick?: (blockId: number, rect: DOMRect) => void;
```
Spouští se při dvojkliku na DATA chip pokud `dataCanOpenDtpPopover` (tj. jen pro DTP).  
Pro ADMIN/PLANOVAT zůstává dvojklik = datepicker (`canEditDataDate = true`).

### Nová komponenta `DtpDataPopover`
Samostatná komponenta v `src/components/DtpDataPopover.tsx`.

Props:
```typescript
{
  blockId: number;
  currentStatusId: number | null;
  currentOk: boolean;
  dataOpts: CodebookOption[];
  anchorRect: DOMRect;
  onClose: () => void;
  onSave: (blockId: number, patch: { dataStatusId?: number | null; dataOk?: boolean }) => Promise<void>;
}
```

Chování:
- Otevře se přes portal (fixed position) pod anchorRect
- Zavření: klik mimo (onBlur / Escape / click-outside)
- Při zavření zavolá `onSave` s aktuálním stavem (pokud došlo ke změně)
- Žádné nadpisy, žádná tlačítka

### API — beze změny
`PUT /api/blocks/[id]` již filtruje pole dle role (DTP: jen DATA pole).  
Nový popover posílá stejné pole (`dataStatusId`, `dataOk`) — žádná nová route není potřeba.  
Audit log se zapisuje automaticky přes existující PUT handler.

---

## Co se nemění

- `showMenu` v `BlockCard` — DTP nemá context menu (ani po této změně)
- Klik na chip = toggle `dataOk` (beze změny, pro DTP i ostatní)
- `BlockEdit` panel pro DTP se neotvírá přes klik na blok (to platilo i dříve — panel otvírá pouze plánovač dvojklikem)
- Materiál, Barvy, Lak, Pantone — DTP nemůže nic editovat (beze změny)

---

## Soubory k úpravě

| Soubor | Změna |
|--------|-------|
| `src/app/_components/PlannerPage.tsx` | přidat `canEditDataDate`, předat nový callback a `DtpDataPopover` stav |
| `src/app/_components/TimelineGrid.tsx` | přidat `canEditDataDate` prop, upravit `dataCanOpenCalendar`, přidat `onDataChipDoubleClick` callback |
| `src/components/BlockEdit.tsx` | přidat `canEditDataDate` prop, uzamknout `DatePickerField` pro datum |
| `src/components/DtpDataPopover.tsx` | nová komponenta |
| `src/app/api/blocks/[id]/route.ts` | ověřit, že PUT nepovoluje DTP měnit `dataRequiredDate` (serverová pojistka) |
