/**
 * Náprava existujících překrývajících se ZAKAZKA bloků.
 *
 * Najde všechny páry ZAKAZKA bloků na stejném stroji, které se časově překrývají,
 * a posune POZDĚJŠÍ blok páru na nejbližší volné místo za dřívějším blokem
 * (přes findNextFreeSlotFromDb — respektuje pracovní dobu i odstávky).
 *
 * REŽIMY:
 *   npx tsx scripts/fix-existing-overlaps.ts            → DRY-RUN (jen vypíše návrh, nic nemění)
 *   npx tsx scripts/fix-existing-overlaps.ts --apply    → provede posuny v transakci + audit
 *
 * BEZPEČNOST: před --apply VŽDY udělej mysqldump zálohu (viz docs/DEPLOY_WORKFLOW.md 4b).
 * Každý posun běží ve vlastní $transaction s finální pojistkou assertNoOverlapForBlocks —
 * pokud by posun vytvořil nový překryv, transakce se rollbackne a blok se přeskočí.
 */
import { prisma } from "@/lib/prisma";
import { findNextFreeSlotFromDb } from "@/lib/scheduleSlotFinder";
import { assertNoOverlapForBlocks } from "@/lib/overlapCheck";

const APPLY = process.argv.includes("--apply");

type OverlapRow = {
  ida: number; orda: string | null; machine: string; astart: Date; aend: Date;
  idb: number; ordb: string | null; bstart: Date; bend: Date;
};

function fmt(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

async function main() {
  const overlaps = await prisma.$queryRaw<OverlapRow[]>`
    SELECT a.id AS ida, a.orderNumber AS orda, a.machine,
           a.startTime AS astart, a.endTime AS aend,
           b.id AS idb, b.orderNumber AS ordb, b.startTime AS bstart, b.endTime AS bend
    FROM Block a
    JOIN Block b ON a.machine = b.machine AND a.id < b.id
      AND a.startTime < b.endTime AND b.startTime < a.endTime
    WHERE a.type = 'ZAKAZKA' AND b.type = 'ZAKAZKA'
    ORDER BY a.machine, a.startTime
  `;

  console.log(`Režim: ${APPLY ? "APPLY (zapisuje!)" : "DRY-RUN (nic nemění)"}`);
  console.log(`Nalezeno překrývajících se párů: ${overlaps.length}\n`);

  let fixed = 0;
  let skipped = 0;

  for (const ov of overlaps) {
    // anchor = blok s dřívějším startem (zůstane), move = pozdější (posune se za anchor)
    const anchorEnd = ov.astart <= ov.bstart ? ov.aend : ov.bend;
    // $queryRaw vrací číselné sloupce jako BigInt — findNextFreeSlotFromDb/Prisma čekají Int.
    const move =
      ov.astart <= ov.bstart
        ? { id: Number(ov.idb), ord: ov.ordb, start: ov.bstart, end: ov.bend }
        : { id: Number(ov.ida), ord: ov.orda, start: ov.astart, end: ov.aend };
    const durMs = move.end.getTime() - move.start.getTime();

    const slot = await findNextFreeSlotFromDb(ov.machine, anchorEnd, durMs, move.id);

    if (!slot.found) {
      console.log(
        `⚠️  ${ov.machine} #${move.ord ?? move.id}: nenalezen volný slot do 7 dní od ${fmt(anchorEnd)} — PŘESKOČENO`
      );
      skipped++;
      continue;
    }

    console.log(
      `${ov.machine} #${ov.orda ?? ov.ida} (${fmt(ov.astart)}–${fmt(ov.aend)}) × ` +
        `#${ov.ordb ?? ov.idb} (${fmt(ov.bstart)}–${fmt(ov.bend)})\n` +
        `   → posunout #${move.ord ?? move.id} na ${fmt(slot.startTime)}–${fmt(slot.endTime)}`
    );

    if (APPLY) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.block.update({
            where: { id: move.id },
            data: { startTime: slot.startTime, endTime: slot.endTime },
          });
          await tx.auditLog.create({
            data: {
              blockId: move.id,
              orderNumber: move.ord,
              userId: 0,
              username: "system:fix-overlaps",
              action: "OVERLAP_FIX",
              field: "startTime",
              oldValue: move.start.toISOString(),
              newValue: slot.startTime.toISOString(),
            },
          });
          // Finální pojistka — pokud by posun vytvořil nový překryv, rollback.
          await assertNoOverlapForBlocks(ov.machine, [move.id], tx);
        });
        console.log("   ✅ provedeno");
        fixed++;
      } catch (err) {
        console.log(`   ❌ chyba (rollback): ${err instanceof Error ? err.message : String(err)}`);
        skipped++;
      }
    }
  }

  console.log(`\nHotovo. ${APPLY ? `Opraveno: ${fixed}, přeskočeno: ${skipped}` : "Spusť s --apply pro provedení (po záloze!)."}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
