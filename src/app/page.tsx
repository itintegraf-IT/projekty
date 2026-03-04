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
    deadlineExpedice: b.deadlineExpedice?.toISOString() ?? null,
    dataRequiredDate: b.dataRequiredDate?.toISOString() ?? null,
    materialRequiredDate: b.materialRequiredDate?.toISOString() ?? null,
    pantoneExpectedDate: b.pantoneExpectedDate?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }));

  const companyDays = await prisma.companyDay.findMany({ orderBy: { startDate: "asc" } });
  const serializedCompanyDays = companyDays.map((d) => ({
    ...d,
    startDate: d.startDate.toISOString(),
    endDate: d.endDate.toISOString(),
    createdAt: d.createdAt.toISOString(),
  }));

  return <PlannerPage initialBlocks={serialized} initialCompanyDays={serializedCompanyDays} />;
}
