import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { withRevision } from "./revision.server";

const USER = { id: 1, username: "test" };

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
  await prisma.block.deleteMany({ where: { orderNumber: { startsWith: "REV-" } } });
  if (createdSplitGroupIds.length > 0) {
    await prisma.splitGroup.deleteMany({ where: { id: { in: createdSplitGroupIds } } });
  }
  await prisma.$disconnect();
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
    /createMany/,
  );
});
