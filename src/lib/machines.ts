/** Jediný zdroj pravdy pro seznam tiskových strojů (M1 z triage etapy 6). */
export const MACHINES = ["XL_105", "XL_106"] as const;
export type MachineId = (typeof MACHINES)[number];

/** Zobrazované labely strojů — jediný zdroj pravdy (audit #25/#46/#77). */
export const MACHINE_LABELS: Record<MachineId, string> = {
  XL_105: "XL 105",
  XL_106: "XL 106",
};

/** Label stroje pro UI; neznámé id degraduje na podtržítko→mezera. */
export function machineLabel(machine: string): string {
  return (MACHINE_LABELS as Record<string, string>)[machine] ?? machine.replace("_", " ");
}
