import type { PrismaTransactionClient } from "@/lib/prismaTx";
import { AppError } from "@/lib/errors";

/** Span bloku v batch dávce po serverovém přepočtu endů. */
export type BatchSpan = {
  id: number;
  orderNumber: string | null;
  machine: string;
  start: Date;
  end: Date;
};

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
 * Pure pre-check překryvu UVNITŘ jedné batch dávky (per stroj, half-open [start, end)).
 * Re-expanze (tiskové hodiny) může sourozencům v lasso přesunu změnit délky — vzniklý
 * intra-group překryv chain push neřeší (sourozenci jsou v excludeIds), takže si zaslouží
 * konkrétní hlášku místo generické 409 z finální pojistky. Vrací první kolidující pár.
 */
export function findIntraBatchOverlap(spans: BatchSpan[]): [BatchSpan, BatchSpan] | null {
  const byMachine = new Map<string, BatchSpan[]>();
  for (const s of spans) {
    const arr = byMachine.get(s.machine) ?? [];
    arr.push(s);
    byMachine.set(s.machine, arr);
  }
  for (const arr of byMachine.values()) {
    const sorted = [...arr].sort((a, b) => a.start.getTime() - b.start.getTime());
    let maxEndSpan = sorted[0]!;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.start.getTime() < maxEndSpan.end.getTime()) return [maxEndSpan, sorted[i]!];
      if (sorted[i]!.end.getTime() > maxEndSpan.end.getTime()) maxEndSpan = sorted[i]!;
    }
  }
  return null;
}

/**
 * Finální pojistka. Ověří, že ŽÁDNÝ z `blockIds` nepřekrývá jiný blok na stroji.
 * Volat na KONCI transakce po všech zápisech (i po chain pushi). Při nálezu hodí
 * AppError("OVERLAP") → rollback celé transakce. Zachytí překryv vzniklý jakoukoliv
 * cestou v rámci JEDNÉ transakce (i s bypassOverlapCheck).
 *
 * Souběžnost: používá `SELECT ... FOR UPDATE`, který pod MySQL REPEATABLE READ bere
 * next-key/gap zámky na okně (machine, čas). Dvě souběžné transakce mířící do stejného
 * volného slotu se proto serializují (druhá počká a po commitu první uvidí její blok)
 * místo tichého phantom překryvu. Vyžaduje index Block(machine, startTime, endTime).
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
    // FOR UPDATE — pod MySQL REPEATABLE READ bere next-key/gap zámky na okně (machine, čas).
    // Souběžná transakce mířící do stejného slotu se zablokuje (a po commitu uvidí náš blok)
    // místo tichého phantom překryvu. Využívá index Block(machine, startTime, endTime).
    const conflicts = await tx.$queryRaw<{ id: number; orderNumber: string | null }[]>`
      SELECT id, orderNumber FROM Block
      WHERE machine = ${machine}
        AND id <> ${b.id}
        AND startTime < ${b.endTime}
        AND endTime > ${b.startTime}
      LIMIT 1
      FOR UPDATE
    `;
    const conflict = conflicts[0];
    if (conflict) {
      throw new AppError(
        "OVERLAP",
        `Blok #${b.orderNumber ?? b.id} koliduje s blokem #${conflict.orderNumber ?? conflict.id} na stroji ${machine}.`
      );
    }
  }
}
