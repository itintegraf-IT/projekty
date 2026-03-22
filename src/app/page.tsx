import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import PlannerPage from "./_components/PlannerPage";
import { normalizeBlockVariant } from "@/lib/blockVariants";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const blocks = await prisma.block.findMany({
    orderBy: { startTime: "asc" },
  });

  // Serialize Date objects to ISO strings for client component
  const serialized = blocks.map((b) => ({
    ...b,
    blockVariant: normalizeBlockVariant(b.blockVariant, b.type),
    startTime: b.startTime.toISOString(),
    endTime: b.endTime.toISOString(),
    deadlineExpedice: b.deadlineExpedice?.toISOString() ?? null,
    dataRequiredDate: b.dataRequiredDate?.toISOString() ?? null,
    materialRequiredDate: b.materialRequiredDate?.toISOString() ?? null,
    printCompletedAt: b.printCompletedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }));

  const [companyDays, machineWorkHours, machineExceptions] = await Promise.all([
    prisma.companyDay.findMany({ orderBy: { startDate: "asc" } }),
    prisma.machineWorkHours.findMany({ orderBy: [{ machine: "asc" }, { dayOfWeek: "asc" }] }),
    prisma.machineScheduleException.findMany({ orderBy: [{ date: "asc" }, { machine: "asc" }] }),
  ]);
  const serializedCompanyDays = companyDays.map((d) => ({
    ...d,
    startDate: d.startDate.toISOString(),
    endDate: d.endDate.toISOString(),
    createdAt: d.createdAt.toISOString(),
  }));

  const serializedMachineExceptions = machineExceptions.map((e) => ({
    ...e,
    date: e.date.toISOString(),
    createdAt: e.createdAt.toISOString(),
  }));

  return <PlannerPage initialBlocks={serialized} initialCompanyDays={serializedCompanyDays} initialMachineWorkHours={machineWorkHours} initialMachineExceptions={serializedMachineExceptions} currentUser={session} />;
}
