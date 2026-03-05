import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// ─── CodebookOption seed data ────────────────────────────────────────────────

const DATA_OPTIONS = [
  { label: "CHYBNÁ DATA",        sortOrder: 0, isWarning: true  },
  { label: "U SCHVÁLENÍ",        sortOrder: 1, isWarning: false },
  { label: "PŘIPRAVENO",         sortOrder: 2, isWarning: false },
  { label: "VYSVÍCENO",          sortOrder: 3, isWarning: false },
  { label: "MÍSTO PRO POZNÁMKU", sortOrder: 4, isWarning: false },
];

const MATERIAL_OPTIONS = [
  { label: "SKLADEM",                         sortOrder: 0  },
  { label: "TISK Z ARCHŮ",                    sortOrder: 1  },
  { label: "TISK Z ROLÍ",                     sortOrder: 2  },
  { label: "50m",                              sortOrder: 3  },
  { label: "55m",                              sortOrder: 4  },
  { label: "55lit",                            sortOrder: 5  },
  { label: "60m",                              sortOrder: 6  },
  { label: "60lim",                            sortOrder: 7  },
  { label: "70m",                              sortOrder: 8  },
  { label: "MÍSTO PRO POZNÁMKU",              sortOrder: 9  },
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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Číselníky — smazat a znovu seedovat
  await prisma.codebookOption.deleteMany();

  const dataOpts = await Promise.all(
    DATA_OPTIONS.map((o) =>
      prisma.codebookOption.create({ data: { category: "DATA", ...o } })
    )
  );
  const materialOpts = await Promise.all(
    MATERIAL_OPTIONS.map((o) =>
      prisma.codebookOption.create({ data: { category: "MATERIAL", isWarning: false, ...o } })
    )
  );
  const barvyOpts = await Promise.all(
    BARVY_OPTIONS.map((o) =>
      prisma.codebookOption.create({ data: { category: "BARVY", isWarning: false, ...o } })
    )
  );
  const lakOpts = await Promise.all(
    LAK_OPTIONS.map((o) =>
      prisma.codebookOption.create({ data: { category: "LAK", isWarning: false, ...o } })
    )
  );

  console.log(
    `Číselníky: ${dataOpts.length} DATA, ${materialOpts.length} MATERIAL, ${barvyOpts.length} BARVY, ${lakOpts.length} LAK`
  );

  // Zkratky pro seed bloků
  const DATA_PRIPRAVENO  = dataOpts.find((o) => o.label === "PŘIPRAVENO")!;
  const DATA_U_SCHVALENI = dataOpts.find((o) => o.label === "U SCHVÁLENÍ")!;
  const DATA_CHYBNA      = dataOpts.find((o) => o.label === "CHYBNÁ DATA")!;
  const MAT_SKLADEM      = materialOpts.find((o) => o.label === "SKLADEM")!;
  const MAT_60M          = materialOpts.find((o) => o.label === "60m")!;
  const MAT_TISK_ARCHU   = materialOpts.find((o) => o.label === "TISK Z ARCHŮ")!;
  const BARVY_LUMINA     = barvyOpts.find((o) => o.label === "SCH Lumina LED")!;
  const BARVY_COLORGRAF  = barvyOpts.find((o) => o.label === "IML COLORGRAF")!;
  const LAK_DISP_LESK    = lakOpts.find((o) => o.label === "disperse lesk")!;
  const LAK_UV           = lakOpts.find((o) => o.label === "UV lak")!;

  // 2. Bloky — smazat a znovu seedovat
  await prisma.block.deleteMany();

  const now  = new Date();
  const base = new Date(now);
  base.setMinutes(0, 0, 0);
  base.setHours(base.getHours() + 1);

  await prisma.block.createMany({
    data: [
      // --- DNES ---
      {
        orderNumber: "17001",
        machine: "XL_105",
        startTime: base,
        endTime: addHours(base, 3),
        type: "ZAKAZKA",
        description: "Novák s.r.o. – katalog A4 – 5000 ks",
        deadlineExpedice: addDays(now, 5),
        dataStatusId: DATA_PRIPRAVENO.id,
        dataStatusLabel: DATA_PRIPRAVENO.label,
        dataRequiredDate: addDays(now, 2),
        dataOk: true,
        materialStatusId: MAT_60M.id,
        materialStatusLabel: MAT_60M.label,
        materialRequiredDate: addDays(now, 1),
        materialOk: false,
        barvyStatusId: BARVY_LUMINA.id,
        barvyStatusLabel: BARVY_LUMINA.label,
        lakStatusId: LAK_DISP_LESK.id,
        lakStatusLabel: LAK_DISP_LESK.label,
        specifikace: "Matný povrch, výsek po tisku",
      },
      {
        orderNumber: "17002",
        machine: "XL_106",
        startTime: base,
        endTime: addHours(base, 2),
        type: "ZAKAZKA",
        description: "Beta tisk – brožura 16 str. – 2000 ks",
        deadlineExpedice: addDays(now, 7),
        dataStatusId: DATA_CHYBNA.id,
        dataStatusLabel: DATA_CHYBNA.label,
        dataRequiredDate: addDays(now, -1), // včera — not-ready test
        dataOk: false,
        materialStatusId: MAT_TISK_ARCHU.id,
        materialStatusLabel: MAT_TISK_ARCHU.label,
        barvyStatusId: BARVY_COLORGRAF.id,
        barvyStatusLabel: BARVY_COLORGRAF.label,
      },
      {
        orderNumber: "UDRZBA-01",
        machine: "XL_105",
        startTime: addHours(base, 3),
        endTime: addHours(base, 5),
        type: "UDRZBA",
        description: "Plánovaná údržba — výměna blankets",
      },
      // --- ZÍTRA ---
      {
        orderNumber: "17003",
        machine: "XL_105",
        startTime: addDays(base, 1),
        endTime: addHours(addDays(base, 1), 4),
        type: "ZAKAZKA",
        description: "Gamma Media – plakát B1 – 500 ks",
        deadlineExpedice: addDays(now, 8),
        dataStatusId: DATA_PRIPRAVENO.id,
        dataStatusLabel: DATA_PRIPRAVENO.label,
        dataOk: true,
        materialStatusId: MAT_SKLADEM.id,
        materialStatusLabel: MAT_SKLADEM.label,
        materialOk: true,
        barvyStatusId: BARVY_LUMINA.id,
        barvyStatusLabel: BARVY_LUMINA.label,
        lakStatusId: LAK_UV.id,
        lakStatusLabel: LAK_UV.label,
      },
      {
        orderNumber: "REZ-01",
        machine: "XL_106",
        startTime: addDays(base, 1),
        endTime: addHours(addDays(base, 1), 6),
        type: "REZERVACE",
        description: "Rezervace pro Delta Corp – čeká na podpis",
      },
      // --- POZÍTŘÍ ---
      {
        orderNumber: "17004",
        machine: "XL_106",
        startTime: addDays(base, 2),
        endTime: addHours(addDays(base, 2), 3),
        type: "ZAKAZKA",
        description: "Epsilon Reklama – letáky A5 – 10000 ks",
        deadlineExpedice: addDays(now, 9),
        dataStatusId: DATA_U_SCHVALENI.id,
        dataStatusLabel: DATA_U_SCHVALENI.label,
        dataRequiredDate: addDays(now, 1),
        dataOk: false,
        materialStatusId: MAT_60M.id,
        materialStatusLabel: MAT_60M.label,
        materialOk: false,
      },
      {
        orderNumber: "17005",
        machine: "XL_105",
        startTime: addDays(base, 2),
        endTime: addHours(addDays(base, 2), 3),
        type: "ZAKAZKA",
        description: "Zeta Print – vizitky – 1000 ks",
        locked: true,
        deadlineExpedice: addDays(now, 10),
        dataStatusId: DATA_PRIPRAVENO.id,
        dataStatusLabel: DATA_PRIPRAVENO.label,
        dataOk: true,
        lakStatusId: LAK_DISP_LESK.id,
        lakStatusLabel: LAK_DISP_LESK.label,
      },
      // --- PŘÍŠTÍ TÝDEN ---
      {
        orderNumber: "17006",
        machine: "XL_105",
        startTime: addDays(base, 5),
        endTime: addHours(addDays(base, 5), 5),
        type: "ZAKAZKA",
        description: "Eta Solutions – výroční zpráva – 300 ks",
        deadlineExpedice: addDays(now, 14),
        dataStatusId: DATA_CHYBNA.id,
        dataStatusLabel: DATA_CHYBNA.label,
        dataRequiredDate: addDays(now, 3),
        dataOk: false,
        materialStatusId: MAT_TISK_ARCHU.id,
        materialStatusLabel: MAT_TISK_ARCHU.label,
        materialRequiredDate: addDays(now, 4),
        materialOk: false,
        specifikace: "Speciální papír 250g, embosing",
      },
      {
        orderNumber: "UDRZBA-02",
        machine: "XL_106",
        startTime: addDays(base, 7),
        endTime: addHours(addDays(base, 7), 4),
        type: "UDRZBA",
        description: "Čtvrtletní servis — technický",
      },
      // --- MINULÝ BLOK (overdue test) ---
      {
        orderNumber: "17000",
        machine: "XL_106",
        startTime: addDays(base, -2),
        endTime: addHours(addDays(base, -2), 4),
        type: "ZAKAZKA",
        description: "Starý blok — overdue test (šedý)",
        dataStatusId: DATA_PRIPRAVENO.id,
        dataStatusLabel: DATA_PRIPRAVENO.label,
        dataOk: true,
        materialStatusId: MAT_SKLADEM.id,
        materialStatusLabel: MAT_SKLADEM.label,
        materialOk: true,
      },
    ],
  });

  const count = await prisma.block.count();
  console.log(`Seed dokončen: ${count} bloků vloženo.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
