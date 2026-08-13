/**
 * Souhrn Kontrolního panelu. Čistá funkce bez Reactu, aby šla testovat.
 *
 * Kontrola se počítá jako NESPOČTENÁ, když nemá výsledek (`count === null`)
 * NEBO když nese `error` i přes spočtené číslo (dílčí selhání uvnitř rozpadu).
 * Bez druhé podmínky by dílčí selhání zmizelo a nula by vypadala jako „v pořádku" —
 * přesně to tiché selhání, které má panel odhalovat.
 */
export type HealthSummary = { total: number; badChecks: number; uncomputed: number };

export function summarizeHealth(checks: { count: number | null; error?: string }[]): HealthSummary {
  let total = 0;
  let badChecks = 0;
  let uncomputed = 0;
  for (const c of checks) {
    if (c.count === null || c.error != null) uncomputed++;
    if (c.count != null) {
      total += c.count;
      if (c.count > 0) badChecks++;
    }
  }
  return { total, badChecks, uncomputed };
}
