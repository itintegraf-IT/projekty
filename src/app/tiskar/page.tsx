import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startOfDay, addDays } from "date-fns";
import TiskarMonitor from "./_components/TiskarMonitor";

export default async function TiskarPage() {
  const session = await getSession();
  if (!session || session.role !== "TISKAR") {
    redirect("/");
  }
  if (!session.assignedMachine) {
    redirect("/login");
  }

  const viewStart = startOfDay(new Date());
  const viewEnd = addDays(viewStart, 7);

  const blocks = await prisma.block.findMany({
    where: {
      machine: session.assignedMachine,
      endTime: { gte: viewStart },
      startTime: { lt: viewEnd },
    },
    orderBy: { startTime: "asc" },
  });

  // Serializovat Date → string pro client component
  const serializedBlocks = blocks.map((b) => ({
    ...b,
    startTime: b.startTime.toISOString(),
    endTime: b.endTime.toISOString(),
    deadlineExpedice: b.deadlineExpedice?.toISOString() ?? null,
    dataRequiredDate: b.dataRequiredDate?.toISOString() ?? null,
    materialRequiredDate: b.materialRequiredDate?.toISOString() ?? null,
    printCompletedAt: b.printCompletedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }));

  return (
    <TiskarMonitor
      initialBlocks={serializedBlocks}
      machine={session.assignedMachine}
      username={session.username}
    />
  );
}
