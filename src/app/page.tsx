import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import PlannerPage from "./_components/PlannerPage";
import { normalizeBlockVariant } from "@/lib/blockVariants";
import { serializeTemplates } from "@/lib/scheduleValidation";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const isTiskar = session.role === "TISKAR";
  const isPlanner = ["ADMIN", "PLANOVAT"].includes(session.role);

  const blocks = await prisma.block.findMany({
    where: isTiskar && session.assignedMachine ? { machine: session.assignedMachine } : undefined,
    orderBy: { startTime: "asc" },
  });

  // QUEUE_READY rezervace — jen pro PLANOVAT/ADMIN (OBCHODNIK na plánovači nemá přístup k drag&drop)
  const queueReadyReservations = isPlanner
    ? await prisma.reservation.findMany({
        where: { status: "QUEUE_READY" },
        orderBy: { preparedAt: "asc" },
      })
    : [];

  // Serialize Date objects to ISO strings for client component
  const serialized = blocks.map((b) => ({
    ...b,
    blockVariant: normalizeBlockVariant(b.blockVariant, b.type),
    startTime: b.startTime.toISOString(),
    endTime: b.endTime.toISOString(),
    deadlineExpedice: b.deadlineExpedice?.toISOString() ?? null,
    dataRequiredDate: b.dataRequiredDate?.toISOString() ?? null,
    materialRequiredDate: b.materialRequiredDate?.toISOString() ?? null,
    pantoneRequiredDate: b.pantoneRequiredDate?.toISOString() ?? null,
    printCompletedAt: b.printCompletedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }));

  const [companyDays, rawMachineWorkHoursTemplates, machineExceptions] = await Promise.all([
    prisma.companyDay.findMany({ orderBy: { startDate: "asc" } }),
    prisma.machineWorkHoursTemplate.findMany({
      include: { days: { orderBy: { dayOfWeek: "asc" } } },
      orderBy: [{ machine: "asc" }, { isDefault: "desc" }, { validFrom: "asc" }],
    }),
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

  const initialMachineWorkHoursTemplates = serializeTemplates(rawMachineWorkHoursTemplates);

  const serializedQueueReservations = queueReadyReservations.map((r) => ({
    ...r,
    requestedExpeditionDate: r.requestedExpeditionDate.toISOString(),
    requestedDataDate: r.requestedDataDate.toISOString(),
    preparedAt: r.preparedAt?.toISOString() ?? null,
    scheduledStartTime: r.scheduledStartTime?.toISOString() ?? null,
    scheduledEndTime: r.scheduledEndTime?.toISOString() ?? null,
    scheduledAt: r.scheduledAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    planningPayload: r.planningPayload as Record<string, unknown> | null,
  }));

  return <PlannerPage initialBlocks={serialized} initialCompanyDays={serializedCompanyDays} initialMachineWorkHoursTemplates={initialMachineWorkHoursTemplates} initialMachineExceptions={serializedMachineExceptions} currentUser={{ id: session.id, username: session.username, role: session.role, assignedMachine: session.assignedMachine ?? null }} initialQueueReservations={serializedQueueReservations} />;
}
