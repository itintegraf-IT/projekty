import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeBlock } from "@/lib/blockSerialization";
import { addDaysToCivilDate, pragueToUTC, utcToPragueDateStr } from "@/lib/dateUtils";
import TiskarMonitor from "./_components/TiskarMonitor";

export default async function TiskarPage() {
  const session = await getSession();
  if (!session || session.role !== "TISKAR") {
    redirect("/");
  }
  if (!session.assignedMachine) {
    redirect("/login");
  }

  const viewStartDate = utcToPragueDateStr(new Date());
  const viewStart = pragueToUTC(viewStartDate, 0, 0);
  const viewEnd = pragueToUTC(addDaysToCivilDate(viewStartDate, 7), 0, 0);

  const blocks = await prisma.block.findMany({
    where: {
      machine: session.assignedMachine,
      endTime: { gte: viewStart },
      startTime: { lt: viewEnd },
    },
    orderBy: { startTime: "asc" },
  });

  // Serializovat Date → string pro client component
  const serializedBlocks = blocks.map(serializeBlock);

  return (
    <TiskarMonitor
      initialBlocks={serializedBlocks}
      machine={session.assignedMachine}
      username={session.username}
    />
  );
}
