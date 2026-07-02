/**
 * Testovací data pro regresní test etapy 3 (tiskové hodiny) — DEV ONLY.
 *
 * Vytvoří sadu zakázek s prefixem TEST- pro scénáře: chain push, zamčený blok,
 * vytištěný blok, lasso skupina a blok u víkendu. Starty se snapují na aktuální
 * kalendář směn a end počítá expandPrintTimeFromDb — bloky jsou vždy konformní
 * (scheduleBypassed=false, end == expand), takže nemění baseline detect skriptu
 * v počtu kandidátů.
 *
 * Spuštění:  npx tsx scripts/seed-test-tiskove-hodiny.ts
 * Úklid:     npx tsx scripts/seed-test-tiskove-hodiny.ts --cleanup
 *
 * Re-run je bezpečný: nejdřív smaže všechny předchozí TEST- bloky.
 */
import { prisma } from "../src/lib/prisma";
import { loadMachineCalendar, expandPrintTimeFromDb } from "../src/lib/printTime.server";
import { snapStartToNextRunnableSlot } from "../src/lib/printTime";
import { pragueToUTC } from "../src/lib/dateUtils";

type Spec = {
  orderNumber: string;
  machine: string;
  dateStr: string; // YYYY-MM-DD (Praha)
  hour: number; // celá hodina Praha
  printMinutes: number;
  locked?: boolean;
  printed?: boolean;
  description: string;
};

// Týden Po 6. 7. – Pá 10. 7. 2026 (příští týden, aby nerušil aktuální plán).
const SPECS: Spec[] = [
  // ── XL_105: chain push ────────────────────────────────────────────────────
  { orderNumber: "TEST-PRESUN", machine: "XL_105", dateStr: "2026-07-06", hour: 8, printMinutes: 240,
    description: "Přetáhni mě na TEST-CHAIN-A (odsun řady)" },
  { orderNumber: "TEST-CHAIN-A", machine: "XL_105", dateStr: "2026-07-07", hour: 8, printMinutes: 240,
    description: "Cíl přesunu — B a C se mají odsunout" },
  { orderNumber: "TEST-CHAIN-B", machine: "XL_105", dateStr: "2026-07-07", hour: 12, printMinutes: 240,
    description: "Navazující blok (odsune se)" },
  { orderNumber: "TEST-CHAIN-C", machine: "XL_105", dateStr: "2026-07-07", hour: 16, printMinutes: 240,
    description: "Navazující blok (odsune se)" },
  // ── XL_105: zamčený a vytištěný blok ─────────────────────────────────────
  { orderNumber: "TEST-ZAMEK", machine: "XL_105", dateStr: "2026-07-08", hour: 10, printMinutes: 240, locked: true,
    description: "Zamčený — drop na mě má být odmítnut s hláškou" },
  { orderNumber: "TEST-VYTISTENO", machine: "XL_105", dateStr: "2026-07-08", hour: 16, printMinutes: 120, printed: true,
    description: "Vytištěný — chová se jako zamčený" },
  // ── XL_106: lasso skupina ─────────────────────────────────────────────────
  { orderNumber: "TEST-LASSO-1", machine: "XL_106", dateStr: "2026-07-09", hour: 8, printMinutes: 180,
    description: "Lasso skupina 1/3" },
  { orderNumber: "TEST-LASSO-2", machine: "XL_106", dateStr: "2026-07-09", hour: 12, printMinutes: 180,
    description: "Lasso skupina 2/3" },
  { orderNumber: "TEST-LASSO-3", machine: "XL_106", dateStr: "2026-07-09", hour: 16, printMinutes: 180,
    description: "Lasso skupina 3/3" },
  // ── XL_106: blok u víkendu ────────────────────────────────────────────────
  { orderNumber: "TEST-PATEK", machine: "XL_106", dateStr: "2026-07-10", hour: 14, printMinutes: 360,
    description: "Posuň mě k pátečnímu večeru — server natáhne konec přes víkend" },
];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("localhost") && !url.includes("127.0.0.1")) {
    console.error("STOP: DATABASE_URL nemíří na localhost — tento skript je jen pro dev DB.");
    process.exit(1);
  }

  const deleted = await prisma.block.deleteMany({
    where: { orderNumber: { startsWith: "TEST-" } },
  });
  console.log(`Smazáno předchozích TEST- bloků: ${deleted.count}`);

  if (process.argv.includes("--cleanup")) {
    console.log("Cleanup hotov.");
    return;
  }

  let created = 0;
  for (const s of SPECS) {
    const desired = pragueToUTC(s.dateStr, s.hour);
    const cal = await loadMachineCalendar(prisma, s.machine, desired);
    const start = snapStartToNextRunnableSlot(s.machine, desired, cal.weekShifts, cal.companyDays);
    if (!start) {
      console.warn(`PŘESKOČENO ${s.orderNumber}: žádný pracovní slot poblíž ${s.dateStr} ${s.hour}:00`);
      continue;
    }
    const exp = await expandPrintTimeFromDb(prisma, s.machine, start, s.printMinutes, false);
    if (!exp.ok) {
      console.warn(`PŘESKOČENO ${s.orderNumber}: expanze selhala (${exp.reason})`);
      continue;
    }
    const conflict = await prisma.block.findFirst({
      where: { machine: s.machine, startTime: { lt: exp.end }, endTime: { gt: start } },
      select: { orderNumber: true },
    });
    if (conflict) {
      console.warn(`PŘESKOČENO ${s.orderNumber}: místo je obsazené blokem ${conflict.orderNumber} — uvolni ho nebo uprav SPECS`);
      continue;
    }
    await prisma.block.create({
      data: {
        orderNumber: s.orderNumber,
        machine: s.machine,
        type: "ZAKAZKA",
        startTime: start,
        endTime: exp.end,
        printMinutes: s.printMinutes,
        scheduleBypassed: false,
        locked: s.locked ?? false,
        description: s.description,
        ...(s.printed
          ? { printCompletedAt: new Date(), printCompletedByUsername: "test-seed" }
          : {}),
      },
    });
    const fmt = (d: Date) =>
      d.toLocaleString("cs-CZ", { timeZone: "Europe/Prague", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
    console.log(`✔ ${s.orderNumber.padEnd(15)} ${s.machine}  ${fmt(start)} – ${fmt(exp.end)}  (${s.printMinutes} min)`);
    created++;
  }
  console.log(`\nHotovo: ${created}/${SPECS.length} bloků vytvořeno.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
