/**
 * Založí (nebo přenastaví heslo) účtu pro proklik na TESTOVACÍ instanci.
 *
 *   npx tsx scripts/ops/create-test-user.ts <jmeno> <heslo> <ROLE>
 *
 * ROLE: ADMIN | PLANOVAT | DTP | MTZ | OBCHODNIK | TISKAR | VIEWER
 *
 * POJISTKA: skript odmítne běžet, pokud `DATABASE_URL` neukazuje na databázi,
 * jejíž název končí `_test`. Slabé heslo na produkci je bezpečnostní incident,
 * ne pohodlí — proto to není volitelné a nejde to přepnout přepínačem.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../../src/lib/prisma";

const ROLES = ["ADMIN", "PLANOVAT", "DTP", "MTZ", "OBCHODNIK", "TISKAR", "VIEWER"];
const BCRYPT_COST = 10;

async function main() {
  const [username, password, role] = process.argv.slice(2);
  if (!username || !password || !role) {
    throw new Error("použití: create-test-user.ts <jmeno> <heslo> <ROLE>");
  }
  if (!ROLES.includes(role)) {
    throw new Error(`neznámá role ${role}; povolené: ${ROLES.join(", ")}`);
  }

  const dbName = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `POJISTKA: DATABASE_URL ukazuje na "${dbName}", ne na databázi končící "_test". ` +
      "Tenhle skript je určený VÝHRADNĚ pro testovací instanci.",
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const user = await prisma.user.upsert({
    where: { username },
    create: { username, passwordHash, role },
    update: { passwordHash, role },
  });
  console.log(`OK: účet "${user.username}" role ${user.role} v DB ${dbName}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
