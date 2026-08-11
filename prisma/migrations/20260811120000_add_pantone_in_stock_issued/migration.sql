-- AlterTable
ALTER TABLE `Block` ADD COLUMN `pantoneInStock` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Block` ADD COLUMN `pantoneIssued` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `JobPreset` ADD COLUMN `pantoneInStock` BOOLEAN NULL;
