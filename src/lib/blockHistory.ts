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
      /** Transakce, ze které řádek pochází. Historické řádky ho nemají (sloupec je nullable). */
      groupId: string | null;
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
      /** Transakce, ze které revize pochází. U revizí je vždy vyplněné. */
      groupId: string | null;
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
      /**
       * Změna se do tohohle bloku jen PROMÍTLA — cílem operace byl někdo jiný.
       * Panel to označí stejně jako auditní řádek `SPLIT_PROPAGATE`, aby
       * propagovaná změna nevypadala jako samostatná editace sourozence.
       * Počítá se z `viaMany` + existence adresného cíle ve skupině, viz
       * `groupsWithAddressedTarget`.
       */
      propagated: boolean;
      /** České věty z `formatRevisionLines`. Prázdné pole se do osy nedostane. */
      lines: string[];
    };

/**
 * Skupiny (`groupId`), ve kterých byl aspoň jeden blok jmenován ADRESNĚ
 * (`viaMany === false`), tedy byl přímým cílem operace.
 *
 * Slouží k rozhodnutí, co je propagace: `viaMany` sám o sobě NESTAČÍ.
 * U expedičního zařazení, vyřazení i přeřazení staví routa `targetIds` z celé
 * skupiny, takže přes `updateMany` projde i primární blok a **viaMany=true mají
 * úplně všichni**. Skupina samých `true` znamená „nikdo nebyl jmenován adresně" —
 * je to pravda, ne chyba, ale propagace to není a označit se tak nesmí.
 * Naproti tomu u uložení sdíleného pole na hlavě rozdělené zakázky je hlava
 * adresná (`update`) a sourozenci hromadní (`updateMany`), takže adresný cíl
 * ve skupině existuje a sourozenci propagaci dostanou právem.
 *
 * Predikát je ZÁMĚRNĚ počítaný z dat, ne z výčtu hodnot `action`. Výčet by
 * zastaral ve chvíli, kdy přibude další hromadná cesta — a tahle třída selhání
 * (seznam, na který se zapomnělo) stojí za incidentem `AUDITED_FIELDS`
 * z 5.–6. 8. 2026, kvůli kterému celá etapa B1 vzniká.
 */
export function groupsWithAddressedTarget(
  rows: { groupId: string; viaMany: boolean }[],
): Set<string> {
  const addressed = new Set<string>();
  for (const row of rows) if (!row.viaMany) addressed.add(row.groupId);
  return addressed;
}

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

/**
 * Seřadí sloučenou osu tak, aby JEDNA uživatelská akce držela pohromadě
 * a auditní řádek stál NAD revizí, která ho doplňuje.
 *
 * Proč to nejde prostým řazením podle času: revize se zapisují až v EPILOGU
 * transakce — `withRevision` volá `tx.blockRevision.createMany` teprve po doběhnutí
 * těla (`revision.server.ts`) —, kdežto auditní řádky vznikají uvnitř těla. Revize
 * téže transakce má proto VŽDY pozdější razítko a v sestupném řazení vyskočí NAD
 * auditní řádek, ke kterému patří. Jedno Ctrl+Z se tak čtenáři ukázalo jako dvě
 * události v obráceném pořadí — nejdřív důsledek („Délka tisku: 1,5h → 1h"), pak
 * příčina („↶ vráceno zpět") — nález z proklikávání na produkčních datech 9. 8. 2026.
 *
 * POZOR na past: příčinou NENÍ rozdílná přesnost sloupců. Podle migrací i dev DB
 * mají `AuditLog.createdAt` i `BlockRevision.createdAt` shodně `datetime(3)`
 * (ověřeno review 9. 8. 2026 — první verze tohohle komentáře tvrdila opak).
 * Kdyby se přesnost kdykoli měnila, tenhle helper je pořád potřeba: rozhoduje
 * POŘADÍ ZÁPISU, ne rozlišení razítka. Neodstraňovat ho s odůvodněním, že
 * „sloupce mají stejnou přesnost".
 *
 * Klíčem je `groupId`, který od etapy B1 nesou OBA zdroje: celá skupina se řadí
 * podle svého NEJNOVĚJŠÍHO razítka, uvnitř skupiny jde audit před revizí.
 * Historické řádky bez `groupId` (a tedy bez páru) se řadí samy za sebe podle
 * vlastního času — chovají se přesně jako dřív.
 *
 * ZÁMĚRNĚ se tu nic neslučuje do jedné položky ani nezahazuje: potlačení po
 * sloupcích (`suppressCoveredColumns`) zůstává jediným místem, které něco skrývá.
 * Rozšířit ho místo tohohle by znamenalo riskovat, že se skryje změna stroje —
 * a to je přesně díra, kvůli které etapa B1 vznikla.
 */
export function sortHistoryEntries(entries: BlockHistoryEntry[]): BlockHistoryEntry[] {
  // Nejnovější razítko ve skupině — podle něj se řadí všichni její členové.
  const groupNewest = new Map<string, string>();
  for (const e of entries) {
    if (!e.groupId) continue;
    const cur = groupNewest.get(e.groupId);
    if (cur === undefined || e.createdAt > cur) groupNewest.set(e.groupId, e.createdAt);
  }

  const sortKey = (e: BlockHistoryEntry) => (e.groupId ? groupNewest.get(e.groupId) ?? e.createdAt : e.createdAt);
  // Uvnitř skupiny: audit (0) před revizí (1).
  const rank = (e: BlockHistoryEntry) => (e.source === "audit" ? 0 : 1);

  return [...entries].sort((a, b) => {
    const byGroup = sortKey(b).localeCompare(sortKey(a));
    if (byGroup !== 0) return byGroup;
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    // Stabilní doraz: v rámci téhož zdroje novější (vyšší id) nahoře.
    return b.id - a.id;
  });
}
