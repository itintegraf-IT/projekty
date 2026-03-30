-- DropIndex
DROP INDEX `Notification_blockId_idx` ON `Notification`;

-- AlterTable
ALTER TABLE `Block` ADD COLUMN `reservationId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Notification` ADD COLUMN `message` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `reservationId` INTEGER NULL,
    ADD COLUMN `targetUserId` INTEGER NULL,
    ADD COLUMN `type` VARCHAR(191) NOT NULL DEFAULT 'BLOCK_NOTIFY',
    MODIFY `blockId` INTEGER NULL,
    MODIFY `targetRole` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Reservation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL DEFAULT '',
    `status` VARCHAR(191) NOT NULL,
    `companyName` VARCHAR(191) NOT NULL,
    `erpOfferNumber` VARCHAR(191) NOT NULL,
    `requestedExpeditionDate` DATETIME(3) NOT NULL,
    `requestedDataDate` DATETIME(3) NOT NULL,
    `requestText` TEXT NULL,
    `requestedByUserId` INTEGER NOT NULL,
    `requestedByUsername` VARCHAR(191) NOT NULL,
    `plannerUserId` INTEGER NULL,
    `plannerUsername` VARCHAR(191) NULL,
    `plannerDecisionReason` TEXT NULL,
    `planningPayload` JSON NULL,
    `preparedAt` DATETIME(3) NULL,
    `scheduledBlockId` INTEGER NULL,
    `scheduledMachine` VARCHAR(191) NULL,
    `scheduledStartTime` DATETIME(3) NULL,
    `scheduledEndTime` DATETIME(3) NULL,
    `scheduledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Reservation_code_key`(`code`),
    INDEX `Reservation_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `Reservation_requestedByUserId_status_createdAt_idx`(`requestedByUserId`, `status`, `createdAt`),
    INDEX `Reservation_erpOfferNumber_idx`(`erpOfferNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReservationAttachment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reservationId` INTEGER NOT NULL,
    `originalName` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `uploadedByUserId` INTEGER NOT NULL,
    `uploadedByUsername` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ReservationAttachment_storageKey_key`(`storageKey`),
    INDEX `ReservationAttachment_reservationId_createdAt_idx`(`reservationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Block_reservationId_idx` ON `Block`(`reservationId`);

-- CreateIndex
CREATE INDEX `Notification_targetUserId_isRead_createdAt_idx` ON `Notification`(`targetUserId`, `isRead`, `createdAt`);

-- CreateIndex
CREATE INDEX `Notification_blockId_createdAt_idx` ON `Notification`(`blockId`, `createdAt`);

-- CreateIndex
CREATE INDEX `Notification_reservationId_createdAt_idx` ON `Notification`(`reservationId`, `createdAt`);

-- AddForeignKey
ALTER TABLE `Block` ADD CONSTRAINT `Block_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `Reservation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservationAttachment` ADD CONSTRAINT `ReservationAttachment_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `Reservation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
