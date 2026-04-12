import { Prisma } from "@prisma/client";
import { normalizeCivilDateInput, civilDateToUTCMidnight } from "@/lib/dateUtils";

export const EXPEDITION_SORT_GAP = 1000;

export function getExpeditionDayKey(value: Date | string | null | undefined): string | null {
  return normalizeCivilDateInput(value) ?? null;
}

export async function getNextExpeditionSortOrder(
  tx: Prisma.TransactionClient,
  date: Date | string
): Promise<number> {
  // Normalize to UTC midnight before querying — exact DateTime equality in MySQL
  // requires the stored format, which is always T00:00:00.000Z for civil dates.
  const dayKey = getExpeditionDayKey(date);
  if (!dayKey) throw new Error("Invalid date passed to getNextExpeditionSortOrder");
  const utcMidnight = civilDateToUTCMidnight(dayKey);

  const [blockMax, manualMax] = await Promise.all([
    tx.block.findFirst({
      where: {
        deadlineExpedice: utcMidnight,
        expeditionPublishedAt: { not: null },
        expeditionSortOrder: { not: null },
      },
      orderBy: { expeditionSortOrder: "desc" },
      select: { expeditionSortOrder: true },
    }),
    tx.expeditionManualItem.findFirst({
      where: {
        date: utcMidnight,
        expeditionSortOrder: { not: null },
      },
      orderBy: { expeditionSortOrder: "desc" },
      select: { expeditionSortOrder: true },
    }),
  ]);

  const maxSortOrder = Math.max(
    blockMax?.expeditionSortOrder ?? 0,
    manualMax?.expeditionSortOrder ?? 0
  );

  return maxSortOrder + EXPEDITION_SORT_GAP;
}
