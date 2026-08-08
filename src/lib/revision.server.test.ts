import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveChainPushFromDb } from "@/lib/overlapResolver.server";
import { withRevision } from "./revision.server";

const USER = { id: 1, username: "test" };

/**
 * Druhé nezávislé spojení. Souběh (cizí commit mezi snapshotem a naším zápisem)
 * NEJDE nasimulovat jedním klientem — a právě proti němu stojí `FOR UPDATE`
 * i pojistka `count`/`partial`. Bez druhého spojení by ty testy měřily mock.
 */
const other = new PrismaClient();

/**
 * `process.env.NODE_ENV` je v typech Next.js jen pro čtení. Testy na degradaci
 * v produkci ho ale přepnout musí — pomocník to dělá přes indexový zápis,
 * aby se kvůli tomu nemusel vypínat typecheck v celém souboru.
 */
function setNodeEnv(value: string | undefined) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

/**
 * Split-skupiny, které testy založily. Uklízí se JEN tyhle.
 *
 * Plošné mazání „osiřelých" skupin (bez bloků) by bylo nebezpečné: v dev DB je
 * osiřelých všech 8 existujících skupin, takže by úklid smazal cizí data
 * (ověřeno 7. 8. 2026).
 */
const createdSplitGroupIds: number[] = [];

async function seedSplitGroup() {
  const group = await prisma.splitGroup.create({ data: {} });
  createdSplitGroupIds.push(group.id);
  return group;
}

/**
 * Úklid, který proběhne i po ČERVENÉM běhu. Bez něj zůstávají v dev DB zbytky:
 * assertion vyhodí výjimku dřív, než v těle testu doběhne jeho vlastní `delete`
 * (reálně se to stalo při mutačním testování — tři padlé běhy nechaly 5 bloků,
 * 1 revizi a 2 skupiny). V téže databázi je ruční testovací fixtura, se kterou
 * pracuje člověk, takže se maže VÝHRADNĚ podle bezpečného rozlišovacího znaku:
 * prefix `REV-` v `orderNumber` (ověřeno, že s ničím v DB nekoliduje) a vlastní
 * evidence založených skupin. Nikdy podle času a nikdy plošně.
 *
 * Revize se mažou taky přes `orderNumber` — je v `BlockRevision` denormalizovaný
 * právě proto, aby řádek dával smysl i po smazání bloku, takže vazba přes
 * `blockId` by u testu na DELETE nic nenašla.
 */
after(async () => {
  await prisma.blockRevision.deleteMany({ where: { orderNumber: { startsWith: "REV-" } } });
  // Marker řádky (blockId 0) nemají orderNumber, mažou se přes groupId testů.
  await prisma.blockRevision.deleteMany({ where: { blockId: 0, username: USER.username } });
  await prisma.block.deleteMany({ where: { orderNumber: { startsWith: "REV-" } } });
  // AuditLog: inline úklid uvnitř testu je AŽ ZA assertion, takže po červeném
  // běhu zůstával trvalý řádek (naměřeno 1357 → 1358). Sem patří taky.
  await prisma.auditLog.deleteMany({ where: { username: USER.username } });
  if (createdSplitGroupIds.length > 0) {
    await prisma.splitGroup.deleteMany({ where: { id: { in: createdSplitGroupIds } } });
  }
  await prisma.$disconnect();
  await other.$disconnect();
});

/** Založí blok mimo withRevision, aby se dal změnit a revize se dala zkoumat. */
async function seedBlock(machine = "XL_105") {
  return prisma.block.create({
    data: {
      orderNumber: "REV-TEST",
      machine,
      startTime: new Date("2026-12-01T06:00:00.000Z"),
      endTime: new Date("2026-12-01T14:00:00.000Z"),
      type: "ZAKAZKA",
      printMinutes: 480,
    },
  });
}

/**
 * Blok založený DRUHÝM spojením, tedy commitnutý zvenčí uprostřed naší
 * transakce. Je to jediný způsob, jak vyrobit SKUTEČNÝ fantom: řádek, který
 * zápis (current read) trefí, ale zachycení (snapshot) ho nevidělo — tedy řádek
 * změněný BEZ revize. Souběžné SMAZÁNÍ fantom není, viz testy níž.
 */
async function seedBlockFromOutside(orderNumber: string, machine = "XL_106") {
  return other.block.create({
    data: {
      orderNumber,
      machine,
      startTime: new Date("2026-12-02T06:00:00.000Z"),
      endTime: new Date("2026-12-02T14:00:00.000Z"),
      type: "ZAKAZKA",
      printMinutes: 480,
    },
  });
}

test("úprava bloku vyrobí revizi se správným rozdílem", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "UPDATE", label: "Přesun bloku", user: USER },
    async (rtx) => rtx.block.update({ where: { id: block.id }, data: { machine: "XL_106" } }),
  );

  const revs = await prisma.blockRevision.findMany({ where: { groupId } });
  assert.equal(revs.length, 1);
  assert.equal(revs[0].kind, "UPDATE");
  assert.equal(revs[0].blockId, block.id);
  assert.equal(revs[0].machine, "XL_105", "machine je stav PŘED změnou");
  assert.deepEqual((revs[0].before as Record<string, unknown>).machine, "XL_105");
  assert.deepEqual((revs[0].after as Record<string, unknown>).machine, "XL_106");
  assert.equal(revs[0].partial, false);
  assert.ok(revs[0].rowVersion instanceof Date);

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.delete({ where: { id: block.id } });
});

test("zápis bez věcné změny nevyrobí žádnou revizi", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "UPDATE", label: "Uložení beze změny", user: USER },
    async (rtx) => rtx.block.update({ where: { id: block.id }, data: { machine: "XL_105" } }),
  );
  const count = await prisma.blockRevision.count({ where: { groupId } });
  assert.equal(count, 0, "updatedAt se změnil, ale věcně se nezměnilo nic");
  await prisma.block.delete({ where: { id: block.id } });
});

test("updateMany zachytí i řádek na jiném stroji (split sourozenec)", async () => {
  const a = await seedBlock("XL_105");
  const b = await seedBlock("XL_106");
  const group = await seedSplitGroup();
  await prisma.block.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { splitGroupId: group.id } });

  const { groupId } = await withRevision(
    { action: "UPDATE", label: "Propagace sdíleného pole", user: USER },
    async (rtx) => rtx.block.updateMany({
      where: { splitGroupId: group.id },
      data: { deadlineExpedice: new Date("2026-12-20T00:00:00.000Z") },
    }),
  );

  const revs = await prisma.blockRevision.findMany({ where: { groupId }, orderBy: { blockId: "asc" } });
  assert.equal(revs.length, 2, "oba sourozenci, přestože jsou na různých strojích");
  assert.deepEqual(revs.map((r) => r.machine).sort(), ["XL_105", "XL_106"]);

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  await prisma.splitGroup.delete({ where: { id: group.id } });
});

test("vznik bloku má kind CREATE a chybějící before", async () => {
  const { result, groupId } = await withRevision(
    { action: "CREATE", label: "Nová zakázka", user: USER },
    async (rtx) => rtx.block.create({
      data: {
        orderNumber: "REV-NEW", machine: "XL_105",
        startTime: new Date("2026-12-02T06:00:00.000Z"),
        endTime: new Date("2026-12-02T14:00:00.000Z"),
        type: "ZAKAZKA", printMinutes: 480,
      },
    }),
  );
  const rev = await prisma.blockRevision.findFirstOrThrow({ where: { groupId } });
  assert.equal(rev.kind, "CREATE");
  assert.equal(rev.before, null);
  assert.ok(rev.after);

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.delete({ where: { id: result.id } });
});

test("smazání bloku má kind DELETE a celý řádek v before", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "DELETE", label: "Smazání bloku", user: USER },
    async (rtx) => rtx.block.delete({ where: { id: block.id } }),
  );
  const rev = await prisma.blockRevision.findFirstOrThrow({ where: { groupId } });
  assert.equal(rev.kind, "DELETE");
  assert.equal(rev.after, null);
  assert.equal((rev.before as Record<string, unknown>).orderNumber, "REV-TEST");
  // Denormalizovaný sloupec, ne obsah JSONu: u smazaného bloku je to JEDINÉ,
  // podle čeho jde poznat, o kterou zakázku šlo (`blockId` ukazuje na řádek,
  // který už neexistuje). Bez tohohle assertu přežila mutace `orderNumber: null`
  // celou suitu (recenze 8. 8. 2026).
  assert.equal(rev.orderNumber, "REV-TEST");
  await prisma.blockRevision.deleteMany({ where: { groupId } });
});

test("auditní řádky dostanou groupId automaticky", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "UPDATE", label: "Editace", user: USER },
    async (rtx) => {
      await rtx.block.update({ where: { id: block.id }, data: { machine: "XL_106" } });
      await rtx.auditLog.create({
        data: { blockId: block.id, userId: USER.id, username: USER.username, action: "UPDATE", field: "machine" },
      });
    },
  );
  const logs = await prisma.auditLog.findMany({ where: { groupId } });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].field, "machine");

  await prisma.auditLog.deleteMany({ where: { groupId } });
  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.delete({ where: { id: block.id } });
});

test("rollback těla nezanechá revizi ani auditní řádek", async () => {
  const block = await seedBlock();
  const before = await prisma.blockRevision.count();
  await assert.rejects(
    withRevision({ action: "UPDATE", label: "Spadne", user: USER }, async (rtx) => {
      await rtx.block.update({ where: { id: block.id }, data: { machine: "XL_106" } });
      throw new Error("záměrný pád");
    }),
    /záměrný pád/,
  );
  assert.equal(await prisma.blockRevision.count(), before);
  const fresh = await prisma.block.findUniqueOrThrow({ where: { id: block.id } });
  assert.equal(fresh.machine, "XL_105", "mutace se taky vrátila");
  await prisma.block.delete({ where: { id: block.id } });
});

test("upsert nad existujícím řádkem vyrobí revizi kind UPDATE", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "UPDATE", label: "Upsert existujícího", user: USER },
    async (rtx) => rtx.block.upsert({
      where: { id: block.id },
      update: { machine: "XL_106" },
      create: {
        orderNumber: "REV-UPSERT", machine: "XL_106",
        startTime: new Date("2026-12-03T06:00:00.000Z"),
        endTime: new Date("2026-12-03T14:00:00.000Z"),
        type: "ZAKAZKA", printMinutes: 480,
      },
    }),
  );

  const revs = await prisma.blockRevision.findMany({ where: { groupId } });
  assert.equal(revs.length, 1, "upsert NESMÍ obejít revizi");
  assert.equal(revs[0].kind, "UPDATE");
  assert.equal(revs[0].blockId, block.id);
  assert.equal(revs[0].machine, "XL_105", "machine je stav PŘED změnou");
  assert.deepEqual((revs[0].before as Record<string, unknown>).machine, "XL_105");
  assert.deepEqual((revs[0].after as Record<string, unknown>).machine, "XL_106");

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.delete({ where: { id: block.id } });
});

test("upsert nad neexistujícím řádkem vyrobí revizi kind CREATE", async () => {
  const { result, groupId } = await withRevision(
    { action: "CREATE", label: "Upsert nového", user: USER },
    async (rtx) => rtx.block.upsert({
      where: { id: 2_000_000_001 },
      update: { machine: "XL_106" },
      create: {
        orderNumber: "REV-UPSERT-NEW", machine: "XL_105",
        startTime: new Date("2026-12-04T06:00:00.000Z"),
        endTime: new Date("2026-12-04T14:00:00.000Z"),
        type: "ZAKAZKA", printMinutes: 480,
      },
    }),
  );

  const revs = await prisma.blockRevision.findMany({ where: { groupId } });
  assert.equal(revs.length, 1);
  assert.equal(revs[0].kind, "CREATE");
  assert.equal(revs[0].blockId, result.id);
  assert.equal(revs[0].before, null);
  assert.equal((revs[0].after as Record<string, unknown>).orderNumber, "REV-UPSERT-NEW");

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.delete({ where: { id: result.id } });
});

test("neznámá zápisová metoda delegáta je odmítnutá, ne tiše propuštěná", async () => {
  await assert.rejects(
    withRevision({ action: "UPDATE", label: "Budoucí metoda Prismy", user: USER }, async (rtx) =>
      // Zástupce za „Prisma přidala novou zápisovou metodu". Nesmí propadnout
      // na syrový delegát — přesně tak obcházel revize upsert.
      (rtx.block as unknown as { updateManyAndReturn: (a: unknown) => Promise<unknown> })
        .updateManyAndReturn({ where: {}, data: {} }),
    ),
    /updateManyAndReturn není uvnitř withRevision podporované/,
  );
});

test("čtecí metody delegáta procházejí beze změny", async () => {
  const block = await seedBlock();
  const { result, groupId } = await withRevision(
    { action: "UPDATE", label: "Jen čtení", user: USER },
    async (rtx) => ({
      unique: await rtx.block.findUnique({ where: { id: block.id }, select: { machine: true } }),
      many: (await rtx.block.findMany({ where: { orderNumber: "REV-TEST" }, select: { id: true } })).length,
      count: await rtx.block.count({ where: { id: block.id } }),
    }),
  );
  assert.equal(result.unique?.machine, "XL_105");
  assert.ok(result.many >= 1);
  assert.equal(result.count, 1);
  assert.equal(await prisma.blockRevision.count({ where: { groupId } }), 0, "čtení nevyrobí revizi");

  await prisma.block.delete({ where: { id: block.id } });
});

test("block.createMany uvnitř withRevision je zakázané", async () => {
  await assert.rejects(
    withRevision({ action: "CREATE", label: "Dávka", user: USER }, async (rtx) =>
      rtx.block.createMany({ data: [] }),
    ),
    // Konkrétní hláška, ne jen slovo "createMany": vývojáři musí říct, CO má
    // udělat místo toho. Obecný pád z allow-listu by test taky prošel.
    /MySQL nevrací id.*Použij create ve smyčce/s,
  );
});

// ---------------------------------------------------------------------------
// Pojistky proti souběhu. Bez druhého spojení by tyhle dva testy neměřily nic:
// fantom mezi snapshotem a zápisem jinak nevznikne.
// ---------------------------------------------------------------------------

test("souběžné smazání sourozence zdravou editaci NESHODÍ (updateMany)", async () => {
  // `resolveIds` čte snapshotem, `updateMany` je current read — když někdo jiný
  // mezitím sourozence smaže, počty se rozejdou. Vada to ale NENÍ: zachycení
  // „před" ten řádek taky nenašlo, takže revizi není z čeho postavit. Dokud se
  // to nerozlišovalo, spadla na tom CELÁ editace (ve vývoji 500 a změna se
  // neuložila; na produkci dostala celá skupina `partial`, tedy podle schématu
  // nevratitelnost celého kroku).
  const a = await seedBlock("XL_105");
  const b = await seedBlock("XL_106");
  await prisma.block.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { orderNumber: "REV-SOUBEH-UPD" } });

  const { groupId } = await withRevision(
    { action: "BATCH", label: "Dávka se souběžným smazáním", user: USER },
    async (rtx) => {
      // Založí read view transakce (REPEATABLE READ) — od téhle chvíle vidí dva řádky.
      await rtx.block.findMany({ where: { orderNumber: "REV-SOUBEH-UPD" }, select: { id: true } });
      // Cizí spojení jeden z nich smaže a commitne.
      await other.block.delete({ where: { id: b.id } });
      // Náš zápis už trefí jen jeden, ale `resolveIds` jich ze snapshotu vidí dva.
      return rtx.block.updateMany({ where: { orderNumber: "REV-SOUBEH-UPD" }, data: { machine: "XL_107" } });
    },
  );

  const revs = await prisma.blockRevision.findMany({ where: { groupId } });
  assert.equal(revs.length, 1, "revizi dostane přeživší řádek");
  assert.equal(revs[0].blockId, a.id);
  assert.equal(revs[0].partial, false, "souběžné smazání není neúplné zachycení");

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.deleteMany({ where: { orderNumber: "REV-SOUBEH-UPD" } });
});

test("řádek, který do `where` mezi snímkem a zápisem PŘIBYL, je fantom (updateMany)", async () => {
  // Opačný směr než test výš a jediný, který se hlásit MUSÍ: zápis trefil řádek,
  // o kterém zachycení nevědělo — ten se změnil bez revize.
  const a = await seedBlock("XL_105");
  await prisma.block.update({ where: { id: a.id }, data: { orderNumber: "REV-FANTOM" } });

  await assert.rejects(
    withRevision({ action: "BATCH", label: "Dávka s fantomem", user: USER }, async (rtx) => {
      await rtx.block.findMany({ where: { orderNumber: "REV-FANTOM" }, select: { id: true } });
      await seedBlockFromOutside("REV-FANTOM");
      return rtx.block.updateMany({ where: { orderNumber: "REV-FANTOM" }, data: { machine: "XL_107" } });
    }),
    /zasáhl 2 řádků, ale zachytilo se 1/,
  );

  await prisma.block.deleteMany({ where: { orderNumber: "REV-FANTOM" } });
});

test("v produkci se fantom nehází, ale zapíše se partial", async () => {
  const a = await seedBlock("XL_105");
  await prisma.block.update({ where: { id: a.id }, data: { orderNumber: "REV-FANTOM-PROD" } });

  const orig = process.env.NODE_ENV;
  let groupId: string;
  try {
    // Spadnout uživateli uprostřed plánování je horší než neúplná revize.
    setNodeEnv("production");
    ({ groupId } = await withRevision(
      { action: "BATCH", label: "Dávka s fantomem", user: USER },
      async (rtx) => {
        await rtx.block.findMany({ where: { orderNumber: "REV-FANTOM-PROD" }, select: { id: true } });
        await seedBlockFromOutside("REV-FANTOM-PROD");
        return rtx.block.updateMany({ where: { orderNumber: "REV-FANTOM-PROD" }, data: { machine: "XL_107" } });
      },
    ));
  } finally {
    setNodeEnv(orig);
  }

  const revs = await prisma.blockRevision.findMany({ where: { groupId } });
  assert.equal(revs.length, 1, "zachycený řádek dostane revizi, fantom ne");
  assert.equal(revs[0].blockId, a.id);
  assert.equal(revs[0].partial, true, "příznak neúplného zachycení");

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.deleteMany({ where: { orderNumber: "REV-FANTOM-PROD" } });
});

test("zamykající čtení: cizí změna jiného sloupce se nepřipíše naší transakci", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "REFLOW", label: "Přepočet stroje", user: USER },
    async (rtx) => {
      // Read view vzniká tady; cizí commit přijde až po něm.
      await rtx.block.findMany({ where: { id: block.id }, select: { id: true } });
      await other.block.update({ where: { id: block.id }, data: { printMinutes: 600 } });
      return rtx.block.update({ where: { id: block.id }, data: { machine: "XL_106" } });
    },
  );

  const rev = await prisma.blockRevision.findFirstOrThrow({ where: { groupId } });
  assert.deepEqual(
    Object.keys(rev.after as Record<string, unknown>),
    ["machine"],
    "printMinutes změnil někdo jiný — do našeho rozdílu nepatří",
  );

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.delete({ where: { id: block.id } });
});

// ---------------------------------------------------------------------------
// Obcházení revize
// ---------------------------------------------------------------------------

test("vnořený relační zápis přes rtx.block.update je odmítnutý", async () => {
  const parent = await seedBlock();
  const child = await prisma.block.create({
    data: {
      orderNumber: "REV-CHILD", machine: "XL_106",
      startTime: new Date("2027-01-05T06:00:00.000Z"),
      endTime: new Date("2027-01-05T14:00:00.000Z"),
      type: "ZAKAZKA", printMinutes: 480, recurrenceParentId: parent.id,
    },
  });

  await assert.rejects(
    withRevision({ action: "UPDATE", label: "Vnořený zápis", user: USER }, async (rtx) =>
      rtx.block.update({
        where: { id: child.id },
        data: {
          description: "x",
          // Typově validní a mění RODIČE — capture čte jen `where`, takže by
          // se rodičovský blok změnil bez jediného řádku historie.
          Block_Block_recurrenceParentIdToBlock: { update: { description: "RODIC-ZMENEN" } },
        },
      }),
    ),
    /vnořený zápis přes relaci "Block_Block_recurrenceParentIdToBlock"/,
  );

  const freshParent = await prisma.block.findUniqueOrThrow({ where: { id: parent.id } });
  assert.notEqual(freshParent.description, "RODIC-ZMENEN", "rodič se nesmí změnit");

  await prisma.block.deleteMany({ where: { id: { in: [child.id, parent.id] } } });
});

test("vnořený zápis do bloků přes cizí model (splitGroup) je odmítnutý", async () => {
  const a = await seedBlock();
  const group = await seedSplitGroup();
  await prisma.block.update({ where: { id: a.id }, data: { splitGroupId: group.id } });

  await assert.rejects(
    withRevision({ action: "UPDATE", label: "Vnořený přes splitGroup", user: USER }, async (rtx) =>
      rtx.splitGroup.update({
        where: { id: group.id },
        data: { blocks: { updateMany: { where: {}, data: { machine: "XL_107" } } } },
      }),
    ),
    /vnořený zápis přes relaci "blocks"/,
  );

  const fresh = await prisma.block.findUniqueOrThrow({ where: { id: a.id } });
  assert.equal(fresh.machine, "XL_105");

  await prisma.block.delete({ where: { id: a.id } });
});

test("raw zápis a PascalCase alias delegátu jsou odmítnuté", async () => {
  const block = await seedBlock();

  await assert.rejects(
    withRevision({ action: "UPDATE", label: "Raw zápis", user: USER }, async (rtx) =>
      (rtx as unknown as { $executeRawUnsafe: (q: string) => Promise<number> })
        .$executeRawUnsafe(`UPDATE Block SET machine = 'XL_107' WHERE id = ${block.id}`),
    ),
    /rtx\.\$executeRawUnsafe není uvnitř withRevision povolené/,
  );

  // Prisma registruje každý model dvakrát (block i Block); PascalCase alias
  // vracel syrový delegát, tedy zápis bez revize.
  await assert.rejects(
    withRevision({ action: "UPDATE", label: "PascalCase alias", user: USER }, async (rtx) =>
      (rtx as unknown as { Block: { update: (a: unknown) => Promise<unknown> } })
        .Block.update({ where: { id: block.id }, data: { machine: "XL_107" } }),
    ),
    /rtx\.Block není uvnitř withRevision povolené/,
  );

  const fresh = await prisma.block.findUniqueOrThrow({ where: { id: block.id } });
  assert.equal(fresh.machine, "XL_105", "ani jedna cesta nesmí blok změnit");

  await prisma.block.delete({ where: { id: block.id } });
});

test("withRevision nejde vnořit", async () => {
  await assert.rejects(
    withRevision({ action: "UPDATE", label: "Vnější", user: USER }, async () =>
      withRevision({ action: "UPDATE", label: "Vnitřní", user: USER }, async () => undefined),
    ),
    /withRevision nelze vnořit/,
  );
});

test("zápis bez vráceného id je odmítnutý, ne tiše bez revize", async () => {
  await assert.rejects(
    withRevision({ action: "CREATE", label: "create se selectem", user: USER }, async (rtx) =>
      rtx.block.create({
        data: {
          orderNumber: "REV-NOID", machine: "XL_105",
          startTime: new Date("2027-01-06T06:00:00.000Z"),
          endTime: new Date("2027-01-06T14:00:00.000Z"),
          type: "ZAKAZKA", printMinutes: 480,
        },
        // Bez `id` by revizi nebylo k čemu připnout a blok by vznikl bez historie.
        select: { machine: true },
      }),
    ),
    /musí vracet id/,
  );
  assert.equal(await prisma.block.count({ where: { orderNumber: "REV-NOID" } }), 0, "transakce se odrolovala");
});

// ---------------------------------------------------------------------------
// kind nesmí lhát
// ---------------------------------------------------------------------------

test("spolknutá chyba mazání nevyrobí revizi o smazání", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "DELETE", label: "Mazání, které selže", user: USER },
    async (rtx) => {
      try {
        // Rozšířený `where` nesedí → P2025. Blok přitom dál žije.
        await rtx.block.delete({ where: { id: block.id, machine: "NEEXISTUJICI" } as { id: number } });
      } catch {
        /* tělo chybu spolkne — vzorec „smaž, pokud tam ještě je" */
      }
      return null;
    },
  );

  assert.equal(await prisma.blockRevision.count({ where: { groupId } }), 0, "žádná revize o smazání");
  const fresh = await prisma.block.findUnique({ where: { id: block.id } });
  assert.ok(fresh, "blok v DB dál existuje");

  await prisma.block.delete({ where: { id: block.id } });
});

test("blok, který v jedné transakci vznikne a hned se smaže, revizi nemá", async () => {
  const { groupId } = await withRevision(
    { action: "SPLIT", label: "Vznik a zánik", user: USER },
    async (rtx) => {
      const b = await rtx.block.create({
        data: {
          orderNumber: "REV-TRANSIENT", machine: "XL_105",
          startTime: new Date("2027-01-07T06:00:00.000Z"),
          endTime: new Date("2027-01-07T14:00:00.000Z"),
          type: "ZAKAZKA", printMinutes: 480,
        },
      });
      await rtx.block.delete({ where: { id: b.id } });
      return b.id;
    },
  );
  // V databázi po něm nic nezůstalo, není co zaznamenávat.
  assert.equal(await prisma.blockRevision.count({ where: { groupId } }), 0);
});

test("create + update téhož bloku dá kind CREATE s celým řádkem a novou hodnotou", async () => {
  const { result, groupId } = await withRevision(
    { action: "CREATE", label: "Vznik a posun", user: USER },
    async (rtx) => {
      const b = await rtx.block.create({
        data: {
          orderNumber: "REV-CREUPD", machine: "XL_105",
          startTime: new Date("2027-01-08T06:00:00.000Z"),
          endTime: new Date("2027-01-08T14:00:00.000Z"),
          type: "ZAKAZKA", printMinutes: 480,
        },
      });
      await rtx.block.update({ where: { id: b.id }, data: { machine: "XL_106" } });
      return b;
    },
  );

  const rev = await prisma.blockRevision.findFirstOrThrow({ where: { groupId } });
  assert.equal(rev.kind, "CREATE", "nově vzniklý blok zůstává CREATE i po posunu");
  assert.equal(rev.before, null);
  const after = rev.after as Record<string, unknown>;
  assert.equal(after.machine, "XL_106", "konečný stav, ne mezistav");
  assert.ok(Object.keys(after).length > 40, "u CREATE se ukládá celý řádek, ne jen rozdíl");

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.delete({ where: { id: result.id } });
});

test("dva zápisy téhož bloku: rozdíl nese obě změny a PŮVODNÍ hodnoty", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "UPDATE", label: "Dvojí zápis", user: USER },
    async (rtx) => {
      await rtx.block.update({ where: { id: block.id }, data: { machine: "XL_106" } });
      await rtx.block.update({ where: { id: block.id }, data: { printMinutes: 600 } });
    },
  );

  const rev = await prisma.blockRevision.findFirstOrThrow({ where: { groupId } });
  const before = rev.before as Record<string, unknown>;
  const after = rev.after as Record<string, unknown>;
  assert.deepEqual(Object.keys(after).sort(), ["machine", "printMinutes"], "obě změny, ne jen ta druhá");
  assert.equal(before.machine, "XL_105", "stav před CELOU transakcí, ne mezistav");
  assert.equal(before.printMinutes, 480);
  assert.equal(after.machine, "XL_106");
  assert.equal(after.printMinutes, 600);

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.delete({ where: { id: block.id } });
});

// ---------------------------------------------------------------------------
// Obsah zapsaného řádku
// ---------------------------------------------------------------------------

test("JSON drží typy z Prismy, ne syrové z MySQL, a u CREATE celý řádek", async () => {
  const { result, groupId } = await withRevision(
    { action: "CREATE", label: "Typy v JSONu", user: USER },
    async (rtx) => rtx.block.create({
      data: {
        orderNumber: "REV-TYPY", machine: "XL_105",
        startTime: new Date("2027-01-09T06:00:00.000Z"),
        endTime: new Date("2027-01-09T14:00:00.000Z"),
        type: "ZAKAZKA", printMinutes: 480,
      },
    }),
  );

  const rev = await prisma.blockRevision.findFirstOrThrow({ where: { groupId } });
  const after = rev.after as Record<string, unknown>;
  // MySQL vrací BOOLEAN jako 0/1; bez normalizace by tu byla nula a etapa B2
  // by ji nacpala do Boolean sloupce.
  assert.equal(after.locked, false, "boolean, ne 0");
  assert.equal(after.dataOk, false);
  assert.equal(after.scheduleBypassed, false);
  assert.ok(after.startTime, "datum je součástí snímku");
  assert.equal(after.deadlineExpedice, null, "nevyplněné zůstává null, ne false");

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.delete({ where: { id: result.id } });
});

test("u DELETE nese before kompletní řádek, ne jen identitu", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "DELETE", label: "Smazání bloku", user: USER },
    async (rtx) => rtx.block.delete({ where: { id: block.id } }),
  );

  const rev = await prisma.blockRevision.findFirstOrThrow({ where: { groupId } });
  const before = rev.before as Record<string, unknown>;
  for (const col of ["startTime", "endTime", "printMinutes", "locked", "updatedAt", "type"]) {
    assert.ok(col in before, `u smazaného bloku chybí ${col} — nebylo by z čeho ho vzkřísit`);
  }
  assert.equal(rev.rowVersion, null, "u DELETE je verze jedině v before.updatedAt");

  await prisma.blockRevision.deleteMany({ where: { groupId } });
});

test("rowVersion je SKUTEČNÝ updatedAt bloku, ne jiné datum", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "UPDATE", label: "Verze řádku", user: USER },
    async (rtx) => rtx.block.update({ where: { id: block.id }, data: { machine: "XL_106" } }),
  );

  const rev = await prisma.blockRevision.findFirstOrThrow({ where: { groupId } });
  const fresh = await prisma.block.findUniqueOrThrow({ where: { id: block.id } });
  assert.equal(rev.rowVersion?.getTime(), fresh.updatedAt.getTime(), "na milisekundu");
  assert.notEqual(rev.rowVersion?.getTime(), fresh.createdAt.getTime());

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.delete({ where: { id: block.id } });
});

test("kdo a čím změnu udělal se zapisuje z meta, ne z konstanty", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "PRINT_COMPLETE", label: "Potvrzení tisku", user: { id: 42, username: "tiskar-pepa" } },
    async (rtx) => rtx.block.update({ where: { id: block.id }, data: { machine: "XL_106" } }),
  );

  const rev = await prisma.blockRevision.findFirstOrThrow({ where: { groupId } });
  assert.equal(rev.action, "PRINT_COMPLETE");
  assert.equal(rev.label, "Potvrzení tisku");
  assert.equal(rev.userId, 42);
  assert.equal(rev.username, "tiskar-pepa");

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.delete({ where: { id: block.id } });
});

test("příliš dlouhý label mutaci neshodí, jen se ořízne", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "UPDATE", label: "L".repeat(400), user: USER },
    async (rtx) => rtx.block.update({ where: { id: block.id }, data: { machine: "XL_106" } }),
  );
  const rev = await prisma.blockRevision.findFirstOrThrow({ where: { groupId } });
  assert.equal(rev.label.length, 191, "sloupec je VARCHAR(191)");

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.delete({ where: { id: block.id } });
});

// ---------------------------------------------------------------------------
// Auditní delegát a allow-list
// ---------------------------------------------------------------------------

test("groupId dostanou auditní řádky z create, z createMany i z jediného objektu", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "UPDATE", label: "Editace", user: USER },
    async (rtx) => {
      await rtx.block.update({ where: { id: block.id }, data: { machine: "XL_106" } });
      await rtx.auditLog.create({
        data: { blockId: block.id, userId: USER.id, username: USER.username, action: "UPDATE", field: "machine" },
      });
      // Dominantní cesta počtem řádků: jedno uložení z BlockEditu jich vyrobí přes deset.
      await rtx.auditLog.createMany({
        data: [
          { blockId: block.id, userId: USER.id, username: USER.username, action: "UPDATE", field: "deadlineExpedice" },
          { blockId: block.id, userId: USER.id, username: USER.username, action: "UPDATE", field: "printMinutes" },
        ],
      });
      // Typově legální varianta s jediným objektem — dřív padala na TypeError.
      await rtx.auditLog.createMany({
        data: { blockId: block.id, userId: USER.id, username: USER.username, action: "UPDATE", field: "locked" },
      } as unknown as { data: [] });
    },
  );

  const logs = await prisma.auditLog.findMany({ where: { groupId } });
  assert.equal(logs.length, 4, "všechny čtyři řádky mají groupId");
  assert.deepEqual(
    logs.map((l) => l.field).sort(),
    ["deadlineExpedice", "locked", "machine", "printMinutes"],
  );
  assert.equal(
    await prisma.auditLog.count({ where: { blockId: block.id, groupId: null } }),
    0,
    "žádný auditní řádek transakce nesmí zůstat bez groupId",
  );

  await prisma.auditLog.deleteMany({ where: { groupId } });
  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.delete({ where: { id: block.id } });
});

test("všech devět povolených čtecích metod projde", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "UPDATE", label: "Jen čtení", user: USER },
    async (rtx) => {
      // findFirst je v seznamu kvůli overlapCheck.ts — povinné pojistce na
      // všech zápisových cestách. Osekaný allow-list by shodil první uložení
      // bloku na produkci, přestože testy i build by byly zelené.
      await rtx.block.findUnique({ where: { id: block.id } });
      await rtx.block.findUniqueOrThrow({ where: { id: block.id } });
      await rtx.block.findFirst({ where: { id: block.id } });
      await rtx.block.findFirstOrThrow({ where: { id: block.id } });
      await rtx.block.findMany({ where: { id: block.id } });
      await rtx.block.count({ where: { id: block.id } });
      await rtx.block.aggregate({ where: { id: block.id }, _count: { _all: true } });
      await rtx.block.groupBy({ by: ["machine"], where: { id: block.id }, _count: { _all: true } });
      return rtx.block.fields.id;
    },
  );
  assert.equal(await prisma.blockRevision.count({ where: { groupId } }), 0, "čtení nevyrobí revizi");

  await prisma.block.delete({ where: { id: block.id } });
});

test("souběžné smazání sourozence hromadné mazání NESHODÍ (deleteMany)", async () => {
  const a = await seedBlock("XL_105");
  const b = await seedBlock("XL_106");
  await prisma.block.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { orderNumber: "REV-SOUBEH-DEL" } });

  const { groupId } = await withRevision(
    { action: "BATCH", label: "Mazání se souběžným smazáním", user: USER },
    async (rtx) => {
      await rtx.block.findMany({ where: { orderNumber: "REV-SOUBEH-DEL" }, select: { id: true } });
      await other.block.delete({ where: { id: b.id } });
      return rtx.block.deleteMany({ where: { orderNumber: "REV-SOUBEH-DEL" } });
    },
  );

  const revs = await prisma.blockRevision.findMany({ where: { groupId } });
  assert.equal(revs.length, 1, "revizi o smazání dostane jen řádek, který smazala TAHLE transakce");
  assert.equal(revs[0].blockId, a.id);
  assert.equal(revs[0].kind, "DELETE");
  assert.equal(revs[0].partial, false);

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.deleteMany({ where: { orderNumber: "REV-SOUBEH-DEL" } });
});

test("řádek, který do `where` mezi snímkem a zápisem PŘIBYL, je fantom (deleteMany)", async () => {
  const a = await seedBlock("XL_105");
  await prisma.block.update({ where: { id: a.id }, data: { orderNumber: "REV-FANTOM-DEL" } });

  await assert.rejects(
    withRevision({ action: "BATCH", label: "Mazání s fantomem", user: USER }, async (rtx) => {
      await rtx.block.findMany({ where: { orderNumber: "REV-FANTOM-DEL" }, select: { id: true } });
      await seedBlockFromOutside("REV-FANTOM-DEL");
      return rtx.block.deleteMany({ where: { orderNumber: "REV-FANTOM-DEL" } });
    }),
    /zasáhl 2 řádků, ale zachytilo se 1/,
  );

  await prisma.block.deleteMany({ where: { orderNumber: "REV-FANTOM-DEL" } });
});

test("zamykající čtení v epilogu: stav PO se nečte ze zastaralého snapshotu", async () => {
  // Řádek, který transakce označí, ale sama do něj NEZAPÍŠE (cizí commit ho
  // vystrnadil z `where`). Bez FOR UPDATE v epilogu vyjde „před" z current readu
  // a „po" ze snapshotu, takže revize popíše změnu OBRÁCENÝM směrem — záznam
  // o změně, která se nikdy nestala, připsaný uživateli, který na řádek nesáhl.
  const a = await seedBlock("XL_105");
  const b = await seedBlock("XL_105");
  await prisma.block.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { orderNumber: "REV-EPILOG" } });

  const orig = process.env.NODE_ENV;
  let groupId: string;
  try {
    setNodeEnv("production");
    ({ groupId } = await withRevision(
      { action: "BATCH", label: "Dávka", user: USER },
      async (rtx) => {
        await rtx.block.findMany({ where: { orderNumber: "REV-EPILOG" }, select: { id: true } });
        // Cizí spojení změní popis a vystrnadí řádek z našeho `where`.
        await other.block.update({
          where: { id: b.id },
          data: { orderNumber: "REV-EPILOG-PRYC", description: "CIZI-ZMENA" },
        });
        return rtx.block.updateMany({ where: { orderNumber: "REV-EPILOG" }, data: { machine: "XL_106" } });
      },
    ));
  } finally {
    setNodeEnv(orig);
  }

  const bRev = await prisma.blockRevision.findFirst({ where: { groupId, blockId: b.id } });
  if (bRev) {
    const after = bRev.after as Record<string, unknown> | null;
    assert.notEqual(
      after?.description, null,
      "revize tvrdí, že popis zmizel — to je obrácený směr cizí změny",
    );
    assert.notEqual(
      (bRev.before as Record<string, unknown> | null)?.description, "CIZI-ZMENA",
      "cizí změna se nesmí zapsat jako NÁŠ výchozí stav",
    );
  }

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.deleteMany({ where: { orderNumber: { startsWith: "REV-EPILOG" } } });
});

test("když zachycení mine všechny řádky, zůstane aspoň forenzní marker", async () => {
  // Zachycení nemá CO chytit — snapshot žádný takový řádek nevidí — ale zápis
  // trefí řádek, který mezitím commitnul někdo jiný. Bez markeru by po takové
  // dávce nezbyla v BlockRevision ani stopa, jen řádek v logu.
  const orig = process.env.NODE_ENV;
  let groupId: string;
  try {
    setNodeEnv("production");
    ({ groupId } = await withRevision(
      { action: "BATCH", label: "Vše fantom", user: USER },
      async (rtx) => {
        await rtx.block.findMany({ where: { orderNumber: "REV-MARKER" }, select: { id: true } });
        await seedBlockFromOutside("REV-MARKER");
        return rtx.block.updateMany({ where: { orderNumber: "REV-MARKER" }, data: { machine: "XL_107" } });
      },
    ));
  } finally {
    setNodeEnv(orig);
  }

  const revs = await prisma.blockRevision.findMany({ where: { groupId } });
  assert.equal(revs.length, 1, "bez markeru by po fantomové dávce nezbyla ani stopa");
  assert.equal(revs[0].blockId, 0, "marker nemá konkrétní blok");
  assert.equal(revs[0].partial, true);

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.deleteMany({ where: { orderNumber: "REV-MARKER" } });
});

test("zápisová metoda auditního delegátu mimo create/createMany je odmítnutá", async () => {
  const block = await seedBlock();
  await assert.rejects(
    withRevision({ action: "UPDATE", label: "Audit upsertem", user: USER }, async (rtx) =>
      // Fail-open by tu znamenal auditní řádek bez groupId, tedy rozpad
      // korelace revize ↔ audit v panelu historie.
      (rtx.auditLog as unknown as { upsert: (a: unknown) => Promise<unknown> }).upsert({
        where: { id: 1 },
        create: { blockId: block.id, userId: USER.id, username: USER.username, action: "UPDATE" },
        update: {},
      }),
    ),
    /auditLog\.upsert není uvnitř withRevision podporované/,
  );
  await prisma.block.delete({ where: { id: block.id } });
});

test("blok, který vypadl z `where` mezi snímkem a zápisem, nedostane kind DELETE", async () => {
  // `markKind` u deleteMany označí DELETE všechna id z `where`, ne jen skutečně
  // zasažená. Když cizí commit blok jen PŘEJMENUJE, blok v DB dál žije — a bez
  // korekce v epilogu by dostal revizi o svém smazání. Etapa B2 by z ní
  // sestavila příkaz, který ten živý, naplánovaný blok skutečně smaže.
  const a = await seedBlock();
  const b = await seedBlock();
  await prisma.block.updateMany({
    where: { id: { in: [a.id, b.id] } },
    data: { orderNumber: "REV-ESCAPE" },
  });

  const orig = process.env.NODE_ENV;
  let groupId: string;
  try {
    setNodeEnv("production");
    ({ groupId } = await withRevision(
      { action: "BATCH", label: "Hromadné mazání", user: USER },
      async (rtx) => {
        await rtx.block.findMany({ where: { orderNumber: "REV-ESCAPE" }, select: { id: true } });
        // Cizí spojení blok B jen přejmenuje — nemaže ho, jen ho vystrnadí z `where`.
        await other.block.update({ where: { id: b.id }, data: { orderNumber: "REV-ESCAPE-PRYC" } });
        return rtx.block.deleteMany({ where: { orderNumber: "REV-ESCAPE" } });
      },
    ));
  } finally {
    setNodeEnv(orig);
  }

  const bZije = await prisma.block.findUnique({ where: { id: b.id } });
  assert.ok(bZije, "blok B smazaný nebyl, jen vypadl z podmínky");

  const revB = await prisma.blockRevision.findFirst({ where: { groupId, blockId: b.id } });
  assert.notEqual(revB?.kind, "DELETE", "živý blok nesmí mít revizi o smazání");

  // Blok A smazaný BYL — ten DELETE dostat má, jinak by korekce shodila i pravdu.
  const revA = await prisma.blockRevision.findFirstOrThrow({ where: { groupId, blockId: a.id } });
  assert.equal(revA.kind, "DELETE");
  assert.equal(await prisma.block.count({ where: { id: a.id } }), 0);

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.deleteMany({ where: { orderNumber: { startsWith: "REV-ESCAPE" } } });
});

test("rtx.$queryRaw funguje — je to metoda klienta, ne delegáta", async () => {
  // Regrese ze zapojení PUT (Task 6): `$queryRaw` byl sice v PASSTHROUGH_TX_PROPS,
  // ale propouštěl se NESVÁZANÝ. Volání `rtx.$queryRaw` proto uvnitř Prismy sáhlo
  // na `this._createPrismaPromise`, `this` byla naše Proxy a allow-list to shodil
  // hláškou „rtx._createPrismaPromise není povolené". Padala na to KAŽDÁ mutace,
  // protože `assertNoOverlapForBlocks` (finální pojistka všech zápisových cest)
  // stojí právě na `tx.$queryRaw`. Jednotkové testy jádra to minuly, protože samy
  // volaly raw dotaz nad syrovým `tx`.
  const block = await seedBlock();
  const { result } = await withRevision(
    { action: "UPDATE", label: "Raw čtení", user: USER },
    async (rtx) => {
      await rtx.block.update({ where: { id: block.id }, data: { machine: "XL_106" } });
      // Přesně tvar z assertNoOverlapForBlocks: tagged template + FOR UPDATE.
      return rtx.$queryRaw<{ id: number; machine: string }[]>`
        SELECT id, machine FROM Block WHERE id = ${block.id} FOR UPDATE
      `;
    },
  );
  assert.equal(result[0]?.machine, "XL_106", "raw čtení vidí zápis téže transakce");

  await prisma.blockRevision.deleteMany({ where: { blockId: block.id } });
  await prisma.block.delete({ where: { id: block.id } });
});

test("PUT propagace sdíleného pole vyrobí revizi kořeni i sourozenci", async () => {
  // Přesně tvar, jakým propaguje PUT /api/blocks/[id]: adresný `update` na
  // editovaný blok + `updateMany` na zbytek skupiny. Sourozenec je ZÁMĚRNĚ na
  // DRUHÉM stroji — tenhle případ v návrhu jednou vyvrátil celý původní
  // mechanismus (revize vázaná na stroj by ho minula) a je jediný, kde se
  // pozná, že se dotčené řádky berou z `where`, ne z anchoru.
  const group = await seedSplitGroup();
  const head = await seedBlock("XL_105");
  const tail = await seedBlock("XL_106");
  await prisma.block.updateMany({
    where: { id: { in: [head.id, tail.id] } },
    data: { splitGroupId: group.id },
  });

  const { groupId } = await withRevision(
    { action: "UPDATE", label: "Editace bloku", user: USER },
    async (rtx) => {
      await rtx.block.update({
        where: { id: head.id },
        data: { specifikace: "REV-SDILENE" },
      });
      await rtx.block.updateMany({
        where: { splitGroupId: group.id, id: { not: head.id } },
        data: { specifikace: "REV-SDILENE" },
      });
    },
  );

  const revs = await prisma.blockRevision.findMany({ where: { groupId }, orderBy: { blockId: "asc" } });
  assert.equal(revs.length, 2, "kořen i sourozenec na druhém stroji");
  const revTail = revs.find((r) => r.blockId === tail.id);
  assert.ok(revTail, "sourozenec z updateMany má vlastní revizi");
  assert.equal(revTail!.machine, "XL_106", "revize nese stroj sourozence, ne editovaného bloku");
  assert.equal((revTail!.after as Record<string, unknown>).specifikace, "REV-SDILENE");

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.deleteMany({ where: { id: { in: [head.id, tail.id] } } });
});

test("rozdělení: kořen dostane UPDATE, nová část CREATE", async () => {
  // Tvar, jakým píše POST /api/blocks/[id]/split: zkrácení hlavy adresným
  // `update` + vznik ocasu `create`. Obojí musí skončit v JEDNÉ groupId,
  // jinak by šlo rozdělení vzít zpět jen po půlkách.
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "SPLIT", label: "Rozdělení bloku", user: USER },
    async (rtx) => {
      await rtx.block.update({
        where: { id: block.id },
        data: { endTime: new Date("2026-12-01T10:00:00.000Z"), printMinutes: 240 },
      });
      return rtx.block.create({
        data: {
          orderNumber: "REV-TEST", machine: "XL_105",
          startTime: new Date("2026-12-01T10:00:00.000Z"),
          endTime: new Date("2026-12-01T14:00:00.000Z"),
          type: "ZAKAZKA", printMinutes: 240,
        },
      });
    },
  );

  const revs = await prisma.blockRevision.findMany({ where: { groupId }, orderBy: { blockId: "asc" } });
  assert.equal(revs.length, 2);
  assert.deepEqual(revs.map((r) => r.kind).sort(), ["CREATE", "UPDATE"]);

  const ids = revs.map((r) => r.blockId);
  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.deleteMany({ where: { id: { in: ids } } });
});

test("rozdělení s chain pushem: odsunutý soused dostane VLASTNÍ revizi v téže groupId", async () => {
  // Jediný test, který pouští PRODUKČNÍ `resolveChainPushFromDb` skrz revizní Proxy.
  // Ta součinnost je nejcitlivější místo celé etapy: chain push si sám čte kalendář
  // (`machineWeekShifts`, `companyDay`) a sám zapisuje do cizích bloků — přesně ta
  // třída interakce, na které v Tasku 6 vybouchl `$queryRaw`. Bez tohohle testu by
  // regrese „odsunuté bloky zmizí z historie" prošla celou suitou zeleně.
  //
  // Soused ZÁMĚRNĚ překrývá budoucí ocas. Endpoint takový stav sám nevyrobí (brání
  // tomu overlap guard), ale chain push nemá co posouvat, dokud překryv neexistuje —
  // a v produkční DB takový stav vzniká z legacy dat a bypass bloků.
  const group = await seedSplitGroup();
  const hlava = await prisma.block.create({
    data: {
      orderNumber: "REV-CHAIN", machine: "XL_105",
      startTime: new Date("2027-01-12T06:00:00.000Z"),
      endTime: new Date("2027-01-12T14:00:00.000Z"),
      type: "ZAKAZKA", printMinutes: 480,
    },
  });
  const soused = await prisma.block.create({
    data: {
      orderNumber: "REV-CHAIN-SOUSED", machine: "XL_105",
      startTime: new Date("2027-01-12T12:00:00.000Z"),
      endTime: new Date("2027-01-12T16:00:00.000Z"),
      type: "ZAKAZKA", printMinutes: 240,
    },
  });

  const splitAt = new Date("2027-01-12T10:00:00.000Z");
  const { result: { tail, moves }, groupId } = await withRevision(
    { action: "SPLIT", label: "Rozdělení bloku", user: USER },
    async (rtx) => {
      // Kroky 6, 7 a 9 z POST /api/blocks/[id]/split, ve stejném pořadí.
      await rtx.block.update({
        where: { id: hlava.id },
        data: { endTime: splitAt, printMinutes: 240, splitGroupId: group.id },
      });
      const tail = await rtx.block.create({
        data: {
          orderNumber: "REV-CHAIN", machine: "XL_105",
          startTime: splitAt,
          endTime: new Date("2027-01-12T14:00:00.000Z"),
          type: "ZAKAZKA", printMinutes: 240, splitGroupId: group.id,
        },
      });
      const moves = await resolveChainPushFromDb(rtx, "XL_105", {
        id: tail.id, startTime: tail.startTime, endTime: tail.endTime,
      });
      return { tail, moves };
    },
  );

  assert.equal(moves.length, 1, "chain push musel souseda skutečně posunout, jinak test neměří nic");
  assert.equal(moves[0].id, soused.id);

  const revs = await prisma.blockRevision.findMany({ where: { groupId }, orderBy: { blockId: "asc" } });
  assert.equal(revs.length, 3, "hlava, ocas I odsunutý soused");
  const byId = new Map(revs.map((r) => [r.blockId, r]));
  assert.equal(byId.get(hlava.id)?.kind, "UPDATE");
  assert.equal(byId.get(tail.id)?.kind, "CREATE");
  assert.equal(byId.get(soused.id)?.kind, "UPDATE", "odsunutý soused nesmí z historie vypadnout");
  assert.equal(new Set(revs.map((r) => r.groupId)).size, 1, "celé rozdělení je JEDEN krok historie");

  // `after` musí sedět 1:1 na živý řádek — revize, která tvrdí jiný čas než DB,
  // by v etapě B2 vrátila blok na místo, kde nikdy nebyl.
  const sousedZivy = await prisma.block.findUniqueOrThrow({ where: { id: soused.id } });
  const sousedAfter = byId.get(soused.id)!.after as Record<string, string>;
  assert.deepEqual(
    Object.keys(sousedAfter).sort(), ["endTime", "startTime"],
    "chain push mění jen pozici — nic jiného do rozdílu nepatří",
  );
  assert.equal(new Date(sousedAfter.startTime).getTime(), sousedZivy.startTime.getTime());
  assert.equal(new Date(sousedAfter.endTime).getTime(), sousedZivy.endTime.getTime());
  assert.notEqual(sousedZivy.startTime.getTime(), soused.startTime.getTime(), "soused se opravdu hnul");

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.deleteMany({ where: { id: { in: [hlava.id, tail.id, soused.id] } } });
});
