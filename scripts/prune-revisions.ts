/**
 * Denní úklid revizí starších než REVISION_RETENTION_DAYS.
 * Pouští se cronem vedle denní zálohy (viz docs/OPS_ZALOHY.md).
 *
 * Maže po dávkách — jednorázový `deleteMany` nad desetitisíci řádky by držel
 * dlouhý zámek a mohl by zablokovat plánovače uprostřed práce.
 *
 * Maže po CELÝCH `groupId`, ne po jednotlivých řádcích: půlka dávky v tabulce
 * je horší než žádná. Kdyby se skupina rozpůlila, rekonstrukce by tvrdila,
 * že se v jednom kroku změnila jen část bloků — a to je nepravda, kterou
 * vyšetřovatel nemá jak poznat.
 *
 * BEZPEČNOST: skript maže VÝHRADNĚ z `BlockRevision`. Na `Block`, `AuditLog`
 * ani na nic jiného nesahá.
 */
import { prisma } from "../src/lib/prisma";
// Retence je sdílená s reportem — dashboard podle ní pozná, odkdy smí tvrdit,
// že o období něco ví. Vlastní kopie čísla by ty dva rozešla (viz retention.ts).
import { REVISION_RETENTION_DAYS } from "../src/lib/revision/retention";

/** Kolik skupin se smaže v jedné dávce. */
const BATCH = 1000;

/** Skupiny, jejichž NEJNOVĚJŠÍ řádek je za hranicí retence. */
async function staleGroups(cutoff: Date): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ groupId: string }[]>`
    SELECT groupId FROM BlockRevision
    GROUP BY groupId
    HAVING MAX(createdAt) < ${cutoff}
    LIMIT ${BATCH}
  `;
  return rows.map((r) => r.groupId);
}

async function main() {
  const cutoff = new Date(Date.now() - REVISION_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  let total = 0;
  let dávky = 0;
  for (let ids = await staleGroups(cutoff); ids.length > 0; ids = await staleGroups(cutoff)) {
    const res = await prisma.blockRevision.deleteMany({ where: { groupId: { in: ids } } });
    total += res.count;
    dávky += 1;
    // Pojistka proti nekonečné smyčce: když dotaz vrátí skupiny, ale smazání
    // nic nesmaže, další kolo by vrátilo totéž. Radši spadnout, než točit.
    if (res.count === 0) {
      throw new Error(
        `[prune-revisions] dotaz vrátil ${ids.length} skupin k smazání, ale deleteMany smazal 0 řádků — přerušuji, ať se to nezacyklí.`,
      );
    }
  }

  const [size] = await prisma.$queryRaw<{ mb: number | null }[]>`
    SELECT ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 1) AS mb
    FROM information_schema.TABLES
    WHERE TABLE_NAME = 'BlockRevision' AND TABLE_SCHEMA = DATABASE()
  `;
  const zbyva = await prisma.blockRevision.count();

  console.log(
    `[prune-revisions] retence ${REVISION_RETENTION_DAYS} dní, hranice ${cutoff.toISOString()}: ` +
      `smazáno ${total} řádků ve ${dávky} dávkách, v tabulce zbývá ${zbyva} řádků, velikost ${size?.mb ?? "?"} MB`,
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[prune-revisions] selhalo:", err);
  await prisma.$disconnect();
  process.exit(1);
});
