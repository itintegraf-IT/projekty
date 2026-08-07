/** Sloupce, které se do rozdílu NIKDY nepočítají. */
const IGNORED = new Set(["updatedAt"]);

export type RevisionDiff = {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null) return a === b;
  return a === b;
}

/**
 * Rozdíl dvou řádků Block. Vrací `null`, když se věcně nic nezměnilo.
 *
 * `updatedAt` je vyloučeno záměrně: Prisma ho mění při KAŽDÉM zápisu, takže
 * s ním by se prázdný rozdíl nikdy nekonal a split propagace by u každého
 * sourozence vyrobila prázdný řádek historie při každém uložení z BlockEditu.
 * Verze se ukládá zvlášť do `BlockRevision.rowVersion`.
 */
export function computeRevisionDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): RevisionDiff | null {
  const outBefore: Record<string, unknown> = {};
  const outAfter: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    if (IGNORED.has(key)) continue;
    const a = before[key] ?? null;
    const b = after[key] ?? null;
    if (sameValue(a, b)) continue;
    outBefore[key] = a;
    outAfter[key] = b;
  }

  return Object.keys(outAfter).length === 0 ? null : { before: outBefore, after: outAfter };
}
