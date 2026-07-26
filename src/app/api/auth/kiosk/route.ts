import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { getKioskDevices, resolveKioskDeviceByKey } from "@/lib/kioskDevices";
import { AppError, isAppError, errorStatus } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Kioskové hands-off přihlášení. Terminál se poprvé (nebo po ztrátě session)
 * spustí na /api/auth/kiosk?device=<stroj>&key=<klíč>; endpoint ověří klíč,
 * najde tiskařský účet a založí dlouhou (365 dní) session, pak redirect na /kiosk.
 * Leží pod /api/auth/* → middleware ho pouští bez cookie.
 */
export async function GET(req: NextRequest) {
  try {
    const device = req.nextUrl.searchParams.get("device") ?? "";
    const key = req.nextUrl.searchParams.get("key") ?? "";

    const match = resolveKioskDeviceByKey(getKioskDevices(), device, key);
    if (!match) {
      throw new AppError("UNAUTHORIZED", "Neplatné kioskové zařízení nebo klíč.");
    }

    const user = await prisma.user.findUnique({ where: { username: match.username } });
    if (!user) {
      throw new AppError("NOT_FOUND", `Kioskový účet '${match.username}' neexistuje.`);
    }

    if (user.role !== "TISKAR") {
      throw new AppError("FORBIDDEN", `Kioskový účet nemá roli TISKAR.`);
    }

    await createSession(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        assignedMachine: user.assignedMachine ?? null,
      },
      { days: 365 }
    );

    return NextResponse.redirect(new URL("/kiosk", req.url));
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    }
    logger.error("[api/auth/kiosk] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
