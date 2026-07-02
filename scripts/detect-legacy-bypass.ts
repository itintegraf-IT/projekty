/**
 * Detekce legacy „bypass" bloků: ZAKAZKA bloky, jejichž uložený endTime
 * neodpovídá expandPrintTime(start, printMinutes) — typicky bloky historicky
 * položené s vypnutým zámkem pracovní doby (před zavedením scheduleBypassed).
 *
 * MUSÍ běžet před zapnutím serverové validace na produkci — jinak tyto bloky
 * začnou padat na SCHEDULE_VIOLATION při každém editu.
 *
 * Dry-run: npx tsx scripts/detect-legacy-bypass.ts
 * Apply:   npx tsx scripts/detect-legacy-bypass.ts --apply   (nastaví scheduleBypassed=true)
 */
import { prisma } from "../src/lib/prisma";
import { expandPrintTimeFromDb } from "../src/lib/printTime.server";

async function main() {
  const apply = process.argv.includes("--apply");
  const blocks = await prisma.block.findMany({
    where: { type: "ZAKAZKA", scheduleBypassed: false, printMinutes: { not: null } },
    select: { id: true, orderNumber: true, machine: true, startTime: true, endTime: true, printMinutes: true },
    orderBy: { startTime: "asc" },
  });

  const mismatched: typeof blocks = [];
  const corrupted: Array<(typeof blocks)[number] & { errorMessage: string }> = [];
  for (const b of blocks) {
    try {
      const r = await expandPrintTimeFromDb(prisma, b.machine, b.startTime, b.printMinutes!, false);
      if (!r.ok || r.end.getTime() !== b.endTime.getTime()) mismatched.push(b);
    } catch (e) {
      // Blok s poškozenými daty (např. printMinutes < 0, end < start) — expandPrintTimeFromDb
      // shodí výjimku. Tohle NENÍ legacy-bypass kandidát, ale datová korupce vyžadující
      // ruční opravu. Nesmí se nikdy označit jako scheduleBypassed.
      const errorMessage = e instanceof Error ? e.message : String(e);
      corrupted.push({ ...b, errorMessage });
    }
  }

  for (const b of mismatched) {
    console.log(`  #${b.id} ${b.orderNumber} ${b.machine} ${b.startTime.toISOString()} – ${b.endTime.toISOString()} (${b.printMinutes} min)`);
  }
  if (corrupted.length > 0) {
    console.log("\n[KORUPCE] — vyžaduje ruční opravu dat, --apply tyto bloky NEoznačí:");
    for (const b of corrupted) {
      console.log(`  #${b.id} ${b.orderNumber} ${b.machine} ${b.startTime.toISOString()} – ${b.endTime.toISOString()} (${b.printMinutes} min): ${b.errorMessage}`);
    }
  }
  if (apply && mismatched.length > 0) {
    const res = await prisma.block.updateMany({
      where: { id: { in: mismatched.map((b) => b.id) } },
      data: { scheduleBypassed: true },
    });
    console.log(`\nOznačeno scheduleBypassed=true: ${res.count} bloků`);
  } else if (mismatched.length > 0) {
    console.log("\nDry-run — nic nezměněno. Spusť s --apply pro označení.");
  }
  console.log(`\nZkontrolováno ${blocks.length} ZAKAZKA bloků, legacy-bypass kandidátů: ${mismatched.length}, korumpovaných: ${corrupted.length}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
