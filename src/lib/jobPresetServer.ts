import { prisma } from "@/lib/prisma";
import type { PrismaTransactionClient } from "@/lib/prismaTx";

/**
 * Ověří preset a vrátí dvojici, kterou write cesty ukládají do bloku.
 *
 * `client` je nepovinný: volání MIMO transakci ho vynechá a dostane modulový
 * singleton. Volání UVNITŘ `withRevision` (src/lib/revision.server.ts) ho ale
 * MUSÍ předat — helper, který si klienta bere z importu místo z parametru, je
 * přesně ten nepřímý nosič, kvůli kterému by se v routě čtení přes globální
 * `prisma` vůbec nevidělo: běželo by mimo transakci, mimo její snapshot i mimo
 * její rollback (viz docblock `withRevision`).
 */
export async function resolvePresetForBlock(
  presetId: unknown,
  type: string,
  client: PrismaTransactionClient = prisma
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

  const preset = await client.jobPreset.findUnique({
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
