import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { presetHasConfiguredValues, type JobPresetMachine } from "@/lib/jobPresets";
import { normalizeBlockVariant } from "@/lib/blockVariants";

const WRITE_ROLES = ["ADMIN", "PLANOVAT"];
const CATEGORY_BY_FIELD = {
  dataStatusId: "DATA",
  materialStatusId: "MATERIAL",
  barvyStatusId: "BARVY",
  lakStatusId: "LAK",
} as const;

type UpsertBody = {
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
    if (!actual) {
      return `Položka číselníku pro ${field} neexistuje.`;
    }
    if (actual !== category) {
      return `Položka číselníku pro ${field} musí být z kategorie ${category}.`;
    }
  }

  return null;
}

function normalizeBody(body: UpsertBody) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const appliesToZakazka = body.appliesToZakazka === undefined ? true : Boolean(body.appliesToZakazka);
  const appliesToRezervace = body.appliesToRezervace === undefined ? true : Boolean(body.appliesToRezervace);
  const machineConstraint = parseMachineConstraint(body.machineConstraint);
  const blockVariantRaw = body.blockVariant === undefined
    ? undefined
    : body.blockVariant === null || body.blockVariant === ""
      ? null
      : String(body.blockVariant);

  const normalized = {
    name,
    isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    sortOrder: body.sortOrder === undefined ? undefined : Number(body.sortOrder),
    appliesToZakazka,
    appliesToRezervace,
    machineConstraint,
    blockVariant: blockVariantRaw === undefined
      ? undefined
      : blockVariantRaw === null
        ? null
        : normalizeBlockVariant(blockVariantRaw, "ZAKAZKA"),
    specifikace: body.specifikace === undefined
      ? undefined
      : body.specifikace === null || String(body.specifikace).trim() === ""
        ? null
        : String(body.specifikace).trim(),
    dataStatusId: parseNullableInt(body.dataStatusId),
    dataRequiredDateOffsetDays: parseNullableInt(body.dataRequiredDateOffsetDays),
    materialStatusId: parseNullableInt(body.materialStatusId),
    materialRequiredDateOffsetDays: parseNullableInt(body.materialRequiredDateOffsetDays),
    materialInStock: parseNullableBool(body.materialInStock),
    pantoneRequiredDateOffsetDays: parseNullableInt(body.pantoneRequiredDateOffsetDays),
    barvyStatusId: parseNullableInt(body.barvyStatusId),
    lakStatusId: parseNullableInt(body.lakStatusId),
    deadlineExpediceOffsetDays: parseNullableInt(body.deadlineExpediceOffsetDays),
  };

  if (!name) return { error: "Název presetu je povinný." } as const;
  if (machineConstraint === undefined) return { error: "Neplatné omezení stroje." } as const;
  if (normalized.dataStatusId === undefined || normalized.dataRequiredDateOffsetDays === undefined || normalized.materialStatusId === undefined || normalized.materialRequiredDateOffsetDays === undefined || normalized.materialInStock === undefined || normalized.pantoneRequiredDateOffsetDays === undefined || normalized.barvyStatusId === undefined || normalized.lakStatusId === undefined || normalized.deadlineExpediceOffsetDays === undefined) {
    return { error: "Některá číselná nebo boolean pole presetů mají neplatný formát." } as const;
  }
  if (!appliesToZakazka && !appliesToRezervace) {
    return { error: "Preset musí být povolen alespoň pro zakázku nebo rezervaci." } as const;
  }
  if (normalized.blockVariant && !appliesToZakazka) {
    return { error: "Stav zakázky lze použít jen u presetů pro zakázku." } as const;
  }
  if (normalized.materialInStock === true && normalized.materialRequiredDateOffsetDays !== null) {
    return { error: "Materiál skladem nelze kombinovat s datumovým offsetem materiálu." } as const;
  }
  if (!presetHasConfiguredValues(normalized)) {
    return { error: "Preset musí mít alespoň jedno nastavené pole." } as const;
  }

  return { value: normalized } as const;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("includeInactive") === "true";
    const quick = searchParams.get("quick") === "true";
    const type = searchParams.get("type");

    const where = {
      ...(includeInactive || !quick ? {} : { isActive: true }),
      ...(type === "ZAKAZKA" ? { appliesToZakazka: true } : {}),
      ...(type === "REZERVACE" ? { appliesToRezervace: true } : {}),
    };

    const presets = await prisma.jobPreset.findMany({
      where,
      orderBy: [
        { isSystemPreset: "desc" },
        { sortOrder: "asc" },
        { name: "asc" },
      ],
    });

    return NextResponse.json(includeInactive || quick ? presets : presets.filter((preset) => preset.isActive));
  } catch (error) {
    console.error("[GET /api/job-presets]", error);
    return NextResponse.json({ error: "Chyba při načítání presetů" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!WRITE_ROLES.includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const rawBody = await request.json() as UpsertBody;
    const normalized = normalizeBody(rawBody);
    if ("error" in normalized) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const codebookError = await validateCodebookRefs(normalized.value);
    if (codebookError) {
      return NextResponse.json({ error: codebookError }, { status: 400 });
    }

    const maxPreset = await prisma.jobPreset.findFirst({
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const preset = await prisma.jobPreset.create({
      data: {
        ...normalized.value,
        isSystemPreset: false,
        sortOrder: Number.isFinite(normalized.value.sortOrder) ? normalized.value.sortOrder : (maxPreset?.sortOrder ?? -1) + 1,
      },
    });

    return NextResponse.json(preset, { status: 201 });
  } catch (error) {
    console.error("[POST /api/job-presets]", error);
    return NextResponse.json({ error: "Chyba při vytváření presetu" }, { status: 500 });
  }
}
