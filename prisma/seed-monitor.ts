/**
 * Přídavná testovací data pro tiskařskou obrazovku Monitor (DEV ONLY).
 *
 * Spuštění:  npx tsx prisma/seed-monitor.ts
 * Úklid:     npx tsx prisma/seed-monitor.ts --clean
 *
 * NIC NEMAŽE (kromě `--clean`, který smaže jen bloky s prefixem `MON-`).
 *
 * Časy se počítají RELATIVNĚ K OKAMŽIKU SPUŠTĚNÍ, ne napevno — Monitor ukazuje
 * jen to, co běží teď a co je dnes a zítra, takže data s pevnými daty by byla
 * druhý den k ničemu.
 *
 * DODRŽUJE PRAVIDLA APLIKACE (jinak nejdou bloky v plánu uložit):
 *   1. začátek bloku leží na 30minutové hranici (`startTime % SLOT_MS === 0`),
 *   2. délka tisku je násobek 30 minut (`printMinutes % 30 === 0`),
 *   3. štítky DATA / MATERIÁL / BARVY / LAK / ARCHY / SÉRIE se berou z číselníku
 *      (tabulka `CodebookOption`), ne jako volný text — jinak se v plánu objeví
 *      hodnoty, které v číselníku nejsou, a editace bloku spadne.
 *
 * Číselníky musí být naplněné: `npm run prisma:bootstrap` (idempotentní).
 */
import { PrismaClient } from "@prisma/client";
import { SLOT_MS } from "../src/lib/timeSlots";

const prisma = new PrismaClient();

const MIN = 60_000;
const H = 60 * MIN;

/** Stroj tiskařského účtu, na kterém se testuje. */
const MAIN = "XL_105";
const OTHER = "XL_106";

type Opt = { id: number; label: string };

/** Vybere položku číselníku podle popisku; hodí, když v číselníku není. */
async function opt(category: string, label: string): Promise<Opt> {
  const found = await prisma.codebookOption.findFirst({ where: { category, label } });
  if (!found) {
    throw new Error(
      `Číselník ${category} nemá položku "${label}". Spusť nejdřív: npm run prisma:bootstrap`
    );
  }
  return { id: found.id, label: found.label };
}

async function clean() {
  const { count } = await prisma.block.deleteMany({ where: { orderNumber: { startsWith: "MON-" } } });
  console.log(`Smazáno ${count} testovacích bloků MON-.`);
}

async function seed() {
  const existing = await prisma.block.count({ where: { orderNumber: { startsWith: "MON-" } } });
  if (existing > 0) {
    console.log(`Už je vloženo ${existing} bloků MON-. Nejdřív je smaž:`);
    console.log(`   npx tsx prisma/seed-monitor.ts --clean`);
    return;
  }

  // Kotva zarovnaná na 30minutovou hranici — všechny časy jsou od ní odvozené
  // v celých půlhodinách, aby seděly na pravidlo aplikace.
  const anchor = Math.floor(Date.now() / SLOT_MS) * SLOT_MS;
  const at = (offsetMs: number) => new Date(anchor + offsetMs);
  /** Ráno v 6:00 pražského času za `days` dní (4:00 UTC v létě). */
  const morningIn = (days: number) => {
    const d = new Date(anchor + days * 24 * H);
    d.setUTCHours(4, 0, 0, 0);
    return d;
  };
  /** Konec = začátek + délka tisku. Obojí zarovnané, takže konec vyjde taky. */
  const end = (start: Date, printMinutes: number) => new Date(start.getTime() + printMinutes * MIN);

  const dataOkOpt = await opt("DATA", "PŘIPRAVENO");
  const dataBadOpt = await opt("DATA", "CHYBNÁ DATA");
  const matStock = await opt("MATERIAL", "SKLADEM");
  const matSheets = await opt("MATERIAL", "TISK Z ARCHŮ");
  const barvy = await opt("BARVY", "SCH Lumina LED");
  const lak = await opt("LAK", "disperse lesk");
  const arch3 = await opt("TISKOVY_ARCH", "3. TA");
  const arch8 = await opt("TISKOVY_ARCH", "8. TA");
  const serie2 = await opt("SERIE", "2. série");

  const group = await prisma.splitGroup.create({ data: {} });

  /** Zakázka s daty připravenými a materiálem na skladě — nejběžnější stav. */
  const ready = {
    type: "ZAKAZKA" as const,
    dataStatusId: dataOkOpt.id, dataStatusLabel: dataOkOpt.label, dataOk: true,
    materialStatusId: matStock.id, materialStatusLabel: matStock.label, materialInStock: true,
  };

  const rows: { start: Date; printMinutes: number; data: Record<string, unknown> }[] = [];
  const add = (start: Date, printMinutes: number, data: Record<string, unknown>) =>
    rows.push({ start, printMinutes, data });

  // ── Hotové zakázky z dnešního rána — ve frontě ztlumené se zeleným háčkem ──
  add(at(-13 * H), 180, {
    ...ready, orderNumber: "MON-2401", machine: MAIN,
    description: "Obálky ČSOB — série B",
    specifikace: "DL okno vpravo · 4/0 · 90 g ofset",
    printCompletedAt: at(-10 * H + 8 * MIN), printCompletedByUsername: "tiskar",
  });
  add(at(-10 * H), 150, {
    ...ready, orderNumber: "MON-2402", machine: MAIN,
    description: "Vizitky — sada 12 jmen",
    specifikace: "90 × 50 mm · 4/4 · 300 g NL · mat lamino",
    printCompletedAt: at(-7.5 * H + 11 * MIN), printCompletedByUsername: "tiskar",
  });

  // ── PŘETAHUJE: čas vypršel, nikdo neodklepl ──
  add(at(-3 * H), 90, {
    ...ready, orderNumber: "MON-2403", machine: MAIN,
    description: "Plakát A1 — výstava Náchod",
    specifikace: "A1 · 4/0 · 150 g NL",
    dataStatusId: dataBadOpt.id, dataStatusLabel: dataBadOpt.label, dataOk: false,
    materialStatusId: matSheets.id, materialStatusLabel: matSheets.label, materialInStock: false,
  });

  // ── TEĎ BĚŽÍ + půlka split zakázky (druhá je na druhém stroji) ──
  add(at(-1 * H), 240, {
    ...ready, orderNumber: "MON-2404", machine: MAIN,
    description: "Katalog jaro 2026 — Alimpex",
    specifikace: "B2 · 4/4 · 130 g natíraný lesk · disperzní lak",
    obalka: true,
    tiskoveArchy: arch3.label, serie: serie2.label,
    barvyStatusId: barvy.id, barvyStatusLabel: barvy.label,
    lakStatusId: lak.id, lakStatusLabel: lak.label,
    pantoneRequired: true, pantoneOk: false,
    splitGroupId: group.id,
  });

  // ── ZAČÍNÁ dnes ──
  add(at(3.5 * H), 120, {
    ...ready, orderNumber: "MON-2405", machine: MAIN,
    description: "Leták Kincl — jarní akce",
    specifikace: "A5 · 4/4 · 135 g NL",
    vnitrky: true, tiskoveArchy: arch3.label,
  });

  // ── ZAČÍNÁ ZÍTRA — na téhle se testuje potvrzení na dvě kliknutí ──
  add(morningIn(1), 240, {
    ...ready, orderNumber: "MON-2406", machine: MAIN,
    description: "Krabičky Zentiva — šarže 340",
    specifikace: "GC2 350 g · 4/0 · výsek + lepení",
    tiskoveArchy: arch8.label,
  });

  // ── POZASTAVENO — musí být na kartě vidět červeným štítkem ──
  add(new Date(morningIn(1).getTime() + 5 * H), 120, {
    ...ready, orderNumber: "MON-2407", machine: MAIN,
    description: "Ročenka 2025 — pozastaveno zákazníkem",
    specifikace: "A4 · 4/4 · 115 g NL",
    blockVariant: "POZASTAVENO",
  });

  // ── Vzdálená zakázka — ověří popisek s datem („13. 08.") místo „zítra" ──
  add(morningIn(3), 180, {
    ...ready, orderNumber: "MON-2408", machine: MAIN,
    description: "Direct mail — srpnová vlna",
    specifikace: "C5 · 4/4 · 100 g ofset",
  });

  // ── Druhý stroj: hotová půlka split zakázky ──
  add(at(-2 * H), 90, {
    ...ready, orderNumber: "MON-2404", machine: OTHER,
    description: "Katalog jaro 2026 — Alimpex (vnitřky)",
    specifikace: "B2 · 4/4 · 130 g natíraný lesk",
    vnitrky: true, tiskoveArchy: arch3.label, serie: serie2.label,
    printCompletedAt: at(-0.5 * H - 9 * MIN), printCompletedByUsername: "tiskar",
    splitGroupId: group.id,
  });

  // ── Druhý stroj: běžící zakázka, ať je co vidět po přepnutí ──
  add(at(-0.5 * H), 210, {
    ...ready, orderNumber: "MON-2409", machine: OTHER,
    description: "Etikety IML — Alimpex jogurt 400 g",
    specifikace: "IML · 5/0 · PP 60 µm",
    tiskoveArchy: arch8.label,
  });

  // Pojistka: než cokoli zapíšeme, ověříme obě pravidla aplikace na vlastních
  // datech. Lepší spadnout tady než až tiskaři při editaci bloku v plánu.
  for (const r of rows) {
    if (r.start.getTime() % SLOT_MS !== 0) {
      throw new Error(`${r.data.orderNumber}: začátek ${r.start.toISOString()} není na 30minutové hranici.`);
    }
    if (r.printMinutes % 30 !== 0) {
      throw new Error(`${r.data.orderNumber}: délka tisku ${r.printMinutes} min není násobek 30.`);
    }
  }

  for (const r of rows) {
    await prisma.block.create({
      data: { ...r.data, startTime: r.start, endTime: end(r.start, r.printMinutes), printMinutes: r.printMinutes } as never,
    });
  }

  // Upozorníme na překryv se staršími bloky. Databáze překryv nehlídá (dělá to
  // až aplikace), takže by se v plánu jinak tiše kreslily přes sebe.
  const from = new Date(anchor - 14 * H);
  const to = new Date(morningIn(3).getTime() + 3 * H);
  const others = await prisma.block.findMany({
    where: { startTime: { lt: to }, endTime: { gt: from }, orderNumber: { not: { startsWith: "MON-" } } },
    select: { orderNumber: true, machine: true, startTime: true, endTime: true },
  });
  const collisions = others.filter((o) =>
    rows.some(
      (r) =>
        r.data.machine === o.machine &&
        r.start < o.endTime &&
        end(r.start, r.printMinutes) > o.startTime
    )
  );

  console.log(`Vloženo ${rows.length} bloků (prefix MON-), split skupina id=${group.id}.`);
  console.log("Všechny začátky na 30min hranici, všechny délky násobek 30 min, štítky z číselníku.");
  if (collisions.length > 0) {
    console.log(`\nPozor: ${collisions.length} starších bloků se s novými v plánu překrývá:`);
    collisions.forEach((c) =>
      console.log(`   ${c.machine} ${c.orderNumber} ${c.startTime.toISOString()} → ${c.endTime.toISOString()}`)
    );
  }
  console.log(`\nÚklid: npx tsx prisma/seed-monitor.ts --clean`);
}

const run = process.argv.includes("--clean") ? clean : seed;
run()
  .catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); })
  .finally(() => prisma.$disconnect());
