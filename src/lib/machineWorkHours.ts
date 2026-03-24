export type MachineWorkHours = {
  id: number;
  machine: string;   // "XL_105" | "XL_106"
  dayOfWeek: number; // 0=neděle, 1=pondělí, ..., 6=sobota
  startHour: number; // 0–23
  endHour: number;   // 1–24 (24 = konec dne)
  isActive: boolean;
};
