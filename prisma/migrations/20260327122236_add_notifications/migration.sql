-- CreateTable
CREATE TABLE `Notification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `blockId` INTEGER NOT NULL,
    `blockOrderNumber` VARCHAR(191) NULL,
    `targetRole` VARCHAR(191) NOT NULL,
    `createdByUserId` INTEGER NOT NULL,
    `createdByUsername` VARCHAR(191) NOT NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_targetRole_isRead_createdAt_idx`(`targetRole`, `isRead`, `createdAt`),
    INDEX `Notification_blockId_idx`(`blockId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
