import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { serializeBlock } from "@/lib/blockSerialization";
import { addDaysToCivilDate, isCivilDateString, pragueToUTC } from "@/lib/dateUtils";
import { serializeWeekShifts } from "@/lib/scheduleValidation";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date"); // YYYY-MM-DD

  if (!dateParam || !isCivilDateString(dateParam)) {
    return NextResponse.json({ error: "Chybí parametr date (YYYY-MM-DD)" }, { status: 400 });
  }

  // TISKAR bez přiřazeného stroje by u `{ machine: undefined }` dostal report VŠECH strojů
  // (filtr by zmizel) — fail-closed: bez stroje nemá co číst.
  if (session.role === "TISKAR" && !session.assignedMachine) {
    return NextResponse.json({ error: "Tiskař nemá přiřazený stroj." }, { status: 403 });
  }

  try {
    // Denní tisk je organizovaný jako výrobní den 06:00 -> 06:00 následující den.
    const dayStart = pragueToUTC(dateParam, 6, 0);
    const dayEnd = pragueToUTC(addDaysToCivilDate(dateParam, 1), 6, 0);
    // ±28 d: bloky protínající den mohou začínat/končit až MAX_SPAN_DAYS (21 d) mimo
    // den a expanze segmentů potřebuje kalendář celého spanu (+ prev-week tail).
    const calFrom = new Date(dayStart.getTime() - 28 * 86_400_000);
    const calTo = new Date(dayEnd.getTime() + 28 * 86_400_000);
    const machineFilter = session.role === "TISKAR" ? { machine: session.assignedMachine ?? undefined } : {};
    const [blocks, rawWeekShifts, companyDays] = await Promise.all([
      prisma.block.findMany({
        where: { startTime: { lt: dayEnd }, endTime: { gt: dayStart }, ...machineFilter },
        orderBy: { startTime: "asc" },
      }),
      prisma.machineWeekShifts.findMany({ where: { weekStart: { gte: calFrom, lt: calTo } } }),
      prisma.companyDay.findMany({ where: { startDate: { lt: calTo }, endDate: { gt: calFrom } } }),
    ]);

    return NextResponse.json({
      blocks: blocks.map(serializeBlock),
      weekShifts: serializeWeekShifts(rawWeekShifts),
      companyDays,
    });
  } catch (error) {
    logger.error("[GET /api/report/daily]", error);
    return NextResponse.json({ error: "Chyba při načítání bloků" }, { status: 500 });
  }
}
