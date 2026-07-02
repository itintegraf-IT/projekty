/**
 * DEV-ONLY vizuální seed: naplní testovací bloky hodnotami obalka/vnitrky/
 * tiskoveArchy/serie, ať jsou vidět všechny barevné kombinace typového chipu
 * (OBÁLKA žlutá / VNITŘKY tyrkysová / TA·série levandulová) na zakázce i rezervaci.
 *
 * Spuštění:  node --import tsx scripts/seed-type-chips-dev.ts
 * Pojistka:  odmítne běžet proti produkční DB (host 192.168.10.210).
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

if ((process.env.DATABASE_URL ?? "").includes("192.168.10.210")) {
  console.error("❌ DATABASE_URL míří na produkci — seed odmítnut.");
  process.exit(1);
}

const ta = (nums: number[]) => JSON.stringify(nums.map((n) => `${n}. TA`));
const se = (nums: number[]) => JSON.stringify(nums.map((n) => `${n}. série`));
const CLEAR = { obalka: false, vnitrky: false, tiskoveArchy: null as string | null, serie: null as string | null };

// ZAKÁZKA testovací bloky (orderNumber → kombinace)
const zakazky: Array<{ order: string; data: Partial<typeof CLEAR>; popis: string }> = [
  { order: "TEST-CHAIN-A",   data: { obalka: true },                                popis: "OBÁLKA (žlutá)" },
  { order: "TEST-CHAIN-C",   data: { vnitrky: true },                               popis: "VNITŘKY (tyrkysová)" },
  { order: "TEST-CHAIN-B",   data: { tiskoveArchy: ta([1, 5, 6]) },                 popis: "1, 5, 6 TA (levandulová)" },
  { order: "TEST-PRESUN",    data: { tiskoveArchy: ta([1]), serie: se([3]) },       popis: "1 TA · 3 série" },
  { order: "TEST-VYTISTENO", data: { tiskoveArchy: ta([2, 3]), serie: se([1, 2]) },popis: "2, 3 TA · 1, 2 série (delší)" },
  { order: "TEST-PATEK",     data: { obalka: true },                                popis: "OBÁLKA (vysoký blok)" },
  { order: "TEST-LASSO-1",   data: { vnitrky: true },                               popis: "VNITŘKY" },
  { order: "TEST-LASSO-2",   data: { tiskoveArchy: ta([4, 5]) },                    popis: "4, 5 TA" },
  { order: "TEST-LASSO-3",   data: { tiskoveArchy: ta([1]), serie: se([1]) },       popis: "1 TA · 1 série" },
];

async function main() {
  console.log("🎨 Seed typových chipů (DEV)…\n");

  for (const z of zakazky) {
    const r = await prisma.block.updateMany({
      where: { orderNumber: z.order, type: "ZAKAZKA" },
      data: { ...CLEAR, ...z.data },
    });
    console.log(`${r.count > 0 ? "✅" : "⚠️  (nenalezeno)"} ${z.order.padEnd(15)} → ${z.popis}`);
  }

  // REZERVACE — vytvoř 2 NEPOTVRZENÉ rezervace + napojené REZERVACE bloky ve
  // viditelném clusteru (fialový přerušovaný blok s ⏳). Idempotentně přes `code`.
  console.log("");
  const rezervace = [
    { code: "TEST-REZ-CHIP-1", company: "TEST Rezervace A", machine: "XL_105", start: "2026-07-09T08:00:00.000Z", hours: 4, data: { ...CLEAR, obalka: true }, popis: "OBÁLKA na rezervaci" },
    { code: "TEST-REZ-CHIP-2", company: "TEST Rezervace B", machine: "XL_106", start: "2026-07-08T09:00:00.000Z", hours: 4, data: { ...CLEAR, tiskoveArchy: ta([1]), serie: se([3]) }, popis: "1 TA · 3 série na rezervaci" },
  ];
  for (const r of rezervace) {
    const start = new Date(r.start);
    const end = new Date(start.getTime() + r.hours * 3600000);
    const res = await prisma.reservation.upsert({
      where: { code: r.code },
      update: {},
      create: { code: r.code, status: "SCHEDULED", companyName: r.company, erpOfferNumber: r.code, requestedByUserId: 1, requestedByUsername: "admin", confirmedAt: null },
    });
    const existing = await prisma.block.findFirst({ where: { orderNumber: r.code, type: "REZERVACE" }, select: { id: true } });
    if (existing) {
      await prisma.block.update({ where: { id: existing.id }, data: { ...r.data, reservationId: res.id, startTime: start, endTime: end, machine: r.machine } });
    } else {
      await prisma.block.create({ data: { orderNumber: r.code, type: "REZERVACE", machine: r.machine, startTime: start, endTime: end, reservationId: res.id, ...r.data } });
    }
    console.log(`✅ REZERVACE ${r.code} ${r.machine} ${r.start.slice(0, 16)} → ${r.popis} (fialový + ⏳)`);
  }

  console.log("\n✅ Hotovo. Obnov si plán v prohlížeči (F5). Bloky jsou 7.–10. 7. 2026 na XL 105 i XL 106.");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
