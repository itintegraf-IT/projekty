/**
 * Intervalová algebra nad UTC milisekundami.
 *
 * Intervaly jsou POLOOTEVŘENÉ `[start, end)`: konec jednoho a začátek druhého se
 * dotýkají, ale nepřekrývají. Bez toho by se sousední směny počítaly s jednou
 * milisekundou navíc a hlavně by `intersectIntervals` hlásila průnik tam, kde
 * žádný není.
 *
 * `mergeIntervals` sem přišel z `reportMetrics.ts`, kde byl privátní. Kaskáda
 * kapacity potřebuje navíc průnik a rozdíl, a kopírovat tuhle logiku podruhé je
 * cesta k tomu, aby se obě verze rozešly.
 */
export type Interval = { start: number; end: number };

/** Seřadí, sloučí překryvy i dotyky, zahodí prázdné a obrácené. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const clean = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of clean) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

/** Společná část dvou seznamů. Vstupy se slučují, takže nemusí být seřazené. */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const A = mergeIntervals(a);
  const B = mergeIntervals(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    const start = Math.max(A[i].start, B[j].start);
    const end = Math.min(A[i].end, B[j].end);
    if (end > start) out.push({ start, end });
    if (A[i].end < B[j].end) i++;
    else j++;
  }
  return out;
}

/** `from` bez částí, které pokrývá `minus`. */
export function subtractIntervals(from: Interval[], minus: Interval[]): Interval[] {
  const cuts = mergeIntervals(minus);
  const out: Interval[] = [];
  for (const base of mergeIntervals(from)) {
    let cursor = base.start;
    for (const cut of cuts) {
      if (cut.end <= cursor) continue;
      if (cut.start >= base.end) break;
      if (cut.start > cursor) out.push({ start: cursor, end: Math.min(cut.start, base.end) });
      cursor = Math.max(cursor, cut.end);
      if (cursor >= base.end) break;
    }
    if (cursor < base.end) out.push({ start: cursor, end: base.end });
  }
  return out;
}

/**
 * Součet délek v hodinách. HLOUPÝ — překryvy neodečítá.
 *
 * Vstup se musí předem projet `mergeIntervals`. Přesně tenhle krok se v R1
 * zapomněl u směn a nepřetržitý stroj měl 182 dostupných hodin týdně místo 168.
 */
export function totalHours(list: Interval[]): number {
  return list.reduce((sum, i) => sum + (i.end - i.start), 0) / 3_600_000;
}
