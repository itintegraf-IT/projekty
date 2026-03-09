import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import PlannerPage from "./_components/PlannerPage";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/login");
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

  return <PlannerPage initialBlocks={serialized} initialCompanyDays={serializedCompanyDays} currentUser={session} />;
}
