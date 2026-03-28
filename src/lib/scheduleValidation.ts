import { pragueOf } from "./dateUtils";
import type { MachineWorkHours } from "./machineWorkHours";

/**
 * Hardcoded pravidla pro bloky mimo provoz — fallback když schedule neobsahuje
 * řádek pro daný dayOfWeek. Parametry jsou v Europe/Prague timezone.
 */
export function isHardcodedBlocked(machine: string, dayOfWeek: number, hour: number): boolean {
  if (dayOfWeek === 6) return true;                                     // sobota — oba stroje
  if (dayOfWeek === 0) return machine === "XL_105" || hour < 22;       // neděle — XL_105 celý den, XL_106 do 22:00
  if (dayOfWeek === 5 && hour >= 22) return true;                       // pátek noc — oba stroje
  if (machine === "XL_105" && (hour >= 22 || hour < 6)) return true;   // všední noc — jen XL_105
  return false;
}

/**
 * Synchronní validace bloku vůči provozním hodinám.
 * Route soubory si dělají vlastní async DB fetch, pak volají tuto funkci.
 *
 * Fallback logika pro chybějící dayOfWeek:
 *   - schedule.length === 0 && exceptions.length === 0 → null (žádná pravidla, vše povoleno)
 *   - schedule existuje, ale pro daný dayOfWeek chybí řádek → isHardcodedBlocked (stejné jako klient)
 */
// `date` je string na klientu (serialized JSON), ale Date z Prisma na serveru — oba fungují s new Date()
// `machine` je optional pro zpětnou kompatibilitu — pokud chybí, filtr se přeskočí (funguje jen pokud
//  volající předal pole předfiltrované na správný stroj)
type ExceptionSlim = { machine?: string; date: Date | string; startHour: number; endHour: number; isActive: boolean };

export function checkScheduleViolationSync(
  machine: string,
  startTime: Date,
  endTime: Date,
  schedule: MachineWorkHours[],
  exceptions: ExceptionSlim[]
): string | null {
  if (schedule.length === 0 && exceptions.length === 0) return null;
  const SLOT_MS = 30 * 60 * 1000;
  let cur = new Date(startTime);
  while (cur < endTime) {
    const { hour, dayOfWeek, dateStr } = pragueOf(cur);
    const exc = exceptions.find(
      (e) => (!e.machine || e.machine === machine) && new Date(e.date).toISOString().slice(0, 10) === dateStr
    );
    const row = exc ?? schedule.find((r) => r.machine === machine && r.dayOfWeek === dayOfWeek);
    if (!row) {
      if (isHardcodedBlocked(machine, dayOfWeek, hour)) return "Blok zasahuje do doby mimo provoz stroje.";
    } else if (!row.isActive || hour < row.startHour || hour >= row.endHour) {
      return "Blok zasahuje do doby mimo provoz stroje.";
    }
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return null;
}
