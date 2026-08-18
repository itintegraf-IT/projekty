import type { AppliedMove } from "@/lib/overlapResolver.server";

/**
 * Poziční snapshot bloku PŘED autoposunem, serializovaný pro odpověď klientovi.
 *
 * Tvar je ZÁMĚRNĚ totožný s klientským `BlockSnapshot` (`src/lib/undo/types.ts`),
 * takže ho klient pošle do `buildReflowCommand` beze změny. Kdyby se ty dva tvary
 * rozešly, krok historie by tiše zapsal neúplnou obnovu — `printMinutes` a
 * `scheduleBypassed` jsou v `BlockSnapshot` povinné právě proto, že endpoint undo
 * nic nederivuje.
 *
 * Proč snapshot vzniká na SERVERU a ne na klientovi z `blocksRef.current`:
 * klient má načtený jen zobrazený rozsah dní a `applyServerBlocks` bloky mimo něj
 * do stavu nepřidává. Chain push přitom posouvá i bloky o týdny dál (havárie
 * 17. 8. 2026 odsunula zakázky až do září). Bez serverového snapshotu by se
 * takový blok do kroku historie vůbec nedostal.
 */
export type ReflowBeforeSnapshot = {
  id: number;
  startTime: string;
  endTime: string;
  machine: string;
  updatedAt: string;
  printMinutes: number | null;
  scheduleBypassed: boolean;
};

export function moveToBefore(machine: string, m: AppliedMove): ReflowBeforeSnapshot {
  return {
    id: m.id,
    startTime: m.oldStartTime.toISOString(),
    endTime: m.oldEndTime.toISOString(),
    machine,
    updatedAt: m.oldUpdatedAt.toISOString(),
    printMinutes: m.oldPrintMinutes,
    scheduleBypassed: m.oldScheduleBypassed,
  };
}

/**
 * Sloučení snapshotů z několika posunů do jedné dávky. PRVNÍ výskyt vyhrává.
 *
 * Hromadný přepočet stroje jde driftnutými bloky chronologicky, takže TÝŽ blok
 * může být nejdřív odsunut chain pushem dřívějšího bloku a teprve pak sám
 * přepočítán (nebo naopak). Krok historie musí vrátit stav ze ZAČÁTKU celé
 * operace, ne mezistav uvnitř transakce — proto se pozdější snapshot zahazuje.
 */
export function mergeBefore(
  acc: Map<number, ReflowBeforeSnapshot>,
  snaps: readonly ReflowBeforeSnapshot[],
): void {
  for (const s of snaps) if (!acc.has(s.id)) acc.set(s.id, s);
}
