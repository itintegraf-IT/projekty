export const SLOT_MINUTES = 30;
export const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;
export const DAY_SLOT_COUNT = 24 * SLOTS_PER_HOUR;

export function slotFromHourBoundary(hour: number): number {
  return Math.round(hour * SLOTS_PER_HOUR);
}
