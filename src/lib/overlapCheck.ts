import { AppError } from "@/lib/errors";

type PrismaTransactionClient = Parameters<Parameters<typeof import("@/lib/prisma").prisma.$transaction>[0]>[0];

/**
 * Zkontroluje, zda na daném stroji v daném časovém rozsahu existuje jiný blok.
 * Pokud ano, vyhodí AppError("OVERLAP", ...).
 * Volat uvnitř $transaction PŘED tx.block.update/create.
 */
export async function checkBlockOverlap(
  machine: string,
  startTime: Date,
  endTime: Date,
  excludeBlockId: number | null,
  tx: PrismaTransactionClient
): Promise<void> {
  const conflict = await tx.block.findFirst({
    where: {
      machine,
      ...(excludeBlockId != null && { id: { not: excludeBlockId } }),
      startTime: { lt: endTime },
      endTime: { gt: startTime },
    },
    select: { id: true, orderNumber: true },
  });
  if (conflict) {
    throw new AppError(
      "OVERLAP",
      `Blok koliduje s blokem #${conflict.orderNumber ?? conflict.id} na stroji ${machine}.`
    );
  }
}

/**
 * Finální pojistka. Ověří, že ŽÁDNÝ z `blockIds` nepřekrývá jiný blok na stroji.
 * Volat na KONCI transakce po všech zápisech (i po chain pushi). Při nálezu hodí
 * AppError("OVERLAP") → rollback celé transakce. Zachytí překryv vzniklý jakoukoliv
 * cestou v rámci JEDNÉ transakce (i s bypassOverlapCheck).
 *
 * LIMIT: používá plain `findFirst` (ne `SELECT ... FOR UPDATE`), takže pod MySQL
 * REPEATABLE READ nezavírá okno pro phantom mezi DVĚMA souběžnými transakcemi (dva
 * requesty do stejného volného slotu ve stejný okamžik se v snapshotu neuvidí). To je
 * vzácné (dva plánovači, stejný stroj, stejná sekunda); pro úplnou garanci je potřeba
 * zámek na okno (FOR UPDATE) nebo DB-level constraint — viz follow-up v plánu.
 */
export async function assertNoOverlapForBlocks(
  machine: string,
  blockIds: number[],
  tx: PrismaTransactionClient
): Promise<void> {
  if (blockIds.length === 0) return;
  const blocks = await tx.block.findMany({
    where: { id: { in: blockIds } },
    select: { id: true, orderNumber: true, startTime: true, endTime: true },
  });
  for (const b of blocks) {
    const conflict = await tx.block.findFirst({
      where: {
        machine,
        id: { not: b.id },
        startTime: { lt: b.endTime },
        endTime: { gt: b.startTime },
      },
      select: { id: true, orderNumber: true },
    });
    if (conflict) {
      throw new AppError(
        "OVERLAP",
        `Blok #${b.orderNumber ?? b.id} koliduje s blokem #${conflict.orderNumber ?? conflict.id} na stroji ${machine}.`
      );
    }
  }
}
