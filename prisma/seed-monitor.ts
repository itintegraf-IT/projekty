/**
 * Přídavná testovací data pro tiskařskou obrazovku Monitor (DEV ONLY).
 *
 * Spuštění:  npx tsx prisma/seed-monitor.ts
 *
 * NIC NEMAŽE. Vkládá bloky s prefixem `MON-`, takže jdou kdykoli odstranit:
 *   npx tsx prisma/seed-monitor.ts --clean
 *
 * Časy se počítají RELATIVNĚ K OKAMŽIKU SPUŠTĚNÍ, ne napevno — jinak by data
 * byla druhý den k ničemu (Monitor ukazuje jen to, co běží teď a co je dnes).
 *
 * Rozvržení je postavené tak, aby si šly projít všechny stavy karty za sebou:
 *   běžící → přetahující → dnešní budoucí → zítřejší (potvrzení) → vzdálená (datum).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MIN = 60_000;
const H = 60 * MIN;

/** Stroj tiskařského účtu, na kterém se testuje. Druhý stroj dostane jen pár bloků. */
const MAIN = "XL_105";
const OTHER = "XL_106";

const base = {
  type: "ZAKAZKA" as const,
  dataStatusLabel: "DATA OK",
  dataOk: true,
  materialStatusLabel: "MATERIÁL",
  materialOk: true,
};

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

  const now = Date.now();
  const at = (offsetMs: number) => new Date(now + offsetMs);
  // Zítřejší a vzdálené zakázky kotvíme na ráno, ne na „teď + 24 h“ — jinak by
  // „zítra v 6:00“ vyšlo na náhodnou hodinu podle toho, kdy se skript spustil.
  const morningIn = (days: number) => {
    const d = new Date(now + days * 24 * H);
    d.setUTCHours(4, 0, 0, 0); // 4:00 UTC = 6:00 pražského času v létě
    return d;
  };

  const group = await prisma.splitGroup.create({ data: {} });

  const blocks = [
    // ── Hotové zakázky z dnešního rána — ve frontě vpravo ztlumené s háčkem ──
    {
      ...base, orderNumber: "MON-2401", machine: MAIN,
      startTime: at(-13 * H), endTime: at(-10 * H), printMinutes: 180,
      description: "Obálky ČSOB — série B",
      specifikace: "DL okno vpravo · 4/0 · 90 g ofset",
      printCompletedAt: at(-10 * H + 8 * MIN), printCompletedByUsername: "tiskar",
    },
    {
      ...base, orderNumber: "MON-2402", machine: MAIN,
      startTime: at(-10 * H), endTime: at(-7.5 * H), printMinutes: 150,
      description: "Vizitky — sada 12 jmen",
      specifikace: "90 × 50 mm · 4/4 · 300 g NL · mat lamino",
      printCompletedAt: at(-7.5 * H + 11 * MIN), printCompletedByUsername: "tiskar",
    },

    // ── PŘETAHUJE: čas vypršel, nikdo neodklepl (uvnitř 16h okna) ──
    {
      ...base, orderNumber: "MON-2403", machine: MAIN,
      startTime: at(-2.2 * H), endTime: at(-1.5 * H), printMinutes: 42,
      description: "Plakát A1 — výstava Náchod",
      specifikace: "A1 · 4/0 · 150 g NL",
      materialOk: false, materialStatusLabel: "MATERIÁL ČEKÁ",
    },

    // ── TEĎ BĚŽÍ, a je to půlka split zakázky (druhá půlka na druhém stroji) ──
    {
      ...base, orderNumber: "MON-2404", machine: MAIN,
      startTime: at(-1.4 * H), endTime: at(2 * H), printMinutes: 204,
      description: "Katalog jaro 2026 — Alimpex",
      specifikace: "B2 · 4/4 · 130 g natíraný lesk · disperzní lak",
      obalka: true, tiskoveArchy: "12 archů", serie: "3 série",
      pantoneRequired: true, pantoneOk: false,
      splitGroupId: group.id,
    },

    // ── ZAČÍNÁ dnes, za chvíli ──
    {
      ...base, orderNumber: "MON-2405", machine: MAIN,
      startTime: at(2.5 * H), endTime: at(4.5 * H), printMinutes: 120,
      description: "Leták Kincl — jarní akce",
      specifikace: "A5 · 4/4 · 135 g NL",
      vnitrky: true, tiskoveArchy: "4 archy",
    },

    // ── ZAČÍNÁ ZÍTRA — na téhle se testuje potvrzení na dvě kliknutí ──
    {
      ...base, orderNumber: "MON-2406", machine: MAIN,
      startTime: morningIn(1), endTime: new Date(morningIn(1).getTime() + 4 * H), printMinutes: 240,
      description: "Krabičky Zentiva — šarže 340",
      specifikace: "GC2 350 g · 4/0 · výsek + lepení",
      tiskoveArchy: "8 archů",
    },

    // ── POZASTAVENO — musí být na kartě vidět červeným štítkem ──
    {
      ...base, orderNumber: "MON-2407", machine: MAIN,
      startTime: new Date(morningIn(1).getTime() + 5 * H),
      endTime: new Date(morningIn(1).getTime() + 7 * H), printMinutes: 120,
      description: "Ročenka 2025 — pozastaveno zákazníkem",
      specifikace: "A4 · 4/4 · 115 g NL",
      blockVariant: "POZASTAVENO",
    },

    // ── Vzdálená zakázka — ověří popisek s datem („13. 08.") místo „zítra" ──
    {
      ...base, orderNumber: "MON-2408", machine: MAIN,
      startTime: morningIn(3), endTime: new Date(morningIn(3).getTime() + 3 * H), printMinutes: 180,
      description: "Direct mail — srpnová vlna",
      specifikace: "C5 · 4/4 · 100 g ofset",
    },

    // ── Druhý stroj: hotová půlka split zakázky (štítek na kartě prvního stroje) ──
    {
      ...base, orderNumber: "MON-2404", machine: OTHER,
      startTime: at(-1.8 * H), endTime: at(-0.5 * H), printMinutes: 78,
      description: "Katalog jaro 2026 — Alimpex (vnitřky)",
      specifikace: "B2 · 4/4 · 130 g natíraný lesk",
      vnitrky: true, tiskoveArchy: "12 archů", serie: "3 série",
      printCompletedAt: at(-0.5 * H - 9 * MIN), printCompletedByUsername: "tiskar",
      splitGroupId: group.id,
    },

    // ── Druhý stroj: běžící zakázka, ať je co vidět po přepnutí stroje ──
    {
      ...base, orderNumber: "MON-2409", machine: OTHER,
      startTime: at(-0.3 * H), endTime: at(3 * H), printMinutes: 198,
      description: "Etikety IML — Alimpex jogurt 400 g",
      specifikace: "IML · 5/0 · PP 60 µm",
      tiskoveArchy: "20 archů",
    },
  ];

  for (const b of blocks) {
    await prisma.block.create({ data: b });
  }

  // Upozorníme na překryv se staršími testovacími daty. Databáze překryv nehlídá
  // (dělá to až aplikace), takže by se v plánu jinak tiše kreslily bloky přes sebe.
  const from = new Date(now - 14 * H);
  const to = new Date(morningIn(3).getTime() + 3 * H);
  const others = await prisma.block.findMany({
    where: { startTime: { lt: to }, endTime: { gt: from }, orderNumber: { not: { startsWith: "MON-" } } },
    select: { orderNumber: true, machine: true, startTime: true, endTime: true },
  });
  const collisions = others.filter((o) =>
    blocks.some((b) => b.machine === o.machine && b.startTime < o.endTime && b.endTime > o.startTime)
  );

  console.log(`Vloženo ${blocks.length} bloků (prefix MON-), split skupina id=${group.id}.`);
  if (collisions.length > 0) {
    console.log(`\nPozor: ${collisions.length} starších bloků se s novými v plánu překrývá:`);
    collisions.forEach((c) =>
      console.log(`   ${c.machine} ${c.orderNumber} ${c.startTime.toISOString()} → ${c.endTime.toISOString()}`)
    );
    console.log("   Monitoru to nevadí, ale v plánu se budou kreslit přes sebe.");
  }
  console.log(`\nÚklid: npx tsx prisma/seed-monitor.ts --clean`);
}

const run = process.argv.includes("--clean") ? clean : seed;
run()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
