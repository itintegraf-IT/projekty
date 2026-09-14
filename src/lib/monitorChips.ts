import type { Block } from "@/app/_components/TimelineGrid";
import { VARIANT_CONFIG } from "@/lib/blockVariants";
import { compactTagChip } from "@/lib/productionTags";
import type { CSSProperties } from "react";

export type MonitorChipTone = "brand" | "ok" | "wait" | "plain" | "danger";
export type MonitorChip = { label: string; tone: MonitorChipTone };

/**
 * Výrobní a stavové štítky zakázky na Monitoru (velká karta + fronta) — jediný
 * zdroj pravdy PRO MONITOR. Kdyby měla každá strana vlastní kopii, první oprava
 * pravidel (jako nález I5 níže) by se promítla jen na jedno místo a Monitor by
 * o téže zakázce tvrdil dvě různé věci na jedné obrazovce.
 *
 * Pozor: `BlockCard.tsx` v plánu si stejná pravidla (materiál, PANTONE) počítá
 * inline, vlastní kopií — tahle funkce ji nenahrazuje ani nevynucuje. Obě strany
 * dnes souhlasí, ale je to jen shoda, ne záruka; kdo mění pravidlo tady, musí ho
 * ručně promítnout i do `BlockCard.tsx` (viz nález I5, kde se to jednou rozešlo).
 * Výjimka je vědomá: barvy a lak kreslí karta v plánu barvou z číselníku,
 * Monitor neutrálně (tón `plain`) — zelená a jantarová tu znamenají
 * „připraveno" a „čeká", a takový stav barvy ani lak nemají (14. 9. 2026).
 *
 * Čistá funkce v `lib`, ne logika uvnitř JSX: pravidla jsou netriviální a už se
 * jednou rozešla, takže je chceme mít pod testy (stejný vzor jako `monitorView.ts`).
 */
export function buildMonitorChips(block: Block): MonitorChip[] {
  const chips: MonitorChip[] = [];

  if (block.obalka) chips.push({ label: "OBÁLKA", tone: "brand" });
  if (block.vnitrky) chips.push({ label: "VNITŘKY", tone: "brand" });

  // `tiskoveArchy`/`serie` se v DB ukládají jako JSON pole labelů (`'["1. TA","5. TA"]'`),
  // ne jako hotový text — `compactTagChip` je jediný sdílený formátovač (stejný,
  // jaký používá karta bloku v plánu). Syrový sloupec se NIKDY nevypisuje přímo,
  // jinak by chip na produkčních datech ukazoval doslovný JSON.
  const archyLabel = compactTagChip(block.tiskoveArchy);
  if (archyLabel) chips.push({ label: archyLabel, tone: "plain" });
  const serieLabel = compactTagChip(block.serie);
  if (serieLabel) chips.push({ label: serieLabel, tone: "plain" });

  if (block.dataStatusLabel) {
    chips.push({ label: block.dataStatusLabel, tone: block.dataOk ? "ok" : "wait" });
  }

  // Připravenost materiálu = na skladě NEBO vydáno NEBO potvrzeno — stejná logika
  // jako BlockCard (jinak Monitor hlásí „čeká" na to, co je v plánu zelené, nález I5).
  if (block.materialStatusLabel) {
    const materialReady = block.materialInStock || block.materialIssued || block.materialPartiallyIssued || block.materialOk;
    chips.push({ label: block.materialStatusLabel, tone: materialReady ? "ok" : "wait" });
  }

  // Stav vydání materiálu — textově (prosba tiskařů 19. 8. 2026: „aby věděli, na co mají vydáno").
  // Priorita zrcadlí mStateKey na kartě v plánu: issued > partiallyIssued > inStock > termín.
  // materialOk (MTZ odklepnuto) potlačuje „MAT. ČEKÁ" — parita s kartou v plánu (nález I1).
  if (block.materialIssued) chips.push({ label: "MAT. VYDÁNO ➜", tone: "ok" });
  else if (block.materialPartiallyIssued) chips.push({ label: "MAT. ČÁST. ½", tone: "ok" });
  else if (block.materialInStock) chips.push({ label: "MAT. SKLADEM ✓", tone: "ok" });
  else if (block.materialRequiredDate && !block.materialOk) chips.push({ label: "MAT. ČEKÁ", tone: "wait" });

  // Štítek se zobrazí za stejné podmínky jako v BlockCard (požadováno, má termín,
  // je odklepnuto, nebo je skladem/vydáno). Připravenost = odklepnuto NEBO skladem
  // NEBO vydáno — táž logika jako pantoneHandled v BlockCard.tsx; kdyby se rozešly,
  // Monitor a plán by o téže zakázce tvrdily dvě různé věci (nález I5).
  if (block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk || block.pantoneInStock || block.pantoneIssued) {
    const pantoneReady = block.pantoneOk || block.pantoneInStock || block.pantoneIssued;
    const pantoneLabel = block.pantoneIssued ? "PANTONE VYDÁNO"
      : block.pantoneInStock ? "PANTONE SKLADEM"
      : pantoneReady ? "PANTONE" : "PANTONE ČEKÁ";
    chips.push({ label: pantoneLabel, tone: pantoneReady ? "ok" : "wait" });
  }

  // Barvy a lak (14. 9. 2026, prosba plánovače „všechny štítky"). Štítky jsou
  // v aplikaci šestice DATA · MATERIÁL · BARVY · LAK · ARCHY · SÉRIE a Monitoru
  // chyběly právě tyhle dva. Tón je ZÁMĚRNĚ `plain`: barvy a lak nemají stav
  // hotovo/čeká, a zelená s jantarovou nesou na Monitoru právě tenhle význam.
  // Karta v plánu je kreslí barvou z číselníku (`MiniChip` + `badgeColorMap`) —
  // vědomá odchylka, ne rozejití pravidel (viz hlavička).
  const barvyLabel = block.barvyStatusLabel?.trim();
  if (barvyLabel) chips.push({ label: barvyLabel, tone: "plain" });
  const lakLabel = block.lakStatusLabel?.trim();
  if (lakLabel) chips.push({ label: lakLabel, tone: "plain" });

  // Nestandardní varianta zakázky (POZASTAVENO = výrobní stopka) — v plánu je sytě
  // červená, na Monitoru se dřív neukazovala vůbec (nález I5).
  if (block.blockVariant && block.blockVariant !== "STANDARD") {
    chips.push({
      label: VARIANT_CONFIG[block.blockVariant].label,
      tone: block.blockVariant === "POZASTAVENO" ? "danger" : "plain",
    });
  }

  return chips;
}

/**
 * Styl obalu štítků na Monitoru.
 *
 * Velká karta: obal smí zmenšit výšku pod svůj obsah (`minHeight: 0`
 * + `overflow: hidden`), a to jako JEDINÝ prvek obsahu karty. Obsah karty
 * ořezává zespodu, takže když na stupni XL a nízké obrazovce dojde místo,
 * ustoupí spodek štítků a časová osa tisku i řádek druhého stroje zůstanou
 * vidět (spec 2026-09-14, odd. 1.3). Ostatní prvky karty mají automatickou
 * minimální výšku podle obsahu, takže se zmenšit nemůžou. Tytéž štítky jsou
 * ve většině případů vidět i ve zvýrazněném řádku fronty.
 *
 * Fronta: obal roste do výšky a nic neořezává — fronta sama scrolluje.
 */
export function monitorChipsRowStyle(size: "hero" | "queue"): CSSProperties {
  if (size === "hero") {
    return { display: "flex", flexWrap: "wrap", gap: 6, minHeight: 0, overflow: "hidden" };
  }
  return { display: "flex", flexWrap: "wrap", gap: 5 };
}
