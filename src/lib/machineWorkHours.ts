export type MachineWorkHours = {
  id?: number;
  machine: string;   // "XL_105" | "XL_106"
  dayOfWeek: number; // 0=neděle, 1=pondělí, ..., 6=sobota
  startHour: number; // 0–23
  endHour: number;   // 1–24 (24 = konec dne)
  isActive: boolean;
};

// Jeden den v šabloně provozních hodin
export type MachineWorkHoursTemplateDay = {
  id: number;
  dayOfWeek: number; // 0–6
  startHour: number;
  endHour: number;
  isActive: boolean;
  // Nemá pole `machine` — machine se přidává při mapování v resolveScheduleRows
};

// Šablona provozních hodin s dobou platnosti
// validFrom/validTo jsou YYYY-MM-DD stringy (UTC midnight, serializované z API)
// validTo = null znamená "platí navždy" (open-ended)
// isDefault = true → výchozí šablona (vždy existuje, nelze smazat)
// isDefault = false → dočasná šablona přebíjí výchozí v daném období
export type MachineWorkHoursTemplate = {
  id: number;
  machine: string;        // "XL_105" | "XL_106"
  label: string | null;
  validFrom: string;      // YYYY-MM-DD
  validTo: string | null; // YYYY-MM-DD nebo null
  isDefault: boolean;
  days: MachineWorkHoursTemplateDay[];
};
