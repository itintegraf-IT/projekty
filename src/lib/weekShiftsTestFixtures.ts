import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";

// ── Test-only fixtury pracovní doby (sdílené mezi *.test.ts) ────────────────
// Směny: MORNING 6–14, AFTERNOON 14–22, NIGHT 22–6 (Praha).

export function mkDay(
  weekStart: string,
  dayOfWeek: number,
  opts: { m?: boolean; a?: boolean; n?: boolean; active?: boolean } = {},
  machine = "XL_106"
): MachineWeekShiftsRow {
  return {
    machine,
    weekStart,
    dayOfWeek,
    isActive: opts.active ?? true,
    morningOn: opts.m ?? false,
    afternoonOn: opts.a ?? false,
    nightOn: opts.n ?? false,
    morningStartMin: 360, morningEndMin: 840,
    afternoonStartMin: 840, afternoonEndMin: 1320,
    nightStartMin: 1320, nightEndMin: 360,
  };
}

/** Reálný režim XL_106: Po–Čt nonstop, Pá do 22:00, So off, Ne od 22:00.
 *  = víkendová odstávka Pá 22:00 – Ne 22:00. */
export function xl106Week(weekStart: string): MachineWeekShiftsRow[] {
  return [
    mkDay(weekStart, 1, { m: true, a: true, n: true }),
    mkDay(weekStart, 2, { m: true, a: true, n: true }),
    mkDay(weekStart, 3, { m: true, a: true, n: true }),
    mkDay(weekStart, 4, { m: true, a: true, n: true }),
    mkDay(weekStart, 5, { m: true, a: true }),
    mkDay(weekStart, 6, { active: false }),
    mkDay(weekStart, 0, { n: true }),
  ];
}

export function offWeek(weekStart: string): MachineWeekShiftsRow[] {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => mkDay(weekStart, d, { active: false }));
}

/** Pondělky srpna 2026 (CEST) pro dvoutýdenní scénáře. */
export const W1 = "2026-08-17";
export const W2 = "2026-08-24";
