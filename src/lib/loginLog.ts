import { prisma } from "./prisma";
import { logger } from "./logger";

/**
 * Zápis do LoginLog. Sdílené mezi /api/auth/login a /api/auth/kiosk —
 * kioskové přihlášení dřív nelogovalo nic, takže pokusy o zneužití
 * bootstrap endpointu byly v auditu neviditelné (audit K-2).
 * Selhání zápisu nikdy neshodí přihlášení.
 */
export async function recordLogin(entry: {
  userId: number | null;
  username: string;
  success: boolean;
  failureReason?: string;
  ipAddress: string;
}): Promise<void> {
  try {
    await prisma.loginLog.create({ data: entry });
  } catch (err) {
    logger.error("[loginLog] zápis LoginLog selhal", err);
  }
}
