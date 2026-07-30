import { timingSafeEqual } from "node:crypto";

export type KioskDevice = {
  device: string;
  key: string;
  username: string;
  pntid: number;
};

/** Minimální entropie kioskového klíče (`openssl rand -hex 32`). */
export const KIOSK_KEY_MIN_LENGTH = 32;

/** Naparsuje a zvaliduje ENV `KIOSK_DEVICES` (JSON pole). Prázdné → []. */
export function parseKioskDevices(raw: string | undefined): KioskDevice[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("[kioskDevices] KIOSK_DEVICES není validní JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("[kioskDevices] KIOSK_DEVICES musí být JSON pole.");
  }
  return parsed.map((e, i) => {
    const o = e as Record<string, unknown>;
    if (
      typeof o.device !== "string" ||
      typeof o.key !== "string" ||
      typeof o.username !== "string" ||
      typeof o.pntid !== "number"
    ) {
      throw new Error(`[kioskDevices] neplatná položka na indexu ${i}.`);
    }
    // Prázdný/krátký klíč by z bootstrap endpointu udělal veřejný login
    // (audit K-3) — konfigurace s takovým klíčem se nesmí nasadit.
    if (o.key.length < KIOSK_KEY_MIN_LENGTH) {
      throw new Error(
        `[kioskDevices] klíč na indexu ${i} je příliš krátký (min. ${KIOSK_KEY_MIN_LENGTH} znaků, vygeneruj \`openssl rand -hex 32\`).`
      );
    }
    return { device: o.device, key: o.key, username: o.username, pntid: o.pntid };
  });
}

/** Vrátí zařízení jen když sedí device i key. Jinak null. */
export function resolveKioskDeviceByKey(
  devices: KioskDevice[],
  device: string,
  key: string
): KioskDevice | null {
  const d = devices.find((x) => x.device === device);
  if (!d) return null;
  if (!keysMatch(d.key, key)) return null;
  return d;
}

/** Časově konstantní porovnání klíčů (audit K-3). */
function keysMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  // timingSafeEqual vyžaduje shodnou délku; rozdílná délka = neshoda.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** pntid Logiky pro daný tiskařský účet, nebo null. */
export function pntidForUsername(
  devices: KioskDevice[],
  username: string
): number | null {
  const d = devices.find((x) => x.username === username);
  return d ? d.pntid : null;
}

let cached: KioskDevice[] | null = null;
/** Runtime přístup k naparsované konfiguraci (cachováno). */
export function getKioskDevices(): KioskDevice[] {
  if (cached) return cached;
  cached = parseKioskDevices(process.env.KIOSK_DEVICES);
  return cached;
}
