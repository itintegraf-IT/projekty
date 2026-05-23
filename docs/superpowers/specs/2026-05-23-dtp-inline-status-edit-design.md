# DTP — inline editace stavu zakázky v dashboardu

**Datum:** 2026-05-23
**Autor:** Vojta Ťokan (CFO)
**Stav:** Návrh k implementaci

---

## Motivace

DTP dnes vidí svoje zakázky v pravém bočním panelu (`DtpPanel`), ale **stav zakázky (DATA chip) měnit přímo z panelu nemůže**. Musí najít blok v timeline a dvojklikem na malý chip otevřít `DtpDataPopover`. To je pro denní práci DTP zbytečně pomalé.

Cíl: DTP změní status DATA jedním kliknutím v panelu, bez nutnosti hledat blok v timeline.

## Rozsah (scope)

**Co spadá do změny:**
- Inline editace **DATA statusu** (pole `dataStatusId`, `dataStatusLabel`, `dataOk`) na kartách v `DtpPanel`
- Zachovat dosavadní funkci karet: klik na zbytek karty = skroll na blok v timeline

**Co NESPADÁ do změny:**
- Editace `dataRequiredDate` (datum potřeby dat) — to zůstává jen pro ADMIN/PLANOVAT
- Editace jiných polí bloku DTP rolí
- Změna existujícího `DtpDataPopover` na bloku v planneru — zůstává beze změny
- Změna API permissions — DTP už dnes smí měnit přesně tato pole

## Současný stav (mapování)

### Frontend
- `src/components/DtpPanel.tsx` — panel s kartami zakázek
  - `BlockCard` (řádek 244) zobrazuje `dataStatusLabel` jako statický chip (řádky 294–313)
  - Klik na kartu (`handleClick`) volá `onScrollTo` → skroll na blok v timeline
- `src/components/DtpDataPopover.tsx` — popover se select pro změnu statusu
  - Dnes se otevírá pouze double-klikem na DATA chip přímo na bloku v planneru
- `src/app/_components/PlannerPage.tsx`
  - Stav `dtpPopover` (řádek 814) a handler `handleDtpPopoverSave` (řádek 1735) řídí popover na bloku
  - PUT request na `/api/blocks/${id}` + optimistic update lokálního `blocks` state + toast při chybě
- `src/components/BlockEdit.tsx` — interní `StatusSelect` (řádek 468) — referenční vzor pro native `<select>` v projektu

### Backend
- `src/app/api/blocks/[id]/route.ts` (řádky 80–85) — DTP role smí mutovat **pouze**:
  - `dataStatusId`
  - `dataStatusLabel`
  - `dataOk`
- `AUDITED_FIELDS` zahrnuje `dataStatusLabel` (řádek 143) → změna se automaticky loguje do `AuditLog` v `$transaction`
- Auto-derivace `dataOk` z `dataStatusId` (řádky 184–187) — server správně dopočítá `dataOk` i kdyby klient poslal nekonzistentní hodnoty

## Architektonický návrh

### Princip

Native `<select>` v kartě s vizuálem stávajícího chipu. Auto-save při `onChange`. Reuse existujícího serverového API i existujícího handleru v `PlannerPage`.

### Strom komponent a datový tok

```
PlannerPage
  ├── state: blocks, bDataOpts
  ├── handler: handleDtpDataStatusChange(blockId, patch)
  │     (rename z handleDtpPopoverSave — sdílen pro popover i panel)
  │
  ├── DtpPanel (přidá prop onStatusChange)
  │     └── BlockCard (přidá prop onStatusChange)
  │           └── <select> chip
  │                 onChange → onStatusChange(blockId, patch)
  │                 onMouseDown / onClick → e.stopPropagation()
  │
  └── DtpDataPopover (beze změny vnitřního chování)
        onSave → handleDtpDataStatusChange (stejný handler)
```

### Komponenty — detail změn

#### `BlockCard` v `DtpPanel.tsx`

- Přidat prop `onStatusChange: (blockId: number, patch) => Promise<void>`
- Statický chip (řádky 294–313) **nahradit** komponentou `StatusChipSelect`:

```tsx
function StatusChipSelect({
  block, dataOpts, onChange,
}: {
  block: Block;
  dataOpts: CodebookOption[];
  onChange: (statusId: string) => void;
}) {
  const chipAccent = useMemo(() => {
    if (!block.dataStatusId) return null;
    const opt = dataOpts.find((o) => o.id === block.dataStatusId);
    return badgeColorVar(opt?.badgeColor ?? null) ?? "var(--badge-blue)";
  }, [block.dataStatusId, dataOpts]);

  const hasStatus = !!block.dataStatusId;

  return (
    <select
      value={block.dataStatusId?.toString() ?? ""}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      style={{
        appearance: "none",
        padding: "2px 18px 2px 7px",  // místo pro šipku vpravo
        borderRadius: 10,
        fontSize: 9,
        fontWeight: hasStatus ? 700 : 500,
        fontStyle: hasStatus ? "normal" : "italic",
        color: hasStatus
          ? `color-mix(in oklab, ${chipAccent} 70%, var(--text))`
          : "var(--text-muted)",
        background: hasStatus
          ? `color-mix(in oklab, ${chipAccent} 30%, transparent)`
          : "transparent",
        border: hasStatus
          ? `1px solid ${chipAccent}`
          : "1px dashed var(--border)",
        cursor: "pointer",
        outline: "none",
        // šipku dolů přidáme přes background-image (jednoduchá SVG data URI)
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6' fill='none' stroke='currentColor' stroke-width='1.5'><path d='M1 1l4 4 4-4' stroke-linecap='round'/></svg>")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 5px center",
        backgroundSize: "8px 5px",
      }}
    >
      <option value="">— bez statusu —</option>
      {dataOpts.filter((o) => o.isActive).map((opt) => (
        <option key={opt.id} value={opt.id.toString()}>
          {opt.isWarning ? "⚠ " : ""}{opt.label}
        </option>
      ))}
    </select>
  );
}
```

- `BlockCard` zavolá `onStatusChange` s patchem:

```tsx
async function handleStatusChange(statusIdStr: string) {
  const statusId = statusIdStr ? parseInt(statusIdStr, 10) : null;
  const selectedOpt = dataOpts.find((o) => o.id === statusId);
  await onStatusChange(block.id, {
    dataStatusId: statusId,
    dataStatusLabel: selectedOpt?.label ?? null,
    dataOk: statusId !== null,
  });
}
```

#### `DtpPanel` props

- Přidat `onStatusChange: (blockId, patch) => Promise<void>` a propagovat do `BlockCard`.

#### `PlannerPage.tsx`

- Přejmenovat `handleDtpPopoverSave` → `handleDtpDataStatusChange` (obecnější název)
- Předat ho do `<DtpPanel onStatusChange={handleDtpDataStatusChange} />`
- `<DtpDataPopover onSave={handleDtpDataStatusChange} />` zůstává

Stávající handler už dělá vše potřebné:
1. PUT `/api/blocks/${id}` s patchem
2. Při chybě toast + return (žádný optimistic update teď neexistuje pro popover, ale po PUT se data refetch-nou nebo SSE update přijde)

**Otázka k ověření při implementaci:** Jak se dnes blok aktualizuje v `blocks` state po úspěšném PUT? Pokud přes SSE auto-refetch, je vše OK. Pokud handler chybí explicitní update, dopiš ho — bez toho karta nezreflektuje změnu okamžitě a poskočí až po SSE.

## Server

**Žádná změna.** Existující validace, permissions, audit log a auto-derivace `dataOk` pokrývají všechny scénáře této featury.

## Chybové stavy a edge cases

| Případ | Chování |
|---|---|
| Network error při PUT | Toast `"Status se nepodařilo uložit."`, lokální state se vrátí (rollback nebo refetch — záleží na implementaci handleru) |
| 409 Conflict (jiný user změnil mezitím blok) | Toast s konkrétní chybou ze serveru, refetch bloků |
| Status se po změně dostane mimo aktivní filtr | Karta zmizí z view (správné chování — filtr je live). Toast potvrdí uložení. |
| Dva rychlé klikové změny za sebou | PUT requesty jdou sériově díky `await` v `handleStatusChange`. Last write wins na serveru. |
| DTP klikne na chip ale nezmění hodnotu | `onChange` se nevolá, žádný PUT |
| Klik na zbytek karty | `e.stopPropagation` na selectu nezasáhne — skroll funguje |

## Testování

**Existující testy zůstávají zelené** — žádná změna serveru, sdílených utilit ani API kontraktu.

**Manuální akceptační test:**
1. Přihlásit se jako DTP uživatel
2. Otevřít hlavní planner — DtpPanel je viditelný vpravo
3. Na kartě kliknout na chip statusu → otevře se dropdown
4. Vybrat jiný status → dropdown se zavře, chip se barevně překreslí
5. Reload stránky → status zůstal
6. Otevřít admin → audit → zkontrolovat, že je zaznamenána změna `dataStatusLabel` od DTP uživatele
7. Kliknout na zbytek karty (číslo zakázky / datum) → skroll na blok v timeline (původní funkce)
8. Změnit status na hodnotu, která vypadne z aktivního filtru → karta zmizí, toast se zobrazí
9. Otevřít blok v timeline → DATA chip na bloku má novou hodnotu

## Mimo rozsah / nedělat

- Inline edit `dataRequiredDate` — bylo by potřeba upravit API permissions
- Inline edit pro ostatní status chipy (MATERIÁL, BARVY, LAK) — pro MTZ by mohl být analogický panel v budoucnu, ale ne v této featuře
- Změna chování `DtpDataPopover` na bloku v planneru — zůstává jako záložní/druhý vstup
- Žádný "Uložit" tlačítko — auto-save je explicitní designové rozhodnutí (rychlost DTP workflow)

## Best practices checklist

- [x] DTP permission filter v API už existuje a respektuje princip least-privilege
- [x] Audit log v `$transaction` (`dataStatusLabel` je v `AUDITED_FIELDS`)
- [x] Žádný nový API endpoint = žádná nová validace serverového harmonogramu nutná
- [x] Nový UI komponent (`StatusChipSelect`) je v rámci `DtpPanel.tsx` jako sub-komponenta (vzor stejný jako `BlockCard`, `FilterChip`, `ResizeHandle` v tomtéž souboru)
- [x] `e.stopPropagation()` na select event = ochrana před nechtěným skrollem
- [x] Žádné `console.log` v API (nezasahujeme API)
