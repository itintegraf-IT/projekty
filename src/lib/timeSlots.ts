export const SLOT_MINUTES = 30;
export const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;
export const DAY_SLOT_COUNT = 24 * SLOTS_PER_HOUR;
/** Délka slotu v ms — jediná definice (audit #90); printTime ji re-exportuje. */
export const SLOT_MS = SLOT_MINUTES * 60 * 1000;

export function slotFromHourBoundary(hour: number): number {
  return Math.round(hour * SLOTS_PER_HOUR);
}
