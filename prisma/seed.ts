import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function main() {
  await prisma.block.deleteMany();

  const now = new Date();
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
        deadlineData: addDays(now, 2),
        deadlineMaterial: addDays(now, 1),
        deadlineExpedice: addDays(now, 5),
        deadlineDataOk: true,
        deadlineMaterialOk: false,
      },
      {
        orderNumber: "17002",
        machine: "XL_106",
        startTime: base,
        endTime: addHours(base, 2),
        type: "ZAKAZKA",
        description: "Beta tisk – brožura 16 str. – 2000 ks",
        deadlineData: addDays(now, 3),
        deadlineMaterial: addDays(now, 3),
        deadlineExpedice: addDays(now, 7),
        deadlineDataOk: false,
        deadlineMaterialOk: false,
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
        deadlineData: addDays(now, 4),
        deadlineMaterial: addDays(now, 3),
        deadlineExpedice: addDays(now, 8),
        deadlineDataOk: true,
        deadlineMaterialOk: true,
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
      },
      {
        orderNumber: "17005",
        machine: "XL_105",
        startTime: addDays(base, 2),
        endTime: addHours(addDays(base, 2), 3),
        type: "ZAKAZKA",
        description: "Zeta Print – vizitky – 1000 ks",
        locked: true,
        deadlineData: addDays(now, 6),
        deadlineExpedice: addDays(now, 10),
      },
      // --- PŘÍŠTÍ TÝDEN ---
      {
        orderNumber: "17006",
        machine: "XL_105",
        startTime: addDays(base, 5),
        endTime: addHours(addDays(base, 5), 5),
        type: "ZAKAZKA",
        description: "Eta Solutions – výroční zpráva – 300 ks",
        deadlineData: addDays(now, 12),
        deadlineMaterial: addDays(now, 10),
        deadlineExpedice: addDays(now, 14),
      },
      {
        orderNumber: "UDRZBA-02",
        machine: "XL_106",
        startTime: addDays(base, 7),
        endTime: addHours(addDays(base, 7), 4),
        type: "UDRZBA",
        description: "Čtvrtletní servis — technický",
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
