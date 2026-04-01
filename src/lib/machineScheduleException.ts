export type MachineScheduleException = {
  id: number;
  machine: string;      // "XL_105" | "XL_106"
  date: string;         // ISO string (serialized pro client)
  startHour: number;    // 0–23
  endHour: number;      // 1–24
  startSlot?: number | null; // 0–47
  endSlot?: number | null;   // 1–48
  isActive: boolean;
  label: string | null;
};
