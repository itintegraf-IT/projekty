-- AlterTable
-- Note: expediceNote and doprava were already added directly to the DB before this migration was formalized.
ALTER TABLE `Block`
    ADD COLUMN `expeditionPublishedAt` DATETIME(3) NULL,
    ADD COLUMN `expeditionSortOrder` INTEGER NULL;

-- CreateTable
CREATE TABLE `ExpeditionManualItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NULL,
    `expeditionSortOrder` INTEGER NULL,
    `kind` ENUM('MANUAL_JOB', 'INTERNAL_TRANSFER') NOT NULL,
    `orderNumber` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `expediceNote` TEXT NULL,
    `doprava` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Block_expedition_idx`
    ON `Block`(`deadlineExpedice`, `expeditionPublishedAt`, `expeditionSortOrder`);

-- CreateIndex
CREATE INDEX `ExpeditionManualItem_date_expeditionSortOrder_idx`
    ON `ExpeditionManualItem`(`date`, `expeditionSortOrder`);

-- CreateIndex
CREATE INDEX `ExpeditionManualItem_kind_date_idx`
    ON `ExpeditionManualItem`(`kind`, `date`);

-- CreateIndex
CREATE INDEX `ExpeditionManualItem_createdAt_idx`
    ON `ExpeditionManualItem`(`createdAt`);
