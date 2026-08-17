-- AlterTable
-- Incident 14. 8. 2026: undo editace na produkci padalo na
-- `prisma.auditLog.createMany()` — "The provided value for the column is too
-- long for the column's type. Column: field". Prisma schéma (String bez
-- @db.VarChar) předepisuje VARCHAR(191) u všech tří sloupců níž, ale produkční
-- DB je měla ručně založené jako varchar(64) — ověřeno přes information_schema
-- 17. 8. 2026. `applyUndoOps` (src/lib/undoApply.server.ts) ořezává smíšený
-- audit řádek na AUDIT_MIXED_FIELD_MAX_BYTES = 180 bajtů právě proto, že počítá
-- se schématovými 191 — proti varchar(64) to nemělo žádný účinek.
--
-- Charset/collation MUSÍ být uvedená explicitně: `MODIFY` bez ní by použila
-- výchozí znakovou sadu CELÉ TABULKY, ne dosavadní sadu sloupce, což by mohlo
-- znamenat tichou konverzi. Hodnota `utf8mb4_unicode_ci` je ověřená na dev DB
-- (IGvyroba, 17. 8. 2026) dotazem nad information_schema.COLUMNS.
--
-- PRODUKČNÍ collation musí být ověřena PŘED nasazením stejným dotazem — na
-- produkční DB nemá tento agent přístup, ověření provede člověk (viz
-- docs/DEPLOY_WORKFLOW.md).
--
-- Na DEV DB je migrace no-op (tam už varchar(191) mají) — to je záměr, migrace
-- musí být idempotentní vůči prostředí, kde k odchylce nikdy nedošlo.
--
-- Na TESTOVACÍ instanci NE — ta stojí nad kopií produkce, takže tam mají tyhle
-- tři sloupce pořád varchar(64) a ALTER reálně poběží. To je dobrá zpráva, ne
-- riziko: nasazení na test je plnohodnotná generálka téhle změny, ne prázdný
-- běh jako na devu.
--
-- ALGORITHM=/LOCK= tahle migrace záměrně NEUVÁDÍ — explicitní hint na MariaDB
-- (viz "Produkce je MariaDB, ne MySQL 8" v CLAUDE.md) umí migraci rovnou shodit
-- místo aby ji jen zpomalil, takže in-place/bezzámkové provedení tu NENÍ
-- zaručené, jen možné. Tabulky jsou malé, ale skutečný čas (a to, jestli
-- proběhne in-place) se má změřit na testovací instanci, ne odhadovat předem.
ALTER TABLE `AuditLog` MODIFY `field` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;

ALTER TABLE `AuditLog` MODIFY `username` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE `Block` MODIFY `orderNumber` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
