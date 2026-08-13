/**
 * Ukázková data pro PLÁNOVAČ — bohatě ochipované zakázky (DEV ONLY).
 *
 * Spuštění:  npx tsx prisma/seed-planner-demo.ts
 * Úklid:     npx tsx prisma/seed-planner-demo.ts --clean
 *
 * NIC NEMAŽE (kromě `--clean`, který smaže jen bloky s prefixem `DEMO-`).
 *
 * Vzniklo pro prohlídku stupňů velikosti písma (M / L / XL) — proto jsou tu
 * zakázky všech délek od 30 minut po 4 hodiny a všechny druhy štítků naráz.
 *
 * DODRŽUJE PRAVIDLA APLIKACE (jinak by bloky v plánu nešly uložit ani editovat):
 *   1. začátek leží na 30minutové hranici (`startTime % SLOT_MS === 0`),
 *   2. délka tisku je násobek 30 minut (`printMinutes % 30 === 0`),
 *   3. blok se NEPŘEKRÝVÁ s žádným existujícím ani s ostatními nově vloženými
 *      — místo se hledá ve volných mezerách, netipuje se,
 *   4. blok leží celý uvnitř aktivní pracovní doby stroje pro daný den
 *      (`MachineWeekShifts`) a nepřechází přes noc, takže mu plán nenapíše
 *      „nesedí na kalendář",
 *   5. štítky DATA / MATERIÁL / BARVY / LAK / ARCHY / SÉRIE se berou z číselníku
 *      (`CodebookOption`), ne jako volný text.
 *
 * Číselníky musí být naplněné: `npm run prisma:bootstrap` (idempotentní).
 */
import { PrismaClient } from "@prisma/client";
import { SLOT_MS } from "../src/lib/timeSlots";
import { serializeProductionTags } from "../src/lib/productionTags";
import {
  civilDateToUTCMidnight,
  pragueOf,
  todayPragueDateStr,
  addDaysToCivilDate,
  civilDateDayOfWeek,
  parseCivilDateForDb,
} from "../src/lib/dateUtils";
import { weekStartStrFromDateStr } from "../src/lib/machineWeekShifts";

const prisma = new PrismaClient();

const MIN = 60_000;
const PREFIX = "DEMO-";

/** Stroj tiskařského účtu (`tiskar` → XL_105) a druhý stroj. */
const MAIN = "XL_105";
const OTHER = "XL_106";

/** Kolik dní dopředu se ukázka rozprostře. */
const DAYS = 4;

/**
 * Okno, do kterého bloky pokládáme: ranní + odpolední směna (6:00–22:00).
 * Noční vědomě vynecháváme — blok přes půlnoc by se v plánu kreslil přes dva
 * dny a pro prohlídku velikosti písma nic nepřidá.
 */
const MORNING = { fromMin: 6 * 60, toMin: 14 * 60 };
const AFTERNOON = { fromMin: 14 * 60, toMin: 22 * 60 };

type Opt = { id: number; label: string };

async function opt(category: string, label: string): Promise<Opt> {
  const found = await prisma.codebookOption.findFirst({ where: { category, label } });
  if (!found) {
    throw new Error(
      `Číselník ${category} nemá položku „${label}". Spusť nejdřív: npm run prisma:bootstrap`
    );
  }
  return { id: found.id, label: found.label };
}

/**
 * UTC okamžik odpovídající pražské občanské minutě daného dne.
 * Posun se neodhaduje — obě varianty se ověří proti `pragueOf`, což je tentýž
 * zdroj pravdy, jaký používá aplikace.
 */
function pragueInstant(dateStr: string, minuteOfDay: number): Date {
  for (const offsetMin of [120, 60]) {
    const cand = new Date(civilDateToUTCMidnight(dateStr).getTime() + (minuteOfDay - offsetMin) * MIN);
    const p = pragueOf(cand);
    if (p.dateStr === dateStr && p.hour * 60 + p.minute === minuteOfDay) return cand;
  }
  throw new Error(`Nelze určit UTC okamžik pro ${dateStr} ${minuteOfDay} min pražského času.`);
}

type Interval = { from: number; to: number };

/** Volná okna stroje pro daný den (v ms od epochy), už bez obsazených míst. */
async function freeWindows(machine: string, dateStr: string): Promise<Interval[]> {
  const row = await prisma.machineWeekShifts.findFirst({
    where: {
      machine,
      weekStart: civilDateToUTCMidnight(weekStartStrFromDateStr(dateStr)),
      dayOfWeek: civilDateDayOfWeek(dateStr),
    },
  });
  if (!row || !row.isActive) return [];

  // Ranní a odpolední na sebe navazují (6–14, 14–22), takže když jedou obě,
  // vznikne jedno souvislé okno — blok pak nemusí přeskakovat pauzu.
  const parts: Interval[] = [];
  if (row.morningOn) parts.push({ from: MORNING.fromMin, to: MORNING.toMin });
  if (row.afternoonOn) parts.push({ from: AFTERNOON.fromMin, to: AFTERNOON.toMin });
  if (parts.length === 0) return [];
  const merged: Interval[] = [];
  for (const p of parts.sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (last && p.from <= last.to) last.to = Math.max(last.to, p.to);
    else merged.push({ ...p });
  }

  let windows = merged.map((m) => ({
    from: pragueInstant(dateStr, m.from).getTime(),
    to: pragueInstant(dateStr, m.to).getTime(),
  }));

  // Odečteme, co na stroji ten den už stojí — libovolného typu, protože overlap
  // guard aplikace je type-agnostický (zakázka, rezervace i údržba).
  const dayFrom = windows[0].from;
  const dayTo = windows[windows.length - 1].to;
  const taken = await prisma.block.findMany({
    where: { machine, startTime: { lt: new Date(dayTo) }, endTime: { gt: new Date(dayFrom) } },
    select: { startTime: true, endTime: true },
  });
  for (const t of taken) {
    const next: Interval[] = [];
    for (const w of windows) {
      const ts = t.startTime.getTime();
      const te = t.endTime.getTime();
      if (te <= w.from || ts >= w.to) { next.push(w); continue; }
      if (ts > w.from) next.push({ from: w.from, to: ts });
      if (te < w.to) next.push({ from: te, to: w.to });
    }
    windows = next;
  }
  return windows.filter((w) => w.to - w.from >= SLOT_MS);
}

type Job = {
  machine: string;
  day: number;
  printMinutes: number;
  notes?: string[];
  data: Record<string, unknown>;
};

async function clean() {
  const { count } = await prisma.block.deleteMany({ where: { orderNumber: { startsWith: PREFIX } } });
  console.log(`Smazáno ${count} ukázkových bloků ${PREFIX}(poznámky odešly kaskádou).`);
}

async function seed() {
  const existing = await prisma.block.count({ where: { orderNumber: { startsWith: PREFIX } } });
  if (existing > 0) {
    console.log(`Už je vloženo ${existing} bloků ${PREFIX}. Nejdřív je smaž:`);
    console.log(`   npx tsx prisma/seed-planner-demo.ts --clean`);
    return;
  }

  const dataReady = await opt("DATA", "PŘIPRAVENO");
  const dataBad = await opt("DATA", "CHYBNÁ DATA");
  const dataApproval = await opt("DATA", "U SCHVÁLENÍ");
  const matStock = await opt("MATERIAL", "SKLADEM");
  const matSheets = await opt("MATERIAL", "TISK Z ARCHŮ");
  const matRolls = await opt("MATERIAL", "TISK Z ROLÍ");
  const matNote = await opt("MATERIAL", "MÍSTO PRO POZNÁMKU");
  const barvyLumina = await opt("BARVY", "SCH Lumina LED");
  const barvyIml = await opt("BARVY", "IML COLORGRAF");
  const lakLesk = await opt("LAK", "disperse lesk");
  const lakDlouhy = await opt("LAK", "vysoce lesklá disperse");
  const lakUv = await opt("LAK", "UV lak");
  const ta3 = await opt("TISKOVY_ARCH", "3. TA");
  const ta8 = await opt("TISKOVY_ARCH", "8. TA");
  const ta12 = await opt("TISKOVY_ARCH", "12. TA");
  const serie1 = await opt("SERIE", "1. série");
  const serie2 = await opt("SERIE", "2. série");

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, username: true } });
  if (!admin) throw new Error("V databázi není žádný ADMIN — poznámky by neměly autora.");

  const splitGroup = await prisma.splitGroup.create({ data: {} });

  const today = todayPragueDateStr();
  const dayStr = (offset: number) => addDaysToCivilDate(today, offset);
  /** Termín expedice jako občanské datum (v DB půlnoc UTC, jako to dělá aplikace). */
  const deadline = (offset: number) => parseCivilDateForDb(dayStr(offset));

  /** Zakázka s daty i materiálem v pořádku — nejběžnější stav. */
  const ready = {
    type: "ZAKAZKA" as const,
    dataStatusId: dataReady.id, dataStatusLabel: dataReady.label, dataOk: true,
    materialStatusId: matStock.id, materialStatusLabel: matStock.label,
    materialInStock: true, materialIssued: true,
  };

  const jobs: Job[] = [
    // ── DNES, XL 105 (stroj tiskaře) — od nejdelší po nejkratší ──────────────
    {
      machine: MAIN, day: 0, printMinutes: 240,
      notes: ["Klient chce vzorek před náběhem.", "Pozor na soutisk na 3. archu."],
      data: {
        ...ready, orderNumber: `${PREFIX}2501`,
        description: "Katalog jaro 2026 — Alimpex",
        specifikace: "B2 · 4/4 · 130 g natíraný lesk · disperzní lak",
        obalka: true,
        tiskoveArchy: serializeProductionTags([ta3.label, ta8.label]),
        serie: serializeProductionTags([serie1.label]),
        barvyStatusId: barvyLumina.id, barvyStatusLabel: barvyLumina.label,
        lakStatusId: lakDlouhy.id, lakStatusLabel: lakDlouhy.label,
        pantoneRequired: true, pantoneRequiredDate: deadline(1), pantoneOk: true,
        pantoneInStock: true, pantoneIssued: true,
        deadlineExpedice: deadline(2), doprava: "Vlastní rozvoz",
      },
    },
    {
      machine: MAIN, day: 0, printMinutes: 180,
      data: {
        ...ready, orderNumber: `${PREFIX}2502`,
        description: "Etikety IML — jogurt 400 g",
        specifikace: "IML · 5/0 · PP 60 µm · protiskluz",
        vnitrky: true,
        tiskoveArchy: serializeProductionTags([ta12.label]),
        serie: serializeProductionTags([serie2.label]),
        barvyStatusId: barvyIml.id, barvyStatusLabel: barvyIml.label,
        lakStatusId: lakUv.id, lakStatusLabel: lakUv.label,
        pantoneRequired: true, pantoneRequiredDate: deadline(0), pantoneOk: false,
        deadlineExpedice: deadline(3),
        splitGroupId: splitGroup.id,
      },
    },
    {
      machine: MAIN, day: 0, printMinutes: 120,
      notes: ["Odklepnuto, čeká na expedici."],
      data: {
        ...ready, orderNumber: `${PREFIX}2503`,
        description: "Krabičky Zentiva — šarže 340",
        specifikace: "GC2 350 g · 4/0 · výsek + lepení",
        locked: true,
        tiskoveArchy: serializeProductionTags([ta8.label]),
        lakStatusId: lakLesk.id, lakStatusLabel: lakLesk.label,
        deadlineExpedice: deadline(1),
      },
    },
    {
      machine: MAIN, day: 0, printMinutes: 90,
      data: {
        ...ready, orderNumber: `${PREFIX}2504`,
        description: "Ročenka 2025 — pozastaveno zákazníkem",
        specifikace: "A4 · 4/4 · 115 g NL",
        blockVariant: "POZASTAVENO",
        dataStatusId: dataApproval.id, dataStatusLabel: dataApproval.label, dataOk: false,
        deadlineExpedice: deadline(5),
      },
    },
    {
      machine: MAIN, day: 0, printMinutes: 60,
      data: {
        ...ready, orderNumber: `${PREFIX}2505`,
        description: "Vizitky — sada 12 jmen",
        specifikace: "90 × 50 mm · 4/4 · 300 g NL · mat lamino",
        barvyStatusId: barvyLumina.id, barvyStatusLabel: barvyLumina.label,
      },
    },
    {
      machine: MAIN, day: 0, printMinutes: 30,
      data: {
        ...ready, orderNumber: `${PREFIX}2506`,
        description: "Dotisk letáku — expres",
        specifikace: "A5 · 4/4 · 135 g NL",
        deadlineExpedice: deadline(0),
      },
    },

    // ── DNES, XL 106 ────────────────────────────────────────────────────────
    {
      machine: OTHER, day: 0, printMinutes: 240,
      notes: ["Materiál dorazí až ráno — nezačínat dřív."],
      data: {
        type: "ZAKAZKA" as const, orderNumber: `${PREFIX}2507`,
        description: "Obálky ČSOB — série B",
        specifikace: "DL okno vpravo · 4/0 · 90 g ofset",
        dataStatusId: dataBad.id, dataStatusLabel: dataBad.label, dataOk: false,
        materialStatusId: matSheets.id, materialStatusLabel: matSheets.label,
        materialRequiredDate: deadline(0), materialOk: false, materialInStock: false,
        pantoneRequired: true, pantoneRequiredDate: deadline(1), pantoneOk: false,
        deadlineExpedice: deadline(4),
      },
    },
    {
      machine: OTHER, day: 0, printMinutes: 180,
      data: {
        ...ready, orderNumber: `${PREFIX}2502`,
        description: "Etikety IML — jogurt 400 g",
        specifikace: "IML · 5/0 · PP 60 µm · protiskluz",
        vnitrky: true,
        tiskoveArchy: serializeProductionTags([ta12.label]),
        serie: serializeProductionTags([serie2.label]),
        barvyStatusId: barvyIml.id, barvyStatusLabel: barvyIml.label,
        lakStatusId: lakUv.id, lakStatusLabel: lakUv.label,
        pantoneRequired: true, pantoneRequiredDate: deadline(0), pantoneOk: false,
        deadlineExpedice: deadline(3),
        splitGroupId: splitGroup.id,
      },
    },
    {
      machine: OTHER, day: 0, printMinutes: 120,
      data: {
        ...ready, orderNumber: `${PREFIX}2508`,
        description: "Plakát A1 — výstava Náchod",
        specifikace: "A1 · 4/0 · 150 g NL",
        materialStatusId: matRolls.id, materialStatusLabel: matRolls.label,
        materialInStock: false, materialIssued: false,
        lakStatusId: lakLesk.id, lakStatusLabel: lakLesk.label,
      },
    },
    {
      machine: OTHER, day: 0, printMinutes: 60,
      data: {
        ...ready, orderNumber: `${PREFIX}2509`,
        description: "Direct mail — srpnová vlna",
        specifikace: "C5 · 4/4 · 100 g ofset",
        recurrenceType: "DAILY",
        deadlineExpedice: deadline(2),
      },
    },
    {
      machine: OTHER, day: 0, printMinutes: 30,
      data: {
        ...ready, orderNumber: `${PREFIX}2510`,
        description: "Nálepky — doplnění",
      },
    },

    // ── ZÍTRA ───────────────────────────────────────────────────────────────
    {
      machine: MAIN, day: 1, printMinutes: 240,
      notes: ["Dlouhý popis schválně — ať je vidět, jak se zalomí a kde se ořízne."],
      data: {
        ...ready, orderNumber: `${PREFIX}2511`,
        description: "Katalog podzim 2026 — Alimpex, kompletní náklad včetně příloh a vkládané objednávky",
        specifikace: "B2 · 4/4 · 130 g natíraný lesk · disperzní lak · vazba V2 · balení po 25 ks",
        obalka: true, vnitrky: true,
        tiskoveArchy: serializeProductionTags([ta3.label, ta8.label, ta12.label]),
        serie: serializeProductionTags([serie1.label, serie2.label]),
        barvyStatusId: barvyLumina.id, barvyStatusLabel: barvyLumina.label,
        lakStatusId: lakDlouhy.id, lakStatusLabel: lakDlouhy.label,
        pantoneRequired: true, pantoneRequiredDate: deadline(1), pantoneOk: false,
        deadlineExpedice: deadline(6), doprava: "Toptrans",
      },
    },
    {
      machine: MAIN, day: 1, printMinutes: 90,
      data: {
        ...ready, orderNumber: `${PREFIX}2512`,
        description: "Leták Kincl — jarní akce",
        specifikace: "A5 · 4/4 · 135 g NL",
        materialStatusId: matNote.id, materialStatusLabel: matNote.label,
        materialNote: "Zbytek role z minulé zakázky, ověřit metráž.",
        materialNoteByUsername: admin.username,
        materialInStock: false,
      },
    },
    {
      machine: MAIN, day: 1, printMinutes: 30,
      data: {
        ...ready, orderNumber: `${PREFIX}2513`,
        description: "Vzorník — 20 ks",
      },
    },
    {
      machine: OTHER, day: 1, printMinutes: 180,
      data: {
        ...ready, orderNumber: `${PREFIX}2514`,
        description: "Etikety IML — smetana 200 g",
        specifikace: "IML · 6/0 · PP 55 µm",
        vnitrky: true,
        tiskoveArchy: serializeProductionTags([ta3.label]),
        barvyStatusId: barvyIml.id, barvyStatusLabel: barvyIml.label,
        pantoneRequired: true, pantoneRequiredDate: deadline(1), pantoneOk: true,
        pantoneInStock: true,
        deadlineExpedice: deadline(4),
      },
    },
    {
      machine: OTHER, day: 1, printMinutes: 120,
      notes: ["Tisknout až po schválení nátisku."],
      data: {
        ...ready, orderNumber: `${PREFIX}2515`,
        description: "Kalendář nástěnný 2027",
        specifikace: "A3 · 4/4 · 170 g NL · spirála",
        dataStatusId: dataApproval.id, dataStatusLabel: dataApproval.label, dataOk: false,
        lakStatusId: lakLesk.id, lakStatusLabel: lakLesk.label,
        deadlineExpedice: deadline(7),
      },
    },

    // ── POZÍTŘÍ A DÁL — ať je co posouvat ───────────────────────────────────
    {
      machine: MAIN, day: 2, printMinutes: 180,
      data: {
        ...ready, orderNumber: `${PREFIX}2516`,
        description: "Ceniny — poukázky 2026",
        specifikace: "A6 · 4/1 · ceninový papír · číslování",
        locked: true,
        deadlineExpedice: deadline(5),
      },
    },
    {
      machine: MAIN, day: 2, printMinutes: 60,
      data: {
        ...ready, orderNumber: `${PREFIX}2517`,
        description: "Wobblery — POP sada",
        specifikace: "150 × 100 mm · 4/0 · 250 g NL",
        obalka: true,
      },
    },
    {
      machine: OTHER, day: 2, printMinutes: 240,
      data: {
        ...ready, orderNumber: `${PREFIX}2518`,
        description: "Krabičky kosmetika — Ryor",
        specifikace: "GC1 300 g · 4/0 · parciální UV",
        lakStatusId: lakUv.id, lakStatusLabel: lakUv.label,
        tiskoveArchy: serializeProductionTags([ta8.label]),
        pantoneRequired: true, pantoneRequiredDate: deadline(2), pantoneOk: false,
        deadlineExpedice: deadline(6),
      },
    },
    {
      machine: MAIN, day: 3, printMinutes: 120,
      data: {
        ...ready, orderNumber: `${PREFIX}2519`,
        description: "Noviny obecní — srpen",
        specifikace: "A3 · 1/1 · 45 g novinový",
        recurrenceType: "MONTHLY",
      },
    },
    {
      machine: OTHER, day: 3, printMinutes: 90,
      data: {
        ...ready, orderNumber: `${PREFIX}2520`,
        description: "Samolepky — dotisk",
        specifikace: "Ø 60 mm · 4/0 · samolepicí papír",
        materialStatusId: matSheets.id, materialStatusLabel: matSheets.label,
        materialRequiredDate: deadline(2), materialInStock: false,
      },
    },
  ];

  // ── Umístění: pro každou zakázku najdeme první volné místo v jejím dni ────
  const cursors = new Map<string, Interval[]>();
  const placed: { job: Job; start: Date; end: Date }[] = [];
  const skipped: Job[] = [];

  for (const job of jobs) {
    const key = `${job.machine}|${job.day}`;
    if (!cursors.has(key)) cursors.set(key, await freeWindows(job.machine, dayStr(job.day)));
    const windows = cursors.get(key)!;
    const needMs = job.printMinutes * MIN;

    const idx = windows.findIndex((w) => w.to - w.from >= needMs);
    if (idx === -1) { skipped.push(job); continue; }

    const w = windows[idx];
    const start = new Date(w.from);
    const end = new Date(w.from + needMs);
    placed.push({ job, start, end });
    if (w.to - end.getTime() >= SLOT_MS) w.from = end.getTime();
    else windows.splice(idx, 1);
  }

  // ── Pojistky: raději spadnout tady než tiskaři při editaci bloku v plánu ──
  for (const p of placed) {
    const num = p.job.data.orderNumber;
    if (p.start.getTime() % SLOT_MS !== 0) {
      throw new Error(`${num}: začátek ${p.start.toISOString()} není na 30minutové hranici.`);
    }
    if (p.job.printMinutes % 30 !== 0) {
      throw new Error(`${num}: délka tisku ${p.job.printMinutes} min není násobek 30.`);
    }
    for (const q of placed) {
      if (q === p || q.job.machine !== p.job.machine) continue;
      if (p.start < q.end && p.end > q.start) {
        throw new Error(`${num} se překrývá s ${q.job.data.orderNumber} na ${p.job.machine}.`);
      }
    }
  }

  const span = { from: placed[0]?.start ?? new Date(), to: placed[0]?.end ?? new Date() };
  for (const p of placed) {
    if (p.start < span.from) span.from = p.start;
    if (p.end > span.to) span.to = p.end;
  }
  const others = await prisma.block.findMany({
    where: {
      startTime: { lt: span.to }, endTime: { gt: span.from },
      orderNumber: { not: { startsWith: PREFIX } },
    },
    select: { orderNumber: true, machine: true, startTime: true, endTime: true },
  });
  for (const o of others) {
    const hit = placed.find(
      (p) => p.job.machine === o.machine && p.start < o.endTime && p.end > o.startTime
    );
    if (hit) {
      throw new Error(
        `${hit.job.data.orderNumber} by se překryl se stávajícím ${o.orderNumber} na ${o.machine}.`
      );
    }
  }

  // ── Zápis ────────────────────────────────────────────────────────────────
  for (const p of placed) {
    const created = await prisma.block.create({
      data: {
        ...p.job.data,
        machine: p.job.machine,
        startTime: p.start,
        endTime: p.end,
        printMinutes: p.job.printMinutes,
      } as never,
    });
    for (const text of p.job.notes ?? []) {
      await prisma.blockNote.create({
        data: { blockId: created.id, text, createdByUserId: admin.id, createdByUsername: admin.username },
      });
    }
  }

  const noteCount = placed.reduce((n, p) => n + (p.job.notes?.length ?? 0), 0);
  console.log(`Vloženo ${placed.length} zakázek (prefix ${PREFIX}) a ${noteCount} tiskařských poznámek.`);
  console.log(`Split skupina id=${splitGroup.id} spojuje ${PREFIX}2502 na obou strojích.`);
  console.log("Všechny začátky na 30min hranici, délky násobek 30 min, uvnitř aktivních směn, bez překryvu.");
  for (const [key, windows] of cursors) {
    const [machine, day] = key.split("|");
    const volno = windows.reduce((n, w) => n + (w.to - w.from), 0) / 3_600_000;
    console.log(`   ${machine} ${dayStr(Number(day))}: zbývá ${volno.toFixed(1)} h volného místa`);
  }
  if (skipped.length > 0) {
    console.log(`\nNevešlo se ${skipped.length} zakázek (v jejich dni nezbylo souvislé místo):`);
    skipped.forEach((j) => console.log(`   ${j.data.orderNumber} ${j.machine} ${j.printMinutes} min`));
  }
  console.log(`\nÚklid: npx tsx prisma/seed-planner-demo.ts --clean`);
}

/** Název databáze z `DATABASE_URL`. Přes `new URL`, ne `split("/")` — to by na
 *  `?socket=/tmp/mysql.sock` nebo na koncovém lomítku vrátilo nesmysl. */
function targetDbName(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

/**
 * Pojistka proti spuštění nad ostrou nebo testovací databází. Skript sice bez
 * `--clean` nic nemaže, ale `--clean` je `deleteMany` MIMO `withRevision`
 * i `AuditLog` — po něm by v černé skříňce nezbylo nic. A 21 falešných zakázek
 * v ostrém plánu je samo o sobě incident.
 *
 * POZOR, ROZLIŠOVAČ JE KŘEHKÝ A JE TO VĚDOMÉ: dev i produkce se jmenují stejně
 * až na VELIKOST PÍSMEN — dev `IGvyroba`, produkce `igvyroba`, testovací
 * instance `igvyroba_test` (docs/DEPLOY_WORKFLOW.md). Porovnání je proto
 * ZÁMĚRNĚ case-sensitive. Kdo sem přidá `.toLowerCase()` „pro jistotu",
 * zablokuje tím dev. Právě proto tu je i druhá, na jménu nezávislá linie:
 * skript před každou akcí VYPÍŠE, na jakou databázi míří.
 *
 * `NODE_ENV` je jen bonus — na serveru ho nastavuje PM2 pro aplikaci, ne pro
 * ruční `npx tsx` z shellu, takže se na něj spolehnout nedá.
 *
 * Vědomé obejití: `ALLOW_SEED_ON_PROD=1`.
 */
function assertNotProduction(): void {
  const dbName = targetDbName();
  console.log(`Cílová databáze: ${dbName || "(neznámá)"}`);
  if (process.env.ALLOW_SEED_ON_PROD === "1") return;
  const looksProd = process.env.NODE_ENV === "production" || dbName.startsWith("igvyroba");
  if (!looksProd) return;
  console.error(
    `\nODMÍTNUTO: tenhle skript je DEV ONLY a míří na „${dbName || "?"}"`
    + `${process.env.NODE_ENV === "production" ? " (NODE_ENV=production)" : ""}.\n`
    + `Dev databáze se jmenuje IGvyroba (velké I, G). Když to fakt chceš,`
    + ` spusť s ALLOW_SEED_ON_PROD=1.`
  );
  process.exit(1);
}

assertNotProduction();

const run = process.argv.includes("--clean") ? clean : seed;
run()
  .catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); })
  .finally(() => prisma.$disconnect());
