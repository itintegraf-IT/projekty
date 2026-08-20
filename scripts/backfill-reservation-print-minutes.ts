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
 * Idempotentní — řádky s vyplněným printMinutes se přeskakují (SKIP_HAS_PM);
 * viz i re-check přímo v transakci níž.
 *
 * PROČ `withRevision` (review R3, opraveno po zamítnutí původní výjimky):
 * bez něj by chybná klasifikace (např. špatně načtený kalendář na produkci)
 * šla vzít zpět jen obnovou z mysqldump zálohy — hodiny výpadku, ne adresný
 * zásah. S `withRevision` vznikne ke KAŽDÉMU zapsanému řádku `BlockRevision`
 * (adresný rollback přes `scripts/revert-revision-group.ts --group <groupId>`)
 * a `AuditLog` řádek (`action: "BACKFILL_PRINT_MINUTES"`, viditelný v historii
 * bloku). Zápis běží v JEDNÉ transakci — pád uprostřed (chyba na libovolném
 * řádku dávky) shodí `prisma.$transaction` celou a NEZAPÍŠE nic (ověřeno:
 * `withRevision`ovo obecné rollback chování testuje `revision.server.test.ts`,
 * „rollback těla nezanechá revizi ani auditní řádek"; tenhle skript používá
 * stejný primitiv stejným způsobem — žádná zápisová cesta mimo `rtx`).
 *
 * Overlap guard (`assertNoOverlapForBlocks`, CLAUDE.md) se NEVOLÁ záměrně:
 * skript nemění `startTime`/`endTime`/`machine`, tedy geometrii bloku vůbec —
 * pravidlo platí pro cesty, které pozici mění, tahle žádnou nemá.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { withRevision } from "../src/lib/revision.server";
import type { PrismaTransactionClient } from "../src/lib/prismaTx";
import { classifyReservationRow } from "../src/lib/reservationBackfill";
import { loadMachineCalendarRange } from "../src/lib/printTime.server";
import { MAX_SPAN_DAYS } from "../src/lib/printTime";

const APPLY = process.argv.includes("--apply");
const DAY_MS = 24 * 60 * 60 * 1000;
const SYSTEM_USER = { id: 0, username: "system:backfill-reservation-print-minutes" };

type Write = {
  id: number;
  orderNumber: string | null;
  printMinutes: number;
  scheduleBypassed: boolean;
  oldPrintMinutes: number | null;
  oldScheduleBypassed: boolean;
};

async function main() {
  const rows = await prisma.block.findMany({
    where: { type: "REZERVACE" },
    select: {
      id: true, orderNumber: true, machine: true, startTime: true, endTime: true,
      printMinutes: true, scheduleBypassed: true,
    },
    orderBy: { startTime: "asc" },
  });
  console.log(`REZERVACE bloků celkem: ${rows.length} · režim: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  const counts: Record<string, number> = {};
  const writes: Write[] = [];

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
      writes.push({
        id: r.id, orderNumber: r.orderNumber, printMinutes: c.printMinutes, scheduleBypassed: false,
        oldPrintMinutes: r.printMinutes, oldScheduleBypassed: r.scheduleBypassed,
      });
      console.log(`  CONFORMS        ${label} → printMinutes=${c.printMinutes}`);
    } else if (c.kind === "MISMATCH") {
      writes.push({
        id: r.id, orderNumber: r.orderNumber, printMinutes: c.printMinutes, scheduleBypassed: true,
        oldPrintMinutes: r.printMinutes, oldScheduleBypassed: r.scheduleBypassed,
      });
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
  if (writes.length === 0) {
    console.log("\nNic k zápisu (0 řádků CONFORMS/MISMATCH) — transakce se vůbec neotvírá.");
    return;
  }

  const targetIds = writes.map((w) => w.id);

  const { groupId } = await withRevision(
    {
      action: "UPDATE",
      label: "Backfill printMinutes REZERVACE (etapa 9, fáze 1)",
      user: SYSTEM_USER,
      // Dávka může být velká (celý produkční fond REZERVACE bloků) — nikdo na skript
      // interaktivně nečeká, vzor `scripts/revert-revision-group.ts`.
      txOptions: { timeout: 120_000, maxWait: 10_000 },
    },
    async (rtx: PrismaTransactionClient) => {
      // Zamykající re-check MUSÍ být PRVNÍ dotaz v transakci (vzor `undoApply.server.ts`,
      // `revert-revision-group.ts` — pravidlo je i v CLAUDE.md). Mezi dry-run klasifikací
      // (běžela mimo transakci, na obyčejném čtení) a otevřením týhle transakce mohl
      // kdokoli cizí printMinutes daného řádku už vyplnit — obyčejný `findMany` by to
      // pod MySQL REPEATABLE READ neviděl a přepsal by cizí zápis.
      await rtx.$queryRaw`SELECT id FROM Block WHERE id IN (${Prisma.join(targetIds)}) FOR UPDATE`;
      const fresh = await rtx.block.findMany({
        where: { id: { in: targetIds } },
        select: { id: true, printMinutes: true },
      });
      const freshPmById = new Map(fresh.map((b) => [b.id, b.printMinutes]));

      let written = 0;
      let staleSkipped = 0;
      for (const w of writes) {
        if (freshPmById.get(w.id) != null) {
          // Mezitím to vyplnil někdo/něco jiného — idempotence, nepřepisovat.
          staleSkipped++;
          continue;
        }
        await rtx.block.update({
          where: { id: w.id },
          data: { printMinutes: w.printMinutes, scheduleBypassed: w.scheduleBypassed },
        });
        await rtx.auditLog.create({
          data: {
            blockId: w.id,
            orderNumber: w.orderNumber,
            userId: SYSTEM_USER.id,
            username: SYSTEM_USER.username,
            action: "BACKFILL_PRINT_MINUTES",
            field: "printMinutes/scheduleBypassed",
            oldValue: `pm ${w.oldPrintMinutes ?? "null"}, bypassed ${w.oldScheduleBypassed}`,
            newValue: `pm ${w.printMinutes}, bypassed ${w.scheduleBypassed}`,
          },
        });
        written++;
      }
      if (staleSkipped > 0) {
        console.log(`  (${staleSkipped} řádků mezitím vyplnil někdo jiný — přeskočeno, idempotence)`);
      }
      console.log(`\nZapsáno ${written} řádků.`);
    },
  );

  console.log(`\n✅ Hotovo. Revizní skupina: ${groupId} (adresný rollback: scripts/revert-revision-group.ts --group ${groupId}).`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
