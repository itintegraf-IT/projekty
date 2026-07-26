export type KioskDevice = {
  device: string;
  key: string;
  username: string;
  pntid: number;
};

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
  if (d.key !== key) return null;
  return d;
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
