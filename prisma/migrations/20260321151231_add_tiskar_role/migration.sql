-- AlterTable
ALTER TABLE `Block` ADD COLUMN `printCompletedAt` DATETIME(3) NULL,
    ADD COLUMN `printCompletedByUserId` INTEGER NULL,
    ADD COLUMN `printCompletedByUsername` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `assignedMachine` VARCHAR(191) NULL;
