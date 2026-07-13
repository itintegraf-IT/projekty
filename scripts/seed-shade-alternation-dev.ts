/**
 * DEV-ONLY vizuální seed: naplní testovací bloky do jedné dráhy stroje tak, aby
 * bylo vidět STŘÍDÁNÍ ODSTÍNŮ u sousedících zakázek/rezervací téže barvy.
 *
 * - XL_105: řetěz ZAKÁZEK stejné barvy s téměř stejnými názvy (+ jeden split)
 * - XL_106: řetěz REZERVACÍ (+ jeden split)
 *
 * Split kusy jedné zakázky sdílí splitGroupId → měly by mít STEJNÝ odstín; každá
 * další zakázka se překlopí na světlejší/tmavší.
 *
 * Spuštění:   node --import tsx scripts/seed-shade-alternation-dev.ts
 * Idempotent: napřed smaže vlastní testovací bloky (orderNumber v SEED_ORDERS).
 * Pojistka:   odmítne běžet proti produkční DB (host 192.168.10.210).
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

if ((process.env.DATABASE_URL ?? "").includes("192.168.10.210")) {
  console.error("❌ DATABASE_URL míří na produkci — seed odmítnut.");
  process.exit(1);
}

// Fake číselné řady zakázek (vysoké číslo → nekoliduje s reálnými dev bloky).
const SEED_ORDERS = [
  "T-18901", "T-18902", "T-18903", "T-18904",
  "T-18951", "T-18952", "T-18953", "T-18954",
];

// Pondělí příštího týdne, ráno v UTC (v Praze +2h = CEST). Kontiguita zůstává.
const DAY = "2026-07-06";
const at = (h: number) => new Date(`${DAY}T${String(h).padStart(2, "0")}:00:00.000Z`);

type Seed = {
  order: string;
  machine: string;
  type: "ZAKAZKA" | "REZERVACE";
  from: number;
  to: number;
  description: string;
  specifikace: string;
  /** id "kotvy" splitu — piece se stejnou kotvou sdílí splitGroupId (nastaví se po vytvoření). */
  splitAnchor?: string;
};

const seeds: Seed[] = [
  // ── XL_105 — ZAKÁZKY stejné barvy za sebou (podobné názvy) ──────────────────
  { order: "T-18901", machine: "XL_105", type: "ZAKAZKA", from: 6,  to: 10, description: "MASO JIČÍN — Krabička", specifikace: "5/0 · 90g · lak" },
  { order: "T-18902", machine: "XL_105", type: "ZAKAZKA", from: 10, to: 14, description: "MASO JIČÍN — Krabička", specifikace: "5/0 · 120g · lak", splitAnchor: "A" },
  { order: "T-18902", machine: "XL_105", type: "ZAKAZKA", from: 14, to: 17, description: "MASO JIČÍN — Krabička", specifikace: "5/0 · 120g · lak", splitAnchor: "A" },
  { order: "T-18903", machine: "XL_105", type: "ZAKAZKA", from: 17, to: 20, description: "MASO JIČÍN — Etiketa",  specifikace: "4/0 · 80g" },
  { order: "T-18904", machine: "XL_105", type: "ZAKAZKA", from: 20, to: 23, description: "MASO JIČÍN — Krabička", specifikace: "5/0 · 90g · mat" },

  // ── XL_106 — REZERVACE stejné barvy za sebou ────────────────────────────────
  { order: "T-18951", machine: "XL_106", type: "REZERVACE", from: 6,  to: 9,  description: "Alimpex — IML kelímek", specifikace: "6/0 · IML" },
  { order: "T-18952", machine: "XL_106", type: "REZERVACE", from: 9,  to: 12, description: "Alimpex — IML víčko",   specifikace: "6/0 · IML", splitAnchor: "B" },
  { order: "T-18952", machine: "XL_106", type: "REZERVACE", from: 12, to: 15, description: "Alimpex — IML víčko",   specifikace: "6/0 · IML", splitAnchor: "B" },
  { order: "T-18953", machine: "XL_106", type: "REZERVACE", from: 15, to: 18, description: "Alimpex — IML kelímek", specifikace: "6/0 · IML" },
  { order: "T-18954", machine: "XL_106", type: "REZERVACE", from: 18, to: 21, description: "Alimpex — IML tácek",   specifikace: "6/0 · IML" },
];

async function main() {
  console.log("🎨 Seed střídání odstínů (DEV)…\n");

  // ── Idempotentní úklid: zapamatuj split skupiny seed bloků, rozpoj FK, smaž bloky i skupiny ──
  const existing = await prisma.block.findMany({
    where: { orderNumber: { in: SEED_ORDERS } },
    select: { splitGroupId: true },
  });
  const oldGroupIds = [...new Set(existing.map((b) => b.splitGroupId).filter((x): x is number => x != null))];
  await prisma.block.updateMany({ where: { orderNumber: { in: SEED_ORDERS } }, data: { splitGroupId: null } });
  const del = await prisma.block.deleteMany({ where: { orderNumber: { in: SEED_ORDERS } } });
  if (del.count > 0) console.log(`🧹 Smazáno ${del.count} starých testovacích bloků.\n`);
  if (oldGroupIds.length > 0) {
    await prisma.splitGroup.deleteMany({ where: { id: { in: oldGroupIds } } });
    console.log(`🧹 Smazáno ${oldGroupIds.length} starých split skupin.\n`);
  }

  // ── Vytvoření bloků; splitAnchor → sdílený splitGroupId ─────────────────────
  const anchorGroupId = new Map<string, number>(); // klíč → SplitGroup.id (B2)

  for (const s of seeds) {
    const created = await prisma.block.create({
      data: {
        orderNumber: s.order,
        type: s.type,
        machine: s.machine,
        startTime: at(s.from),
        endTime: at(s.to),
        description: s.description,
        specifikace: s.specifikace,
        printMinutes: null, // kreslí se slitě — žádné pauzy/drift do demo nezasahují
      },
    });

    if (s.splitAnchor) {
      const key = `${s.machine}:${s.splitAnchor}`;
      // B2: split skupina = řádek v SplitGroup; první kus ji vytvoří, další ji sdílí.
      let gid = anchorGroupId.get(key);
      if (gid === undefined) {
        gid = (await prisma.splitGroup.create({ data: {} })).id;
        anchorGroupId.set(key, gid);
      }
      await prisma.block.update({ where: { id: created.id }, data: { splitGroupId: gid } });
    }

    const split = s.splitAnchor ? " ✂" : "";
    console.log(`✅ ${s.machine}  ${String(s.from).padStart(2, "0")}–${String(s.to).padStart(2, "0")}  ${s.order}  ${s.description}${split}`);
  }

  console.log(`\n✅ Hotovo. Obnov si plán v prohlížeči (F5) na týden ${DAY}.`);
  console.log("   XL 105 = zakázky (modrá), XL 106 = rezervace (fialová). Sousedící se střídají odstínem;");
  console.log("   dva kusy „IML víčko“ / „Krabička 120g“ (✂ split) drží stejný odstín.");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
