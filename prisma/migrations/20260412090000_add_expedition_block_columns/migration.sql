-- AlterTable Block: přidání expedičních sloupců které byly přidány do dev DB přímo bez migrace
ALTER TABLE `Block`
    ADD COLUMN `doprava` VARCHAR(191) NULL,
    ADD COLUMN `expediceNote` VARCHAR(191) NULL;

-- CreateTable ExpeditionZavoz (chyběla v předchozí migraci)
CREATE TABLE `ExpeditionZavoz` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL,
    `orderNumber` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `expediceNote` VARCHAR(191) NULL,
    `doprava` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ExpeditionZavoz_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
