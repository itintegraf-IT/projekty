import { civilDateToUTCMidnight } from "@/lib/dateUtils";
import type { DriftedBlock } from "@/lib/calendarDrift.server";

/**
 * Okno bloků dotčených editací týdne `weekStartStr`: span-overlap s
 * `[weekStart, weekStart + 7d + 6h)`.
 *
 * +6h přesah: NIGHT je forward-semantic (viz `isDateTimeActive` v `shifts.ts`) — nedělní
 * NIGHT flag editovaného týdne pokrývá i pondělí 0:00–6:00 týdne NÁSLEDUJÍCÍHO. Bez přesahu
 * by blok začínající v tomto oknu unikl detekci, i když ho editace reálně ovlivňuje.
 * Span-overlap (ne jen start uvnitř okna) zase chytá bloky ZAČÍNAJÍCÍ v předchozím týdnu
 * a PŘESAHUJÍCÍ do editovaného — starý filtr `startTime: { gte, lt }` je propouštěl bez
 * kontroly (spec 3.9).
 */
export function computeConflictWindow(weekStartStr: string): { from: Date; to: Date } {
  const from = civilDateToUTCMidnight(weekStartStr);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 7);
  to.setUTCHours(to.getUTCHours() + 6);
  return { from, to };
}

export type CascadeDiff = {
  /** Blok ztratil místo v pracovní době TOUTO změnou → BLOKUJE uložení. */
  newlyHomeless: DriftedBlock[];
  /** Spočítaný konec se TOUTO změnou prodloužil → NEBLOKUJE, jen se pojmenuje. */
  newlyLonger: DriftedBlock[];
};

/** „Nemá kde být" = expanze selhala. `END_MISMATCH` znamená, že místo má, jen jiný konec. */
const isHomeless = (d: DriftedBlock): boolean => d.reason !== "END_MISMATCH";

/**
 * Prodloužil se spočítaný konec? Jen tenhle směr je rizikový.
 *
 * Expanze tiskových hodin je MONOTÓNNÍ ve směnách: přidání směny = víc runnable slotů =
 * spočítaný konec DŘÍV (neškodné, chain push jde jen dopředu a kratší blok nemá koho
 * odsunout), zkrácení směny = konec POZDĚJI (latentní detonátor — příští dotek bloku ho
 * nafoukne a odsune navazující zakázky).
 */
const isLonger = (d: DriftedBlock): boolean =>
  d.reason === "END_MISMATCH" && d.expectedEnd !== null && d.expectedEnd.getTime() > d.endTime.getTime();

/**
 * DIFERENČNÍ porovnání skutečného stavu před a po zápisu směn.
 *
 * Vstupem jsou dva výstupy `detectCalendarDrift` z TÉŽE transakce — před upserty a po nich.
 * Cílový stav se tedy NEsimuluje, jen měří; kdyby někdo `before` omylem načetl až po
 * upsertech, vyjde `before == after` a kontrola MLČÍ — degradace do bezpečného směru.
 *
 * „Newly" = je v `after` a NEBYL v téže kategorii v `before`. Proto se salámová cesta
 * (rozejitý konec → vystěhování druhým uložením) ohlásí zdarma.
 */
export function classifyCascade(before: DriftedBlock[], after: DriftedBlock[]): CascadeDiff {
  const wasHomeless = new Set(before.filter(isHomeless).map((b) => b.id));
  const wasLonger = new Set(before.filter(isLonger).map((b) => b.id));
  return {
    newlyHomeless: after.filter((a) => isHomeless(a) && !wasHomeless.has(a.id)),
    newlyLonger: after.filter((a) => isLonger(a) && !wasLonger.has(a.id)),
  };
}
