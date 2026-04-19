import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { civilDateToUTCMidnight, normalizeCivilDateInput, parseCivilDateWriteInput } from "@/lib/dateUtils";
import {
  getSlotRange,
  isValidSlotWindow,
  slotToHour,
} from "@/lib/timeSlots";
import { emitSSE } from "@/lib/eventBus";
import { activeShiftsForDay, type ShiftType } from "@/lib/shifts";

function serializeTemplate(t: {
  id: number;
  machine: string;
  label: string | null;
  validFrom: Date;
  validTo: Date | null;
  isDefault: boolean;
  days: { id: number; dayOfWeek: number; startHour: number; endHour: number; startSlot: number | null; endSlot: number | null; isActive: boolean; morningOn: boolean; afternoonOn: boolean; nightOn: boolean }[];
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
        morningOn: Boolean(d.morningOn),
        afternoonOn: Boolean(d.afternoonOn),
        nightOn: Boolean(d.nightOn),
      };
    }),
  };
}

type DayInput = {
  dayOfWeek: number;
  startHour?: number;
  endHour?: number;
  startSlot?: number;
  endSlot?: number;
  isActive?: boolean;
  morningOn?: boolean;
  afternoonOn?: boolean;
  nightOn?: boolean;
};

type NormalizedDay = {
  dayOfWeek: number;
  startHour: number;
  endHour: number;
  startSlot: number;
  endSlot: number;
  isActive: boolean;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
};

function normalizeDayInput(day: DayInput): NormalizedDay | { error: string } {
  if (!Number.isInteger(day.dayOfWeek) || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
    return { error: "dayOfWeek musí být celé číslo 0–6" };
  }

  // Prefer explicit shift flags if provided
  const hasShiftFlags =
    typeof day.morningOn === "boolean" ||
    typeof day.afternoonOn === "boolean" ||
    typeof day.nightOn === "boolean";

  let morningOn: boolean;
  let afternoonOn: boolean;
  let nightOn: boolean;
  let startHour: number;
  let endHour: number;

  if (hasShiftFlags) {
    morningOn = Boolean(day.morningOn);
    afternoonOn = Boolean(day.afternoonOn);
    nightOn = Boolean(day.nightOn);
    const actives = activeShiftsForDay({ morningOn, afternoonOn, nightOn });
    if (actives.length === 0) {
      startHour = 0;
      endHour = 0;
    } else {
      // Start = nejranější aktivní směna, End = nejpozdější
      // MORNING (6-14), AFTERNOON (14-22), NIGHT (22-24 zapsáno jako 24, přes půlnoc se zatím neřeší)
      startHour = morningOn ? 6 : afternoonOn ? 14 : 22;
      endHour = afternoonOn ? 22 : morningOn ? 14 : 24;
      // Pokud nightOn ale ne ranní/odpolední → 22-24 (pokrývá jen před půlnocí; validátor v Sprintu 4 to opraví)
      if (nightOn && !afternoonOn && !morningOn) {
        startHour = 22;
        endHour = 24;
      }
      // Pokud noční + odpolední bez ranní: 14-24
      if (nightOn && afternoonOn && !morningOn) {
        startHour = 14;
        endHour = 24;
      }
      // Pokud noční + ranní: úsek 22-24 se nepokrývá startHour/endHour souvisle — reprezentujeme jako plný den 0-24
      if (nightOn && morningOn) {
        startHour = 0;
        endHour = 24;
      }
    }
  } else {
    // Fallback: derive shift flags from legacy startHour/endHour
    startHour = day.startHour ?? 0;
    endHour = day.endHour ?? 0;
    morningOn = startHour <= 6 && endHour >= 14;
    afternoonOn = startHour <= 14 && endHour >= 22;
    nightOn = (startHour <= 22 && endHour >= 24) || (startHour === 0 && endHour >= 6);
  }

  const isActive = day.isActive ?? (morningOn || afternoonOn || nightOn);

  // Převod na sloty
  const startSlot = startHour * 2;
  const endSlot = endHour * 2;

  return {
    dayOfWeek: day.dayOfWeek,
    startHour,
    endHour,
    startSlot,
    endSlot,
    isActive,
    morningOn,
    afternoonOn,
    nightOn,
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const templates = await prisma.machineWorkHoursTemplate.findMany({
    include: { days: { orderBy: { dayOfWeek: "asc" } } },
    orderBy: [{ machine: "asc" }, { isDefault: "desc" }, { validFrom: "asc" }],
  });
  return NextResponse.json(templates.map(serializeTemplate));
}

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body: { machine: string; days: DayInput[]; force?: boolean } =
    await req.json();

  if (!body.machine || !Array.isArray(body.days))
    return NextResponse.json({ error: "Chybí machine nebo days" }, { status: 400 });

  // Validace: všech 7 dní (0–6) musí být přítomno, každý právě jednou
  const sortedDays = [...body.days].map((d) => d.dayOfWeek).sort((a, b) => a - b);
  if (JSON.stringify(sortedDays) !== "[0,1,2,3,4,5,6]")
    return NextResponse.json({ error: "days musí obsahovat každý dayOfWeek 0–6 právě jednou" }, { status: 400 });

  const normalizedDays: NormalizedDay[] = [];
  for (const d of body.days) {
    const result = normalizeDayInput(d as DayInput);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    if (result.isActive && !isValidSlotWindow(result.startSlot, result.endSlot))
      return NextResponse.json({ error: "Neplatný rozsah startSlot/endSlot" }, { status: 400 });
    normalizedDays.push(result);
  }

  const defaultTemplate = await prisma.machineWorkHoursTemplate.findFirst({
    where: { machine: body.machine, isDefault: true },
    include: { days: true },
  });
  if (!defaultTemplate)
    return NextResponse.json({ error: "Výchozí šablona nenalezena — spusťte bootstrap." }, { status: 404 });

  // Cascade detection: které směny se vypínají, které měly dříve přiřazení
  const shiftsBeingDisabled: Array<{ dayOfWeek: number; shift: ShiftType }> = [];
  for (const newDay of normalizedDays) {
    const oldDay = defaultTemplate.days.find((d) => d.dayOfWeek === newDay.dayOfWeek);
    if (!oldDay) continue;
    const checks: Array<[ShiftType, boolean, boolean]> = [
      ["MORNING", oldDay.morningOn, newDay.morningOn],
      ["AFTERNOON", oldDay.afternoonOn, newDay.afternoonOn],
      ["NIGHT", oldDay.nightOn, newDay.nightOn],
    ];
    for (const [shift, oldOn, newOn] of checks) {
      if (oldOn && !newOn) shiftsBeingDisabled.push({ dayOfWeek: newDay.dayOfWeek, shift });
    }
  }

  let affectedIdsToDelete: number[] = [];
  let affectedAuditPayload: string | null = null;

  if (shiftsBeingDisabled.length > 0) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const futureAssignments = await prisma.shiftAssignment.findMany({
      where: {
        machine: body.machine,
        date: { gte: today },
        shift: { in: Array.from(new Set(shiftsBeingDisabled.map((s) => s.shift))) },
      },
      include: { printer: true },
    });

    const affected = futureAssignments.filter((a) => {
      const dow = new Date(a.date).getUTCDay();
      return shiftsBeingDisabled.some((s) => s.dayOfWeek === dow && s.shift === a.shift);
    });

    if (affected.length > 0 && !body.force) {
      return NextResponse.json(
        {
          error: "Vypínané směny mají přiřazená obsazení.",
          needsConfirmation: true,
          affectedCount: affected.length,
          affected: affected.slice(0, 20).map((a) => ({
            id: a.id,
            date: a.date.toISOString().slice(0, 10),
            shift: a.shift,
            printerName: a.printer.name,
          })),
        },
        { status: 409 }
      );
    }

    if (affected.length > 0 && body.force) {
      affectedIdsToDelete = affected.map((a) => a.id);
      affectedAuditPayload = JSON.stringify(
        affected.map((a) => ({
          id: a.id,
          date: a.date.toISOString().slice(0, 10),
          shift: a.shift,
          printer: a.printer.name,
        }))
      );
    }
  }

  await prisma.$transaction([
    ...(affectedIdsToDelete.length > 0
      ? [
          prisma.shiftAssignment.deleteMany({
            where: { id: { in: affectedIdsToDelete } },
          }),
          prisma.auditLog.create({
            data: {
              blockId: 0,
              userId: session.id,
              username: session.username,
              action: "CASCADE_DELETE_SHIFT_ASSIGNMENTS",
              field: "ShiftAssignment",
              oldValue: affectedAuditPayload,
              newValue: null,
            },
          }),
        ]
      : []),
    ...normalizedDays.map((d) =>
      prisma.machineWorkHoursTemplateDay.updateMany({
        where: { templateId: defaultTemplate.id, dayOfWeek: d.dayOfWeek },
        data: {
          startHour: d.startHour,
          endHour: d.endHour,
          startSlot: d.startSlot,
          endSlot: d.endSlot,
          isActive: d.isActive,
          morningOn: d.morningOn,
          afternoonOn: d.afternoonOn,
          nightOn: d.nightOn,
        },
      })
    ),
  ]);

  // Vrátit aktualizovanou šablonu
  const updated = await prisma.machineWorkHoursTemplate.findUnique({
    where: { id: defaultTemplate.id },
    include: { days: { orderBy: { dayOfWeek: "asc" } } },
  });
  emitSSE("schedule:changed", { sourceUserId: session.id });
  return NextResponse.json(updated ? serializeTemplate(updated) : null);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body: {
    machine: string;
    label?: string;
    validFrom: string; // YYYY-MM-DD
    validTo?: string;  // YYYY-MM-DD nebo chybí
    days: DayInput[];
  } = await req.json();

  if (!body.machine || !body.validFrom || !Array.isArray(body.days))
    return NextResponse.json({ error: "Chybí povinné pole" }, { status: 400 });
  if (body.label && body.label.length > 255)
    return NextResponse.json({ error: "label musí být nejvýše 255 znaků" }, { status: 400 });

  // Validace dat
  const validFromStr = parseCivilDateWriteInput(body.validFrom);
  const validToStr = body.validTo ? parseCivilDateWriteInput(body.validTo) : null;

  if (!validFromStr)
    return NextResponse.json({ error: "Neplatné datum validFrom" }, { status: 400 });
  if (body.validTo && !validToStr)
    return NextResponse.json({ error: "Neplatné datum validTo" }, { status: 400 });
  const newFrom = civilDateToUTCMidnight(validFromStr);
  const newTo = validToStr ? civilDateToUTCMidnight(validToStr) : null;
  if (newTo && newFrom >= newTo)
    return NextResponse.json({ error: "validFrom musí být před validTo" }, { status: 400 });

  // Validace hodin + dayOfWeek
  const normalizedDays: NormalizedDay[] = [];
  for (const d of body.days) {
    const result = normalizeDayInput(d as DayInput);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    if (result.isActive && !isValidSlotWindow(result.startSlot, result.endSlot))
      return NextResponse.json({ error: "Neplatný rozsah startSlot/endSlot" }, { status: 400 });
    normalizedDays.push(result);
  }

  // Overlap check + create v jedné transakci — prevence race condition při souběžných POST
  const newToSentinel = newTo ?? new Date("9999-12-31T23:59:59.999Z");
  try {
    const created = await prisma.$transaction(async (tx) => {
      const overlapping = await tx.machineWorkHoursTemplate.findFirst({
        where: {
          machine: body.machine,
          isDefault: false,
          AND: [
            { validFrom: { lt: newToSentinel } },
            {
              OR: [
                { validTo: null },
                { validTo: { gt: newFrom } },
              ],
            },
          ],
        },
      });
      if (overlapping) throw Object.assign(new Error("overlap"), { code: "OVERLAP" });

      return tx.machineWorkHoursTemplate.create({
        data: {
          machine: body.machine,
          label: body.label ?? null,
          validFrom: newFrom,
          validTo: newTo,
          isDefault: false,
          days: {
            create: normalizedDays.map((d) => ({
              dayOfWeek: d.dayOfWeek,
              startHour: d.startHour,
              endHour: d.endHour,
              startSlot: d.startSlot,
              endSlot: d.endSlot,
              isActive: d.isActive,
              morningOn: d.morningOn,
              afternoonOn: d.afternoonOn,
              nightOn: d.nightOn,
            })),
          },
        },
        include: { days: { orderBy: { dayOfWeek: "asc" } } },
      });
    });
    emitSSE("schedule:changed", { sourceUserId: session.id });
    return NextResponse.json(serializeTemplate(created), { status: 201 });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "OVERLAP")
      return NextResponse.json({ error: "Pro tento stroj již existuje šablona v tomto období" }, { status: 409 });
    throw e;
  }
}
