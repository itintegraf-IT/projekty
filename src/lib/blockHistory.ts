import { coveredColumns, type AuditCoverageRow } from "./auditCoverage";

type Row = Record<string, unknown>;

/**
 * Položka sloučené osy historie bloku (`GET /api/blocks/[id]/audit`).
 *
 * ZÁMĚRNĚ samostatný typ, ne rozšíření `AuditLogEntry`: ten má v repu DVĚ
 * nezávislé definice (`src/components/InfoPanel.tsx` a
 * `src/components/admin/AuditLogPanel.tsx`), každá obsluhuje jiný endpoint
 * (`/api/audit/today`, `/api/admin/audit`) a jeho rozšíření o revizní varianty
 * by tiše vyprázdnilo panel notifikací i admin log.
 *
 * Diskriminátor `source` je povinný na OBOU větvích, aby TypeScript zúžil unii
 * v renderu — bez něj by přístup na `log.field` v auditní větvi neprošel.
 */
export type BlockHistoryEntry =
  | {
      source: "audit";
      id: number;
      createdAt: string;
      username: string;
      action: string;
      field: string | null;
      oldValue: string | null;
      newValue: string | null;
      orderNumber: string | null;
    }
  | {
      source: "revision";
      id: number;
      createdAt: string;
      username: string;
      /** `RevisionAction` — mutační CESTA. Slouží k ladění, popisek se bere z `label`. */
      action: string;
      /**
       * Lidský popisek děje, který revizi vyrobil. Pro čtenáře je to JEDINÝ
       * zdroj: `action` neodliší směr u všech případů a u přeřazení v expedici
       * (`EXPEDITION_REORDER`) neexistuje žádný auditní řádek, ze kterého by
       * se dal popisek odvodit.
       */
      label: string;
      /** České věty z `formatRevisionLines`. Prázdné pole se do osy nedostane. */
      lines: string[];
    };

/**
 * Z revizního rozdílu odečte sloupce, které v téže transakci pokrývá auditní
 * řádek. Vrací `null`, když po odečtení nezbude nic (celý rozdíl už čtenáři
 * řekly auditní řádky).
 *
 * Odečítá se po SLOUPCÍCH, ne po celém řádku: jeden PUT z BlockEditu nese
 * zároveň obchodní pole (auditovaná) i změnu délky nebo pozice (neauditovanou).
 * Potlačení po řádcích by tu poziční změnu zahodilo — přesně tu, kvůli které
 * revize vznikají (incident 5.–6. 8. 2026).
 *
 * Třetí parametr je CELÝ auditní řádek (`action`+`field`+`newValue`), ne jen
 * dvojice: undo/redo zapisuje seznam vrácených sloupců do `newValue`, `field`
 * u něj nese jen marker. Podrobně viz `auditCoverage.ts`.
 */
export function suppressCoveredColumns(
  diffBefore: Row,
  diffAfter: Row,
  auditRows: AuditCoverageRow[],
): { before: Row; after: Row } | null {
  const covered = new Set<string>();
  for (const row of auditRows) {
    const cols = coveredColumns(row);
    if (cols === "ALL") return null;
    cols.forEach((c) => covered.add(c));
  }

  const before: Row = {};
  const after: Row = {};
  // Řídí se klíči z `after`: `computeRevisionDiff` plní obě strany stejnými
  // klíči, takže `after` je úplný seznam změněných sloupců.
  for (const key of Object.keys(diffAfter)) {
    if (covered.has(key)) continue;
    // `??` (ne `||`): `false` a `0` jsou platné hodnoty „před", které by
    // `||` přepsalo na null a formátovač by pak tvrdil, že hodnota chyběla.
    before[key] = diffBefore[key] ?? null;
    after[key] = diffAfter[key];
  }

  return Object.keys(after).length === 0 ? null : { before, after };
}
