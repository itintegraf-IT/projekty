-- CreateTable
CREATE TABLE `BlockNote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `blockId` INTEGER NOT NULL,
    `text` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdByUserId` INTEGER NOT NULL,
    `createdByUsername` VARCHAR(191) NOT NULL,

    INDEX `BlockNote_blockId_createdAt_idx`(`blockId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BlockNote` ADD CONSTRAINT `BlockNote_blockId_fkey` FOREIGN KEY (`blockId`) REFERENCES `Block`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
