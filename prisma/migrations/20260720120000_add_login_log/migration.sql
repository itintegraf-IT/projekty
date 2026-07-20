-- CreateTable: audit přihlášení. Bez FK relace na User (historie přežije smazání účtu).
-- Charset dle konvence všech migrací projektu (utf8mb4_unicode_ci).
CREATE TABLE `LoginLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `username` VARCHAR(191) NOT NULL,
    `success` BOOLEAN NOT NULL,
    `failureReason` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LoginLog_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `LoginLog_username_createdAt_idx`(`username`, `createdAt`),
    INDEX `LoginLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
