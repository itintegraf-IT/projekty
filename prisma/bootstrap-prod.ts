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
