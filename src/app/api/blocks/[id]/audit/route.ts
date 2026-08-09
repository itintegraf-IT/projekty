import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { suppressCoveredColumns, groupsWithAddressedTarget, type BlockHistoryEntry } from "@/lib/blockHistory";
import { formatRevisionLines } from "@/lib/revisionFormat";
import type { AuditCoverageRow } from "@/lib/auditCoverage";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Kolik řádků se načte Z KAŽDÉHO ZDROJE zvlášť. NENÍ to strop na celou odpověď —
 * ta jich může nést až dvojnásobek (20 auditních + 20 revizních).
 *
 * Společný strop na SLOUČENÝ seznam tu být NESMÍ, a to je celý smysl téhle
 * konstrukce: auditních řádků je vždycky řádově víc než revizních, protože jedno
 * uložení z BlockEditu jich vyrobí spoustu v JEDINÉ transakci: `AUDITED_FIELDS`
 * má 23 položek, takže horní mez je 23 řádků, a bohaté uložení se naměřilo na
 * 12–18 (ověřeno 9. 8. 2026 během endpointu nad dev DB — 18 změněných
 * auditovaných polí dalo 18 řádků). Revizí přitom ze stejné
 * transakce vznikne typicky JEDNA. Jakýkoli společný ořez proto revize
 * SYSTEMATICKY vytlačí — a revize je u některých změn jediný záznam, který
 * existuje: `machine` v `AUDITED_FIELDS` není, takže o přesunu bloku na jiný
 * stroj jinde stopa NENÍ. Měřeno na produkční kopii (931 bloků / 3602 auditních
 * řádků) mělo víc než 20 auditních řádků 6 bloků, tedy 0,6 % — jenže jsou to
 * zrovna ty nejrušnější, tedy přesně ty, které někdo po havárii vyšetřuje.
 *
 * Známá vlastnost dvou nezávislých oken: konec seznamu je „roztřepený". Když
 * jsou auditní řádky husté a revize řídké, sahá revizní okno časově dál a pod
 * auditní hranicí už jsou v ose vidět jen revize. Je to vědomá cena za to, že
 * se řídký zdroj vůbec zobrazí; alternativa (ořez na novější z obou hranic) je
 * přesně ta vada, kterou tenhle komentář popisuje.
 *
 * Panel má `maxHeight: 220` + `overflowY: auto` (`BlockDetail.tsx`), takže se
 * ani při plných 40 položkách vizuálně nic nerozjede.
 */
const PER_SOURCE_LIMIT = 20;

export async function GET(_: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT", "DTP", "MTZ"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  try {
    const [auditRows, revisionRows] = await Promise.all([
      prisma.auditLog.findMany({
        where: { blockId: id },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE_LIMIT,
      }),
      prisma.blockRevision.findMany({
        where: { blockId: id },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE_LIMIT,
      }),
    ]);

    // Predikát potlačení NEJDE vyhodnotit z auditního okna výš — jedno uložení
    // z BlockEditu vyrobí i osmnáct auditních řádků, takže starší skupina by
    // z dvacetiřádkového okna vypadla a její revize by se zobrazila, přestože
    // potlačena být má. Výsledek by tak závisel na tom, kolik řádků má nejnovější
    // editace. Ptáme se proto cíleně na dotčené groupId, nezávisle na okně.
    const groupIds = revisionRows.map((r) => r.groupId);
    // Druhý dotaz ze stejného důvodu: jestli byl v téže transakci NĚKDO jmenován
    // adresně, se z revizí tohohle bloku poznat nedá — adresný cíl je typicky
    // JINÝ blok (hlava rozdělené zakázky). Dotaz jde přes `BlockRevision_groupId_idx`.
    const [coveringRows, groupRows] = await Promise.all([
      groupIds.length
        ? prisma.auditLog.findMany({
            where: { blockId: id, groupId: { in: groupIds } },
            select: { groupId: true, action: true, field: true, newValue: true },
          })
        : Promise.resolve([]),
      groupIds.length
        ? prisma.blockRevision.findMany({
            where: { groupId: { in: groupIds } },
            select: { groupId: true, viaMany: true },
          })
        : Promise.resolve([]),
    ]);
    const addressedGroups = groupsWithAddressedTarget(groupRows);

    const byGroup = new Map<string, AuditCoverageRow[]>();
    for (const row of coveringRows) {
      // Historické auditní řádky groupId nemají (sloupec je nullable) — ty se
      // s žádnou revizí spárovat nedají a do mapy nepatří.
      if (!row.groupId) continue;
      const list = byGroup.get(row.groupId) ?? [];
      list.push({ action: row.action, field: row.field, newValue: row.newValue });
      byGroup.set(row.groupId, list);
    }

    const entries: BlockHistoryEntry[] = auditRows.map((log) => ({
      source: "audit" as const,
      id: log.id,
      createdAt: log.createdAt.toISOString(),
      username: log.username,
      action: log.action,
      field: log.field,
      oldValue: log.oldValue,
      newValue: log.newValue,
      orderNumber: log.orderNumber,
    }));

    for (const rev of revisionRows) {
      // Vznik a zánik bloku pokrývá AuditLog (CREATE/DELETE) srozumitelněji;
      // navíc `before`/`after` u nich nese CELÝ řádek, ne rozdíl, takže by
      // formátovač vysypal desítky vět o polích, která se nezměnila.
      if (rev.kind !== "UPDATE") continue;
      // `before`/`after` je Json sloupec: co se ukládalo jako `Date`, přijde
      // zpátky jako ISO ŘETĚZEC. `formatRevisionLines` zvládá oba tvary
      // (`asDate` v revisionFormat.ts), takže se tu nic nepřevádí.
      const kept = suppressCoveredColumns(
        (rev.before as Record<string, unknown> | null) ?? {},
        (rev.after as Record<string, unknown> | null) ?? {},
        byGroup.get(rev.groupId) ?? [],
      );
      if (!kept) continue;
      const lines = formatRevisionLines(kept.before, kept.after);
      // Revize beze vět se zahazuje — prázdný řádek v panelu (jen jméno a čas)
      // by čtenáři tvrdil, že se něco stalo, a neřekl co. Nastává legitimně:
      // třeba PRINT_COMPLETE mění jen sloupce, které mají vlastní auditní akci.
      if (lines.length === 0) continue;
      entries.push({
        source: "revision",
        id: rev.id,
        createdAt: rev.createdAt.toISOString(),
        username: rev.username,
        action: rev.action,
        label: rev.label,
        // Propagace jen tehdy, když cílem byl PROKAZATELNĚ někdo jiný. Samotné
        // `viaMany` nestačí — u expedičních cest ho mají všichni včetně
        // primárního bloku (viz `groupsWithAddressedTarget`).
        propagated: rev.viaMany && addressedGroups.has(rev.groupId),
        lines,
      });
    }

    // Jedna časová osa, ne dva seznamy. Řetězcové porovnání stačí — obě strany
    // jsou `toISOString()`, tedy týž formát pevné délky.
    //
    // Sloučený seznam se ZÁMĚRNĚ neořezává (viz `PER_SOURCE_LIMIT`): oříznutí by
    // padlo na revize, protože jich je proti auditu vždycky málo. Strop drží samy
    // dotazy — víc než `2 × PER_SOURCE_LIMIT` položek sem přijít nemůže a panel
    // scrolluje.
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json(entries);
  } catch (error) {
    logger.error(`[GET /api/blocks/${id}/audit]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
