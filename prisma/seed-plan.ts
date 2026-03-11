/**
 * seed-plan.ts — Jednorázový import z Plán.xlsx
 * Smaže všechny bloky (ZAKAZKA, REZERVACE, UDRZBA) a vloží nové z JSON.
 * Spuštění: npx ts-node --skip-project prisma/seed-plan.ts
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

async function main() {
  // 1. Načíst JSON
  const jsonPath = path.join("/tmp", "plan_blocks.json");
  const raw = fs.readFileSync(jsonPath, "utf-8");
  const blocks: Array<{
    orderNumber: string;
    machine: string;
    startTime: string;
    endTime: string;
    type: string;
    description: string;
    dataOk: boolean;
    materialOk: boolean;
    deadlineExpedice: string | null;
  }> = JSON.parse(raw);

  console.log(`Načteno ${blocks.length} bloků z JSON.`);

  // 2. Smazat všechny bloky (recurrence children first kvůli FK)
  await prisma.block.deleteMany({ where: { recurrenceParentId: { not: null } } });
  const deleted = await prisma.block.deleteMany({});
  console.log(`Smazáno ${deleted.count} stávajících bloků.`);

  // 3. Vložit nové bloky
  let inserted = 0;
  for (const b of blocks) {
    await prisma.block.create({
      data: {
        orderNumber: b.orderNumber,
        machine: b.machine,
        startTime: new Date(b.startTime),
        endTime: new Date(b.endTime),
        type: b.type,
        description: b.description || null,
        dataOk: b.dataOk,
        materialOk: b.materialOk,
        deadlineExpedice: b.deadlineExpedice ? new Date(b.deadlineExpedice) : null,
        recurrenceType: "NONE",
      },
    });
    inserted++;
  }

  console.log(`Vloženo ${inserted} bloků.`);
  console.log("Hotovo.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
