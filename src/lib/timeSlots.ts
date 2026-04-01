export const SLOT_MINUTES = 30;
export const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;
export const DAY_SLOT_COUNT = 24 * SLOTS_PER_HOUR;

type SlotWindowInput = {
  startSlot?: number | null;
  endSlot?: number | null;
  startHour?: number | null;
  endHour?: number | null;
};

export function slotFromHourBoundary(hour: number): number {
  return Math.round(hour * SLOTS_PER_HOUR);
}

export function slotToHour(slot: number): number {
  return slot / SLOTS_PER_HOUR;
}

export function slotToTimeParts(slot: number): { hour: number; minute: number } {
  const totalMinutes = slot * SLOT_MINUTES;
  return {
    hour: Math.floor(totalMinutes / 60),
    minute: totalMinutes % 60,
  };
}

export function formatHourValue(hourValue: number): string {
  const totalMinutes = Math.round(hourValue * 60);
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatSlot(slot: number): string {
  const { hour, minute } = slotToTimeParts(slot);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function getSlotRange(input: SlotWindowInput): { startSlot: number; endSlot: number } {
  const startSlot = Number.isInteger(input.startSlot)
    ? Number(input.startSlot)
    : Number.isFinite(input.startHour)
      ? slotFromHourBoundary(Number(input.startHour))
      : NaN;
  const endSlot = Number.isInteger(input.endSlot)
    ? Number(input.endSlot)
    : Number.isFinite(input.endHour)
      ? slotFromHourBoundary(Number(input.endHour))
      : NaN;

  if (!Number.isInteger(startSlot) || !Number.isInteger(endSlot)) {
    throw new Error("Chybí startSlot/endSlot nebo startHour/endHour");
  }

  return { startSlot, endSlot };
}

export function isValidStartSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot <= DAY_SLOT_COUNT - 1;
}

export function isValidEndSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= DAY_SLOT_COUNT;
}

export function isValidSlotWindow(startSlot: number, endSlot: number): boolean {
  return isValidStartSlot(startSlot) && isValidEndSlot(endSlot) && startSlot < endSlot;
}

export function legacyHoursFromSlots(startSlot: number, endSlot: number): { startHour: number; endHour: number } {
  return {
    startHour: Math.floor(startSlot / SLOTS_PER_HOUR),
    endHour: Math.ceil(endSlot / SLOTS_PER_HOUR),
  };
}

export function durationHoursFromSlots(startSlot: number, endSlot: number): number {
  return (endSlot - startSlot) / SLOTS_PER_HOUR;
}
