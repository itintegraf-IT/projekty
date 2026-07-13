// ─── zLayers.ts ──────────────────────────────────────────────────────────────
// Kanonická z-index škála aplikace. Jediný zdroj pravdy pro vrstvení —
// nahrazuje roztroušené magické konstanty přímo ve stylech (audit #21/#95).
//
// Hodnoty jsou 1:1 dnešní stav — tato fáze jen POJMENOVÁVÁ existující čísla,
// nesjednocuje je. Monotonii v každé skupině hlídá `zLayers.test.ts`.
//
// TŘI ROVINY (různé stacking contexty — NEmíchat mezi sebou):
//
//  1) Z_TIMELINE — lokální mikro-škála UVNITŘ planneru (jeden sloupec stroje /
//     karta bloku). Malé hodnoty (1–31), porovnávají se jen mezi sebou uvnitř
//     gridu. Karta bloku sama tvoří stacking context (position:absolute+zIndex),
//     takže její vnitřní vrstvy jsou vůči zbytku appky irelevantní.
//
//  2) Z_LAYOUT — řadové flex děti hlavního layoutu (boční <aside> panely a jejich
//     resize dělič). Leží NAD vnitřkem timeline, ale POD portálovými překryvy.
//
//  3) Z_OVERLAY — překryvy, které utíkají ze svého kontextu přes position:fixed
//     nebo React portál a soupeří na úrovni <body>/viewportu. TADY na pořadí
//     skutečně záleží (popover musí být nad panelem, dialog nad vším). Právě
//     nedodržení tohoto pořadí způsobilo bug s poznámkou MTZ pod panelem —
//     popover byl uvězněný ve stacking contextu karty (z:1) místo na úrovni body.
//
// Pořadí klíčů v každé skupině = rostoucí z-index (deklarace je dokumentace).

// ── 1) Uvnitř timeline gridu ──
export const Z_TIMELINE = {
  blockBase: 1,          // karta bloku v klidu
  // Pozn.: karta-interní vrstvy (obsah, spec/odstávka overlay, chipy — zIndex 2–4)
  // zůstávají lokální literály uvnitř stacking contextu karty; jejich vztah je
  // popsaný komentářem přímo v TimelineGrid. Do sdílené škály nepatří (nesoupeří
  // s ničím vně karty), proto tu nemají konstantu. Totéž pár efemérních in-column
  // preview overlayů (resize tooltip, queue-drop preview) — jednorázové literály.
  blockHover: 5,         // karta pod myší
  blockResizeHover: 15,  // karta s hoverem na resize handle
  dragGhost: 16,         // náhledový ghost při tažení (landing zone)
  blockDrag: 20,         // aktivně tažená karta
  pasteMarker: 25,       // ⎘ paste marker — nad taženou kartou
  stickyHeader: 30,      // sticky hlavička sloupců timeline
  shiftHandle: 30,       // okraje směn (ShiftEdgeHandles) — jiný kontext než hlavička
  shiftHandleLabel: 31,  // popisek okraje směny
} as const;

// ── 2) Řadové panely hlavního layoutu ──
export const Z_LAYOUT = {
  sidePanel: 10,    // <aside> panely (BlockDetail, notifikace, DTP)
  panelDivider: 20, // resize dělič mezi panely
} as const;

// ── 3) Body-level překryvy (portál / position:fixed) ──
export const Z_OVERLAY = {
  hoverCard: 200,     // iOS-style hover tooltip malých bloků
  notePopover: 400,   // inline editor poznámky MTZ
  contextMenu: 500,   // pravé-klik menu (Radix)
  dataPopover: 600,   // DTP data popover
  dialog: 1000,       // menší dialogy (poznámky, hodiny směn)
  dialogCascade: 1100,// kaskádní dialog směn (nad dialog)
  backdrop: 9998,     // backdrop datepickeru
  floating: 9999,     // datepicker / tooltip / toast
  modal: 10000,       // potvrzovací a plnostránkové modály (delete, preset editor)
} as const;
