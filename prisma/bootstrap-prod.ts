/**
 * PRODUKČNÍ BOOTSTRAP — bezpečné spuštění na ostré databázi
 *
 * Tento skript:
 *   ✅ Vytvoří výchozí číselník (DATA/MATERIÁL/BARVY/LAK) — pouze pokud je prázdný
 *   ✅ Vytvoří admin účet — pouze pokud žádný ADMIN neexistuje
 *   ❌ NIKDY nemaže žádná data
 *   ❌ NIKDY nevytváří testovací bloky
 *
 * Spuštění: npm run prisma:bootstrap
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DATA_OPTIONS = [
  { label: "CHYBNÁ DATA",        sortOrder: 0, isWarning: true  },
  { label: "U SCHVÁLENÍ",        sortOrder: 1, isWarning: false },
  { label: "PŘIPRAVENO",         sortOrder: 2, isWarning: false },
  { label: "VYSVÍCENO",          sortOrder: 3, isWarning: false },
  { label: "MÍSTO PRO POZNÁMKU", sortOrder: 4, isWarning: false },
];

const MATERIAL_OPTIONS = [
  { label: "SKLADEM",            sortOrder: 0  },
  { label: "TISK Z ARCHŮ",       sortOrder: 1  },
  { label: "TISK Z ROLÍ",        sortOrder: 2  },
  { label: "50m",                sortOrder: 3  },
  { label: "55m",                sortOrder: 4  },
  { label: "55lit",              sortOrder: 5  },
  { label: "60m",                sortOrder: 6  },
  { label: "60lim",              sortOrder: 7  },
  { label: "70m",                sortOrder: 8  },
  { label: "MÍSTO PRO POZNÁMKU", sortOrder: 9  },
];

const BARVY_OPTIONS = [
  { label: "SCH Lumina LED",  sortOrder: 0 },
  { label: "IML COLORGRAF",   sortOrder: 1 },
  { label: "SCH TRIUMPH K",   sortOrder: 2 },
];

const LAK_OPTIONS = [
  { label: "disperse lesk",          sortOrder: 0 },
  { label: "disperse mat",           sortOrder: 1 },
  { label: "pod UV",                 sortOrder: 2 },
  { label: "mat pod lamino",         sortOrder: 3 },
  { label: "150",                    sortOrder: 4 },
  { label: "401",                    sortOrder: 5 },
  { label: "215",                    sortOrder: 6 },
  { label: "parciální",             sortOrder: 7 },
  { label: "UV lak",                 sortOrder: 8 },
  { label: "vysoce lesklá disperse", sortOrder: 9 },
];

const SYSTEM_JOB_PRESETS = [
  { name: "XL 105", sortOrder: 0, machineConstraint: "XL_105" },
  { name: "XL 106 LED", sortOrder: 1, machineConstraint: "XL_106" },
  { name: "XL 106 IML", sortOrder: 2, machineConstraint: "XL_106" },
];

async function main() {
  console.log("🚀 Integraf produkční bootstrap...");

  // 1. Číselníky — vytvořit pouze pokud jsou prázdné
  const existingCount = await prisma.codebookOption.count();
  if (existingCount === 0) {
    const allOptions = [
      ...DATA_OPTIONS.map((o) => ({ category: "DATA", ...o, isWarning: o.isWarning ?? false })),
      ...MATERIAL_OPTIONS.map((o) => ({ category: "MATERIAL", ...o, isWarning: false })),
      ...BARVY_OPTIONS.map((o) => ({ category: "BARVY", ...o, isWarning: false })),
      ...LAK_OPTIONS.map((o) => ({ category: "LAK", ...o, isWarning: false })),
    ];
    await prisma.codebookOption.createMany({ data: allOptions });
    console.log(`✅ Číselníky: ${allOptions.length} výchozích položek vytvořeno.`);
  } else {
    console.log(`ℹ️  Číselníky: ${existingCount} položek již existuje — přeskočeno.`);
  }

  // 2. Pracovní doba strojů — vytvořit pouze pokud tabulka prázdná
  const machineWorkHoursCount = await prisma.machineWorkHours.count();
  if (machineWorkHoursCount === 0) {
    const defaults = [
      // XL_105: Po–Pá = 6:00–22:00, So/Ne = celý den mimo provoz
      { machine: "XL_105", dayOfWeek: 0, startHour: 0, endHour: 24, isActive: false },
      { machine: "XL_105", dayOfWeek: 1, startHour: 6, endHour: 22, isActive: true  },
      { machine: "XL_105", dayOfWeek: 2, startHour: 6, endHour: 22, isActive: true  },
      { machine: "XL_105", dayOfWeek: 3, startHour: 6, endHour: 22, isActive: true  },
      { machine: "XL_105", dayOfWeek: 4, startHour: 6, endHour: 22, isActive: true  },
      { machine: "XL_105", dayOfWeek: 5, startHour: 6, endHour: 22, isActive: true  },
      { machine: "XL_105", dayOfWeek: 6, startHour: 0, endHour: 24, isActive: false },
      // XL_106: Po–Čt = 0:00–24:00, Pá = 0:00–22:00, So = off, Ne = 22:00–24:00
      { machine: "XL_106", dayOfWeek: 0, startHour: 22, endHour: 24, isActive: true  },
      { machine: "XL_106", dayOfWeek: 1, startHour: 0,  endHour: 24, isActive: true  },
      { machine: "XL_106", dayOfWeek: 2, startHour: 0,  endHour: 24, isActive: true  },
      { machine: "XL_106", dayOfWeek: 3, startHour: 0,  endHour: 24, isActive: true  },
      { machine: "XL_106", dayOfWeek: 4, startHour: 0,  endHour: 24, isActive: true  },
      { machine: "XL_106", dayOfWeek: 5, startHour: 0,  endHour: 22, isActive: true  },
      { machine: "XL_106", dayOfWeek: 6, startHour: 0,  endHour: 24, isActive: false },
    ];
    await prisma.machineWorkHours.createMany({ data: defaults });
    console.log(`✅ Pracovní doba: ${defaults.length} výchozích záznamů vytvořeno.`);
  } else {
    console.log(`ℹ️  Pracovní doba: ${machineWorkHoursCount} záznamů již existuje — přeskočeno.`);
  }

  // 3. Admin účet — vytvořit pouze pokud žádný admin neexistuje
  //    POZOR: změň heslo ihned po prvním přihlášení!
  const adminExists = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!adminExists) {
    const defaultPassword = "ChangeMe123!";
    await prisma.user.create({
      data: {
        username: "admin",
        passwordHash: await bcrypt.hash(defaultPassword, 10),
        role: "ADMIN",
      },
    });
    console.log(`✅ Admin účet vytvořen: username=admin, heslo=${defaultPassword}`);
    console.log(`⚠️  OKAMŽITĚ ZMĚŇ HESLO po prvním přihlášení!`);
  } else {
    console.log(`ℹ️  Admin: účet '${adminExists.username}' již existuje — přeskočeno.`);
  }

  // Poznámka: účty tiskařů (role TISKAR) zakládej ručně přes Admin dashboard.
  // Bootstrap záměrně nevytváří žádné testovací účty.

  // 4. Default MachineWeekShifts pro aktuální týden — seed pokud chybí.
  //    Další týdny se auto-seedují z předchozího při prvním GET /api/machine-week-shifts.
  //    Flag-only model: morningOn (6–14) / afternoonOn (14–22) / nightOn (22 → +1d 6).
  const WEEK_SHIFTS_DEFAULTS: Record<string, Array<{ dayOfWeek: number; morningOn: boolean; afternoonOn: boolean; nightOn: boolean }>> = {
    XL_105: [
      { dayOfWeek: 0, morningOn: false, afternoonOn: false, nightOn: false }, // neděle
      { dayOfWeek: 1, morningOn: true,  afternoonOn: true,  nightOn: false }, // pondělí
      { dayOfWeek: 2, morningOn: true,  afternoonOn: true,  nightOn: false }, // úterý
      { dayOfWeek: 3, morningOn: true,  afternoonOn: true,  nightOn: false }, // středa
      { dayOfWeek: 4, morningOn: true,  afternoonOn: true,  nightOn: false }, // čtvrtek
      { dayOfWeek: 5, morningOn: true,  afternoonOn: true,  nightOn: false }, // pátek
      { dayOfWeek: 6, morningOn: false, afternoonOn: false, nightOn: false }, // sobota
    ],
    XL_106: [
      { dayOfWeek: 0, morningOn: false, afternoonOn: false, nightOn: true  }, // neděle (Ne 22 → Po 06)
      { dayOfWeek: 1, morningOn: true,  afternoonOn: true,  nightOn: true  }, // pondělí
      { dayOfWeek: 2, morningOn: true,  afternoonOn: true,  nightOn: true  }, // úterý
      { dayOfWeek: 3, morningOn: true,  afternoonOn: true,  nightOn: true  }, // středa
      { dayOfWeek: 4, morningOn: true,  afternoonOn: true,  nightOn: true  }, // čtvrtek
      { dayOfWeek: 5, morningOn: true,  afternoonOn: true,  nightOn: false }, // pátek (bez noční)
      { dayOfWeek: 6, morningOn: false, afternoonOn: false, nightOn: false }, // sobota
    ],
  };

  // Aktuální pondělí 00:00 UTC
  const now = new Date();
  const dow = now.getUTCDay();
  const daysToMonday = dow === 0 ? -6 : 1 - dow;
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysToMonday));

  for (const machine of ["XL_105", "XL_106"]) {
    const existing = await prisma.machineWeekShifts.findMany({
      where: { machine, weekStart },
      select: { dayOfWeek: true },
    });
    if (existing.length === 7) {
      console.log(`ℹ️  MachineWeekShifts pro ${machine} (${weekStart.toISOString().slice(0, 10)}): kompletní — přeskočeno.`);
      continue;
    }
    const days = WEEK_SHIFTS_DEFAULTS[machine]!;
    await prisma.machineWeekShifts.createMany({
      data: days.map((d) => ({
        machine,
        weekStart,
        dayOfWeek: d.dayOfWeek,
        isActive: d.morningOn || d.afternoonOn || d.nightOn,
        morningOn: d.morningOn,
        afternoonOn: d.afternoonOn,
        nightOn: d.nightOn,
      })),
      skipDuplicates: true,
    });
    console.log(`✅ MachineWeekShifts naseedovány pro ${machine} (${weekStart.toISOString().slice(0, 10)})`);
  }

  // 5. Systémové presety job builderu — vytvořit pouze pokud chybí
  for (const preset of SYSTEM_JOB_PRESETS) {
    const exists = await prisma.jobPreset.findFirst({
      where: { isSystemPreset: true, name: preset.name },
      select: { id: true },
    });
    if (!exists) {
      await prisma.jobPreset.create({
        data: {
          name: preset.name,
          isSystemPreset: true,
          isActive: true,
          sortOrder: preset.sortOrder,
          appliesToZakazka: true,
          appliesToRezervace: true,
          machineConstraint: preset.machineConstraint,
        },
      });
      console.log(`✅ Job preset vytvořen: ${preset.name}`);
    } else {
      console.log(`ℹ️  Job preset '${preset.name}' již existuje — přeskočeno.`);
    }
  }

  console.log("✅ Bootstrap dokončen.");
}

main()
  .catch((e) => {
    console.error("❌ Bootstrap selhal:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
