import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function serializeTemplate(t: {
  id: number;
  machine: string;
  label: string | null;
  validFrom: Date;
  validTo: Date | null;
  isDefault: boolean;
  days: { id: number; dayOfWeek: number; startHour: number; endHour: number; isActive: boolean }[];
}) {
  return {
    ...t,
    validFrom: t.validFrom.toISOString().slice(0, 10),
    validTo: t.validTo ? t.validTo.toISOString().slice(0, 10) : null,
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

  const body: { machine: string; days: { dayOfWeek: number; startHour: number; endHour: number; isActive: boolean }[] } =
    await req.json();

  if (!body.machine || !Array.isArray(body.days))
    return NextResponse.json({ error: "Chybí machine nebo days" }, { status: 400 });

  // Validace: všech 7 dní (0–6) musí být přítomno, každý právě jednou
  const sortedDays = [...body.days].map((d) => d.dayOfWeek).sort((a, b) => a - b);
  if (JSON.stringify(sortedDays) !== "[0,1,2,3,4,5,6]")
    return NextResponse.json({ error: "days musí obsahovat každý dayOfWeek 0–6 právě jednou" }, { status: 400 });

  for (const d of body.days) {
    if (!Number.isInteger(d.dayOfWeek) || d.dayOfWeek < 0 || d.dayOfWeek > 6)
      return NextResponse.json({ error: "dayOfWeek musí být celé číslo 0–6" }, { status: 400 });
    if (!Number.isInteger(d.startHour) || d.startHour < 0 || d.startHour > 23)
      return NextResponse.json({ error: "Neplatný startHour" }, { status: 400 });
    if (!Number.isInteger(d.endHour) || d.endHour < 1 || d.endHour > 24)
      return NextResponse.json({ error: "Neplatný endHour" }, { status: 400 });
    if (d.isActive && d.startHour >= d.endHour)
      return NextResponse.json({ error: "startHour musí být menší než endHour" }, { status: 400 });
  }

  const defaultTemplate = await prisma.machineWorkHoursTemplate.findFirst({
    where: { machine: body.machine, isDefault: true },
  });
  if (!defaultTemplate)
    return NextResponse.json({ error: "Výchozí šablona nenalezena — spusťte bootstrap." }, { status: 404 });

  await prisma.$transaction(
    body.days.map((d) =>
      prisma.machineWorkHoursTemplateDay.updateMany({
        where: { templateId: defaultTemplate.id, dayOfWeek: d.dayOfWeek },
        data: { startHour: d.startHour, endHour: d.endHour, isActive: d.isActive },
      })
    )
  );

  // Vrátit aktualizovanou šablonu
  const updated = await prisma.machineWorkHoursTemplate.findUnique({
    where: { id: defaultTemplate.id },
    include: { days: { orderBy: { dayOfWeek: "asc" } } },
  });
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
    days: { dayOfWeek: number; startHour: number; endHour: number; isActive: boolean }[];
  } = await req.json();

  if (!body.machine || !body.validFrom || !Array.isArray(body.days))
    return NextResponse.json({ error: "Chybí povinné pole" }, { status: 400 });
  if (body.label && body.label.length > 255)
    return NextResponse.json({ error: "label musí být nejvýše 255 znaků" }, { status: 400 });

  // Validace dat
  const newFrom = new Date(body.validFrom + "T00:00:00.000Z");
  const newTo = body.validTo ? new Date(body.validTo + "T00:00:00.000Z") : null;

  if (isNaN(newFrom.getTime()))
    return NextResponse.json({ error: "Neplatné datum validFrom" }, { status: 400 });
  if (newTo && isNaN(newTo.getTime()))
    return NextResponse.json({ error: "Neplatné datum validTo" }, { status: 400 });
  if (newTo && newFrom >= newTo)
    return NextResponse.json({ error: "validFrom musí být před validTo" }, { status: 400 });

  // Validace hodin + dayOfWeek
  for (const d of body.days) {
    if (!Number.isInteger(d.dayOfWeek) || d.dayOfWeek < 0 || d.dayOfWeek > 6)
      return NextResponse.json({ error: "dayOfWeek musí být celé číslo 0–6" }, { status: 400 });
    if (!Number.isInteger(d.startHour) || d.startHour < 0 || d.startHour > 23)
      return NextResponse.json({ error: "Neplatný startHour" }, { status: 400 });
    if (!Number.isInteger(d.endHour) || d.endHour < 1 || d.endHour > 24)
      return NextResponse.json({ error: "Neplatný endHour" }, { status: 400 });
    if (d.isActive && d.startHour >= d.endHour)
      return NextResponse.json({ error: "startHour musí být menší než endHour" }, { status: 400 });
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
          days: { create: body.days.map((d) => ({ dayOfWeek: d.dayOfWeek, startHour: d.startHour, endHour: d.endHour, isActive: d.isActive })) },
        },
        include: { days: { orderBy: { dayOfWeek: "asc" } } },
      });
    });
    return NextResponse.json(serializeTemplate(created), { status: 201 });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "OVERLAP")
      return NextResponse.json({ error: "Pro tento stroj již existuje šablona v tomto období" }, { status: 409 });
    throw e;
  }
}
