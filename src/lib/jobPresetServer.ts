import { prisma } from "@/lib/prisma";

export async function resolvePresetForBlock(
  presetId: unknown,
  type: string
): Promise<{ jobPresetId: number | null; jobPresetLabel: string | null } | { error: string }> {
  if (type === "UDRZBA") {
    return { jobPresetId: null, jobPresetLabel: null };
  }
  if (presetId === undefined || presetId === null || presetId === "") {
    return { jobPresetId: null, jobPresetLabel: null };
  }

  const numId = Number(presetId);
  if (!Number.isInteger(numId)) {
    return { error: "Neplatné ID presetu." };
  }

  const preset = await prisma.jobPreset.findUnique({
    where: { id: numId },
    select: {
      id: true,
      name: true,
      isActive: true,
      appliesToZakazka: true,
      appliesToRezervace: true,
    },
  });
  if (!preset) {
    return { error: "Preset neexistuje." };
  }
  if (!preset.isActive) {
    return { error: "Preset je neaktivní." };
  }
  if (type === "ZAKAZKA" && !preset.appliesToZakazka) {
    return { error: "Vybraný preset není povolen pro zakázku." };
  }
  if (type === "REZERVACE" && !preset.appliesToRezervace) {
    return { error: "Vybraný preset není povolen pro rezervaci." };
  }

  return { jobPresetId: preset.id, jobPresetLabel: preset.name };
}
