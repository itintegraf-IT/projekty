import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { buildAuditWhere, parseAuditFilters } from "@/lib/auditQuery";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const filters = parseAuditFilters(request.nextUrl.searchParams);
  const where = buildAuditWhere(filters);
  const isFirstPage = filters.cursor === undefined;

  try {
    // Cursor stabilita: orderBy POUZE podle id desc. AuditLog.id je auto-increment,
    // takže koreluje s createdAt; tím se eliminuje duplicita/přeskok při shodném
    // timestampu u batch insertů ($transaction).
    const findQuery = {
      where,
      orderBy: { id: "desc" as const },
      take: filters.limit + 1,
      ...(filters.cursor
        ? { cursor: { id: filters.cursor }, skip: 1 }
        : {}),
    };

    // totalCount jen na první stránce — count(where) je drahý pro velký dataset
    // a klient ho potřebuje znát hlavně pro "X z Y" hlavičku.
    const [rows, totalCount] = await Promise.all([
      prisma.auditLog.findMany(findQuery),
      isFirstPage ? prisma.auditLog.count({ where }) : Promise.resolve(null),
    ]);

    const hasMore = rows.length > filters.limit;
    const logs = hasMore ? rows.slice(0, filters.limit) : rows;
    const nextCursor = hasMore ? logs[logs.length - 1].id : null;

    return NextResponse.json({
      logs,
      nextCursor,
      totalCount,
    });
  } catch (error) {
    logger.error("[GET /api/audit]", error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
