-- AlterTable
ALTER TABLE `Block` ADD COLUMN `materialInStock` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `pantoneOk` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `pantoneRequiredDate` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `MachineWorkHoursTemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `machine` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `validFrom` DATETIME(3) NOT NULL,
    `validTo` DATETIME(3) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MachineWorkHoursTemplate_machine_validFrom_idx`(`machine`, `validFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MachineWorkHoursTemplateDay` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NOT NULL,
    `dayOfWeek` INTEGER NOT NULL,
    `startHour` INTEGER NOT NULL,
    `endHour` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `MachineWorkHoursTemplateDay_templateId_dayOfWeek_key`(`templateId`, `dayOfWeek`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MachineWorkHoursTemplateDay` ADD CONSTRAINT `MachineWorkHoursTemplateDay_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `MachineWorkHoursTemplate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
