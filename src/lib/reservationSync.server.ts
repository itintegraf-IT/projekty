import type { PrismaTransactionClient } from "@/lib/prismaTx";

/**
 * Zrcadlo `Reservation.scheduledMachine/StartTime/EndTime` po posunu bloků —
 * prerekvizita etapy 9 (spec §2, dluh `rezervace_chain_push_dluh.md`).
 *
 * Volá se JEDNOU na konci každé transakce, která mohla posunout blok
 * s `reservationId` (kotva + bloky odsunuté chain pushem) — ne uvnitř
 * `resolveChainPushFromDb`, protože ten aktualizuje jen sousedy, ne kotvu.
 * Zapojených cest je 6 a hlídá je `reservationSyncWiring.test.ts`.
 *
 * Pravidla:
 * - synchronizuje se JEN rezervace, jejíž `scheduledBlockId` ukazuje na daný
 *   blok (stale link po ručním přepnutí typu apod. se nedotýká),
 * - no-op posun (hodnoty shodné) rezervaci NEZAPISUJE — `updatedAt` rezervace
 *   se nesmí zvedat při každém průchodu,
 * - vrací id skutečně změněných rezervací. Notifikace obchodníkovi se z nich
 *   ZATÍM neposílá (rozhodnutí #6 specu, 20. 8. 2026) — až notifikační etapa
 *   přibude, naváže tady, proto funkce nebere `actor`.
 *
 * Post-filtr `reservationId != null` za findMany je záměrně DVOJITÝ (where +
 * filter): fake databáze v testech where nepromítají celé (poučení P9) a bez
 * post-filtru by helper sáhl na `tx.reservation` i tam, kde žádná vazba není.
 */
export async function syncReservationScheduleForBlocks(
  tx: PrismaTransactionClient,
  blockIds: number[],
): Promise<number[]> {
  const unique = [...new Set(blockIds)];
  if (unique.length === 0) return [];
  const rows = (
    await tx.block.findMany({
      where: { id: { in: unique }, reservationId: { not: null } },
      select: { id: true, reservationId: true, machine: true, startTime: true, endTime: true },
    })
  ).filter((r) => r.reservationId != null);
  if (rows.length === 0) return [];

  const reservations = await tx.reservation.findMany({
    where: { id: { in: rows.map((r) => r.reservationId as number) } },
    select: {
      id: true, scheduledBlockId: true, scheduledMachine: true,
      scheduledStartTime: true, scheduledEndTime: true,
    },
  });
  const byId = new Map(reservations.map((r) => [r.id, r]));

  const changed: number[] = [];
  for (const b of rows) {
    const res = byId.get(b.reservationId as number);
    if (!res) continue;
    if (res.scheduledBlockId !== b.id) continue; // stale link — nesynchronizovat
    const same =
      res.scheduledMachine === b.machine &&
      res.scheduledStartTime?.getTime() === b.startTime.getTime() &&
      res.scheduledEndTime?.getTime() === b.endTime.getTime();
    if (same) continue;
    await tx.reservation.update({
      where: { id: res.id },
      data: { scheduledMachine: b.machine, scheduledStartTime: b.startTime, scheduledEndTime: b.endTime },
    });
    changed.push(res.id);
  }
  return changed;
}
