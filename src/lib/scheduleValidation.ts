import { pragueOf } from "./dateUtils";
import type { MachineWorkHours, MachineWorkHoursTemplate } from "./machineWorkHours";
import { getSlotRange, slotFromHourBoundary, slotToHour } from "./timeSlots";

/**
 * Vrátí MachineWorkHours-kompatibilní řádky pro konkrétní datum z pole šablon.
 * Precedence: dočasná šablona (validFrom ≤ datum ≤ validTo) → výchozí šablona.
 *
 * validFrom/validTo jsou YYYY-MM-DD stringy (nebo ISO s časem — vždy slicujeme na 10 znaků).
 * Vrácené objekty mají pole `machine` přidané, i když MachineWorkHoursTemplateDay ho nemá.
 */
export function resolveScheduleRows(
  machine: string,
  date: Date,
  templates: MachineWorkHoursTemplate[]
): Array<{ machine: string; dayOfWeek: number; startHour: number; endHour: number; startSlot: number; endSlot: number; isActive: boolean }> {
  const dateStr = pragueOf(date).dateStr; // Europe/Prague datum — nikdy UTC slice (off-by-one v noci)
  const machineTemplates = templates.filter((t) => t.machine === machine);

  const active =
    machineTemplates.find(
      (t) =>
        !t.isDefault &&
        t.validFrom.slice(0, 10) <= dateStr &&
        (t.validTo === null || t.validTo.slice(0, 10) >= dateStr)
    ) ?? machineTemplates.find((t) => t.isDefault);

  if (!active) return [];

  return active.days.map((d) => ({
    machine,
    dayOfWeek: d.dayOfWeek,
    startHour: d.startHour,
    endHour: d.endHour,
    startSlot: getSlotRange(d).startSlot,
    endSlot: getSlotRange(d).endSlot,
    isActive: d.isActive,
  }));
}

/**
 * Serializuje Prisma DateTime validFrom/validTo pole na YYYY-MM-DD stringy.
 * Použít v route souborech místo inline `.map(t => ({ ...t, validFrom: t.validFrom.toISOString()... }))`.
 */
export function serializeTemplates(
  raw: { validFrom: Date; validTo: Date | null; [key: string]: unknown }[]
): MachineWorkHoursTemplate[] {
  return raw.map((t) => ({
    ...t,
    validFrom: (t.validFrom as Date).toISOString().slice(0, 10),
    validTo: t.validTo ? (t.validTo as Date).toISOString().slice(0, 10) : null,
    days: Array.isArray(t.days)
      ? (t.days as MachineWorkHoursTemplate["days"]).map((d) => {
          const { startSlot, endSlot } = getSlotRange(d);
          return {
            ...d,
            startSlot,
            endSlot,
            startHour: slotToHour(startSlot),
            endHour: slotToHour(endSlot),
          };
        })
      : [],
  })) as MachineWorkHoursTemplate[];
}

/**
 * Hardcoded pravidla pro bloky mimo provoz — fallback když schedule neobsahuje
 * řádek pro daný dayOfWeek. Parametry jsou v Europe/Prague timezone.
 */
export function isHardcodedBlocked(machine: string, dayOfWeek: number, slot: number): boolean {
  if (dayOfWeek === 6) return true;                                     // sobota — oba stroje
  if (dayOfWeek === 0) return machine === "XL_105" || slot < slotFromHourBoundary(22);       // neděle — XL_105 celý den, XL_106 do 22:00
  if (dayOfWeek === 5 && slot >= slotFromHourBoundary(22)) return true;                       // pátek noc — oba stroje
  if (machine === "XL_105" && (slot >= slotFromHourBoundary(22) || slot < slotFromHourBoundary(6))) return true;   // všední noc — jen XL_105
  return false;
}

// `date` je string na klientu (serialized JSON), ale Date z Prisma na serveru — oba fungují s new Date()
// `machine` je optional pro zpětnou kompatibilitu — pokud chybí, filtr se přeskočí
type ExceptionSlim = {
  machine?: string;
  date: Date | string;
  startHour: number;
  endHour: number;
  startSlot?: number | null;
  endSlot?: number | null;
  isActive: boolean;
};

/**
 * Validace bloku vůči provozním hodinám s per-slot template resolve.
 * Správně zpracovává bloky překračující hranice platnosti šablon (multi-day bloky).
 * Cache per-den eliminuje opakované resolveScheduleRows pro každý 30min slot.
 */
export function checkScheduleViolationWithTemplates(
  machine: string,
  startTime: Date,
  endTime: Date,
  templates: MachineWorkHoursTemplate[],
  exceptions: ExceptionSlim[]
): string | null {
  const SLOT_MS = 30 * 60 * 1000;
  const scheduleCache = new Map<string, ReturnType<typeof resolveScheduleRows>>();
  let cur = new Date(startTime);
  while (cur < endTime) {
    const { slot, dayOfWeek, dateStr } = pragueOf(cur);
    if (!scheduleCache.has(dateStr)) {
      scheduleCache.set(dateStr, resolveScheduleRows(machine, cur, templates));
    }
    const schedule = scheduleCache.get(dateStr)!;
    const exc = exceptions.find(
      (e) => (!e.machine || e.machine === machine) && new Date(e.date).toISOString().slice(0, 10) === dateStr
    );
    // Exception přebíjí template
    if (exc) {
      const excRange = getSlotRange(exc);
      if (!exc.isActive || slot < excRange.startSlot || slot >= excRange.endSlot) {
        return "Blok zasahuje do doby mimo provoz stroje.";
      }
    } else {
      const row = schedule.find((r) => r.dayOfWeek === dayOfWeek);
      if (!row) {
        // Template pro stroj existuje, ale chybí řádek pro tento den → den je mimo provoz.
        // Fallback na hardcoded pravidla jen pokud template vůbec neexistuje (schedule.length === 0).
        if (schedule.length > 0 || isHardcodedBlocked(machine, dayOfWeek, slot)) {
          return "Blok zasahuje do doby mimo provoz stroje.";
        }
      } else {
        const rowRange = getSlotRange(row);
        if (!row.isActive || slot < rowRange.startSlot || slot >= rowRange.endSlot) {
          return "Blok zasahuje do doby mimo provoz stroje.";
        }
      }
    }
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return null;
}
