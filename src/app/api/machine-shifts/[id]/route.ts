import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { civilDateToUTCMidnight, normalizeCivilDateInput, parseCivilDateWriteInput } from "@/lib/dateUtils";
import {
  getSlotRange,
  isValidSlotWindow,
  legacyHoursFromSlots,
  slotToHour,
} from "@/lib/timeSlots";
import { emitSSE } from "@/lib/eventBus";

type RouteContext = { params: Promise<{ id: string }> };

function serializeTemplate(t: {
  id: number;
  machine: string;
  label: string | null;
  validFrom: Date;
  validTo: Date | null;
  isDefault: boolean;
  days: { id: number; dayOfWeek: number; startHour: number; endHour: number; startSlot: number | null; endSlot: number | null; isActive: boolean }[];
}) {
  return {
    ...t,
    validFrom: normalizeCivilDateInput(t.validFrom)!,
    validTo: normalizeCivilDateInput(t.validTo),
    days: t.days.map((d) => {
      const { startSlot, endSlot } = getSlotRange(d);
      return {
        ...d,
        startHour: slotToHour(startSlot),
        endHour: slotToHour(endSlot),
        startSlot,
        endSlot,
      };
    }),
  };
}

export async function PUT(
  req: NextRequest,
  { params }: RouteContext
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!id || isNaN(id))
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });

  const body: {
    label?: string | null;
    validFrom?: string;  // YYYY-MM-DD — ignorováno pro default šablony
    validTo?: string | null;
    days?: { dayOfWeek: number; startHour?: number; endHour?: number; startSlot?: number; endSlot?: number; isActive: boolean }[];
  } = await req.json();

  const template = await prisma.machineWorkHoursTemplate.findUnique({
    where: { id },
    include: { days: true },
  });
  if (!template)
    return NextResponse.json({ error: "Šablona nenalezena" }, { status: 404 });

  // Výchozí šablona: nesmí měnit validFrom/validTo ani isDefault — jen child dny a label
  if (template.isDefault && (body.validFrom !== undefined || body.validTo !== undefined))
    return NextResponse.json({ error: "Výchozí šabloně nelze nastavit datum platnosti" }, { status: 400 });

  // Validace hodin pokud jsou days přítomny
  let normalizedDays:
    Array<{ dayOfWeek: number; startHour: number; endHour: number; startSlot: number; endSlot: number; isActive: boolean }>
    | null = null;
  if (body.days) {
    normalizedDays = [];
    for (const d of body.days) {
      let range;
      try {
        range = getSlotRange(d);
      } catch {
        return NextResponse.json({ error: "Chybí startSlot/endSlot nebo startHour/endHour" }, { status: 400 });
      }
      if (!isValidSlotWindow(range.startSlot, range.endSlot))
        return NextResponse.json({ error: "Neplatný rozsah startSlot/endSlot" }, { status: 400 });
      normalizedDays.push({ dayOfWeek: d.dayOfWeek, ...legacyHoursFromSlots(range.startSlot, range.endSlot), ...range, isActive: d.isActive });
    }
  }

  // Metadata update + child days update v jedné transakci
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const metaUpdate: Record<string, unknown> = {};
      if (body.label !== undefined) metaUpdate.label = body.label;
      if (!template.isDefault) {
        if (body.validFrom !== undefined) {
          const validFrom = parseCivilDateWriteInput(body.validFrom);
          if (!validFrom) {
            throw Object.assign(new Error("invalid-validFrom"), { code: "INVALID_VALID_FROM" });
          }
          metaUpdate.validFrom = civilDateToUTCMidnight(validFrom);
        }
        if (body.validTo !== undefined) {
          if (body.validTo === null || body.validTo === "") {
            metaUpdate.validTo = null;
          } else {
            const validTo = parseCivilDateWriteInput(body.validTo);
            if (!validTo) {
              throw Object.assign(new Error("invalid-validTo"), { code: "INVALID_VALID_TO" });
            }
            metaUpdate.validTo = civilDateToUTCMidnight(validTo);
          }
        }
      }
      if (Object.keys(metaUpdate).length > 0) {
        await tx.machineWorkHoursTemplate.update({ where: { id }, data: metaUpdate });
      }

      if (normalizedDays) {
        await Promise.all(
          normalizedDays.map((d) =>
            tx.machineWorkHoursTemplateDay.updateMany({
              where: { templateId: id, dayOfWeek: d.dayOfWeek },
              data: {
                startHour: d.startHour,
                endHour: d.endHour,
                startSlot: d.startSlot,
                endSlot: d.endSlot,
                isActive: d.isActive,
              },
            })
          )
        );
      }

      return tx.machineWorkHoursTemplate.findUnique({
        where: { id },
        include: { days: { orderBy: { dayOfWeek: "asc" } } },
      });
    });

    if (!updated) return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
    emitSSE("schedule:changed", { sourceUserId: session.id });
    return NextResponse.json(serializeTemplate(updated));
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "INVALID_VALID_FROM") {
      return NextResponse.json({ error: "Neplatné datum validFrom" }, { status: 400 });
    }
    if (code === "INVALID_VALID_TO") {
      return NextResponse.json({ error: "Neplatné datum validTo" }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(
  _req: Request,
  { params }: RouteContext
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!id || isNaN(id))
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });

  const template = await prisma.machineWorkHoursTemplate.findUnique({ where: { id }, select: { isDefault: true } });
  if (!template)
    return NextResponse.json({ error: "Šablona nenalezena" }, { status: 404 });

  // Výchozí šablonu nelze smazat — smazání by deaktivovalo veškerou validaci provozních hodin
  if (template.isDefault)
    return NextResponse.json({ error: "Výchozí šablonu nelze smazat" }, { status: 403 });

  await prisma.machineWorkHoursTemplate.delete({ where: { id } });
  emitSSE("schedule:changed", { sourceUserId: session.id });
  return new NextResponse(null, { status: 204 });
}
