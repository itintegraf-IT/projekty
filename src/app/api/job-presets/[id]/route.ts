import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { normalizeBlockVariant } from "@/lib/blockVariants";
import { presetHasConfiguredValues, type JobPresetMachine } from "@/lib/jobPresets";

const WRITE_ROLES = ["ADMIN", "PLANOVAT"];
const CATEGORY_BY_FIELD = {
  dataStatusId: "DATA",
  materialStatusId: "MATERIAL",
  barvyStatusId: "BARVY",
  lakStatusId: "LAK",
} as const;

type RouteContext = { params: Promise<{ id: string }> };

type PatchBody = {
  name?: unknown;
  isActive?: unknown;
  sortOrder?: unknown;
  appliesToZakazka?: unknown;
  appliesToRezervace?: unknown;
  machineConstraint?: unknown;
  blockVariant?: unknown;
  specifikace?: unknown;
  dataStatusId?: unknown;
  dataRequiredDateOffsetDays?: unknown;
  materialStatusId?: unknown;
  materialRequiredDateOffsetDays?: unknown;
  materialInStock?: unknown;
  pantoneRequiredDateOffsetDays?: unknown;
  barvyStatusId?: unknown;
  lakStatusId?: unknown;
  deadlineExpediceOffsetDays?: unknown;
};

function parseNullableInt(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseNullableBool(value: unknown): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  return undefined;
}

function parseMachineConstraint(value: unknown): JobPresetMachine | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return value === "XL_105" || value === "XL_106" ? value : undefined;
}

async function validateCodebookRefs(data: Record<string, unknown>) {
  const entries = Object.entries(CATEGORY_BY_FIELD).filter(([field]) => data[field] !== undefined && data[field] !== null);
  if (entries.length === 0) return null;

  const ids = entries.map(([field]) => Number(data[field]));
  const options = await prisma.codebookOption.findMany({
    where: { id: { in: ids } },
    select: { id: true, category: true },
  });
  const byId = new Map(options.map((option) => [option.id, option.category]));

  for (const [field, category] of entries) {
    const id = Number(data[field]);
    const actual = byId.get(id);
    if (!actual) return `Položka číselníku pro ${field} neexistuje.`;
    if (actual !== category) return `Položka číselníku pro ${field} musí být z kategorie ${category}.`;
  }

  return null;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const numId = Number(id);
  if (Number.isNaN(numId)) return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });

  const preset = await prisma.jobPreset.findUnique({ where: { id: numId } });
  if (!preset) return NextResponse.json({ error: "Preset nenalezen" }, { status: 404 });

  return NextResponse.json(preset);
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!WRITE_ROLES.includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const numId = Number(id);
  if (Number.isNaN(numId)) return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });

  try {
    const existing = await prisma.jobPreset.findUnique({ where: { id: numId } });
    if (!existing) {
      return NextResponse.json({ error: "Preset nenalezen" }, { status: 404 });
    }

    const body = await request.json() as PatchBody;
    const patch: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: "Název presetu je povinný." }, { status: 400 });
      if (existing.isSystemPreset && name !== existing.name) {
        return NextResponse.json({ error: "Systémový preset nelze přejmenovat." }, { status: 409 });
      }
      patch.name = name;
    }

    if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);
    if (body.sortOrder !== undefined) {
      const sortOrder = Number(body.sortOrder);
      if (!Number.isInteger(sortOrder)) return NextResponse.json({ error: "Neplatné pořadí presetu." }, { status: 400 });
      patch.sortOrder = sortOrder;
    }
    if (body.appliesToZakazka !== undefined) patch.appliesToZakazka = Boolean(body.appliesToZakazka);
    if (body.appliesToRezervace !== undefined) patch.appliesToRezervace = Boolean(body.appliesToRezervace);

    if (body.machineConstraint !== undefined) {
      const machineConstraint = parseMachineConstraint(body.machineConstraint);
      if (machineConstraint === undefined) return NextResponse.json({ error: "Neplatné omezení stroje." }, { status: 400 });
      patch.machineConstraint = machineConstraint;
    }

    if (body.blockVariant !== undefined) {
      patch.blockVariant = body.blockVariant === null || body.blockVariant === ""
        ? null
        : normalizeBlockVariant(String(body.blockVariant), "ZAKAZKA");
    }
    if (body.specifikace !== undefined) {
      patch.specifikace = body.specifikace === null || String(body.specifikace).trim() === ""
        ? null
        : String(body.specifikace).trim();
    }

    const intFields = [
      "dataStatusId",
      "dataRequiredDateOffsetDays",
      "materialStatusId",
      "materialRequiredDateOffsetDays",
      "pantoneRequiredDateOffsetDays",
      "barvyStatusId",
      "lakStatusId",
      "deadlineExpediceOffsetDays",
    ] as const;
    for (const field of intFields) {
      if (body[field] !== undefined) {
        const parsed = parseNullableInt(body[field]);
        if (parsed === undefined) return NextResponse.json({ error: `Neplatná hodnota pro ${field}.` }, { status: 400 });
        patch[field] = parsed;
      }
    }

    if (body.materialInStock !== undefined) {
      const parsed = parseNullableBool(body.materialInStock);
      if (parsed === undefined) return NextResponse.json({ error: "Neplatná hodnota pro materialInStock." }, { status: 400 });
      patch.materialInStock = parsed;
    }

    const merged = { ...existing, ...patch };
    if (!merged.appliesToZakazka && !merged.appliesToRezervace) {
      return NextResponse.json({ error: "Preset musí být povolen alespoň pro zakázku nebo rezervaci." }, { status: 400 });
    }
    if (merged.blockVariant && !merged.appliesToZakazka) {
      return NextResponse.json({ error: "Stav zakázky lze použít jen u presetů pro zakázku." }, { status: 400 });
    }
    if (merged.materialInStock === true && merged.materialRequiredDateOffsetDays !== null) {
      return NextResponse.json({ error: "Materiál skladem nelze kombinovat s datumovým offsetem materiálu." }, { status: 400 });
    }
    if (!presetHasConfiguredValues(merged)) {
      return NextResponse.json({ error: "Preset musí mít alespoň jedno nastavené pole." }, { status: 400 });
    }

    const codebookError = await validateCodebookRefs(patch);
    if (codebookError) {
      return NextResponse.json({ error: codebookError }, { status: 400 });
    }

    const updated = await prisma.jobPreset.update({
      where: { id: numId },
      data: patch,
    });

    return NextResponse.json(updated);
  } catch (error) {
    logger.error(`[PUT /api/job-presets/${numId}]`, error);
    return NextResponse.json({ error: "Chyba při ukládání presetu" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!WRITE_ROLES.includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const numId = Number(id);
  if (Number.isNaN(numId)) return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });

  try {
    const existing = await prisma.jobPreset.findUnique({ where: { id: numId } });
    if (!existing) {
      return NextResponse.json({ error: "Preset nenalezen" }, { status: 404 });
    }
    if (existing.isSystemPreset) {
      return NextResponse.json({ error: "Systémový preset nelze smazat." }, { status: 409 });
    }

    await prisma.jobPreset.delete({ where: { id: numId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error(`[DELETE /api/job-presets/${numId}]`, error);
    return NextResponse.json({ error: "Chyba při mazání presetu" }, { status: 500 });
  }
}
