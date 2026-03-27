-- AlterTable
ALTER TABLE `Block` ADD COLUMN `splitGroupId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Block_splitGroupId_idx` ON `Block`(`splitGroupId`);

-- AddForeignKey
ALTER TABLE `Block` ADD CONSTRAINT `Block_splitGroupId_fkey` FOREIGN KEY (`splitGroupId`) REFERENCES `Block`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
