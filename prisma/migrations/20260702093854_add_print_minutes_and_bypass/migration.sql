-- AlterTable
ALTER TABLE `Block` ADD COLUMN `printMinutes` INTEGER NULL,
    ADD COLUMN `scheduleBypassed` BOOLEAN NOT NULL DEFAULT false;

-- Backfill: dnešní invariant end-start = tiskový čas (platí i pro bypass bloky ve smyslu záměru plánovače)
UPDATE `Block` SET `printMinutes` = TIMESTAMPDIFF(MINUTE, `startTime`, `endTime`) WHERE `type` = 'ZAKAZKA';
