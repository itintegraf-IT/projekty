/**
 * Jednorázový backfill printMinutes/scheduleBypassed pro existující REZERVACE
 * bloky (etapa 9, fáze 1 — spec §3). DRY-RUN je VÝCHOZÍ; zapisuje se jen
 * s `--apply`.
 *
 * PROVOZNÍ PROTOKOL (rozhodnutí #8 + „Zálohu první"):
 *  1. `npx tsx scripts/backfill-reservation-print-minutes.ts` (dry-run),
 *  2. report zkontroluje Vojta osobně (počty CONFORMS/MISMATCH/SKIP_*),
 *  3. na produkci PŘED `--apply`: mysqldump záloha + ověřit
 *     `SELECT COUNT(*) FROM Block WHERE type='REZERVACE'` (spec §7),
 *  4. `npx tsx scripts/backfill-reservation-print-minutes.ts --apply`.
 *
 * BEZPEČNOST: zapisuje VÝHRADNĚ Block.printMinutes a Block.scheduleBypassed
 * u řádků type='REZERVACE'. startTime/endTime/machine se NIKDY nemění.
 * Idempotentní — řádky s vyplněným printMinutes se přeskakují (SKIP_HAS_PM).
 *
 * Vědomá výjimka z withRevision: skript běží mimo API vrstvu, stejná třída
 * jako DML v migracích (CLAUDE.md: „Co pomocník uzavřít NEUMÍ: ... DML uvnitř
 * migrací"). Revize backfillu nevznikají — proto povinný dry-run + záloha.
 */
import { prisma } from "../src/lib/prisma";
import { classifyReservationRow } from "../src/lib/reservationBackfill";
import { loadMachineCalendarRange } from "../src/lib/printTime.server";
import { MAX_SPAN_DAYS } from "../src/lib/printTime";

const APPLY = process.argv.includes("--apply");
const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const rows = await prisma.block.findMany({
    where: { type: "REZERVACE" },
    select: { id: true, orderNumber: true, machine: true, startTime: true, endTime: true, printMinutes: true },
    orderBy: { startTime: "asc" },
  });
  console.log(`REZERVACE bloků celkem: ${rows.length} · režim: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  const counts: Record<string, number> = {};
  const writes: Array<{ id: number; printMinutes: number; scheduleBypassed: boolean }> = [];

  for (const r of rows) {
    // Kalendář pokrývá [start − interní 1d kotva helperu, end + MAX_SPAN_DAYS]
    // — expanze z pm může přesáhnout uložený end.
    const cal = await loadMachineCalendarRange(
      prisma, r.machine, r.startTime, new Date(r.endTime.getTime() + MAX_SPAN_DAYS * DAY_MS),
    );
    const c = classifyReservationRow(r, cal.weekShifts, cal.companyDays);
    counts[c.kind] = (counts[c.kind] ?? 0) + 1;
    const label = `#${r.id} ${r.orderNumber} ${r.machine} ${r.startTime.toISOString()} – ${r.endTime.toISOString()}`;

    if (c.kind === "CONFORMS") {
      writes.push({ id: r.id, printMinutes: c.printMinutes, scheduleBypassed: false });
      console.log(`  CONFORMS        ${label} → printMinutes=${c.printMinutes}`);
    } else if (c.kind === "MISMATCH") {
      writes.push({ id: r.id, printMinutes: c.printMinutes, scheduleBypassed: true });
      console.log(`  MISMATCH        ${label} → printMinutes=${c.printMinutes}, scheduleBypassed=true (expanze: ${c.expandedEnd?.toISOString() ?? "selhala"})`);
    } else {
      console.log(`  ${c.kind.padEnd(15)} ${label} — přeskočeno, zůstává rigidní`);
    }
  }

  console.log("\nSouhrn:", counts);

  if (!APPLY) {
    console.log("\nDRY-RUN — nic se nezapsalo. Ostrý zápis: --apply (na produkci až po mysqldump záloze a Vojtově review reportu).");
    return;
  }
  for (const w of writes) {
    await prisma.block.update({
      where: { id: w.id },
      data: { printMinutes: w.printMinutes, scheduleBypassed: w.scheduleBypassed },
    });
  }
  console.log(`\nZapsáno ${writes.length} řádků.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
