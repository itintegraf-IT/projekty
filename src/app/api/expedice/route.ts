import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getExpeditionDayKey } from "@/lib/expedition";
import { civilDateToUTCMidnight } from "@/lib/dateUtils";
import type {
  ExpediceDay,
  ExpediceItem,
  ExpediceCandidate,
  ExpediceManualItem,
} from "@/lib/expediceTypes";

function addDays(dateKey: string, n: number): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const daysBack = Math.max(0, parseInt(searchParams.get("daysBack") ?? "3", 10) || 3);
    const daysAhead = Math.max(1, parseInt(searchParams.get("daysAhead") ?? "14", 10) || 14);

    const todayKey = getExpeditionDayKey(new Date())!;
    const rangeStart = civilDateToUTCMidnight(addDays(todayKey, -daysBack));
    const rangeEnd = civilDateToUTCMidnight(addDays(todayKey, daysAhead));

    const [publishedBlocks, scheduledManual, candidateBlocks, queueManual] =
      await Promise.all([
        prisma.block.findMany({
          where: {
            expeditionPublishedAt: { not: null },
            deadlineExpedice: { gte: rangeStart, lte: rangeEnd },
          },
          select: {
            id: true,
            orderNumber: true,
            description: true,
            expediceNote: true,
            doprava: true,
            deadlineExpedice: true,
            expeditionSortOrder: true,
            machine: true,
          },
          orderBy: [{ deadlineExpedice: "asc" }, { expeditionSortOrder: "asc" }],
        }),
        prisma.expeditionManualItem.findMany({
          where: {
            date: { gte: rangeStart, lte: rangeEnd },
          },
          orderBy: [{ date: "asc" }, { expeditionSortOrder: "asc" }],
        }),
        prisma.block.findMany({
          where: {
            type: "ZAKAZKA",
            deadlineExpedice: { not: null },
            expeditionPublishedAt: null,
          },
          select: {
            id: true,
            orderNumber: true,
            description: true,
            expediceNote: true,
            doprava: true,
            deadlineExpedice: true,
            machine: true,
            updatedAt: true,
          },
          orderBy: [{ deadlineExpedice: "asc" }, { updatedAt: "desc" }],
        }),
        prisma.expeditionManualItem.findMany({
          where: { date: null },
          orderBy: { createdAt: "desc" },
        }),
      ]);

    // Build dayMap from published blocks and scheduled manual items
    const dayMap = new Map<string, ExpediceDay>();

    for (const block of publishedBlocks) {
      const dayKey = getExpeditionDayKey(block.deadlineExpedice);
      if (!dayKey) continue;
      if (!dayMap.has(dayKey)) {
        dayMap.set(dayKey, { date: dayKey, items: [] });
      }
      const item: ExpediceItem = {
        sourceType: "block",
        itemKind: "PLANNED_JOB",
        id: block.id,
        orderNumber: block.orderNumber,
        description: block.description,
        expediceNote: block.expediceNote,
        doprava: block.doprava,
        deadlineExpedice: dayKey,
        expeditionSortOrder: block.expeditionSortOrder,
        machine: block.machine,
      };
      dayMap.get(dayKey)!.items.push(item);
    }

    for (const manual of scheduledManual) {
      const dayKey = getExpeditionDayKey(manual.date);
      if (!dayKey) continue;
      if (!dayMap.has(dayKey)) {
        dayMap.set(dayKey, { date: dayKey, items: [] });
      }
      const item: ExpediceManualItem = {
        sourceType: "manual",
        itemKind: manual.kind as "MANUAL_JOB" | "INTERNAL_TRANSFER",
        id: manual.id,
        orderNumber: manual.orderNumber,
        description: manual.description,
        expediceNote: manual.expediceNote,
        doprava: manual.doprava,
        date: dayKey,
        expeditionSortOrder: manual.expeditionSortOrder,
      };
      dayMap.get(dayKey)!.items.push(item);
    }

    // Sort days ASC, items within each day by expeditionSortOrder ASC (null last)
    const days: ExpediceDay[] = Array.from(dayMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((day) => ({
        ...day,
        items: [...day.items].sort(
          (a, b) => (a.expeditionSortOrder ?? Infinity) - (b.expeditionSortOrder ?? Infinity)
        ),
      }));

    // Candidates: published blocks without expeditionPublishedAt
    const candidates: ExpediceCandidate[] = candidateBlocks
      .filter((b) => b.deadlineExpedice !== null)
      .map((b) => ({
        id: b.id,
        orderNumber: b.orderNumber,
        description: b.description,
        expediceNote: b.expediceNote,
        doprava: b.doprava,
        deadlineExpedice: getExpeditionDayKey(b.deadlineExpedice)!,
        machine: b.machine,
      }));

    // Queue items: manual items with date = null
    const queueItems: ExpediceManualItem[] = queueManual.map((m) => ({
      sourceType: "manual" as const,
      itemKind: m.kind as "MANUAL_JOB" | "INTERNAL_TRANSFER",
      id: m.id,
      orderNumber: m.orderNumber,
      description: m.description,
      expediceNote: m.expediceNote,
      doprava: m.doprava,
      date: null,
      expeditionSortOrder: m.expeditionSortOrder,
    }));

    return NextResponse.json({ days, candidates, queueItems });
  } catch (error) {
    console.error("[GET /api/expedice]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
