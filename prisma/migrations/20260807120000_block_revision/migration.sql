-- CreateTable: serverové revize bloků (etapa B1).
-- Bez FK na Block: revize musí přežít smazání bloku, a produkční Block.id
-- je INT UNSIGNED, takže FK z INT sloupce by selhal na errno 150.
-- Charset dle konvence všech migrací projektu (utf8mb4_unicode_ci).
CREATE TABLE `BlockRevision` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `groupId` VARCHAR(32) NOT NULL,
    `blockId` INTEGER NOT NULL,
    `machine` VARCHAR(191) NOT NULL,
    `orderNumber` VARCHAR(191) NULL,
    `action` VARCHAR(32) NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `rowVersion` DATETIME(3) NULL,
    `partial` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BlockRevision_groupId_idx`(`groupId`),
    INDEX `BlockRevision_blockId_createdAt_idx`(`blockId`, `createdAt`),
    INDEX `BlockRevision_machine_createdAt_idx`(`machine`, `createdAt`),
    INDEX `BlockRevision_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: korelace auditu a revize. Na MySQL 8.0 je ADD COLUMN NULL INSTANT.
ALTER TABLE `AuditLog` ADD COLUMN `groupId` VARCHAR(32) NULL;

-- CreateIndex: složený, protože predikát potlačení v historii bloku se ptá
-- na (groupId, blockId) zároveň. POZOR: CREATE INDEX NENÍ instantní operace —
-- jede ALGORITHM=INPLACE a na začátku i konci bere exkluzivní metadata lock.
CREATE INDEX `AuditLog_groupId_blockId_idx` ON `AuditLog`(`groupId`, `blockId`);
