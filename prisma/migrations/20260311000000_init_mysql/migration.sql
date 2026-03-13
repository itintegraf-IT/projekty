-- CreateTable
CREATE TABLE `Block` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderNumber` VARCHAR(191) NOT NULL,
    `machine` VARCHAR(191) NOT NULL,
    `startTime` DATETIME(3) NOT NULL,
    `endTime` DATETIME(3) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'ZAKAZKA',
    `description` VARCHAR(191) NULL,
    `locked` BOOLEAN NOT NULL DEFAULT false,
    `deadlineExpedice` DATETIME(3) NULL,
    `dataStatusId` INTEGER NULL,
    `dataStatusLabel` VARCHAR(191) NULL,
    `dataRequiredDate` DATETIME(3) NULL,
    `dataOk` BOOLEAN NOT NULL DEFAULT false,
    `materialStatusId` INTEGER NULL,
    `materialStatusLabel` VARCHAR(191) NULL,
    `materialRequiredDate` DATETIME(3) NULL,
    `materialOk` BOOLEAN NOT NULL DEFAULT false,
    `barvyStatusId` INTEGER NULL,
    `barvyStatusLabel` VARCHAR(191) NULL,
    `lakStatusId` INTEGER NULL,
    `lakStatusLabel` VARCHAR(191) NULL,
    `specifikace` VARCHAR(191) NULL,
    `recurrenceType` VARCHAR(191) NOT NULL DEFAULT 'NONE',
    `recurrenceParentId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `Block_recurrenceParentId_idx`(`recurrenceParentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CodebookOption` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `category` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `shortCode` VARCHAR(191) NULL,
    `isWarning` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompanyDay` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'VIEWER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Block` ADD CONSTRAINT `Block_recurrenceParentId_fkey` FOREIGN KEY (`recurrenceParentId`) REFERENCES `Block`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
