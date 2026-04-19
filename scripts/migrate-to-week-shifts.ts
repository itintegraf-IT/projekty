/* eslint-disable no-console */
/**
 * Backfill MachineWeekShifts z existujících MachineWorkHoursTemplate + MachineScheduleException.
 *
 * Rozsah: [dnes − 52 týdnů, dnes + 52 týdnů].
 * Idempotence: upsert podle @@unique([machine, weekStart, dayOfWeek]).
 *
 * Spuštění:
 *   npx tsx scripts/migrate-to-week-shifts.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MACHINES = ["XL_105", "XL_106"] as const;

function weekStartFromDate(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function isoDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Odvození shift flags z exception.startHour/endHour. Stejná logika jako migrace 20260419121941. */
function flagsFromHours(startHour: number, endHour: number): { morningOn: boolean; afternoonOn: boolean; nightOn: boolean } {
  return {
    morningOn: startHour <= 6 && endHour >= 14,
    afternoonOn: startHour <= 14 && endHour >= 22,
    nightOn: (startHour <= 22 && endHour >= 24) || (startHour === 0 && endHour >= 6),
  };
}

async function main() {
  const templates = await prisma.machineWorkHoursTemplate.findMany({
    include: { days: true },
    orderBy: [{ machine: "asc" }, { isDefault: "asc" }, { validFrom: "asc" }],
  });
  const exceptions = await prisma.machineScheduleException.findMany();

  const excByKey = new Map<string, (typeof exceptions)[number]>();
  for (const e of exceptions) {
    excByKey.set(`${e.machine}:${isoDateStr(e.date)}`, e);
  }

  const today = new Date();
  const center = weekStartFromDate(today);
  const rangeWeeks = 52;

  let upserted = 0;
  let skipped = 0;

  for (const machine of MACHINES) {
    const machineTemplates = templates.filter((t) => t.machine === machine);
    const defaultTemplate = machineTemplates.find((t) => t.isDefault);

    for (let w = -rangeWeeks; w <= rangeWeeks; w++) {
      const weekStart = new Date(center);
      weekStart.setUTCDate(weekStart.getUTCDate() + w * 7);
      const weekStartStr = isoDateStr(weekStart);

      for (let offset = 0; offset < 7; offset++) {
        const date = new Date(weekStart);
        date.setUTCDate(date.getUTCDate() + offset);
        const dateStr = isoDateStr(date);
        const dayOfWeek = date.getUTCDay();

        const exception = excByKey.get(`${machine}:${dateStr}`);
        let isActive = false;
        let morningOn = false;
        let afternoonOn = false;
        let nightOn = false;

        if (exception) {
          if (exception.isActive) {
            isActive = true;
            const flags = flagsFromHours(exception.startHour, exception.endHour);
            morningOn = flags.morningOn;
            afternoonOn = flags.afternoonOn;
            nightOn = flags.nightOn;
          } else {
            isActive = false;
          }
        } else {
          const temporary = machineTemplates.find(
            (t) =>
              !t.isDefault &&
              isoDateStr(t.validFrom) <= dateStr &&
              (t.validTo === null || isoDateStr(t.validTo) >= dateStr)
          );
          const active = temporary ?? defaultTemplate;
          const dayRow = active?.days.find((d) => d.dayOfWeek === dayOfWeek);
          if (dayRow) {
            isActive = dayRow.isActive;
            morningOn = Boolean(dayRow.morningOn);
            afternoonOn = Boolean(dayRow.afternoonOn);
            nightOn = Boolean(dayRow.nightOn);
          }
        }

        await prisma.machineWeekShifts.upsert({
          where: {
            machine_weekStart_dayOfWeek: {
              machine,
              weekStart,
              dayOfWeek,
            },
          },
          create: { machine, weekStart, dayOfWeek, isActive, morningOn, afternoonOn, nightOn },
          update: { isActive, morningOn, afternoonOn, nightOn },
        });
        upserted++;
      }
      void skipped;
      void weekStartStr;
    }
  }

  console.log(`[migrate-to-week-shifts] upserted=${upserted}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
