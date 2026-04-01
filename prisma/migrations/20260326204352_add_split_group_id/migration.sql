-- AlterTable
-- INT UNSIGNED: musí odpovídat typu `Block.id` (např. DB z mysql-schema.sql má UNSIGNED)
ALTER TABLE `Block` ADD COLUMN `splitGroupId` INT UNSIGNED NULL;

-- CreateIndex
CREATE INDEX `Block_splitGroupId_idx` ON `Block`(`splitGroupId`);

-- AddForeignKey
ALTER TABLE `Block` ADD CONSTRAINT `Block_splitGroupId_fkey` FOREIGN KEY (`splitGroupId`) REFERENCES `Block`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
