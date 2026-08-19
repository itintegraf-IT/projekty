import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { cascadeConfirmMessage, CASCADE_CONFIRM_ENFORCED, type CascadeImpact } from "@/lib/cascadeLimit";

/**
 * Jediné místo, které práh VYNUCUJE. Volá se PŘED zápisem posunů — výjimka
 * odroluje celou transakci, takže se nezapíše nic.
 *
 * V režimu měření (`CASCADE_CONFIRM_ENFORCED === false`) se překročení jen
 * zaloguje. Log je jediný podklad pro rozhodnutí, jestli je práh 5 správně —
 * proto nese počet, vzdálenost i cestu, ze které posun přišel.
 */
export function assertCascadeConfirmed(
  impact: CascadeImpact,
  opts: {
    confirmed: boolean;
    path: string;
    /**
     * Identita gesta pro log — na kterém stroji a od kterého bloku (kotvy) se
     * kaskáda spočítala. Bez toho nejde po týdnu měření rozeznat, jestli 31
     * překročení znamená jednoho plánovače opakovaně tahajícího na jednom
     * stroji, nebo 31 různých zakázek napříč strojem. Volitelné: souhrnná
     * volání za celé gesto (`batch-total`, `reflow-machine`) nemají jedinou
     * kotvu, `reflow-machine` má aspoň `machine`.
     */
    machine?: string;
    anchorId?: number;
  },
): void {
  if (!impact.exceeded || opts.confirmed) return;

  const detail = {
    path: opts.path,
    movedCount: impact.movedCount,
    maxShiftHours: Math.round(impact.maxShiftMs / 3_600_000),
    // Doplňkově k maxShiftHours: Math.round(ms / 3_600_000) u třicetiminutové
    // kaskády vyjde 0 — a přesně třicetiminutový posun spustil havárii
    // 17. 8. 2026. Pole, které u nejnebezpečnějšího případu ukazuje nulu, se
    // čte jako „neposunulo se", proto minuty vedle hodin, ne místo nich.
    maxShiftMinutes: Math.round(impact.maxShiftMs / 60_000),
    farthestEnd: impact.farthestEnd?.toISOString() ?? null,
    enforced: CASCADE_CONFIRM_ENFORCED,
    machine: opts.machine ?? null,
    anchorId: opts.anchorId ?? null,
  };

  if (!CASCADE_CONFIRM_ENFORCED) {
    logger.info("[cascade] práh překročen (režim měření, transakce pokračuje)", detail);
    return;
  }

  logger.warn("[cascade] práh překročen — transakce se odroluje", detail);
  throw new AppError("CASCADE_CONFIRM", cascadeConfirmMessage(impact), {
    movedCount: impact.movedCount,
    maxShiftMs: impact.maxShiftMs,
    farthestEnd: impact.farthestEnd?.toISOString() ?? null,
  });
}
