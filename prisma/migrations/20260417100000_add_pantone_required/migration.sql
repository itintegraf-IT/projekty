-- AlterTable
ALTER TABLE `Block` ADD COLUMN `pantoneRequired` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `JobPreset` ADD COLUMN `pantoneRequired` BOOLEAN NULL;
