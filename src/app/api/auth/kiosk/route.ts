import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { getKioskDevices, resolveKioskDeviceByKey } from "@/lib/kioskDevices";
import { AppError, isAppError, errorStatus } from "@/lib/errors";
import { checkRateLimit, getClientIp } from "@/lib/rateLimiter";
import { recordLogin } from "@/lib/loginLog";
import { logger } from "@/lib/logger";

/**
 * Kioskové hands-off přihlášení. Terminál se poprvé (nebo po ztrátě session)
 * spustí na /api/auth/kiosk?device=<stroj>&key=<klíč>; endpoint ověří klíč,
 * najde tiskařský účet a založí session, pak redirect na /kiosk.
 * Leží v allowlistu middleware → pouští se bez cookie.
 *
 * Hardening (audit K-1/K-2): rate limit proti brute-force klíče, zápis do
 * LoginLog (úspěch i selhání) a 30denní session místo roční — launcher se
 * po expiraci sám znovu bootstrapne svým klíčem, obsluha nic nepozná.
 */
export const KIOSK_SESSION_DAYS = 30;

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  try {
    // Limit se klíčuje podle `device`, ne IP: terminály jsou typicky za jednou
    // adresou (a bez X-Real-IP by spadly do sdíleného bucketu "unknown") —
    // hromadný restart po výpadku proudu by pak část hal nechal viset na 429.
    // Zařízení je zároveň přirozená identita pro brute-force klíče (review S1).
    const rateKey = req.nextUrl.searchParams.get("device")?.slice(0, 64) || ip;
    const { allowed, retryAfterSeconds } = checkRateLimit("kiosk", rateKey, 10, 15 * 60 * 1000);
    if (!allowed) {
      await recordLogin({
        userId: null, username: "(kiosk)", success: false,
        failureReason: "KIOSK_RATE_LIMIT", ipAddress: ip,
      });
      return NextResponse.json(
        { error: "Příliš mnoho pokusů." },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
      );
    }

    const device = req.nextUrl.searchParams.get("device") ?? "";
    const key = req.nextUrl.searchParams.get("key") ?? "";

    const match = resolveKioskDeviceByKey(getKioskDevices(), device, key);
    if (!match) {
      await recordLogin({
        userId: null, username: `(kiosk:${device.slice(0, 40)})`, success: false,
        failureReason: "INVALID_KIOSK_KEY", ipAddress: ip,
      });
      throw new AppError("UNAUTHORIZED", "Neplatné kioskové zařízení nebo klíč.");
    }

    const user = await prisma.user.findUnique({ where: { username: match.username } });
    if (!user) {
      throw new AppError("NOT_FOUND", `Kioskový účet '${match.username}' neexistuje.`);
    }

    if (user.role !== "TISKAR") {
      await recordLogin({
        userId: user.id, username: user.username, success: false,
        failureReason: "KIOSK_NOT_TISKAR", ipAddress: ip,
      });
      throw new AppError("FORBIDDEN", `Kioskový účet nemá roli TISKAR.`);
    }

    await createSession(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        assignedMachine: user.assignedMachine ?? null,
        tokenVersion: user.tokenVersion,
      },
      { days: KIOSK_SESSION_DAYS }
    );
    await recordLogin({
      userId: user.id, username: user.username, success: true,
      failureReason: "KIOSK_BOOTSTRAP", ipAddress: ip,
    });

    return NextResponse.redirect(new URL("/kiosk", req.url));
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    }
    logger.error("[api/auth/kiosk] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
