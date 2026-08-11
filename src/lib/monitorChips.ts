import type { Block } from "@/app/_components/TimelineGrid";
import { VARIANT_CONFIG } from "@/lib/blockVariants";

export type MonitorChipTone = "brand" | "ok" | "wait" | "plain" | "danger";
export type MonitorChip = { label: string; tone: MonitorChipTone };

/**
 * Výrobní a stavové štítky zakázky na Monitoru — jediný zdroj pravdy pro velkou
 * kartu i frontu. Kdyby měla každá strana vlastní kopii, první oprava pravidel
 * (jako nález I5 níže) by se promítla jen na jedno místo a Monitor by o téže
 * zakázce tvrdil dvě různé věci na jedné obrazovce.
 *
 * Čistá funkce v `lib`, ne logika uvnitř JSX: pravidla jsou netriviální a už se
 * jednou rozešla, takže je chceme mít pod testy (stejný vzor jako `monitorView.ts`).
 */
export function buildMonitorChips(block: Block): MonitorChip[] {
  const chips: MonitorChip[] = [];

  if (block.obalka) chips.push({ label: "OBÁLKA", tone: "brand" });
  if (block.vnitrky) chips.push({ label: "VNITŘKY", tone: "brand" });
  if (block.tiskoveArchy) chips.push({ label: block.tiskoveArchy, tone: "plain" });
  if (block.serie) chips.push({ label: block.serie, tone: "plain" });

  if (block.dataStatusLabel) {
    chips.push({ label: block.dataStatusLabel, tone: block.dataOk ? "ok" : "wait" });
  }

  // Připravenost materiálu = na skladě NEBO vydáno NEBO potvrzeno — stejná logika
  // jako BlockCard (jinak Monitor hlásí „čeká" na to, co je v plánu zelené, nález I5).
  if (block.materialStatusLabel) {
    const materialReady = block.materialInStock || block.materialIssued || block.materialOk;
    chips.push({ label: block.materialStatusLabel, tone: materialReady ? "ok" : "wait" });
  }

  // Štítek se zobrazí za stejné podmínky jako v BlockCard (požadováno, má termín,
  // nebo je už odklepnuto) — samotné `pantoneRequired` je jen jedna ze tří cest tam.
  if (block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk) {
    chips.push({ label: "PANTONE", tone: block.pantoneOk ? "ok" : "wait" });
  }

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
