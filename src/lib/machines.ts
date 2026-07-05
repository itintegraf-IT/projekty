/** Jediný zdroj pravdy pro seznam tiskových strojů (M1 z triage etapy 6). */
export const MACHINES = ["XL_105", "XL_106"] as const;
export type MachineId = (typeof MACHINES)[number];
