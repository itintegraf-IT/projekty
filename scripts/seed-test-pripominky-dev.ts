/**
 * DEV-ONLY vizuální seed pro připomínky plánovače (8/2026).
 *
 * Vytvoří sadu testovacích bloků na FIXTURE DNI 2. 9. 2026 (středa), aby šlo
 * projít očima všechno, co tahle dávka změnila, bez ručního zakládání:
 *   · specifikace ve všech výškových pásmech (0:30 / 1:00 / 1:30 / 2:00 / 4:00)
 *   · termínové stavy DATA ⚠ / ! / ‼ (práh 14:00)
 *   · rezervace rozdělená na dva stroje → dialog „Překlopit celou rezervaci?"
 *   · blok s historicky OBĚMA štítky → vyčištění klikem (výlučnost)
 *   · řetěz navazujících bloků → vložení mezi ně odsune zbytek (test Ctrl+Z)
 *
 * Spuštění:  node --import tsx scripts/seed-test-pripominky-dev.ts
 * Úklid:     node --import tsx scripts/seed-test-pripominky-dev.ts --clean
 *
 * ── FIXTURE DEN ────────────────────────────────────────────────────────────
 * Skript den 2. 9. 2026 VLASTNÍ: odmítne se spustit, pokud na něm cokoliv leží,
 * a `--clean` ten den smaže celý (ne jen bloky s prefixem TEST-P8). Důvod:
 * po překlopení rezervace na zakázku se `orderNumber` přepíše na skutečné číslo
 * a úklid podle prefixu by blok minul. Ke smazaným blokům se uklidí i jejich
 * AuditLog, Notification a osiřelé SplitGroup.
 *
 * ── PROČ PREFLIGHT ─────────────────────────────────────────────────────────
 * Přímý zápis přes Prisma obchází VŠECHNU serverovou validaci. První verze
 * tohohle skriptu tak vyrobila bloky mimo 30min mřížku a s překryvem — a to
 * pak při testování vypadalo jako chyba aplikace (viz
 * docs/audits/2026-08-04-undo-atomicita-vyzkum.md, sekce 8). Každý blok proto
 * projde stejnými funkcemi jako ostrý zápis; když neprojde, skript spadne
 * a nezaloží NIC.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { validateAndComputeEnd } from "../src/lib/scheduleValidationServer";
import { checkScheduleViolationWithTemplates, serializeWeekShifts } from "../src/lib/scheduleValidation";
import { findIntraBatchOverlap, type BatchSpan } from "../src/lib/overlapCheck";
import { pragueToUTC, todayPragueDateStr } from "../src/lib/dateUtils";
import { SLOT_MS } from "../src/lib/timeSlots";

// Allowlist, ne denylist: neznámý host = odmítnout. Denylist na produkční IP
// by pustil skript na jakoukoliv jinou vzdálenou DB.
const DB_URL = process.env.DATABASE_URL ?? "";
if (!DB_URL.includes("localhost") && !DB_URL.includes("127.0.0.1")) {
  console.error("❌ DATABASE_URL nemíří na localhost — tenhle skript je výhradně pro dev DB.");
  process.exit(1);
}

const PREFIX = "TEST-P8";
const REZ_CODE = `${PREFIX}-REZ`;

/** Fixture den (Praha). Skript ho vlastní — viz hlavička. */
const DAY = "2026-09-02"; // středa
const NEXT_DAY = "2026-09-03";
const DAY_FROM = pragueToUTC(DAY, 0);
const DAY_TO = pragueToUTC(NEXT_DAY, 0);

/** Dnešek a včerejšek v pražském čase (ne UTC — mezi 22:00 a půlnocí se liší). */
const TODAY = todayPragueDateStr();
const YESTERDAY = (() => {
  const d = new Date(`${TODAY}T12:00:00.000Z`); // poledne = DST nemůže překlopit den
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();
/** Civilní datum → DateTime, jak ho ukládá server (CLAUDE.md: nikdy getFullYear/Month/Date). */
const civilDate = (dateStr: string) => new Date(`${dateStr}T00:00:00.000Z`);

const SPEC_KRATKA = "Lak jen na obálce";
const SPEC_DLOUHA =
  "Částečně počítáno na XL105, lak jen na obálce, druhá strana bez laku — potvrdit s technologem před nájezdem";

type Job = {
  order: string;
  machine: string;
  from: [number, number]; // hodina, minuta — pražský čas
  minutes: number;
  spec: string | null;
  desc: string;
  extra?: Record<string, unknown>;
};

/**
 * Rozpis je souvislý a bez děr, aby seděl na 30min mřížku a nevznikl překryv.
 * Mezera 18:00–20:00 na obou strojích je ZÁMĚRNÁ: dává chain pushi kam odsunout,
 * aniž by narazil na rezervaci ve 20:00.
 *
 * Provozní doba středy 2. 9.: XL 105 ranní+odpolední (06:00–22:00),
 * XL 106 navíc noční (24 h).
 */
const JOBS: Job[] = [
  // ── XL 105: specifikace napříč výškovými pásmy ───────────────────────────
  { order: `${PREFIX}-30M`,   machine: "XL_105", from: [6, 0],  minutes: 30,  spec: SPEC_DLOUHA, desc: "0:30 — nejnižší karta, jen amber značka S" },
  { order: `${PREFIX}-1H`,    machine: "XL_105", from: [6, 30], minutes: 60,  spec: SPEC_DLOUHA, desc: "1:00 — jednořádkový amber pás s elipsou" },
  { order: `${PREFIX}-1H30`,  machine: "XL_105", from: [7, 30], minutes: 90,  spec: SPEC_DLOUHA, desc: "1:30 — jednořádkový pás, víc místa" },
  { order: `${PREFIX}-2H`,    machine: "XL_105", from: [9, 0],  minutes: 120, spec: SPEC_DLOUHA, desc: "2:00 — dvouřádkový pás" },
  { order: `${PREFIX}-4H`,    machine: "XL_105", from: [11, 0], minutes: 240, spec: SPEC_DLOUHA, desc: "4:00 — dvouřádkový pás, plná karta" },
  { order: `${PREFIX}-BEZSPEC`,    machine: "XL_105", from: [15, 0], minutes: 60,  spec: null,        desc: "1:00 bez specifikace — kontrola, že se nekreslí nic" },
  { order: `${PREFIX}-KRATKASPEC`, machine: "XL_105", from: [16, 0], minutes: 120, spec: SPEC_KRATKA, desc: "2:00 s krátkou specifikací — bez elipsy" },
  // mezera 18:00–20:00 → prostor pro chain push
  // 20:00–22:00 → REZERVACE (zakládá se níž)

  // ── XL 106: termínové stavy DATA (práh 14:00) ────────────────────────────
  // ⚠ earlyStart — tisk začne dřív, než ve 14:00 dorazí data.
  { order: `${PREFIX}-TERMIN-EARLY`, machine: "XL_106", from: [6, 0], minutes: 120, spec: null,
    desc: "DATA termín = den tisku → ⚠ (tiskne se v 6:00, data až ve 14:00)",
    extra: { dataRequiredDate: civilDate(DAY) } },
  // ! do 14:00, pak ‼ — hranice se překlopí sama, `now` v gridu tiká à 60 s.
  { order: `${PREFIX}-TERMIN-DNES`, machine: "XL_106", from: [8, 0], minutes: 120, spec: null,
    desc: `DATA termín = dnes (${TODAY}) → ! do 14:00, pak ‼`,
    extra: { dataRequiredDate: civilDate(TODAY) } },
  // ‼ termín propadl včera.
  { order: `${PREFIX}-TERMIN-PO`, machine: "XL_106", from: [10, 0], minutes: 120, spec: null,
    desc: `DATA termín = včera (${YESTERDAY}) → ‼ vždy`,
    extra: { dataRequiredDate: civilDate(YESTERDAY) } },

  // ── XL 106: historicky obě zaškrtnuté → test výlučnosti ──────────────────
  { order: `${PREFIX}-OBOJI`, machine: "XL_106", from: [12, 0], minutes: 120, spec: null,
    desc: "OBÁLKA i VNITŘKY zároveň — klik má nechat jen kliknutou",
    extra: { obalka: true, vnitrky: true } },

  // ── XL 106: řetěz navazujících bloků → vlož mezi ně blok a dej Ctrl+Z ────
  { order: `${PREFIX}-RETEZ-1`, machine: "XL_106", from: [14, 0], minutes: 60, spec: null, desc: "řetěz 1/4 — vlož před něj blok a dej Ctrl+Z" },
  { order: `${PREFIX}-RETEZ-2`, machine: "XL_106", from: [15, 0], minutes: 60, spec: null, desc: "řetěz 2/4" },
  { order: `${PREFIX}-RETEZ-3`, machine: "XL_106", from: [16, 0], minutes: 60, spec: null, desc: "řetěz 3/4" },
  { order: `${PREFIX}-RETEZ-4`, machine: "XL_106", from: [17, 0], minutes: 60, spec: null, desc: "řetěz 4/4 — za ním 2 h volno na odsun" },
  // mezera 18:00–20:00 → prostor pro chain push
  // 20:00–22:00 → REZERVACE (zakládá se níž)
];

/** Rezervace rozdělená na dva stroje — fixture pro hromadné překlopení (bod 7). */
const REZ_FROM: [number, number] = [20, 0];
const REZ_MINUTES = 120;

/** Zastavení preflightu — hláška se vypíše hned, catch ji už neopakuje. */
class SeedAbort extends Error {}
function die(msg: string): never {
  console.error(`❌ ${msg}`);
  throw new SeedAbort(msg);
}

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
/** HH:MM v pražském čase. */
const clock = (d: Date) => d.toLocaleTimeString("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit" });
const fmt = (d: Date) =>
  d.toLocaleString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Úklid celého fixture dne včetně navázaných záznamů.
 * Bloky drží FK na Reservation i SplitGroup → musí jít první.
 */
async function clean(): Promise<void> {
  const doomed = await prisma.block.findMany({
    where: {
      OR: [
        { startTime: { lt: DAY_TO }, endTime: { gt: DAY_FROM } }, // cokoliv na fixture dni
        { orderNumber: { startsWith: PREFIX } },                  // + zbytky odsunuté jinam
      ],
    },
    select: { id: true, splitGroupId: true },
  });
  const ids = doomed.map((b) => b.id);
  const groupIds = [...new Set(doomed.map((b) => b.splitGroupId).filter((g): g is number => g != null))];
  const rez = await prisma.reservation.findMany({ where: { code: REZ_CODE }, select: { id: true } });
  const rezIds = rez.map((r) => r.id);

  let audits = 0, notifs = 0, groups = 0;
  if (ids.length) {
    audits = (await prisma.auditLog.deleteMany({ where: { blockId: { in: ids } } })).count;
    notifs = (await prisma.notification.deleteMany({ where: { blockId: { in: ids } } })).count;
    await prisma.block.deleteMany({ where: { id: { in: ids } } });
  }
  if (rezIds.length) {
    notifs += (await prisma.notification.deleteMany({ where: { reservationId: { in: rezIds } } })).count;
  }
  if (groupIds.length) {
    // Smazat jen skupiny, po kterých nezbyl žádný blok jinde v plánu.
    const stillUsed = await prisma.block.findMany({
      where: { splitGroupId: { in: groupIds } },
      select: { splitGroupId: true },
      distinct: ["splitGroupId"],
    });
    const keep = new Set(stillUsed.map((b) => b.splitGroupId));
    const orphans = groupIds.filter((g) => !keep.has(g));
    if (orphans.length) groups = (await prisma.splitGroup.deleteMany({ where: { id: { in: orphans } } })).count;
  }
  const rezDeleted = (await prisma.reservation.deleteMany({ where: { code: REZ_CODE } })).count;

  console.log(
    `🧹 smazáno: ${ids.length} bloků · ${audits} audit záznamů · ${notifs} notifikací · ${groups} split skupin · ${rezDeleted} rezervací`,
  );
}

async function main() {
  const cleanOnly = process.argv.includes("--clean");
  await clean(); // idempotence — opakované spuštění nenaduplikuje
  if (cleanOnly) return;

  // ── Preflight 1: fixture den musí být v provozu ───────────────────────────
  const weekShiftsRaw = await prisma.machineWeekShifts.findMany({
    where: { weekStart: new Date("2026-08-31T00:00:00.000Z") },
  });
  if (weekShiftsRaw.length === 0) {
    die(`Týden 2026-08-31 nemá v MachineWeekShifts žádné řádky — spusť napřed npm run prisma:bootstrap.`);
  }
  const weekShifts = serializeWeekShifts(weekShiftsRaw);

  // ── Preflight 2: den musí být prázdný ─────────────────────────────────────
  const squatter = await prisma.block.findFirst({
    where: { startTime: { lt: DAY_TO }, endTime: { gt: DAY_FROM } },
    select: { orderNumber: true, machine: true, startTime: true },
  });
  if (squatter) {
    die(`Na ${DAY} už leží blok ${squatter.orderNumber} (${squatter.machine}, ${fmt(squatter.startTime)}) — fixture den musí být prázdný.`);
  }

  console.log(`🌱 Seed testovacích zakázek na fixture den ${DAY} (dev)…\n`);

  // ── Preflight 3: každý blok projde serverovou validací ────────────────────
  type Planned = Job & { start: Date; end: Date; bypassed: boolean };
  const planned: Planned[] = [];

  for (const j of JOBS) {
    const start = pragueToUTC(DAY, j.from[0], j.from[1]);
    if (start.getTime() % SLOT_MS !== 0) die(`${j.order}: start ${hhmm(...j.from)} neleží na 30minutové mřížce.`);
    if (j.minutes % 30 !== 0) die(`${j.order}: délka ${j.minutes} min není násobek 30.`);

    const naiveEnd = new Date(start.getTime() + j.minutes * 60_000);
    const v = await validateAndComputeEnd(prisma, j.machine, start, j.minutes, naiveEnd, "ZAKAZKA", false);
    if (!v.ok) die(`${j.order}: ${v.error}`);
    // Fixture den je uvnitř souvislé pracovní doby — roztažení přes pauzu by
    // znamenalo, že rozpis nesedí na kalendář, ne že je aplikace vadná.
    if (v.end.getTime() !== naiveEnd.getTime()) {
      die(`${j.order}: server roztáhl konec na ${fmt(v.end)} místo ${fmt(naiveEnd)} — rozpis nesedí na provozní dobu ${j.machine}.`);
    }
    planned.push({ ...j, start, end: v.end, bypassed: v.effectivelyBypassed });
  }

  // ── Preflight 4: rezervace (validateAndComputeEnd je pro ně no-op) ────────
  const rezStart = pragueToUTC(DAY, REZ_FROM[0], REZ_FROM[1]);
  const rezEnd = new Date(rezStart.getTime() + REZ_MINUTES * 60_000);
  if (rezStart.getTime() % SLOT_MS !== 0) die("Rezervace: start neleží na 30minutové mřížce.");
  for (const machine of ["XL_105", "XL_106"]) {
    const viol = checkScheduleViolationWithTemplates(machine, rezStart, rezEnd, weekShifts);
    if (viol) die(`Rezervace na ${machine} ${hhmm(...REZ_FROM)}: ${viol}`);
    // Fixture je určený k překlopení na zakázku — ověř, že překlopení blok
    // NEPOSUNE. Přesně tohle spustilo incident 4. 8. 2026.
    const flip = await validateAndComputeEnd(prisma, machine, rezStart, REZ_MINUTES, rezEnd, "ZAKAZKA", false);
    if (!flip.ok) die(`Rezervace na ${machine}: překlopení na zakázku by selhalo — ${flip.error}`);
    if (flip.end.getTime() !== rezEnd.getTime()) {
      die(`Rezervace na ${machine}: překlopení by konec posunulo na ${fmt(flip.end)} — zvol jiný čas.`);
    }
  }

  // ── Preflight 5: žádný překryv uvnitř dávky ───────────────────────────────
  const spans: BatchSpan[] = [
    ...planned.map((p, i) => ({ id: i + 1, orderNumber: p.order, machine: p.machine, start: p.start, end: p.end })),
    { id: 900, orderNumber: REZ_CODE, machine: "XL_105", start: rezStart, end: rezEnd },
    { id: 901, orderNumber: REZ_CODE, machine: "XL_106", start: rezStart, end: rezEnd },
  ];
  const clash = findIntraBatchOverlap(spans);
  if (clash) {
    die(`Překryv v rozpisu: ${clash[0].orderNumber} (${fmt(clash[0].start)}–${fmt(clash[0].end)}) × ${clash[1].orderNumber} (${fmt(clash[1].start)}–${fmt(clash[1].end)}) na ${clash[0].machine}.`);
  }
  console.log("✓ preflight prošel — mřížka, provozní doba, překryvy i zkouška překlopení\n");

  // ── Zápis ─────────────────────────────────────────────────────────────────
  for (const p of planned) {
    await prisma.block.create({
      data: {
        orderNumber: p.order,
        machine: p.machine,
        type: "ZAKAZKA",
        startTime: p.start,
        endTime: p.end,
        printMinutes: p.minutes,
        scheduleBypassed: p.bypassed,
        description: p.desc,
        specifikace: p.spec,
        ...p.extra,
      },
    });
    console.log(`✅ ${p.order.padEnd(22)} ${p.machine}  ${hhmm(...p.from)}–${clock(p.end)}  ${p.desc}`);
  }

  // ── Rezervace rozdělená na dva stroje → dialog překlopení ─────────────────
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
      requestedExpeditionDate: civilDate(DAY),
    },
  });
  const rezBlock = await prisma.block.create({
    data: {
      orderNumber: REZ_CODE, machine: "XL_105", type: "REZERVACE",
      startTime: rezStart, endTime: rezEnd,
      description: "OBÁLKA — hlavní blok rezervace", obalka: true, reservationId: rez.id,
    },
  });
  await prisma.block.create({
    data: {
      orderNumber: REZ_CODE, machine: "XL_106", type: "REZERVACE",
      startTime: rezStart, endTime: rezEnd,
      description: "VNITŘKY — kopie na druhém stroji (bez reservationId)", vnitrky: true,
    },
  });
  // Bez scheduled* polí mlčí detail v /rezervace (ReservationDetail.tsx).
  await prisma.reservation.update({
    where: { id: rez.id },
    data: {
      scheduledBlockId: rezBlock.id,
      scheduledMachine: "XL_105",
      scheduledStartTime: rezStart,
      scheduledEndTime: rezEnd,
      scheduledAt: new Date(),
    },
  });
  console.log(`✅ ${REZ_CODE.padEnd(22)} XL_105 + XL_106  ${hhmm(...REZ_FROM)}–22:00  otevři a přepni typ na ZAKÁZKA`);

  console.log(`\nHotovo — ${planned.length + 2} bloků. Otevři plán na ${DAY} (středa).`);
  console.log(`Úklid:  node --import tsx scripts/seed-test-pripominky-dev.ts --clean`);
}

main()
  .catch((e) => {
    if (!(e instanceof Error) || !e.message.startsWith("❌")) console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
