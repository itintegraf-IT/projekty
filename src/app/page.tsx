import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import PlannerPage from "./_components/PlannerPage";
import { serializeBlock } from "@/lib/blockSerialization";
import { serializeCompanyDay } from "@/lib/companyDaySerialization";
import { serializeReservation } from "@/lib/reservationSerialization";
import { serializeWeekShifts } from "@/lib/scheduleValidation";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ highlight?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const isTiskar = session.role === "TISKAR";
  const isPlanner = ["ADMIN", "PLANOVAT"].includes(session.role);

  const blocks = await prisma.block.findMany({
    where: isTiskar && session.assignedMachine ? { machine: session.assignedMachine } : undefined,
    orderBy: { startTime: "asc" },
    include: { Reservation: { select: { confirmedAt: true } } },
  });

  // QUEUE_READY rezervace — jen pro PLANOVAT/ADMIN (OBCHODNIK na plánovači nemá přístup k drag&drop)
  const queueReadyReservations = isPlanner
    ? await prisma.reservation.findMany({
        where: { status: "QUEUE_READY" },
        orderBy: { preparedAt: "asc" },
      })
    : [];

  const serialized = blocks.map(serializeBlock);

  const [companyDays, rawWeekShifts] = await Promise.all([
    prisma.companyDay.findMany({ orderBy: { startDate: "asc" } }),
    prisma.machineWeekShifts.findMany({ orderBy: [{ machine: "asc" }, { weekStart: "asc" }, { dayOfWeek: "asc" }] }),
  ]);
  const serializedCompanyDays = companyDays.map(serializeCompanyDay);
  const initialMachineWeekShifts = serializeWeekShifts(rawWeekShifts);

  const params = await searchParams;
  const highlightBlockId = params.highlight ? parseInt(params.highlight, 10) : undefined;
  // Pokud ?highlight=X odkazuje na konkrétní blok, najít jeho orderNumber pro filterText
  const highlightOrderNumber = highlightBlockId && !isNaN(highlightBlockId)
    ? (serialized.find((b) => b.id === highlightBlockId)?.orderNumber ?? undefined)
    : undefined;

  const serializedQueueReservations = queueReadyReservations.map((r) => ({
    ...serializeReservation(r),
    planningPayload: r.planningPayload as Record<string, unknown> | null,
  }));

  return <PlannerPage initialBlocks={serialized} initialCompanyDays={serializedCompanyDays} initialMachineWeekShifts={initialMachineWeekShifts} currentUser={{ id: session.id, username: session.username, role: session.role, assignedMachine: session.assignedMachine ?? null }} initialQueueReservations={serializedQueueReservations} initialFilterText={highlightOrderNumber} />;
}
