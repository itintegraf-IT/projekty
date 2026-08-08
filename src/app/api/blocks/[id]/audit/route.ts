import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { suppressCoveredColumns, type BlockHistoryEntry } from "@/lib/blockHistory";
import { formatRevisionLines } from "@/lib/revisionFormat";
import type { AuditCoverageRow } from "@/lib/auditCoverage";

type RouteContext = { params: Promise<{ id: string }> };

/** Kolik položek panel historie zobrazí (a kolik se jich načte z každého zdroje). */
const HISTORY_LIMIT = 10;

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
        take: HISTORY_LIMIT,
      }),
      prisma.blockRevision.findMany({
        where: { blockId: id },
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT,
      }),
    ]);

    // Predikát potlačení NEJDE vyhodnotit z desetiřádkového okna auditu výš —
    // jedno uložení z BlockEditu vyrobí přes deset auditních řádků, takže starší
    // skupina by z okna vypadla a její revize by se zobrazila, přestože potlačena
    // být má. Výsledek by tak závisel na tom, kolik řádků má nejnovější editace.
    // Ptáme se proto cíleně na dotčené groupId, nezávisle na okně.
    const groupIds = revisionRows.map((r) => r.groupId);
    const coveringRows = groupIds.length
      ? await prisma.auditLog.findMany({
          where: { blockId: id, groupId: { in: groupIds } },
          select: { groupId: true, action: true, field: true, newValue: true },
        })
      : [];

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
        lines,
      });
    }

    // Jedna časová osa, ne dva seznamy. Řetězcové porovnání stačí — obě strany
    // jsou `toISOString()`, tedy týž formát pevné délky.
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json(entries.slice(0, HISTORY_LIMIT));
  } catch (error) {
    logger.error(`[GET /api/blocks/${id}/audit]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
