/**
 * DEV-ONLY vizuální seed pro připomínky plánovače (8/2026).
 *
 * Vytvoří sadu testovacích bloků na PRÁZDNÉM dni 2. 9. 2026 (středa), aby šlo
 * projít očima všechno, co tahle dávka změnila, bez ručního zakládání:
 *   · specifikace ve všech výškových pásmech (0:30 / 0:45 / 1:00 / 1:30 / 2:00 / 4:00)
 *   · termínové stavy DATA ⚠ / ! / ‼ (práh 14:00)
 *   · rezervace rozdělená na dva stroje → dialog „Překlopit celou rezervaci?"
 *   · blok s historicky OBĚMA štítky → vyčištění klikem (výlučnost)
 *   · řetěz navazujících bloků → vložení mezi ně odsune zbytek (test Ctrl+Z)
 *
 * Spuštění:  node --import tsx scripts/seed-test-pripominky-dev.ts
 * Úklid:     node --import tsx scripts/seed-test-pripominky-dev.ts --clean
 *
 * Pojistky: odmítne běžet proti produkční DB; maže výhradně vlastní bloky
 * s prefixem TEST-P8 / rezervaci s kódem TEST-P8-REZ. Nic jiného se nedotkne.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

if ((process.env.DATABASE_URL ?? "").includes("192.168.10.210")) {
  console.error("❌ DATABASE_URL míří na produkci — seed odmítnut.");
  process.exit(1);
}

const PREFIX = "TEST-P8";
const REZ_CODE = `${PREFIX}-REZ`;
const DAY = "2026-09-02"; // středa, v dev DB prázdná; CEST = UTC+2

/** Pražský čas daného dne → UTC Date (září = CEST, tedy −2 h). */
const at = (h: number, m = 0) =>
  new Date(`${DAY}T${String(h - 2).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`);

const SPEC_KRATKA = "Lak jen na obálce";
const SPEC_DLOUHA =
  "Částečně počítáno na XL105, lak jen na obálce, druhá strana bez laku — potvrdit s technologem před nájezdem";

type Job = {
  order: string;
  machine: string;
  from: [number, number];
  minutes: number;
  spec: string | null;
  desc: string;
  extra?: Record<string, unknown>;
};

const JOBS: Job[] = [
  // ── Specifikace napříč výškovými pásmy (XL_105, od 6:00 nepřetržitě) ──────
  { order: `${PREFIX}-30M`,   machine: "XL_105", from: [6, 0],   minutes: 30,  spec: SPEC_DLOUHA, desc: "0:30 — 26 px, jen značka S" },
  { order: `${PREFIX}-45M`,   machine: "XL_105", from: [6, 30],  minutes: 45,  spec: SPEC_DLOUHA, desc: "0:45 — 39 px, jen značka S" },
  { order: `${PREFIX}-1H`,    machine: "XL_105", from: [7, 15],  minutes: 60,  spec: SPEC_DLOUHA, desc: "1:00 — 52 px, jednořádkový pás" },
  { order: `${PREFIX}-1H30`,  machine: "XL_105", from: [8, 15],  minutes: 90,  spec: SPEC_DLOUHA, desc: "1:30 — 78 px, jednořádkový pás" },
  { order: `${PREFIX}-2H`,    machine: "XL_105", from: [9, 45],  minutes: 120, spec: SPEC_DLOUHA, desc: "2:00 — 104 px, dvouřádkový pás" },
  { order: `${PREFIX}-4H`,    machine: "XL_105", from: [11, 45], minutes: 240, spec: SPEC_DLOUHA, desc: "4:00 — 208 px, dvouřádkový pás" },
  { order: `${PREFIX}-BEZSPEC`, machine: "XL_105", from: [15, 45], minutes: 60, spec: null,       desc: "1:00 bez specifikace — kontrola, že se nic nekreslí" },
  { order: `${PREFIX}-KRATKASPEC`, machine: "XL_105", from: [16, 45], minutes: 120, spec: SPEC_KRATKA, desc: "2:00 s krátkou specifikací (bez elipsy)" },

  // ── Termínové stavy DATA (práh 14:00) ────────────────────────────────────
  // ⚠ earlyStart: tisk startuje dřív, než ve 14:00 dorazí data
  { order: `${PREFIX}-TERMIN-EARLY`, machine: "XL_106", from: [6, 0], minutes: 120, spec: null,
    desc: "DATA dnes v den tisku → ⚠ (tiskne se dřív než ve 14:00)",
    extra: { dataRequiredDate: new Date(`${DAY}T00:00:00.000Z`) } },
  // ! / ‼ podle aktuálního času: termín je DNES (spouštěč se překlopí ve 14:00)
  { order: `${PREFIX}-TERMIN-DNES`, machine: "XL_106", from: [8, 0], minutes: 120, spec: null,
    desc: "DATA dnešní datum → ! do 14:00, pak ‼",
    extra: { dataRequiredDate: new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z") } },
  // ‼ termín propadl včera
  { order: `${PREFIX}-TERMIN-PO`, machine: "XL_106", from: [10, 0], minutes: 120, spec: null,
    desc: "DATA včerejší datum → ‼",
    extra: { dataRequiredDate: new Date(new Date(Date.now() - 864e5).toISOString().slice(0, 10) + "T00:00:00.000Z") } },

  // ── Historicky obě zaškrtnuté → test výlučnosti ──────────────────────────
  { order: `${PREFIX}-OBOJI`, machine: "XL_106", from: [12, 0], minutes: 120, spec: null,
    desc: "OBÁLKA i VNITŘKY zároveň — klik má nechat jen kliknutou",
    extra: { obalka: true, vnitrky: true } },

  // ── Řetěz navazujících bloků: vlož mezi ně blok a zkus Ctrl+Z ────────────
  { order: `${PREFIX}-RETEZ-1`, machine: "XL_106", from: [14, 0], minutes: 60, spec: null, desc: "řetěz 1/4 — vlož před něj blok a dej Ctrl+Z" },
  { order: `${PREFIX}-RETEZ-2`, machine: "XL_106", from: [15, 0], minutes: 60, spec: null, desc: "řetěz 2/4" },
  { order: `${PREFIX}-RETEZ-3`, machine: "XL_106", from: [16, 0], minutes: 60, spec: null, desc: "řetěz 3/4" },
  { order: `${PREFIX}-RETEZ-4`, machine: "XL_106", from: [17, 0], minutes: 60, spec: null, desc: "řetěz 4/4" },
];

async function clean() {
  const blocks = await prisma.block.deleteMany({ where: { orderNumber: { startsWith: PREFIX } } });
  const rez = await prisma.reservation.deleteMany({ where: { code: REZ_CODE } });
  console.log(`🧹 smazáno ${blocks.count} testovacích bloků a ${rez.count} rezervací`);
}

async function main() {
  const cleanOnly = process.argv.includes("--clean");
  await clean(); // idempotence — opakované spuštění nenaduplikuje
  if (cleanOnly) { await prisma.$disconnect(); return; }

  // Preflight: den musí být v provozu, jinak by bloky ležely pod červeným šrafováním.
  const weekStart = new Date("2026-08-31T00:00:00.000Z");
  const shifts = await prisma.machineWeekShifts.findMany({ where: { weekStart } });
  const running = shifts.filter((s) => s.isActive && (s.morningOn || s.afternoonOn));
  if (running.length === 0) {
    console.error(`❌ Týden ${weekStart.toISOString().slice(0, 10)} nemá žádnou aktivní směnu — bloky by byly mimo provoz.`);
    process.exit(1);
  }

  const collisions = await prisma.block.count({
    where: { startTime: { gte: new Date(`${DAY}T00:00:00.000Z`), lt: new Date("2026-09-03T00:00:00.000Z") } },
  });
  if (collisions > 0) {
    console.error(`❌ Na ${DAY} už ${collisions} bloků je — zvol jiný den, ať se nic nepřekryje.`);
    process.exit(1);
  }

  console.log(`🌱 Seed testovacích zakázek na ${DAY} (dev)…\n`);

  for (const j of JOBS) {
    const start = at(j.from[0], j.from[1]);
    const end = new Date(start.getTime() + j.minutes * 60_000);
    await prisma.block.create({
      data: {
        orderNumber: j.order,
        machine: j.machine,
        type: "ZAKAZKA",
        startTime: start,
        endTime: end,
        printMinutes: j.minutes,
        scheduleBypassed: false,
        description: j.desc,
        specifikace: j.spec,
        ...j.extra,
      },
    });
    const hhmm = `${String(j.from[0]).padStart(2, "0")}:${String(j.from[1]).padStart(2, "0")}`;
    console.log(`✅ ${j.order.padEnd(22)} ${j.machine}  ${hhmm} (${j.minutes} min)  ${j.desc}`);
  }

  // ── Rezervace rozdělená na dva stroje → dialog překlopení ────────────────
  // Sourozenec ZÁMĚRNĚ bez reservationId: přesně tak vzniká kopií (Ctrl+C/V),
  // která reservationId nikdy nenese — spojuje je jen orderNumber.
  const rez = await prisma.reservation.create({
    data: {
      code: REZ_CODE,
      companyName: "Testovací klient s.r.o.",
      erpOfferNumber: "TEST-0001",
      status: "SCHEDULED",
      requestText: "Testovací rezervace pro ověření hromadného překlopení.",
      requestedByUserId: 1,
      requestedByUsername: "admin",
      requestedExpeditionDate: new Date(`${DAY}T00:00:00.000Z`),
    },
  });
  const rezStart = at(18, 0);
  await prisma.block.create({
    data: {
      orderNumber: REZ_CODE, machine: "XL_105", type: "REZERVACE",
      startTime: rezStart, endTime: new Date(rezStart.getTime() + 120 * 60_000),
      description: "OBÁLKA — hlavní blok rezervace", obalka: true, reservationId: rez.id,
    },
  });
  await prisma.block.create({
    data: {
      orderNumber: REZ_CODE, machine: "XL_106", type: "REZERVACE",
      startTime: rezStart, endTime: new Date(rezStart.getTime() + 120 * 60_000),
      description: "VNITŘKY — kopie na druhém stroji (bez reservationId)", vnitrky: true,
    },
  });
  console.log(`✅ ${REZ_CODE.padEnd(22)} rezervace na XL_105 + XL_106 v 18:00 — otevři a přepni typ na ZAKÁZKA`);

  console.log(`\nHotovo. Otevři plán na ${DAY} (středa).`);
  console.log(`Úklid:  node --import tsx scripts/seed-test-pripominky-dev.ts --clean`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
