/**
 * Read-only průzkum dat pro kaskádovou kontrolu směn.
 *
 * Odpovídá na otázku, kterou klikáním nezjistíš: kolik bloků je dnes v jakém stavu
 * vůči pracovnímu kalendáři, a tedy co uživatel po nasazení reálně uvidí.
 *
 *   npx tsx scripts/cascade-data-survey.ts [YYYY-MM-DD pondělí]
 *
 * Bez argumentu bere aktuální týden. NIC NEZAPISUJE.
 *
 * Tři čísla, na kterých záleží:
 *  - „s vnitřní pauzou" = zakázky, které stará (smazaná) kontrola hlásila FALEŠNĚ.
 *    Po nasazení u nich musí být ticho. Na produkci jich 17. 8. 2026 bylo 15.
 *  - „konec později" = latentní detonátor ze zkrácení směny: blok drží kratší
 *    geometrii, než jaká z kalendáře vyplývá, a jeho příští úprava odsune navazující.
 *  - „nemá kde být" = jediná kategorie, která nově BLOKUJE uložení směn.
 */
import { prisma } from "../src/lib/prisma";
import { detectCalendarDrift } from "../src/lib/calendarDrift.server";
import { computeConflictWindow } from "../src/lib/cascadeCheck";
import { MACHINES, machineLabel } from "../src/lib/machines";
import { weekStartStrFromDateStr } from "../src/lib/machineWeekShifts";
import { utcToPragueDateStr } from "../src/lib/dateUtils";

async function main() {
  const arg = process.argv[2];
  const weekStart = arg
    ? weekStartStrFromDateStr(arg)
    : weekStartStrFromDateStr(utcToPragueDateStr(new Date()));
  const { from, to } = computeConflictWindow(weekStart);
  const now = new Date();

  console.log(`Týden ${weekStart} · okno ${from.toISOString()} → ${to.toISOString()}\n`);

  // 1) Bloky s vnitřní pauzou — ty stará kontrola hlásila falešně.
  const paused = await prisma.$queryRaw<Array<{ machine: string; pocet: bigint }>>`
    SELECT machine, COUNT(*) AS pocet
    FROM Block
    WHERE type = 'ZAKAZKA' AND printMinutes IS NOT NULL AND printCompletedAt IS NULL
      AND TIMESTAMPDIFF(MINUTE, startTime, endTime) <> printMinutes
    GROUP BY machine`;
  console.log("Zakázky s vnitřní pauzou (dřív FALEŠNĚ hlášené, nově musí být ticho):");
  if (paused.length === 0) console.log("  žádné");
  for (const r of paused) console.log(`  ${machineLabel(r.machine)}: ${Number(r.pocet)}`);

  // 2) Skutečný stav vůči kalendáři v okně editace týdne.
  console.log("\nStav vůči kalendáři v okně tohoto týdne:");
  for (const machine of MACHINES) {
    const drift = await detectCalendarDrift(prisma, [machine], from, to, now);
    const homeless = drift.filter((d) => d.reason !== "END_MISMATCH");
    const later = drift.filter(
      (d) => d.reason === "END_MISMATCH" && d.expectedEnd !== null && d.expectedEnd > d.endTime,
    );
    const earlier = drift.filter(
      (d) => d.reason === "END_MISMATCH" && d.expectedEnd !== null && d.expectedEnd <= d.endTime,
    );

    console.log(`\n  ${machineLabel(machine)}:`);
    console.log(`    nemá kde být (BLOKUJE uložení): ${homeless.length}`);
    console.log(`    konec později (latentní detonátor): ${later.length}`);
    console.log(`    konec dřív (neškodné): ${earlier.length}`);
    for (const d of [...homeless, ...later].slice(0, 10)) {
      const kdy = `${d.startTime.toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })} → ${d.endTime.toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })}`;
      console.log(`      ${d.orderNumber} (${d.reason}) ${kdy}`);
    }
  }

  console.log(
    "\nPozn.: uložení směn BEZ ZMĚNY musí po nasazení vrátit 0 konfliktů vždy —\n" +
    "kontrola porovnává stav před zápisem se stavem po něm, takže `před == po` → ticho.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
