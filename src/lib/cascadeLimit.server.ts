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
  opts: { confirmed: boolean; path: string },
): void {
  if (!impact.exceeded || opts.confirmed) return;

  const detail = {
    path: opts.path,
    movedCount: impact.movedCount,
    maxShiftHours: Math.round(impact.maxShiftMs / 3_600_000),
    farthestEnd: impact.farthestEnd?.toISOString() ?? null,
    enforced: CASCADE_CONFIRM_ENFORCED,
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
