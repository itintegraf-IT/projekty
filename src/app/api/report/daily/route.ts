import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { serializeBlock } from "@/lib/blockSerialization";
import { addDaysToCivilDate, isCivilDateString, pragueToUTC } from "@/lib/dateUtils";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date"); // YYYY-MM-DD

  if (!dateParam || !isCivilDateString(dateParam)) {
    return NextResponse.json({ error: "Chybí parametr date (YYYY-MM-DD)" }, { status: 400 });
  }

  try {
    // Denní tisk je organizovaný jako výrobní den 06:00 -> 06:00 následující den.
    const dayStart = pragueToUTC(dateParam, 6, 0);
    const dayEnd = pragueToUTC(addDaysToCivilDate(dateParam, 1), 6, 0);
    const machineFilter = session.role === "TISKAR" ? { machine: session.assignedMachine ?? undefined } : {};
    const blocks = await prisma.block.findMany({
      where: {
        startTime: { lt: dayEnd },
        endTime:   { gt: dayStart },
        ...machineFilter,
      },
      orderBy: { startTime: "asc" },
    });

    return NextResponse.json(blocks.map(serializeBlock));
  } catch (error) {
    console.error("[GET /api/report/daily]", error);
    return NextResponse.json({ error: "Chyba při načítání bloků" }, { status: 500 });
  }
}
