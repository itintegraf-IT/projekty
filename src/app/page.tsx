import { prisma } from "@/lib/prisma";
import PlannerPage from "./_components/PlannerPage";

export default async function HomePage() {
  const blocks = await prisma.block.findMany({
    orderBy: { startTime: "asc" },
  });

  // Serialize Date objects to ISO strings for client component
  const serialized = blocks.map((b) => ({
    ...b,
    startTime: b.startTime.toISOString(),
    endTime: b.endTime.toISOString(),
    deadlineData: b.deadlineData?.toISOString() ?? null,
    deadlineMaterial: b.deadlineMaterial?.toISOString() ?? null,
    deadlineExpedice: b.deadlineExpedice?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }));

  return <PlannerPage initialBlocks={serialized} />;
}
