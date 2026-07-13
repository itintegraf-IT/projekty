-- CreateTable: identita split skupiny je samostatná entita (přežije smazání člena).
-- Charset explicitně dle konvence všech migrací projektu (utf8mb4_unicode_ci).
CREATE TABLE `SplitGroup` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill: jeden řádek na existující skupinu, id = staré root PK.
-- Tím zůstávají VŠECHNY Block.splitGroupId hodnoty platnými referencemi
-- → žádný Block řádek se nemění, existující skupiny zůstávají beze změny.
INSERT INTO `SplitGroup` (`id`, `createdAt`)
SELECT DISTINCT `splitGroupId`, NOW(3)
FROM `Block`
WHERE `splitGroupId` IS NOT NULL;

-- Přebodovat FK: self (Block.id) → SplitGroup.id (stabilní tabulka).
-- POZOR: DDL v MySQL je auto-commit → tyto tři statementy NEJSOU jedna transakce.
-- Bezpečnost proti half-applied stavu zajišťuje deploy postup (app-stop +
-- orphan pre-check SELECT=0 + UNSIGNED gate PŘED migrací), ne atomicita migrace.
ALTER TABLE `Block` DROP FOREIGN KEY `Block_splitGroupId_fkey`;
-- Sjednotit signedness `splitGroupId` s `SplitGroup`.`id` (INT UNSIGNED), aby FK sedělo.
-- Prod: `splitGroupId` je už `int unsigned` → no-op (instant metadata op, 0 změn hodnot/dat).
-- Dev (drift z původní migrace, kde skončil jako signed `int`): konvertuje signed→unsigned;
-- hodnoty jsou kladné root PK → beze změny hodnot (fingerprint identický).
ALTER TABLE `Block` MODIFY `splitGroupId` INTEGER UNSIGNED NULL;
ALTER TABLE `Block` ADD CONSTRAINT `Block_splitGroupId_fkey` FOREIGN KEY (`splitGroupId`) REFERENCES `SplitGroup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
